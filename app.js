const { getSystemProfile } = require('./services/compatibility')

App({
  globalData: {
    profile: null,
    compareFirstId: ''
  },
  onLaunch() {
    this.globalData.profile = getSystemProfile()
  }
})
