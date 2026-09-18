const repo = require('../../services/recording-repository')

function present(record) {
  const formatLabel = record.playbackReady || record.fileFormat === 'wav' || /\.wav$/i.test(record.filePath || '') ? 'WAV' : 'PCM'
  const calibrationDb = repo.recordCalibrationDb(record)
  return {
    id: record.id,
    name: record.name,
    pinned: Boolean(record.pinned),
    offset: 0,
    createdAt: record.createdAt,
    mode: record.mode,
    sampleRateLabel: `${formatLabel} ${repo.wavSampleRate(record)} Hz`,
    calibrationLabel: `${calibrationDb > 0 ? '+' : ''}${calibrationDb.toFixed(1)} dB`,
    durationLabel: `${(Math.max(0, record.duration || 0) / 1000).toFixed(1)} 秒`,
    fileSizeLabel: record.fileSize ? `${(record.fileSize / 1024 / 1024).toFixed(2)} MB` : '大小未知',
    formatLabel
  }
}

Page({
  data: { recordings: [], renameOpen: false, renameId: '', renameValue: '', swipingId: '' },
  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this.actionWidth = 240 / 750 * info.windowWidth
  },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ selected: 1 })
    this.refresh()
  },
  refresh() { this.setData({ recordings: repo.list().filter(item => item.filePath).map(present) }) },
  setOffset(id, offset, closeOthers = false) {
    const updates = {}
    this.data.recordings.forEach((item, index) => {
      if (item.id === id) updates[`recordings[${index}].offset`] = offset
      else if (closeOthers && item.offset) updates[`recordings[${index}].offset`] = 0
    })
    if (Object.keys(updates).length) this.setData(updates)
  },
  touchStart(event) {
    const id = event.currentTarget.dataset.id
    const item = this.data.recordings.find(record => record.id === id)
    const touch = event.touches[0]
    this.swipe = { id, startX: touch.clientX, startY: touch.clientY, baseOffset: item ? item.offset : 0, direction: '' }
    this.setOffset(id, item ? item.offset : 0, true)
    this.setData({ swipingId: id })
  },
  touchMove(event) {
    if (!this.swipe || !event.touches.length) return
    const touch = event.touches[0]
    const dx = touch.clientX - this.swipe.startX
    const dy = touch.clientY - this.swipe.startY
    if (!this.swipe.direction) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return
      this.swipe.direction = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
    }
    if (this.swipe.direction !== 'horizontal') return
    this.setOffset(this.swipe.id, Math.max(-this.actionWidth, Math.min(0, this.swipe.baseOffset + dx)))
  },
  touchEnd() {
    if (!this.swipe) return
    const item = this.data.recordings.find(record => record.id === this.swipe.id)
    const offset = item && item.offset < -this.actionWidth / 2 ? -this.actionWidth : 0
    this.setOffset(this.swipe.id, this.swipe.direction === 'horizontal' ? offset : (item ? item.offset : 0))
    this.swipe = null
    this.setData({ swipingId: '' })
  },
  open(event) {
    const id = event.currentTarget.dataset.id
    const item = this.data.recordings.find(record => record.id === id)
    if (item && item.offset) return this.setOffset(id, 0)
    wx.navigateTo({ url: `/pages/record-detail/index?id=${id}` })
  },
  beginRename(event) {
    const item = this.data.recordings.find(record => record.id === event.currentTarget.dataset.id)
    if (item) this.setData({ renameOpen: true, renameId: item.id, renameValue: item.name })
  },
  setRenameValue(event) { this.setData({ renameValue: event.detail.value }) },
  cancelRename() { this.setData({ renameOpen: false, renameId: '', renameValue: '' }) },
  saveRename() {
    const name = this.data.renameValue.trim()
    if (!name) return wx.showToast({ title: '录音名称不能为空', icon: 'none' })
    const record = repo.get(this.data.renameId)
    if (!record) return this.cancelRename()
    repo.save(Object.assign({}, record, { name }))
    this.cancelRename()
    this.refresh()
    wx.showToast({ title: '已重命名', icon: 'success' })
  },
  togglePinned(event) {
    const id = event.currentTarget.dataset.id
    const record = repo.get(id)
    if (!record) return
    repo.setPinned(id, !record.pinned)
    this.refresh()
    wx.showToast({ title: record.pinned ? '已取消置顶' : '已置顶', icon: 'none' })
  },
  remove(event) {
    const id = event.currentTarget.dataset.id
    wx.showModal({ title: '删除此录音？', content: '对应测试记录和本地 WAV 文件将一并删除。', success: result => {
      if (!result.confirm) return
      repo.remove(id)
      this.refresh()
    } })
  },
  keepOpen() {}
})
