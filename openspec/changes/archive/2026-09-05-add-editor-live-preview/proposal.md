# Proposal: 编辑器单内核双模式落地——live preview 装饰层、frontmatter properties、附件图片显示

- Change ID: add-editor-live-preview
- 日期: 2026-09-05
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

M1 出口标准是"能用 Lumir 只读浏览作者的整个真实 vault"（[ADR 0004 §1](../../../docs/adr/0004-development-and-openness-strategy.md)）。打开 vault、列出文件（add-vault-workspace）之后，浏览体验由本 change 承载：Markdown 以 live preview 形态呈现而非裸源码，frontmatter 渲染为 properties 区块，附件图片内联显示。

技术路线早已裁决：编辑器单内核 CodeMirror 6，md 模式 = 高亮 + live preview 装饰层，code 模式 = 仅高亮（[ADR 0002 §2](../../../docs/adr/0002-technical-route.md)），不做两个编辑器。frontmatter 解析为 YAML、渲染为 properties 区块与附件引用显示（`![[image.png]]` 与标准 `![alt](path)`）在 Obsidian 兼容范围内（[ADR 0003 §1](../../../docs/adr/0003-obsidian-compatibility-scope.md)）。

Foundation（M16 已合并）已备好接缝：`src/editor.ts` 用 Compartment 收敛模式差异、`mdLivePreviewDecorations` 占位即装饰层挂载位、`EditorMode`（md/code）经配置驱动并在启动时应用（src/main.ts）。本 change 在真实缝上落地，不发明新结构。

**跨 change 依赖（显式声明）**：附件图片显示依赖 add-vault-workspace 的"按路径读二进制附件字节"能力（其 fs-io capability 的「二进制附件读取」requirement）。本提案只声明对能力的依赖，不绑定其接口形态——add-vault-workspace 的裁决点 A（invoke+base64 vs asset protocol）悬而未决，两种形态本 change 均可适配（base64 → `data:` URL；asset protocol → `convertFileSrc`）。若节点 1 评审时两份提案一并批准，实现顺序为 add-vault-workspace 先行。

## What Changes

新增三个 capability：`editor-live-preview`、`frontmatter-properties`、`attachment-display`。每条对应 specs/ 增量中的 requirement。

1. **双模式落地**（`editor-live-preview`）：md 模式 = 高亮 + live preview 装饰层；code 模式 = 仅高亮；切换走既有 Compartment 热切换（不重建 EditorView、不丢文档状态）。模式来源：配置 `editor.mode` 决定初始模式（已接线）；本 change 增加按文件类型选择模式——md 文件用 md 模式，代码文件用 code 模式。
2. **live preview 装饰层**（`editor-live-preview`）：用 CM6 decoration 在 `mdLivePreviewDecorations` 占位处实现：标题分级样式、加粗/斜体/删除线隐藏标记符并渲染字形、列表符号美化、引用块样式、代码块背景。M1 出口是只读浏览，装饰层按无编辑光标设计：MUST NOT 做光标所在行 reveal 源码的编辑态逻辑（无编辑则无光标行概念），该逻辑推迟到有编辑能力的波次。
3. **frontmatter properties 区块**（`frontmatter-properties`）：md 文件首部 YAML frontmatter 解析并渲染为 properties 区块（键值表格形态），替换源码原文的显示；tags 字段按标签形态展示。解析失败（非法 YAML）时回退为原文显示并提示，MUST NOT 丢弃内容。
4. **附件图片显示**（`attachment-display`）：`![[image.png]]`（Obsidian 方言）与标准 `![alt](path)` 指向图片附件时，在文档内对应位置内联渲染图片；附件不存在或读取失败时显示占位与人话提示。`![[note]]` 等指向笔记内容的嵌入不在范围（ADR 0003 §2 明确不做，MUST NOT 实现递归嵌入）。

**⚠ 裁决点 D——装饰层构建策略**：两个候选：
- **视口增量构建**（ViewPlugin，推荐）：只为可见区域构建 decoration，文档滚动时增量更新。天然满足性能合同——打开 1MB Markdown <100ms（ADR 0002 §6）下全量构建 decoration 是主要风险点。
- **全量构建**（StateField 一次算全文档）：实现简单，但大文件打开路径上一次性成本不可控。

推荐视口增量。代价是实现复杂度高、滚动路径需要测试覆盖；但性能合同是一票否决级（ADR 0001 §5），且 keypress-to-paint <16ms 的相对回归门禁已在 CI 生效，全量构建很难长期守住。**请 Alex 裁决。**

**⚠ 裁决点 E——frontmatter YAML 解析深度**：候选：引入 `js-yaml` 全量解析 vs 自写最小子集解析（扁平键值 + 字符串数组，覆盖 properties 展示所需）。推荐 `js-yaml`：frontmatter 是 YAML 惯例（ADR 0003 Context），自写子集会在真实 vault 的合法 YAML（嵌套、多行字符串）上误判；properties 区块对嵌套值可用 JSON 样式展示，解析层不应自造方言。代价是新增一个前端依赖（体积约 40KB，计入包体与性能门禁）。**请 Alex 裁决。**

**⚠ 裁决点 F——附件路径解析口径**：`![[image.png]]` 不带路径时，Obsidian 方言是 vault 内短路径匹配（同名附件在任意目录都能找到）。完整短路径解析属于 wikilink spec 冻结范围（ADR 0003 §4，wikilink change 的前置任务），本 change 不应抢跑。候选：
- **本波口径**（推荐）：标准 md 图片按相对当前文件路径解析；`![[...]]` 先做"vault 内按文件名唯一匹配"（无同名歧义时解析成功，有歧义时按序取第一个并在实现期记录——歧义处理细则留给 wikilink spec 冻结时统一裁决）。
- 完整 Obsidian 短路径语义：推迟到 wikilink change。

**请 Alex 裁决 F 的口径是否接受"唯一匹配 + 歧义从简"。** 该口径与 add-vault-workspace 无接口分歧（只消费"按相对路径读附件"能力），是两份提案间唯一的语义衔接点。

## Non-goals

- 不做任何编辑能力：M1 编辑器只读（M1 出口为只读浏览）；装饰层不含光标行 reveal、不含输入态行为。
- 不做 wikilink `[[note]]` 跳转与链接图——独立 change（其前置的 spec 冻结 + fixture 合成安排在 M1 第 1 周，ADR 0004 §4）。本 change 不解析 `[[...]]` 为链接。
- 不做内容嵌入（`![[note]]` transclusion）、块引用 `[[note#^block]]`、Dataview、Canvas（ADR 0003 §2 声明不做）。
- 不做 backlinks 面板（ADR 0004 §2 挤压预案明确可推迟）。
- 不涉及 CSP 变更：完整 CSP 策略（含 `img-src 'self' asset: data:`）已随 M16 落地于 tauri.conf.json，图片经 `data:` 或 `asset:` 进入 webview 均已放行。
- 不做非图片附件（PDF、音视频）的内联预览。
- 不做代码文件的 live preview（code 模式 = 仅高亮，ADR 0002 §2）；代码 fence 内的语言级着色复用 `@codemirror/lang-markdown` 既有能力，不为更多语言引入新 parser 依赖。

## Impact

- 影响的 specs：新增 capability `editor-live-preview`、`frontmatter-properties`、`attachment-display`。
- 影响的代码/系统：`src/editor.ts`（`mdLivePreviewDecorations` 占位处落地装饰层、按文件类型选模式）、新增 decoration/frontmatter/attachment 相关前端模块、`src/main.ts`（装配）；Rust 侧不新增 command（读取能力由 add-vault-workspace 提供）。依赖新增：裁决点 E 若通过引入 `js-yaml`。
- 关联约束：ADR 0002 §2（单内核双模式）、§6（性能合同：装饰层构建策略的直接依据——打开 1MB <100ms 的 CI 绝对阈值与 keypress-to-paint 相对回归门禁均已生效，本 change 是直接承压方）；ADR 0003 §1（兼容范围：frontmatter properties、附件引用显示）、§2（不做清单）、§3（铁律：只读，天然满足）；ADR 0001 §5（极致快一票否决）。依赖 add-vault-workspace 的 fs-io「二进制附件读取」（跨 change 依赖已在上文显式声明）。
