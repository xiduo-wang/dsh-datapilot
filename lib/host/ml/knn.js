// DataPilot ML：KNN（分类 + 回归）

function euclidean(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

// 分类：多数投票；回归：均值
export function knn(Xtrain, ytrain, Xtest, { k = 5, regression = false } = {}) {
  const kk = Math.max(1, Math.min(k, Xtrain.length));
  return Xtest.map(xt => {
    const dists = Xtrain.map((x, i) => ({ d: euclidean(x, xt), i }));
    dists.sort((a, b) => a.d - b.d);
    const top = dists.slice(0, kk);
    if (regression) {
      let s = 0;
      for (const t of top) s += ytrain[t.i];
      return s / kk;
    }
    const votes = new Map();
    for (const t of top) {
      const y = ytrain[t.i];
      votes.set(y, (votes.get(y) || 0) + 1);
    }
    let best = null, bestCount = -1;
    for (const [y, c] of votes) {
      if (c > bestCount || (c === bestCount && y < best)) { best = y; bestCount = c; }
    }
    return best;
  });
}
