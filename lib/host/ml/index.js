// DataPilot ML 训练分派（纯 JS，无第三方依赖）。
// runTraining({ columns, features, target, targetKind, task, model, params, testSplit, seed })
//   -> { metrics, history, predictions, confusion, summary, viz, preprocessing }
// columns: { name: { type, values: number[]|string[] } }（由宿主从 dataset.columns 压平传入）

import {
  accuracy,
  classificationReport,
  confusionMatrix,
  explainedVarianceRatio,
  inertia,
  mae,
  mse,
  r2,
  rmse,
  silhouette,
  uniqueLabels,
} from './metrics.js'
import { isNumericType, prepareData, standardize, trainTestSplit } from './preprocess.js'
import { linearRegressionGD, logisticRegression, predictLinear, predictLogistic } from './linear.js'
import { knn } from './knn.js'
import { kmeans } from './kmeans.js'
import { pca } from './pca.js'
import { mlp, mlpPredict } from './mlp.js'

const MAX_SILHOUETTE_N = 2000

export const CAPABILITIES = {
  tasks: {
    regression: { models: ['linear', 'mlp'] },
    classification: { models: ['logistic', 'knn', 'mlp'] },
    clustering: { models: ['kmeans'] },
    reduction: { models: ['pca'] },
  },
  defaults: {
    testSplit: 0.2,
    seed: 42,
    mlp: { hidden: [64, 32], activation: 'relu', lr: 0.01, epochs: 300, optimizer: 'adam' },
    knn: { k: 5 },
    kmeans: { nClusters: 3 },
    pca: { nComponents: 2 },
    logistic: { lr: 0.05, epochs: 300 },
    linear: { lr: 0.01, epochs: 200 },
  },
}

function minMax(X, j) {
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < X.length; i++) { const v = X[i][j]; if (v < lo) lo = v; if (v > hi) hi = v }
  return { lo, hi }
}

function linspace(lo, hi, n) {
  const out = new Array(n)
  if (n === 1) { out[0] = (lo + hi) / 2; return out }
  for (let i = 0; i < n; i++) out[i] = lo + (hi - lo) * i / (n - 1)
  return out
}

// 分类决策边界：标准化空间前 2 维，50×50 网格逐点预测
function decisionBoundary(predictFn, Xstd, res = 50) {
  const dim = Xstd[0] ? Xstd[0].length : 0
  if (dim < 2) return null
  const { lo: x1lo, hi: x1hi } = minMax(Xstd, 0)
  const { lo: x2lo, hi: x2hi } = minMax(Xstd, 1)
  const pad = 0.05
  const xs = linspace(x1lo - pad, x1hi + pad, res)
  const ys = linspace(x2lo - pad, x2hi + pad, res)
  const grid = new Array(res)
  for (let r = 0; r < res; r++) {
    const row = new Array(res)
    for (let c = 0; c < res; c++) row[c] = predictFn([[xs[c], ys[r]]])[0]
    grid[r] = row
  }
  return { xs, ys, grid }
}

function first2(X, idx) {
  const dim = X[0] ? X[0].length : 0
  if (dim >= 2) return idx.map(i => [X[i][0], X[i][1]])
  return idx.map(i => [X[i][0], i]) // 1 维时第二轴用行号
}

export function runTraining({ columns, features, target, targetKind, task, model, params = {}, testSplit = 0.2, seed = 42 }) {
  const t0 = Date.now()
  const prep = prepareData(columns, features, target, targetKind)
  const { X, y, yLabels, featureNames, droppedRows, warnings, validIndices } = prep
  const n = X.length
  if (n === 0) {
    return { error: 'preprocessing produced no valid rows (all samples dropped for missing values)' }
  }
  const dim = X[0].length
  if (dim === 0) {
    return { error: 'no numeric features after encoding (check that at least one feature column exists)' }
  }

  // 标准化（训练集拟合），one-hot 列也一并标准化（MVP 简化）
  const { X: XstdAll, mean: mu, std: sd } = standardize(X)
  const Xall = XstdAll

  let result = {
    model, task, seed, testSplit,
    preprocessing: { featureNames, yLabels, droppedRows, warnings, trainRows: 0, testRows: 0, standardization: { mean: mu, std: sd } },
    metrics: {}, history: [], predictions: null, confusion: null, summary: {}, viz: {},
  }

  if (task === 'clustering') {
    const { nClusters = 3, maxIter = 100 } = params
    const { centroids, labels, iterations } = kmeans(Xall, { nClusters, maxIter, seed })
    const sil = n <= MAX_SILHOUETTE_N ? silhouette(Xall, labels) : null
    result.metrics = { inertia: inertia(Xall, labels, centroids), silhouette: sil }
    result.summary = { centroids, iterations, nClusters }
    result.predictions = { labels, clusterCount: centroids.length }
    result.viz = { points: first2(Xall, Array.from({ length: n }, (_, i) => i)), pointLabels: labels, centroids: centroids.map(c => [c[0], c[1]]) }
    result.preprocessing.trainRows = n
    return finalize(result, t0)
  }

  if (task === 'reduction') {
    const { nComponents = 2 } = params
    const { projections, components, explainedVariance, mean } = pca(Xall, { nComponents })
    result.metrics = { explainedVarianceRatio: explainedVarianceRatio(explainedVariance) }
    result.summary = { components, explainedVariance, mean }
    result.predictions = { projections: projections.map(p => p.slice(0, 2)) }
    result.viz = { projections: projections.map(p => p.slice(0, 2)) }
    result.preprocessing.trainRows = n
    return finalize(result, t0)
  }

  // 监督任务：train/test split（分类用分层）
  const stratify = targetKind === 'categorical' ? y : null
  const { train, test } = trainTestSplit(n, testSplit, seed, stratify)
  const Xtrain = train.map(i => Xall[i])
  const Xtest = test.map(i => Xall[i])
  const ytrain = train.map(i => y[i])
  const ytest = test.map(i => y[i])
  result.preprocessing.trainRows = Xtrain.length
  result.preprocessing.testRows = Xtest.length

  if (task === 'regression') {
    let yPred, history, summary = {}
    if (model === 'linear') {
      const { coefficients, history: h } = linearRegressionGD(Xtrain, ytrain, params)
      history = h
      yPred = predictLinear(coefficients, Xtest)
      summary = { coefficients }
    } else if (model === 'mlp') {
      const { layers, history: h, model: m, weightSummary } = mlp(Xtrain, ytrain, { ...params, task: 'regression' })
      history = h
      yPred = mlpPredict(m, Xtest)
      summary = { layers, weightSummary }
    } else {
      return { error: `unknown regression model: ${model}` }
    }
    result.metrics = { r2: r2(ytest, yPred), mse: mse(ytest, yPred), rmse: rmse(ytest, yPred), mae: mae(ytest, yPred) }
    result.history = history
    result.predictions = { yTrue: ytest, yPred }
    result.summary = summary
    result.viz = { points: ytest.map((t, i) => [t, yPred[i]]), pointLabels: null }
    return finalize(result, t0)
  }

  if (task === 'classification') {
    const numClasses = yLabels.length
    let yPred, history = [], summary = {}
    if (model === 'logistic') {
      const { coefficients, history: h } = logisticRegression(Xtrain, ytrain, { ...params, numClasses })
      history = h
      yPred = predictLogistic(coefficients, Xtest)
      summary = { coefficients }
    } else if (model === 'knn') {
      yPred = knn(Xtrain, ytrain, Xtest, { k: params.k || 5 })
      summary = { k: params.k || 5 }
    } else if (model === 'mlp') {
      const { layers, history: h, model: m, weightSummary } = mlp(Xtrain, ytrain, { ...params, task: 'classification', numClasses })
      history = h
      yPred = mlpPredict(m, Xtest)
      summary = { layers, weightSummary }
    } else {
      return { error: `unknown classification model: ${model}` }
    }
    const labels = yLabels
    // ytest/yPred 是标签编码后的整数（0..k-1），混淆矩阵需用编码索引；展示标签仍用 yLabels
    const codeLabels = yLabels.map((_, i) => i)
    const cm = confusionMatrix(ytest, yPred, codeLabels)
    const report = classificationReport(cm, labels)
    result.metrics = { accuracy: accuracy(ytest, yPred), precision: report.macro.precision, recall: report.macro.recall, f1: report.macro.f1 }
    result.history = history
    result.predictions = { yTrue: ytest, yPred, labels }
    result.confusion = { matrix: cm, labels, report }
    result.summary = summary
    // 决策边界（标准化空间前 2 维）
    const predictFn = (pts) => {
      if (model === 'logistic') return predictLogistic(summary.coefficients, pts)
      if (model === 'knn') return knn(Xtrain, ytrain, pts, { k: summary.k })
      // MLP 的边界需要重新预测（把已训练的权重带回）——简化：MLP 不画边界
      return null
    }
    result.viz = { points: first2(Xall, test), pointLabels: ytest }
    if (predictFn && (model === 'logistic' || model === 'knn') && dim >= 2) {
      result.viz.boundary = decisionBoundary(predictFn, Xall, 50)
    }
    return finalize(result, t0)
  }

  return { error: `unknown task: ${task}` }
}

function finalize(result, t0) {
  result.durationMs = Date.now() - t0
  return result
}
