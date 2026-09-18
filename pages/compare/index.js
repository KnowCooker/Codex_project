const repo = require('../../services/recording-repository')
const { getWeightingOffsets, summarizeSpectrum, spectrumRange, valueAt } = require('../../services/weighting')
const { averageSpectrumFromWav } = require('../../services/file-spectrum')

const MIN_FREQUENCY = 20
const ANALYSIS_MAX_FREQUENCY = 1000
const MAX_SELECTION = 8
const COLORS = ['#6772dc', '#e28a43', '#1fa69d', '#c9566c', '#7d5cbb', '#5b87b2', '#a57830', '#4f9666']
const SPECTRUM_BANDS = [
  { min: 20, max: 60, color: 'rgba(88, 156, 235, .13)' },
  { min: 70, max: 150, color: 'rgba(65, 184, 139, .12)' },
  { min: 160, max: 240, color: 'rgba(241, 164, 74, .13)' }
]
function frequencyTicks(axis, minimum, maximum) {
  if (axis === 'log') {
    return Array.from(new Set([minimum, 20, 50, 100, 200, 500, 1000, maximum]
      .filter(value => value >= minimum && value <= maximum))).sort((a, b) => a - b)
  }
  const targetStep = (maximum - minimum) / 5
  const step = [1, 2, 5, 10, 20, 50, 100, 200].find(value => value >= targetStep) || 200
  const ticks = [minimum]
  for (let value = Math.ceil(minimum / step) * step; value < maximum; value += step) if (value > minimum) ticks.push(value)
  if (ticks[ticks.length - 1] !== maximum) ticks.push(maximum)
  return ticks
}
function visibleSeries(values, offsets, startHz, binSpacingHz, minimum, maximum) {
  const first = Math.max(0, Math.ceil((minimum - startHz) / binSpacingHz))
  const end = Math.max(first, Math.min(values.length, Math.floor((maximum - startHz) / binSpacingHz) + 1))
  const slice = source => source && (source.subarray ? source.subarray(first, end) : source.slice(first, end))
  return { values: slice(values), offsets: slice(offsets), count: end - first }
}

function canCompare(record) {
  return Boolean(record && record.filePath && (record.playbackReady || record.fileFormat === 'wav' || /\.wav$/i.test(record.filePath)))
}

Page({
  data: {
    records: [], selectedCount: 0, tableRows: [], warning: '', settingsOpen: false,
    weighting: 'linear', weightingLabel: '线性计权', weightingUnit: 'dB', spectrumAxis: 'log', minFrequency: 20, maxFrequency: 500,
    frequencyMinInput: '20', frequencyMaxInput: '500',
    yScaleMode: 'manual', manualMin: '-80', manualMax: '-20', manualRange: { min: -80, max: -20 },
    loading: false, analysisProgress: 0, analysisMessage: '', analysisErrors: '',
    canvasWidth: 320, canvasHeight: 300, canvasCssHeight: 300
  },
  onLoad(query) { this.initialId = query.first || ''; this.spectrumCache = {}; this.analysisErrors = {}; this.analysisToken = 0 },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ selected: 2 })
    const app = getApp()
    if (app.globalData.compareFirstId) {
      this.initialId = app.globalData.compareFirstId
      app.globalData.compareFirstId = ''
    }
    this.allRecords = repo.list().filter(canCompare)
    const available = this.allRecords.map(record => record.id)
    this.selectedIds = (this.selectedIds || []).filter(id => available.includes(id))
    if (this.initialId && available.includes(this.initialId) && !this.selectedIds.includes(this.initialId)) this.selectedIds.unshift(this.initialId)
    this.initialId = ''
    this.updateView()
    this.loadSelectedSpectra()
  },
  onReady() { this.measureChart() },
  onResize() { wx.nextTick(() => this.measureChart()) },
  onHide() { this.analysisToken = (Number.isFinite(this.analysisToken) ? this.analysisToken : 0) + 1 },
  toggleSelection(event) {
    const selectedIds = event.detail.value || []
    if (selectedIds.length > MAX_SELECTION) {
      wx.showToast({ title: `最多同时对比 ${MAX_SELECTION} 条录音`, icon: 'none' })
      return this.updateView()
    }
    this.selectedIds = selectedIds
    this.updateView()
    this.loadSelectedSpectra()
  },
  buildSeries() {
    return (this.selectedIds || []).map((id, index) => {
      const record = this.allRecords.find(item => item.id === id)
      const average = record && this.spectrumCache[id]
      if (!record || !average || average.filePath !== record.filePath || average.fileSize !== record.fileSize) return null
      const values = average.values
      const calibrationDb = repo.recordCalibrationDb(record)
      const summary = summarizeSpectrum(values, average.spectrumStartHz, average.binSpacingHz, average.rmsDb, this.data.weighting, calibrationDb)
      return {
        id: record.id, name: record.name, color: COLORS[index % COLORS.length], values,
        spectrumStartHz: average.spectrumStartHz, binSpacingHz: average.binSpacingHz,
        wavSampleRate: repo.wavSampleRate(record), sampleRateLabel: `${repo.wavSampleRate(record)} Hz`, calibrationDb, calibrationLabel: `${calibrationDb > 0 ? '+' : ''}${calibrationDb.toFixed(1)} dB`, frameCount: average.frameCount,
        maxAvailableFrequency: average.spectrumStartHz + (values.length - 1) * average.binSpacingHz,
        totalLevel: summary.total.toFixed(1)
      }
    }).filter(Boolean)
  },
  async loadSelectedSpectra() {
    const token = this.analysisToken = (Number.isFinite(this.analysisToken) ? this.analysisToken : 0) + 1
    const selected = (this.selectedIds || []).slice()
    Object.keys(this.analysisErrors).forEach(id => { if (!selected.includes(id)) delete this.analysisErrors[id] })
    const pending = selected.map(id => this.allRecords.find(item => item.id === id)).filter(record => record && (!this.spectrumCache[record.id] || this.spectrumCache[record.id].filePath !== record.filePath || this.spectrumCache[record.id].fileSize !== record.fileSize))
    if (!pending.length) {
      this.setData({ loading: false, analysisMessage: '', analysisErrors: Object.values(this.analysisErrors).join('；') })
      return
    }
    this.setData({ loading: true, analysisProgress: 1, analysisMessage: '正在读取 WAV 文件头…' })
    for (let index = 0; index < pending.length; index++) {
      if (token !== this.analysisToken) return
      const record = pending[index]
      try {
        const average = await averageSpectrumFromWav(record.filePath, { onProgress: progress => {
          if (token === this.analysisToken) this.setData({ analysisProgress: Math.round((index + progress / 100) / pending.length * 100), analysisMessage: `正在分析 ${record.name}` })
        } })
        if (token !== this.analysisToken) return
        this.spectrumCache[record.id] = Object.assign(average, { filePath: record.filePath, fileSize: record.fileSize })
        delete this.analysisErrors[record.id]
      } catch (error) {
        if (token !== this.analysisToken) return
        this.analysisErrors[record.id] = `${record.name}：${error.errMsg || error.message || '分析失败'}`
      }
      if (token === this.analysisToken) this.updateView()
    }
    if (token === this.analysisToken) this.setData({ loading: false, analysisProgress: 100, analysisMessage: '', analysisErrors: Object.values(this.analysisErrors).join('；') })
  },
  updateView() {
    const selected = this.selectedIds || []
    this.series = this.buildSeries()
    const selectedRecords = selected.map(id => this.allRecords.find(record => record.id === id)).filter(Boolean)
    const calibrations = selectedRecords.map(repo.recordCalibrationDb)
    const defaultRange = calibrations.length ? { min: -80 + Math.min(...calibrations), max: -20 + Math.max(...calibrations) } : { min: -80, max: -20 }
    let warning = ''
    if (this.series.length > 1) {
      warning = '所有曲线均由完整 WAV 重新分帧计算；这些录音是顺序测量，不是同步多通道分析。'
    }
    if (this.series.some(item => item.spectrumStartHz - item.binSpacingHz * 1.1 > this.data.minFrequency || item.maxAvailableFrequency + item.binSpacingHz * 1.1 < this.data.maxFrequency)) warning += `${warning ? ' ' : ''}部分旧录音没有覆盖当前横轴的全部频率范围。`
    const rangeUpdates = this.manualRangeCustomized ? {} : { manualRange: defaultRange, manualMin: String(defaultRange.min), manualMax: String(defaultRange.max) }
    this.setData({
      records: this.allRecords.map(record => { const calibrationDb = repo.recordCalibrationDb(record); return { id: record.id, name: record.name, createdAt: record.createdAt, mode: record.mode, selected: selected.includes(record.id), sampleRateLabel: `WAV ${repo.wavSampleRate(record)} Hz`, calibrationLabel: `${calibrationDb > 0 ? '+' : ''}${calibrationDb.toFixed(1)} dB` } }),
      selectedCount: selected.length,
      tableRows: this.series.map(item => ({ id: item.id, name: item.name, color: item.color, sampleRateLabel: item.sampleRateLabel, calibrationLabel: item.calibrationLabel, totalLevel: item.totalLevel })),
      warning,
      ...rangeUpdates
    }, () => this.draw())
  },
  toggleSettings() { this.setData({ settingsOpen: !this.data.settingsOpen }) },
  setWeighting(event) {
    const weighting = event.currentTarget.dataset.weighting
    this.setData(weighting === 'a' ? { weighting, weightingLabel: 'A 计权', weightingUnit: 'dBA' } : { weighting, weightingLabel: '线性计权', weightingUnit: 'dB' }, () => this.updateView())
  },
  setSpectrumAxis(event) { this.setData({ spectrumAxis: event.currentTarget.dataset.axis }, () => this.draw()) },
  setFrequencyMinInput(event) { this.setData({ frequencyMinInput: event.detail.value }) },
  setFrequencyMaxInput(event) { this.setData({ frequencyMaxInput: event.detail.value }) },
  applyFrequencyRange() {
    const minFrequency = Math.round(Number(this.data.frequencyMinInput))
    const maxFrequency = Math.round(Number(this.data.frequencyMaxInput))
    if (!Number.isFinite(minFrequency) || !Number.isFinite(maxFrequency) || minFrequency < MIN_FREQUENCY || maxFrequency > ANALYSIS_MAX_FREQUENCY || minFrequency >= maxFrequency) {
      return wx.showToast({ title: '请输入 20–1000 Hz 内的有效范围', icon: 'none' })
    }
    this.setData({ minFrequency, maxFrequency, frequencyMinInput: String(minFrequency), frequencyMaxInput: String(maxFrequency) }, () => this.updateView())
  },
  setYScaleMode(event) { this.setData({ yScaleMode: event.currentTarget.dataset.mode }, () => this.draw()) },
  setManualMin(event) { this.setData({ manualMin: event.detail.value }) },
  setManualMax(event) { this.setData({ manualMax: event.detail.value }) },
  applyManualRange() {
    const min = Number(this.data.manualMin)
    const max = Number(this.data.manualMax)
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return wx.showToast({ title: '请输入有效范围：最小值小于最大值', icon: 'none' })
    this.manualRangeCustomized = true
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
  drawCurve(ctx, series, offsets, minimum, maximum, projectX, projectY, plotWidth) {
    const values = series.values
    const firstIndex = Math.max(0, Math.ceil((minimum - series.spectrumStartHz) / series.binSpacingHz))
    const endIndex = Math.max(firstIndex, Math.min(values.length, Math.floor((maximum - series.spectrumStartHz) / series.binSpacingHz) + 1))
    const visibleLength = endIndex - firstIndex
    const groupSize = Math.max(1, Math.ceil(visibleLength / Math.max(120, Math.floor(plotWidth))))
    ctx.setStrokeStyle(series.color); ctx.setLineWidth(2.2); ctx.beginPath()
    let pointIndex = 0
    for (let start = firstIndex; start < endIndex; start += groupSize) {
      const end = Math.min(endIndex, start + groupSize)
      let selected = start
      for (let index = start + 1; index < end; index++) if (valueAt(values, offsets, index) > valueAt(values, offsets, selected)) selected = index
      const frequency = series.spectrumStartHz + selected * series.binSpacingHz
      if (frequency < minimum || frequency > maximum) continue
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
    const minFrequency = this.data.minFrequency
    const maxFrequency = this.data.maxFrequency
    const fontSize = Math.max(10, Math.min(13, width / 27))
    const plotted = (this.series || []).map(series => ({ series, offsets: getWeightingOffsets(series.values.length, series.spectrumStartHz, series.binSpacingHz, this.data.weighting, series.calibrationDb) }))
    const range = this.data.yScaleMode === 'manual' ? this.data.manualRange : spectrumRange(plotted.map(item => visibleSeries(item.series.values, item.offsets, item.series.spectrumStartHz, item.series.binSpacingHz, minFrequency, maxFrequency)))
    const plot = { left: Math.max(48, fontSize * 4), right: width - 10, top: 14, bottom: height - Math.max(38, fontSize * 3.2) }
    const plotWidth = plot.right - plot.left
    const plotHeight = plot.bottom - plot.top
    const projectX = frequency => plot.left + (this.data.spectrumAxis === 'log' ? Math.log(frequency / minFrequency) / Math.log(maxFrequency / minFrequency) : (frequency - minFrequency) / (maxFrequency - minFrequency)) * plotWidth
    const projectY = db => plot.top + (range.max - Math.max(range.min, Math.min(range.max, db))) / (range.max - range.min) * plotHeight
    ctx.setFillStyle('#edf3fa'); ctx.fillRect(0, 0, width, height)
    ctx.setFillStyle('#f8fbff'); ctx.fillRect(plot.left, plot.top, plotWidth, plotHeight)
    SPECTRUM_BANDS.forEach(band => {
      const bandMin = Math.max(band.min, minFrequency); const bandMax = Math.min(band.max, maxFrequency)
      if (bandMin >= bandMax) return
      ctx.setFillStyle(band.color); ctx.fillRect(projectX(bandMin), plot.top, projectX(bandMax) - projectX(bandMin), plotHeight)
    })
    ctx.setStrokeStyle('#dbe6f3'); ctx.setLineWidth(1); ctx.setLineDash([6, 5]); ctx.setFillStyle('#60718d'); ctx.setFontSize(fontSize)
    for (let index = 0; index <= 5; index++) {
      const y = plot.top + index / 5 * plotHeight
      const value = range.max - index / 5 * (range.max - range.min)
      const label = Math.abs(range.max - range.min) < 10 ? value.toFixed(1) : value.toFixed(0)
      ctx.beginPath(); ctx.moveTo(plot.left, y); ctx.lineTo(plot.right, y); ctx.stroke(); ctx.fillText(label, plot.left - label.length * fontSize * .58 - 8, y + fontSize * .35)
    }
    const ticks = frequencyTicks(this.data.spectrumAxis, minFrequency, maxFrequency)
    ticks.forEach(frequency => {
      const x = projectX(frequency); const label = String(frequency); const labelWidth = label.length * fontSize * .55
      ctx.beginPath(); ctx.moveTo(x, plot.top); ctx.lineTo(x, plot.bottom); ctx.stroke(); ctx.fillText(label, Math.max(plot.left - 2, Math.min(plot.right - labelWidth, x - labelWidth / 2)), plot.bottom + fontSize * 1.55)
    })
    ctx.setLineDash([]); ctx.setStrokeStyle('#718096'); ctx.setLineWidth(1.5); ctx.strokeRect(plot.left, plot.top, plotWidth, plotHeight)
    ctx.fillText('频率 / Hz', (plot.left + plot.right) / 2 - fontSize * 2.7, height - 5)
    ctx.save(); ctx.translate(fontSize, (plot.top + plot.bottom) / 2 + fontSize * 4.5); ctx.rotate(-Math.PI / 2); ctx.fillText(`估计声压级 / ${this.data.weightingUnit}`, 0, 0); ctx.restore()
    ctx.save(); ctx.beginPath(); ctx.rect(plot.left, plot.top, plotWidth, plotHeight); ctx.clip()
    plotted.forEach(item => this.drawCurve(ctx, item.series, item.offsets, minFrequency, maxFrequency, projectX, projectY, plotWidth))
    ctx.restore(); ctx.draw()
  }
})
