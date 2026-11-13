/**
 * dsh-datapilot — 多格式解析器。
 *
 * - xlsx：手写 ZIP(central directory + inflateRaw) + SpreadsheetML 读取，无第三方依赖
 * - json：数组对象 / {data|rows|records} / 列式对象
 * - parquet：hyparquet（可选依赖，缺失时给出明确错误）
 * - onnx：手写 protobuf wire 解析（ModelProto / GraphProto / NodeProto / TensorProto）
 * - .xls（BIFF/OLE）明确不支持，提示另存为 .xlsx
 *
 * 统一输出：{ header: string[], rows: string[][] }（值一律先转字符串，交由 engine 推断类型）
 * ONNX 输出：{ graph: { nodes, edges, inputs, outputs, initializers, meta } }
 * @module dsh-datapilot/parsers
 */

import { inflateRawSync } from 'node:zlib'
import { LIMITS } from './engine.js'

/* ------------------------------------------------------------------ ZIP ---- */

const SIG_EOCD = 0x06054b50
const SIG_CEN = 0x02014b50
const SIG_LOC = 0x04034b50

function openZip(buf) {
  let eocd = -1
  const min = Math.max(0, buf.length - 66000)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip/xlsx（找不到 EOCD）')
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let k = 0; k < count; k++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== SIG_CEN) break
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    entries.set(name, { method, compSize, localOff })
    off += 46 + nameLen + extraLen + commentLen
  }
  const read = (name) => {
    const e = entries.get(name)
    if (!e) return undefined
    const lo = e.localOff
    if (buf.readUInt32LE(lo) !== SIG_LOC) throw new Error('zip 本地头损坏: ' + name)
    const nameLen = buf.readUInt16LE(lo + 26)
    const extraLen = buf.readUInt16LE(lo + 28)
    const start = lo + 30 + nameLen + extraLen
    const data = buf.subarray(start, start + e.compSize)
    if (e.method === 0) return data
    if (e.method === 8) return inflateRawSync(data)
    throw new Error(`zip 压缩方法 ${e.method} 不受支持（仅 stored/deflate）`)
  }
  return { entries, read }
}

const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function xmlUnescape(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, g) => {
    if (g[0] === '#') {
      const cp = g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m
    }
    return XML_ENT[g] ?? m
  })
}

function attr(tag, name) {
  const m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"'))
  return m ? xmlUnescape(m[1]) : undefined
}

function textNodes(xml, re) {
  const out = []
  let m
  while ((m = re.exec(xml))) out.push(xmlUnescape(m[1]))
  return out
}

/* ------------------------------------------------------------- sharedStrings */

function readSharedStrings(xml) {
  if (!xml) return []
  const out = []
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  let m
  while ((m = siRe.exec(xml))) {
    const ts = textNodes(m[1], /<t\b[^>]*>([\s\S]*?)<\/t>/g)
    out.push(ts.join(''))
  }
  return out
}

/* ------------------------------------------------------------------ styles */

const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57])
const DATE_FMT_RE = /(^|[^\\"])([ymdhsYM DHS])/ // 粗判：格式串里出现日期/时间占位

function readDateStyles(xml) {
  const dateStyle = new Set()
  if (!xml) return dateStyle
  const custom = new Map()
  const numFmtRe = /<numFmt\b[^>]*>/g
  let m
  while ((m = numFmtRe.exec(xml))) {
    const id = Number(attr(m[0], 'numFmtId'))
    const code = attr(m[0], 'formatCode') ?? ''
    if (Number.isFinite(id)) custom.set(id, code)
  }
  const xfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)
  if (!xfs) return dateStyle
  const xfRe = /<xf\b[^>]*>/g
  let idx = 0
  while ((m = xfRe.exec(xfs[1]))) {
    const id = Number(attr(m[0], 'numFmtId') ?? '0')
    const code = custom.get(id) ?? ''
    if (BUILTIN_DATE_FMT.has(id) || (code && DATE_FMT_RE.test(code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '')))) {
      dateStyle.add(idx)
    }
    idx++
  }
  return dateStyle
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

function excelSerialToIso(n) {
  const ms = EXCEL_EPOCH + Math.round(n * 86400000)
  const d = new Date(ms)
  const pad = (v, w = 2) => String(v).padStart(w, '0')
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  return n % 1 === 0 ? date : `${date}T${time}`
}

/* -------------------------------------------------------------------- xlsx */

function colIndex(ref) {
  let n = 0
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i)
    if (c < 65 || c > 90) break
    n = n * 26 + (c - 64)
  }
  return n - 1
}

function cellValue(tag, inner, shared, isDate) {
  const t = attr(tag, 't')
  const vRaw = (inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) ?? [])[1]
  const v = vRaw === undefined ? '' : xmlUnescape(vRaw)
  if (t === 's') {
    const i = Number(v)
    return shared[i] ?? ''
  }
  if (t === 'inlineStr') {
    const ts = textNodes(inner, /<t\b[^>]*>([\s\S]*?)<\/t>/g)
    return ts.join('')
  }
  if (t === 'b') return v === '1' ? 'true' : 'false'
  if (t === 'str' || t === 'e') return v
  if (v === '') return ''
  if (isDate) {
    const num = Number(v)
    if (Number.isFinite(num) && num > 0 && num < 60000) return excelSerialToIso(num)
  }
  return v
}

/**
 * 解析 xlsx（也接受只含 workbook 的 xlsm）。
 * @returns {{ sheets: Array<{name: string, header: string[], rows: string[][]}> }}
 */
export function parseXlsx(buf) {
  const zip = openZip(buf)
  const workbookXml = zip.read('xl/workbook.xml')?.toString('utf8')
  if (!workbookXml) {
    if (buf.length > 8 && buf.readUInt32BE(0) === 0xd0cf11e0) {
      throw new Error('这是旧版 .xls（BIFF/OLE）文件，暂不支持，请用 Excel 另存为 .xlsx')
    }
    throw new Error('不是有效的 xlsx（缺少 xl/workbook.xml）')
  }
  const shared = readSharedStrings(zip.read('xl/sharedStrings.xml')?.toString('utf8'))
  const dateStyles = readDateStyles(zip.read('xl/styles.xml')?.toString('utf8'))
  const relsXml = zip.read('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? ''
  const rels = new Map()
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id')
    const target = attr(m[0], 'Target')
    if (id && target) rels.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''))
  }
  const sheets = []
  const seen = new Set()
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name') ?? `Sheet${sheets.length + 1}`
    const rid = attr(m[0], 'r:id')
    let path = rid ? rels.get(rid) : undefined
    if (!path) path = `worksheets/sheet${sheets.length + 1}.xml`
    path = path.replace(/^\//, '')
    if (!path.startsWith('xl/')) path = 'xl/' + path
    if (seen.has(path)) continue
    seen.add(path)
    const sheetXml = zip.read(path)?.toString('utf8')
    if (!sheetXml) continue
    const { header, rows } = readSheet(sheetXml, shared, dateStyles)
    sheets.push({ name, header, rows })
  }
  if (sheets.length === 0) throw new Error('xlsx 中没有可读取的工作表')
  return { sheets }
}

function readSheet(xml, shared, dateStyles) {
  const rowsOut = []
  let maxCols = 0
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g
  let m
  while ((m = rowRe.exec(xml))) {
    const inner = m[2] ?? ''
    const cells = []
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cm
    while ((cm = cellRe.exec(inner))) {
      const tag = '<c' + cm[1] + '>'
      const ref = attr(tag, 'r') ?? ''
      const idx = ref ? colIndex(ref) : cells.length
      const sIdx = Number(attr(tag, 's') ?? '-1')
      const value = cellValue(tag, cm[2] ?? '', shared, dateStyles.has(sIdx))
      cells[idx] = value
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = ''
    if (cells.length > maxCols) maxCols = cells.length
    rowsOut.push(cells)
  }
  const header = rowsOut.length ? padRow(rowsOut[0], maxCols).map((v, i) => (v === '' ? `column_${i + 1}` : v)) : []
  const rows = rowsOut.slice(1).map((r) => padRow(r, maxCols))
  return { header, rows }
}

function padRow(r, n) {
  const out = new Array(n)
  for (let i = 0; i < n; i++) out[i] = r[i] ?? ''
  return out
}

/* ------------------------------------------------------------------- xls ---- */

/** 把 SheetJS 的单元格值规整为 xlsx 解析器一致的原始值（number / string / 日期字符串）。 */
function xlsCellValue(v) {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0')
    const d = `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`
    const hasTime = v.getHours() || v.getMinutes() || v.getSeconds()
    return hasTime ? `${d}T${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}` : d
  }
  return v
}

/**
 * 解析旧版 .xls（BIFF8/OLE，Excel 97-2003）。依赖 SheetJS `xlsx`（可选，缺失时抛错）。
 * 输出与 parseXlsx 一致：{ sheets: [{ name, header, rows }] }，值为原始类型。
 */
export async function parseXls(buf) {
  let XLSX
  try {
    const mod = await import('xlsx')
    XLSX = mod.default || mod
  } catch {
    throw new Error('缺少 .xls 解析依赖（xlsx 包未安装），请先安装')
  }
  let wb
  try {
    wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
  } catch (error) {
    throw new Error('xls 解析失败：' + (error instanceof Error ? error.message : String(error)))
  }
  if (!wb || !Array.isArray(wb.SheetNames) || wb.SheetNames.length === 0) {
    throw new Error('xls 中没有可读取的工作表')
  }
  const sheets = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })
    if (!Array.isArray(aoa) || aoa.length === 0) continue
    const maxCols = aoa.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0)
    const norm = aoa.map((r) => padRow(Array.isArray(r) ? r : [], maxCols).map(xlsCellValue))
    const header = norm[0].map((v, i) => (v === '' ? `column_${i + 1}` : String(v)))
    sheets.push({ name, header, rows: norm.slice(1) })
  }
  if (sheets.length === 0) throw new Error('xls 中没有可读取的工作表')
  return { sheets }
}

/* -------------------------------------------------------------------- json */

function cellsToString(v) {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function objectsToTable(objs) {
  const header = []
  const seen = new Set()
  for (const o of objs) {
    for (const k of Object.keys(o)) {
      if (!seen.has(k)) {
        seen.add(k)
        header.push(k)
      }
    }
  }
  const rows = objs.map((o) => header.map((k) => cellsToString(o[k])))
  return { header, rows }
}

/**
 * 解析 JSON 文本。支持：
 *  - 对象数组 [{...},{...}]
 *  - { data|rows|records|items: [...] }
 *  - 列式对象 { "col": [v1,v2,...] }
 *  - 单对象 {...} → 一行
 */
export function parseJSONText(text) {
  let v
  try {
    v = JSON.parse(text)
  } catch (error) {
    throw new Error('JSON 解析失败：' + (error instanceof Error ? error.message : String(error)))
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return { header: [], rows: [] }
    if (v.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x))) return objectsToTable(v)
    return { header: ['value'], rows: v.map((x) => [cellsToString(x)]) }
  }
  if (v !== null && typeof v === 'object') {
    for (const key of ['data', 'rows', 'records', 'items']) {
      const arr = v[key]
      if (Array.isArray(arr) && arr.length && arr.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x))) {
        return objectsToTable(arr)
      }
    }
    const cols = Object.keys(v)
    if (cols.length && cols.every((k) => Array.isArray(v[k]))) {
      const n = Math.max(...cols.map((k) => v[k].length))
      const rows = []
      for (let i = 0; i < n; i++) rows.push(cols.map((k) => cellsToString(v[k][i])))
      return { header: cols, rows }
    }
    return objectsToTable([v])
  }
  return { header: ['value'], rows: [[cellsToString(v)]] }
}

/* ----------------------------------------------------------------- parquet */

export async function parseParquet(buf) {
  let hy
  try {
    hy = await import('hyparquet')
  } catch {
    throw new Error('缺少 hyparquet 依赖：请在插件目录执行 npm install hyparquet hyparquet-compressors')
  }
  let compressors
  try {
    compressors = (await import('hyparquet-compressors')).compressors
  } catch {
    compressors = undefined
  }
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const objects = await hy.parquetReadObjects({ file: ab, compressors, rowEnd: LIMITS.maxRows })
  if (!objects || objects.length === 0) return { header: [], rows: [] }
  const header = []
  const seen = new Set()
  for (const o of objects) {
    for (const k of Object.keys(o)) {
      if (!seen.has(k)) {
        seen.add(k)
        header.push(k)
      }
    }
  }
  const norm = (v) => {
    if (v === undefined || v === null) return ''
    if (v instanceof Date) return v.toISOString().replace('.000Z', 'Z')
    if (typeof v === 'bigint') return v > Number.MAX_SAFE_INTEGER ? v.toString() : String(Number(v))
    if (typeof v === 'object') return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? String(x) : x))
    return String(v)
  }
  const rows = objects.map((o) => header.map((k) => norm(o[k])))
  return { header, rows }
}

/* -------------------------------------------------------------------- onnx */

const ONNX_DTYPE = {
  1: 'float32', 2: 'uint8', 3: 'int8', 4: 'uint16', 5: 'int16', 6: 'int32', 7: 'int64',
  8: 'string', 9: 'bool', 10: 'float16', 11: 'float64', 12: 'uint32', 13: 'uint64', 14: 'complex64', 15: 'complex128',
}

function readVarint(buf, pos) {
  let result = 0
  let shift = 1
  let b
  do {
    if (pos >= buf.length) throw new Error('protobuf varint 越界')
    b = buf[pos++]
    result += (b & 0x7f) * shift
    shift *= 128
  } while (b & 0x80)
  return [result, pos]
}

function* fields(buf, start = 0, end = buf.length) {
  let pos = start
  while (pos < end) {
    let tag
    ;[tag, pos] = readVarint(buf, pos)
    const field = Math.floor(tag / 8)
    const wire = tag & 7
    if (wire === 0) {
      let v
      ;[v, pos] = readVarint(buf, pos)
      yield { field, wire, varint: v }
    } else if (wire === 2) {
      let len
      ;[len, pos] = readVarint(buf, pos)
      yield { field, wire, bytes: buf.subarray(pos, pos + len) }
      pos += len
    } else if (wire === 5) {
      yield { field, wire, fixed: buf.readUInt32LE(pos) }
      pos += 4
    } else if (wire === 1) {
      yield { field, wire, fixed64: buf.readBigUInt64LE(pos) }
      pos += 8
    } else {
      break
    }
  }
}

function utf8(b) {
  return Buffer.from(b).toString('utf8')
}

function u32ToFloat(v) {
  const ab = new ArrayBuffer(4)
  new DataView(ab).setUint32(0, v, true)
  return +new DataView(ab).getFloat32(0, true).toFixed(6)
}

function parseDims(msg) {
  const dims = []
  for (const f of fields(msg)) {
    if (f.field === 1 && f.wire === 0) dims.push(f.varint)
    else if (f.field === 1 && f.wire === 2) {
      let pos = 0
      while (pos < f.bytes.length) {
        let v
        ;[v, pos] = readVarint(f.bytes, pos)
        dims.push(v)
      }
    }
  }
  return dims
}

function parseTensor(msg) {
  const t = { name: '', dims: [], dataType: 'unknown' }
  for (const f of fields(msg)) {
    if (f.field === 1 && f.wire === 0) t.dims.push(f.varint)
    else if (f.field === 1 && f.wire === 2) t.dims.push(...parseDims(f.bytes))
    else if (f.field === 2 && f.wire === 0) t.dataType = ONNX_DTYPE[f.varint] ?? `dtype${f.varint}`
    else if (f.field === 8 && f.wire === 2) t.name = utf8(f.bytes)
  }
  return t
}

function parseDim(msg) {
  for (const f of fields(msg)) {
    if (f.field === 2) return utf8(f.bytes)
    if (f.field === 1) return String(f.varint)
  }
  return '?'
}

function parseShape(msg) {
  const dims = []
  for (const f of fields(msg)) if (f.field === 1) dims.push(parseDim(f.bytes))
  return dims
}

function parseTensorType(msg) {
  let elem = 'unknown'
  let shape = []
  for (const f of fields(msg)) {
    if (f.field === 1 && f.wire === 0) elem = ONNX_DTYPE[f.varint] ?? `dtype${f.varint}`
    else if (f.field === 2) shape = parseShape(f.bytes)
  }
  return { elem, shape }
}

function parseType(msg) {
  for (const f of fields(msg)) {
    if (f.field === 1) return parseTensorType(f.bytes)
  }
  return { elem: 'unknown', shape: [] }
}

function parseValueInfo(msg) {
  const v = { name: '', elem: 'unknown', shape: [] }
  for (const f of fields(msg)) {
    if (f.field === 1) v.name = utf8(f.bytes)
    else if (f.field === 2) {
      const t = parseType(f.bytes)
      v.elem = t.elem
      v.shape = t.shape
    }
  }
  return v
}

function parseAttr(msg) {
  const a = { name: '', type: 0, value: undefined }
  const floats = []
  const ints = []
  for (const f of fields(msg)) {
    if (f.field === 1 && f.wire === 2) a.name = utf8(f.bytes)
    else if (f.field === 2 && f.wire === 5) a.value = u32ToFloat(f.fixed)
    else if (f.field === 3 && f.wire === 0) a.value = f.varint
    else if (f.field === 4 && f.wire === 2) a.value = utf8(f.bytes)
    else if (f.field === 5 && f.wire === 2) a.value = parseTensor(f.bytes)
    else if (f.field === 7 && f.wire === 5) floats.push(f.fixed)
    else if (f.field === 7 && f.wire === 2) {
      for (let p = 0; p + 4 <= f.bytes.length; p += 4) floats.push(f.bytes.readFloatLE(p))
    } else if (f.field === 8 && f.wire === 0) ints.push(f.varint)
    else if (f.field === 8 && f.wire === 2) {
      let p = 0
      while (p < f.bytes.length) {
        let v
        ;[v, p] = readVarint(f.bytes, p)
        ints.push(v)
      }
    } else if (f.field === 20 && f.wire === 0) a.type = f.varint
  }
  if (a.value === undefined) {
    if (ints.length) a.value = ints.length === 1 ? ints[0] : ints.slice(0, 8)
    else if (floats.length) a.value = floats.length === 1 ? +floats[0].toFixed(4) : floats.slice(0, 8)
  }
  return a
}

function parseNode(msg) {
  const n = { name: '', opType: '', domain: '', inputs: [], outputs: [], attrs: [] }
  for (const f of fields(msg)) {
    if (f.field === 1) n.inputs.push(utf8(f.bytes))
    else if (f.field === 2) n.outputs.push(utf8(f.bytes))
    else if (f.field === 3) n.name = utf8(f.bytes)
    else if (f.field === 4) n.opType = utf8(f.bytes)
    else if (f.field === 5) {
      const a = parseAttr(f.bytes)
      if (a.name && !a.name.startsWith('_')) n.attrs.push(a)
    } else if (f.field === 7) n.domain = utf8(f.bytes)
  }
  return n
}

function parseGraph(msg) {
  const g = { name: '', nodes: [], initializers: [], inputs: [], outputs: [] }
  for (const f of fields(msg)) {
    if (f.field === 1) g.nodes.push(parseNode(f.bytes))
    else if (f.field === 2) g.name = utf8(f.bytes)
    else if (f.field === 5) g.initializers.push(parseTensor(f.bytes))
    else if (f.field === 11) g.inputs.push(parseValueInfo(f.bytes))
    else if (f.field === 12) g.outputs.push(parseValueInfo(f.bytes))
  }
  return g
}

/** 解析 ONNX 模型（只读图结构与元数据，不读权重数据）。 */
export function parseOnnx(buf) {
  const model = { irVersion: 0, producer: '', producerVersion: '', domain: '', modelVersion: 0, opset: [], graph: null }
  for (const f of fields(buf)) {
    if (f.field === 1 && f.wire === 0) model.irVersion = f.varint
    else if (f.field === 2) model.producer = utf8(f.bytes)
    else if (f.field === 3) model.producerVersion = utf8(f.bytes)
    else if (f.field === 4) model.domain = utf8(f.bytes)
    else if (f.field === 5 && f.wire === 0) model.modelVersion = f.varint
    else if (f.field === 7) model.graph = parseGraph(f.bytes)
    else if (f.field === 8) {
      const op = { domain: '', version: 0 }
      for (const g of fields(f.bytes)) {
        if (g.field === 1) op.domain = utf8(g.bytes)
        else if (g.field === 2 && g.wire === 0) op.version = g.varint
      }
      model.opset.push(op)
    }
  }
  if (!model.graph) throw new Error('ONNX 文件中没有 graph 字段')
  return model
}

/**
 * 把 ONNX 图转成前端可绘制的 {nodes, edges}。
 * 节点：算子；权重初始化为 weight 节点（默认隐藏）；图输入为 input 节点。
 */
export function onnxToGraph(model) {
  const g = model.graph
  const nodes = []
  const byTensor = new Map()
  const edges = []
  let nid = 0
  const addNode = (kind, label, op, extra = {}) => {
    const id = 'n' + nid++
    const n = { id, kind, label, op: op || '', inputs: [], outputs: [], ...extra }
    nodes.push(n)
    return n
  }
  for (const inp of g.inputs) {
    if (g.initializers.some((t) => t.name === inp.name)) continue
    const n = addNode('input', inp.name, 'Input', { shape: inp.shape, dtype: inp.elem })
    for (const t of [inp.name]) byTensor.set(t, n.id)
  }
  const weightMap = new Map()
  for (const t of g.initializers) {
    const params = t.dims.reduce((a, b) => a * b, 1)
    const n = addNode('weight', t.name, 'Initializer', { shape: t.dims, dtype: t.dataType, params })
    weightMap.set(t.name, n.id)
  }
  const opNodes = []
  for (const nd of g.nodes) {
    const n = addNode('op', nd.name || nd.opType, nd.opType, {
      attrs: nd.attrs.map((a) => ({ name: a.name, value: typeof a.value === 'object' ? JSON.stringify(a.value).slice(0, 120) : a.value })),
    })
    opNodes.push({ node: n, src: nd })
  }
  const external = new Map()
  for (const inp of g.inputs) external.set(inp.name, { name: inp.name, shape: inp.shape, elem: inp.elem })
  for (const out of g.outputs) external.set(out.name, { name: out.name, shape: out.shape, elem: out.elem })
  for (const { node, src } of opNodes) {
    for (const t of src.inputs) {
      const from = byTensor.get(t)
      if (from) edges.push({ from, to: node.id, tensor: t })
      else if (weightMap.has(t)) edges.push({ from: weightMap.get(t), to: node.id, tensor: t, weight: true })
    }
    for (const t of src.outputs) byTensor.set(t, node.id)
  }
  // 图输出节点
  const outNodeIds = new Set()
  for (const out of g.outputs) {
    const from = byTensor.get(out.name)
    if (from) {
      const id = 'o' + outNodeIds.size
      const n = addNode('output', out.name, 'Output', { shape: out.shape, dtype: out.elem })
      edges.push({ from, to: n.id, tensor: out.name })
      outNodeIds.add(n.id)
    }
  }
  const params = g.initializers.reduce((sum, t) => sum + t.dims.reduce((a, b) => a * b, 1), 0)
  return {
    nodes,
    edges,
    meta: {
      irVersion: model.irVersion,
      producer: model.producer,
      producerVersion: model.producerVersion,
      opset: model.opset,
      name: g.name,
      nodeCount: g.nodes.length,
      initializerCount: g.initializers.length,
      params,
      inputs: g.inputs.filter((i) => !g.initializers.some((t) => t.name === i.name)).map((i) => ({ name: i.name, shape: i.shape, dtype: i.elem })),
      outputs: g.outputs.map((o) => ({ name: o.name, shape: o.shape, dtype: o.elem })),
    },
  }
}
