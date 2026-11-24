# Proposal: 输入 `[[` 时提供 vault 笔记候选

- Change ID: `add-wikilink-suggestion-nov24`
- 日期: 2026-11-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）
- 关联 change：[`fix-wikilink-caret-reveal-nov24`](../archive/2026-11-24-fix-wikilink-caret-reveal-nov24/proposal.md)。两者可同批完成节点 1 评审，但无行为或归档硬依赖；按真实文件冲突排程，分别独立验收与归档。

> 评审记录
> 节点 1：通过。独立评审 r2 为 clean / ready-for-Alex；Alex 已「采纳。wikilink 按推荐。」推荐方案已完整写入 design 与 spec delta，按此实现；本次提交不包含归档。

## Why

当前作者必须完整记忆并手输 wikilink target；vault 已有内存文件索引、列表子串过滤、Escape 层栈与浮层几何能力，可以在不新增 IPC、依赖或焦点输入框的前提下提供行内候选。候选必须服务「写出能被 Rust 解析到同一文件的链接」，不能把用户输入的模糊前缀当成最终 target，也不能在候选层暗中创建文件。

本 change 不在完整既有 wikilink 内部触发，接受后光标位于新增 `]]` 之外；这些行为不依赖 A 的内部显露修复。A 可优先施工以减少 `src/editor.ts` 等真实文件冲突，但不是 B 开工、验收或归档的前置条件。

## What Changes

- 新增 `wikilink-suggestion` capability：可编辑 md 文档中，空光标位于行内未闭合、非 embed 的 `[[` 之后时显示笔记候选；代码、frontmatter、标准 Markdown `Link` / `Image`（含未闭合 label / alt）、只读、完整既有链接内部与 IME 组合期不触发或刷新。
- 候选同步读取 `vaultFilePaths`，只保留与 Rust `is_markdown` 相同的 `.md` 后缀路径，明确排除 `.markdown`；复用 watch 后的同一数组，不增加 IPC、异步枚举或新依赖。复用 `list-filter` 的大小写折叠子串与保序语义，结果按精确 stem、折叠 stem、前缀、子串四层稳定分桶，不打分。
- v1 接受文本改为**完整 vault 相对路径并保留实际 `.md` 扩展名**，不再按 folded stem 唯一性猜短链。非根路径利用 Rust 根相对精确匹配；根文件仅当精确文件名在索引中唯一时接受，否则不提供接受。接受前按当前索引重算证书，不能证明 `resolved && path === 所选路径` 就不插入。
- Enter 经既有 `markupKeymap` 分支接受；↑ / ↓ 与 ⌃P / ⌃N 在既有光标命令内分派；Escape 注册既有 escape-router 层；Tab 完全不接管。鼠标行复用 `mousedown preventDefault`，编辑器始终持焦。
- IME 组合期不刷新候选、不吞组合确认 Enter；`compositionend` 后必须等 CM pending MutationRecord flush 且组合标志清除，再重读最终 `EditorState` 补一次刷新，不在 handler 内同步读旧 query 或 dispatch。
- 浮层复用 `placeOverlay` 的 list 档与 Quick Open 的行几何，壳背景使用不透明的 `--preview-bg`，其余边框、圆角、阴影、文字和选中态全部复用现有 token；新滚动容器纳入既有注册表。

## Non-goals

- v1 只处理 `[[`，不处理 `![[`、附件候选、标题 / alias 补全或新转义语法。
- 不在候选中直接创建笔记，不提供「创建并链接」行，不自动打开目标；不存在笔记仍由既有显式 ⌘⏎ 流程创建。
- 不接 Tab，不新增物理键绑定，不使用 `@codemirror/autocomplete`，不复制 Quick Open 的持焦 input 或 modal 状态机。
- 不引入相似度、模糊子序列、拼音、全角 / 简繁归一或命中高亮，不改变 Rust 解析与既有创建语义。
- 不承诺枚举惰性目录之外的已知索引边界，不为无法无损表示或无法证明唯一解析的路径提供接受。
- 不把 A 的归档作为施工 / 验收 / 归档门禁；冲突只按两 change 实际改动文件集判定。

## Impact

- 影响的 specs：新增 `wikilink-suggestion`；可独立验收，不消费 A 的 spec delta。
- 影响的代码/系统：编辑器行内非模态浮层、现有光标命令与 `markupKeymap` 分派、vault 内存索引、前端样式与 visual / unit / 真机验收。
- 关联约束：ADR 0002 §6 keypress-to-paint <16ms；ADR 0003 §3 源文件不被隐式改写；统一键位与 escape-router 合同；滚动容器注册表与 overlay 宽度合同。

## 待裁决点

1. **接受键**：推荐 Enter 经既有 `markupKeymap` 分支接受；Tab 保持列表缩进，不接管。
2. **不存在笔记**：推荐候选只负责插入，不提供创建行；创建仍归既有显式 ⌘⏎，不在候选浮层直接创建或打开。
3. **v1 范围**：推荐只做 `[[` 笔记候选，不做 `![[`，避免把附件全集与双语义展示带入第一版。
4. **排序**：推荐精确 stem → 折叠 stem → 前缀 → 子串四层稳定分桶，桶内保序，不引入相似度打分。
