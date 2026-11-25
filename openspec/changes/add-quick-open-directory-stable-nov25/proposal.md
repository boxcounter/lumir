# Proposal: Quick Open 一层目录候选与稳定浮层

- Change ID: `add-quick-open-directory-stable-nov25`
- 日期: 2026-11-25
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**已通过**。Alex 2026-11-25 原话「Quick Open 按推荐」，批准诊断推荐的完整范围：
> 一层目录候选与子目录进入、vault 根与 lazy 直接子项、独立外部只读目录命令、pending/空/不可读/不存在分态、
> 100 条截断、输入框置底且 bbox 稳定、候选区至少 6 行、Quick Open 独立 `clamp(26em,50vw,56em)` 宽度、
> 验收 DSL 可记录并逐值比较 bbox。基线更新不在批准内，仍须另行过目。
> 追加确认（2026-11-25）：Alex 明确去掉「按 Enter 打开 ……」direct action 伪候选的视觉展示，因为它与
> 真实候选太像；精确路径 Enter 直接打开、普通/目录候选与 `:行号` 行为不变。该行不再占用列表、AX 或
> 游标空间，也不新增另一段相似提示。此前候选图未包含这项变化，不得视为已获 Alex 批准。
> 节点 2（归档放行，2026-11-25）：**机器 + 独立评审放行**（`docs/process/openspec-workflow.md` 五要件）。
> 1. **方案已批准**：节点 1 Alex 2026-11-25 原话「Quick Open 按推荐」；direct action 伪候选删除为同日追加确认，
>    实现期无静默扩 scope。
> 2. **独立 reviewer clean / merge**：tower 主模型 verdict **clean / merge**，绑定 tip
>    `e2f38af965a4f9a1ae6ba924acfe6b69d4a48889`，P1 / P2 / P3 无新增，原 K3 P1-1 已关闭；报告
>    `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/quick-open-directory-stable-nov25/tower-verdict.md`。
> 3. **tasks 完成**：全部勾选（5.5 于本归档批次收口），无放弃项。
> 4. **门禁与真机证据**：最终 tip 完整 `gate visual` 原始行 `GATE RESULT: 15/15 PASS（SKIP 0）`、exit 0
>    （`/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/quick-open-directory-stable-nov25/gate-visual-final-tip.log`）；
>    真机 230a / 230b / 230c / 707 / 874 **PASS 5 / FAIL 0 / INVALID 0，合计 176 断言**
>    （`/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-25-quick-open-direct-contract-r3/`）。
>    静态复验 289 场景、执行器 122/122、docs-check、OpenSpec 39/39 均 PASS。45 张视觉候选是 git 外审查材料、
>    Alex 2026-11-25 已认可其视觉；**未写入正式视觉基线，本批新增像素基线 0**。
> 5. **规格对账**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS（13 份 delta / 20 条 MODIFIED /
>    428 段，无静默丢段）；`openspec validate --all --strict` 39 passed / 0 failed；归档跟踪队列唯一条目。

## Why

现行 Quick Open 的目录语境只从普通文件索引筛直接子文件：vault 外绝对目录、vault 根、子目录候选和 lazy 直接子项都无法呈现。浮层底边虽固定，输入框却位于自然高度内容顶部，因此 0/1/多候选、异步补帧与长提示会移动输入框。只读诊断已核对基线 `3a734248` 的解析、候选、CSS 与验收入口，结论是本 change 同时补新能力和既有质量合同缺口，而非只修一个路径案例。

本 change 接续活跃 change `overlay-width-contract-oct24` 的列表稳定性与路径截断合同，只修订 Quick Open 的约定宽度；TOC 的 26em 宽度、其它浮层和该 change 本身不改。

## What Changes

1. **一层显式目录语境**：相对/绝对 vault 目录、vault 根及以 `/` 结尾的外部绝对目录，只读列直接子文件和子目录；子目录尾 `/`，接受后进入下一层。vault 内复用 `fs_scan_dir`，lazy 只作为显式目录候选，不进普通索引。
2. **外部只读目录命令**：新增独立 `fs_list_external_dir`，Rust 强制绝对路径、拒绝 `..`、canonicalize 后为目录，只返回 `path + kind` 并保持确定顺序；不放宽 `fs_read_external`，不递归、不 watch、不建索引、不写盘。
3. **同源判决与状态**：目录 pending/空/不可读/不存在分别可见；异步迟到结果按 `renderSeq` 丢弃；100 条上限和截断提示不变。文件按现有链打开，外部文件只读；裸 vault 目录两段式 Enter、普通搜索、`path:line` 与真实候选键盘导航不变。direct action 伪候选及其鼠标/AX/游标入口删除，但精确路径 Enter 直接打开能力保留。文件加 `/` 不得去斜杠打开。
4. **稳定几何**：输入框置底固定，候选/空态同区域，提示在输入框上方；任意内容状态下 input bbox 逐值不动。候选区至少 6 行，超出只滚列表；80vh 与 modeline 上方实际可用高度共同限高。Quick Open 使用 `clamp(26em,50vw,56em)` + `max-width:calc(100vw - 28px)`。
5. **机器验收**：合同先行补 O7 不变量与属性矩阵；Rust 安全/零写入、前端目录与异步矩阵、Chromium 窄宽/resize×内容状态×三主题几何；新增真机 874 及 bbox 记录/比较 DSL，缺 bbox fail-closed。只提交场景和静态证据，本 worker 不起真机。

## Non-goals

- 不做完整文件管理器：不递归、不监听新目录、不建索引、不写盘、不改文件树、不返回上级快捷键。
- 不放宽外部文本文件读取接口，不让 lazy 条目进入普通搜索、链接或附件索引。
- 不改变普通搜索匹配/排序、`path:line`、真实候选键盘导航和既有文件打开链；本次仅删除 direct action 伪候选展示，不删除精确路径 Enter 直接打开能力。
- 不改 TOC 或其它浮层宽度，不更新视觉基线，不启动真机，不 push/merge/archive。

## Impact

- 影响的 specs：`quick-open`、`fs-io`；质量合同 `docs/specs/overlay-visibility.md` 新增 O7。
- 影响的代码/系统：Quick Open 解析与 DOM、装配 IPC、Rust 外部目录只读命令、Quick Open CSS、前端/视觉/验收测试。
- 关联约束：ADR 0002（Rust core 文件 IO）、ADR 0003（不改写源文件）、渲染/交互缺陷合同先行、overlay-width 活跃 delta 的列表稳定口径。
