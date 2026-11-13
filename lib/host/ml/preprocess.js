// DataPilot ML 数据预处理（纯 JS，无第三方依赖）

// 可复现 PRNG（mulberry32）
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 返回洗牌后的索引数组（不修改原数据）
export function shuffleIdx(n, seed = 42) {
  const rnd = mulberry32(seed);
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx;
}

// train/test split；stratifyBy 为分类标签编码数组时按类别分层
export function trainTestSplit(n, testSplit = 0.2, seed = 42, stratifyBy = null) {
  const train = [], test = [];
  if (stratifyBy && stratifyBy.length === n) {
    const classes = new Map();
    for (let i = 0; i < n; i++) {
      const c = stratifyBy[i];
      if (!classes.has(c)) classes.set(c, []);
      classes.get(c).push(i);
    }
    for (const idxs of classes.values()) {
      const order = shuffleIdx(idxs.length, seed);
      const testCount = Math.max(1, Math.round(idxs.length * testSplit));
      for (let t = 0; t < order.length; t++) {
        const orig = idxs[order[t]];
        if (t < testCount) test.push(orig); else train.push(orig);
      }
    }
  } else {
    const order = shuffleIdx(n, seed);
    const testCount = Math.max(0, Math.min(n - 1, Math.round(n * testSplit)));
    for (let t = 0; t < n; t++) {
      if (t < testCount) test.push(order[t]); else train.push(order[t]);
    }
  }
  // 最终再洗一次顺序，保证训练集内部也随机
  return { train: shuffleIdx(train.length, seed + 1).map(i => train[i]), test };
}

// 标签编码：返回 codes（整数）与 labels（原值列表）
export function labelEncode(values) {
  const labels = [];
  const map = new Map();
  const codes = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    let c = map.get(v);
    if (c === undefined) {
      c = labels.length;
      map.set(v, c);
      labels.push(v);
    }
    codes[i] = c;
  }
  return { codes, labels };
}

// z-score 标准化（逐列）；返回新矩阵 + mean/std 统计
export function standardize(X) {
  const rows = X.length;
  if (rows === 0) return { X, mean: [], std: [] };
  const cols = X[0].length;
  const mean = new Array(cols).fill(0);
  const std = new Array(cols).fill(0);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) mean[j] += X[i][j];
  for (let j = 0; j < cols; j++) mean[j] /= rows;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const d = X[i][j] - mean[j]; std[j] += d * d; }
  for (let j = 0; j < cols; j++) std[j] = Math.sqrt(std[j] / rows) || 1;
  const out = new Array(rows);
  for (let i = 0; i < rows; i++) {
    const row = new Array(cols);
    for (let j = 0; j < cols; j++) row[j] = (X[i][j] - mean[j]) / std[j];
    out[i] = row;
  }
  return { X: out, mean, std };
}

// 判断是否为数值列类型
export function isNumericType(type) {
  return type === 'float64' || type === 'int64';
}

// 从列对象构建特征矩阵 X 与目标 y（含类别特征 one-hot、目标标签编码）
// columns: { name: { type, values: number[] | string[] } }
// 返回 { X, y, yLabels, featureNames, droppedRows, warnings }
export function prepareData(columns, features, target, targetKind, missing = 'drop') {
  const warnings = [];
  const rowCount = (columns[target] && columns[target].values.length) || (columns[features[0]] && columns[features[0]].values.length) || 0;
  // 1) 确定有效行（缺失处理）
  let validRows = new Array(rowCount).fill(true);
  if (missing === 'drop') {
    for (const name of features.concat([target])) {
      const col = columns[name];
      if (!col) continue;
      const vals = col.values;
      for (let i = 0; i < rowCount; i++) {
        const v = vals[i];
        if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v)) || v === '') {
          validRows[i] = false;
        }
      }
    }
  }
  const keepIdx = [];
  for (let i = 0; i < rowCount; i++) if (validRows[i]) keepIdx.push(i);
  const droppedRows = rowCount - keepIdx.length;
  if (droppedRows > 0) warnings.push(`已剔除 ${droppedRows} 行含缺失值的样本`);

  // 2) 目标列（聚类/降维无目标时 y 为 null）
  const tcol = columns[target];
  let y = null, yLabels = null;
  if (tcol) {
    if (targetKind === 'categorical') {
      const enc = labelEncode(keepIdx.map(i => tcol.values[i]));
      y = enc.codes;
      yLabels = enc.labels;
    } else {
      y = keepIdx.map(i => Number(tcol.values[i]));
    }
  }

  // 3) 特征矩阵（类别特征 one-hot）
  const encodedBlocks = []; // 每个特征一个块（数值列 1 列 / 类别列 k 列）
  const featureNames = [];
  for (const name of features) {
    const col = columns[name];
    if (!col) { warnings.push(`特征列「${name}」不存在，已跳过`); continue; }
    if (isNumericType(col.type) || typeof col.values[keepIdx[0]] === 'number') {
      const block = keepIdx.map(i => Number(col.values[i]));
      encodedBlocks.push(block.map(v => [v]));
      featureNames.push(name);
    } else {
      const enc = labelEncode(keepIdx.map(i => col.values[i]));
      const k = enc.labels.length;
      // 构造 one-hot 块（每个类别一列）
      const blocks = Array.from({ length: k }, () => new Array(keepIdx.length).fill(0));
      for (let i = 0; i < keepIdx.length; i++) blocks[enc.codes[i]][i] = 1;
      for (let c = 0; c < k; c++) {
        encodedBlocks.push(blocks[c].map(v => [v]));
        featureNames.push(`${name}=${enc.labels[c]}`);
      }
    }
  }

  // 4) 组装 X（rows × cols）
  const n = keepIdx.length;
  const X = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = [];
    for (const block of encodedBlocks) row.push(block[i][0]);
    X[i] = row;
  }
  return { X, y, yLabels, featureNames, droppedRows, warnings, validIndices: keepIdx };
}
