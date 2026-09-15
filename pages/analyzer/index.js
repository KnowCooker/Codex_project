const { CaptureService, STATES } = require('../../services/capture-service')
const { getSystemProfile, requestedAudioSource } = require('../../services/compatibility')
const repo = require('../../services/recording-repository')
const { getWeightingOffsets, summarizeSpectrum, spectrumRange, valueAt } = require('../../services/weighting')
const { averageSpectrumFromWav } = require('../../services/file-spectrum')

let capture
const SPECTRUM_BANDS = [
  { min: 20, max: 60, color: 'rgba(88, 156, 235, .13)' },
  { min: 70, max: 150, color: 'rgba(65, 184, 139, .12)' },
  { min: 160, max: 240, color: 'rgba(241, 164, 74, .13)' }
]
function frequencyTicks(axis, maximum) {
  if (axis === 'log') {
    const ticks = [20, 50, 100, 200, 500, 1000].filter(value => value <= maximum)
    if (ticks[ticks.length - 1] !== maximum) ticks.push(maximum)
    return ticks
  }
  const targetStep = (maximum - 20) / 5
  const step = [20, 50, 100, 200].find(value => value >= targetStep) || 200
  const ticks = [20]
  for (let value = Math.ceil(20 / step) * step; value < maximum; value += step) if (value > 20) ticks.push(value)
  if (ticks[ticks.length - 1] !== maximum) ticks.push(maximum)
  return ticks
}
function visibleSeries(values, offsets, startHz, binSpacingHz, maximum) {
  const count = Math.max(0, Math.min(values.length, Math.floor((maximum - startHz) / binSpacingHz) + 1))
  const slice = source => source && (source.subarray ? source.subarray(0, count) : source.slice(0, count))
  return { values: slice(values), offsets: slice(offsets), count }
}
function recordingChoices() {
  return repo.list().filter(item => item.filePath && (item.playbackReady || item.fileFormat === 'wav' || /\.wav$/i.test(item.filePath))).map(item => ({
    id: item.id,
    name: item.name,
    createdAt: item.createdAt,
    mode: item.mode,
    filePath: item.filePath,
    durationLabel: `${(Math.max(0, item.duration || 0) / 1000).toFixed(1)} 秒`,
    fileSizeLabel: item.fileSize ? `${(item.fileSize / 1024 / 1024).toFixed(2)} MB` : '大小未知'
  }))
}
Page({
  data: { mode: 'phone', earSide: 'auto', source: 'mic', state: 'idle', elapsed: '00:00', recordingElapsed: '00:00.0', recordingProgress: 0, recording: false, recordingFinalizing: false, metrics: null, error: '', warning: '', hasData: false, hasReference: false, referenceTime: '', referenceMetricView: null, weighting: 'linear', weightingLabel: '线性计权', weightingUnit: 'dB', spectrumAxis: 'log', spectrumLabel: '对数频率轴', maxFrequency: 500, yScaleMode: 'manual', manualMin: '-80', manualMax: '-20', manualRange: { min: -80, max: -20 }, averageSeconds: 3, settingsOpen: false, canvasWidth: 320, canvasHeight: 300, canvasCssHeight: 300, recordings: [], referencePickerOpen: false, referenceLoading: false, referenceProgress: 0, referenceImportError: '' },
  onLoad(query) {
    const profile = getSystemProfile(); const mode = query.mode || 'phone'; const earSide = query.earSide || 'auto'
    this.setData({ mode, earSide, source: query.source || requestedAudioSource(mode, profile.platform), profile, recordings: recordingChoices(), warning: mode === 'headset' ? '耳机输入为“未验证”。AirPods 的语音降噪会压低环境声；断开或路由中断时测试将立即停止。' : '' })
    if (!capture) capture = new CaptureService()
    capture.on({
      data: metrics => {
        this.latestMetrics = metrics
        const now = Date.now()
        if (!this.data.hasData || now - (this.lastMetricUpdateAt || 0) >= 160) {
          this.lastMetricUpdateAt = now
          this.setData({ metricView: this.present(metrics), hasData: true })
        }
        this.draw(metrics)
      },
      state: (state, options = {}) => {
        if (state === STATES.PAUSED) this.pendingDrawMetrics = null
        if (options.recording && !this.data.recording) { this.recordingStartedAt = Date.now(); this.recordingStoppedAt = 0 }
        if (options.finalizing) this.recordingStoppedAt = Date.now()
        if (!options.recording) { this.recordingStartedAt = 0; this.recordingStoppedAt = 0 }
        this.setData({ state, recording: Boolean(options.recording), recordingFinalizing: Boolean(options.finalizing) }, () => this.tick())
      },
      routeLost: message => this.setData({ error: message }),
      error: error => this.setData({ error, state: 'idle', recording: false, recordingFinalizing: false }), stop: file => this.complete(file)
    })
    capture.setAverageDuration(this.data.averageSeconds)
    this.start()
  },
  onReady() { this.measureChart() },
  onResize() { wx.nextTick(() => this.measureChart()) },
  onUnload() { if (capture) capture.stop('page-hide'); clearInterval(this.timer) },
  onHide() { if (capture && [STATES.ANALYSING, STATES.PAUSED].includes(this.data.state)) capture.stop('page-hidden') },
  async start() {
    try {
      this.setData({ error: '', state: 'requesting' })
      await capture.start({ mode: this.data.mode, platform: this.data.profile.platform, earSide: this.data.earSide, recording: false })
      this.startedAt = Date.now(); this.timer = setInterval(() => this.tick(), 200)
    } catch (error) { this.setData({ error: '无法开始录音：' + (error.errMsg || error.message || '请检查麦克风权限'), state: 'idle' }) }
  },
  tick() {
    const seconds = Math.floor((Date.now() - this.startedAt) / 1000)
    const format = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
    const recordingEndAt = this.data.recordingFinalizing && this.recordingStoppedAt ? this.recordingStoppedAt : Date.now()
    const recordingMs = this.data.recording && this.recordingStartedAt ? Math.min(30000, recordingEndAt - this.recordingStartedAt) : 0
    const recordingSeconds = Math.floor(recordingMs / 1000)
    const recordingElapsed = `${format(recordingSeconds)}.${Math.floor(recordingMs % 1000 / 100)}`
    this.setData({ elapsed: format(seconds), recordingElapsed, recordingProgress: Number((recordingMs / 300).toFixed(1)) })
  },
  togglePause() {
    if (this.data.state === STATES.ANALYSING) { this.pendingDrawMetrics = null; capture.pause() }
    else if (this.data.state === STATES.PAUSED) capture.resume()
  },
  startRecording() { if (!this.data.recording && this.data.state === STATES.ANALYSING) { wx.showToast({ title: '开始新的 30 秒录音片段', icon: 'none' }); capture.startRecording() } },
  stopRecording() { if (this.data.recording) capture.stop('recording-user') },
  stopAnalysis() { clearInterval(this.timer); capture.stop('user') },
  complete(file) {
    clearInterval(this.timer)
    if (!file.recorded) {
      this.setData({ state: 'idle', recording: false, recordingFinalizing: false })
      wx.showToast({ title: file.stopReason === 'headset-route-lost' ? '耳机已断开，分析已停止' : '分析已结束，未保存录音', icon: 'none' })
      return
    }
    const metrics = this.latestMetrics || { rmsDb: -100, peakDb: -100, peakFrequency: 0, clipped: 0 }
    const weightedSummary = metrics.spectrumDb ? summarizeSpectrum(metrics.spectrumDb, metrics.spectrumStartHz, metrics.binSpacingHz, metrics.rmsDb, this.data.weighting) : { total: metrics.rmsDb, low: -100, mid: -100, high: -100 }
    const now = new Date(); const id = `${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const record = { id, name: `测试 ${now.toLocaleString()}`, notes: '', tags: [], createdAt: now.toLocaleString(), mode: this.data.mode, earSide: this.data.earSide, earVerified: this.data.mode === 'headset' ? false : true, source: this.data.source, platform: this.data.profile.platform, model: this.data.profile.model, sampleRate: metrics.sampleRate || 4000, originalSampleRate: 48000, fftSize: metrics.fftSize || 4096, spectrumStartHz: metrics.spectrumStartHz, binSpacingHz: metrics.binSpacingHz, averageSeconds: this.data.averageSeconds, duration: file.duration, filePath: file.tempFilePath, fileSize: file.fileSize, fileFormat: file.fileFormat, playbackReady: file.playbackReady, conversionError: file.conversionError, interruptedReason: file.stopReason || 'user', weighting: this.data.weighting, weightingUnit: this.data.weightingUnit, summary: { rmsDb: Number(metrics.rmsDb.toFixed(1)), peakDb: Number(metrics.peakDb.toFixed(1)), peakFrequency: Math.round(metrics.peakFrequency), clipped: metrics.clipped, totalLevel: Number(weightedSummary.total.toFixed(1)), lowPeak: Number(weightedSummary.low.toFixed(1)), midPeak: Number(weightedSummary.mid.toFixed(1)), highPeak: Number(weightedSummary.high.toFixed(1)), spectrum: Array.from(metrics.spectrumDb || []) } }
    repo.save(record)
    this.setData({ state: 'idle', recording: false, recordingFinalizing: false, recordings: recordingChoices() })
    wx.showToast({ title: '录音已保存', icon: 'success', duration: 2000 })
    if (file.stopReason === 'recording-user' || file.stopReason === 'recording-max') this.start()
  },
  present(metrics) {
    return this.presentSpectrum(metrics.spectrumDb || [], metrics.spectrumStartHz || 20, metrics.binSpacingHz || 1, metrics.rmsDb)
  },
  presentSpectrum(values, startHz, binSpacingHz, rmsDb) {
    const summary = summarizeSpectrum(values, startHz, binSpacingHz, rmsDb, this.data.weighting)
    return { total: summary.total.toFixed(1), low: summary.low.toFixed(1), mid: summary.mid.toFixed(1), high: summary.high.toFixed(1) }
  },
  setWeighting(event) {
    const weighting = event.currentTarget.dataset.weighting
    const updates = weighting === 'a' ? { weighting, weightingLabel: 'A 计权', weightingUnit: 'dBA' } : { weighting, weightingLabel: '线性计权', weightingUnit: 'dB' }
    this.setData(updates, () => {
      const metricUpdates = {}
      if (this.latestMetrics) metricUpdates.metricView = this.present(this.latestMetrics)
      if (this.referenceSpectrum) metricUpdates.referenceMetricView = this.presentSpectrum(this.referenceSpectrum.values, this.referenceSpectrum.startHz, this.referenceSpectrum.binSpacingHz, this.referenceSpectrum.rmsDb)
      this.setData(metricUpdates)
      if (this.latestMetrics) this.draw(this.latestMetrics)
    })
  },
  setSpectrumAxis(event) {
    const spectrumAxis = event.currentTarget.dataset.axis
    this.setData({ spectrumAxis, spectrumLabel: spectrumAxis === 'log' ? '对数频率轴' : '线性频率轴' }, () => {
      if (this.latestMetrics) this.draw(this.latestMetrics)
    })
  },
  setMaxFrequency(event) {
    const maxFrequency = Math.max(100, Math.min(1000, Math.round(Number(event.detail.value) || 500)))
    this.setData({ maxFrequency }, () => { if (this.latestMetrics) this.draw(this.latestMetrics) })
  },
  toggleSettings() { this.setData({ settingsOpen: !this.data.settingsOpen }) },
  setAverageDuration(event) {
    const averageSeconds = Math.max(1, Math.min(30, Math.round(Number(event.detail.value) || 3)))
    capture.setAverageDuration(averageSeconds)
    this.setData({ averageSeconds })
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
  setReference() {
    const metrics = this.latestMetrics
    if (!metrics || !metrics.spectrumDb || !metrics.spectrumDb.length) return wx.showToast({ title: '等待频谱数据后再设置参考', icon: 'none' })
    this.referenceSpectrum = {
      values: new Float32Array(metrics.spectrumDb),
      startHz: metrics.spectrumStartHz,
      binSpacingHz: metrics.binSpacingHz,
      rmsDb: metrics.rmsDb
    }
    const now = new Date()
    const referenceTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    const referenceMetricView = this.presentSpectrum(this.referenceSpectrum.values, this.referenceSpectrum.startHz, this.referenceSpectrum.binSpacingHz, this.referenceSpectrum.rmsDb)
    this.setData({ hasReference: true, referenceTime, referenceMetricView }, () => this.draw(metrics))
  },
  clearReference() {
    this.referenceSpectrum = null
    this.setData({ hasReference: false, referenceTime: '', referenceMetricView: null }, () => {
      if (this.latestMetrics) this.draw(this.latestMetrics)
    })
  },
  openReferencePicker() {
    if (this.data.recording) return wx.showToast({ title: '请先结束录音', icon: 'none' })
    const recordings = recordingChoices()
    if (!recordings.length) return wx.showToast({ title: '暂无可用的 WAV 录音', icon: 'none' })
    this.setData({ recordings, referencePickerOpen: true, referenceImportError: '', referenceProgress: 0 })
  },
  closeReferencePicker() {
    if (!this.data.referenceLoading) this.setData({ referencePickerOpen: false, referenceImportError: '' }, () => {
      if (this.latestMetrics) wx.nextTick(() => this.draw(this.latestMetrics))
    })
  },
  keepReferencePickerOpen() {},
  async selectReferenceFile(event) {
    if (this.data.referenceLoading) return
    const record = this.data.recordings.find(item => item.id === event.currentTarget.dataset.id)
    if (!record) return
    const resumeAfterImport = this.data.state === STATES.ANALYSING
    if (resumeAfterImport) capture.pause()
    this.setData({ referenceLoading: true, referenceProgress: 0, referenceImportError: '' })
    try {
      const average = await averageSpectrumFromWav(record.filePath, { onProgress: referenceProgress => this.setData({ referenceProgress }) })
      this.referenceSpectrum = { values: average.values, startHz: average.spectrumStartHz, binSpacingHz: average.binSpacingHz, rmsDb: average.rmsDb }
      const referenceMetricView = this.presentSpectrum(average.values, average.spectrumStartHz, average.binSpacingHz, average.rmsDb)
      this.setData({ hasReference: true, referenceTime: `文件：${record.name}`, referenceMetricView, referencePickerOpen: false, referenceLoading: false, referenceProgress: 100 }, () => {
        if (this.latestMetrics) wx.nextTick(() => this.draw(this.latestMetrics))
      })
    } catch (error) {
      this.setData({ referenceLoading: false, referenceImportError: error.errMsg || error.message || '无法计算录音平均频谱' })
    }
    if (resumeAfterImport && this.data.state === STATES.PAUSED) capture.resume()
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
  draw(metrics) {
    this.pendingDrawMetrics = metrics
    if (!this.drawInFlight) this.flushSpectrumDraw()
  },
  flushSpectrumDraw() {
    const metrics = this.pendingDrawMetrics
    if (!metrics) return
    this.pendingDrawMetrics = null; this.drawInFlight = true
    this.drawSpectrum(metrics, () => {
      this.drawInFlight = false
      if (this.pendingDrawMetrics) wx.nextTick(() => this.flushSpectrumDraw())
    })
  },
  drawCurve(ctx, values, offsets, startHz, binSpacingHz, maxFrequency, projectX, projectY, plotWidth, color, dashed) {
    if (!values || !values.length) return
    // At most one representative peak per horizontal pixel. This preserves narrow
    // spectral peaks while avoiding hundreds of redundant canvas commands.
    const visibleLength = Math.max(0, Math.min(values.length, Math.floor((maxFrequency - startHz) / binSpacingHz) + 1))
    const groupSize = Math.max(1, Math.ceil(visibleLength / Math.max(120, Math.floor(plotWidth))))
    ctx.setStrokeStyle(color); ctx.setLineWidth(dashed ? 2 : 2.5); ctx.setLineDash(dashed ? [7, 5] : []); ctx.beginPath()
    let pointIndex = 0
    for (let start = 0; start < visibleLength; start += groupSize) {
      const end = Math.min(visibleLength, start + groupSize)
      let selected = start
      for (let index = start + 1; index < end; index++) if (valueAt(values, offsets, index) > valueAt(values, offsets, selected)) selected = index
      const x = projectX(startHz + selected * binSpacingHz)
      const y = projectY(valueAt(values, offsets, selected))
      if (pointIndex++) ctx.lineTo(x, y); else ctx.moveTo(x, y)
    }
    ctx.stroke(); ctx.setLineDash([])
  },
  drawSpectrum(metrics, onComplete) {
    const ctx = wx.createCanvasContext('spectrum', this)
    const width = this.chartSize ? this.chartSize.width : this.data.canvasWidth
    const height = this.chartSize ? this.chartSize.height : this.data.canvasHeight
    const fontSize = Math.max(10, Math.min(13, width / 27))
    const values = metrics.spectrumDb || []
    const maxFrequency = this.data.maxFrequency
    const liveOffsets = getWeightingOffsets(values.length, metrics.spectrumStartHz || 20, metrics.binSpacingHz || 1, this.data.weighting)
    const referenceOffsets = this.referenceSpectrum ? getWeightingOffsets(this.referenceSpectrum.values.length, this.referenceSpectrum.startHz, this.referenceSpectrum.binSpacingHz, this.data.weighting) : null
    const liveVisible = visibleSeries(values, liveOffsets, metrics.spectrumStartHz || 20, metrics.binSpacingHz || 1, maxFrequency)
    const referenceVisible = this.referenceSpectrum && visibleSeries(this.referenceSpectrum.values, referenceOffsets, this.referenceSpectrum.startHz, this.referenceSpectrum.binSpacingHz, maxFrequency)
    const autoRange = spectrumRange([liveVisible, referenceVisible])
    const range = this.data.yScaleMode === 'manual' ? this.data.manualRange : autoRange; const axis = this.data.spectrumAxis
    const plot = { left: Math.max(48, fontSize * 4), right: width - 10, top: 14, bottom: height - Math.max(38, fontSize * 3.2) }
    const plotWidth = plot.right - plot.left; const plotHeight = plot.bottom - plot.top
    const projectX = frequency => plot.left + (axis === 'log' ? Math.log(frequency / 20) / Math.log(maxFrequency / 20) : (frequency - 20) / (maxFrequency - 20)) * plotWidth
    const projectY = db => {
      const clamped = Math.max(range.min, Math.min(range.max, db))
      return Math.max(plot.top + 1, Math.min(plot.bottom - 1, plot.top + (range.max - clamped) / (range.max - range.min) * plotHeight))
    }
    const formatTick = value => {
      const rounded = Math.abs(range.max - range.min) < 10 ? value.toFixed(1) : value.toFixed(0)
      return rounded === '-0' || rounded === '-0.0' ? rounded.slice(1) : rounded
    }
    ctx.setFillStyle('#edf3fa'); ctx.fillRect(0, 0, width, height)
    ctx.setFillStyle('#f8fbff'); ctx.fillRect(plot.left, plot.top, plotWidth, plotHeight)
    for (let index = 0; index < SPECTRUM_BANDS.length; index++) {
      const band = SPECTRUM_BANDS[index]
      if (band.min >= maxFrequency) continue
      const left = projectX(band.min); const right = projectX(Math.min(band.max, maxFrequency))
      ctx.setFillStyle(band.color); ctx.fillRect(left, plot.top, right - left, plotHeight)
    }
    ctx.setStrokeStyle('#dbe6f3'); ctx.setLineWidth(1)
    ctx.setLineDash([6, 5])
    ctx.setFillStyle('#60718d'); ctx.setFontSize(fontSize)
    for (let i = 0; i <= 5; i++) {
      const y = plot.top + i / 5 * plotHeight; const value = range.max - i / 5 * (range.max - range.min)
      ctx.beginPath(); ctx.moveTo(plot.left, y); ctx.lineTo(plot.right, y); ctx.stroke()
      const label = formatTick(value); ctx.fillText(label, plot.left - label.length * fontSize * .58 - 8, y + fontSize * .35)
    }
    const ticks = frequencyTicks(axis, maxFrequency)
    for (let index = 0; index < ticks.length; index++) {
      const freq = ticks[index]
      const x = projectX(freq); ctx.beginPath(); ctx.moveTo(x, plot.top); ctx.lineTo(x, plot.bottom); ctx.stroke()
      const label = String(freq); const labelWidth = label.length * fontSize * .55
      ctx.fillText(label, Math.max(plot.left - 2, Math.min(plot.right - labelWidth, x - labelWidth / 2)), plot.bottom + fontSize * 1.55)
    }
    ctx.setLineDash([]); ctx.setStrokeStyle('#718096'); ctx.setLineWidth(1.5)
    ctx.strokeRect(plot.left, plot.top, plotWidth, plotHeight)
    for (let i = 0; i <= 5; i++) { const y = plot.top + i / 5 * plotHeight; ctx.beginPath(); ctx.moveTo(plot.left - 5, y); ctx.lineTo(plot.left, y); ctx.stroke() }
    for (let index = 0; index < ticks.length; index++) { const x = projectX(ticks[index]); ctx.beginPath(); ctx.moveTo(x, plot.bottom); ctx.lineTo(x, plot.bottom + 5); ctx.stroke() }
    ctx.setFontSize(fontSize); ctx.fillText('频率 / Hz', (plot.left + plot.right) / 2 - fontSize * 2.7, height - 5)
    ctx.save(); ctx.translate(fontSize, (plot.top + plot.bottom) / 2 + fontSize * 4.5); ctx.rotate(-Math.PI / 2); ctx.fillText(`估计声压级 / ${this.data.weightingUnit}`, 0, 0); ctx.restore()
    if (values.length || this.referenceSpectrum) {
      ctx.save(); ctx.beginPath(); ctx.rect(plot.left, plot.top, plotWidth, plotHeight); ctx.clip()
      if (this.referenceSpectrum) this.drawCurve(ctx, this.referenceSpectrum.values, referenceOffsets, this.referenceSpectrum.startHz, this.referenceSpectrum.binSpacingHz, maxFrequency, projectX, projectY, plotWidth, '#e28a43', true)
      this.drawCurve(ctx, values, liveOffsets, metrics.spectrumStartHz || 20, metrics.binSpacingHz || 1, maxFrequency, projectX, projectY, plotWidth, '#6772dc', false)
      ctx.restore()
    }
    ctx.draw(false, onComplete)
  }
})
