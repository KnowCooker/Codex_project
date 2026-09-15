const repo = require('../../services/recording-repository')
let audio
Page({
  data: { record: null, playing: false, playbackAvailable: false, playbackMessage: '', editing: false, draftName: '', draftNotes: '', draftTags: '' },
  onLoad(query) { this.id = query.id; this.load() },
  onUnload() { if (audio) audio.destroy() },
  load() {
    const record = repo.get(this.id)
    const playbackAvailable = Boolean(record && (record.playbackReady || record.fileFormat === 'wav' || /\.wav$/i.test(record.filePath || '')))
    const playbackMessage = record && record.conversionError ? `WAV 生成失败：${record.conversionError}` : (!playbackAvailable ? '该记录是旧版 PCM 文件，无法直接回放；新录音会自动生成 WAV。' : '')
    this.setData({
      record,
      playbackAvailable,
      playbackMessage,
      draftName: record ? record.name || '' : '',
      draftNotes: record ? record.notes || '' : '',
      draftTags: record && Array.isArray(record.tags) ? record.tags.join('，') : ''
    })
  },
  startEditing() { this.setData({ editing: true }) },
  cancelEditing() {
    const record = this.data.record
    this.setData({
      editing: false,
      draftName: record ? record.name || '' : '',
      draftNotes: record ? record.notes || '' : '',
      draftTags: record && Array.isArray(record.tags) ? record.tags.join('，') : ''
    })
  },
  setDraftName(event) { this.setData({ draftName: event.detail.value }) },
  setDraftNotes(event) { this.setData({ draftNotes: event.detail.value }) },
  setDraftTags(event) { this.setData({ draftTags: event.detail.value }) },
  saveDetails() {
    const record = this.data.record
    if (!record) return
    const name = this.data.draftName.trim()
    if (!name) return wx.showToast({ title: '记录名称不能为空', icon: 'none' })
    const tags = this.data.draftTags.split(/[,，]/).map(item => item.trim()).filter(Boolean).filter((item, index, items) => items.indexOf(item) === index).slice(0, 8)
    const updated = Object.assign({}, record, { name, notes: this.data.draftNotes.trim(), tags })
    repo.save(updated)
    this.setData({ record: updated, editing: false, draftName: name, draftNotes: updated.notes, draftTags: tags.join('，') })
    wx.showToast({ title: '记录信息已保存', icon: 'success' })
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
