Component({
  data: {
    selected: 0,
    tabs: [
      { pagePath: '/pages/analyzer/index', text: '实时测试' },
      { pagePath: '/pages/recordings/index', text: '录音文件' },
      { pagePath: '/pages/compare/index', text: '数据对比' }
    ]
  },
  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index)
      const pagePath = event.currentTarget.dataset.path
      if (!pagePath || index === this.data.selected) return
      wx.switchTab({ url: pagePath })
    }
  }
})
