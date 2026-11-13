// DataPilot ML 指标库（纯 JS，无第三方依赖）
// yTrue / yPred 均为 number[]；分类指标支持标签编码后的整数或原始标签。

export function mean(arr) {
  if (!arr || arr.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

export function mse(yTrue, yPred) {
  const n = Math.min(yTrue.length, yPred.length);
  if (n === 0) return null;
  let s = 0;
  for (let i = 0; i < n; i++) { const d = yTrue[i] - yPred[i]; s += d * d; }
  return s / n;
}

export function rmse(yTrue, yPred) {
  const m = mse(yTrue, yPred);
  return m === null ? null : Math.sqrt(m);
}

export function mae(yTrue, yPred) {
  const n = Math.min(yTrue.length, yPred.length);
  if (n === 0) return null;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(yTrue[i] - yPred[i]);
  return s / n;
}

export function r2(yTrue, yPred) {
  const n = Math.min(yTrue.length, yPred.length);
  if (n === 0) return null;
  const m = mean(yTrue.slice(0, n));
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (yTrue[i] - m) * (yTrue[i] - m);
    ssRes += (yTrue[i] - yPred[i]) * (yTrue[i] - yPred[i]);
  }
  if (ssTot === 0) return ssRes === 0 ? 1 : 0;
  return 1 - ssRes / ssTot;
}

export function accuracy(yTrue, yPred) {
  const n = Math.min(yTrue.length, yPred.length);
  if (n === 0) return null;
  let c = 0;
  for (let i = 0; i < n; i++) if (yTrue[i] === yPred[i]) c++;
  return c / n;
}

// 混淆矩阵：labels 为类别列表（顺序即矩阵行列顺序）
export function confusionMatrix(yTrue, yPred, labels) {
  const idx = new Map();
  labels.forEach((l, i) => idx.set(l, i));
  const k = labels.length;
  const cm = Array.from({ length: k }, () => new Array(k).fill(0));
  const n = Math.min(yTrue.length, yPred.length);
  for (let i = 0; i < n; i++) {
    const r = idx.has(yTrue[i]) ? idx.get(yTrue[i]) : -1;
    const c = idx.has(yPred[i]) ? idx.get(yPred[i]) : -1;
    if (r >= 0 && c >= 0) cm[r][c]++;
  }
  return cm;
}

// 从混淆矩阵计算 per-class 与 macro/micro 精确率/召回率/F1
export function classificationReport(cm, labels) {
  const k = cm.length;
  const report = { labels, perClass: [], macro: {}, micro: {}, accuracy: null };
  let tpTotal = 0, total = 0;
  const rowSum = new Array(k).fill(0), colSum = new Array(k).fill(0);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      rowSum[i] += cm[i][j];
      colSum[j] += cm[i][j];
      total += cm[i][j];
      if (i === j) tpTotal += cm[i][j];
    }
  }
  for (let i = 0; i < k; i++) {
    const tp = cm[i][i];
    const precision = colSum[i] > 0 ? tp / colSum[i] : 0;
    const recall = rowSum[i] > 0 ? tp / rowSum[i] : 0;
    const f1 = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;
    report.perClass.push({ label: labels[i], precision, recall, f1, support: rowSum[i] });
  }
  const macroP = mean(report.perClass.map(x => x.precision));
  const macroR = mean(report.perClass.map(x => x.recall));
  const macroF1 = mean(report.perClass.map(x => x.f1));
  const microP = total > 0 ? tpTotal / colSum.reduce((a, b) => a + b, 0) : 0;
  const microR = total > 0 ? tpTotal / total : 0;
  const microF1 = (microP + microR) > 0 ? 2 * microP * microR / (microP + microR) : 0;
  report.macro = { precision: macroP, recall: macroR, f1: macroF1 };
  report.micro = { precision: microP, recall: microR, f1: microF1 };
  report.accuracy = total > 0 ? tpTotal / total : null;
  return report;
}

// K-Means 惯性（簇内平方和）
export function inertia(X, labels, centroids) {
  let s = 0;
  const n = X.length;
  const d = centroids[0].length;
  for (let i = 0; i < n; i++) {
    const c = centroids[labels[i]];
    let dist = 0;
    for (let j = 0; j < d; j++) { const diff = X[i][j] - c[j]; dist += diff * diff; }
    s += dist;
  }
  return s;
}

// 轮廓系数（O(n²)，调用前应限制 n ≤ 2000）
export function silhouette(X, labels) {
  const n = X.length;
  const k = Math.max(...labels) + 1;
  if (n < 2 || k < 2) return null;
  const clusters = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) clusters[labels[i]].push(i);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const li = labels[i];
    // a(i)：到同簇其他点的平均距离
    const same = clusters[li];
    let a = 0;
    if (same.length > 1) {
      for (const j of same) {
        if (j === i) continue;
        let d = 0;
        for (let dim = 0; dim < X[i].length; dim++) { const diff = X[i][dim] - X[j][dim]; d += diff * diff; }
        a += Math.sqrt(d);
      }
      a /= (same.length - 1);
    }
    // b(i)：到最近异簇的平均距离
    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === li) continue;
      const other = clusters[c];
      let dsum = 0;
      for (const j of other) {
        let d = 0;
        for (let dim = 0; dim < X[i].length; dim++) { const diff = X[i][dim] - X[j][dim]; d += diff * diff; }
        dsum += Math.sqrt(d);
      }
      const dmean = dsum / other.length;
      if (dmean < b) b = dmean;
    }
    sum += (b - a) / Math.max(a, b);
  }
  return sum / n;
}

// 解释方差比（eigenvalues 降序）
export function explainedVarianceRatio(eigenvalues) {
  const total = eigenvalues.reduce((a, b) => a + b, 0);
  if (total <= 0) return eigenvalues.map(() => 0);
  return eigenvalues.map(e => e / total);
}

// 混淆矩阵 -> 精确率（分类场景统一入口，兼容 labels 缺失时按出现顺序）
export function uniqueLabels(yTrue, yPred) {
  const set = [];
  const seen = new Set();
  for (const v of yTrue.concat(yPred)) {
    if (!seen.has(v)) { seen.add(v); set.push(v); }
  }
  return set;
}
