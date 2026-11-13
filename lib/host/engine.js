/**
 * dsh-datapilot — 数据引擎（host 侧，零第三方依赖）。
 *
 * M1 能力：CSV / JSONL（本地解析、类型推断、列式缓冲、画像、直方图、分位数、
 * 相关矩阵、分组聚合）。Parquet / xlsx / ONNX 只做文件识别与元数据返回，
 * 完整解析留待后续版本（需 hyparquet / exceljs / protobufjs）。
 *
 * 所有函数纯内存、无 IO 副作用；文件读取与缓存由 index.js 负责。
 * @module dsh-datapilot/engine
 */

/** 单个数据集的资源上限（超过则截断并给出 warning）。 */
export const LIMITS = {
  maxBytes: 1024 * 1024 * 1024, // 1 GiB（适配绝大部分单文件数据集）
  maxRows: 5_000_000, // 500 万行（超过截断并提示）
}

/** 支持（或可识别）的文件格式。 */
export const FORMATS = {
  csv: ['csv', 'tsv', 'txt'],
  jsonl: ['jsonl', 'ndjson', 'jsonlines'],
  json: ['json'],
  parquet: ['parquet', 'pq'],
  xlsx: ['xlsx', 'xlsm'],
  xls: ['xls'],
  onnx: ['onnx'],
}

const NUMERIC_TYPES = new Set(['int64', 'float64'])

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** RFC4180 风格的定界符解析（支持引号、转义引号、字段内换行/定界符）。 */
export function parseDelimited(text, delimiter = ',') {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else {
      field += c
    }
    i++
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** 解析 CSV/TSV 文本 → { header, rows }。rows 为 string[][]，不含表头。 */
export function parseCSV(text, { delimiter, header = true } = {}) {
  const body = stripBom(text)
  const delim = delimiter ?? (body.includes('\t') && !body.includes(',') ? '\t' : ',')
  const rows = parseDelimited(body, delim)
  if (rows.length === 0) return { header: [], rows: [], delimiter: delim }
  const headerRow = header ? rows[0] : rows[0].map((_, idx) => `column_${idx + 1}`)
  const dataRows = header ? rows.slice(1) : rows
  return { header: headerRow, rows: dataRows, delimiter: delim }
}

/** 解析 JSONL 文本 → { header, rows }。对象键取并集；缺失键记空串。 */
export function parseJSONL(text) {
  const body = stripBom(text)
  const objs = []
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim()
    if (t === '') continue
    try {
      const v = JSON.parse(t)
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) objs.push(v)
    } catch {
      /* 跳过坏行 */
    }
  }
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
  const rows = objs.map((o) => header.map((k) => {
    const v = o[k]
    if (v === undefined || v === null) return ''
    return typeof v === 'string' ? v : JSON.stringify(v)
  }))
  return { header, rows }
}

const INT_RE = /^[+-]?\d+$/
const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
const BOOL_RE = /^(true|false)$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

function looksLikeNumber(v) {
  return INT_RE.test(v) || FLOAT_RE.test(v)
}
function looksLikeBool(v) {
  return BOOL_RE.test(v)
}
function looksLikeDate(v) {
  return DATE_RE.test(v)
}

/** 由抽样值推断列类型。 */
function inferType(sample) {
  const values = sample.filter((v) => v !== '' && v !== null && v !== undefined)
  if (values.length === 0) return 'null'
  let allInt = true
  let allNum = true
  let allBool = true
  let allDate = true
  for (const v of values) {
    if (!looksLikeBool(v)) allBool = false
    if (!looksLikeDate(v)) allDate = false
    if (!INT_RE.test(v)) allInt = false
    if (!looksLikeNumber(v)) allNum = false
  }
  if (allBool) return 'bool'
  if (allInt) return 'int64'
  if (allNum) return 'float64'
  if (allDate) return 'datetime'
  return 'string'
}

function toNumber(v) {
  if (v === '' || v === null || v === undefined) return NaN
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

/**
 * 把 string[][] + header 构建成列式 dataset。
 * 每列：{ name, type, values: Float64Array（数值列）| string[]（字符串列）,
 *         dict?: string[], codes?: Int32Array（分类/字符串字典） }。
 */
export function buildDataset(name, path, format, header, rows) {
  const rowCount = rows.length
  const columns = header.map((colName, ci) => {
    const sample = []
    for (let r = 0; r < Math.min(rows.length, 1000); r++) sample.push(rows[r][ci])
    const type = inferType(sample)
    if (NUMERIC_TYPES.has(type)) {
      const values = new Float64Array(rowCount)
      for (let r = 0; r < rowCount; r++) values[r] = toNumber(rows[r][ci])
      return { name: colName, type, values }
    }
    // 字符串 / null：字典编码 + 原始值（小数据直接用 values，避免过度设计）
    const values = new Array(rowCount)
    const dict = []
    const dictIndex = new Map()
    const codes = new Int32Array(rowCount)
    for (let r = 0; r < rowCount; r++) {
      const v = rows[r][ci]
      values[r] = v
      let code = dictIndex.get(v)
      if (code === undefined) {
        code = dict.length
        dictIndex.set(v, code)
        dict.push(v)
      }
      codes[r] = code
    }
    return { name: colName, type: type === 'null' ? 'string' : type, values, dict, codes }
  })
  return {
    id: '',
    name,
    path,
    format,
    rowCount,
    columnCount: header.length,
    columns,
    warnings: [],
    createdAt: Date.now(),
  }
}

function sortedNumeric(col) {
  const arr = Array.from(col.values).filter((v) => Number.isFinite(v))
  arr.sort((a, b) => a - b)
  return arr
}

/** 数值列画像。 */
export function profileColumn(col) {
  const base = { name: col.name, type: col.type, count: 0, nullCount: 0, distinct: 0 }
  if (!NUMERIC_TYPES.has(col.type)) {
    const dict = col.dict ?? []
    const total = col.codes ? col.codes.length : (col.values?.length ?? 0)
    const nullCount = col.codes ? (col.codes.reduce((a, c) => a + (c === -1 ? 1 : 0), 0)) : 0
    const counts = new Map()
    for (const v of col.values ?? []) {
      if (v === '' || v === null || v === undefined) continue
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([value, count]) => ({ value, count }))
    return {
      ...base,
      type: col.type,
      count: total - nullCount,
      nullCount,
      distinct: dict.length,
      top,
    }
  }
  const vals = sortedNumeric(col)
  const n = vals.length
  const total = col.values.length
  const nullCount = total - n
  if (n === 0) return { ...base, type: col.type, nullCount: total, count: 0 }
  const min = vals[0]
  const max = vals[n - 1]
  const sum = vals.reduce((a, b) => a + b, 0)
  const mean = sum / n
  const sumSq = vals.reduce((a, b) => a + b * b, 0)
  const variance = Math.max(0, sumSq / n - mean * mean)
  const std = Math.sqrt(variance)
  const q = (p) => {
    const idx = Math.min(n - 1, Math.max(0, Math.round((n - 1) * p)))
    return vals[idx]
  }
  return {
    ...base,
    type: col.type,
    count: n,
    nullCount,
    distinct: new Set(vals).size,
    min, max, mean, std,
    p01: q(0.01), p05: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), p99: q(0.99),
  }
}

/** 直方图分箱（数值列）。 */
export function histogram(col, bins = 32, log = false) {
  if (!NUMERIC_TYPES.has(col.type)) return { bins: [], error: 'column is not numeric' }
  const vals = sortedNumeric(col)
  if (vals.length === 0) return { bins: [] }
  const min = vals[0]
  const max = vals[vals.length - 1]
  if (min === max) return { bins: [{ x0: min, x1: max, count: vals.length }], min, max }
  const width = (max - min) / bins
  const out = new Array(bins)
  for (let b = 0; b < bins; b++) out[b] = { x0: min + b * width, x1: min + (b + 1) * width, count: 0 }
  for (const v of vals) {
    let b = Math.floor((v - min) / width)
    if (b >= bins) b = bins - 1
    out[b].count++
  }
  return { bins: out, min, max, width }
}

/** 分位数（数值列）。 */
export function quantiles(col, qs) {
  if (!NUMERIC_TYPES.has(col.type)) return { qs, values: [], error: 'column is not numeric' }
  const vals = sortedNumeric(col)
  const n = vals.length
  if (n === 0) return { qs, values: [] }
  const pick = (p) => vals[Math.min(n - 1, Math.max(0, Math.floor((n - 1) * p)))]
  return { qs, values: qs.map(pick) }
}

/** 抽样一列原始值（供图表绘制；数值列返回 number[]，分类列返回 {categorical,values,cats}）。 */
export function sampleColumn(col, n = 12000) {
  const total = col.values.length
  if (total === 0) return NUMERIC_TYPES.has(col.type) ? { categorical: false, values: [] } : { categorical: true, values: [], cats: col.dict ?? [] }
  const count = Math.min(n, total)
  const step = Math.max(1, Math.floor(total / count))
  if (NUMERIC_TYPES.has(col.type)) {
    const values = []
    for (let r = 0; r < total && values.length < count; r += step) {
      const v = col.values[r]
      if (Number.isFinite(v)) values.push(v)
    }
    return { categorical: false, values }
  }
  const values = []
  for (let r = 0; r < total && values.length < count; r += step) values.push(col.values[r])
  return { categorical: true, values, cats: col.dict ?? [] }
}

/** Pearson 相关矩阵（数值列两两）。 */
export function pearson(cols) {
  const numeric = cols.filter((c) => NUMERIC_TYPES.has(c.type))
  const k = numeric.length
  const matrix = Array.from({ length: k }, () => new Array(k).fill(NaN))
  if (k === 0) return { matrix: [], labels: [] }
  const means = numeric.map((c) => {
    let s = 0, n = 0
    for (const v of c.values) if (Number.isFinite(v)) { s += v; n++ }
    return n > 0 ? s / n : NaN
  })
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      if (i === j) { matrix[i][j] = 1; continue }
      const a = numeric[i].values, b = numeric[j].values
      const ma = means[i], mb = means[j]
      let sxy = 0, sxx = 0, syy = 0, n = 0
      for (let r = 0; r < a.length; r++) {
        const av = a[r], bv = b[r]
        if (!Number.isFinite(av) || !Number.isFinite(bv)) continue
        const da = av - ma, db = bv - mb
        sxy += da * db; sxx += da * da; syy += db * db; n++
      }
      if (n < 2 || sxx === 0 || syy === 0) matrix[i][j] = NaN
      else matrix[i][j] = sxy / Math.sqrt(sxx * syy)
    }
  }
  return { matrix, labels: numeric.map((c) => c.name) }
}

/** 分组聚合：按 by 列分组，对 metric 列做 agg。 */
export function groupby(byCol, metricCol, agg = 'mean', topK = 20) {
  const groups = new Map()
  const byValues = byCol.values ?? []
  const mValues = metricCol?.values ?? null
  const metricNumeric = metricCol ? NUMERIC_TYPES.has(metricCol.type) : false
  const counts = new Map()
  const sums = new Map()
  const mins = new Map()
  const maxs = new Map()
  for (let r = 0; r < byValues.length; r++) {
    const key = byValues[r]
    if (key === '' || key === null || key === undefined) continue
    groups.set(key, true)
    counts.set(key, (counts.get(key) ?? 0) + 1)
    if (mValues) {
      const v = metricNumeric ? toNumber(mValues[r]) : mValues[r]
      if (metricNumeric && Number.isFinite(v)) {
        sums.set(key, (sums.get(key) ?? 0) + v)
        mins.set(key, Math.min(mins.get(key) ?? Infinity, v))
        maxs.set(key, Math.max(maxs.get(key) ?? -Infinity, v))
      }
    }
  }
  const rows = [...groups.keys()].map((key) => {
    const n = counts.get(key)
    let value = n
    if (metricNumeric && sums.has(key)) {
      const s = sums.get(key)
      if (agg === 'sum') value = s
      else if (agg === 'min') value = mins.get(key)
      else if (agg === 'max') value = maxs.get(key)
      else if (agg === 'count') value = n
      else value = s / n // mean 默认
    }
    return { key, value, n }
  })
  rows.sort((a, b) => b.n - a.n)
  return { groups: rows.slice(0, topK) }
}

/** 识别文件格式（按扩展名）。 */
export function detectFormat(filename) {
  const ext = (filename.split('.').pop() ?? '').toLowerCase()
  for (const [format, exts] of Object.entries(FORMATS)) {
    if (exts.includes(ext)) return format
  }
  return undefined
}

/** 判断某格式当前是否有完整解析器。 */
export function isSupported(format) {
  return format === 'csv' || format === 'jsonl' || format === 'json' || format === 'parquet' || format === 'xlsx' || format === 'xls'
}
