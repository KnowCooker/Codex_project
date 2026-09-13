const repo = require('../../services/recording-repository')
let audio
Page({
  data: { record: null, playing: false, playbackAvailable: false, playbackMessage: '' },
  onLoad(query) { this.id = query.id; this.load() },
  onUnload() { if (audio) audio.destroy() },
  load() {
    const record = repo.get(this.id)
    const playbackAvailable = Boolean(record && (record.playbackReady || record.fileFormat === 'wav' || /\.wav$/i.test(record.filePath || '')))
    const playbackMessage = record && record.conversionError ? `WAV 生成失败：${record.conversionError}` : (!playbackAvailable ? '该记录是旧版 PCM 文件，无法直接回放；新录音会自动生成 WAV。' : '')
    this.setData({ record, playbackAvailable, playbackMessage })
  },
  play() {
    const record = this.data.record
    if (!record || !record.filePath || !this.data.playbackAvailable) return wx.showToast({ title: '该录音暂不可回放', icon: 'none' })
    if (!audio) { audio = wx.createInnerAudioContext(); audio.onEnded(() => this.setData({ playing: false })); audio.onError(error => this.setData({ playing: false, playbackMessage: 'WAV 回放失败：' + (error.errMsg || '请检查文件是否仍存在') })) }
    audio.src = record.filePath; audio.play(); this.setData({ playing: true, playbackMessage: '' })
  },
  pause() { if (audio) audio.pause(); this.setData({ playing: false }) },
  togglePlayback() { if (this.data.playing) this.pause(); else this.play() },
  remove() { wx.showModal({ title: '删除此记录？', content: '本地测试记录及对应 WAV 录音文件将一并删除。', success: res => { if (res.confirm) { repo.remove(this.id); wx.navigateBack() } } }) },
  compare() { wx.navigateTo({ url: `/pages/compare/index?first=${this.id}` }) }
})
