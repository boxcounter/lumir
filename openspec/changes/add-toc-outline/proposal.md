# Proposal: 轻量大纲 popover（TOC）

- Change ID: add-toc-outline
- 日期: 2026-09-17
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

长文档里「跳到某一节」目前只能靠滚动。Lumir 已有 wikilink 锚点跳转（打开别的文件后定位标题行），
但**同一份文档内部**没有任何导航能力——这是 Emacs 用户的常规期待（`imenu`），也是 PKM 场景里
「先看结构再读正文」的基本动作。

Alex 的需求原话（2026-09-17，M148 需求）：**「增加 TOC——我希望是视觉和交互上比较轻的，而不是重的
（重的比如增加右栏专门做 TOC）」**。因此本 change 的形态约束是**零常驻占地**：不加右栏、不加常驻
面板、不在文档区占任何面积。入口形态经 Alex 裁决采纳（原话「同意」）：「header 显示当前 heading
路径（兼作位置指示），点击它或按 ⌘⇧O 展开浮层大纲」。

现状锚点：masthead 只有 vault 名与文件名两段（`src/shell.ts:30-35`），文件名在打开文件
（`src/main.ts:187` 附近）、dirty 变化（`src/main.ts:686-690`）与 vault 切换（`src/main.ts:777`）
时更新；标题数据已可从 CM 语法树拿到（`src/preview/livePreview.ts:692` 的 `ATXHeading[1-6]` 遍历
先例），不需要第二次 Markdown 解析。

## What Changes

1. **masthead 增加当前位置指示段**：文件名之后显示当前标题链（如 `3 目标态 › 3.1 P0 总览`），
   随光标移动与滚动更新；光标落在首个标题之前（前言 / frontmatter 内）时不显示该段。无已打开文件、
   文档无标题、code 模式同样不显示——它只描述「当前文件里的当前位置」。
2. **点击指示段或按 ⌘⇧O 展开浮层大纲**：H1–H6 按层级缩进的条目列表，当前段高亮；`↑↓` 移动、
   `Enter` 跳转、`Esc` 关闭、鼠标点条目跳转；跳转把光标放到标题行尾并把该行滚到视口居中。
3. **键位走统一键位层**：新命令 id `toc.toggle`（作用域 `global`），默认绑定 `⌘⇧O`，进
   `KEY_BINDINGS` 与 `GLOBAL_COMMAND_IDS`——因此自动出现在 `app.describe-bindings` 面板里，`[keys]`
   配置也能重绑或解绑它。浮层自己的导航键（`↑↓` / `Enter` / `Esc`）就地消费、**不进**键位表，
   理由与 M133 键位面板 / M139 搜索 panel 同一套（表内一个 token 只能有一条绑定，而这些 token 已被
   editor 作用域占用）。
4. **空标题文档给出提示**：文档没有任何标题时按 ⌘⇧O 只给 toast，不弹空浮层（避免「点了没反应」与
   「弹出一个空框」两种坏体验）。
5. **标题口径**：数据只来自 CM 语法树的 ATX 标题节点；文本取该行原文去掉 `#` 标记；frontmatter
   块内的 `#` 行（YAML 注释）不算标题；缩进按文档里出现的最浅层标题归一，避免只有 H2/H3 的文档
   浪费一层空缩进。
6. **视觉与文案**：浮层只用 M55 的既有 token（`--bg` / `--bd-*` / `--dim` / `--font-*` / `--radius`），
   绝对定位、不参与布局；新增文案进 `文案-Copy.md`（D84–D87）。

## Non-goals

- **不做右栏 / 侧栏 TOC、不做 minimap**：这正是「重」的形态，与 Alex 的需求原话相反。
- **不做文档内嵌 `[[toc]]` 标记**：那是文档内容层的能力，与「界面上的轻入口」是两件事。
- **不做 heading 折叠、不做跨文件大纲**：前者属于编辑器折叠能力（另有边界），后者需要一个全局
  符号索引（当前不存在）。
- **浮层不做搜索过滤、不做拖拽调整层级**：v1 保持轻，条目多到需要搜索时再议。
- **不识别 Setext 标题**（`===` / `---` 下划线形态）与行内标记剥离：v1 只认 ATX 标题、文本保留行内
  标记原文（`## **粗**标题` 显示 `**粗**标题`）。这是取舍不是遗漏，边界写进 spec。
- **不改文档**：跳转只移动选区与视口；`EditorState.doc` 与磁盘文件在一切操作下逐字节不变
  （ADR 0003 §3 铁律）。浮层不提供重命名标题等写操作。

## Impact

- 影响的 specs：新增 capability `toc-outline`（本 change 的 delta 归档后成为 living spec）；
  `keymap-commands` 增加一条命令与绑定（`toc.toggle` / `⌘⇧O`）。
- 影响的代码/系统：`src/toc.ts`（新增：标题提取、位置指示、浮层本体）、`src/shell.ts`（masthead
  增加指示段元素）、`src/main.ts`（装配与命令实现）、`src/keys.ts`（命令 id 与绑定）、
  `src/style.css`（指示段与浮层样式）。跨 scope 只读依赖一处：`src/toc.ts` import
  `src/preview/frontmatter.ts` 的 `detectFrontmatter`（tower 批准，2026-09-17），避免 frontmatter
  判定出现第二处真源；被依赖文件零改动。
- 影响的文档：`文案-Copy.md`（D84–D87）。
- 影响的测试/验收：`scripts/acceptance/scenarios/13-toc.md` 与三份 fixture
  （`toc-outline.md` / `toc-frontmatter.md` / `toc-plain.md`）、`scripts/acceptance/README.md`
  的已知边界补一条「光标位置的派生证据」。
- 关联约束：ADR 0003 §3（不改写源文件）、ADR 0002 §2（单内核双模式）与第 6 条（性能合同：键击
  路径不整篇解析）、ADR 0006（当前定位）、ADR 0004 第 5 条（功能变更走 OpenSpec）。
- 视觉基线：masthead 多一个可能出现的指示段，**含标题的文档截图会变**（空态与无标题文档不变）。
  `tests/visual/**` 不在本 mission 的 scope（M147 持有），基线更新时间点由 tower/Alex 裁决。
