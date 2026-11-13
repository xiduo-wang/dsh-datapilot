// 临时冒烟测试：mock webServer，验证 host 路由族能注册并处理 open/profile/scan。
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { apply } from './lib/host/index.js'

// 准备一个测试根目录
const root = join(process.cwd(), '.smoke-root')
rmSync(root, { recursive: true, force: true })
mkdirSync(root, { recursive: true })
writeFileSync(join(root, 'sample.csv'), 'name,loss,acc,dataset\nr1,0.3,0.9,train\nr2,0.4,0.8,valid\nr3,0.2,0.95,train\n')
writeFileSync(join(root, 'model.onnx'), Buffer.from([0x08, 0x01]))

const routes = new Map()
let effectCb
const ctx = {
  logger: { info() {}, warn() {} },
  effect(cb, label) { effectCb = { cb, label }; return cb() },
  webServer: {
    register(route) { routes.set(route.path, route); return () => {} },
  },
}

// 载入 host
await apply(ctx)

function fakeReq({ method = 'GET', url = '/', body } = {}) {
  return {
    method,
    url,
    headers: { host: '127.0.0.1:1', 'sec-fetch-site': 'same-origin', origin: undefined },
    socket: { remoteAddress: '127.0.0.1' },
    [Symbol.asyncIterator]: async function* () { if (body !== undefined) yield Buffer.from(body) },
  }
}
function fakeRes() {
  const r = { status: 0, headers: {}, body: '', end(b) { this.body = typeof b === 'string' ? b : JSON.stringify(b); return this }, writeHead(s, h) { this.status = s; this.headers = h ?? {}; return this } }
  return r
}
async function call(path, opts) {
  const [p, query] = path.split('?')
  const route = routes.get(p)
  if (!route) throw new Error('no route ' + p + '; have ' + [...routes.keys()].join(','))
  const req = fakeReq({ ...opts, url: query ? path.slice(p.length) : (opts?.url ?? '/') })
  const res = fakeRes()
  await route.handler(req, res)
  return { status: res.status, body: res.body }
}

console.log('registered routes:', routes.size)

// 健康
console.log('health:', JSON.stringify(await call('/api/dsh-datapilot/health')))

// 加根
console.log('roots/add:', JSON.stringify(await call('/api/dsh-datapilot/roots/add', { method: 'POST', body: JSON.stringify({ path: root, label: 'smoke' }) })))

// state
const state = await call('/api/dsh-datapilot/state')
console.log('state:', JSON.stringify(state))

// scan
console.log('scan:', JSON.stringify(await call('/api/dsh-datapilot/scan')))

// open
const open = await call('/api/dsh-datapilot/datasets/open', { method: 'POST', body: JSON.stringify({ path: join(root, 'sample.csv') }) })
console.log('open:', JSON.stringify(open))
const openBody = JSON.parse(open.body)
const dsId = openBody.datasetId

// profile
console.log('profile:', JSON.stringify(await call('/api/dsh-datapilot/datasets/profile?id=' + dsId)))
// histogram
console.log('histogram:', JSON.stringify(await call('/api/dsh-datapilot/datasets/histogram?id=' + dsId + '&column=loss&bins=4')))
// preview
console.log('preview:', JSON.stringify(await call('/api/dsh-datapilot/datasets/preview?id=' + dsId + '&limit=2')))
// models meta
console.log('models/meta:', JSON.stringify(await call('/api/dsh-datapilot/models/meta?path=' + encodeURIComponent(join(root, 'model.onnx')))))
// diagnostics
console.log('diagnostics:', JSON.stringify(await call('/api/dsh-datapilot/diagnostics')))

rmSync(root, { recursive: true, force: true })
console.log('SMOKE DONE')
