const { fft, hann } = require('../utils/fft')

const DEFAULT_MIN_FREQUENCY = 20
const DEFAULT_MAX_FREQUENCY = 500
const hannCache = {}

function getHannWindow(size) {
  if (!hannCache[size]) {
    const window = new Float32Array(size)
    for (let i = 0; i < size; i++) window[i] = hann(i, size)
    hannCache[size] = window
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

// FIR anti-alias filter evaluated only at decimation instants. 48 kHz -> 2 kHz preserves 20–500 Hz analysis.
class Decimator {
  constructor(inputRate, outputRate = 2000, cutoffHz = 800) {
    this.ratio = Math.max(1, Math.round(inputRate / outputRate))
    this.outputRate = inputRate / this.ratio
    this.taps = makeLowPassTaps(inputRate, Math.min(cutoffHz, this.outputRate * .42))
    this.history = new Float32Array(this.taps.length)
    this.cursor = 0; this.phase = 0
    this.outputBuffer = new Float32Array(256)
  }
  process(input) {
    const required = Math.ceil((input.length + this.ratio) / this.ratio)
    if (this.outputBuffer.length < required) this.outputBuffer = new Float32Array(required)
    let outputLength = 0
    for (let i = 0; i < input.length; i++) {
      this.history[this.cursor] = input[i]
      this.cursor = (this.cursor + 1) % this.history.length
      this.phase++
      if (this.phase < this.ratio) continue
      this.phase = 0
      let value = 0; let index = (this.cursor - 1 + this.history.length) % this.history.length
      for (let j = 0; j < this.taps.length; j++) { value += this.history[index] * this.taps[j]; index = (index - 1 + this.history.length) % this.history.length }
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
  for (let i = offset; i < samples.length; i++) {
    const abs = Math.abs(samples[i]); sum += samples[i] * samples[i]; peak = Math.max(peak, abs)
    if (abs > .995) clipped++
  }
  const rms = Math.sqrt(sum / analysisLength)
  const workspace = options.workspace || {}
  const spectrumInput = workspace.spectrumInput && workspace.spectrumInput.length === fftSize ? workspace.spectrumInput : new Float32Array(fftSize)
  workspace.spectrumInput = spectrumInput
  spectrumInput.fill(0)
  const window = getHannWindow(analysisLength)
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
  let maxValue = -Infinity, peakBin = 0
  for (let i = 1; i < fftSize / 2; i++) {
    const re = complex[2 * i], im = complex[2 * i + 1]
    const db = 20 * Math.log10(Math.max(1e-7, Math.sqrt(re * re + im * im) / (analysisLength / 2)))
    const limitedDb = Math.max(-100, db)
    if (i >= minimumBin && i <= maximumBin) spectrumDb[i - minimumBin] = limitedDb
    if (limitedDb > maxValue) { maxValue = limitedDb; peakBin = i }
  }
  const range = autoDbRange(spectrumDb)
  return {
    rms, rmsDb: dbfs(rms), peak, peakDb: dbfs(peak), clipped,
    peakFrequency: peakBin * sampleRate / fftSize,
    spectrumPeakDb: maxValue, spectrumDb, spectrumStartHz: minimumBin * sampleRate / fftSize, spectrumRange: range,
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
