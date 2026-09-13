const STORAGE_KEY = 'noise-analysis-records-v1'

function list() { return wx.getStorageSync(STORAGE_KEY) || [] }
function get(id) { return list().find(item => item.id === id) }
function save(record) {
  const items = list()
  const index = items.findIndex(item => item.id === record.id)
  if (index >= 0) items[index] = record
  else items.unshift(record)
  wx.setStorageSync(STORAGE_KEY, items)
  return record
}
function removeLocalWav(record) {
  const filePath = record && record.filePath
  const userPath = wx.env && wx.env.USER_DATA_PATH
  if (!filePath || !userPath || !filePath.startsWith(`${userPath}/`) || !/\.wav$/i.test(filePath)) return
  wx.getFileSystemManager().unlink({ filePath, fail: () => {} })
}
function remove(id) {
  const items = list()
  removeLocalWav(items.find(item => item.id === id))
  wx.setStorageSync(STORAGE_KEY, items.filter(item => item.id !== id))
}
function clear() {
  list().forEach(removeLocalWav)
  wx.removeStorageSync(STORAGE_KEY)
}

module.exports = { list, get, save, remove, clear }
