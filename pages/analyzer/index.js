const { CaptureService, STATES } = require('../../services/capture-service')
const { getSystemProfile, requestedAudioSource } = require('../../services/compatibility')
const repo = require('../../services/recording-repository')

let capture
Page({
  data: { mode: 'phone', earSide: 'auto', source: 'mic', state: 'idle', elapsed: '00:00', metrics: null, error: '', warning: '', hasData: false, spectrumAxis: 'log', spectrumLabel: '对数频率轴' },
  onLoad(query) {
    const profile = getSystemProfile(); const mode = query.mode || 'phone'; const earSide = query.earSide || 'auto'
    this.setData({ mode, earSide, source: query.source || requestedAudioSource(mode, profile.platform), profile, warning: mode === 'headset' ? '耳机输入为“未验证”。请在敲击测试后确认继续；断开耳机将安全停止。' : '' })
    capture = new CaptureService()
    capture.on({ data: metrics => { this.latestMetrics = metrics; this.setData({ metrics, metricView: this.present(metrics), hasData: true }); this.draw(metrics) }, state: state => this.setData({ state }), error: error => this.setData({ error, state: 'idle' }), stop: file => this.complete(file) })
    this.start()
  },
  onUnload() { if (capture) capture.stop('page-hide'); clearInterval(this.timer) },
  onHide() { if (capture && this.data.state === STATES.ANALYSING) capture.stop('page-hidden') },
  async start() {
    try {
      this.setData({ error: '', state: 'requesting' })
      await capture.start({ mode: this.data.mode, platform: this.data.profile.platform, earSide: this.data.earSide })
      this.startedAt = Date.now(); this.timer = setInterval(() => this.tick(), 1000)
    } catch (error) { this.setData({ error: '无法开始录音：' + (error.errMsg || error.message || '请检查麦克风权限'), state: 'idle' }) }
  },
  tick() { const seconds = Math.floor((Date.now() - this.startedAt) / 1000); this.setData({ elapsed: `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` }) },
  togglePause() { if (this.data.state === STATES.ANALYSING) capture.pause(); else if (this.data.state === STATES.PAUSED) capture.resume() },
  stop() { clearInterval(this.timer); capture.stop('user') },
  complete(file) {
    clearInterval(this.timer)
    const metrics = this.data.metrics || { rmsDb: -100, peakDb: -100, peakFrequency: 0, clipped: 0 }
    const now = new Date(); const id = `${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const record = { id, name: `测试 ${now.toLocaleString()}`, createdAt: now.toLocaleString(), mode: this.data.mode, earSide: this.data.earSide, earVerified: this.data.mode === 'headset' ? false : true, source: this.data.source, platform: this.data.profile.platform, model: this.data.profile.model, sampleRate: 48000, fftSize: 4096, duration: file.duration, filePath: file.tempFilePath, fileSize: file.fileSize, interruptedReason: capture.stopReason || 'user', summary: { rmsDb: Number(metrics.rmsDb.toFixed(1)), peakDb: Number(metrics.peakDb.toFixed(1)), peakFrequency: Math.round(metrics.peakFrequency), clipped: metrics.clipped, spectrum: metrics.bins || [] } }
    repo.save(record)
    wx.redirectTo({ url: `/pages/record-detail/index?id=${id}` })
  },
  present(metrics) { return { rms: metrics.rmsDb.toFixed(1), peak: metrics.peakDb.toFixed(1), frequency: metrics.peakFrequency.toFixed(0), clipped: metrics.clipped } },
  setSpectrumAxis(event) {
    const spectrumAxis = event.currentTarget.dataset.axis
    this.setData({ spectrumAxis, spectrumLabel: spectrumAxis === 'log' ? '对数频率轴' : '线性频率轴' })
    if (this.latestMetrics) this.draw(this.latestMetrics)
  },
  draw(metrics) { this.drawWaveform(metrics); this.drawSpectrum(metrics) },
  drawWaveform(metrics) {
    const values = metrics.waveform || []; const id = 'wave'; const min = -1; const max = 1; const color = '#4fd1c5'
    const ctx = wx.createCanvasContext(id, this); const width = 694, height = 260
    ctx.setFillStyle('#f9fcff'); ctx.fillRect(0, 0, width, height); ctx.setStrokeStyle('#dbe6f3'); ctx.setLineWidth(1)
    for (let y = 0; y <= height; y += height / 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke() }
    ctx.setFillStyle('#718096'); ctx.setFontSize(18); ctx.fillText('V（归一化）', 8, 20); ctx.fillText('0', 10, height / 2 - 4); ctx.fillText('time / ms', width - 108, height - 8)
    const duration = metrics.waveformDurationMs || 0; ctx.fillText('0', 5, height - 8); ctx.fillText(duration.toFixed(0), width - 36, height - 8)
    if (values.length) { ctx.setStrokeStyle(color); ctx.setLineWidth(2); ctx.beginPath(); values.forEach((value, i) => { const x = i / Math.max(1, values.length - 1) * width; const y = height - (Math.max(min, Math.min(max, value)) - min) / (max - min) * height; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) }); ctx.stroke() }
    ctx.draw()
  },
  drawSpectrum(metrics) {
    const ctx = wx.createCanvasContext('spectrum', this); const width = 694, height = 260
    const values = metrics.spectrum || []; const range = metrics.spectrumRange || { min: -100, max: 0 }; const axis = this.data.spectrumAxis
    const projectX = frequency => axis === 'log' ? (Math.log(frequency / 20) / Math.log(500 / 20)) * width : ((frequency - 20) / 480) * width
    ctx.setFillStyle('#f9fcff'); ctx.fillRect(0, 0, width, height); ctx.setStrokeStyle('#dbe6f3'); ctx.setLineWidth(1)
    for (let i = 0; i <= 4; i++) { const y = i / 4 * height; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke() }
    const ticks = axis === 'log' ? [20, 50, 100, 200, 500] : [20, 140, 260, 380, 500]
    ctx.setFillStyle('#718096'); ctx.setFontSize(18); ctx.fillText('dB（相对 dBFS）', 8, 20); ctx.fillText(`${range.max}`, 8, 40); ctx.fillText(`${range.min}`, 8, height - 24)
    ticks.forEach(freq => { const x = projectX(freq); ctx.setStrokeStyle('#dbe6f3'); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); ctx.setFillStyle('#718096'); ctx.fillText(String(freq), Math.min(width - 30, Math.max(3, x - 10)), height - 8) })
    ctx.fillText('Hz', width - 22, height - 8)
    if (values.length) { ctx.setStrokeStyle('#8b9cff'); ctx.setLineWidth(2); ctx.beginPath(); values.forEach((point, i) => { const x = projectX(point.frequency); const y = height - (Math.max(range.min, Math.min(range.max, point.db)) - range.min) / (range.max - range.min) * height; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) }); ctx.stroke() }
    ctx.draw()
  }
})
