# DSH DataPilot（数据工作台）· 产品需求文档 PRD v1.0

> 文档状态：待评审 · 目标读者：实现该插件的 AI 编码代理 / 人类评审
> 编写日期：2026-11-12 · 工作区：`D:\Knowledge`
> 关联任务：市场检索结论（附录 A）+ 插件开发与上架（§11）

---

## 0. 一页结论

**市场检索结论：没有符合要求的插件。**

截至 2026-11-11，dshmarket 目录共 **10,581** 个插件、**24** 个分类，其中**不存在**任何「数据 / 分析 / 图表」类目；逐一核对 README 后，最接近的 4 个插件各缺一大块能力（§1.2）：

| 需求 | nlbi | chartlab | data-analysis | DataPilot（本文） |
|---|---|---|---|---|
| 常驻侧边栏工作面板 | ✅（依赖 betterSidebar） | ❌ 会话内 | ⚠️ 会话级右侧标签 | ✅ 一级侧栏 + 中央面板 |
| 多工作区同时挂载 | ❌ | ❌ | ❌ 工作区级 | ✅ 跨工作区混排 |
| 多数据集同屏图表 | ⚠️ 单库 | ❌ | ⚠️ 单报告 | ✅ 看板 12 图 |
| 数据分布 / 质量概览 | ❌ | ❌ | ⚠️ 描述统计 | ✅ 分布全家桶 |
| 深度学习模型结构图 | ❌ | ❌ | ❌ | ✅ ONNX 交互图 + 图纸画廊 |
| 零外部依赖（无 CDN / 无 Python） | ❌ CDN 渲染 | ✅ | ❌ 需 Python 3.10+ | ✅ 全本地 npm 依赖 |

**因此本文档定义新插件 `dsh-datapilot`，并给出可直接交付给 AI 编码代理实施的完整需求、接口契约、验收标准与上架流程。**

一句话定位：**DSH 里的「多工作区数据 & 模型实验室」——左侧栏一个常驻面板，把散落在任意工作区里的 CSV/Parquet/Excel/ONNX 拉进同一块看板，边看分布边看模型结构。**

---

## 1. 背景：市场检索结果与空白点

### 1.1 检索方法与证据

| 步骤 | 做法 | 结果 |
|---|---|---|
| 1 | 读取目录清单 `https://awesome-dsh-plugin.com/plugins.json`（npm 包 `dsh-plugin-catalog@2026.1112.19819`） | count = 10581，24 个分类 |
| 2 | 分类结构审查 | **无 data / analytics / chart / viz 类目**（见附录 A 全量分类表） |
| 3 | 名称过滤（dshmarket `/browse` 过滤框） | `data` 仅 1 条噪声命中（`redfox-data/redfox-skill-gallery`，owner 名含 data） |
| 4 | npm registry 定向检索 | 命中 4 个相邻插件，逐个读 README（§1.2） |
| 5 | 模型可视化专项 | 搜 `dsh onnx` 只得到 onnxruntime-*、onnx-proto、SenseVoice STT，**无任何 ONNX / Netron 式结构图插件** |

> 方法学缺陷（如实记录）：目录的站内过滤只匹配**包名**，无法按描述全文检索；`plugins.json` 体积过大导致浏览器 `fetch` 取 body 挂起，故「描述级全量扫描」未能 100% 完成。但「分类结构缺类 + 包名过滤 + npm 定向检索 + 4 个相邻实现逐条核对」已构成足够强的证据链。

### 1.2 相邻插件能力实测

| 插件 | 版本 / 数据 | 已有能力 | 关键缺口 |
|---|---|---|---|
| `dsh-plugin-nlbi` | 0.2.1，周下载 206 | MySQL + Text2SQL + `sql_to_chart`（柱/折线/饼/统计卡）+ 报表收藏 + 右侧栏三合一工作台 + node-sql-parser AST 只读护栏 + 69 组断言 | 仅 MySQL；ECharts 走 **CDN**（离线废）；侧栏依赖前置插件 betterSidebar；无本地文件、无模型图 |
| `dsh-chartlab` | 0.1.1，周下载 23 | 本地 `.csv/.xlsx/.xls` + DuckDB → 可交互图表，百万行按视口取数、框选缩放、图内写 SQL、跟随主题 | 只有折线 + 散点；**按会话隔离**，删会话即清缓存；无侧栏、无分布统计、无多工作区 |
| `@chengxianglibra/dsh-data-analysis` | 0.2.3，周下载 89 | Marivo 语义层：本地 CSV/JSON/Parquet/xlsx + DuckDB/Trino/ClickHouse + 指标维度 + 报告看板 + 右侧标签页 + HTML 导出 | 需 **Python 3.10+** 与 venv；Node 不支持 23.x；报告是**单数据集**视角；无模型图 |
| `dsh-chart` / `dsh-chart-ascii` / `dsh-genui` | 0.5.0 / 0.2.0 / 0.3.3 | 对话内联图表（SVG / ASCII / 声明式 genui） | 均为「对话内一次性渲染」，无面板、无状态、无数据集管理 |

### 1.3 结论性空白（本产品要打的 6 个点）

- **GAP-1 常驻面板缺失**：所有数据分析能力都寄生在「会话」或「一次对话」里，用户关掉会话就丢视图。
- **GAP-2 跨工作区缺失**：没有产品把「工作区 A 的训练集」与「工作区 B 的验证集」放进同一块画布对比。
- **GAP-3 分布视角缺失**：现有实现停留在「画一张图」，缺少质量画像（缺失率、基数、离群、偏度、长尾）。
- **GAP-4 模型可视化完全空白**：整个生态 0 覆盖。
- **GAP-5 依赖过重**：CDN 渲染 / Python 运行时 / 强前置插件——三者都会显著提高安装失败率。
- **GAP-6 Agent 协作缺位**：看板与模型能力没有回到对话里，模型不知道用户正在看什么。

---

## 2. 产品定义

### 2.1 一句话

**一个常驻侧边栏的「数据 + 模型」双工作台：任意工作区的数据集，一次扫描统一进看板；任意模型文件，一次点击变成可交互结构图。**

### 2.2 目标用户与 JTBD

| 角色 | 场景（Job To Be Done） | 现状痛点 |
|---|---|---|
| 算法工程师 | 「这版特征分布有没有漂移？跟上周那批比一下」 | 开 Jupyter、写 pandas、截图贴群 |
| 数据工程师 | 「三个工作区里的三份 parquet，字段对得上吗？」 | 手写脚本比 schema |
| 产品 / 分析师 | 「把这几个 csv 的关键分布摆一屏，我要给老板看」 | Excel 拼图，导出失真 |
| 模型部署同学 | 「这个 onnx 到底几层、输入输出什么形状？」 | 装 Netron 桌面版、来回切窗口 |

### 2.3 成功指标（首个版本后 30 天观测）

| 指标 | 目标 | 观测方式 |
|---|---|---|
| 安装成功率 | ≥ 95% | 商店 install 事件 / 本地诊断路由 |
| 首次打开 3 分钟内出图率 | ≥ 70% | 面板埋点（**本地统计，不上传**） |
| 周留存（7 日内 ≥ 2 次打开） | ≥ 25% | 同上 |
| 单次 1GB CSV 首屏 | ≤ 4 s | 内置性能面板 |
| 崩溃率 | < 0.5% / 会话 | 本地错误日志文件 |

---

## 3. 范围

### 3.1 优先级边界

| 级别 | 内容 |
|---|---|
| **P0（首发必需）** | 侧栏常驻面板；多工作区根目录；CSV/TSV/JSON/JSONL/Parquet/XLSX 接入；schema + 预览 + 质量画像；9 类统计图；看板（多图同屏、跨工作区混排、保存视图）；ONNX 交互结构图；图片/PDF 结构图画廊；PNG/SVG/HTML 导出；中英双语；明暗主题 |
| **P1（首发后 1 个版本）** | 权重文件摘要（safetensors / gguf / ckpt state_dict 键表）；SQL 查询层（可选 DuckDB）；相关性/分组聚合的自定义指标；看板与 Agent 的双向交换；CSV 大文件列裁剪 |
| **P2（探索）** | 数据库直连（Postgres/ClickHouse）；PCA/UMAP 投影；时间序列分解；多用户共享看板；ONNX Runtime 推理试跑 |

### 3.2 非目标（明确不做）

- ❌ 不做训练 / 推理调度（不是 TensorBoard 替代品）。
- ❌ 不做数据清洗写入（首版只读，避免误改用户数据）。
- ❌ 不解析 `.pt/.pth` 的计算图（PyTorch 无稳定序列化图格式，见 §12 风险 R4）。
- ❌ 不引入 Python 运行时（这是与 `dsh-data-analysis` 的核心差异化）。
- ❌ 不上传任何数据到远端（含崩溃上报）。

---

## 4. 信息架构与交互

### 4.1 面板形态

采用 DSH 的「左侧栏图标 + 中央面板」双 slot 注册（与 `dsh-workspace-combiner`、`@linxin666/dsh-client-ui-task-board` 同构）：

- `sidebar.panellist` → 侧栏图标「数据工作台」（order 200，排在任务看板之后、智能体之前）。
- `main` + `key: "datapilot"` → 点击图标时把中央区域切换成工作台（不是右侧抽屉，保证宽度够放 3 列图）。
- 面板内部再分三栏：**左 资源树 / 中 看板画布 / 右 检查器**。

### 4.2 布局线框

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 数据工作台    [工作区 ▾ 全部]  [＋ 添加根目录]  [⟳ 重扫]   [中/EN] [⤓ 导出] [⚙]│
├───────────────┬──────────────────────────────────────────┬───────────────────┤
│ 🔍 过滤…       │  看板：训练集对比             [+ 图] [⫶ 布局]│  检查器            │
│               │ ┌──────────────┐ ┌──────────────┐        │ 数据集             │
│ ▾ 🗂 工作区 A   │ │ 直方图 loss  │ │ 箱线图 lr    │        │ train.csv          │
│   📄 train.csv │ │  ▁▃▅▇▅▃▁     │ │  ├─┬─┤       │        │ 1,204,331 行 × 27 列│
│   📄 valid.par │ └──────────────┘ └──────────────┘        │ 列 profile ▾       │
│ ▾ 🗂 工作区 B   │ ┌──────────────┐ ┌──────────────┐        │  loss  float64     │
│   📄 test.parq │ │ 相关矩阵      │ │ 缺失值矩阵    │        │  μ 0.41 σ 0.12     │
│ ▾ 🧠 模型       │ │ ▦▦▦▦▦       │ │ ░░░▓░░       │        │  P50 0.39 P99 0.88 │
│   ⬡ resnet.onnx│ └──────────────┘ └──────────────┘        │  缺失 0.02% 基数 9k │
│   🖼 arch.png   │ ┌───────────────────────────────┐        │ ─────────────────  │
│               │ │ 折线图：train vs valid loss     │        │ 图表设置           │
│               │ │  ╱╲___╱                         │        │ 分箱 40 ▾ 归一化 ▢ │
│               │ └───────────────────────────────┘        │ 对数轴 ▢  采样 1:20 │
└───────────────┴──────────────────────────────────────────┴───────────────────┘
```

### 4.3 状态模型

```
Root(根目录) ─┬─ Dataset(数据集) ── Column(列) ── Chart(图)
              └─ Model(模型文件)
Workspace(DSH 工作区) 1──n Root
Board(看板) 1──n Chart  ;  Chart 可引用任意 Dataset（可跨 Root / 跨 Workspace）
View(保存的视图) = Board + 筛选 + 布局快照
```

「看板」是**跨工作区**的：每个图表单元格带来源色标（工作区 A 蓝 / B 橙 / 自定义 灰），图例与 tooltip 里始终显示 `数据集@工作区`。

### 4.4 三条关键旅程

**J1 · 三分钟出第一张图**
添加根目录 → 自动扫描出 42 个数据文件 → 点 `train.csv` → 右侧立刻显示 27 列 profile → 点 `loss` 列的「直方图」按钮 → 看板出现第一张图。

**J2 · 跨工作区对比**
看板已有 A 区 `loss` 直方图 → 点「＋ 图」→ 选 B 区 `valid.parquet` 的 `loss` → 选「叠加对比」→ 两分布同轴叠加，KS 检验 p 值写在图注。

**J3 · 看模型结构**
资源树点 `resnet50.onnx` → 中央切换到图视图：分层 LR 布局 200+ 节点，左侧浮层列出 Input/Output 张量，顶部搜索 `conv` 高亮 → 双击节点折叠整个 bottleneck → 导出 SVG 贴进设计稿。

---

## 5. 功能需求

> 编号规则：FR-xx；每条含「行为」「验收（Given/When/Then）」。P0 未实现即不发布。

### FR-01 工作区与根目录管理（P0）

**行为**
- 面板顶部「工作区」下拉列出 DSH 已注册工作区（读 `workspaces` 服务），选中即把该工作区所有目录作为候选根。
- 「＋ 添加根目录」调用 `remote.directoryPicker` 选任意本地目录（含工作区之外的 D 盘数据盘），登记为自定义根。
- 根目录可命名、可隐藏、可删除（只删登记，不删文件）。
- 登记信息持久化到 `~/.dsh/dsh-datapilot.json`。

**验收**
- Given 已登记 3 个根目录，When 重启 DSH 并打开面板，Then 3 个根目录与树展开状态原样恢复。
- Given 用户添加 `D:\datasets`，When 该目录不存在，Then 面板显示「目录不可达」占位，不崩溃、不自动删除登记。

### FR-02 文件扫描与数据集识别（P0）

**行为**
- 递归扫描（默认深度 4，可配到 8），识别：`.csv .tsv .json .jsonl .ndjson .parquet .xlsx .xlsm .arrow .feather`（数据集）与 `.onnx .safetensors .gguf .ckpt .pt .pth`（模型）、`.png .jpg .jpeg .svg .pdf`（结构图纸，仅当位于 `models/`、`figures/`、`assets/` 等目录或用户手动加入时展示，避免把整个相册扫进来）。
- 单目录文件数 > 5000 时改为「按需展开」，不预扫。
- 忽略 `.git`、`node_modules`、`.venv`、`__pycache__`、`*.tmp`。

**验收**
- Given 一个含 1.2 万文件的 monorepo，When 首次扫描，Then 3 s 内返回目录树骨架，数据集节点按需加载。
- Given 文件名含中文/空格/emoji，When 打开，Then 正常解析并在面包屑正确显示。

### FR-03 数据集接入与 schema 推断（P0）

**行为**
- 首开取前 64 MB / 50,000 行做类型推断：`int64 / float64 / bool / datetime / category / string / json / null`。
- 解析失败不阻塞：坏行计数并在预览里高亮，成功率 < 90% 时提示切换分隔符/编码/quote。
- 支持手动覆盖：分隔符、编码（UTF-8/GBK）、是否含表头、小数逗号、时区。
- 记住每个文件的解析设置（按 `path + size + mtime` 作指纹，文件变了自动重推）。

**验收**
- Given 一个 GBK 编码、含中文表头的 csv，When 首次打开，Then 给出「疑似 GBK」提示，一键切换后表头正常。
- Given 一个 1 亿行 parquet，When 打开，Then 只读 footer 与首个 row group，1 s 内出 schema 与行数。

### FR-04 数据质量画像（P0）

**行为**
单列 profile（右侧检查器，选中列即算）：

| 指标 | 数值型 | 类别/字符串型 |
|---|---|---|
| 计数 / 空值率 / 去重基数 | ✅ | ✅ |
| min / max / mean / std / 中位数 | ✅ | — |
| 分位 P1 P5 P25 P50 P75 P95 P99 | ✅ | — |
| 偏度 / 峰度 / 离群点计数（IQR×1.5, 3.0） | ✅ | — |
| Top-K 取值 + 频次 | — | ✅（K=10） |
| 直方图缩略（sparkline，32 桶） | ✅ | ✅ |
| 疑似 ID / 常量 / 高基数 / 全空 标记 | ✅ | ✅ |

同时提供「全表质量概览」：每列一行，用色块表示缺失率、基数、类型，点击跳到该列。

**验收**
- Given 100 万行 float 列，When 选中，Then 200 ms 内出全部指标（单次扫描 + t-digest 分位）。
- Given 全空列，When 选中，Then 标记「全空」且不抛除零异常。

### FR-05 分布与统计图（P0，9 类）

| # | 图型 | 关键交互 |
|---|---|---|
| 1 | 直方图（可叠 KDE 曲线、可对数桶宽） | 拖动桶宽、框选区间回填筛选 |
| 2 | 箱线图（可分组 by 类别列） | hover 显示五数概括与离群点数量 |
| 3 | 小提琴图（KDE + 内嵌箱线） | 组间宽度自适应 |
| 4 | ECDF / 生存曲线 | 双列对比时画两条 |
| 5 | 条形图（Top-K 类别） | 点击条形 = 筛选该类 |
| 6 | 折线图（时序或多列并置） | 刷选时间窗、双 Y 轴 |
| 7 | 散点图（含密度着色 / hexbin 模式） | 百万点降采样 + 框选 |
| 8 | 相关性热力矩阵（Pearson / Spearman） | 点击格子出散点联动 |
| 9 | 缺失值矩阵（列 × 行块） | 点击跳转缺失行 |

**共性要求**
- 任一张图都能「钉到看板」；也可在检查器里即时预览。
- 空数据 / 单值列 / 全 NaN 必须给出可读空态，不许白屏。
- 数字格式化遵循 locale（1,204,331 / 1.2M），中文下用万/亿。

**验收**
- Given 两列高度相关（r=0.93），When 打开相关矩阵，Then 显示 0.93 且点击格子弹出对应散点。
- Given 200 万点散点，When 渲染，Then 首帧 ≤ 1.5 s，缩放仍 ≥ 30 fps（视口重采样）。

### FR-06 看板（P0）

**行为**
- 网格布局：1/2/3/4 列可切，单元格可拖拽换位、可跨列（占 2 格宽）。
- 单元格类型：任意图表 / 数据集概览卡 / 模型结构缩略图 / Markdown 备注卡。
- 跨工作区：一个看板内图表可来自不同根目录与不同工作区，来源以角标 + 配色区分。
- 保存为「视图」：布局 + 引用（路径 + 指纹）+ 筛选 + 时间范围；文件变了提示「数据已更新，重新计算？」。
- 一键「复制为 Markdown」：把每张图的标题、口径、关键数字导出成可贴进文档的表格。

**验收**
- Given 一个 8 图看板，When 刷新页面，Then 布局与每张图的口径完全恢复（含滚动位置）。
- Given 引用的 parquet 被删除，When 打开视图，Then 该格显示「数据源缺失」并提供「重新绑定」，其余图不受影响。

### FR-07 深度学习模型结构可视化（P0 + P1）

这是本产品的差异化主功能，分三层：

**FR-07a ONNX 交互结构图（P0）**
- 解析 `.onnx`（protobuf）→ 节点图：`op_type`、`name`、输入/输出张量与**形状**（从 `value_info` 与 `graph.input/output` 取；缺失时显示 `?`）。
- 布局：分层有向图（dagre，LR），同层按拓扑序稳定排序。
- 交互：滚轮缩放、拖拽平移、框选、节点搜索（支持正则）、点击高亮上下游、双击折叠子图、右键「只看这条路径」。
- 侧栏浮动面板：模型元信息（ir_version、opset、producer、参数量估算、文件大小）、Input/Output 表、算子直方图（Top-15 算子占比）。
- 性能：≤ 2,000 节点走 SVG；> 2,000 走 Canvas 并自动折叠 `Constant/Identity/Reshape/Flatten` 链。
- 导出：SVG（矢量，可编辑）、PNG（2×）。

**FR-07b 结构图纸画廊（P0）**
- 把 `.png/.jpg/.svg/.pdf` 当作「架构图」浏览：缩略图瀑布流 + 全屏查看器（缩放、旋转、适应宽度、多图对比并排）。
- PDF 走 Canvas 逐页渲染，只渲染可视页。
- 用途：论文架构图、Netron 截图、draw.io 导出——用户口中的「结构图片」大多长这样，别只做解析。

**FR-07c 权重文件摘要（P1）**
- `.safetensors`：读 header JSON → 层名、dtype、形状、总参数量、按前缀分组统计（backbone/head/…）。
- `.gguf`：读元数据 + tensor info 表。
- `.ckpt/.pt/.pth`：只做**受限**解析（zip 目录 + `data.pkl` 的 pickle opcode 白名单扫描），仅提取 `state_dict` 键名与形状；任何越界指令立即中止并提示「请导出为 ONNX」。

**验收**
- Given 一个 210 节点的 resnet50.onnx，When 打开，Then 1.5 s 内完成布局并可交互；节点 tooltip 显示 `Conv_3 → (1,64,112,112)`。
- Given 一个 6,000 节点的超大图，When 打开，Then 自动切换 Canvas + 折叠，10 s 内可交互，期间显示进度。
- Given 一个加密或损坏的 onnx，When 打开，Then 显示「无法解析：<原因>」，不影响其他面板。

### FR-08 导出（P0）

| 格式 | 内容 | 说明 |
|---|---|---|
| PNG / SVG | 单图 | 2× 高清，含标题与图注 |
| HTML（单文件） | 整个看板 | 内联数据快照 + 图表 + 样式，**离线可看**，双击即开 |
| Markdown | 看板摘要 | 表格 + 结论句，给文档/PR 用 |
| JSON | 视图定义 | 用于团队共享与 Agent 交换（FR-09） |

**验收**：导出的 HTML 在断网、无 DSH 的机器上打开，图表与数字与面板一致。

### FR-09 与 Agent 的双向协作（P0 单向 / P1 双向）

- **看板 → 对话（P0）**：面板「告诉 Agent」按钮把当前上下文注入会话：`{视图名, 数据集列表(路径/行数/列名), 选中列, 关键统计, 图注}`，以结构化 Markdown 追加到用户输入框（不自动发送）。
- **宿主 prompt 分节（P0）**：注册一段 systemPrompt 分节，仅当面板打开时告诉模型「用户正在数据工作台查看 X，可用 /datapilot 读取其快照」，避免模型对「这个图」「那列」指代失明。
- **对话 → 看板（P1）**：模型输出的 `analysis.json`（图表声明）可被面板「导入视图」直接渲染。

**验收**：Given 用户在看板选中 `loss` 列，When 点「告诉 Agent」并追问「这分布正常吗」，Then 模型回答中出现该列的行数、均值、P99 等真实数字。

### FR-10 设置与限额（P0）

| 项 | 默认 | 可配 |
|---|---|---|
| 根目录扫描深度 | 4 | 1–8 |
| schema 推断采样 | 50,000 行 / 64 MB | 1k–500k |
| 统计采样上限 | 2,000,000 行 | 10k–10M |
| 预览分页 | 100 行 | 20–1000 |
| 列式缓存放量 | 512 MB | 128 MB–2 GB |
| 单文件上限 | 8 GB | 1–64 GB |
| ONNX 节点上限 | 20,000 | 1k–100k |

超限时统一行为：**降级 + 明确提示**（例如「已按 200 万行采样，估算误差 < 0.3%」），绝不静默截断。

---

## 6. 非功能需求

| 维度 | 要求 |
|---|---|
| 性能 | 100 MB CSV 首屏 ≤ 3 s；列 profile ≤ 200 ms（≤ 100 万行）；看板 8 图滚动 ≥ 50 fps；切工作区 ≤ 150 ms（走缓存） |
| 内存 | 稳态 ≤ 600 MB；单数据集列存受 §FR-10 预算约束，LRU 逐出 |
| 离线 | **零网络**：不引 CDN，不拉字体，不上报。首次安装后断网全功能可用 |
| 安全 | 只读；仅 loopback 路由；所有路径必须落在已登记根目录内（realpath 归一 + 前缀校验，防 `..`/符号链接穿越）；不执行数据文件里的任何代码 |
| 隐私 | 无遥测；崩溃日志仅写本地 `~/.dsh/logs/dsh-datapilot.log`，30 天轮转 |
| 兼容 | Node `^22.19.0 || >=24.0.0`（与生态主流对齐）；Windows / macOS / Linux；不改 DSH 源码，只用官方 SDK |
| i18n | 中/英完整词条（`ctx.locale.register`），无硬编码文案 |
| 主题 | 跟随 DSH 明/暗（读 CSS 变量），图表配色同时适配 |
| 无障碍 | 全部控件可 Tab 到达、有 aria-label；图表提供「数据表视图」替代 |
| 可诊断 | `GET /api/dsh-datapilot/diagnostics` 返回：插件实际加载版本、根目录数、数据集缓存占用、最近 20 条错误 |

---

## 7. 技术方案

### 7.1 双面插件架构（照抄生态既有范式）

DSH 插件 = **host 半面**（Node，跑在 DSH 进程，能读文件、注册 HTTP 路由）+ **client 半面**（浏览器，注册 UI slot）。两者通过 loopback HTTP 通信，client 不能直接读磁盘。

### 7.2 代码骨架

**package.json**（字段形态取自 `dsh-workspace-combiner@0.8.12`，已实测可加载）：

```json
{
  "name": "dsh-datapilot",
  "version": "0.1.0",
  "description": "DSH DataPilot：多工作区数据集分析与深度学习模型结构可视化的常驻侧栏工作台",
  "type": "module",
  "engines": { "node": "^22.19.0 || >=24.0.0" },
  "main": "lib/host/index.js",
  "types": "lib/host/index.d.ts",
  "exports": {
    ".": { "types": "./lib/host/index.d.ts", "default": "./lib/host/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib/**/*.js", "lib/**/*.d.ts", "cordis.patch.yml", "README.md", "README.zh.md", "docs/**"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-api-session-controller",
        "@deepseek-ai/dsh-api-workspace-controller",
        "@deepseek-ai/dsh-api-gateway",
        "@deepseek-ai/dsh-client-ui-workspace"
      ]
    }
  },
  "peerDependencies": { "@deepseek-ai/dsh": ">=0.2.0" },
  "optionalDependencies": { "@duckdb/node-api": "^1.1.0" },
  "license": "MIT"
}
```

**cordis.patch.yml**（把插件插进 profile 编排表）：

```yaml
- insert:
    - id: datapilot
      name: 'dsh-datapilot'
```

**lib/host/index.js**（host 半面骨架）：

```js
export const name = "dsh-datapilot";
export const inject = ["webServer", "systemPrompt"];

export function apply(ctx) {
  // 1) 持久化：~/.dsh/dsh-datapilot.json（根目录、视图、解析设置）
  // 2) 路由族：/api/dsh-datapilot/*（仅 loopback）
  ctx.effect(() => {
    const disposers = makeRoutes(ctx).map((route) => ctx.webServer.register(route));
    return () => disposers.forEach((dispose) => dispose());
  }, "dsh-datapilot: routes");

  // 3) prompt 分节：只在面板活跃时告诉模型「用户在看什么」
  ctx.effect(() => ctx.systemPrompt.section({
    id: "dsh-datapilot",
    text: () => datapilotPromptText(ctx),
  }), "dsh-datapilot: prompt");
}
```

> ⚠️ 实现提示：`ctx.webServer.register(route)` 的 route 对象**字段未在文档中公开**，请直接以 `dsh-workspace-combiner/lib/host/index.js:5023`（`function makeRoutes(...)`）与 `:6422-6436`（注册与释放）为参照模板；路由内需自带 loopback 校验与 `writeJson(res, code, body)` 响应工具。

**lib/client.js**（client 半面骨架，slot 注册方式已实测）：

```js
export const inject = ["slots", "locale", "sessions", "workspaces", "remote"];

export function apply(ctx) {
  ctx.locale.register(NS, { zh, en });

  // 侧栏图标
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
    name: "sidebar.panellist",
    id: "datapilot",
    order: 200,
    label: () => tt("title"),
  }, DataPilotIcon));

  // 中央面板正文（key 必须与上面 id 一致）
  ctx.slots.inject("main", () => ctx.slots.register({
    name: "main",
    key: "datapilot",
  }, () => DataPilotPanel({ actions })));
}
```

### 7.3 HTTP 契约

统一响应：成功 `{ "ok": true, "data": ... }`；失败 `{ "ok": false, "error": { "code": "PATH_OUTSIDE_ROOT", "message": "..." } }`。全部 `GET/POST` + `application/json`，全部要求 loopback（`req.socket.remoteAddress` 为 127.0.0.1/::1）。

| 方法 | 路径 | 入参 | 出参（data） |
|---|---|---|---|
| GET | `/api/dsh-datapilot/state` | — | `{ roots, views, settings, version }` |
| POST | `/roots/add` | `{ path, label? }` | `{ root }` |
| POST | `/roots/remove` | `{ id }` | `{ ok }` |
| POST | `/scan` | `{ rootId, depth?, cursor? }` | `{ entries[], nextCursor? }` |
| POST | `/datasets/open` | `{ path, parse?: {delimiter,encoding,header} }` | `{ datasetId, schema, rowCount, warnings[] }` |
| GET | `/datasets/:id/schema` | `?refresh` | `{ columns: [{name,type,nullable,...}] }` |
| GET | `/datasets/:id/preview` | `?offset&limit` | `{ rows: any[][], total }` |
| GET | `/datasets/:id/profile` | `?column=` / `?columns=a,b` | `{ profiles: ColumnProfile[] }` |
| GET | `/datasets/:id/histogram` | `?column&bins&log` | `{ bins: [{x0,x1,count}], kde? }` |
| GET | `/datasets/:id/quantiles` | `?column&qs=0.01,...` | `{ qs: number[], values: number[] }` |
| GET | `/datasets/:id/correlation` | `?columns&method=pearson|spearman` | `{ matrix: number[][], labels: string[] }` |
| GET | `/datasets/:id/groupby` | `?by&metric&agg&topK` | `{ groups: [{key,value,n}] }` |
| POST | `/datasets/:id/rows` | `{ filter, offset, limit }` | `{ rows }` |
| POST | `/datasets/close` | `{ id }` | `{ ok }`（释放列存） |
| GET | `/models/onnx` | `?path` | `{ graph: { nodes, edges, inputs, outputs, meta } }` |
| GET | `/models/meta` | `?path` | `{ format, tensors?: [...], params?, groups? }` |
| POST | `/views` | `{ view }` | `{ id }` |
| GET | `/views` | — | `{ views }` |
| DELETE | `/views/:id` | — | `{ ok }` |
| POST | `/export` | `{ viewId, format: "png"|"svg"|"html"|"md"|"json", cellId? }` | 二进制流 / `{ text }` |
| GET | `/diagnostics` | — | 见 §6 |

### 7.4 数据引擎选型

| 方案 | 优点 | 缺点 | 决策 |
|---|---|---|---|
| A. 纯 JS 流式 + 列式缓冲（自研） | 零原生依赖、跨平台稳、可控内存 | 无 SQL、Parquet 需自写 reader | **P0 主力** |
| B. `@duckdb/node-api`（原生） | SQL 能力完整、Parquet/CSV 极快 | 原生二进制、Win/mac 需预编译、包体 +30 MB | **P1 可选**（`optionalDependencies`，检测不到自动降级） |
| C. 客户端 `duckdb-wasm` | 不占 host 内存 | 需要把文件流式喂给浏览器，1 GB 文件不现实 | 否 |
| D. 依赖 Python（pandas/polars） | 生态全 | 安装面最大（见 data-analysis 的 3 个前置条件） | **明确否** |

**P0 依赖清单**（均已确认纯 JS）：`hyparquet`（Parquet 读取，按 row group 流式）、`exceljs`（XLSX 流式）、`protobufjs` + `onnx.proto`（ONNX 解析）、`dagre`（图布局）、`uplot`（折线/时序，~45 KB）。

**统计实现要点**：一次顺序扫描同时累计 count/null/sum/sumSq/min/max + t-digest（分位）+ 32 桶直方（分位预估后二次精修）；数值列存 `Float64Array`，字符串列存字典（`dict: string[]` + `codes: Int32Array`），缺失用 `NaN` / `-1` 哨兵。

### 7.5 图表渲染选型

| 方案 | 评价 | 决策 |
|---|---|---|
| ECharts（本地打包 1 MB） | 图型全、API 熟 | 体积过大，且与「零 CDN」目标下仍需本地化 | 否（P2 可作可选皮肤） |
| Plotly | 更重 | — | 否 |
| **uPlot + 自研 Canvas2D 统计图** | 折线/时序极快；直方/箱线/小提琴/散点/热力自研约 1,200 行 | 体积小、帧率高、完全可控 | **是** |
| SVG（D3 风格） | 矢量清晰 | 万级点性能差 | 仅用于相关性矩阵与 ONNX 图（≤2k 节点） |

### 7.6 ONNX 图解析与布局

1. 读文件 → `protobufjs` 解 `ModelProto`（限制 256 MB，超出提示裁剪）。
2. 展平 `graph.node` → 节点 `{id, op, name, attrs, inputs[], outputs[]}`；`graph.input/output/value_info` → 张量形状；缺失形状填 `?`。
3. 折叠规则：连续 `Constant→Identity→Reshape→Flatten→Squeeze→Unsqueeze` 链折成一个「预处理」超级节点（可展开）。
4. `dagre` 分层布局（rankdir=LR，nodeSep 28，rankSep 60），每层按拓扑序号排序以减少交叉。
5. 渲染：SVG（节点矩形 + op 名 + 形状小字 + 边用贝塞尔），> 2,000 节点切 Canvas；缩放用 `transform` 矩阵，标签在缩放 < 0.5 时隐藏。
6. 交互状态（选中/高亮/折叠）存于内存，不入持久化。

### 7.7 缓存与索引

```
~/.dsh/dsh-datapilot/
├── state.json          # 根目录、视图、设置
├── index/<hash>.json   # 每个数据集的 schema + 指纹（size+mtime）
└── cache/<hash>.bin    # 列存快照（LRU，默认 512 MB）
```

指纹失效即重算；缓存写入原子（`.tmp` + rename）。

### 7.8 安全实现清单

- 路径校验：`fs.realpath` 后必须以某登记根的 realpath 为前缀（`path.relative` 不含 `..`）。
- 拒绝：符号链接指向根外、设备文件、超限文件、`\\?\` 特殊前缀。
- 路由统一 `guard(req,res,method)`：非 loopback → 403；方法不符 → 405；参数校验失败 → 400。
- 不解析执行文件内容（除 ONNX protobuf 的**只读**解码；pickle 走 opcode 白名单）。

---

## 8. 核心数据类型

```ts
type ColumnType = "int64" | "float64" | "bool" | "datetime" | "category" | "string" | "json" | "null";

interface ColumnMeta {
  name: string;
  type: ColumnType;
  nullable: boolean;
  cardinality: number;      // 精确值（<=10万行）或估算
  confidence: number;       // 类型推断置信度 0..1
}

interface ColumnProfile {
  name: string;
  type: ColumnType;
  count: number;
  nulls: number;
  distinct: number;
  // 数值型
  min?: number; max?: number; mean?: number; std?: number;
  quantiles?: Record<string, number>;   // "0.01" | "0.25" | "0.5" | "0.75" | "0.99"
  skewness?: number; kurtosis?: number;
  outliers?: { iqr15: number; iqr30: number };
  histogram32?: number[];
  // 类别型
  topK?: Array<{ value: string; count: number }>;
  flags: Array<"all-null" | "constant" | "high-cardinality" | "likely-id" | "likely-datetime">;
}

interface ChartCell {
  id: string;
  kind: "hist" | "box" | "violin" | "ecdf" | "bar" | "line" | "scatter" | "corr" | "missing"
      | "model-graph" | "image" | "note" | "dataset-card";
  source: { datasetId: string; rootId: string; workspaceId?: string; columns: string[] };
  options: Record<string, unknown>;   // bins / log / normalize / topK ...
  layout: { col: number; span: number; height: number };
}
```

---

## 9. 里程碑

| 阶段 | 交付 | 估时（单人，熟悉 Node/Canvas） | 完成判据 |
|---|---|---|---|
| M0 骨架 | 双面包、路由族、`state.json`、空面板 + 图标 | 2 d | `dsh plugin add file:.` 后面板出现、刷新不丢状态 |
| M1 数据集 | 根目录、扫描、CSV/JSON/JSONL/Parquet/XLSX 解析、schema、预览、profile | 5 d | 6 种格式各 1 个样本文件全部打开；1 亿行 parquet ≤ 1 s 出 schema |
| M2 图表 | 统计引擎（t-digest、直方、分位）、9 类图、看板、布局、视图保存 | 6 d | §FR-05 / FR-06 全部验收项通过 |
| M3 模型 | ONNX 解析 + dagre 布局 + 交互 + 折叠 + 算子统计；图纸画廊；权重摘要 | 5 d | resnet50.onnx 1.5 s 内可交互；6,000 节点降级路径可用 |
| M4 打磨 | 导出 PNG/SVG/HTML/MD、i18n、主题、性能、诊断路由 | 3 d | 导出 HTML 断网可用；中英切换无缺失词条 |
| M5 上架 | 打包、README（双语）、截图、npm 发布、目录收录 | 2 d | `npm i -g` 后新机器可用；商店可搜到 |

**总计 ≈ 23 人日。** 建议按 M0→M1→M2 顺序串行（M1 依赖 M0 的路由），M3 可与 M2 并行（不同人/不同子代理）。

---

## 10. 验收清单（Definition of Done）

- [ ] 侧栏出现「数据工作台」图标，点击进入中央面板，刷新页面保持状态
- [ ] 同时挂载 ≥ 3 个根目录（含工作区外目录），树与展开状态持久化
- [ ] CSV / TSV / JSON / JSONL / Parquet / XLSX 六种格式各成功打开一次，含 GBK 编码与含空格中文文件名
- [ ] 单列 profile 在 100 万行上 ≤ 200 ms，含分位、偏度、离群计数
- [ ] 9 类图各渲染一次，均支持钉入看板；空数据/单值/全 NaN 有空态
- [ ] 一个看板含来自 2 个不同工作区的图表，来源色标与 tooltip 正确
- [ ] 视图保存/恢复/删除闭环；数据源缺失时单格降级不整板崩溃
- [ ] resnet50.onnx 交互正常：缩放、搜索、上下游高亮、节点折叠、导出 SVG
- [ ] 6,000 节点 ONNX 走 Canvas 降级路径并有进度提示
- [ ] PNG/SVG/HTML/MD/JSON 五种导出均正确，HTML 断网可看
- [ ] 中英文完整，明暗主题下图表与文本对比度均达标
- [ ] 路径穿越测试（`../`、符号链接、根外绝对路径）全部返回 403/400 且不泄露文件内容
- [ ] 非 loopback 请求全部被拒（curl 用局域网 IP 验证）
- [ ] 断网环境下全功能可用（无任何外部请求，DevTools Network 为空）
- [ ] 诊断路由返回实际加载版本与最近错误
- [ ] README 双语、含安装一行命令、支持格式表、限制说明、截图 3 张

---

## 11. 上线插件市场

### 11.1 命名与可用性

- 包名首选 `dsh-datapilot`；备选 `dsh-data-workbench`、`@<scope>/dsh-datapilot`。
- 发布前先验证：`npm view dsh-datapilot version` 应报 404（未占用）。
- 显示名：**DataPilot · 数据工作台**；副标题：*多工作区数据集分析 & 模型结构可视化*。

### 11.2 本地自测 → npm 发布

```bash
# 1) 本地目录加载（不发布也能装）
dsh plugin --profile desktop add file:./dsh-datapilot
dsh plugin --profile web     add file:./dsh-datapilot

# 2) 冒烟：面板出现 + 诊断路由
curl http://127.0.0.1:<port>/api/dsh-datapilot/diagnostics

# 3) 发布
npm login
npm publish --access public
```

发布前置检查：
- `files` 白名单不含 `src/`、`.env`、测试数据（大文件会让包体爆掉）。
- `peerDependencies` 不锁死 DSH 版本（用 `>=0.2.0`）。
- README 首屏即可看懂「这是什么、怎么装、支持什么格式、有什么限制」。

### 11.3 目录收录（进商店可搜索）

dsh-market 的**应用**与**目录**是两个仓库：`dsh-market/dsh-market` 是市场前端，目录在 **`awesome-dsh-plugin/awesome-dsh-plugin`**（数据源 npm 包 `dsh-plugin-catalog`，站点 https://awesome-dsh-plugin.com/plugins.json，当前 10,581 条）。

1. Fork `awesome-dsh-plugin` 仓库，按其 CONTRIBUTING 提交条目（PR 或 Issue，以仓库当前要求为准），字段大致为：`name / owner / npm / category / description.en / description.zh / tags / homepage / repo`。
2. 分类选 **Tools & Capabilities**（现有 24 类中无数据类）——同时另开一条 Issue 提议新增 **Data & Analytics** 分类，为后续同类插件铺路。
3. 合并后等待目录重建（`dsh-plugin-catalog` 发布新版本），客户端 `dshmarket` 刷新即出现在「Tools & Capabilities」下。
4. 自检：`https://dshmarket.com/p/<owner>/<name>/` 详情页可访问（404 说明尚未收录）。

### 11.4 商店素材规范

| 素材 | 规格 | 内容建议 |
|---|---|---|
| 图标 | 512×512 PNG，透明底 | 数据点阵 + 图节点，深色下仍可辨 |
| 截图 | 1280×800，3–5 张 | ① 多工作区看板 ② 分布矩阵 ③ ONNX 图 ④ 跨工作区对比 ⑤ 导出 HTML |
| 双语简介 | 各 ≤ 200 字 | 强调「常驻侧栏 / 多工作区 / 零外部依赖 / 模型图」四点差异 |
| 演示 GIF | ≤ 5 MB | 添加目录 → 出图 → 开 onnx，15 秒 |

### 11.5 版本与回滚

- 首发 `0.1.0`；补丁 `0.1.x`；新增能力 `0.2.0`；破坏性接口（路由/视图 schema）随 minor 升并写迁移说明。
- 回滚：`npm deprecate dsh-datapilot@x.y.z "reason"`，同时把目录条目的 `latest` 指向上一版；面板诊断路由显示实际加载版本，便于用户确认是否已回退。

---

## 12. 风险与对策

| # | 风险 | 影响 | 对策 |
|---|---|---|---|
| R1 | slot / slot 注册 API 非公开契约，DSH 升级可能破坏 | 面板消失 | 启动时探测 `ctx.slots` 与目标 slot 是否存在；缺失时降级到 `settings.section`（学 nlbi 的降级策略）；诊断路由暴露 slot 探测结果 |
| R2 | 大文件内存溢出 | 进程被杀 | 列存预算 + LRU + 采样降级；解析放 `worker_threads`，主线程只做 IO |
| R3 | ONNX 解析超大图卡死 | 面板假死 | 节点上限、折叠、Canvas 降级、可中断（AbortSignal） |
| R4 | `.pt` 无标准图格式 | 功能预期落差 | 文档明说「不支持 .pt 计算图」；提供 state_dict 摘要 + 「导出 ONNX 后可视化」引导 |
| R5 | 与 chartlab / data-analysis 功能重叠被指撞车 | 商店评价 | 差异化四点写进 README 首屏（常驻面板 / 跨工作区 / 零 Python / 模型图） |
| R6 | Excel/CSV 坏数据导致解析器异常 | 崩溃 | 每格式独立解析器 + 坏行容忍 + 错误上报到面板而非抛栈 |
| R7 | 包体过大（> 5 MB 首装慢） | 安装成功率 | 图库自研、ONNX 用 protobufjs 轻量运行时、duckdb 设为 optional |
| R8 | 用户误以为面板能改数据 | 数据事故 | 全链路只读；UI 明确「只读预览」；写操作一律不出现在首版 |

---

## 附录 A · 市场检索原始证据

**目录分类全量（2026-11-11，共 10,581）**

AGI Architecture Exploration 73 · UI Enhancements 2102 · Usage & Billing 562 · Themes & Appearance 387 · Models & Providers 540 · Identity & Communication 131 · Sessions & Messages 806 · Memory 455 · Tools & Capabilities 1450 · WSL & Windows Interop 87 · Browser & Web 218 · Vision & Multimodal 195 · Voice & Audio 141 · Docs & Rendering 199 · Skills 380 · Workflow & Automation 636 · Git & Code Review 187 · Notifications & Integrations 355 · Development & Runtime 608 · Security & Permissions 272 · Remote & Mobile 306 · Plugin Markets & Managers 140 · Just for Fun 351

> 24 类中无一涉及「数据集 / 分析 / 图表 / 模型可视化」——这是本 PRD 立项的结构性依据。

**检索指令记录**

- `dshmarket.com/browse` 名称过滤：`data` → 1 条噪声；`chart` → 0 条（页面空白 + 页脚）。
- npm registry：`dsh onnx` → onnxruntime-common/web/node、onnx-proto、`@deepseek-ai/dsh-experimental-speech-to-text-sensevoice`（ONNX 语音转写，非可视化）。
- 商店详情页探针：`/p/chengxianglibra/dsh-data-analysis/` → 404（该插件在 npm，未进目录）。

**未完成项（诚实标注）**：因 `plugins.json`（多 MB）在浏览器端 body 读取挂起，描述级全文扫描未 100% 覆盖；若需彻底确认，可 `npm i dsh-plugin-catalog` 后本地 grep 全部 `description.en/zh`。

---

## 附录 B · 与竞品的定位差异（一句话版）

> 别人做的是「在对话里画个图」；DataPilot 做的是「一个常驻的工作台：多工作区的数据摆一屏，模型结构点开就能看，断网也能用，不装 Python」。

---

## 附录 C · 术语

| 术语 | 含义 |
|---|---|
| 根目录 Root | 用户登记的可扫描目录（工作区目录或任意本地目录） |
| 数据集 Dataset | 单个表格型文件（csv/parquet/xlsx…）的运行时引用 |
| 看板 Board | 多图表单元格的网格容器，可跨根目录与工作区 |
| 视图 View | 看板 + 布局 + 筛选 + 数据指纹的持久化快照 |
| 结构图纸 | 用户已有的模型架构图片/PDF（非解析生成） |
| 交互结构图 | 从 ONNX 解析得到的可缩放节点图 |
