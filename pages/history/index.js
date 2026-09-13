const repo = require('../../services/recording-repository')
Page({
  data: { records: [] },
  onShow() { this.setData({ records: repo.list() }) },
  open(event) { wx.navigateTo({ url: `/pages/record-detail/index?id=${event.currentTarget.dataset.id}` }) },
  clear() { wx.showModal({ title: '清空所有记录？', content: '本地记录列表将被删除；临时音频文件可能由微信自动清理。', success: res => { if (res.confirm) { repo.clear(); this.setData({ records: [] }) } } }) }
})
