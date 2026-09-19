const { parsePcm16, analyse, HighPassFilter, Decimator } = require('./dsp')
const { requestedAudioSource } = require('./compatibility')
const { pcmFileToWav } = require('./wav-file')
const { SpectrumAverage } = require('./spectrum-average')
const { SOURCE_SAMPLE_RATE, ANALYSIS_SAMPLE_RATE, FFT_SIZE, WINDOW_SIZE, HOP_SIZE, DECIMATOR_CUTOFF_HZ, DECIMATOR_TAP_COUNT } = require('./analysis-config')

const STATES = { IDLE: 'idle', REQUESTING: 'requesting', CHECKING: 'checking', ANALYSING: 'analysing', PAUSED: 'paused', STOPPING: 'stopping' }

class CaptureService {
  constructor() {
    this.recorder = wx.getRecorderManager()
    this.state = STATES.IDLE
    this.callbacks = {}
    this.sampleRate = SOURCE_SAMPLE_RATE
    this.analysisSampleRate = ANALYSIS_SAMPLE_RATE
    this.fftSize = FFT_SIZE
    this.analysisWindowSize = WINDOW_SIZE
    this.analysisHopSize = HOP_SIZE
    this.samples = new Float32Array(this.fftSize * 2)
    this.sampleCount = 0
    this.startedAt = 0
    this.operationId = 0
    this.recorderActive = false
    this.spectrumAverage = new SpectrumAverage(1, { sampleRate: this.analysisSampleRate, windowSize: this.analysisWindowSize, hopSize: this.analysisHopSize })
    this.bind()
  }
  bind() {
    this.recorder.onFrameRecorded(({ frameBuffer }) => {
      if (this.state !== STATES.ANALYSING) return
      try {
        // Recorder frames are normally a few KiB. Bound an unexpected oversized
        // frame so one native callback cannot monopolize the JS thread.
        const MAX_FRAME_BYTES = 128 * 1024
        const boundedBuffer = frameBuffer.byteLength > MAX_FRAME_BYTES ? frameBuffer.slice(frameBuffer.byteLength - MAX_FRAME_BYTES) : frameBuffer
        const frame = this.decimator.process(this.highPass.process(parsePcm16(boundedBuffer)))
        if (!frame.length) return
        this.appendSamples(frame)
        if (!this.analysisReady) {
          if (this.sampleCount < this.analysisWindowSize) return
          this.analysisReady = true
          this.samplesSinceAnalysis = 0
        } else {
          this.samplesSinceAnalysis += frame.length
          if (this.samplesSinceAnalysis < this.analysisHopSize) return
          this.samplesSinceAnalysis -= this.analysisHopSize
        }
        this.lastAnalysisAt = Date.now()
        const rawResult = analyse(this.samples.subarray(0, this.sampleCount), this.analysisSampleRate, this.fftSize, { windowSize: this.analysisWindowSize, workspace: this.dspWorkspace })
        rawResult.frameHopMs = this.analysisHopSize / this.analysisSampleRate * 1000
        const result = this.spectrumAverage.push(rawResult)
        if (result && this.state === STATES.ANALYSING) this.callbacks.data && this.callbacks.data(result)
      } catch (error) { this.callbacks.error && this.callbacks.error('PCM 帧无法解析：' + error.message) }
    })
    this.recorder.onError(error => { clearTimeout(this.segmentTimer); this.recorderActive = false; this.state = STATES.IDLE; this.callbacks.state && this.callbacks.state(this.state, { recording: false, finalizing: false }); this.callbacks.error && this.callbacks.error(error.errMsg || '录音器异常') })
    this.recorder.onStop(result => {
      clearTimeout(this.segmentTimer)
      this.recorderActive = false
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
  async finishStoppedFile(result, details) {
    const file = {
      tempFilePath: result.tempFilePath,
      duration: details.duration,
      fileSize: result.fileSize,
      recorded: details.recorded,
      stopReason: details.stopReason,
      fileFormat: details.recorded ? 'pcm' : '',
      sampleRate: this.sampleRate,
      channels: 1,
      bitsPerSample: 16,
      conversionError: ''
    }
    if (details.recorded && result.tempFilePath) {
      try {
        const wav = await pcmFileToWav(result.tempFilePath, { sampleRate: this.sampleRate, channels: 1, bitsPerSample: 16 })
        file.tempFilePath = wav.filePath
        file.fileSize = wav.fileSize
        file.fileFormat = wav.format
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
  async start({ platform, recording = false, preserveAnalysisState = false }) {
    if (this.state !== STATES.IDLE) throw new Error('当前采集尚未结束')
    const operationId = ++this.operationId
    this.state = STATES.REQUESTING
    this.startOptions = { platform }; this.recordingEnabled = recording; this.lastAnalysisAt = 0
    if (!preserveAnalysisState) {
      this.samples = new Float32Array(this.fftSize * 2); this.sampleCount = 0
      this.analysisReady = false; this.samplesSinceAnalysis = 0
      this.dspWorkspace = {}
      this.spectrumAverage.reset()
      this.highPass = new HighPassFilter(this.sampleRate, 7)
      this.decimator = new Decimator(this.sampleRate, this.analysisSampleRate, DECIMATOR_CUTOFF_HZ, DECIMATOR_TAP_COUNT)
    }
    // Trigger WeChat's unified privacy dialog before requesting microphone
    // permission. The platform privacy guide must declare microphone/audio use.
    try {
      if (wx.requirePrivacyAuthorize) {
        await new Promise((resolve, reject) => wx.requirePrivacyAuthorize({ success: resolve, fail: reject }))
      }
      if (operationId !== this.operationId) throw new Error('采集启动已取消')
      await new Promise((resolve, reject) => wx.authorize({ scope: 'scope.record', success: resolve, fail: reject }))
    } catch (error) {
      if (operationId === this.operationId) this.state = STATES.IDLE
      throw error
    }
    if (operationId !== this.operationId) throw new Error('采集启动已取消')
    this.state = STATES.CHECKING
    try {
      this.recorder.start({
        duration: 30000, sampleRate: this.sampleRate, numberOfChannels: 1,
        encodeBitRate: 96000, format: 'PCM', frameSize: 4,
        audioSource: requestedAudioSource(platform)
      })
      this.recorderActive = true
    } catch (error) {
      this.state = STATES.IDLE
      this.recorderActive = false
      throw error
    }
    if (operationId !== this.operationId) {
      this.recorder.stop()
      throw new Error('采集启动已取消')
    }
    this.startedAt = Date.now(); this.state = STATES.ANALYSING
    this.segmentTimer = setTimeout(() => this.stop(recording ? 'recording-max' : 'analysis-segment'), 30000)
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
    if ([STATES.IDLE, STATES.STOPPING].includes(this.state)) return
    ++this.operationId
    clearTimeout(this.segmentTimer)
    if ([STATES.REQUESTING, STATES.CHECKING].includes(this.state) && !this.recorderActive) {
      this.state = STATES.IDLE
      this.stopReason = reason
      this.callbacks.state && this.callbacks.state(this.state, { recording: false, finalizing: false })
      return
    }
    this.state = STATES.STOPPING; this.stopReason = reason
    this.callbacks.state && this.callbacks.state(this.state, { recording: this.recordingEnabled, finalizing: this.recordingEnabled })
    if (this.recorderActive) this.recorder.stop()
    else this.state = STATES.IDLE
  }
}
module.exports = { CaptureService, STATES }
