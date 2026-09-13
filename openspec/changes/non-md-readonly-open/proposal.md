# Proposal: 非 md 文本文件只读打开与扩展名注册表收敛

- Change ID: non-md-readonly-open
- 日期: 2026-09-13
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

M129 的键位盘点实证了一条保存死态（finding：`.tower/comms/findings/20260912-worker-keymap-survey-bug-md-php-svelte-txt-md-cmd-s-dirty.md`，行号基于 master 2b20582）。四个环节串起来才构成死态：

1. **分类与模式依赖两套扩展名集合**：`src/tree.ts` 的 `CODE_EXTS`（32 项）与 `src/editor.ts` 的 `CODE_EXTENSIONS`（29 项）差集为 tree-only = {hpp, bash, zsh, php, svelte}、editor-only = {cc, scss}。`.php`/`.svelte` 在文件树里被分类成 code，进编辑器却不在 code 集合里。
2. **不可保存却可编辑**：`main.ts` 只为 md 登记磁盘 revision（`kind === "md" ? snapshot.revision : undefined`），而 `modeForPath` 对未收录扩展回落配置默认（出厂 md）→ 文件以**可编辑 md 模式**打开：能改、能 dirty、套着 live preview，但 `displayedRevision === undefined` 使保存入口（手动 `saveDocument` 与自动 `reconcile`）在 dirty 时直接 return false —— Cmd+S 无任何可见反馈。
3. **dirty 锁死出口**：dirty 期间切换文件 / 切换 vault 被 guard 拦截、退出与关窗被后端守卫（`ExitRequested`/`CloseRequested`）拦截，而崩溃备份同样要求 revision 非 undefined → 连备份都没有。用户被困在「提示让他按 Cmd+S，而 Cmd+S 无效」的状态，只能强杀退出，修改必丢。
4. **影响面比 HANDOFF 的两例更大**：一切既非图片/二进制、也不在 code 集合的扩展（`.txt`/`.csv`/`.log`/`.lock`、未知扩展、dotfile）同陷；把配置 `editor.mode` 改成 code 时这批文件又变成只读，陷阱随配置默认值漂移。

D1–D4 经 Alex 裁决采纳，其中 **D4 = 方向 A：非 md 即只读 code 模式（`modeForPath` 不再 fallback 到 md）**（原话：「D1、D2、D3、D4 中你的建议都符合我的预期，都采纳。」）。

## What Changes

1. **单一扩展名注册表**：「扩展名 → 打开/展示分类 + code 语言名 + 附件 MIME」收敛为 `src/preview/attachments.ts` 一处声明与导出，tree.ts / editor.ts / main.ts 都改从这里消费（main.ts 自持的 `IMAGE_MIME` 删除）。落点理由：该模块已持有 `extensionOf` 与 MIME 表，且在依赖图上位于 editor 之下（editor → attachments），收敛不引入模块环，也无需新增文件。这同时清掉一条归档时记录的遗留项（`MIME_BY_EXTENSION` 未导出、main.ts 就地维护同口径副本，两处存在漂移风险——`openspec/changes/archive/2026-09-05-add-editor-live-preview/tasks.md` 第 68 行）。两套集合的差集逐项裁决：hpp → cpp 语言包、bash/zsh → shell、svelte → html（与既有 vue 同口径：SFC 按 html 兜底）、cc → cpp、scss → css(sCSS)、php → 无语言包（`@codemirror/legacy-modes` 实无 php mode，不用近似 parser 冒充高亮）；图片集合的 heic 原先只在文件树一侧，收敛后一并进入 MIME 与 `isImageName`。语言名的覆盖由编译期合同保证：注册表推导出的 `CodeLanguage` 联合类型即 editor.ts `LANGUAGES` 的键类型（缺一个实现或多一个无人引用的实现都会编译失败）。
2. **方向 A 落地**：模式裁决对 `.md`/`.markdown` 返回 md，对**其余一切有扩展名线索的文件**（已知代码扩展、`.txt` 之类的未收录扩展、dotfile）返回**只读 code 模式**，不再回落配置默认；只有「无扩展名线索」（path 缺失，或 basename 无点如 `LICENSE`/`Makefile`）才回落配置默认基线。于是 `.php`/`.svelte`/`.txt` 等打开即只读，dirty 不可能产生，保存死态在两个方向（配置默认 md 或 code）下都不再出现。
3. **不可保存态的可见反馈（兜底防再犯）**：dirty 且当前文档没有落盘能力（未打开文件 / 非 md 模式 / 未登记磁盘 revision）时，Cmd+S MUST 给出可见反馈并指出脱离 dirty 的动作（撤销修改），MUST NOT 静默 return；切换文件 / 切换 vault 的 dirty 守卫提示同样不再建议走不通的「请先保存（Cmd+S）」，改指撤销修改；崩溃备份对无落盘基准的 dirty 内容改为**显式跳过**并记录裁决（不写无法闭环的备份）。
4. **回归证据**：新增 `tests/visual/scenes/m130-text-open-trap.spec.ts`——非 md 只读矩阵（未知扩展 / 差集扩展 / dotfile）、差集扩展的语言归属、两处 Cmd+S 兜底（无打开文件、无扩展名文件回落默认）；视觉 stub 为既有非 md 条目补最小内容能力，使这些场景能点到真实文本而非 `fs_not_found` 提示。

## Non-goals

- 不做方向 B（让非 md 文本文件可保存）：放开 `fs_io::save_markdown` 的 md-only 守卫后，CAS / 自动保存 / 崩溃备份 / 退出守卫全链路都要按非 md 重新验证（含 md 专属的 live preview 不该套在代码文件上），代价远超本次堵漏目标。
- 不改 `fs_io::save_markdown` 的 md-only 守卫与其文案：方向 A 下它是后端防线（前端 `displayedRevision === undefined` 会提前短路，该文案因此当前不可达——见 Impact 的现状记录）。
- 不改「无扩展名线索回落配置默认」这一边界（本次任务明文保留）：`LICENSE`/`Makefile` 仍按 `editor.mode` 打开；其不可保存由第 3 条的可见反馈兜底，而不是被本次收成只读。
- 不为非 md 文件引入编辑能力，也不做只读文档的另存 / 导出出口。
- 不扩语言覆盖：只裁决两套既有集合的差集归属，不为未收录扩展新接 legacy mode。

## Impact

- 影响的 specs：`editor-live-preview`（MODIFIED 单内核双模式落地、模式配置来源）、`file-tree`（MODIFIED 点击打开文件）、`fs-io`（ADDED 不可保存文档的保存反馈；MODIFIED 崩溃备份与恢复入口）。
- 影响的代码/系统：`src/preview/attachments.ts`（注册表唯一事实源）、`src/tree.ts`、`src/editor.ts`（模式裁决与 `LANGUAGES` 编译期合同）、`src/main.ts`（MIME 消费）、`src/save-controller.ts`（不可保存反馈、备份显式跳过）、`tests/visual/scenes/m130-text-open-trap.spec.ts` 与 `tests/visual/scenes/tauri-stub.ts`。
- 现状记录（不属本 change 的改动面）：`src-tauri/src/fs_io.rs` 的 `fs_read_only`「仅支持保存 Markdown 文件」当前**不可达**——前端在 `displayedRevision === undefined` 处提前短路，`document_save` 收不到非 md 路径；方向 A 下该守卫仍是后端防线，MUST NOT 因「不可达」而删除。
- 关联约束：ADR 0002 §2（单内核双模式）、ADR 0003 §3 铁律（只读态不产生写入路径）、ADR 0002 §5（配置即数据：`editor.mode` 只作无类型线索时的默认）。
