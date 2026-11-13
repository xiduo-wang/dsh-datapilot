// DataPilot ML：小型 MLP（可配层，反向传播，SGD/Adam，逐 epoch 记录 loss 与梯度范数）

function relu(z) { return z > 0 ? z : 0; }
function reluGrad(a) { return a > 0 ? 1 : 0; }
function tanh(z) { return Math.tanh(z); }
function tanhGrad(a) { return 1 - a * a; }
function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }
function sigmoidGrad(a) { return a * (1 - a); }

const ACT = {
  relu: { f: relu, g: reluGrad },
  tanh: { f: tanh, g: tanhGrad },
  sigmoid: { f: sigmoid, g: sigmoidGrad },
};

function matMul(A, B) {
  // A: n×k, B: k×m -> n×m
  const n = A.length, k = A[0].length, m = B[0].length;
  const out = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let t = 0; t < k; t++) s += A[i][t] * B[t][j];
      out[i][j] = s;
    }
  }
  return out;
}

function transposeMul(A, B) {
  // A: n×k, B: n×m -> AᵀB : k×m
  const n = A.length, k = A[0].length, m = B[0].length;
  const out = Array.from({ length: k }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) {
      const a = A[i][j];
      for (let c = 0; c < m; c++) out[j][c] += a * B[i][c];
    }
  }
  return out;
}

function initWeight(rows, cols, seed) {
  // He 初始化
  const std = Math.sqrt(2 / cols);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => (rnd() - 0.5) * 2 * std));
}

function zeros(rows, cols) {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

export function mlp(X, y, {
  task = 'classification', numClasses = 2, hidden = [64, 32],
  activation = 'relu', lr = 0.01, epochs = 300, optimizer = 'adam', seed = 42,
} = {}) {
  const act = ACT[activation] || ACT.relu;
  const n = X.length, dIn = X[0].length;
  const dOut = task === 'classification' ? numClasses : 1;
  const dims = [dIn, ...hidden, dOut];
  const L = dims.length - 1;

  // 权重与偏置：W[l] (dims[l+1] × dims[l])，b[l] (dims[l+1])
  const W = [], b = [];
  for (let l = 0; l < L; l++) {
    W.push(initWeight(dims[l + 1], dims[l], seed + l * 1000));
    b.push(zeros(1, dims[l + 1])[0]);
  }

  // 目标
  const yOnehot = task === 'classification'
    ? y.map(c => { const r = new Array(dOut).fill(0); r[c] = 1; return r; })
    : y.map(v => [v]);

  // Adam 状态
  let mW = null, vW = null, mb = null, vb = null;
  if (optimizer === 'adam') {
    mW = W.map(w => zeros(w.length, w[0].length));
    vW = W.map(w => zeros(w.length, w[0].length));
    mb = b.map(bb => zeros(1, bb.length)[0]);
    vb = b.map(bb => zeros(1, bb.length)[0]);
  }
  let adamT = 0;

  const history = [];
  for (let e = 0; e < epochs; e++) {
    // ---- 前向 ----
    const As = [X];
    const Zs = [];
    let a = X;
    for (let l = 0; l < L; l++) {
      // z = a @ W[l]ᵀ (n × dims[l+1])
      const z = Array.from({ length: n }, (_, i) => {
        const row = new Array(dims[l + 1]);
        for (let o = 0; o < dims[l + 1]; o++) {
          let s = b[l][o];
          for (let k = 0; k < dims[l]; k++) s += a[i][k] * W[l][o][k];
          row[o] = s;
        }
        return row;
      });
      Zs.push(z);
      const isOutput = l === L - 1;
      if (isOutput) {
        a = task === 'classification' ? softmax(z) : z;
      } else {
        a = z.map(row => row.map(act.f));
      }
      As.push(a);
    }
    const output = a;

    // ---- loss ----
    let loss = 0;
    if (task === 'classification') {
      for (let i = 0; i < n; i++) loss += -Math.log(Math.max(output[i][y[i]], 1e-15));
      loss /= n;
    } else {
      for (let i = 0; i < n; i++) loss += (output[i][0] - y[i]) * (output[i][0] - y[i]);
      loss /= n;
    }

    // ---- 反向 ----
    // delta (n × dims[L])
    let delta;
    if (task === 'classification') {
      delta = output.map((p, i) => p.map((pv, c) => (pv - yOnehot[i][c]) / n));
    } else {
      delta = output.map((p, i) => [(p[0] - y[i]) / n]);
    }
    const gW = W.map(w => zeros(w.length, w[0].length));
    const gb = b.map(bb => zeros(1, bb.length)[0]);
    let gradNormSq = 0;
    for (let l = L - 1; l >= 0; l--) {
      // gradW[l] = deltaᵀ @ As[l]  (dims[l+1] × dims[l])
      const aPrev = As[l];
      for (let i = 0; i < n; i++) {
        for (let o = 0; o < dims[l + 1]; o++) {
          const d = delta[i][o];
          gb[l][o] += d;
          for (let k = 0; k < dims[l]; k++) gW[l][o][k] += d * aPrev[i][k];
        }
      }
      for (let o = 0; o < dims[l + 1]; o++) {
        gradNormSq += gb[l][o] * gb[l][o];
        for (let k = 0; k < dims[l]; k++) gradNormSq += gW[l][o][k] * gW[l][o][k];
      }
      if (l > 0) {
        // delta = (delta @ W[l]) * act'(Zs[l-1])
        const prevA = As[l];
        delta = delta.map((row, i) => {
          const out = new Array(dims[l]).fill(0);
          for (let k = 0; k < dims[l]; k++) {
            let s = 0;
            for (let o = 0; o < dims[l + 1]; o++) s += row[o] * W[l][o][k];
            out[k] = s * act.g(prevA[i][k]);
          }
          return out;
        });
      }
    }
    const gradNorm = Math.sqrt(gradNormSq);

    // ---- 更新 ----
    if (optimizer === 'adam') {
      adamT++;
      const b1 = 0.9, b2 = 0.999, eps = 1e-8;
      for (let l = 0; l < L; l++) {
        for (let o = 0; o < dims[l + 1]; o++) {
          mb[l][o] = b1 * mb[l][o] + (1 - b1) * gb[l][o];
          vb[l][o] = b2 * vb[l][o] + (1 - b2) * gb[l][o] * gb[l][o];
          const mhat = mb[l][o] / (1 - Math.pow(b1, adamT));
          const vhat = vb[l][o] / (1 - Math.pow(b2, adamT));
          b[l][o] -= lr * mhat / (Math.sqrt(vhat) + eps);
          for (let k = 0; k < dims[l]; k++) {
            mW[l][o][k] = b1 * mW[l][o][k] + (1 - b1) * gW[l][o][k];
            vW[l][o][k] = b2 * vW[l][o][k] + (1 - b2) * gW[l][o][k] * gW[l][o][k];
            const mh = mW[l][o][k] / (1 - Math.pow(b1, adamT));
            const vh = vW[l][o][k] / (1 - Math.pow(b2, adamT));
            W[l][o][k] -= lr * mh / (Math.sqrt(vh) + eps);
          }
        }
      }
    } else {
      for (let l = 0; l < L; l++) {
        for (let o = 0; o < dims[l + 1]; o++) {
          b[l][o] -= lr * gb[l][o];
          for (let k = 0; k < dims[l]; k++) W[l][o][k] -= lr * gW[l][o][k];
        }
      }
    }

    history.push({ epoch: e, loss, gradNorm });
  }

  // ---- 最终模型（供调用方在测试集上预测）----
  const model = { W, b, dims, activation, task }

  // 层形状（数据流可视化用）
  const layers = dims.map((shape, i) => ({
    name: i === 0 ? 'input' : (i === dims.length - 1 ? 'output' : `dense_${i}`),
    shape: [shape],
  }));

  return { layers, history, model, weightSummary: { nParams: W.reduce((s, w) => s + w.length * w[0].length, 0) + b.reduce((s, bb) => s + bb.length, 0) } };
}

function softmax(z) {
  return z.map(row => {
    let mx = -Infinity;
    for (const v of row) if (v > mx) mx = v;
    let sum = 0;
    const p = row.map(v => { const e = Math.exp(v - mx); sum += e; return e; });
    return p.map(v => v / sum);
  });
}

export function mlpPredict(model, X) {
  const { W, b, dims, activation, task } = model;
  const act = ACT[activation] || ACT.relu;
  const n = X.length, L = dims.length - 1;
  let a = X;
  for (let l = 0; l < L; l++) {
    const z = Array.from({ length: n }, (_, i) => {
      const row = new Array(dims[l + 1]);
      for (let o = 0; o < dims[l + 1]; o++) {
        let s = b[l][o];
        for (let k = 0; k < dims[l]; k++) s += a[i][k] * W[l][o][k];
        row[o] = s;
      }
      return row;
    });
    if (l === L - 1) {
      a = task === 'classification' ? softmax(z) : z;
    } else {
      a = z.map(row => row.map(act.f));
    }
  }
  if (task === 'classification') {
    return a.map(p => { let best = 0; for (let c = 1; c < p.length; c++) if (p[c] > p[best]) best = c; return best; });
  }
  return a.map(p => p[0]);
}
