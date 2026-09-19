// Android 真机 PoC 基线。具体机型、系统和微信版本需在首台测试机上补录。
const ANDROID_POC_BASELINE = {
  platform: 'Android',
  phone: null,
  android: null,
  wechat: null,
  audioSource: 'mic',
  status: 'pending-device',
  notes: [
    '使用微信标准 mic 输入，不包含耳机模式。',
    '需要在真机确认 PCM 字节序、位深、实际采样率、权限流程和厂商音频处理。',
    '没有现场校准时，声压级仅作为估计值。'
  ]
}

module.exports = { ANDROID_POC_BASELINE }
