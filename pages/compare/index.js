const repo = require('../../services/recording-repository')
const { getWeightingOffsets, summarizeSpectrum, spectrumRange, valueAt } = require('../../services/weighting')

const MIN_FREQUENCY = 20
const MAX_FREQUENCY = 500
const MAX_SELECTION = 8
const COLORS = ['#6772dc', '#e28a43', '#1fa69d', '#c9566c', '#7d5cbb', '#5b87b2', '#a57830', '#4f9666']
const LOG_TICKS = [20, 30, 50, 70, 100, 200, 300, 500]
const LINEAR_TICKS = [20, 100, 200, 300, 400, 500]
const SPECTRUM_BANDS = [
  { min: 20, max: 60, color: 'rgba(88, 156, 235, .13)' },
  { min: 70, max: 150, color: 'rgba(65, 184, 139, .12)' },
  { min: 160, max: 240, color: 'rgba(241, 164, 74, .13)' }
]

function canCompare(record) {
  return Boolean(record && record.filePath && record.summary && Array.isArray(record.summary.spectrum) && record.summary.spectrum.length)
}

function spectrumMetadata(record) {
  const sampleRate = Number(record.sampleRate) || 2000
  const fftSize = Number(record.fftSize) || 2048
  const binSpacingHz = sampleRate / fftSize
  return {
    binSpacingHz,
    spectrumStartHz: Number(record.spectrumStartHz) || Math.ceil(MIN_FREQUENCY * fftSize / sampleRate) * binSpacingHz
  }
}

Page({
  data: {
    records: [], selectedCount: 0, tableRows: [], warning: '', settingsOpen: false,
    weighting: 'linear', weightingLabel: '线性计权', weightingUnit: 'dB', spectrumAxis: 'log',
    yScaleMode: 'manual', manualMin: '-80', manualMax: '-20', manualRange: { min: -80, max: -20 },
    canvasWidth: 320, canvasHeight: 300, canvasCssHeight: 300
  },
  onLoad(query) { this.initialId = query.first || '' },
  onShow() {
    this.allRecords = repo.list().filter(canCompare)
    const available = this.allRecords.map(record => record.id)
    this.selectedIds = (this.selectedIds || []).filter(id => available.includes(id))
    if (this.initialId && available.includes(this.initialId) && !this.selectedIds.includes(this.initialId)) this.selectedIds.unshift(this.initialId)
    this.initialId = ''
    this.updateView()
  },
  onReady() { this.measureChart() },
  onResize() { wx.nextTick(() => this.measureChart()) },
  toggleSelection(event) {
    const selectedIds = event.detail.value || []
    if (selectedIds.length > MAX_SELECTION) {
      wx.showToast({ title: `最多同时对比 ${MAX_SELECTION} 条录音`, icon: 'none' })
      return this.updateView()
    }
    this.selectedIds = selectedIds
    this.updateView()
  },
  buildSeries() {
    return (this.selectedIds || []).map((id, index) => {
      const record = this.allRecords.find(item => item.id === id)
      if (!record) return null
      const metadata = spectrumMetadata(record)
      const values = record.summary.spectrum
      const storedRmsDb = Number(record.summary.rmsDb)
      const summary = summarizeSpectrum(values, metadata.spectrumStartHz, metadata.binSpacingHz, Number.isFinite(storedRmsDb) ? storedRmsDb : -100, this.data.weighting)
      return {
        id: record.id, name: record.name, color: COLORS[index % COLORS.length], values,
        spectrumStartHz: metadata.spectrumStartHz, binSpacingHz: metadata.binSpacingHz,
        sampleRate: Number(record.sampleRate) || 2000, fftSize: Number(record.fftSize) || 2048,
        averageSeconds: record.averageSeconds,
        averageLabel: record.averageSeconds ? `${record.averageSeconds} 秒` : '旧记录',
        totalLevel: summary.total.toFixed(1)
      }
    }).filter(Boolean)
  },
  updateView() {
    const selected = this.selectedIds || []
    this.series = this.buildSeries()
    let warning = ''
    if (this.series.length > 1) {
      const first = this.series[0]
      const mismatched = this.series.some(item => item.sampleRate !== first.sampleRate || item.fftSize !== first.fftSize || item.averageSeconds !== first.averageSeconds)
      warning = mismatched ? '所选录音的采样率、FFT 或平均时长不完全一致，可叠加观察，但不宜直接比较绝对幅值。' : '这些曲线来自顺序测量，不是同步多通道分析。'
    }
    this.setData({
      records: this.allRecords.map(record => ({ id: record.id, name: record.name, createdAt: record.createdAt, mode: record.mode, selected: selected.includes(record.id), averageLabel: record.averageSeconds ? `${record.averageSeconds} 秒平均` : '平均时长未记录' })),
      selectedCount: this.series.length,
      tableRows: this.series.map(item => ({ id: item.id, name: item.name, color: item.color, averageLabel: item.averageLabel, totalLevel: item.totalLevel })),
      warning
    }, () => this.draw())
  },
  toggleSettings() { this.setData({ settingsOpen: !this.data.settingsOpen }) },
  setWeighting(event) {
    const weighting = event.currentTarget.dataset.weighting
    this.setData(weighting === 'a' ? { weighting, weightingLabel: 'A 计权', weightingUnit: 'dBA' } : { weighting, weightingLabel: '线性计权', weightingUnit: 'dB' }, () => this.updateView())
  },
  setSpectrumAxis(event) { this.setData({ spectrumAxis: event.currentTarget.dataset.axis }, () => this.draw()) },
  setYScaleMode(event) { this.setData({ yScaleMode: event.currentTarget.dataset.mode }, () => this.draw()) },
  setManualMin(event) { this.setData({ manualMin: event.detail.value }) },
  setManualMax(event) { this.setData({ manualMax: event.detail.value }) },
  applyManualRange() {
    const min = Number(this.data.manualMin)
    const max = Number(this.data.manualMax)
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return wx.showToast({ title: '请输入有效范围：最小值小于最大值', icon: 'none' })
    this.setData({ yScaleMode: 'manual', manualRange: { min, max } }, () => this.draw())
  },
  measureChart() {
    wx.createSelectorQuery().in(this).select('#comparisonCanvas').boundingClientRect(rect => {
      if (!rect || !rect.width) return
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : { windowHeight: 700 }
      const width = Math.round(rect.width)
      const height = Math.round(Math.max(260, Math.min(width * .88, windowInfo.windowHeight * .48)))
      this.chartSize = { width, height }
      this.setData({ canvasWidth: width, canvasHeight: height, canvasCssHeight: height }, () => this.draw())
    }).exec()
  },
  drawCurve(ctx, series, offsets, projectX, projectY, plotWidth) {
    const values = series.values
    const groupSize = Math.max(1, Math.ceil(values.length / Math.max(120, Math.floor(plotWidth))))
    ctx.setStrokeStyle(series.color); ctx.setLineWidth(2.2); ctx.beginPath()
    let pointIndex = 0
    for (let start = 0; start < values.length; start += groupSize) {
      const end = Math.min(values.length, start + groupSize)
      let selected = start
      for (let index = start + 1; index < end; index++) if (valueAt(values, offsets, index) > valueAt(values, offsets, selected)) selected = index
      const frequency = series.spectrumStartHz + selected * series.binSpacingHz
      if (frequency < MIN_FREQUENCY || frequency > MAX_FREQUENCY) continue
      const x = projectX(frequency)
      const y = projectY(valueAt(values, offsets, selected))
      if (pointIndex++) ctx.lineTo(x, y); else ctx.moveTo(x, y)
    }
    ctx.stroke()
  },
  draw() {
    const ctx = wx.createCanvasContext('comparison', this)
    const width = this.chartSize ? this.chartSize.width : this.data.canvasWidth
    const height = this.chartSize ? this.chartSize.height : this.data.canvasHeight
    const fontSize = Math.max(10, Math.min(13, width / 27))
    const plotted = (this.series || []).map(series => ({ series, offsets: getWeightingOffsets(series.values.length, series.spectrumStartHz, series.binSpacingHz, this.data.weighting) }))
    const autoRange = spectrumRange(plotted.map(item => ({ values: item.series.values, offsets: item.offsets })))
    const range = this.data.yScaleMode === 'manual' ? this.data.manualRange : autoRange
    const plot = { left: Math.max(48, fontSize * 4), right: width - 10, top: 14, bottom: height - Math.max(38, fontSize * 3.2) }
    const plotWidth = plot.right - plot.left
    const plotHeight = plot.bottom - plot.top
    const projectX = frequency => plot.left + (this.data.spectrumAxis === 'log' ? Math.log(frequency / MIN_FREQUENCY) / Math.log(MAX_FREQUENCY / MIN_FREQUENCY) : (frequency - MIN_FREQUENCY) / (MAX_FREQUENCY - MIN_FREQUENCY)) * plotWidth
    const projectY = db => plot.top + (range.max - Math.max(range.min, Math.min(range.max, db))) / (range.max - range.min) * plotHeight
    ctx.setFillStyle('#edf3fa'); ctx.fillRect(0, 0, width, height)
    ctx.setFillStyle('#f8fbff'); ctx.fillRect(plot.left, plot.top, plotWidth, plotHeight)
    SPECTRUM_BANDS.forEach(band => { ctx.setFillStyle(band.color); ctx.fillRect(projectX(band.min), plot.top, projectX(band.max) - projectX(band.min), plotHeight) })
    ctx.setStrokeStyle('#dbe6f3'); ctx.setLineWidth(1); ctx.setLineDash([6, 5]); ctx.setFillStyle('#60718d'); ctx.setFontSize(fontSize)
    for (let index = 0; index <= 5; index++) {
      const y = plot.top + index / 5 * plotHeight
      const value = range.max - index / 5 * (range.max - range.min)
      const label = Math.abs(range.max - range.min) < 10 ? value.toFixed(1) : value.toFixed(0)
      ctx.beginPath(); ctx.moveTo(plot.left, y); ctx.lineTo(plot.right, y); ctx.stroke(); ctx.fillText(label, plot.left - label.length * fontSize * .58 - 8, y + fontSize * .35)
    }
    const ticks = this.data.spectrumAxis === 'log' ? LOG_TICKS : LINEAR_TICKS
    ticks.forEach(frequency => {
      const x = projectX(frequency); const label = String(frequency); const labelWidth = label.length * fontSize * .55
      ctx.beginPath(); ctx.moveTo(x, plot.top); ctx.lineTo(x, plot.bottom); ctx.stroke(); ctx.fillText(label, Math.max(plot.left - 2, Math.min(plot.right - labelWidth, x - labelWidth / 2)), plot.bottom + fontSize * 1.55)
    })
    ctx.setLineDash([]); ctx.setStrokeStyle('#718096'); ctx.setLineWidth(1.5); ctx.strokeRect(plot.left, plot.top, plotWidth, plotHeight)
    ctx.fillText('频率 / Hz', (plot.left + plot.right) / 2 - fontSize * 2.7, height - 5)
    ctx.save(); ctx.translate(fontSize, (plot.top + plot.bottom) / 2 + fontSize * 4.5); ctx.rotate(-Math.PI / 2); ctx.fillText(`估计声压级 / ${this.data.weightingUnit}`, 0, 0); ctx.restore()
    ctx.save(); ctx.beginPath(); ctx.rect(plot.left, plot.top, plotWidth, plotHeight); ctx.clip()
    plotted.forEach(item => this.drawCurve(ctx, item.series, item.offsets, projectX, projectY, plotWidth))
    ctx.restore(); ctx.draw()
  }
})
