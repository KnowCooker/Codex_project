const repo = require('../../services/recording-repository')
Page({
  data: { records: [], first: null, second: null, warning: '' },
  onLoad(query) { const records = repo.list(); const first = records.find(x => x.id === query.first) || records[0]; this.setData({ records, first }); if (first) this.draw(first, null) },
  pick(event) {
    const selected = this.data.records[event.detail.value]
    const slot = event.currentTarget.dataset.slot
    const first = slot === 'first' ? selected : this.data.first
    const second = slot === 'second' ? selected : this.data.second
    this.setData({ first, second }); this.draw(first, second); this.compareWarning(first, second)
  },
  compareWarning(first, second) { if (!first || !second) return; this.setData({ warning: first.sampleRate !== second.sampleRate || first.fftSize !== second.fftSize ? '参数不一致：可以查看，但不宜直接比较绝对幅值。' : '顺序测量，非同步双通道分析；不计算相位、相干性或声源方向。' }) },
  draw(a, b) { this.drawSeries('comparison', a && a.summary.spectrum, b && b.summary.spectrum) },
  drawSeries(id, one, two) { const ctx = wx.createCanvasContext(id, this), w = 694, h = 300; ctx.setFillStyle('#f9fcff'); ctx.fillRect(0,0,w,h); for (let y=0;y<=h;y+=h/4) { ctx.setStrokeStyle('#dbe6f3'); ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke() } ; [[one,'#1fa69d'],[two,'#e18a4d']].forEach(([values,color])=> { if (!values) return; ctx.setStrokeStyle(color);ctx.setLineWidth(2);ctx.beginPath();values.forEach((v,i)=>{const x=i/Math.max(1,values.length-1)*w; const y=h-(Math.max(-100,Math.min(0,v))+100)/100*h; if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y)});ctx.stroke() });ctx.draw() }
})
