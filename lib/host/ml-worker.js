/**
 * dsh-datapilot — ML 训练 Worker 线程。
 *
 * 把 CPU 密集的模型训练（尤其 MLP 反向传播、K-Means 迭代）从宿主事件循环搬到独立线程，
 * 训练期间宿主仍能响应其他请求。
 *
 * workerData: { columns, features, target, targetKind, task, model, params, testSplit, seed }
 * postMessage: { result } | { error: string }
 * @module dsh-datapilot
 */

import { parentPort, workerData } from 'node:worker_threads'
import { runTraining } from './ml/index.js'

try {
  const result = runTraining(workerData)
  if (result && result.error) {
    parentPort.postMessage({ error: result.error })
  } else {
    parentPort.postMessage({ result })
  }
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) })
}
