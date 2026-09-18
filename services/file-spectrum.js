const { parsePcm16, analyse, HighPassFilter, Decimator } = require('./dsp')
const { ANALYSIS_SAMPLE_RATE, ANALYSIS_MAX_FREQUENCY, FFT_SIZE, WINDOW_SIZE, HOP_SIZE, DECIMATOR_CUTOFF_HZ, DECIMATOR_TAP_COUNT } = require('./analysis-config')

const HEADER_READ_SIZE = 4096
const FILE_CHUNK_SIZE = 64 * 1024

function callFs(fs, method, options) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback(value)
    }
    const timeout = setTimeout(() => finish(reject, new Error('读取 WAV 文件超时，请确认文件仍存在后重试')), 20000)
    try {
      fs[method]({ ...options, success: result => finish(resolve, result), fail: error => finish(reject, error) })
    } catch (error) {
      finish(reject, error)
    }
  })
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
  // Some WeChat base-library versions ignore readFile's position/length fields.
  // That made the first supposed 64 KB chunk contain the entire WAV and kept the
  // JS thread busy before the UI could paint any progress. Recordings are capped
  // at 30 seconds (~2.75 MiB), so read once and slice the in-memory buffer into
  // small cooperative chunks for predictable behavior across base libraries.
  const fileResult = await callFs(fs, 'readFile', { filePath })
  if (!(fileResult.data instanceof ArrayBuffer)) throw new Error('无法读取 WAV 文件')
  const fileBuffer = fileResult.data
  const fileSize = fileBuffer.byteLength
  const header = parseWavHeader(fileBuffer.slice(0, Math.min(HEADER_READ_SIZE, fileSize)))
  const dataSize = Math.min(header.dataSize, fileSize - header.dataOffset)
  if (options.onProgress) options.onProgress(1)
  await new Promise(resolve => setTimeout(resolve, 0))
  const highPass = new HighPassFilter(header.sampleRate, 7)
  const decimator = new Decimator(header.sampleRate, ANALYSIS_SAMPLE_RATE, DECIMATOR_CUTOFF_HZ, DECIMATOR_TAP_COUNT)
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
    const result = analyse(window.subarray(0, length), analysisRate, FFT_SIZE, { windowSize: length, maxFrequency: ANALYSIS_MAX_FREQUENCY, spectrumOnly: true, workspace })
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
    const chunk = fileBuffer.slice(header.dataOffset + bytePosition, header.dataOffset + bytePosition + length)
    if (!chunk.byteLength) throw new Error('WAV 音频数据读取中断')
    const pcm = parsePcm16(chunk)
    const filtered = highPass.process(pcm)
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
    bytePosition += chunk.byteLength
    if (options.onProgress) options.onProgress(Math.max(1, Math.min(99, Math.round(1 + bytePosition / dataSize * 98))))
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  if (!frameCount && windowCount >= 128) addWindow(windowCount)
  if (!frameCount || !powerSum || !sampleCount) throw new Error('录音太短，无法生成平均频谱')
  const values = new Float32Array(powerSum.length)
  for (let index = 0; index < powerSum.length; index++) values[index] = 10 * Math.log10(Math.max(1e-10, powerSum[index] / frameCount))
  const rmsDb = 20 * Math.log10(Math.max(1e-7, Math.sqrt(sumSquares / sampleCount)))
  let peakIndex = 0
  for (let index = 1; index < values.length; index++) if (values[index] > values[peakIndex]) peakIndex = index
  if (options.onProgress) options.onProgress(100)
  return {
    values, spectrumStartHz, binSpacingHz, rmsDb,
    peakFrequency: spectrumStartHz + peakIndex * binSpacingHz,
    spectrumPeakDb: values[peakIndex],
    frameCount, analysisRate, windowSize: WINDOW_SIZE, hopSize: HOP_SIZE,
    overlapRatio: 1 - HOP_SIZE / WINDOW_SIZE,
    wavSampleRate: header.sampleRate, channels: header.channels, bitsPerSample: header.bitsPerSample
  }
}

module.exports = { parseWavHeader, averageSpectrumFromWav, ANALYSIS_RATE: ANALYSIS_SAMPLE_RATE, ANALYSIS_MAX_FREQUENCY, FFT_SIZE, WINDOW_SIZE, HOP_SIZE }
