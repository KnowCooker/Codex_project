const { getSystemProfile, requestedAudioSource, iosBuildGate } = require('../../services/compatibility')
const repo = require('../../services/recording-repository')

Page({
  data: { profile: {}, permission: '未检查', mode: 'phone', earSide: 'auto', latest: null },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ selected: 0 })
    const profile = getSystemProfile(); const records = repo.list()
    const gate = iosBuildGate(profile)
    const latestRecord = records[0]
    const latestFormat = latestRecord && (latestRecord.playbackReady || latestRecord.fileFormat === 'wav' || /\.wav$/i.test(latestRecord.filePath || '')) ? 'WAV' : 'PCM'
    const latest = latestRecord ? Object.assign({}, latestRecord, { sampleRateLabel: `${latestFormat} ${repo.wavSampleRate(latestRecord)} Hz`, durationLabel: `${(Math.max(0, latestRecord.duration || 0) / 1000).toFixed(1)} 秒` }) : null
    this.setData({ profile, latest, buildAllowed: gate.allowed, buildMessage: gate.message })
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
