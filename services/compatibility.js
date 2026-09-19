function getSystemProfile() {
  // 基础库 3.x 已拆分系统信息接口；仅在旧基础库中降级使用旧接口。
  const legacy = (!wx.getDeviceInfo || !wx.getAppBaseInfo) ? wx.getSystemInfoSync() : {}
  const device = wx.getDeviceInfo ? wx.getDeviceInfo() : legacy
  const app = wx.getAppBaseInfo ? wx.getAppBaseInfo() : legacy
  const rawPlatform = String(device.platform || '').toLowerCase()
  const platformNames = { ios: 'iOS', android: 'Android', devtools: 'DevTools' }
  return {
    platform: platformNames[rawPlatform] || rawPlatform || 'unknown',
    rawPlatform,
    model: device.model || 'unknown',
    system: device.system || 'unknown',
    wechatVersion: app.version || 'unknown',
    sdkVersion: app.SDKVersion || 'unknown',
    tier: 'L2',
    supportsReferenceSpl: false
  }
}

function deviceGate(profile) {
  if (!wx.getRecorderManager) return { allowed: false, message: '当前微信环境不支持实时麦克风采集，请升级微信后重试。' }
  if (profile.rawPlatform === 'ios' || profile.rawPlatform === 'android' || profile.rawPlatform === 'devtools') return { allowed: true, message: '' }
  return { allowed: false, message: '当前版本仅适配 iOS 和 Android 手机，请使用手机微信打开。' }
}

function requestedAudioSource(platform) {
  return platform === 'iOS' ? 'buildInMic' : 'mic'
}

module.exports = { getSystemProfile, requestedAudioSource, deviceGate }
