const { fft, hann } = require('../utils/fft')

const DEFAULT_MIN_FREQUENCY = 20
const DEFAULT_MAX_FREQUENCY = 1000
const hannCache = {}
const hannSumCache = {}

function getHannWindow(size) {
  if (!hannCache[size]) {
    const window = new Float32Array(size)
    let sum = 0
    for (let i = 0; i < size; i++) { window[i] = hann(i, size); sum += window[i] }
    hannCache[size] = window
    hannSumCache[size] = sum
  }
  return hannCache[size]
}

function makeLowPassTaps(sampleRate, cutoffHz, tapCount = 97) {
  const taps = new Float32Array(tapCount); const middle = (tapCount - 1) / 2
  let total = 0
  for (let i = 0; i < tapCount; i++) {
    const n = i - middle
    const sinc = n === 0 ? 2 * cutoffHz / sampleRate : Math.sin(2 * Math.PI * cutoffHz * n / sampleRate) / (Math.PI * n)
    const window = .54 - .46 * Math.cos(2 * Math.PI * i / (tapCount - 1))
    taps[i] = sinc * window; total += taps[i]
  }
  for (let i = 0; i < tapCount; i++) taps[i] /= total
  return taps
}

// FIR anti-alias filter evaluated only at decimation instants. 48 kHz -> 4 kHz
// leaves transition bandwidth above the 20–1000 Hz analysis range.
class Decimator {
  constructor(inputRate, outputRate = 4000, cutoffHz = 1500, tapCount = 129) {
    this.ratio = Math.max(1, Math.round(inputRate / outputRate))
    this.outputRate = inputRate / this.ratio
    this.taps = makeLowPassTaps(inputRate, Math.min(cutoffHz, this.outputRate * .42), tapCount)
    this.history = new Float32Array(this.taps.length)
    this.cursor = 0; this.phase = 0
    this.outputBuffer = new Float32Array(256)
  }
  process(input) {
    const required = Math.ceil((input.length + this.ratio) / this.ratio)
    if (this.outputBuffer.length < required) this.outputBuffer = new Float32Array(required)
    const history = this.history
    const taps = this.taps
    const historyLength = history.length
    let outputLength = 0
    for (let i = 0; i < input.length; i++) {
      history[this.cursor] = input[i]
      this.cursor++
      if (this.cursor === historyLength) this.cursor = 0
      this.phase++
      if (this.phase < this.ratio) continue
      this.phase = 0
      let value = 0
      if (taps.length % 2 === 1) {
        // The windowed-sinc FIR is symmetric. Pair samples that share a
        // coefficient so each output needs roughly half as many multiplies.
        const half = (taps.length - 1) / 2
        let recent = this.cursor - 1
        if (recent < 0) recent = historyLength - 1
        let oldest = recent - taps.length + 1
        while (oldest < 0) oldest += historyLength
        for (let j = 0; j < half; j++) {
          value += (history[recent] + history[oldest]) * taps[j]
          recent--; if (recent < 0) recent = historyLength - 1
          oldest++; if (oldest === historyLength) oldest = 0
        }
        value += history[recent] * taps[half]
      } else {
        let index = this.cursor - 1
        if (index < 0) index = historyLength - 1
        for (let j = 0; j < taps.length; j++) {
          value += history[index] * taps[j]
          index--
          if (index < 0) index = historyLength - 1
        }
      }
      this.outputBuffer[outputLength++] = value
    }
    return this.outputBuffer.subarray(0, outputLength)
  }
}

class HighPassFilter {
  constructor(sampleRate, cutoffHz = 7) {
    const dt = 1 / sampleRate
    const rc = 1 / (2 * Math.PI * cutoffHz)
    this.alpha = rc / (rc + dt)
    this.previousInput = 0
    this.previousOutput = 0
  }
  process(input) {
    for (let i = 0; i < input.length; i++) {
      const value = this.alpha * (this.previousOutput + input[i] - this.previousInput)
      const previousInput = input[i]
      input[i] = value
      this.previousInput = previousInput
      this.previousOutput = value
    }
    return input
  }
}

function parsePcm16(buffer) {
  const view = new DataView(buffer)
  const samples = new Float32Array(buffer.byteLength / 2)
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768
  return samples
}

function analyse(samples, sampleRate, fftSize, options = {}) {
  if (!samples || samples.length === 0) return null
  const minFrequency = options.minFrequency || DEFAULT_MIN_FREQUENCY
  const maxFrequency = options.maxFrequency || DEFAULT_MAX_FREQUENCY
  const analysisLength = Math.min(options.windowSize || fftSize, fftSize, samples.length)
  const offset = samples.length - analysisLength
  let sum = 0, peak = 0, clipped = 0
  if (!options.spectrumOnly) {
    for (let i = offset; i < samples.length; i++) {
      const abs = Math.abs(samples[i]); sum += samples[i] * samples[i]; peak = Math.max(peak, abs)
      if (abs > .995) clipped++
    }
  }
  const rms = options.spectrumOnly ? 0 : Math.sqrt(sum / analysisLength)
  const workspace = options.workspace || {}
  const spectrumInput = workspace.spectrumInput && workspace.spectrumInput.length === fftSize ? workspace.spectrumInput : new Float32Array(fftSize)
  workspace.spectrumInput = spectrumInput
  if (analysisLength < fftSize) spectrumInput.fill(0)
  const window = getHannWindow(analysisLength)
  const amplitudeScale = Math.max(1e-12, hannSumCache[analysisLength] / 2)
  for (let i = 0; i < analysisLength; i++) spectrumInput[i] = samples[offset + i] * window[i]
  const complexLength = fftSize * 2
  const complex = workspace.complex && workspace.complex.length === complexLength ? workspace.complex : new Float32Array(complexLength)
  workspace.complex = complex
  fft(spectrumInput, complex)
  const minimumBin = Math.max(1, Math.ceil(minFrequency * fftSize / sampleRate))
  const maximumBin = Math.min(fftSize / 2 - 1, Math.floor(maxFrequency * fftSize / sampleRate))
  const spectrumLength = maximumBin - minimumBin + 1
  const spectrumDb = workspace.spectrumDb && workspace.spectrumDb.length === spectrumLength ? workspace.spectrumDb : new Float32Array(spectrumLength)
  workspace.spectrumDb = spectrumDb
  let maxValue = -Infinity, peakBin = minimumBin
  for (let i = minimumBin; i <= maximumBin; i++) {
    const re = complex[2 * i], im = complex[2 * i + 1]
    const db = 20 * Math.log10(Math.max(1e-7, Math.sqrt(re * re + im * im) / amplitudeScale))
    const limitedDb = Math.max(-100, db)
    spectrumDb[i - minimumBin] = limitedDb
    if (limitedDb > maxValue) { maxValue = limitedDb; peakBin = i }
  }
  const range = options.spectrumOnly ? null : autoDbRange(spectrumDb)
  return {
    rms, rmsDb: dbfs(rms), peak, peakDb: dbfs(peak), clipped,
    peakFrequency: peakBin * sampleRate / fftSize,
    spectrumPeakDb: maxValue, spectrumDb, spectrumStartHz: minimumBin * sampleRate / fftSize, spectrumRange: range,
    sampleRate, fftSize,
    analysisWindowSize: analysisLength,
    analysisWindowMs: analysisLength / sampleRate * 1000,
    binSpacingHz: sampleRate / fftSize,
    effectiveResolutionHz: sampleRate / analysisLength
  }
}
function dbfs(value) { return 20 * Math.log10(Math.max(value, 1e-7)) }
function autoDbRange(values) {
  let low = Infinity, high = -Infinity
  for (let index = 0; index < values.length; index++) {
    if (values[index] < low) low = values[index]
    if (values[index] > high) high = values[index]
  }
  if (!values.length) return { min: -100, max: 0 }
  let min = Math.floor((low - 4) / 10) * 10
  let max = Math.ceil((high + 4) / 10) * 10
  if (max - min < 20) { const center = (max + min) / 2; min = Math.floor((center - 10) / 10) * 10; max = min + 20 }
  return { min, max }
}
module.exports = { parsePcm16, analyse, autoDbRange, HighPassFilter, Decimator, DEFAULT_MIN_FREQUENCY, DEFAULT_MAX_FREQUENCY }
