const { fft, hann } = require('../utils/fft')

const DEFAULT_MIN_FREQUENCY = 20
const DEFAULT_MAX_FREQUENCY = 500

class HighPassFilter {
  constructor(sampleRate, cutoffHz = 7) {
    const dt = 1 / sampleRate
    const rc = 1 / (2 * Math.PI * cutoffHz)
    this.alpha = rc / (rc + dt)
    this.previousInput = 0
    this.previousOutput = 0
  }
  process(input) {
    const output = new Float32Array(input.length)
    for (let i = 0; i < input.length; i++) {
      const value = this.alpha * (this.previousOutput + input[i] - this.previousInput)
      output[i] = value
      this.previousInput = input[i]
      this.previousOutput = value
    }
    return output
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
  let sum = 0, peak = 0, clipped = 0
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]); sum += samples[i] * samples[i]; peak = Math.max(peak, abs)
    if (abs > .995) clipped++
  }
  const rms = Math.sqrt(sum / samples.length)
  const spectrumInput = new Float32Array(fftSize)
  const offset = Math.max(0, samples.length - fftSize)
  for (let i = 0; i < fftSize && offset + i < samples.length; i++) spectrumInput[i] = samples[offset + i] * hann(i, fftSize)
  const complex = fft(spectrumInput)
  const bins = new Float32Array(fftSize / 2)
  let maxValue = -Infinity, peakBin = 0
  for (let i = 1; i < bins.length; i++) {
    const re = complex[2 * i], im = complex[2 * i + 1]
    const db = 20 * Math.log10(Math.max(1e-7, Math.sqrt(re * re + im * im) / (fftSize / 2)))
    bins[i] = Math.max(-100, db)
    if (bins[i] > maxValue) { maxValue = bins[i]; peakBin = i }
  }
  const minimumBin = Math.max(1, Math.ceil(minFrequency * fftSize / sampleRate))
  const maximumBin = Math.min(bins.length - 1, Math.floor(maxFrequency * fftSize / sampleRate))
  const spectrum = []
  for (let i = minimumBin; i <= maximumBin; i++) spectrum.push({ frequency: i * sampleRate / fftSize, db: Number(bins[i].toFixed(2)) })
  const range = autoDbRange(spectrum.map(point => point.db))
  return {
    rms, rmsDb: dbfs(rms), peak, peakDb: dbfs(peak), clipped,
    peakFrequency: peakBin * sampleRate / fftSize,
    spectrumPeakDb: maxValue, bins: spectrum.map(point => point.db), spectrum, spectrumRange: range,
    waveform: downsample(samples, 160), waveformDurationMs: samples.length / sampleRate * 1000
  }
}
function dbfs(value) { return 20 * Math.log10(Math.max(value, 1e-7)) }
function autoDbRange(values) {
  const low = Math.min(...values), high = Math.max(...values)
  let min = Math.floor((low - 4) / 10) * 10
  let max = Math.ceil((high + 4) / 10) * 10
  if (max - min < 20) { const center = (max + min) / 2; min = Math.floor((center - 10) / 10) * 10; max = min + 20 }
  return { min, max }
}
function downsample(array, count) {
  const output = []; const step = Math.max(1, Math.floor(array.length / count))
  for (let i = 0; i < array.length; i += step) output.push(Number(array[i].toFixed(2)))
  return output
}
module.exports = { parsePcm16, analyse, HighPassFilter, DEFAULT_MIN_FREQUENCY, DEFAULT_MAX_FREQUENCY }
