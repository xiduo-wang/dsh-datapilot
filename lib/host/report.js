/**
 * dsh-datapilot — 结构化分析报告与规则式洞察（本地，无 LLM 依赖）。
 *
 * 输入：已打开的数据集（engine.buildDataset 产物）。输出：
 *   - buildInsights(ds, lang)      → [{ kind, column?, text }]  规则式发现
 *   - buildReportMarkdown(items, meta, lang) → string            Markdown 报告全文
 * lang: 'zh' | 'en'
 * @module dsh-datapilot/report
 */

import { pearson, profileColumn } from './engine.js'

const NUMERIC = new Set(['int64', 'float64'])

export function fmtNum(v, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return Number(v).toFixed(digits)
}

const STR = {
  zh: {
    meta: (r, c, n, g) => `共 ${r} 行 × ${c} 列（${n} 数值列，${g} 类别列）`,
    quality: (pct, miss, cells) => `整体缺失率 ${pct}%（${miss}/${cells} 单元格）`,
    noMissing: '无缺失值',
    numericNote: (name, p, std) => `「${name}」均值 ${fmtNum(p.mean)}，σ ${fmtNum(std)}，P50 ${fmtNum(p.p50)}，范围 [${fmtNum(p.min)}, ${fmtNum(p.max)}]`,
    skewed: '；偏态明显（均值偏离中位数）',
    outliers: '；存在离群值',
    catNote: (name, distinct, topValue, share) => `「${name}」${distinct} 类，最多为「${topValue}」（${share}%）`,
    constant: '；该列为常量',
    imbalanced: '；类别严重失衡',
    strongPairs: '强相关变量对：',
    title: '# DataPilot 数据分析报告',
    generatedAt: '生成时间',
    coveredWorkspaces: '覆盖工作区',
    file: '文件',
    scale: '规模',
    rowsCols: (r, c) => `${r} 行 × ${c} 列`,
    insights: '### 洞察',
    profiles: '### 列画像',
    th: '| 列 | 类型 | 缺失 | 去重 | 关键统计 |',
    unanalyzable: '无法分析',
    corrTitle: '### 相关矩阵（数值列）',
    sep: '、',
  },
  en: {
    meta: (r, c, n, g) => `${r} rows × ${c} columns (${n} numeric, ${g} categorical)`,
    quality: (pct, miss, cells) => `Overall missing rate ${pct}% (${miss}/${cells} cells)`,
    noMissing: 'No missing values',
    numericNote: (name, p, std) => `"${name}" mean ${fmtNum(p.mean)}, σ ${fmtNum(std)}, P50 ${fmtNum(p.p50)}, range [${fmtNum(p.min)}, ${fmtNum(p.max)}]`,
    skewed: '; clearly skewed (mean far from median)',
    outliers: '; outliers present',
    catNote: (name, distinct, topValue, share) => `"${name}" has ${distinct} categories, most frequent "${topValue}" (${share}%)`,
    constant: '; constant column',
    imbalanced: '; heavily imbalanced',
    strongPairs: 'Strongly correlated pairs: ',
    title: '# DataPilot Analysis Report',
    generatedAt: 'Generated at',
    coveredWorkspaces: 'Workspaces covered',
    file: 'File',
    scale: 'Size',
    rowsCols: (r, c) => `${r} rows × ${c} columns`,
    insights: '### Insights',
    profiles: '### Column profiles',
    th: '| Column | Type | Missing | Distinct | Key stats |',
    unanalyzable: 'Not analyzable',
    corrTitle: '### Correlation matrix (numeric columns)',
    sep: ', ',
  },
}

const pick = (lang) => (lang === 'en' ? STR.en : STR.zh)

/** 针对一个已打开数据集产出结构化洞察（规则式）。 */
export function buildInsights(ds, lang = 'zh') {
  const L = pick(lang)
  const insights = []
  const numeric = ds.columns.filter((c) => NUMERIC.has(c.type))
  const categorical = ds.columns.filter((c) => !NUMERIC.has(c.type))
  insights.push({ kind: 'meta', text: L.meta(ds.rowCount, ds.columnCount, numeric.length, categorical.length) })

  const totalMissing = ds.columns.reduce((s, c) => s + (profileColumn(c).nullCount || 0), 0)
  const cells = ds.rowCount * ds.columnCount
  insights.push(cells > 0 && totalMissing > 0
    ? { kind: 'quality', text: L.quality((totalMissing / cells * 100).toFixed(2), totalMissing, cells) }
    : { kind: 'quality', text: L.noMissing })

  for (const c of numeric) {
    const p = profileColumn(c)
    if (!p || !Number.isFinite(p.mean)) continue
    const std = p.std || 0
    const qr = (p.p75 || 0) - (p.p25 || 0)
    let note = L.numericNote(c.name, p, std)
    if (std > 0 && Math.abs(p.mean - p.p50) > 0.5 * std) note += L.skewed
    if (qr > 0 && p.p99 !== undefined && p.p01 !== undefined && (p.p99 - p.p01) > 8 * qr) note += L.outliers
    insights.push({ kind: 'numeric', column: c.name, text: note })
  }

  for (const c of categorical) {
    const p = profileColumn(c)
    if (!p) continue
    const total = (p.count || 0) - (p.nullCount || 0)
    if (p.top && p.top.length) {
      const topShare = total > 0 ? (p.top[0].count / total * 100).toFixed(1) : '0'
      let note = L.catNote(c.name, p.distinct, p.top[0].value, topShare)
      if (p.distinct === 1) note += L.constant
      else if (total > 0 && p.top[0].count / total > 0.9) note += L.imbalanced
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
    if (strong.length) insights.push({ kind: 'correlation', text: L.strongPairs + strong.join(lang === 'en' ? '; ' : '；') })
  }
  return insights
}

/** 由多条数据集记录生成完整 Markdown 报告。 */
export function buildReportMarkdown(items, meta, lang = 'zh') {
  const L = pick(lang)
  const lines = [L.title, '']
  lines.push(`- ${L.generatedAt}: ${new Date().toLocaleString()}`)
  if (meta?.workspaces?.length) lines.push(`- ${L.coveredWorkspaces}: ${meta.workspaces.join(L.sep)}`)
  lines.push('')

  for (const it of items) {
    lines.push(`## ${it.name}`, '')
    if (it.error) {
      lines.push(`- ${it.error}`)
      lines.push('')
      continue
    }
    lines.push(`- ${L.file}: \`${it.path}\``)
    lines.push(`- ${L.scale}: ${L.rowsCols(it.rowCount, it.columnCount)}`)
    lines.push('')
    if (it.insights?.length) {
      lines.push(L.insights, '')
      for (const ins of it.insights) lines.push(`- ${ins.text}`)
      lines.push('')
    }
    if (it.profiles?.length) {
      lines.push(L.profiles, '')
      lines.push(L.th)
      lines.push('|---|---|---|---|---|')
      for (const p of it.profiles) {
        if (p.error) { lines.push(`| ${p.name} | — | — | — | ${L.unanalyzable} |`); continue }
        const stat = NUMERIC.has(p.type)
          ? `μ ${fmtNum(p.mean)} / σ ${fmtNum(p.std)} / P50 ${fmtNum(p.p50)} / [${fmtNum(p.min)}, ${fmtNum(p.max)}]`
          : (p.top?.length ? 'top: ' + p.top.slice(0, 3).map((t) => `${t.value}(${t.count})`).join(', ') : '')
        lines.push(`| ${p.name} | ${p.type} | ${p.nullCount} | ${p.distinct} | ${stat} |`)
      }
      lines.push('')
    }
    if (it.correlation && it.correlation.labels.length >= 2) {
      lines.push(L.corrTitle, '')
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
