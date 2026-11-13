# DataPilot · 数据工作台

> 在 DeepSeek Harness 侧边栏常驻一个**数据分析 + 机器学习工作台**：跨多个工作区查看本地数据集的图表、数据分布、模型结构图，还能直接在面板里训练经典机器学习模型。

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-datapilot"><img src="https://img.shields.io/npm/v/dsh-datapilot" alt="npm version"></a>
  <a href="https://github.com/xiduo-wang/dsh-datapilot/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license"></a>
  <a href="https://www.npmjs.com/package/dsh-datapilot"><img src="https://img.shields.io/npm/dt/dsh-datapilot" alt="downloads"></a>
</p>

## ✨ 功能特性

- **多工作区 × 多数据集**：挂载多个本地目录，在一个面板里同时浏览、切换不同工作区的数据。
- **9 类交互图表**：直方图、箱线图、小提琴图、ECDF、条形图、折线图、散点图、相关矩阵、缺失矩阵，全部 Canvas 自绘、零依赖。
- **数据画像**：点开数据集即见每列的统计量（均值/标准差/分位数）、基数、缺失率、离群值。
- **多格式数据源**：CSV / TSV / JSON / JSONL / Parquet / Excel（.xlsx / .xlsm / .xls 多工作表）/ ONNX。
- **深度学习模型结构图**：ONNX 模型一键展开成可缩放、可折叠的算子图，标注输入输出维度与参数量。
- **上传 + 跨工作区协作**：上传本地文件到共享数据池，多个工作区之间复用。
- **结构化分析报告**：一键生成 Markdown 数据分析报告（洞察、列画像、相关矩阵）。
- **内置机器学习/深度学习训练**：线性回归、逻辑回归、KNN、K-Means、PCA、MLP，产出指标卡、损失/梯度曲线、混淆矩阵、决策边界、MLP 数据流图。
- **多标签页看板 + 中英文切换**：像浏览器一样多开看板，界面中英文即时切换。

## 🚀 快速开始

在 DSH 的插件市场（社区市场 → Tools & Capabilities）搜索 **DataPilot** 安装，或在终端执行：

```bash
dsh plugin add dsh-datapilot
```

也可以直接 npm 安装后手动注册：

```bash
npm install dsh-datapilot
```

重启 DSH，左侧全局面板就会出现「DataPilot 数据工作台」。

## 📖 使用

1. 打开侧边栏的 **DataPilot 数据工作台**。
2. 点顶栏「根目录」挂载一个本地数据目录（或点「上传」传文件）。
3. 左侧树里点一个数据集 → 右侧检查器显示列画像。
4. 点任意列的类型徽章（直方图 / 箱线 / 散点 …）→ 看板生成图表。
5. 点「训练」→ 选数据集、任务、模型 → 一键训练并看指标与曲线。
6. 点「报告」→ 生成结构化 Markdown 分析报告。

## 🧩 支持的数据格式

| 格式 | 说明 |
| --- | --- |
| CSV / TSV / TXT | 全量解析，自动类型推断 |
| JSON / JSONL / NDJSON | 对象数组、列式、`{data/rows/records}` 包裹 |
| Parquet | `hyparquet` 解析（snappy / zstd / gzip） |
| Excel `.xlsx / .xlsm` | 内置 ZIP + SpreadsheetML 解析，多工作表、日期/布尔 |
| Excel `.xls`（97-2003） | SheetJS `xlsx`，多工作表、日期/布尔 |
| ONNX | 模型结构图（算子/边/参数/输入输出/opset） |

> 单文件上限 1 GiB、单数据集 500 万行，超过自动截断并提示。

## 🤖 内置机器学习模型

| 任务 | 模型 | 产出 |
| --- | --- | --- |
| 回归 | 线性回归、MLP | R² / MSE / RMSE / MAE + 损失/梯度曲线 + 预测散点 |
| 分类 | 逻辑回归、KNN、MLP | 准确率 / 精确率 / 召回率 / F1 + 混淆矩阵 + 决策边界 |
| 聚类 | K-Means | 惯性 / 轮廓系数 + 聚类散点 |
| 降维 | PCA | 解释方差比 + 投影散点 |

训练在 Worker 线程执行，不阻塞主线程；预处理自动做 z-score 标准化、类别特征 one-hot、缺失值处理。


## 📄 许可证

[MIT](./LICENSE) © 2026 xiduo-wang
