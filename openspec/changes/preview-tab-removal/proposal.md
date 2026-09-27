# Proposal: 移除预览标签机制（单击树文件一律开正式标签）

- Change ID: preview-tab-removal
- 日期: 2026-09-27
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 2026-09-27 真机反馈原话：

> 「需改进：2. TAB 栏上第一个 TAB 名是斜体，其他 TAB 不是」

这是一条**可用性反馈**，不是回归：斜体是 multi-tabs spec 明写的预览标签设计（living spec 的「标签栏的显示与形态」写着「预览（临时）标签的标题 SHALL 为斜体」，配套的「打开与固定语义」把「单击树文件 = 复用预览标签、双击 / ⌘-点击 = 固定」写成了能力语义，实现 M149，2026-09-17 归档）。Alex 看到的是它的实际效果：同一条标签栏上两种字形并存，而斜体表达的那件事（「这一篇会被下一次单击顶掉」）在真实使用里没有传递出去——反馈本身说明它没被读成设计信号，被读成了「这里坏了一个样式」。

tower 裁决（替 Alex，可否决、已报备）：**按反馈移除整个预览标签机制**——斜体不是 bug，但一个没被读懂的隐藏状态机是产品负担，比它带来的「单击浏览时不堆标签」这点便利更贵；单击树文件直接开正式标签，斜体随之消失。本 change 落地这条裁决。

## What Changes

1. **单击树文件开正式标签（不再预览复用）**：树上的单击 / 双击 / ⌘-点击一律是「打开一个标签」——文件已打开时切到既有标签，否则新开；MUST NOT 顶掉任何已打开的标签。旧语义里「⌘-点击 = 新固定标签」因此与单击同义（预览那一半没了，「固定」也就没有对立面），树不再判定打开意图。
2. **取消逐标签的预览标记与其可见形态**：标签标题的斜体（`src/style.css` 的 `.tab.is-preview .tab-name`）删除；「首次输入即固定」这条提升逻辑随之退场（没有可提升的状态）；标签栏的可见形态因此对每个标签一致。
3. **spec 增量**：`multi-tabs` 的「打开与固定语义」整条移除、由「打开语义」承接（模式的二元性——预览 vs 固定——是它的一半内容，改名重述比缝补更诚实，先例见归档 change `editable-non-md-files` 的 REMOVED + ADDED 承接）；「标签栏的显示与形态」按 MODIFIED 改述（去掉斜体句）。

## Non-goals

- **不动「按 vault 持久化标签列表」的既有行为面**：会话入盘原本就只收固定标签（预览标签不入盘），移除预览机制后**全部**标签都入盘——这是本 change 的自然结果，不是新增能力；入盘时机、激活项相对路径、恢复逐标签打开的既有口径一律不改。
- **不改文档内链接跟随 / 另存为新文件 / 恢复备份的落点**：三条仍是「就地替换前台标签」，与本 change 无关。
- **不动 `EditorSession.preview` 之外的会话模型**：`id` / `state` / `path` / `mode` / `editable` / `cleanDoc` / `dirty` / `scroll` 逐字不动；`src/editor.ts` 在本 change 里的改动只有删掉 `preview` 字段（定义与初始化各一处，scope 已由 tower 扩入）。
- **不引入「已固定的标签」这个概念**：不新增 pinned 字段、不做「固定 / 取消固定」入口——移除预览机制的方向是**减少**标签状态，不是换一个状态。
- **不收窄 `src/save-controller.ts` 的 `OpenIntent` union**：它仍写着 `"current" | "preview" | "pinned"`，装配层加了一层显式适配（非 `"current"` 一律按 `"new"`）。那个文件不在本 change 的 scope 内，收窄它是一次独立的小改动，落点记在 `docs/backlog.md`。

## Impact

- 影响的 specs：`multi-tabs`（一条 REMOVED、一条 ADDED、一条 MODIFIED）、`vault-workspace`（两条 MODIFIED：「按 vault 持久化标签列表」的「预览标签不入盘」与「装载后恢复标签列表」的「以固定标签语义逐个打开」——不带上它们的增量，归档后 living spec 会与实现直接矛盾：入盘过滤已经删除、恢复走的是 `"new"` 落点）
- 影响的代码/系统：`src/tree.ts`（打开意图参数删除）、`src/main.ts`（落点意图收敛为 `"new"` / `"current"`；「预览标签首次输入即固定」的监听整块删除）、`src/tabs.ts`（预览标记与「可复用标签」挑选删除）、`src/editor.ts`（`EditorSession.preview` 字段与初始化删除）、`src/vault-switcher.ts`（入盘过滤里的 `!session.preview` 删除）、`src/style.css`（斜体规则删除）；无 Rust 侧改动、无新增命令、无新增配置项
- 关联约束：ADR 0003（不写 vault）；ADR 0006（Emacs keybinding PKM 定位下标签栏仍是窗口级对象，本 change 不改它的入口与键位）；真机验收套件场景 `14-tabs` 的预览断言随本 change 改述（同一 mission 内）
- 视觉基线：去斜体让涉及标签栏的两张元素基线失配（`tab-bar-preview` 与含预览态的那些）——按 M237 先例走「过目包 + 只重建受影响基线」，见 tasks §5
