// DataPilot ML：K-Means（kmeans++ 初始化 + Lloyd 迭代）

function euclideanSq(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return s;
}

function meanOfPoints(points, dim) {
  const m = new Array(dim).fill(0);
  for (const p of points) for (let j = 0; j < dim; j++) m[j] += p[j];
  for (let j = 0; j < dim; j++) m[j] /= points.length;
  return m;
}

export function kmeans(X, { nClusters = 3, maxIter = 100, seed = 42 } = {}) {
  const n = X.length, dim = X[0].length;
  const k = Math.max(1, Math.min(nClusters, n));
  // kmeans++ 初始化
  let rnd = (() => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
  const centroids = [];
  centroids.push(X[Math.floor(rnd() * n)].slice());
  while (centroids.length < k) {
    const distSq = new Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      for (const c of centroids) { const d = euclideanSq(X[i], c); if (d < best) best = d; }
      distSq[i] = best;
      total += best;
    }
    let r = rnd() * total;
    let pick = 0;
    for (let i = 0; i < n; i++) { r -= distSq[i]; if (r <= 0) { pick = i; break; } }
    centroids.push(X[pick].slice());
  }
  // Lloyd 迭代
  let labels = new Array(n).fill(0);
  let iterations = 0;
  for (let it = 0; it < maxIter; it++) {
    iterations = it + 1;
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = -1, bestD = Infinity;
      for (let c = 0; c < k; c++) { const d = euclideanSq(X[i], centroids[c]); if (d < bestD) { bestD = d; best = c; } }
      if (labels[i] !== best) { labels[i] = best; changed = true; }
    }
    const clusters = Array.from({ length: k }, () => []);
    for (let i = 0; i < n; i++) clusters[labels[i]].push(X[i]);
    for (let c = 0; c < k; c++) {
      if (clusters[c].length > 0) centroids[c] = meanOfPoints(clusters[c], dim);
    }
    if (!changed) break;
  }
  return { centroids, labels, iterations };
}
