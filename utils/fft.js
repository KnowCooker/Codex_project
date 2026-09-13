function hann(index, size) { return .5 * (1 - Math.cos(2 * Math.PI * index / (size - 1))) }

// Iterative radix-2 FFT; returns interleaved real/imaginary values.
function fft(input) {
  const n = input.length; const out = new Float32Array(n * 2)
  for (let i = 0, j = 0; i < n; i++) {
    out[2 * j] = input[i]
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = -2 * Math.PI / length; const half = length >> 1
    for (let start = 0; start < n; start += length) {
      for (let k = 0; k < half; k++) {
        const c = Math.cos(angle * k), s = Math.sin(angle * k)
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
