const repo = require('../../services/recording-repository')

let audio

function signedDb(value) {
  const number = Number(value) || 0
  return `${number > 0 ? '+' : ''}${number.toFixed(1)} dB`
}

Page({
  data: { record: null, playing: false, playbackAvailable: false, playbackMessage: '', formatLabel: 'WAV' },
  onLoad(query) { this.id = query.id; this.load() },
  onUnload() { if (audio) { audio.destroy(); audio = null } },
  load() {
    const stored = repo.get(this.id)
    const playbackAvailable = Boolean(stored && (stored.playbackReady || stored.fileFormat === 'wav' || /\.wav$/i.test(stored.filePath || '')))
    const playbackMessage = stored && stored.conversionError ? `WAV 生成失败：${stored.conversionError}` : (!playbackAvailable ? '该记录是旧版 PCM 文件，无法直接回放。' : '')
    const record = stored ? Object.assign({}, stored, {
      durationLabel: `${(Math.max(0, stored.duration || 0) / 1000).toFixed(1)} 秒`,
      calibrationLabel: signedDb(repo.recordCalibrationDb(stored))
    }) : null
    this.setData({ record, playbackAvailable, playbackMessage, formatLabel: playbackAvailable ? 'WAV' : 'PCM' })
  },
  play() {
    const record = this.data.record
    if (!record || !record.filePath || !this.data.playbackAvailable) return wx.showToast({ title: '该录音暂不可回放', icon: 'none' })
    if (!audio) {
      audio = wx.createInnerAudioContext()
      audio.onEnded(() => this.setData({ playing: false }))
      audio.onError(error => this.setData({ playing: false, playbackMessage: 'WAV 回放失败：' + (error.errMsg || '请检查文件是否仍存在') }))
    }
    audio.src = record.filePath
    audio.play()
    this.setData({ playing: true, playbackMessage: '' })
  },
  pause() { if (audio) audio.pause(); this.setData({ playing: false }) },
  togglePlayback() { if (this.data.playing) this.pause(); else this.play() },
  remove() { wx.showModal({ title: '删除此记录？', content: '本地测试记录及对应 WAV 录音文件将一并删除。', success: res => { if (res.confirm) { repo.remove(this.id); wx.navigateBack() } } }) },
  compare() {
    getApp().globalData.compareFirstId = this.id
    wx.switchTab({ url: '/pages/compare/index' })
  }
})
