const { parsePcm16, analyse, autoDbRange, HighPassFilter, Decimator } = require('./dsp')
const { requestedAudioSource } = require('./compatibility')

const STATES = { IDLE: 'idle', REQUESTING: 'requesting', CHECKING: 'checking', ANALYSING: 'analysing', PAUSED: 'paused', STOPPING: 'stopping' }

class CaptureService {
  constructor() {
    this.recorder = wx.getRecorderManager()
    this.state = STATES.IDLE
    this.callbacks = {}
    this.samples = new Float32Array(0)
    this.sampleRate = 48000
    this.analysisSampleRate = 2000
    this.fftSize = 2048
    this.startedAt = 0
    this.mode = 'phone'
    this.bind()
  }
  bind() {
    this.recorder.onFrameRecorded(({ frameBuffer }) => {
      try {
        const frame = this.decimator.process(this.highPass.process(parsePcm16(frameBuffer)))
        if (!frame.length) return
        const all = new Float32Array(Math.min(this.fftSize * 2, this.samples.length + frame.length))
        const keep = Math.min(this.samples.length, all.length - frame.length)
        if (keep) all.set(this.samples.subarray(this.samples.length - keep), 0)
        all.set(frame.subarray(Math.max(0, frame.length - (all.length - keep))), keep)
        this.samples = all
        if (Date.now() - this.lastAnalysisAt < 125 || this.samples.length < this.fftSize) return
        this.lastAnalysisAt = Date.now()
        const result = this.smoothResult(analyse(this.samples, this.analysisSampleRate, this.fftSize))
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
        this.start({ ...this.startOptions, recording: restartAsRecording })
          .catch(error => this.callbacks.error && this.callbacks.error(error.errMsg || error.message || '无法重启采集'))
        return
      }
      this.callbacks.stop && this.callbacks.stop({ tempFilePath: result.tempFilePath, duration, fileSize: result.fileSize, recorded: savedRecording })
    })
  }
  on(callbacks) { this.callbacks = callbacks || {} }
  smoothResult(result) {
    if (!result) return result
    const alpha = .22
    if (this.smoothedSpectrum && this.smoothedSpectrum.length === result.spectrum.length) {
      result.spectrum = result.spectrum.map((point, index) => ({
        frequency: point.frequency,
        db: Number((this.smoothedSpectrum[index] + alpha * (point.db - this.smoothedSpectrum[index])).toFixed(2))
      }))
    }
    this.smoothedSpectrum = result.spectrum.map(point => point.db)
    result.bins = this.smoothedSpectrum.slice()
    const target = autoDbRange(this.smoothedSpectrum)
    if (this.smoothedRange) {
      result.spectrumRange = {
        min: Number((this.smoothedRange.min + .2 * (target.min - this.smoothedRange.min)).toFixed(1)),
        max: Number((this.smoothedRange.max + .2 * (target.max - this.smoothedRange.max)).toFixed(1))
      }
    } else result.spectrumRange = target
    this.smoothedRange = result.spectrumRange
    return result
  }
  async start({ mode, platform, earSide = 'auto', recording = false }) {
    if (this.state !== STATES.IDLE) throw new Error('当前采集尚未结束')
    this.state = STATES.REQUESTING; this.mode = mode; this.samples = new Float32Array(0)
    this.startOptions = { mode, platform, earSide }; this.recordingEnabled = recording; this.lastAnalysisAt = 0
    this.smoothedSpectrum = null; this.smoothedRange = null
    this.highPass = new HighPassFilter(this.sampleRate, 7)
    this.decimator = new Decimator(this.sampleRate, this.analysisSampleRate)
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
    this.recorder.pause(); this.state = STATES.PAUSED; this.callbacks.state && this.callbacks.state(this.state, { recording: this.recordingEnabled })
  }
  resume() {
    if (this.state !== STATES.PAUSED) return
    this.recorder.resume(); this.state = STATES.ANALYSING; this.callbacks.state && this.callbacks.state(this.state, { recording: this.recordingEnabled })
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
