# Tasks: add-editor-live-preview

> 归档状态（M21，2026-09-05）：实现已随 M19（feat/editor-live-preview，commit 6775b24 + rebase/修复 c3e7202）与 M20 接线（f74cd39 + r1 p2 修复 3f79cc1）合并入 master（de145ad）。1.4 与 5.2 未勾，原因见各条标注（占位口径演进条款 / Alex 人肉验收替代），不伪造完成。归档说明（一致性论证）见文末第 6 节，供 Alex 节点 2 评审。

## 1. 双模式与 live preview 装饰层（editor-live-preview）

- [x] 1.1 双模式落地：md = 高亮 + 装饰层，code = 仅高亮；按文件类型选择模式（md → md，代码 → code），Compartment 热切换不重建 EditorView
- [x] 1.2 装饰层在 `mdLivePreviewDecorations` 占位处实现：标题分级样式、加粗/斜体/删除线隐藏标记符、列表符号美化、引用块样式、代码块背景
- [x] 1.3 装饰层构建策略按裁决点 D 的裁决结果实现（推荐视口增量 ViewPlugin）；只读口径，不做光标行 reveal
- [ ] 1.4 大文件验证：1MB Markdown 打开路径性能不回归（perf.yml 绝对阈值 <100ms）
  - **未勾，占位口径 + 演进条款注明**（M21 归档标注）：CI 现行 open-file 端点为占位口径——纯磁盘 IO + UTF-8 解码，不含解析与渲染（scripts/perf/open-file.mjs 自述；perf-measurement spec「打开 1MB Markdown 文件测量」requirement 同口径），测不到本 change 的装饰层渲染路径，勾选将造成虚假覆盖。装饰层按视口增量设计承压（裁决点 D，livePreview.ts 只为 visibleRanges 构建装饰）。演进条款已写入 living spec perf-measurement「占位口径的演进义务」scenario：M1 真实打开路径（Rust core 读文件 → webview 装载进 CodeMirror，已随本 change 与 add-vault-workspace 落地）后，该端点 MUST 经 OpenSpec 正常循环修订为「打开请求发出 → 文档在编辑器完成首帧渲染」，修订时复测本项。辅助证据：M19/M20 视觉门禁 3/3 绿，keypress-to-paint 相对回归门禁（CI enforce:true）未报警。

## 2. frontmatter properties（frontmatter-properties）

- [x] 2.1 YAML frontmatter 解析（裁决点 E：推荐 js-yaml）并渲染为 properties 键值区块，替换源码显示
- [x] 2.2 tags 字段按标签形态展示；嵌套值以 JSON 样式展示
- [x] 2.3 非法 YAML 回退原文显示并提示，不丢弃内容

## 3. 附件图片显示（attachment-display）

- [x] 3.1 标准 `![alt](path)`：相对当前文件路径解析，内联渲染图片
- [x] 3.2 `![[image.png]]`：按裁决点 F 口径（推荐 vault 内文件名唯一匹配）解析并渲染；不存在/读取失败显示占位与人话提示
- [x] 3.3 `![[note]]` 等笔记内容嵌入不实现（ADR 0003 §2），显示为原文或不可解析提示

## 4. 提案评审（节点 1）

- [x] 4.1 Alex 评审通过：不看代码即可裁决——裁决点 D/E/F、Non-goals、跨 change 依赖四者都答清楚
- [x] 4.2 跨 change 前置确认：add-vault-workspace 已批准并实现 fs-io「二进制附件读取」（或 Alex 裁决两份并行、附件显示任务最后落地）

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（M21 归档前复验通过）
- [ ] 5.2 用作者真实 vault 中的代表性 md 文件验收：live preview 渲染、frontmatter properties 区块、附件图片显示三者可见；perf.yml 与视觉门禁不回归
  - **未勾，由 Alex 人肉验收替代**（tower 裁决，M21 归档标注）：与 add-vault-workspace 5.2 同一口径——M1 出口标准即 Alex 浏览真实 vault（ADR 0004 §1），本项是出口验收动作，实现 agent 不自勾。可自动化部分已覆盖：M19 以 stub provider 自测附件成功/失败/占位三条渲染路径，并做临时接线集成验证（wiki 裸文件名唯一匹配、标准 md 图片相对解析、缺失占位、笔记嵌入提示、外部 URL onerror 占位，记录于 c3e7202 commit message，临时接线已回滚不提交）；M20 生产接线 Playwright + `__TAURI_INTERNALS__` 桩实测——附件图片真实渲染（naturalWidth>0）、缺失附件出人话占位、.rs 进 code 模式（f74cd39），defaultMode 回落复现路径实测（3f79cc1）；视觉门禁 3/3 绿（基线重建经人工过目）。

## 6. 归档说明（M21 记录，供 Alex 节点 2 评审）

本节回答节点 2 的通过标准："spec 增量与 proposal 的意图一致，无实现期静默扩 scope"。

**实现与 proposal 意图的一致性**

- 三个 capability（editor-live-preview / frontmatter-properties / attachment-display）与 proposal「What Changes」四条一一对应；无新增 capability，无删除 requirement。
- 裁决点落地均与推荐项一致：D 取视口增量 ViewPlugin（livePreview.ts：只为 visibleRanges 构建装饰，滚动 / 文档变更 / 语法树增量解析时重建）；E 取 js-yaml（frontmatter.ts，嵌套值 JSON 样式展示，非法 YAML 回退原文 + 提示）；F 取「vault 内文件名唯一匹配 + 同名歧义按确定性顺序（路径字典序）取第一个」；附件读取形态随 add-vault-workspace 裁决点 A 落 invoke + base64（M20 接线后 `readDataUrl` 走 `fsReadAttachment`）。
- Non-goals 全部守住：无编辑能力（只读口径，无光标行 reveal）；无 wikilink `[[note]]` 跳转解析；`![[note]]` 内容嵌入不实现，显示原文 + "内容嵌入不支持"提示；无 backlinks；无 CSP 变更；代码 fence 语言级着色复用 `@codemirror/lang-markdown`，未引入新 parser。

**StateField 偏离（透明披露；归档时已修订 spec 增量，见下）**

- 偏离点：frontmatter properties 区块未走裁决点 D 的视口增量 ViewPlugin 通道，而是经 StateField 构建（livePreview.ts `frontmatterDecorations`）。
- 原因（CM6 硬限制）：properties 区块是跨行 replace 装饰，CM6 不允许 ViewPlugin 提供的装饰替换换行符，该装饰技术上进不了视口插件通道。
- 影响评估：StateField 仅在 `docChanged` 时重算；`detectFrontmatter` 自文档首部扫描且有 200 行上限（frontmatter.ts `MAX_FRONTMATTER_LINES`），不是全量文档装饰构建，与裁决点 D 的性能意图（打开 1MB <100ms）不冲突；live preview 的行内/行级装饰本身仍严格按视口增量构建。裁决点 D 的裁决对象是"装饰层构建策略"，本偏离是其在 CM6 硬约束下的局部落地形态，不是策略推翻。
- M19 修复历史（c3e7202）：`ImageWidget` 错误展示原直接渲染 CommandError 信封（`[object Object]`），改用 `ipc.errorMessage` 渲染人话——对齐 attachment-display「解析或读取失败的占位」requirement 的人话口径；视觉基线随装饰层/properties 区块落地重建，diff 经人工过目。

**M20 接线与意图对齐**

- f74cd39：`setAttachmentProvider` 注入生产 provider；打开文件改走 `editor.openDocument`——「按文件类型选模式」从装配层裸 `dispatch + setMode` 收进内核，与 editor-live-preview「单内核双模式落地」requirement 对齐。
- 3f79cc1（review r1 p2）：`defaultMode` 基线修复使「模式配置来源」requirement 的"配置决定无文件类型线索时的默认"口径严格成立（修复前模式随上一文件漂移）。属 spec 意图兑现，非新增行为。

**归档时对 spec 增量的修订（透明声明）**

- frontmatter-properties「frontmatter 解析为 properties 区块」补一句构建策略约束：跨行 replace 受 CM6 视口插件硬限制，实现 SHALL 经 StateField 构建、仅文档变更时重算、首部扫描有行数上限，MUST NOT 退化为全量文档装饰构建。理由：living spec 应反映实现真相，且该约束是后续维护者改动该区块时的真实边界。
- editor-live-preview「live preview 装饰层」补一句范围澄清：视口增量义务不含 frontmatter properties 区块（其构建策略见 frontmatter-properties spec）。
- 两处修订均为既有实现行为的如实落盘，无新增意图；若 Alex 判定 StateField 路线不可接受，应在本节点驳回，由后续 change 返工。

**Follow-up（不阻塞归档）**

- attachments.ts p3 对齐点（M20 已报 tower，留后续 change 处理）：
  1. `createInvokeAttachmentProvider` 工厂不接受注入的读取函数——生产 provider 只能在 main.ts 装配处就地构造（`resolveByName` 走 vault 文件索引活读闭包、`readDataUrl` 走 `fsReadAttachment` 封装），工厂的可测试性/复用性受限。
  2. `MIME_BY_EXTENSION` 表未导出——main.ts 就地维护同口径副本 `IMAGE_MIME`（注释已互引），两处存在漂移风险。建议后续 change 抽公共 MIME 表并让工厂支持注入读取函数。
- 1.4 真实打开路径端点：随 perf-measurement spec「占位口径的演进义务」走独立 OpenSpec 循环修订并复测。
- `![[...]]` 同名歧义细则与完整 Obsidian 短路径语义：留 wikilink spec 冻结统一裁决（ADR 0003 §4；M22 进行中）。
- 5.2 真实 vault 验收：随 M1 出口由 Alex 人肉执行。
