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
function remove(id) { wx.setStorageSync(STORAGE_KEY, list().filter(item => item.id !== id)) }
function clear() { wx.removeStorageSync(STORAGE_KEY) }

module.exports = { list, get, save, remove, clear }
