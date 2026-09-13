function hann(index, size) { return .5 * (1 - Math.cos(2 * Math.PI * index / (size - 1))) }

const twiddleCache = {}

function getTwiddles(size) {
  if (twiddleCache[size]) return twiddleCache[size]
  const levels = {}
  for (let length = 2; length <= size; length <<= 1) {
    const half = length >> 1; const values = new Float32Array(half * 2)
    for (let k = 0; k < half; k++) {
      const angle = -2 * Math.PI * k / length
      values[2 * k] = Math.cos(angle); values[2 * k + 1] = Math.sin(angle)
    }
    levels[length] = values
  }
  twiddleCache[size] = levels
  return levels
}

// Iterative radix-2 FFT; returns interleaved real/imaginary values.
function fft(input, output) {
  const n = input.length
  const out = output && output.length === n * 2 ? output : new Float32Array(n * 2)
  const twiddles = getTwiddles(n)
  for (let i = 0, j = 0; i < n; i++) {
    out[2 * j] = input[i]; out[2 * j + 1] = 0
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
  }
  for (let length = 2; length <= n; length <<= 1) {
    const half = length >> 1; const values = twiddles[length]
    for (let start = 0; start < n; start += length) {
      for (let k = 0; k < half; k++) {
        const c = values[2 * k], s = values[2 * k + 1]
        const even = 2 * (start + k), odd = 2 * (start + k + half)
        const re = out[odd] * c - out[odd + 1] * s
        const im = out[odd] * s + out[odd + 1] * c
        const er = out[even], ei = out[even + 1]
        out[odd] = er - re; out[odd + 1] = ei - im
        out[even] = er + re; out[even + 1] = ei + im
      }
    }
  }
  return out
}
module.exports = { fft, hann }
