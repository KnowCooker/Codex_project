const FREQUENCY_BANDS = [
  { key: 'low', min: 20, max: 60 },
  { key: 'mid', min: 70, max: 150 },
  { key: 'high', min: 160, max: 240 }
]

const offsetCache = {}

// IEC 61672 A-frequency-weighting response. Values are relative to 1 kHz.
function aWeightingDb(frequency) {
  const f2 = frequency * frequency
  const numerator = 12194 * 12194 * f2 * f2
  const denominator = (f2 + 20.6 * 20.6) * Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) * (f2 + 12194 * 12194)
  return 20 * Math.log10(Math.max(1e-12, numerator / denominator)) + 2
}

function getWeightingOffsets(length, startHz, binSpacingHz, weighting, calibrationDb = 0) {
  const calibration = Number(calibrationDb) || 0
  if (weighting !== 'a' && calibration === 0) return null
  const key = `${length}:${startHz}:${binSpacingHz}:${weighting}:${calibration}`
  if (!offsetCache[key]) {
    const offsets = new Float32Array(length)
    for (let index = 0; index < length; index++) offsets[index] = (weighting === 'a' ? aWeightingDb(startHz + index * binSpacingHz) : 0) + calibration
    offsetCache[key] = offsets
  }
  return offsetCache[key]
}

function valueAt(values, offsets, index) { return values[index] + (offsets ? offsets[index] : 0) }

function summarizeSpectrum(values, startHz, binSpacingHz, rmsDb, weighting, calibrationDb = 0) {
  const calibration = Number(calibrationDb) || 0
  const offsets = getWeightingOffsets(values.length, startHz, binSpacingHz, weighting, calibration)
  const peaks = { low: -100, mid: -100, high: -100 }
  let rawPower = 0; let weightedPower = 0
  for (let index = 0; index < values.length; index++) {
    const frequency = startHz + index * binSpacingHz
    const rawDb = values[index]; const weightedDb = valueAt(values, offsets, index)
    rawPower += Math.pow(10, rawDb / 10)
    weightedPower += Math.pow(10, weightedDb / 10)
    for (let bandIndex = 0; bandIndex < FREQUENCY_BANDS.length; bandIndex++) {
      const band = FREQUENCY_BANDS[bandIndex]
      if (frequency >= band.min && frequency <= band.max && weightedDb > peaks[band.key]) peaks[band.key] = weightedDb
    }
  }
  const weightingDelta = weighting === 'a' && rawPower > 0 ? 10 * Math.log10(Math.max(1e-12, weightedPower / rawPower)) - calibration : 0
  return { total: rmsDb + weightingDelta + calibration, low: peaks.low, mid: peaks.mid, high: peaks.high }
}

function spectrumRange(series) {
  let low = Infinity; let high = -Infinity
  for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
    const item = series[seriesIndex]
    if (!item || !item.values) continue
    for (let index = 0; index < item.values.length; index++) {
      const value = valueAt(item.values, item.offsets, index)
      if (value < low) low = value
      if (value > high) high = value
    }
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return { min: -100, max: 0 }
  let min = Math.floor((low - 4) / 10) * 10
  let max = Math.ceil((high + 4) / 10) * 10
  if (max - min < 20) { const center = (max + min) / 2; min = Math.floor((center - 10) / 10) * 10; max = min + 20 }
  return { min, max }
}

module.exports = { FREQUENCY_BANDS, aWeightingDb, getWeightingOffsets, summarizeSpectrum, spectrumRange, valueAt }
