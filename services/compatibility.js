function getSystemProfile() {
  // 基础库 3.x 已拆分系统信息接口；仅在旧基础库中降级使用旧接口。
  const legacy = (!wx.getDeviceInfo || !wx.getAppBaseInfo) ? wx.getSystemInfoSync() : {}
  const device = wx.getDeviceInfo ? wx.getDeviceInfo() : legacy
  const app = wx.getAppBaseInfo ? wx.getAppBaseInfo() : legacy
  const isIOS = device.platform === 'ios'
  return {
    platform: isIOS ? 'iOS' : 'Android',
    model: device.model || 'unknown',
    system: device.system || 'unknown',
    wechatVersion: app.version || 'unknown',
    sdkVersion: app.SDKVersion || 'unknown',
    tier: 'L2',
    supportsReferenceSpl: false
  }
}

function iosBuildGate(profile) {
  if (profile.platform !== 'iOS') return { allowed: false, message: '这是 iOS 测试版，请使用 iPhone 打开；Android 版将使用独立 AppID 发布。' }
  return { allowed: true, message: '' }
}

function requestedAudioSource(mode, platform) {
  if (mode === 'phone') return platform === 'iOS' ? 'buildInMic' : 'mic'
  return 'auto'
}

module.exports = { getSystemProfile, requestedAudioSource, iosBuildGate }
