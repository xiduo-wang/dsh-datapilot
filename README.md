# dsh-datapilot · DataPilot 数据工作台

在 DSH 侧边栏常驻一个数据分析面板：查看**多工作区 × 多数据集**的分析图表、
数据分布，以及**深度学习模型结构图**（ONNX / 架构图）。

## 当前能力

- **client 半面**（`lib/client.js`）：注册 `sidebar.panellist` 图标 + `main` 面板
  body，body 是一个 iframe，指向 host 半面服务的面板 HTML。
- **host 半面**（`lib/host/index.js`）：22 条路由，服务面板 HTML + 数据引擎 API +
  ML 训练 API（全部 loopback-only，见下）。
- **数据引擎**（`lib/host/engine.js` + `lib/host/parsers.js`）：
  - CSV / TSV / TXT：全量解析
  - JSONL / NDJSON / JSON：JSON 支持对象数组、`{data|rows|records|items}` 包裹、列式对象、单对象
  - Parquet / Parquet2：`hyparquet` + `hyparquet-compressors`（snappy/zstd/gzip）
  - Excel `.xlsx / .xlsm`：内置 ZIP + SpreadsheetML 解析，多工作表、日期/布尔/共享字符串
  - 旧版 `.xls`（BIFF8/OLE，Excel 97-2003）：SheetJS `xlsx`（可选依赖，多工作表、日期/布尔）
  - ONNX：内置 protobuf wire 解析模型图（节点/边/算子/参数/输入输出/opset）
- **面板**（`assets/panel.html`）：自包含单文件（Canvas 图表 + SVG 模型图），
  通过 `/api/dsh-datapilot/*` 读取真实数据（mock 数据仅作 API 不可用时的降级）。
- **机器学习/深度学习训练**（`lib/host/ml/`，纯 JS 零依赖，worker 线程训练）：
  线性回归、逻辑回归、KNN、K-Means、PCA、MLP 六类模型，支持回归/分类/聚类/降维
  四类任务，产出指标卡、loss/梯度范数曲线、混淆矩阵、散点/决策边界、MLP 数据流图。

## 数据引擎路由（host 半面，`/api/dsh-datapilot/*`）

`panel`（GET，HTML）、`health`、`state`、`roots/add`（POST）、`roots/remove`（POST）、
`scan`（?rootId）、`datasets/open`（POST body `{path,parse:{sheet}}`）、`datasets/schema`、
`datasets/preview`（?id&offset&limit）、`datasets/profile`（?id&columns）、
`datasets/histogram`（?id&column&bins）、`datasets/quantiles`（?id&column&qs）、
`datasets/correlation`（?id）、`datasets/groupby`（?id&by&metric&agg&topK）、
`datasets/sample`（?id&column&n）、`datasets/close`（POST）、`models/meta`（?path）、
`upload`（POST 原始体 + ?name，写入 `~/.dsh/dsh-datapilot/uploads`）、
`report`（POST body `{paths}`，生成结构化 Markdown 分析报告）、
`ml/capabilities`（GET，模型能力清单）、
`ml/train`（POST body `{datasetId,task,model,features,target,params,...}`，worker 线程训练）、
`diagnostics`。

统一响应 `{ok:true,...data}` / `{ok:false,error:{code,message}}`；仅接受本机回环
请求；数据根目录用 realpath 前缀校验防目录穿越；数据集状态持久化到
`~/.dsh/dsh-datapilot/state.json`，内存注册表上限 8 个（LRU 逐出）。

资源上限（`lib/host/engine.js` 的 `LIMITS`）：单个文件 **1 GiB**、单个数据集
**500 万行**（超过行数截断并给出 warning；超过字节数返回 `TOO_LARGE`）。

## 安装（本地目录加载）

```bash
dsh plugin --profile desktop add file:./dsh-datapilot
```

或手动注册（无 dsh CLI 时）：

1. 把本包放入 profile 的 `node_modules/dsh-datapilot`。
2. 在 profile `package.json` 的 `dependencies` 加 `"dsh-datapilot": "0.1.0"`，
   并在 `dsh.profile.bundles` 数组追加 `"dsh-datapilot"`。
3. 重启 DSH。

## 架构

- 双面插件：`exports "."` 跑 host（node），`exports "./client"` 跑 web GUI。
- `cordis.patch.yml`：`- insert: { id: datapilot, name: dsh-datapilot }`。
- client bundle 用 `window.__ModuleLoader__.load` 外壳 + 运行时 `require("react")`，
  无需本地 tsdown 构建。

## 路线图

- ✅ 数据引擎：CSV/TSV/JSONL/JSON/Parquet/xlsx/`.xls`/ONNX 解析、列画像、图表数据路由。
- ✅ 面板从「模拟数据」切换到真实数据引擎 API（mock 作为降级）。
- ✅ 上传本地数据集 + 跨工作区数据池 + 结构化分析报告（本地规则式洞察）。
- ✅ 多格式适配：JSON、Parquet、xlsx/`.xls` 多工作表、ONNX 结构图。
- ✅ 解析移入 Worker 线程（多核并行，大文件不阻塞）。
- ✅ 多看板标签页 + 图表刻度/网格/去斜体标签。
- ✅ 内置机器学习/深度学习训练（线性回归/逻辑回归/KNN/K-Means/PCA/MLP + 指标/损失/梯度/混淆矩阵/决策边界/MLP 数据流）。
- ⏳ 决策树 / 随机森林 / SVM（Phase 2）。
- ⏳ Arrow/IPC、HDF5、NumPy、SPSS/Stata/SAS、SQLite。
- ⏳ 视图书签持久化（live 模式刷新后看板清空）。
- ⏳ ONNX 模型推理（GPU/WebGPU 加速，独立功能）。

## 发布与上架

1. **npm**：`npm publish`（先 `npm login`）。
2. **GitHub 开源**：`git init && git remote add origin https://github.com/xiduo-wang/dsh-datapilot.git && git push -u origin main`。
3. **插件市场**：向 `awesome-dsh-plugin/awesome-dsh-plugin` 仓库提 PR，提交一条
   `RegistryPlugin` 目录条目（格式见 `marketplace/catalog-entry.json`）。
4. 目录被合并后，插件即出现在 DSH 社区市场的「Tools & Capabilities」分类下。

## 许可证

MIT © 2026 xiduo-wang
