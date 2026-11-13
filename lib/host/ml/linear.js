// DataPilot ML：线性回归（GD + 正规方程）与逻辑回归（二分类 + softmax 多分类）
// 记录 loss 与梯度范数历史，供前端绘制训练曲线。

function addIntercept(X) {
  return X.map(row => [1, ...row]);
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

function gradNorm(g) {
  let s = 0;
  for (let i = 0; i < g.length; i++) s += g[i] * g[i];
  return Math.sqrt(s);
}

// 线性回归（梯度下降）
export function linearRegressionGD(X, y, { lr = 0.01, epochs = 200, seed = 42 } = {}) {
  const Xa = addIntercept(X);
  const n = Xa.length, d = Xa[0].length;
  let theta = new Array(d).fill(0);
  const history = [];
  for (let e = 0; e < epochs; e++) {
    const pred = new Array(n);
    for (let i = 0; i < n; i++) pred[i] = dot(Xa[i], theta);
    const grad = new Array(d).fill(0);
    let loss = 0;
    for (let i = 0; i < n; i++) {
      const err = pred[i] - y[i];
      loss += err * err;
      for (let j = 0; j < d; j++) grad[j] += Xa[i][j] * err;
    }
    loss /= n;
    for (let j = 0; j < d; j++) grad[j] /= n;
    const gn = gradNorm(grad);
    for (let j = 0; j < d; j++) theta[j] -= lr * grad[j];
    history.push({ epoch: e, loss, gradNorm: gn });
  }
  return { coefficients: theta, history };
}

// 线性回归（正规方程，带 Tikhonov 正则 + 高斯消元求解）
export function linearRegressionNormal(X, y, { reg = 1e-6 } = {}) {
  const Xa = addIntercept(X);
  const n = Xa.length, d = Xa[0].length;
  const A = Array.from({ length: d }, () => new Array(d).fill(0));
  const b = new Array(d).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) {
      b[j] += Xa[i][j] * y[i];
      for (let k = 0; k < d; k++) A[j][k] += Xa[i][j] * Xa[i][k];
    }
  }
  for (let j = 0; j < d; j++) A[j][j] += reg;
  // 高斯消元（带部分主元）
  for (let col = 0; col < d; col++) {
    let piv = col;
    for (let r = col + 1; r < d; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) continue;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = 0; r < d; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c < d; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const theta = new Array(d).fill(0);
  for (let j = 0; j < d; j++) if (Math.abs(A[j][j]) > 1e-12) theta[j] = b[j] / A[j][j];
  return { coefficients: theta, history: [] };
}

export function predictLinear(theta, X) {
  const Xa = addIntercept(X);
  return Xa.map(row => dot(row, theta));
}

// 逻辑回归（二分类 sigmoid 或 softmax 多分类）
export function logisticRegression(X, y, { lr = 0.05, epochs = 300, C = 1.0, numClasses = 2 } = {}) {
  const Xa = addIntercept(X);
  const n = Xa.length, d = Xa[0].length;
  const lambda = 1 / (C || 1.0);
  const history = [];
  let W;
  if (numClasses > 2) {
    // 多分类 softmax：W 为 C×d
    W = Array.from({ length: numClasses }, () => new Array(d).fill(0));
    const onehot = y.map(c => {
      const row = new Array(numClasses).fill(0);
      row[c] = 1;
      return row;
    });
    for (let e = 0; e < epochs; e++) {
      const logits = new Array(n);
      for (let i = 0; i < n; i++) {
        logits[i] = new Array(numClasses);
        for (let c = 0; c < numClasses; c++) logits[i][c] = dot(Xa[i], W[c]);
      }
      const P = new Array(n);
      let loss = 0;
      for (let i = 0; i < n; i++) {
        let mx = -Infinity;
        for (let c = 0; c < numClasses; c++) if (logits[i][c] > mx) mx = logits[i][c];
        let sum = 0;
        const p = new Array(numClasses);
        for (let c = 0; c < numClasses; c++) { p[c] = Math.exp(logits[i][c] - mx); sum += p[c]; }
        for (let c = 0; c < numClasses; c++) p[c] /= sum;
        P[i] = p;
        loss += -Math.log(Math.max(p[y[i]], 1e-15));
      }
      loss /= n;
      const grad = Array.from({ length: numClasses }, () => new Array(d).fill(0));
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < numClasses; c++) {
          const err = P[i][c] - onehot[i][c];
          for (let j = 0; j < d; j++) grad[c][j] += err * Xa[i][j];
        }
      }
      let gn = 0;
      for (let c = 0; c < numClasses; c++) {
        for (let j = 0; j < d; j++) {
          grad[c][j] = grad[c][j] / n + lambda * W[c][j];
          gn += grad[c][j] * grad[c][j];
        }
      }
      for (let c = 0; c < numClasses; c++) for (let j = 0; j < d; j++) W[c][j] -= lr * grad[c][j];
      history.push({ epoch: e, loss, gradNorm: Math.sqrt(gn) });
    }
  } else {
    // 二分类 sigmoid
    let theta = new Array(d).fill(0);
    for (let e = 0; e < epochs; e++) {
      const pred = new Array(n);
      let loss = 0;
      for (let i = 0; i < n; i++) {
        const p = sigmoid(dot(Xa[i], theta));
        pred[i] = p;
        loss += -(y[i] * Math.log(Math.max(p, 1e-15)) + (1 - y[i]) * Math.log(Math.max(1 - p, 1e-15)));
      }
      loss /= n;
      const grad = new Array(d).fill(0);
      for (let i = 0; i < n; i++) {
        const err = pred[i] - y[i];
        for (let j = 0; j < d; j++) grad[j] += Xa[i][j] * err;
      }
      for (let j = 0; j < d; j++) grad[j] = grad[j] / n + lambda * theta[j];
      const gn = gradNorm(grad);
      for (let j = 0; j < d; j++) theta[j] -= lr * grad[j];
      history.push({ epoch: e, loss, gradNorm: gn });
    }
    W = [theta];
  }
  return { coefficients: W, history };
}

// 逻辑回归预测（返回类别整数）
export function predictLogistic(W, X) {
  const Xa = addIntercept(X);
  const C = W.length;
  return Xa.map(row => {
    if (C === 1) return sigmoid(dot(row, W[0])) >= 0.5 ? 1 : 0;
    const logits = new Array(C);
    let mx = -Infinity;
    for (let c = 0; c < C; c++) { logits[c] = dot(row, W[c]); if (logits[c] > mx) mx = logits[c]; }
    let best = 0;
    for (let c = 1; c < C; c++) if (logits[c] > logits[best]) best = c;
    return best;
  });
}
