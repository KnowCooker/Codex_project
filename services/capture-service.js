const { parsePcm16, analyse, autoDbRange, HighPassFilter, Decimator } = require('./dsp')
const { requestedAudioSource } = require('./compatibility')

const STATES = { IDLE: 'idle', REQUESTING: 'requesting', CHECKING: 'checking', ANALYSING: 'analysing', PAUSED: 'paused', STOPPING: 'stopping' }

class CaptureService {
  constructor() {
    this.recorder = wx.getRecorderManager()
    this.state = STATES.IDLE
    this.callbacks = {}
    this.sampleRate = 48000
    this.analysisSampleRate = 2000
    this.fftSize = 2048
    this.analysisWindowSize = 1024
    this.samples = new Float32Array(this.fftSize * 2)
    this.sampleCount = 0
    this.startedAt = 0
    this.mode = 'phone'
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
        // once the one-second FFT window is full for a practical 20-24 FPS UI.
        if (Date.now() - this.lastAnalysisAt < 40 || this.sampleCount < this.analysisWindowSize) return
        this.lastAnalysisAt = Date.now()
        const result = this.smoothResult(analyse(this.samples.subarray(0, this.sampleCount), this.analysisSampleRate, this.fftSize, { windowSize: this.analysisWindowSize, workspace: this.dspWorkspace }))
        if (result && this.state === STATES.ANALYSING) this.callbacks.data && this.callbacks.data(result)
      } catch (error) { this.callbacks.error && this.callbacks.error('PCM 帧无法解析：' + error.message) }
    })
    this.recorder.onError(error => { clearTimeout(this.segmentTimer); this.state = STATES.IDLE; this.callbacks.error && this.callbacks.error(error.errMsg || '录音器异常') })
    this.recorder.onStop(result => {
      clearTimeout(this.segmentTimer)
      const duration = Math.max(0, Date.now() - this.startedAt)
      const savedRecording = this.recordingEnabled
      const restartAsRecording = this.pendingRecording
      const restartAnalysis = !savedRecording && this.stopReason === 'analysis-segment'
      this.state = STATES.IDLE
      this.stopReason = null; this.pendingRecording = false
      if (restartAsRecording || restartAnalysis) {
        this.start({ ...this.startOptions, recording: restartAsRecording, preserveAnalysisState: true })
          .catch(error => this.callbacks.error && this.callbacks.error(error.errMsg || error.message || '无法重启采集'))
        return
      }
      this.callbacks.stop && this.callbacks.stop({ tempFilePath: result.tempFilePath, duration, fileSize: result.fileSize, recorded: savedRecording })
    })
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
  smoothResult(result) {
    if (!result) return result
    // Faster attack/release than the previous value to avoid visible spectral lag.
    const alpha = .5
    if (this.smoothedSpectrum && this.smoothedSpectrum.length === result.spectrumDb.length) {
      for (let index = 0; index < result.spectrumDb.length; index++) {
        this.smoothedSpectrum[index] += alpha * (result.spectrumDb[index] - this.smoothedSpectrum[index])
        result.spectrumDb[index] = this.smoothedSpectrum[index]
      }
    } else this.smoothedSpectrum = new Float32Array(result.spectrumDb)
    const target = autoDbRange(this.smoothedSpectrum)
    if (this.smoothedRange) {
      result.spectrumRange = {
        min: Number((this.smoothedRange.min + .35 * (target.min - this.smoothedRange.min)).toFixed(1)),
        max: Number((this.smoothedRange.max + .35 * (target.max - this.smoothedRange.max)).toFixed(1))
      }
    } else result.spectrumRange = target
    this.smoothedRange = result.spectrumRange
    return result
  }
  async start({ mode, platform, earSide = 'auto', recording = false, preserveAnalysisState = false }) {
    if (this.state !== STATES.IDLE) throw new Error('当前采集尚未结束')
    this.state = STATES.REQUESTING; this.mode = mode
    this.startOptions = { mode, platform, earSide }; this.recordingEnabled = recording; this.lastAnalysisAt = 0
    if (!preserveAnalysisState) {
      this.samples = new Float32Array(this.fftSize * 2); this.sampleCount = 0
      this.dspWorkspace = {}
      this.smoothedSpectrum = null; this.smoothedRange = null
      this.highPass = new HighPassFilter(this.sampleRate, 7)
      this.decimator = new Decimator(this.sampleRate, this.analysisSampleRate)
    }
    await new Promise((resolve, reject) => wx.authorize({ scope: 'scope.record', success: resolve, fail: reject }))
    this.state = STATES.CHECKING
    this.recorder.start({
      duration: 30000, sampleRate: this.sampleRate, numberOfChannels: 1,
      encodeBitRate: 96000, format: 'PCM', frameSize: 4,
      audioSource: requestedAudioSource(mode, platform)
    })
    this.startedAt = Date.now(); this.earSide = earSide; this.state = STATES.ANALYSING
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
    if (![STATES.ANALYSING, STATES.PAUSED].includes(this.state)) return
    clearTimeout(this.segmentTimer); this.state = STATES.STOPPING; this.stopReason = reason; this.recorder.stop()
  }
}
module.exports = { CaptureService, STATES }
