const repo = require('../../services/recording-repository')
Page({
  data: { records: [] },
  onShow() { this.setData({ records: repo.list() }) },
  open(event) { wx.navigateTo({ url: `/pages/record-detail/index?id=${event.currentTarget.dataset.id}` }) },
  clear() { wx.showModal({ title: '清空所有记录？', content: '本地测试记录及其 WAV 录音文件将一并删除。', success: res => { if (res.confirm) { repo.clear(); this.setData({ records: [] }) } } }) }
})
