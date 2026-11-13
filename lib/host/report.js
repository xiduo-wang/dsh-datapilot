/**
 * dsh-datapilot — 结构化分析报告与规则式洞察（本地，无 LLM 依赖）。
 *
 * 输入：已打开的数据集（engine.buildDataset 产物）。输出：
 *   - buildInsights(ds)  → [{ kind, column?, text }]  规则式发现
 *   - buildReportMarkdown(items) → string              Markdown 报告全文
 * @module dsh-datapilot/report
 */

import { pearson, profileColumn } from './engine.js'

const NUMERIC = new Set(['int64', 'float64'])

export function fmtNum(v, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return Number(v).toFixed(digits)
}

/** 针对一个已打开数据集产出结构化洞察（规则式）。 */
export function buildInsights(ds) {
  const insights = []
  const numeric = ds.columns.filter((c) => NUMERIC.has(c.type))
  const categorical = ds.columns.filter((c) => !NUMERIC.has(c.type))
  insights.push({ kind: 'meta', text: `共 ${ds.rowCount} 行 × ${ds.columnCount} 列（${numeric.length} 数值列，${categorical.length} 类别列）` })

  const totalMissing = ds.columns.reduce((s, c) => s + (profileColumn(c).nullCount || 0), 0)
  const cells = ds.rowCount * ds.columnCount
  insights.push(cells > 0 && totalMissing > 0
    ? { kind: 'quality', text: `整体缺失率 ${(totalMissing / cells * 100).toFixed(2)}%（${totalMissing}/${cells} 单元格）` }
    : { kind: 'quality', text: '无缺失值' })

  for (const c of numeric) {
    const p = profileColumn(c)
    if (!p || !Number.isFinite(p.mean)) continue
    const std = p.std || 0
    const qr = (p.p75 || 0) - (p.p25 || 0)
    let note = `「${c.name}」均值 ${fmtNum(p.mean)}，σ ${fmtNum(std)}，P50 ${fmtNum(p.p50)}，范围 [${fmtNum(p.min)}, ${fmtNum(p.max)}]`
    if (std > 0 && Math.abs(p.mean - p.p50) > 0.5 * std) note += '；偏态明显（均值偏离中位数）'
    if (qr > 0 && p.p99 !== undefined && p.p01 !== undefined && (p.p99 - p.p01) > 8 * qr) note += '；存在离群值'
    insights.push({ kind: 'numeric', column: c.name, text: note })
  }

  for (const c of categorical) {
    const p = profileColumn(c)
    if (!p) continue
    const total = (p.count || 0) - (p.nullCount || 0)
    if (p.top && p.top.length) {
      const topShare = total > 0 ? (p.top[0].count / total * 100).toFixed(1) : '0'
      let note = `「${c.name}」${p.distinct} 类，最多为「${p.top[0].value}」（${topShare}%）`
      if (p.distinct === 1) note += '；该列为常量'
      else if (total > 0 && p.top[0].count / total > 0.9) note += '；类别严重失衡'
      insights.push({ kind: 'categorical', column: c.name, text: note })
    }
  }

  if (numeric.length >= 2) {
    const corr = pearson(ds.columns)
    const strong = []
    for (let i = 0; i < corr.labels.length; i++) {
      for (let j = i + 1; j < corr.labels.length; j++) {
        const r = corr.matrix[i][j]
        if (Number.isFinite(r) && Math.abs(r) >= 0.7) strong.push(`${corr.labels[i]} ↔ ${corr.labels[j]} (r=${r.toFixed(3)})`)
      }
    }
    if (strong.length) insights.push({ kind: 'correlation', text: '强相关变量对：' + strong.join('；') })
  }
  return insights
}

/** 由多条数据集记录生成完整 Markdown 报告。 */
export function buildReportMarkdown(items, meta) {
  const lines = ['# DataPilot 数据分析报告', '']
  lines.push(`- 生成时间：${new Date().toLocaleString()}`)
  if (meta?.workspaces?.length) lines.push(`- 覆盖工作区：${meta.workspaces.join('、')}`)
  lines.push('')

  for (const it of items) {
    lines.push(`## ${it.name}`, '')
    lines.push(`- 文件：\`${it.path}\``)
    lines.push(`- 规模：${it.rowCount} 行 × ${it.columnCount} 列`)
    lines.push('')
    if (it.insights?.length) {
      lines.push('### 洞察', '')
      for (const ins of it.insights) lines.push(`- ${ins.text}`)
      lines.push('')
    }
    if (it.profiles?.length) {
      lines.push('### 列画像', '')
      lines.push('| 列 | 类型 | 缺失 | 去重 | 关键统计 |')
      lines.push('|---|---|---|---|---|')
      for (const p of it.profiles) {
        if (p.error) { lines.push(`| ${p.name} | — | — | — | 无法分析 |`); continue }
        const stat = NUMERIC.has(p.type)
          ? `μ ${fmtNum(p.mean)} / σ ${fmtNum(p.std)} / P50 ${fmtNum(p.p50)} / [${fmtNum(p.min)}, ${fmtNum(p.max)}]`
          : (p.top?.length ? 'top: ' + p.top.slice(0, 3).map((t) => `${t.value}(${t.count})`).join(', ') : '')
        lines.push(`| ${p.name} | ${p.type} | ${p.nullCount} | ${p.distinct} | ${stat} |`)
      }
      lines.push('')
    }
    if (it.correlation && it.correlation.labels.length >= 2) {
      lines.push('### 相关矩阵（数值列）', '')
      lines.push('| | ' + it.correlation.labels.join(' | ') + ' |')
      lines.push('|' + '---|'.repeat(it.correlation.labels.length + 1))
      it.correlation.labels.forEach((lbl, i) => {
        lines.push('| ' + [lbl, ...it.correlation.matrix[i].map((v) => fmtNum(v, 2))].join(' | ') + ' |')
      })
      lines.push('')
    }
  }
  return lines.join('\n')
}
