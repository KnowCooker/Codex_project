const { parsePcm16, analyse, HighPassFilter, Decimator } = require('./dsp')

const HEADER_READ_SIZE = 4096
const FILE_CHUNK_SIZE = 256 * 1024
const FFT_SIZE = 2048
const WINDOW_SIZE = 1024
const HOP_SIZE = 512

function callFs(fs, method, options) {
  return new Promise((resolve, reject) => fs[method]({ ...options, success: resolve, fail: reject }))
}

function textAt(view, offset, length) {
  let value = ''
  for (let index = 0; index < length; index++) value += String.fromCharCode(view.getUint8(offset + index))
  return value
}

function parseWavHeader(buffer) {
  const view = new DataView(buffer)
  if (view.byteLength < 44 || textAt(view, 0, 4) !== 'RIFF' || textAt(view, 8, 4) !== 'WAVE') throw new Error('文件不是有效的 WAV')
  let offset = 12
  let format = null
  let data = null
  while (offset + 8 <= view.byteLength) {
    const id = textAt(view, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const content = offset + 8
    if (id === 'fmt ' && content + 16 <= view.byteLength) {
      format = {
        audioFormat: view.getUint16(content, true),
        channels: view.getUint16(content + 2, true),
        sampleRate: view.getUint32(content + 4, true),
        blockAlign: view.getUint16(content + 12, true),
        bitsPerSample: view.getUint16(content + 14, true)
      }
    }
    if (id === 'data') { data = { offset: content, size }; break }
    offset = content + size + (size % 2)
  }
  if (!format || !data) throw new Error('WAV 缺少音频数据')
  if (format.audioFormat !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) throw new Error('仅支持单通道 16 位 PCM WAV')
  return { ...format, dataOffset: data.offset, dataSize: data.size }
}

async function averageSpectrumFromWav(filePath, options = {}) {
  const fs = wx.getFileSystemManager()
  const statResult = await callFs(fs, 'stat', { path: filePath })
  const fileSize = statResult.stats.size
  const headerResult = await callFs(fs, 'readFile', { filePath, position: 0, length: Math.min(HEADER_READ_SIZE, fileSize) })
  if (!(headerResult.data instanceof ArrayBuffer)) throw new Error('无法读取 WAV 文件')
  const header = parseWavHeader(headerResult.data)
  const dataSize = Math.min(header.dataSize, fileSize - header.dataOffset)
  const highPass = new HighPassFilter(header.sampleRate, 7)
  const decimator = new Decimator(header.sampleRate, 2000)
  const analysisRate = decimator.outputRate
  const window = new Float32Array(WINDOW_SIZE)
  const workspace = {}
  let windowCount = 0
  let frameCount = 0
  let powerSum = null
  let sumSquares = 0
  let sampleCount = 0
  let spectrumStartHz = 20
  let binSpacingHz = analysisRate / FFT_SIZE

  const addWindow = length => {
    const result = analyse(window.subarray(0, length), analysisRate, FFT_SIZE, { windowSize: length, workspace })
    if (!result) return
    if (!powerSum) powerSum = new Float64Array(result.spectrumDb.length)
    for (let index = 0; index < result.spectrumDb.length; index++) powerSum[index] += Math.pow(10, result.spectrumDb[index] / 10)
    spectrumStartHz = result.spectrumStartHz
    binSpacingHz = result.binSpacingHz
    frameCount++
  }

  let bytePosition = 0
  while (bytePosition < dataSize) {
    let length = Math.min(FILE_CHUNK_SIZE, dataSize - bytePosition)
    length -= length % header.blockAlign
    if (!length) break
    const readResult = await callFs(fs, 'readFile', { filePath, position: header.dataOffset + bytePosition, length })
    if (!(readResult.data instanceof ArrayBuffer) || !readResult.data.byteLength) throw new Error('WAV 音频数据读取中断')
    const filtered = highPass.process(parsePcm16(readResult.data))
    const samples = decimator.process(filtered)
    for (let index = 0; index < samples.length; index++) {
      const value = samples[index]
      sumSquares += value * value; sampleCount++
      window[windowCount++] = value
      if (windowCount === WINDOW_SIZE) {
        addWindow(WINDOW_SIZE)
        window.copyWithin(0, HOP_SIZE, WINDOW_SIZE)
        windowCount = WINDOW_SIZE - HOP_SIZE
      }
    }
    bytePosition += readResult.data.byteLength
    if (options.onProgress) options.onProgress(Math.min(100, Math.round(bytePosition / dataSize * 100)))
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  if (!frameCount && windowCount >= 128) addWindow(windowCount)
  if (!frameCount || !powerSum || !sampleCount) throw new Error('录音太短，无法生成平均频谱')
  const values = new Float32Array(powerSum.length)
  for (let index = 0; index < powerSum.length; index++) values[index] = 10 * Math.log10(Math.max(1e-10, powerSum[index] / frameCount))
  const rmsDb = 20 * Math.log10(Math.max(1e-7, Math.sqrt(sumSquares / sampleCount)))
  return { values, spectrumStartHz, binSpacingHz, rmsDb, frameCount, analysisRate }
}

module.exports = { parseWavHeader, averageSpectrumFromWav }
