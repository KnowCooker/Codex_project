const STORAGE_KEY = 'noise-analysis-calibration-db-v1'
const MIN_OFFSET_DB = -100
const MAX_OFFSET_DB = 100

function normalizeOffset(value) {
  const offset = Number(value)
  if (!Number.isFinite(offset) || offset < MIN_OFFSET_DB || offset > MAX_OFFSET_DB) return null
  return Number(offset.toFixed(1))
}

function getCalibrationOffset() {
  const offset = normalizeOffset(wx.getStorageSync(STORAGE_KEY))
  return offset === null ? 0 : offset
}

function setCalibrationOffset(value) {
  const offset = normalizeOffset(value)
  if (offset === null) throw new RangeError(`校准修正必须在 ${MIN_OFFSET_DB}–${MAX_OFFSET_DB} dB 之间`)
  wx.setStorageSync(STORAGE_KEY, offset)
  return offset
}

module.exports = { getCalibrationOffset, setCalibrationOffset, normalizeOffset, MIN_OFFSET_DB, MAX_OFFSET_DB }
