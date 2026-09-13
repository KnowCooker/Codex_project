const { parsePcm16, analyse, HighPassFilter } = require('./dsp')
const { requestedAudioSource } = require('./compatibility')

const STATES = { IDLE: 'idle', REQUESTING: 'requesting', CHECKING: 'checking', ANALYSING: 'analysing', PAUSED: 'paused', STOPPING: 'stopping' }

class CaptureService {
  constructor() {
    this.recorder = wx.getRecorderManager()
    this.state = STATES.IDLE
    this.callbacks = {}
    this.samples = new Float32Array(0)
    this.sampleRate = 48000
    this.fftSize = 4096
    this.startedAt = 0
    this.mode = 'phone'
    this.bind()
  }
  bind() {
    this.recorder.onFrameRecorded(({ frameBuffer }) => {
      try {
        const frame = this.highPass.process(parsePcm16(frameBuffer))
        const all = new Float32Array(Math.min(this.fftSize * 2, this.samples.length + frame.length))
        const keep = Math.min(this.samples.length, all.length - frame.length)
        if (keep) all.set(this.samples.subarray(this.samples.length - keep), 0)
        all.set(frame.subarray(Math.max(0, frame.length - (all.length - keep))), keep)
        this.samples = all
        const result = analyse(this.samples, this.sampleRate, this.fftSize)
        if (result && this.state === STATES.ANALYSING) this.callbacks.data && this.callbacks.data(result)
      } catch (error) { this.callbacks.error && this.callbacks.error('PCM 帧无法解析：' + error.message) }
    })
    this.recorder.onError(error => { this.state = STATES.IDLE; this.callbacks.error && this.callbacks.error(error.errMsg || '录音器异常') })
    this.recorder.onStop(result => {
      const duration = Math.max(0, Date.now() - this.startedAt)
      this.state = STATES.IDLE
      this.callbacks.stop && this.callbacks.stop({ tempFilePath: result.tempFilePath, duration, fileSize: result.fileSize })
    })
  }
  on(callbacks) { this.callbacks = callbacks || {} }
  async start({ mode, platform, earSide = 'auto' }) {
    if (this.state !== STATES.IDLE) throw new Error('当前采集尚未结束')
    this.state = STATES.REQUESTING; this.mode = mode; this.samples = new Float32Array(0)
    this.highPass = new HighPassFilter(this.sampleRate, 7)
    await new Promise((resolve, reject) => wx.authorize({ scope: 'scope.record', success: resolve, fail: reject }))
    this.state = STATES.CHECKING
    this.recorder.start({
      duration: 600000, sampleRate: this.sampleRate, numberOfChannels: 1,
      encodeBitRate: 96000, format: 'PCM', frameSize: 4,
      audioSource: requestedAudioSource(mode, platform)
    })
    this.startedAt = Date.now(); this.earSide = earSide; this.state = STATES.ANALYSING
    this.callbacks.state && this.callbacks.state(this.state)
  }
  pause() {
    if (this.state !== STATES.ANALYSING) return
    this.recorder.pause(); this.state = STATES.PAUSED; this.callbacks.state && this.callbacks.state(this.state)
  }
  resume() {
    if (this.state !== STATES.PAUSED) return
    this.recorder.resume(); this.state = STATES.ANALYSING; this.callbacks.state && this.callbacks.state(this.state)
  }
  stop(reason = 'user') {
    if (![STATES.ANALYSING, STATES.PAUSED].includes(this.state)) return
    this.state = STATES.STOPPING; this.stopReason = reason; this.recorder.stop()
  }
}
module.exports = { CaptureService, STATES }
