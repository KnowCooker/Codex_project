const { getSystemProfile } = require('./services/compatibility')

App({
  globalData: {
    profile: null
  },
  onLaunch() {
    this.globalData.profile = getSystemProfile()
  }
})
