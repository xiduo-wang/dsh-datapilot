/**
 * dsh-datapilot — host（宿主）半面。
 *
 * 路由族 /api/dsh-datapilot/*（全部 loopback-only）：
 *   面板 HTML、健康检查、状态、根目录、扫描、数据集（open/schema/preview/
 *   profile/histogram/quantiles/correlation/groupby/close）、模型元数据、诊断。
 *
 * M1 数据引擎支持 CSV / JSONL（零依赖）；Parquet / xlsx / ONNX 只做文件
 * 识别与元数据返回，完整解析留待后续（见 PRD §7.4）。
 *
 * 安全：所有读写路径必须落在已登记根目录内（realpath 前缀校验，防 .. / 符号
 * 链接穿越）；路由统一 loopback 栅栏 + 方法校验；不执行任何数据文件内容。
 * @module dsh-datapilot
 */

import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import {
  LIMITS,
  buildDataset,
  detectFormat,
  groupby,
  histogram,
  isSupported,
  pearson,
  profileColumn,
  quantiles,
  sampleColumn,
} from './engine.js'
import { onnxToGraph, parseOnnx } from './parsers.js'
import { buildInsights, buildReportMarkdown } from './report.js'

/** 稳定的 cordis 插件名（编排行 id，与 cordis.patch.yml 的 name 一致）。 */
export const name = 'dsh-datapilot'

/** 宿主挂载前必须就绪的服务。 */
export const inject = ['webServer']

/** 面板 HTML 文件的绝对路径（随包分发）。 */
const PANEL_HTML = fileURLToPath(new URL('../../assets/panel.html', import.meta.url))

/** 插件版本：宿主进程启动时读一次 package.json。 */
const PLUGIN_VERSION = (() => {
  try {
    const parsed = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'))
    return typeof parsed.version === 'string' ? parsed.version : 'unknown'
  } catch {
    return 'unknown'
  }
})()

/** 状态文件目录（根目录、设置）。 */
const DATA_DIR = join(homedir(), '.dsh', 'dsh-datapilot')
const STATE_FILE = join(DATA_DIR, 'state.json')
/** 上传工作区（跨工作区协作的共享数据池）。 */
const UPLOAD_DIR = join(DATA_DIR, 'uploads')
const UPLOAD_ROOT_ID = 'uploads'

/** 把字节数格式化成人类可读（用于错误提示）。 */
function fmtBytes(n) {
  if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(n % (1024 * 1024 * 1024) === 0 ? 0 : 1) + ' GB'
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(n % (1024 * 1024) === 0 ? 0 : 1) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB'
  return n + ' B'
}

/** 解析 Worker 线程的入口文件（把读文件+解析搬离事件循环）。 */
const PARSE_WORKER_URL = new URL('./parse-worker.js', import.meta.url)

/** 在独立线程里解析文件，避免大文件解析阻塞宿主事件循环。 */
function parseInWorker(filePath, format, parse) {
  return new Promise((resolve) => {
    let settled = false
    const done = (msg) => {
      if (settled) return
      settled = true
      resolve(msg)
    }
    let worker
    try {
      worker = new Worker(PARSE_WORKER_URL, { workerData: { filePath, format, parse } })
    } catch (error) {
      done({ error: error instanceof Error ? error.message : String(error) })
      return
    }
    worker.once('message', (msg) => {
      worker.terminate()
      done(msg)
    })
    worker.once('error', (error) => {
      worker.terminate()
      done({ error: error instanceof Error ? error.message : String(error) })
    })
    worker.once('exit', (code) => {
      if (code !== 0) done({ error: `解析线程异常退出（exit ${code}）` })
    })
  })
}

/** Parquet 解析依赖是否可用（首次探测后缓存）。 */
let parquetAvailable = null
/** xls（BIFF8）解析依赖（SheetJS xlsx）是否可用。 */
let xlsAvailable = null
async function detectCapabilities() {
  if (parquetAvailable === null) {
    try {
      await import('hyparquet')
      parquetAvailable = true
    } catch {
      parquetAvailable = false
    }
  }
  if (xlsAvailable === null) {
    try {
      await import('xlsx')
      xlsAvailable = true
    } catch {
      xlsAvailable = false
    }
  }
  return {
    csv: true,
    tsv: true,
    jsonl: true,
    json: true,
    xlsx: true,
    xls: xlsAvailable,
    parquet: parquetAvailable,
    onnx: true,
  }
}

const API = {
  panel: '/api/dsh-datapilot/panel',
  health: '/api/dsh-datapilot/health',
  state: '/api/dsh-datapilot/state',
  rootsAdd: '/api/dsh-datapilot/roots/add',
  rootsRemove: '/api/dsh-datapilot/roots/remove',
  scan: '/api/dsh-datapilot/scan',
  datasetsOpen: '/api/dsh-datapilot/datasets/open',
  datasetsSchema: '/api/dsh-datapilot/datasets/schema',
  datasetsPreview: '/api/dsh-datapilot/datasets/preview',
  datasetsProfile: '/api/dsh-datapilot/datasets/profile',
  datasetsSample: '/api/dsh-datapilot/datasets/sample',
  datasetsHistogram: '/api/dsh-datapilot/datasets/histogram',
  datasetsQuantiles: '/api/dsh-datapilot/datasets/quantiles',
  datasetsCorrelation: '/api/dsh-datapilot/datasets/correlation',
  datasetsGroupby: '/api/dsh-datapilot/datasets/groupby',
  datasetsClose: '/api/dsh-datapilot/datasets/close',
  modelsMeta: '/api/dsh-datapilot/models/meta',
  upload: '/api/dsh-datapilot/upload',
  report: '/api/dsh-datapilot/report',
  diagnostics: '/api/dsh-datapilot/diagnostics',
}

// ---------------------------------------------------------------- 基础工具

function isLoopbackRequest(req) {
  const addr = req.socket && req.socket.remoteAddress
  if (addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') return false
  const host = req.headers.host
  if (typeof host !== 'string') return false
  try {
    const h = new URL('http://' + host).hostname
    if (h !== '127.0.0.1' && h !== 'localhost' && h !== '[::1]') return false
  } catch {
    return false
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(JSON.stringify(body))
}

function ok(res, data) {
  writeJson(res, 200, { ok: true, ...data })
}

function fail(res, status, code, message) {
  writeJson(res, status, { ok: false, error: { code, message } })
}

function guard(req, res, method) {
  if (!isLoopbackRequest(req)) return fail(res, 403, 'LOOPBACK_ONLY', 'forbidden: loopback-only')
  if (req.method !== method) return fail(res, 405, 'METHOD', 'method not allowed: ' + req.method)
  return undefined
}

function queryParam(req, name) {
  try {
    return new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get(name)?.trim() ?? ''
  } catch {
    return ''
  }
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const b = chunk
    size += b.length
    if (size > 1024 * 1024) return undefined
    chunks.push(b)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** 读取原始二进制请求体（用于文件上传），超过上限返回 undefined。 */
async function readBody(req, maxBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += b.length
    if (size > maxBytes) return undefined
    chunks.push(b)
  }
  return Buffer.concat(chunks)
}

/** child 是否等于 parent 或在其之内（realpath 归一后，兼容 Windows 分隔符）。 */
function isSameOrInside(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

// ---------------------------------------------------------------- 应用状态

async function loadState() {
  try {
    const raw = await readFile(STATE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    const roots = Array.isArray(parsed.roots) ? parsed.roots.filter((r) => r && typeof r.path === 'string') : []
    return { roots }
  } catch {
    return { roots: [] }
  }
}

async function saveState(state) {
  try {
    const { mkdir, writeFile, rename } = await import('node:fs/promises')
    await mkdir(dirname(STATE_FILE), { recursive: true })
    const tmp = STATE_FILE + '.tmp'
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
    await rename(tmp, STATE_FILE)
  } catch (error) {
    // 状态持久化失败不致命：仅记入诊断日志。
    console.warn('[dsh-datapilot] state save failed:', error instanceof Error ? error.message : error)
  }
}

/** 求 path 的 realpath，并校验其是否落在某登记根内。失败返回 undefined。 */
async function resolveInsideRoot(state, rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') return undefined
  let rp
  try {
    rp = await realpath(rawPath.trim())
  } catch {
    return undefined
  }
  for (const root of state.roots) {
    let rootRp
    try {
      rootRp = await realpath(root.path)
    } catch {
      continue
    }
    if (isSameOrInside(rootRp, rp)) return rp
  }
  return undefined
}

// ---------------------------------------------------------------- 数据集打开

const openDatasets = new Map()
const MAX_OPEN_DATASETS = 8

/** 列画像缓存：`${datasetId}|${columnName}` -> profile 对象（LRU，避免重复全量扫描）。 */
const profileCache = new Map()
const PROFILE_CACHE_MAX = 4000

/** 文件解析缓存：`${realpath}\u0000${size}\u0000${mtimeMs}\u0000${sheet}` -> 已解析结果（LRU）。 */
const parseCache = new Map()
const PARSE_CACHE_MAX = 3

async function openDatasetFile(state, filePath, parse) {
  let real
  try {
    real = await realpath(filePath)
  } catch {
    return { error: { code: 'NOT_FOUND', message: 'file not found: ' + filePath } }
  }
  const format = detectFormat(basename(real))
  if (!format) {
    return { error: { code: 'UNSUPPORTED_FORMAT', message: 'unsupported file extension' } }
  }
  if (format === 'onnx') {
    return { error: { code: 'MODEL_FORMAT', message: 'ONNX 是模型文件，请在左侧模型列表中点开查看结构图' } }
  }
  const st = await stat(real)
  const bytes = st.size
  if (bytes > LIMITS.maxBytes) {
    return { error: { code: 'TOO_LARGE', message: `file exceeds ${fmtBytes(LIMITS.maxBytes)} limit` } }
  }

  let header
  let rows
  let sheets
  const warnings = []

  // 大文件解析搬到 Worker 线程（多核 CPU），宿主事件循环不阻塞，加载时按钮仍跟手。
  const workerResult = await parseInWorker(real, format, parse)
  if (workerResult.error) {
    return { error: { code: 'PARSE_FAILED', message: workerResult.error } }
  }
  if (workerResult.sheets) {
    // xlsx / xls 多工作表：选表逻辑仍在宿主侧（依赖 warnings）。
    const allSheets = workerResult.sheets
    sheets = allSheets.map((s) => ({ name: s.name, rowCount: s.rows.length, columnCount: s.header.length }))
    let pick = allSheets[0]
    if (parse && parse.sheet !== undefined && parse.sheet !== null && parse.sheet !== '') {
      const want = parse.sheet
      const found = typeof want === 'number' ? allSheets[want] : allSheets.find((s) => s.name === String(want))
      if (found) pick = found
      else warnings.push(`工作表「${want}」不存在，已回退到「${pick.name}」`)
    }
    ;({ header, rows } = pick)
    if (allSheets.length > 1) warnings.push(`共 ${allSheets.length} 个工作表，当前读取「${pick.name}」`)
  } else {
    ;({ header, rows } = workerResult)
  }

  if (!Array.isArray(header) || header.length === 0) {
    return { error: { code: 'PARSE_FAILED', message: '文件中没有可识别的表头/列' } }
  }

  if (rows.length > LIMITS.maxRows) {
    rows.length = LIMITS.maxRows
    warnings.push(`rows truncated to ${LIMITS.maxRows}`)
  }

  const ds = buildDataset(basename(real), real, format, header, rows)
  ds.supported = true
  ds.warnings = warnings
  if (sheets) {
    ds.sheets = sheets
    ds.sheetName = parse && parse.sheet !== undefined && parse.sheet !== '' && parse.sheet !== null
      ? (typeof parse.sheet === 'number' ? sheets[parse.sheet]?.name : String(parse.sheet))
      : sheets[0]?.name
  }
  const id = randomUUID().slice(0, 12)
  ds.id = id
  return { dataset: ds, rawHeader: header, rawRows: rows }
}

// ---------------------------------------------------------------- 路由挂载

export function apply(ctx) {
  ctx.logger?.info(`[dsh-datapilot] v${PLUGIN_VERSION} activated`)

  const statePromise = loadState()
  const errorLog = []

  const recordError = (message) => {
    errorLog.push({ at: Date.now(), message })
    if (errorLog.length > 20) errorLog.shift()
  }

  const getDataset = (id) => {
    const entry = openDatasets.get(id)
    if (!entry) return undefined
    return entry
  }

  ctx.effect(() => {
    const routes = []

    // ---------- 面板 HTML
    routes.push({
      kind: 'exact',
      path: API.panel,
      handler: async (req, res) => {
        if (guard(req, res, 'GET')) return
        try {
          const html = await readFile(PANEL_HTML, 'utf8')
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end(html)
        } catch (error) {
          fail(res, 500, 'PANEL_READ', error instanceof Error ? error.message : String(error))
        }
      },
    })

    // ---------- 健康检查
    routes.push({
      kind: 'exact',
      path: API.health,
      handler: async (req, res) => {
        if (guard(req, res, 'GET')) return
        ok(res, { plugin: 'dsh-datapilot', version: PLUGIN_VERSION, openDatasets: openDatasets.size })
      },
    })

    // ---------- 状态（根目录 + 版本 + 能力）
    routes.push({
      kind: 'exact',
      path: API.state,
      handler: async (req, res) => {
        if (guard(req, res, 'GET')) return
        const state = await statePromise
        ok(res, {
          roots: state.roots,
          version: PLUGIN_VERSION,
          capabilities: await detectCapabilities(),
          openDatasets: [...openDatasets.keys()],
        })
      },
    })

    // ---------- 根目录 add / remove
    routes.push({
      kind: 'exact',
      path: API.rootsAdd,
      handler: async (req, res) => {
        if (guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const path = typeof body?.path === 'string' ? body.path.trim() : ''
        if (path === '') return fail(res, 400, 'BAD_PATH', 'path is required')
        let real
        try {
          real = await realpath(path)
          const st = await stat(real)
          if (!st.isDirectory()) throw new Error('not a directory')
        } catch (error) {
          return fail(res, 400, 'BAD_PATH', error instanceof Error ? error.message : String(error))
        }
        const state = await statePromise
        if (state.roots.some((r) => r.path === real)) return ok(res, { root: state.roots.find((r) => r.path === real) })
        const root = { id: randomUUID().slice(0, 8), path: real, label: body?.label || basename(real) }
        state.roots.push(root)
        await saveState(state)
        ok(res, { root })
      },
    })
    routes.push({
      kind: 'exact',
      path: API.rootsRemove,
      handler: async (req, res) => {
        if (guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const id = typeof body?.id === 'string' ? body.id : ''
        const state = await statePromise
        const idx = state.roots.findIndex((r) => r.id === id)
        if (idx < 0) return fail(res, 404, 'NOT_FOUND', 'root not found')
        state.roots.splice(idx, 1)
        await saveState(state)
        ok(res, { removed: id })
      },
    })

    // ---------- 扫描根目录
    routes.push({
      kind: 'exact',
      path: API.scan,
      handler: async (req, res) => {
        if (guard(req, res, 'GET')) return
        const state = await statePromise
        const rootId = queryParam(req, 'rootId')
        const root = rootId ? state.roots.find((r) => r.id === rootId) : state.roots[0]
        if (!root) return fail(res, 400, 'NO_ROOT', 'no root registered')
        let real
        try {
          real = await realpath(root.path)
        } catch {
          return fail(res, 404, 'NOT_FOUND', 'root not found')
        }
        const entries = []
        const stack = [real]
        let depth = 0
        const maxDepth = 4
        while (stack.length > 0 && depth <= maxDepth) {
          const dirs = []
          for (const dir of stack) {
            let names
            try {
              names = await readdir(dir, { withFileTypes: true })
            } catch {
              continue
            }
            for (const dirent of names) {
              const full = join(dir, dirent.name)
              if (dirent.isDirectory()) {
                if (depth < maxDepth) dirs.push(full)
                continue
              }
              if (!dirent.isFile()) continue
              const format = detectFormat(dirent.name)
              if (!format) continue
              let size = 0
              try {
                size = (await stat(full)).size
              } catch {
                /* ignore */
              }
              const kind = format === 'onnx' ? 'model' : 'dataset'
              entries.push({
                name: dirent.name, path: full, format, size,
                kind, supported: isSupported(format),
              })
            }
          }
          stack.length = 0
          stack.push(...dirs)
          depth++
        }
        ok(res, { rootId: root.id, entries })
      },
    })

    // ---------- 数据集 open
    routes.push({
      kind: 'exact',
      path: API.datasetsOpen,
      handler: async (req, res) => {
        if (guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const path = typeof body?.path === 'string' ? body.path : ''
        if (path === '') return fail(res, 400, 'BAD_PATH', 'path is required')
        const state = await statePromise
        const real = await resolveInsideRoot(state, path)
        if (!real) return fail(res, 403, 'PATH_OUTSIDE_ROOT', 'path must be inside a registered root')
        const result = await openDatasetFile(state, real, body?.parse)
        if (result.error) return fail(res, 400, result.error.code, result.error.message)
        // LRU：超出上限时逐出最旧的
        while (openDatasets.size >= MAX_OPEN_DATASETS) {
          const oldest = openDatasets.keys().next().value
          openDatasets.delete(oldest)
        }
        openDatasets.set(result.dataset.id, result)
        const { rawHeader, rawRows, ...meta } = result
        void rawHeader; void rawRows
        const ds = result.dataset
        ok(res, {
          datasetId: ds.id,
          name: ds.name,
          path: ds.path,
          format: ds.format,
          supported: ds.supported,
          rowCount: ds.rowCount,
          columnCount: ds.columnCount,
          schema: ds.columns.map((c) => ({ name: c.name, type: c.type })),
          sheets: ds.sheets,
          sheet: ds.sheetName,
          warnings: ds.warnings,
        })
      },
    })

    // ---------- schema
    routes.push({
      kind: 'exact',
      path: API.datasetsSchema,
      handler: async (req, res) => {
        if (guard(req, res, 'GET')) return
        const entry = getDataset(queryParam(req, 'id'))
        if (!entry) return fail(res, 404, 'NOT_FOUND', 'dataset not open')
        ok(res, { columns: entry.dataset.columns.map((c) => ({ name: c.name, type: c.type })) })
      },
    })

    // ---------- preview
    routes.push({
      kind: 'exact',
      path: API.datasetsPreview,
      handler: async (req, res) => {
        if (guard(req, res, 'GET')) return
        const entry = getDataset(queryParam(req, 'id'))
        if (!entry) return fail(res, 404, 'NOT_FOUND', 'dataset not open')
        const offset = Math.max(0, parseInt(queryParam(req, 'offset') || '0', 10) || 0)
        const limit = Math.min(1000, Math.max(1, parseInt(queryParam(req, 'limit') || '100', 10) || 100))
        const rows = entry.rawRows.slice(offset, offset + limit)
        ok(res, { header: entry.rawHeader, rows, total: entry.rawRows.length, offset, limit })
      },
    })

    // ---------- profile
    routes.push({
      kind: 'exact',
      path: API.datasetsProfile,
      handler: async (req, res) => {
        if (guard(req, res, 'GET')) return
        const entry = getDataset(queryParam(req, 'id'))
        if (!entry) return fail(res, 404, 'NOT_FOUND', 'dataset not open')
        const want = queryParam(req, 'columns')
        const columns = want ? want.split(',').map((s) => s.trim()).filter(Boolean) : entry.dataset.columns.map((c) => c.name)
        const profiles = columns.map((name) => {
          const key = entry.dataset.id + '|' + name
          const hit = profileCache.get(key)
          if (hit) { profileCache.delete(key); profileCache.set(key, hit); return hit }
          const col = entry.dataset.columns.find((c) => c.name === name)
          const p = col ? profileColumn(col) : { name, error: 'column not found' }
          profileCache.set(key, p)
          while (profileCache.size > PROFILE_CACHE_MAX) profileCache.delete(profileCache.keys().next().value)
          return p
        })
        ok(res, { profiles })
      },
    })

    // ---------- sample
    routes.push({
      kind: 'exact',
      path: API.datasetsSample,
      handler: async (req, res) => {
        if (guard(req, res, 'GET')) return
        const entry = getDataset(queryParam(req, 'id'))
        if (!entry) return fail(res, 404, 'NOT_FOUND', 'dataset not open')
        const col = entry.dataset.columns.find((c) => c.name === queryParam(req, 'column'))
        if (!col) return fail(res, 404, 'COLUMN_NOT_FOUND', 'column not found')
        const n = Math.min(50000, Math.max(100, parseInt(queryParam(req, 'n') || '12000', 10) || 12000))
        ok(res, sampleColumn(col, n))
      },
    })

    // ---------- histogram
    routes.push({
      kind: 'exact',
      path: API.datasetsHistogram,
      handler: async (req, res) => {
        if (guard(req, res, 'GET')) return
        const entry = getDataset(queryParam(req, 'id'))
        if (!entry) return fail(res, 404, 'NOT_FOUND', 'dataset not open')
        const col = entry.dataset.columns.find((c) => c.name === queryParam(req, 'column'))
        if (!col) return fail(res, 404, 'COLUMN_NOT_FOUND', 'column not found')
        const bins = Math.min(256, Math.max(4, parseInt(queryParam(req, 'bins') || '32', 10) || 32))
        ok(res, histogram(col, bins, queryParam(req, 'log') === '1'))
      },
    })

    // ---------- quantiles
    routes.push({
      kind: 'exact',
      path: API.datasetsQuantiles,
      handler: async (req, res) => {
        if (guard(req, res, 'GET')) return
        const entry = getDataset(queryParam(req, 'id'))
        if (!entry) return fail(res, 404, 'NOT_FOUND', 'dataset not open')
        const col = entry.dataset.columns.find((c) => c.name === queryParam(req, 'column'))
        if (!col) return fail(res, 404, 'COLUMN_NOT_FOUND', 'column not found')
        const qsRaw = queryParam(req, 'qs') || '0,0.25,0.5,0.75,1'
        const qs = qsRaw.split(',').map((s) => parseFloat(s)).filter((n) => Number.isFinite(n))
        ok(res, quantiles(col, qs))
      },
    })

    // ---------- correlation
    routes.push({
      kind: 'exact',
      path: API.datasetsCorrelation,
      handler: async (req, res) => {
        if (guard(req, res, 'GET')) return
        const entry = getDataset(queryParam(req, 'id'))
        if (!entry) return fail(res, 404, 'NOT_FOUND', 'dataset not open')
        ok(res, pearson(entry.dataset.columns))
      },
    })

    // ---------- groupby
    routes.push({
      kind: 'exact',
      path: API.datasetsGroupby,
      handler: async (req, res) => {
        if (guard(req, res, 'GET')) return
        const entry = getDataset(queryParam(req, 'id'))
        if (!entry) return fail(res, 404, 'NOT_FOUND', 'dataset not open')
        const by = entry.dataset.columns.find((c) => c.name === queryParam(req, 'by'))
        if (!by) return fail(res, 404, 'COLUMN_NOT_FOUND', 'by column not found')
        const metricName = queryParam(req, 'metric')
        const metric = metricName ? entry.dataset.columns.find((c) => c.name === metricName) : undefined
        const agg = queryParam(req, 'agg') || 'mean'
        const topK = Math.min(100, Math.max(1, parseInt(queryParam(req, 'topK') || '20', 10) || 20))
        ok(res, groupby(by, metric, agg, topK))
      },
    })

    // ---------- close
    routes.push({
      kind: 'exact',
      path: API.datasetsClose,
      handler: async (req, res) => {
        if (guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const id = typeof body?.id === 'string' ? body.id : ''
        const existed = openDatasets.delete(id)
        ok(res, { closed: existed })
      },
    })

    // ---------- 模型元数据
    routes.push({
      kind: 'exact',
      path: API.modelsMeta,
      handler: async (req, res) => {
        if (guard(req, res, 'GET')) return
        const state = await statePromise
        const path = queryParam(req, 'path')
        const real = await resolveInsideRoot(state, path)
        if (!real) return fail(res, 403, 'PATH_OUTSIDE_ROOT', 'path must be inside a registered root')
        const format = detectFormat(basename(real))
        if (format !== 'onnx') return fail(res, 400, 'NOT_ONNX', 'model file must be .onnx')
        let size = 0, mtime = 0
        try {
          const st = await stat(real)
          size = st.size
          mtime = st.mtimeMs
        } catch (error) {
          return fail(res, 404, 'NOT_FOUND', error instanceof Error ? error.message : String(error))
        }
        try {
          const buf = await readFile(real)
          const model = parseOnnx(buf)
          const g = onnxToGraph(model)
          ok(res, {
            path: real, name: basename(real), format, size, mtime,
            graph: { nodes: g.nodes, edges: g.edges },
            model: g.meta,
            reason: null,
          })
        } catch (error) {
          ok(res, {
            path: real, name: basename(real), format, size, mtime,
            graph: null,
            model: null,
            reason: 'ONNX 解析失败：' + (error instanceof Error ? error.message : String(error)),
          })
        }
      },
    })

    // ---------- 上传（写入共享「上传」工作区，跨工作区数据池）
    routes.push({
      kind: 'exact',
      path: API.upload,
      handler: async (req, res) => {
        if (guard(req, res, 'POST')) return
        const rawName = (queryParam(req, 'name') || '').trim()
        const name = basename(rawName)
        if (!name || name === '.' || name === '..') return fail(res, 400, 'BAD_NAME', 'file name is required')
        const format = detectFormat(name)
        if (!format) return fail(res, 400, 'UNSUPPORTED_FORMAT', '不支持的文件类型：' + name)
        const buf = await readBody(req, LIMITS.maxBytes)
        if (!buf) return fail(res, 413, 'TOO_LARGE', `文件超过 ${fmtBytes(LIMITS.maxBytes)} 上限`)
        try {
          await mkdir(UPLOAD_DIR, { recursive: true })
          const dest = join(UPLOAD_DIR, name)
          await writeFile(dest, buf)
          const state = await statePromise
          let root = state.roots.find((r) => r.id === UPLOAD_ROOT_ID)
          if (!root) {
            root = { id: UPLOAD_ROOT_ID, path: UPLOAD_DIR, label: '上传数据' }
            state.roots.push(root)
            await saveState(state)
          }
          ok(res, { path: dest, name, size: buf.length, format, rootId: UPLOAD_ROOT_ID })
        } catch (error) {
          fail(res, 500, 'WRITE_FAILED', error instanceof Error ? error.message : String(error))
        }
      },
    })

    // ---------- 结构化分析报告（本地规则式洞察，无需 LLM）
    routes.push({
      kind: 'exact',
      path: API.report,
      handler: async (req, res) => {
        if (guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const paths = Array.isArray(body?.paths) ? body.paths.filter((p) => typeof p === 'string').slice(0, 20) : []
        if (paths.length === 0) return fail(res, 400, 'NO_PATHS', 'paths is required')
        const state = await statePromise
        const items = []
        const workspaces = new Set()
        for (const p of paths) {
          const real = await resolveInsideRoot(state, p)
          if (!real) { items.push({ name: basename(p), path: p, error: '路径不在任何已登记根目录内' }); continue }
          const opened = await openDatasetFile(state, real, {})
          if (opened.error) { items.push({ name: basename(real), path: real, error: opened.error.message }); continue }
          const ds = opened.dataset
          const profiles = ds.columns.map((c) => profileColumn(c))
          const correlation = pearson(ds.columns)
          for (const root of state.roots) {
            if (isSameOrInside(root.path, real)) { workspaces.add(root.label || basename(root.path)); break }
          }
          items.push({
            name: ds.name, path: real, rowCount: ds.rowCount, columnCount: ds.columnCount,
            insights: buildInsights(ds), profiles, correlation,
          })
        }
        const markdown = buildReportMarkdown(items, { workspaces: [...workspaces] })
        ok(res, {
          markdown,
          datasets: items.map((it) => ({ name: it.name, path: it.path, rowCount: it.rowCount, columnCount: it.columnCount, error: it.error })),
        })
      },
    })

    // ---------- 诊断
    routes.push({
      kind: 'exact',
      path: API.diagnostics,
      handler: async (req, res) => {
        if (guard(req, res, 'GET')) return
        const state = await statePromise
        ok(res, {
          plugin: 'dsh-datapilot',
          version: PLUGIN_VERSION,
          dataDir: DATA_DIR,
          roots: state.roots,
          openDatasets: [...openDatasets.keys()].map((id) => {
            const e = openDatasets.get(id)
            return { id, name: e.dataset.name, format: e.dataset.format, rowCount: e.dataset.rowCount }
          }),
          recentErrors: errorLog,
          capabilities: await detectCapabilities(),
        })
      },
    })

    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-datapilot: routes')
}
