const { parsePcm16, analyse, HighPassFilter, Decimator } = require('./dsp')
const { requestedAudioSource } = require('./compatibility')
const { pcmFileToWav } = require('./wav-file')
const { SpectrumAverage } = require('./spectrum-average')

const STATES = { IDLE: 'idle', REQUESTING: 'requesting', CHECKING: 'checking', ANALYSING: 'analysing', PAUSED: 'paused', STOPPING: 'stopping' }

class CaptureService {
  constructor() {
    this.recorder = wx.getRecorderManager()
    this.state = STATES.IDLE
    this.callbacks = {}
    this.sampleRate = 48000
    this.analysisSampleRate = 4000
    this.fftSize = 4096
    this.analysisWindowSize = 2048
    this.samples = new Float32Array(this.fftSize * 2)
    this.sampleCount = 0
    this.startedAt = 0
    this.mode = 'phone'
    this.spectrumAverage = new SpectrumAverage(3)
    this.bind()
  }
  bind() {
    this.recorder.onFrameRecorded(({ frameBuffer }) => {
      if (this.state !== STATES.ANALYSING) return
      try {
        const frame = this.decimator.process(this.highPass.process(parsePcm16(frameBuffer)))
        if (!frame.length) return
        this.appendSamples(frame)
        // 4 KB PCM frames at 48 kHz arrive about every 43 ms. Analyse each frame
        // once the 512 ms data window is full for a practical 20-24 FPS update rate.
        if (Date.now() - this.lastAnalysisAt < 40 || this.sampleCount < this.analysisWindowSize) return
        this.lastAnalysisAt = Date.now()
        const rawResult = analyse(this.samples.subarray(0, this.sampleCount), this.analysisSampleRate, this.fftSize, { windowSize: this.analysisWindowSize, workspace: this.dspWorkspace })
        const result = this.spectrumAverage.push(rawResult, this.lastAnalysisAt)
        if (result && this.state === STATES.ANALYSING) this.callbacks.data && this.callbacks.data(result)
      } catch (error) { this.callbacks.error && this.callbacks.error('PCM 帧无法解析：' + error.message) }
    })
    this.recorder.onPause(() => {
      if (this.mode === 'headset' && this.state === STATES.ANALYSING) this.handleHeadsetRouteLost('耳机录音被系统暂停，可能是耳机断开或音频路由改变。')
    })
    this.recorder.onInterruptionBegin(() => {
      if (this.mode === 'headset') this.handleHeadsetRouteLost('耳机音频路由已中断，测试已停止。')
    })
    this.recorder.onError(error => { clearTimeout(this.segmentTimer); this.stopHeadsetGuard(); this.state = STATES.IDLE; this.callbacks.state && this.callbacks.state(this.state, { recording: false, finalizing: false }); this.callbacks.error && this.callbacks.error(error.errMsg || '录音器异常') })
    this.recorder.onStop(result => {
      clearTimeout(this.segmentTimer)
      this.stopHeadsetGuard()
      const duration = Number.isFinite(result.duration) ? result.duration : Math.max(0, Date.now() - this.startedAt)
      const savedRecording = this.recordingEnabled
      const restartAsRecording = this.pendingRecording
      const restartAnalysis = !savedRecording && this.stopReason === 'analysis-segment'
      const stopReason = this.stopReason
      this.state = STATES.IDLE
      this.stopReason = null; this.pendingRecording = false
      if (restartAsRecording || restartAnalysis) {
        this.start({ ...this.startOptions, recording: restartAsRecording, preserveAnalysisState: true })
          .catch(error => this.callbacks.error && this.callbacks.error(error.errMsg || error.message || '无法重启采集'))
        return
      }
      this.finishStoppedFile(result, { duration, recorded: savedRecording, stopReason })
    })
  }
  getAvailableAudioSources() {
    return new Promise((resolve, reject) => wx.getAvailableAudioSources({ success: result => resolve(result.audioSources || []), fail: reject }))
  }
  async prepareHeadsetRoute(platform) {
    if (this.mode !== 'headset') return
    let sources
    try { sources = await this.getAvailableAudioSources() } catch (_) {
      this.state = STATES.IDLE
      throw new Error('无法确认耳机输入状态，请重新连接耳机后再试。')
    }
    this.headsetSourceObserved = sources.includes(platform === 'iOS' ? 'headsetMic' : 'mic')
    if (platform === 'iOS' && !this.headsetSourceObserved) {
      this.state = STATES.IDLE
      throw new Error('未检测到可用的耳机麦克风。请先连接耳机，并确认微信已切换到耳机输入。')
    }
  }
  startHeadsetGuard() {
    this.stopHeadsetGuard()
    if (this.mode !== 'headset' || !this.headsetSourceObserved) return
    this.routeTimer = setInterval(() => {
      if (this.routeCheckInFlight || ![STATES.ANALYSING, STATES.PAUSED].includes(this.state)) return
      this.routeCheckInFlight = true
      this.getAvailableAudioSources().then(sources => {
        const expected = this.startOptions.platform === 'iOS' ? 'headsetMic' : 'mic'
        if (!sources.includes(expected)) this.handleHeadsetRouteLost('耳机麦克风已断开，测试已停止，未切换到手机麦克风。')
        this.routeCheckInFlight = false
      }, () => { this.routeCheckInFlight = false })
    }, 800)
  }
  stopHeadsetGuard() { clearInterval(this.routeTimer); this.routeTimer = null; this.routeCheckInFlight = false }
  handleHeadsetRouteLost(message) {
    if (this.mode !== 'headset' || ![STATES.ANALYSING, STATES.PAUSED].includes(this.state)) return
    this.callbacks.routeLost && this.callbacks.routeLost(message)
    this.stop('headset-route-lost')
  }
  async finishStoppedFile(result, details) {
    const file = {
      tempFilePath: result.tempFilePath,
      duration: details.duration,
      fileSize: result.fileSize,
      recorded: details.recorded,
      stopReason: details.stopReason,
      fileFormat: details.recorded ? 'pcm' : '',
      playbackReady: false,
      conversionError: ''
    }
    if (details.recorded && result.tempFilePath) {
      try {
        const wav = await pcmFileToWav(result.tempFilePath, { sampleRate: this.sampleRate, channels: 1, bitsPerSample: 16 })
        file.tempFilePath = wav.filePath
        file.fileSize = wav.fileSize
        file.fileFormat = wav.format
        file.playbackReady = true
      } catch (error) {
        file.conversionError = error.errMsg || error.message || 'PCM 转 WAV 失败'
      }
    }
    this.callbacks.stop && this.callbacks.stop(file)
  }
  on(callbacks) { this.callbacks = callbacks || {} }
  appendSamples(frame) {
    const capacity = this.samples.length
    if (frame.length >= capacity) {
      this.samples.set(frame.subarray(frame.length - capacity)); this.sampleCount = capacity; return
    }
    const overflow = Math.max(0, this.sampleCount + frame.length - capacity)
    if (overflow) { this.samples.copyWithin(0, overflow, this.sampleCount); this.sampleCount -= overflow }
    this.samples.set(frame, this.sampleCount); this.sampleCount += frame.length
  }
  setAverageDuration(seconds) { return this.spectrumAverage.setSeconds(seconds) }
  async start({ mode, platform, earSide = 'auto', recording = false, preserveAnalysisState = false }) {
    if (this.state !== STATES.IDLE) throw new Error('当前采集尚未结束')
    this.state = STATES.REQUESTING; this.mode = mode
    this.startOptions = { mode, platform, earSide }; this.recordingEnabled = recording; this.lastAnalysisAt = 0
    if (!preserveAnalysisState) {
      this.samples = new Float32Array(this.fftSize * 2); this.sampleCount = 0
      this.dspWorkspace = {}
      this.spectrumAverage.reset()
      this.highPass = new HighPassFilter(this.sampleRate, 7)
      this.decimator = new Decimator(this.sampleRate, this.analysisSampleRate, 1500, 129)
    }
    // Trigger WeChat's unified privacy dialog before requesting microphone
    // permission. The platform privacy guide must declare microphone/audio use.
    if (wx.requirePrivacyAuthorize) {
      await new Promise((resolve, reject) => wx.requirePrivacyAuthorize({ success: resolve, fail: reject }))
    }
    await new Promise((resolve, reject) => wx.authorize({ scope: 'scope.record', success: resolve, fail: reject }))
    await this.prepareHeadsetRoute(platform)
    this.state = STATES.CHECKING
    this.recorder.start({
      duration: 30000, sampleRate: this.sampleRate, numberOfChannels: 1,
      encodeBitRate: 96000, format: 'PCM', frameSize: 4,
      audioSource: requestedAudioSource(mode, platform)
    })
    this.startedAt = Date.now(); this.earSide = earSide; this.state = STATES.ANALYSING
    this.segmentTimer = setTimeout(() => this.stop(recording ? 'recording-max' : 'analysis-segment'), 30000)
    this.startHeadsetGuard()
    this.callbacks.state && this.callbacks.state(this.state, { recording })
  }
  pause() {
    if (this.state !== STATES.ANALYSING) return
    this.state = STATES.PAUSED
    this.callbacks.state && this.callbacks.state(this.state, { recording: this.recordingEnabled })
    if (wx.nextTick) wx.nextTick(() => this.recorder.pause())
    else this.recorder.pause()
  }
  resume() {
    if (this.state !== STATES.PAUSED) return
    this.state = STATES.ANALYSING
    this.callbacks.state && this.callbacks.state(this.state, { recording: this.recordingEnabled })
    if (wx.nextTick) wx.nextTick(() => this.recorder.resume())
    else this.recorder.resume()
  }
  startRecording() {
    if (this.state !== STATES.ANALYSING || this.recordingEnabled) return
    this.pendingRecording = true
    this.stop('recording-boundary')
  }
  stop(reason = 'user') {
    if (![STATES.ANALYSING, STATES.PAUSED].includes(this.state)) return
    clearTimeout(this.segmentTimer); this.stopHeadsetGuard(); this.state = STATES.STOPPING; this.stopReason = reason
    this.callbacks.state && this.callbacks.state(this.state, { recording: this.recordingEnabled, finalizing: this.recordingEnabled })
    this.recorder.stop()
  }
}
module.exports = { CaptureService, STATES }
