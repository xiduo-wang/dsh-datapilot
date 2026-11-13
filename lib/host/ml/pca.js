// DataPilot ML：PCA（协方差 + 幂迭代求主成分）

function matVec(M, v) {
  const out = new Array(M.length).fill(0);
  for (let i = 0; i < M.length; i++) {
    let s = 0;
    for (let j = 0; j < M.length; j++) s += M[i][j] * v[j];
    out[i] = s;
  }
  return out;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(v) {
  return Math.sqrt(dot(v, v)) || 1;
}

// 幂迭代 + deflation 求前 k 个特征对（降序）
function powerIteration(A, k, maxIter = 300) {
  const d = A.length;
  const eigvals = [];
  const eigvecs = [];
  let M = A.map(row => row.slice());
  let rnd = (() => { let s = 12345; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
  for (let comp = 0; comp < k && comp < d; comp++) {
    let v = new Array(d);
    for (let i = 0; i < d; i++) v[i] = rnd() - 0.5;
    let n = norm(v);
    v = v.map(x => x / n);
    let lambda = 0;
    for (let it = 0; it < maxIter; it++) {
      const Av = matVec(M, v);
      const n2 = norm(Av);
      if (n2 < 1e-12) break;
      const vNext = Av.map(x => x / n2);
      lambda = dot(vNext, matVec(M, vNext));
      const diff = v.reduce((s, x, i) => s + Math.abs(x - vNext[i]), 0);
      v = vNext;
      if (diff < 1e-10) break;
    }
    eigvals.push(lambda);
    eigvecs.push(v);
    // deflate
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) M[i][j] -= lambda * v[i] * v[j];
  }
  return { eigvals, eigvecs };
}

// X：n×d 数值矩阵；返回 { projections, components, explainedVariance, mean }
export function pca(X, { nComponents = 2 } = {}) {
  const n = X.length, d = X[0].length;
  const k = Math.max(1, Math.min(nComponents, d));
  // 中心化
  const mean = new Array(d).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) mean[j] += X[i][j];
  for (let j = 0; j < d; j++) mean[j] /= n;
  const centered = X.map(row => row.map((x, j) => x - mean[j]));
  // 协方差
  const cov = Array.from({ length: d }, () => new Array(d).fill(0));
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < d; a++) {
      for (let b = a; b < d; b++) {
        cov[a][b] += centered[i][a] * centered[i][b];
      }
    }
  }
  for (let a = 0; a < d; a++) for (let b = a + 1; b < d; b++) cov[b][a] = cov[a][b];
  for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) cov[a][b] /= n;
  const { eigvals, eigvecs } = powerIteration(cov, k);
  // 投影
  const projections = centered.map(row => eigvecs.map(v => dot(row, v)));
  const components = eigvecs; // 每行是一个主成分方向
  return { projections, components, explainedVariance: eigvals, mean };
}
