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
  if (profile.platform !== 'iOS') return { allowed: true, message: 'Android 使用标准麦克风兼容模式，当前尚未完成全部机型验证；结果仅用于相对观察。' }
  return { allowed: true, message: 'iOS 为首轮验证平台；不同设备的麦克风响应可能存在差异。' }
}

function requestedAudioSource(mode, platform) {
  if (mode === 'phone') return platform === 'iOS' ? 'buildInMic' : 'mic'
  return platform === 'iOS' ? 'headsetMic' : 'mic'
}

module.exports = { getSystemProfile, requestedAudioSource, iosBuildGate }
