// 首轮 iOS 真机 PoC 的已知基线。不要将此表视为 SPL 校准数据库。
const IOS_POC_BASELINE = {
  platform: 'iOS',
  phone: 'iPhone 16 Pro',
  ios: 'iOS 26.6.1',
  wechat: '8.0.76',
  status: 'pending-poc',
  notes: [
    '采集结果仅显示 dBFS；没有同型号、同路由的可信参考数据时不得估算 SPL。',
    '仅使用 iPhone 内置麦克风，需要在真机确认 PCM 字节序、位深与实际采样率。'
  ]
}

module.exports = { IOS_POC_BASELINE }
