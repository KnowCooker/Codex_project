const { CaptureService, STATES } = require('../../services/capture-service')
const { getSystemProfile, requestedAudioSource } = require('../../services/compatibility')
const repo = require('../../services/recording-repository')

let capture
Page({
  data: { mode: 'phone', earSide: 'auto', source: 'mic', state: 'idle', elapsed: '00:00', recordingElapsed: '00:00', recording: false, metrics: null, error: '', warning: '', hasData: false, spectrumAxis: 'log', spectrumLabel: '对数频率轴', yScaleMode: 'auto', manualMin: '-80', manualMax: '0', manualRange: { min: -80, max: 0 }, canvasWidth: 320, canvasHeight: 300, canvasCssHeight: 300 },
  onLoad(query) {
    const profile = getSystemProfile(); const mode = query.mode || 'phone'; const earSide = query.earSide || 'auto'
    this.setData({ mode, earSide, source: query.source || requestedAudioSource(mode, profile.platform), profile, warning: mode === 'headset' ? '耳机输入为“未验证”。请在敲击测试后确认继续；断开耳机将安全停止。' : '' })
    capture = new CaptureService()
    capture.on({
      data: metrics => { this.latestMetrics = metrics; this.setData({ metricView: this.present(metrics), hasData: true }); this.draw(metrics) },
      state: (state, options = {}) => {
        if (options.recording && !this.data.recording) this.recordingStartedAt = Date.now()
        if (!options.recording) this.recordingStartedAt = 0
        this.setData({ state, recording: Boolean(options.recording) })
      },
      error: error => this.setData({ error, state: 'idle', recording: false }), stop: file => this.complete(file)
    })
    this.start()
  },
  onReady() { this.measureChart() },
  onResize() { wx.nextTick(() => this.measureChart()) },
  onUnload() { if (capture) capture.stop('page-hide'); clearInterval(this.timer) },
  onHide() { if (capture && this.data.state === STATES.ANALYSING) capture.stop('page-hidden') },
  async start() {
    try {
      this.setData({ error: '', state: 'requesting' })
      await capture.start({ mode: this.data.mode, platform: this.data.profile.platform, earSide: this.data.earSide, recording: false })
      this.startedAt = Date.now(); this.timer = setInterval(() => this.tick(), 1000)
    } catch (error) { this.setData({ error: '无法开始录音：' + (error.errMsg || error.message || '请检查麦克风权限'), state: 'idle' }) }
  },
  tick() {
    const seconds = Math.floor((Date.now() - this.startedAt) / 1000)
    const format = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
    const recordingSeconds = this.data.recording && this.recordingStartedAt ? Math.min(30, Math.floor((Date.now() - this.recordingStartedAt) / 1000)) : 0
    this.setData({ elapsed: format(seconds), recordingElapsed: format(recordingSeconds) })
  },
  togglePause() { if (this.data.state === STATES.ANALYSING) capture.pause(); else if (this.data.state === STATES.PAUSED) capture.resume() },
  startRecording() { if (!this.data.recording && this.data.state === STATES.ANALYSING) { wx.showToast({ title: '开始新的 30 秒录音片段', icon: 'none' }); capture.startRecording() } },
  stopRecording() { if (this.data.recording) capture.stop('recording-user') },
  stopAnalysis() { clearInterval(this.timer); capture.stop('user') },
  complete(file) {
    clearInterval(this.timer)
    if (!file.recorded) { this.setData({ state: 'idle', recording: false }); wx.showToast({ title: '分析已结束，未保存录音', icon: 'none' }); return }
    const metrics = this.latestMetrics || { rmsDb: -100, peakDb: -100, peakFrequency: 0, clipped: 0 }
    const now = new Date(); const id = `${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const record = { id, name: `测试 ${now.toLocaleString()}`, createdAt: now.toLocaleString(), mode: this.data.mode, earSide: this.data.earSide, earVerified: this.data.mode === 'headset' ? false : true, source: this.data.source, platform: this.data.profile.platform, model: this.data.profile.model, sampleRate: 2000, originalSampleRate: 48000, fftSize: 2048, duration: file.duration, filePath: file.tempFilePath, fileSize: file.fileSize, interruptedReason: capture.stopReason || 'user', summary: { rmsDb: Number(metrics.rmsDb.toFixed(1)), peakDb: Number(metrics.peakDb.toFixed(1)), peakFrequency: Math.round(metrics.peakFrequency), clipped: metrics.clipped, spectrum: metrics.bins || [] } }
    repo.save(record)
    wx.redirectTo({ url: `/pages/record-detail/index?id=${id}` })
  },
  present(metrics) { return { rms: metrics.rmsDb.toFixed(1), peak: metrics.peakDb.toFixed(1), frequency: metrics.peakFrequency.toFixed(0), clipped: metrics.clipped } },
  setSpectrumAxis(event) {
    const spectrumAxis = event.currentTarget.dataset.axis
    this.setData({ spectrumAxis, spectrumLabel: spectrumAxis === 'log' ? '对数频率轴' : '线性频率轴' }, () => {
      if (this.latestMetrics) this.draw(this.latestMetrics)
    })
  },
  setYScaleMode(event) {
    this.setData({ yScaleMode: event.currentTarget.dataset.mode }, () => {
      if (this.latestMetrics) this.draw(this.latestMetrics)
    })
  },
  setManualMin(event) { this.setData({ manualMin: event.detail.value }) },
  setManualMax(event) { this.setData({ manualMax: event.detail.value }) },
  applyManualRange() {
    const min = Number(this.data.manualMin); const max = Number(this.data.manualMax)
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return wx.showToast({ title: '请输入有效范围：最小值小于最大值', icon: 'none' })
    this.setData({ yScaleMode: 'manual', manualRange: { min, max } }, () => {
      if (this.latestMetrics) this.draw(this.latestMetrics)
    })
  },
  measureChart() {
    wx.createSelectorQuery().in(this).select('#spectrumCanvas').boundingClientRect(rect => {
      if (!rect || !rect.width) return
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : { windowHeight: 700 }
      const width = Math.round(rect.width)
      const height = Math.round(Math.max(250, Math.min(width * .92, windowInfo.windowHeight * .46)))
      this.chartSize = { width, height }
      this.setData({ canvasWidth: width, canvasHeight: height, canvasCssHeight: height }, () => {
        if (this.latestMetrics) this.draw(this.latestMetrics)
      })
    }).exec()
  },
  draw(metrics) { this.drawSpectrum(metrics) },
  drawSpectrum(metrics) {
    const ctx = wx.createCanvasContext('spectrum', this)
    const width = this.chartSize ? this.chartSize.width : this.data.canvasWidth
    const height = this.chartSize ? this.chartSize.height : this.data.canvasHeight
    const fontSize = Math.max(10, Math.min(13, width / 27))
    const values = metrics.spectrum || []; const autoRange = metrics.spectrumRange || { min: -100, max: 0 }
    const range = this.data.yScaleMode === 'manual' ? this.data.manualRange : autoRange; const axis = this.data.spectrumAxis
    const plot = { left: Math.max(48, fontSize * 4), right: width - 10, top: 14, bottom: height - Math.max(38, fontSize * 3.2) }
    const plotWidth = plot.right - plot.left; const plotHeight = plot.bottom - plot.top
    const projectX = frequency => plot.left + (axis === 'log' ? Math.log(frequency / 20) / Math.log(500 / 20) : (frequency - 20) / 480) * plotWidth
    const projectY = db => {
      const clamped = Math.max(range.min, Math.min(range.max, db))
      return Math.max(plot.top + 1, Math.min(plot.bottom - 1, plot.top + (range.max - clamped) / (range.max - range.min) * plotHeight))
    }
    const formatTick = value => {
      const rounded = Math.abs(range.max - range.min) < 10 ? value.toFixed(1) : value.toFixed(0)
      return rounded === '-0' || rounded === '-0.0' ? rounded.slice(1) : rounded
    }
    ctx.setFillStyle('#f9fcff'); ctx.fillRect(0, 0, width, height)
    ctx.setStrokeStyle('#dbe6f3'); ctx.setLineWidth(1)
    ctx.setLineDash([6, 5])
    ctx.setFillStyle('#60718d'); ctx.setFontSize(fontSize)
    for (let i = 0; i <= 5; i++) {
      const y = plot.top + i / 5 * plotHeight; const value = range.max - i / 5 * (range.max - range.min)
      ctx.beginPath(); ctx.moveTo(plot.left, y); ctx.lineTo(plot.right, y); ctx.stroke()
      const label = formatTick(value); ctx.fillText(label, plot.left - label.length * fontSize * .58 - 8, y + fontSize * .35)
    }
    const ticks = axis === 'log' ? [20, 30, 50, 70, 100, 200, 300, 500] : [20, 100, 200, 300, 400, 500]
    ticks.forEach(freq => {
      const x = projectX(freq); ctx.beginPath(); ctx.moveTo(x, plot.top); ctx.lineTo(x, plot.bottom); ctx.stroke()
      const label = String(freq); const labelWidth = label.length * fontSize * .55
      ctx.fillText(label, Math.max(plot.left - 2, Math.min(plot.right - labelWidth, x - labelWidth / 2)), plot.bottom + fontSize * 1.55)
    })
    ctx.setLineDash([]); ctx.setStrokeStyle('#718096'); ctx.setLineWidth(1.5)
    ctx.beginPath(); ctx.moveTo(plot.left, plot.top); ctx.lineTo(plot.left, plot.bottom); ctx.lineTo(plot.right, plot.bottom); ctx.stroke()
    for (let i = 0; i <= 5; i++) { const y = plot.top + i / 5 * plotHeight; ctx.beginPath(); ctx.moveTo(plot.left - 5, y); ctx.lineTo(plot.left, y); ctx.stroke() }
    ticks.forEach(freq => { const x = projectX(freq); ctx.beginPath(); ctx.moveTo(x, plot.bottom); ctx.lineTo(x, plot.bottom + 5); ctx.stroke() })
    ctx.setFontSize(fontSize); ctx.fillText('频率 / Hz', (plot.left + plot.right) / 2 - fontSize * 2.7, height - 5)
    ctx.save(); ctx.translate(fontSize, (plot.top + plot.bottom) / 2 + fontSize * 4.5); ctx.rotate(-Math.PI / 2); ctx.fillText('估计声压级 / dB', 0, 0); ctx.restore()
    if (values.length) {
      ctx.save(); ctx.beginPath(); ctx.rect(plot.left, plot.top, plotWidth, plotHeight); ctx.clip()
      ctx.setStrokeStyle('#7279dc'); ctx.setLineWidth(2.5); ctx.beginPath()
      values.forEach((point, i) => { const x = projectX(point.frequency); const y = projectY(point.db); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
      ctx.stroke(); ctx.restore()
    }
    ctx.draw()
  }
})
