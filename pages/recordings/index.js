const repo = require('../../services/recording-repository')

function present(record) {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    mode: record.mode,
    durationLabel: `${(Math.max(0, record.duration || 0) / 1000).toFixed(1)} 秒`,
    fileSizeLabel: record.fileSize ? `${(record.fileSize / 1024 / 1024).toFixed(2)} MB` : '大小未知',
    formatLabel: record.playbackReady || record.fileFormat === 'wav' || /\.wav$/i.test(record.filePath || '') ? 'WAV' : 'PCM'
  }
}

Page({
  data: { recordings: [] },
  onShow() { this.setData({ recordings: repo.list().filter(item => item.filePath).map(present) }) },
  open(event) { wx.navigateTo({ url: `/pages/record-detail/index?id=${event.currentTarget.dataset.id}` }) }
})
