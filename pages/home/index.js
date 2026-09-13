const { getSystemProfile, requestedAudioSource, iosBuildGate } = require('../../services/compatibility')
const repo = require('../../services/recording-repository')

Page({
  data: { profile: {}, permission: '未检查', mode: 'phone', earSide: 'auto', latest: null },
  onShow() {
    const profile = getSystemProfile(); const records = repo.list()
    const gate = iosBuildGate(profile)
    this.setData({ profile, latest: records[0] || null, buildAllowed: gate.allowed, buildMessage: gate.message })
    wx.getSetting({ success: ({ authSetting }) => this.setData({ permission: authSetting['scope.record'] ? '已授权' : '未授权' }) })
  },
  chooseMode(event) { this.setData({ mode: event.currentTarget.dataset.mode }) },
  chooseEarSide(event) { this.setData({ earSide: event.currentTarget.dataset.side }) },
  start() {
    const { mode, profile, earSide } = this.data
    if (!this.data.buildAllowed) return wx.showModal({ title: '当前设备不支持', content: this.data.buildMessage, showCancel: false })
    wx.navigateTo({ url: `/pages/analyzer/index?mode=${mode}&earSide=${earSide}&source=${requestedAudioSource(mode, profile.platform)}` })
  },
  openLatest() { if (this.data.latest) wx.navigateTo({ url: `/pages/record-detail/index?id=${this.data.latest.id}` }) }
})
