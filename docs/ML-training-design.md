# DataPilot「模型训练」功能设计文档

> 版本：v1.0　日期：2026-11-13
> 状态：待评审
> 关联文档：`docs/PRD.md`（主 PRD）、`README.md`

---

## 1. 目标

在 DataPilot 插件中内置「机器学习 / 深度学习传统方法」训练能力：用户上传或挂载数据集后，可以直接在侧边栏面板里训练模型，并得到三类产出：

1. **指标**：回归/分类/聚类/降维的定量评估（R²、MSE、准确率、F1、轮廓系数、解释方差比等）。
2. **训练过程曲线**：loss-epoch 曲线、**梯度范数**-epoch 曲线（重点覆盖用户明确的「梯度/损失」诉求）。
3. **模型数据流可视化**：MLP 网络结构图、决策树图、特征重要性等，展示数据在模型里的流动路径。

设计目标：

- 纯 JavaScript 实现，**不新增第三方数值计算重依赖**（CPU 即可，小数据集毫秒~秒级）。
- 复用现有 host（数据引擎 + worker 线程）与 client（Canvas/SVG 图表）架构，训练在 worker 线程跑，不阻塞主事件循环。
- 与现有「数据看板 / 报告 / 模型视图」并列，作为第三个主入口。

---

## 2. 范围与模型清单

| 类别 | 方法 | 任务 | 说明 |
|---|---|---|---|
| 回归 | 线性回归 | 回归 | 梯度下降 + 正规方程两套求解 |
| 分类/回归 | 逻辑回归 | 分类（二分类 + 多分类 softmax） | 梯度下降 |
| 分类/回归 | KNN | 分类 + 回归 | 欧氏距离，K 近邻，加权可选 |
| 聚类 | K-Means | 聚类 | Lloyd 迭代，kmeans++ 初始化 |
| 降维 | PCA | 降维 | 协方差矩阵 + 幂迭代/QR 求特征值 |
| 分类/回归 | 决策树 | 分类 + 回归 | CART，Gini/熵 + 信息增益 |
| 分类/回归 | 随机森林 | 分类 + 回归 | 决策树 bagging，可并行 |
| 分类 | SVM | 分类 | 线性软间隔（SMO），RBF 核作扩展 |
| 深度学习 | MLP | 分类 + 回归 | 可配层数/神经元，反向传播，逐 epoch 记录 loss + 梯度范数 |

### 分期

- **Phase 1（MVP）**：预处理 + 指标库 + 线性回归、逻辑回归、KNN、K-Means、PCA、MLP；训练 UI、指标卡、loss/梯度曲线、MLP 数据流图、散点/决策边界/混淆矩阵。
- **Phase 2**：决策树、随机森林、SVM；决策树图、特征重要性。
- **Phase 3（打磨）**：交叉验证、更多指标、前向/反向传播动画、RBF 核 SVM。

---

## 3. 架构总览

```
┌────────────────────────────── client (assets/panel.html) ──────────────────────────────┐
│  顶栏新增「训练」入口 btn-train                                                        │
│  训练视图 trainView：                                                                    │
│   左：模型选择 / 列选择（特征 + 目标）/ 超参表单 / 训练按钮                              │
│   中：结果区（指标卡 + 各类图表 canvas / svg）                                           │
│   右：检查器（本次运行的参数与指标摘要）                                                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
        │ fetch 绝对路径 /api/dsh-datapilot/ml/*
        ▼
┌────────────────────────────── host (lib/host/index.js) ───────────────────────────────┐
│  新路由 ml/train：                                                                       │
│    1) 取 openDatasets 里的数据集 → 2) 列编码/标准化/train-test split                       │
│    3) 把 (X,y,Xtest,ytest,config) 丢给 ml-worker.js                                     │
│    4) await worker 结果 → writeJson 返回                                                  │
│  (loopback 栅栏 + guard 与现有路由一致)                                                   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
        │ workerData（结构化克隆）
        ▼
┌────────────────────────────── lib/host/ml-worker.js ──────────────────────────────────┐
│  按 model 分派到 lib/host/ml/*.js 训练，返回 {metrics, history, predictions, summary}   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

- 训练在 worker 线程执行，宿主只做「取数 → 预处理 → 派发 → 等待」，不阻塞事件循环。
- 复用现有 `openDatasets` 内存注册表（`lib/host/index.js` 已实现）与 `lib/host/engine.js` 的列对象。
- 训练结果**不落盘**（内存返回），避免状态污染；后续如需历史记录再加。

---

## 4. 技术选型（纯 JS 算法）

统一放在 `lib/host/ml/` 目录，模块化、无第三方依赖：

| 文件 | 内容 |
|---|---|
| `metrics.js` | R²、MSE、MAE、RMSE、accuracy、precision/recall/F1（micro/macro）、混淆矩阵、轮廓系数、惯性、解释方差比 |
| `preprocess.js` | train/test split（分层可选）、数值标准化（z-score）、one-hot 编码、标签编码、缺失值（均值/众数填充或剔除）、shuffle |
| `linear.js` | 线性回归（GD + 正规方程）、逻辑回归（GD，二分类 + softmax 多分类），记录 loss 历史与梯度范数 |
| `knn.js` | KNN 分类/回归，欧氏距离 |
| `kmeans.js` | K-Means（kmeans++ 初始化、Lloyd 迭代、惯性 + 轮廓系数） |
| `pca.js` | PCA（协方差 + 幂迭代求主特征值/向量，投影到 2D/3D） |
| `tree.js` | CART 决策树（Gini/熵/方差），导出树结构用于画树图；随机森林 bagging |
| `svm.js` | 线性软间隔 SVM（SMO 简化版） |
| `mlp.js` | 小型 MLP：前向 + 反向传播，可配 `layers:[...]`、激活（relu/tanh/sigmoid）、优化器（SGD/动量/Adam 可选），逐 epoch 记录 `loss` 与各层 `gradNorm` |
| `index.js` | 统一 `train(config, data)` 分派入口，返回规范化结果 |

数值精度用 Float64Array 存储，训练数据规模受现有 `LIMITS.maxRows=5_000_000` 约束，但训练默认采样上限（如 50,000 行）以保证交互响应，超限提示。

---

## 5. API 契约（新增路由）

### 5.1 `POST /api/dsh-datapilot/ml/train`

**请求体**（JSON，`readJsonBody` 1MB 上限，仅控制体非数据）：

```json
{
  "datasetId": "iris.csv 的 datasetId",
  "task": "regression | classification | clustering | reduction",
  "model": "linear | logistic | knn | kmeans | pca | tree | forest | svm | mlp",
  "features": ["sepal_length", "sepal_width", "petal_length", "petal_width"],
  "target": "species",
  "targetKind": "numeric | categorical",
  "testSplit": 0.2,
  "seed": 42,
  "params": {
    "epochs": 200, "lr": 0.01, "hidden": [64, 32], "activation": "relu",
    "k": 5, "nClusters": 3, "nEstimators": 50, "maxDepth": 8, "C": 1.0
  }
}
```

**响应**（成功 `{ok:true, ...}`，失败 `{ok:false, error:{code,message}}`）：

```json
{
  "ok": true,
  "runId": "ml-<ts>-<rand>",
  "model": "mlp",
  "task": "classification",
  "metrics": { "accuracy": 0.97, "f1": 0.97, "mse": null, "r2": null, "silhouette": null, ... },
  "history": [ { "epoch": 0, "loss": 1.0986, "gradNorm": 2.35 }, ... ],
  "predictions": { "yTrue": [...], "yPred": [...], "labels": ["setosa", ...] },
  "confusion": [[50,0,0],[0,48,2],[0,1,49]],
  "summary": {
    "coefficients": [0.3, -0.2, ...],        // 线性/逻辑回归
    "tree": { "feature": "petal_width", "threshold": 0.8, "left": {...}, "right": {...}, "leaf": "setosa", "value": [50,0,0] },  // 决策树/森林
    "layers": [ {"name":"input","shape":[4]}, {"name":"dense","shape":[64]}, {"name":"dense","shape":[32]}, {"name":"output","shape":[3]} ],  // MLP
    "components": [[0.36,-0.08,...], ...],   // PCA 主成分
    "centroids": [[...], [...]],             // K-Means
    "explainedVariance": [0.72, 0.23, 0.03],
    "featureImportance": [ {"feature":"petal_width","importance":0.62}, ... ]  // 树/森林
  }
}
```

### 5.2 辅助路由

- `GET /api/dsh-datapilot/ml/capabilities` → `{ok, models:[...], tasks:[...]}`（前端渲染模型清单/表单用，缓存）。

---

## 6. 数据预处理流水线（`preprocess.js`）

1. 取列：`features` + `target` 从 `openDatasets` 的列对象抽取。
2. 类型处理：
   - 数值特征 → z-score 标准化（存 mean/std，预测时复用）。
   - 类别特征 → one-hot（分类树/森林可直接用标签编码，树不需要 one-hot）。
   - 目标：`numeric` → 直接回归；`categorical` → 标签编码（记录 label 映射用于反解）。
3. 缺失值：默认「剔除含缺失的行」并返回 `droppedRows` 提示；数值列可选均值填充（参数 `missing='drop'|'mean'|'mode'`）。
4. `train/test split`：分层抽样（分类目标）或随机抽样，`seed` 可复现。
5. 训练采样上限：`MAX_TRAIN_ROWS=50_000`，超限随机下采样并 `warning`。

---

## 7. UI / UX 设计（`assets/panel.html`）

### 7.1 入口

- 顶栏新增按钮 `#btn-train`「训练」（图标 `cpu`/`beaker` SVG），与「上传/报告」并列。
- 点击进入 `trainView`（新的中心视图模式，与 `board`/`model` 并列），`state.view='train'`。

### 7.2 训练视图布局

```
┌─────────────┬──────────────────────────────┬─────────────┐
│ 左：配置表单 │  中：结果区                    │ 右：检查器   │
│ - 数据集选择 │  - 指标卡行                    │ - 本次运行   │
│   （树选中） │  - loss 曲线 / 梯度曲线（折线） │   参数摘要   │
│ - 任务/模型 │  - 混淆矩阵 / 散点 / 决策边界    │ - 指标复读   │
│ - 特征列多选│  - MLP 数据流图 / 决策树图       │             │
│ - 目标列    │  - PCA 投影 / 聚类散点           │             │
│ - 超参表单  │                              │             │
│ - [训练] 按钮│                              │             │
└─────────────┴──────────────────────────────┴─────────────┘
```

- 特征列多选用「拖选/勾选」复用左侧树，选中列在表单里以 chips 展示，可增减。
- 训练中：`[训练]` 按钮转 loading，结果区显示「正在训练…（worker 线程）」。
- 结果图表复用现有 `drawChart` 的坐标轴/刻度/网格组件，新增专用渲染函数。

### 7.3 可视化产出清单

| 产出 | 模型 | 实现 |
|---|---|---|
| 指标卡 | 全部 | 复用卡片网格 + 大数字 + 单位 |
| loss-epoch 曲线 | 线性/逻辑/MLP | 折线图，x=epoch y=loss |
| 梯度范数-epoch 曲线 | 线性/逻辑/MLP | 折线图（对数 y 可选） |
| 混淆矩阵 | 分类 | 复用 corr 热力图风格，对角高亮 |
| 预测 vs 真实散点 | 回归 | 散点 + y=x 参考线 |
| 决策边界 | 2D 分类（逻辑/KNN/SVM/树） | 网格着色 + 散点 |
| 聚类散点 | K-Means | 散点按簇着色 + 质心标记 |
| PCA 投影 | PCA | 散点（前 2 主成分）+ 解释方差条形 |
| MLP 数据流图 | MLP | SVG，输入→隐藏→输出逐层，标注每层维度，可缩放/高亮，支持「前向」流动高亮动画 |
| 决策树图 | 树/森林 | SVG 树布局，节点=分裂条件，叶=类别/均值 |
| 特征重要性 | 树/森林 | 条形图 |

### 7.4 数据流可视化（重点）

- MLP：复用 `drawGraph` 的节点/边渲染与折叠逻辑，布局改为**按层水平排列**（layer-based），节点显示「层名 + 神经元数」，边带权重色深（可选）。
- 支持「前向传播」播放：从输入层到输出层逐层高亮，展示张量 shape 流动；反向传播高亮（可选 Phase 3）。
- 决策树：新增树布局渲染器（递归 `x = 子树叶子序`、`y = 深度`，SVG 连线 + 节点盒）。

---

## 8. 超参与默认值

| 模型 | 超参 | 默认 |
|---|---|---|
| 线性回归 | 求解方式 | 正规方程（无超参）/ GD：`lr=0.01, epochs=200` |
| 逻辑回归 | `lr`, `epochs`, `C` | 0.01, 300, 1.0 |
| KNN | `k`, 距离 | 5, 欧氏 |
| K-Means | `nClusters`, `init` | 3, kmeans++ |
| PCA | `nComponents` | 2 |
| 决策树 | `maxDepth`, `minSamplesLeaf` | 8, 2 |
| 随机森林 | `nEstimators`, `maxDepth` | 50, 8 |
| SVM | `C`, 核 | 1.0, linear |
| MLP | `hidden`, `activation`, `lr`, `epochs`, `batchSize` | [64,32], relu, 0.01, 300, 32 |

---

## 9. 里程碑与验收标准

### M1（Phase 1 MVP）
- `ml/metrics.js` + `ml/preprocess.js` + `ml/linear.js` + `ml/knn.js` + `ml/kmeans.js` + `ml/pca.js` + `ml/mlp.js` + `ml-worker.js` + `ml/index.js`。
- `ml/train`、`ml/capabilities` 路由；loopback 栅栏。
- 前端 trainView：模型/列/超参表单 + 训练按钮 + 指标卡 + loss/梯度曲线 + 混淆矩阵 + 散点/边界 + MLP 数据流图。
- 验收：iris 分类（逻辑回归/KNN/MLP）准确率合理、loss 单调下降、梯度范数收敛；回归 R² 合理；K-Means 聚类 iris 三簇；PCA 解释方差合理；控制台无报错。

### M2（Phase 2）
- 决策树、随机森林、SVM；决策树图、特征重要性、RBF 核 SVM（可选）。
- 验收：iris 决策树/森林/SVM 准确率 ≥ 0.9。

### M3（Phase 3 打磨）
- 交叉验证、更多指标、前向/反向动画、超参自动网格。

---

## 10. 风险与约束

1. **纯 JS 数值性能**：MLP 大网络/大 epoch 会慢 → 训练行数采样上限 + worker 线程 + 后续可接 WebAssembly/Node 原生模块。
2. **SVM SMO 复杂度**：纯 JS 实现较繁琐 → Phase 2 排后，先用线性软间隔 + 次梯度下降兜底。
3. **PCA 特征值分解**：幂迭代对小维度足够；大维度用 QR 迭代，仍纯 JS。
4. **数据量**：受 `LIMITS.maxRows=5_000_000` 约束，训练默认 50k 采样，超限提示。
5. **GPU**：本模块 CPU 训练即可满足小数据集交互（与既有结论一致）；若后续接 GPU 需 onnxruntime-gpu/WebGPU，属独立增强项。
6. **不落盘**：训练结果内存返回，刷新即失效（与现有看板 live 模式一致），避免状态污染。

---

## 11. 待确认项

- [ ] MLP 是否需要优化器选择（SGD/Adam）？默认先做 SGD + 可选 Adam。
- [ ] 「数据流」是否需要反向传播可视化，还是先只做前向逐层流动？
- [ ] 训练历史（多次 run）是否需要留存列表，还是每次覆盖？
