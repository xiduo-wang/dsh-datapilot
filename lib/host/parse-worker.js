/**
 * dsh-datapilot — 解析 Worker 线程。
 *
 * 把「读文件 + 解析」这步 CPU/IO 密集的工作从宿主事件循环搬到独立线程，
 * 大文件加载时宿主仍能响应其他请求（按钮不卡死）。
 *
 * workerData: { filePath, format, parse? }
 * postMessage: { header, rows } | { sheets:[{name,header,rows}] } | { error: string }
 * @module dsh-datapilot
 */

import { parentPort, workerData } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import { parseCSV, parseJSONL } from './engine.js'
import { parseJSONText, parseParquet, parseXls, parseXlsx } from './parsers.js'

const { filePath, format, parse } = workerData || {}

async function run() {
  try {
    if (format === 'csv') {
      const text = await readFile(filePath, 'utf8')
      const delimiter = parse && typeof parse.delimiter === 'string' ? parse.delimiter : undefined
      const { header, rows } = parseCSV(text, { delimiter, header: parse?.header !== false })
      parentPort.postMessage({ header, rows })
      return
    }
    if (format === 'jsonl') {
      const text = await readFile(filePath, 'utf8')
      const { header, rows } = parseJSONL(text)
      parentPort.postMessage({ header, rows })
      return
    }
    if (format === 'json') {
      const text = await readFile(filePath, 'utf8')
      const { header, rows } = parseJSONText(text)
      parentPort.postMessage({ header, rows })
      return
    }
    if (format === 'xlsx' || format === 'xls') {
      const buf = await readFile(filePath)
      const parsed = format === 'xlsx' ? parseXlsx(buf) : await parseXls(buf)
      parentPort.postMessage({ sheets: parsed.sheets.map((s) => ({ name: s.name, header: s.header, rows: s.rows })) })
      return
    }
    if (format === 'parquet') {
      const buf = await readFile(filePath)
      const { header, rows } = await parseParquet(buf)
      parentPort.postMessage({ header, rows })
      return
    }
    parentPort.postMessage({ error: `no parser for ${format}` })
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}

run()
