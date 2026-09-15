const MIN_SECONDS = 1
const MAX_SECONDS = 30

function clampSeconds(value) {
  const seconds = Math.round(Number(value) || MIN_SECONDS)
  return Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, seconds))
}

class SpectrumAverage {
  constructor(seconds = 3) {
    this.seconds = clampSeconds(seconds)
    this.reset()
  }

  reset() {
    this.history = []
    this.historyStart = 0
    this.activeStart = 0
    this.sumSpectrumPower = null
    this.outputSpectrum = null
    this.sumRmsPower = 0
    this.sumPeakPower = 0
    this.sumClipped = 0
    this.activeCount = 0
    this.pool = []
    this.latestAt = 0
  }

  setSeconds(seconds) {
    const next = clampSeconds(seconds)
    if (next === this.seconds) return next
    this.seconds = next
    this.rebuildActiveWindow(this.latestAt || Date.now())
    return next
  }

  ensureBuffers(length) {
    if (this.sumSpectrumPower && this.sumSpectrumPower.length === length) return
    this.reset()
    this.sumSpectrumPower = new Float64Array(length)
    this.outputSpectrum = new Float32Array(length)
  }

  acquirePowerBuffer(length) {
    const buffer = this.pool.pop()
    return buffer && buffer.length === length ? buffer : new Float32Array(length)
  }

  addEntry(entry, direction) {
    for (let index = 0; index < entry.spectrumPower.length; index++) this.sumSpectrumPower[index] += direction * entry.spectrumPower[index]
    this.sumRmsPower += direction * entry.rmsPower
    this.sumPeakPower += direction * entry.peakPower
    this.sumClipped += direction * entry.clipped
    this.activeCount += direction
  }

  trimActiveWindow(now) {
    const cutoff = now - this.seconds * 1000
    while (this.activeStart < this.history.length && this.history[this.activeStart].at < cutoff) {
      this.addEntry(this.history[this.activeStart], -1)
      this.activeStart++
    }
  }

  trimHistory(now) {
    const cutoff = now - MAX_SECONDS * 1000
    while (this.historyStart < this.history.length && this.history[this.historyStart].at < cutoff) {
      const entry = this.history[this.historyStart]
      if (this.historyStart >= this.activeStart) {
        this.addEntry(entry, -1)
        this.activeStart = this.historyStart + 1
      }
      this.pool.push(entry.spectrumPower)
      this.historyStart++
    }
    if (this.historyStart > 256 && this.historyStart * 2 > this.history.length) {
      this.history = this.history.slice(this.historyStart)
      this.activeStart -= this.historyStart
      this.historyStart = 0
    }
  }

  rebuildActiveWindow(now) {
    if (!this.sumSpectrumPower) return
    this.sumSpectrumPower.fill(0)
    this.sumRmsPower = 0
    this.sumPeakPower = 0
    this.sumClipped = 0
    this.activeCount = 0
    const cutoff = now - this.seconds * 1000
    this.activeStart = this.history.length
    for (let index = this.historyStart; index < this.history.length; index++) {
      if (this.history[index].at < cutoff) continue
      if (this.activeStart === this.history.length) this.activeStart = index
      this.addEntry(this.history[index], 1)
    }
  }

  push(result, now = Date.now()) {
    if (!result || !result.spectrumDb || !result.spectrumDb.length) return result
    this.ensureBuffers(result.spectrumDb.length)
    this.latestAt = now
    const spectrumPower = this.acquirePowerBuffer(result.spectrumDb.length)
    for (let index = 0; index < spectrumPower.length; index++) spectrumPower[index] = Math.pow(10, result.spectrumDb[index] / 10)
    const entry = {
      at: now,
      spectrumPower,
      rmsPower: result.rms * result.rms,
      peakPower: result.peak * result.peak,
      clipped: result.clipped || 0
    }
    this.history.push(entry)
    this.addEntry(entry, 1)
    this.trimActiveWindow(now)
    this.trimHistory(now)

    const count = Math.max(1, this.activeCount)
    let spectrumPeakDb = -100
    let peakIndex = 0
    for (let index = 0; index < this.outputSpectrum.length; index++) {
      const db = Math.max(-100, 10 * Math.log10(Math.max(1e-10, this.sumSpectrumPower[index] / count)))
      this.outputSpectrum[index] = db
      if (db > spectrumPeakDb) { spectrumPeakDb = db; peakIndex = index }
    }
    const rms = Math.sqrt(Math.max(0, this.sumRmsPower / count))
    const peak = Math.sqrt(Math.max(0, this.sumPeakPower / count))
    return Object.assign({}, result, {
      rms,
      rmsDb: 20 * Math.log10(Math.max(1e-7, rms)),
      peak,
      peakDb: 20 * Math.log10(Math.max(1e-7, peak)),
      clipped: this.sumClipped,
      peakFrequency: result.spectrumStartHz + peakIndex * result.binSpacingHz,
      spectrumPeakDb,
      spectrumDb: this.outputSpectrum,
      averageSeconds: this.seconds,
      averageFrameCount: count
    })
  }
}

module.exports = { SpectrumAverage, clampSeconds, MIN_SECONDS, MAX_SECONDS }
