const repo = require('../../services/recording-repository')

function signedDb(value) {
  const number = Number(value) || 0
  return `${number > 0 ? '+' : ''}${number.toFixed(1)} dB`
}

Page({
  data: { record: null, fileMessage: '', formatLabel: 'WAV' },
  onLoad(query) { this.id = query.id; this.load() },
  load() {
    const stored = repo.get(this.id)
    const isWav = Boolean(stored && (stored.fileFormat === 'wav' || /\.wav$/i.test(stored.filePath || '')))
    const fileMessage = stored && stored.conversionError ? `WAV 生成失败：${stored.conversionError}` : (!isWav ? '该记录为旧版 PCM 文件，仅保留元数据，不能用于文件频谱分析。' : '')
    const record = stored ? Object.assign({}, stored, {
      durationLabel: `${(Math.max(0, stored.duration || 0) / 1000).toFixed(1)} 秒`,
      calibrationLabel: signedDb(repo.recordCalibrationDb(stored))
    }) : null
    this.setData({ record, fileMessage, formatLabel: isWav ? 'WAV' : 'PCM' })
  },
  remove() { wx.showModal({ title: '删除此记录？', content: '本地测试记录及对应录音文件将一并删除。', success: res => { if (res.confirm) { repo.remove(this.id); wx.navigateBack() } } }) },
  compare() {
    getApp().globalData.compareFirstId = this.id
    wx.switchTab({ url: '/pages/compare/index' })
  }
})
