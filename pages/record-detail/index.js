const repo = require('../../services/recording-repository')
let audio
Page({
  data: { record: null, playing: false, playbackMessage: '' },
  onLoad(query) { this.id = query.id; this.load() },
  onUnload() { if (audio) audio.destroy() },
  load() { this.setData({ record: repo.get(this.id) }) },
  play() {
    const record = this.data.record
    if (!record || !record.filePath) return
    if (!audio) { audio = wx.createInnerAudioContext(); audio.onEnded(() => this.setData({ playing: false })); audio.onError(() => this.setData({ playing: false, playbackMessage: '当前 PCM 临时文件无法直接回放；需在真机 PoC 中确认 WAV 封装。' })) }
    audio.src = record.filePath; audio.play(); this.setData({ playing: true, playbackMessage: '' })
  },
  pause() { if (audio) audio.pause(); this.setData({ playing: false }) },
  togglePlayback() { if (this.data.playing) this.pause(); else this.play() },
  remove() { wx.showModal({ title: '删除此记录？', content: '该操作只会删除本地元数据。', success: res => { if (res.confirm) { repo.remove(this.id); wx.navigateBack() } } }) },
  compare() { wx.navigateTo({ url: `/pages/compare/index?first=${this.id}` }) }
})
