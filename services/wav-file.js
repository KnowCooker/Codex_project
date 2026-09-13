const WAV_HEADER_SIZE = 44
const COPY_CHUNK_SIZE = 256 * 1024

function buildWavHeader(dataSize, sampleRate = 48000, channels = 1, bitsPerSample = 16) {
  const header = new ArrayBuffer(WAV_HEADER_SIZE)
  const view = new DataView(header)
  const writeText = (offset, text) => {
    for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index))
  }
  const blockAlign = channels * bitsPerSample / 8
  const byteRate = sampleRate * blockAlign
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeText(36, 'data')
  view.setUint32(40, dataSize, true)
  return header
}

function callFs(fs, method, options) {
  return new Promise((resolve, reject) => fs[method]({ ...options, success: resolve, fail: reject }))
}

async function writeAll(fs, fd, data, position) {
  let offset = 0
  while (offset < data.byteLength) {
    const result = await callFs(fs, 'write', { fd, data, offset, length: data.byteLength - offset, position: position + offset })
    if (!result.bytesWritten) throw new Error('WAV 文件写入中断')
    offset += result.bytesWritten
  }
}

async function pcmFileToWav(inputPath, options = {}) {
  if (!inputPath) throw new Error('PCM 文件路径为空')
  const fs = wx.getFileSystemManager()
  const statResult = await callFs(fs, 'stat', { path: inputPath })
  const dataSize = statResult.stats.size
  const sampleRate = options.sampleRate || 48000
  const channels = options.channels || 1
  const bitsPerSample = options.bitsPerSample || 16
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`
  const outputPath = `${wx.env.USER_DATA_PATH}/noise-recording-${suffix}.wav`
  let fd = ''
  try {
    const openResult = await callFs(fs, 'open', { filePath: outputPath, flag: 'w' })
    fd = openResult.fd
    await writeAll(fs, fd, buildWavHeader(dataSize, sampleRate, channels, bitsPerSample), 0)
    let position = 0
    while (position < dataSize) {
      const length = Math.min(COPY_CHUNK_SIZE, dataSize - position)
      const readResult = await callFs(fs, 'readFile', { filePath: inputPath, position, length })
      if (!(readResult.data instanceof ArrayBuffer)) throw new Error('PCM 文件不是二进制数据')
      if (!readResult.data.byteLength) throw new Error('PCM 文件读取中断')
      await writeAll(fs, fd, readResult.data, WAV_HEADER_SIZE + position)
      position += readResult.data.byteLength
    }
    await callFs(fs, 'close', { fd })
    fd = ''
    return { filePath: outputPath, fileSize: WAV_HEADER_SIZE + dataSize, format: 'wav' }
  } catch (error) {
    if (fd) {
      try { await callFs(fs, 'close', { fd }) } catch (_) {}
    }
    try { await callFs(fs, 'unlink', { filePath: outputPath }) } catch (_) {}
    throw error
  }
}

module.exports = { buildWavHeader, pcmFileToWav }
