const STORAGE_KEY = 'noise-analysis-records-v1'

const DERIVED_FIELDS = [
  'summary', 'weighting', 'weightingUnit', 'fftSize', 'analysisWindowSize',
  'analysisHopSize', 'spectrumStartHz', 'binSpacingHz', 'averageSeconds',
  'averageFrameCount'
]

function wavSampleRate(record) {
  const explicit = Number(record && record.wavSampleRate)
  if (explicit > 0) return explicit
  const original = Number(record && record.originalSampleRate)
  if (original > 0) return original
  const legacy = Number(record && record.sampleRate)
  if (legacy > 8000) return legacy
  return 48000
}

function recordCalibrationDb(record) {
  const value = Number(record && record.calibrationDb)
  return Number.isFinite(value) && value >= -100 && value <= 100 ? Number(value.toFixed(1)) : 0
}

function sanitize(record) {
  const clean = Object.assign({}, record, {
    wavSampleRate: wavSampleRate(record),
    channels: Number(record && record.channels) || 1,
    bitsPerSample: Number(record && record.bitsPerSample) || 16,
    calibrationDb: recordCalibrationDb(record)
  })
  DERIVED_FIELDS.forEach(field => delete clean[field])
  delete clean.sampleRate
  delete clean.originalSampleRate
  return clean
}

function list() {
  const stored = wx.getStorageSync(STORAGE_KEY) || []
  const items = stored.map(sanitize)
  if (JSON.stringify(items) !== JSON.stringify(stored)) wx.setStorageSync(STORAGE_KEY, items)
  return items
}
function get(id) { return list().find(item => item.id === id) }
function save(record) {
  record = sanitize(record)
  const items = list()
  const index = items.findIndex(item => item.id === record.id)
  if (index >= 0) items[index] = record
  else {
    const firstUnpinned = items.findIndex(item => !item.pinned)
    items.splice(firstUnpinned < 0 ? items.length : firstUnpinned, 0, record)
  }
  wx.setStorageSync(STORAGE_KEY, items)
  return record
}
function setPinned(id, pinned) {
  const items = list()
  const index = items.findIndex(item => item.id === id)
  if (index < 0) return null
  const record = Object.assign({}, items[index], { pinned: Boolean(pinned), pinnedAt: pinned ? Date.now() : 0 })
  items.splice(index, 1)
  if (pinned) items.unshift(record)
  else {
    const firstUnpinned = items.findIndex(item => !item.pinned)
    items.splice(firstUnpinned < 0 ? items.length : firstUnpinned, 0, record)
  }
  wx.setStorageSync(STORAGE_KEY, items)
  return record
}
function removeLocalWav(record) {
  const filePath = record && record.filePath
  const userPath = wx.env && wx.env.USER_DATA_PATH
  if (!filePath || !userPath || !filePath.startsWith(`${userPath}/`) || !/\.wav$/i.test(filePath)) return
  wx.getFileSystemManager().unlink({ filePath, fail: () => {} })
}
function remove(id) {
  const items = list()
  removeLocalWav(items.find(item => item.id === id))
  wx.setStorageSync(STORAGE_KEY, items.filter(item => item.id !== id))
}
function clear() {
  list().forEach(removeLocalWav)
  wx.removeStorageSync(STORAGE_KEY)
}

module.exports = { list, get, save, setPinned, remove, clear, wavSampleRate, recordCalibrationDb }
