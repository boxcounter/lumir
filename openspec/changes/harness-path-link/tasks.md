# Tasks: harness-path-link

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；实现期发现 proposal
> 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/harness/spec.md` / 本文件
- [x] 0.2 Alex 节点 1 评审通过（硬门禁；2026-10-17 批准，六个起草期取值全部按提案倾向通过）

## 1. 候选识别与文件索引（纯函数层）

- [x] 1.1 新增 `src/harness-path-link.ts`：候选提取（允许中文、`/` 或 `.` 必需、`:行号` / `:行号:列号`
      后缀、两端中文与句末点号收缩、绝对路径与 `..` / 空段拒绝、run 长度上限）
- [x] 1.2 同文件：vault 文件索引的判定口径（`kind === "file" && !lazy`，并过 `openKind !== "binary"`
      过滤）；装配层把既有文件路径表改名为 `vaultFilePaths` 并下发，增量复用 `patchAttachmentPaths`
      的增删政策，不新造第二套集合语义
- [x] 1.3 同文件：工具参数 → 路径目标（Read / Create / Patch / Delete / Move / diff 头；Read 的
      `offset` 作落点行；`vault_list` 不产目标；严格 JSON 解析失败不产目标）
- [x] 1.4 单测（`tests/unit/harness-path-link.test.ts`）：中文行文斜杠不产候选；`见路径` / `路径的`
      两端紧邻中文可收缩命中；行号后缀与畸形后缀；绝对路径 / `..` 拒绝；索引的 kind / lazy / 增删；
      工具目标六态（含截断 JSON、Move 两段、Read 行范围）。**先造必须红的输入**再实现，红证据落盘

## 2. 正文渲染接线

- [x] 2.1 `src/harness-panel.ts`：渲染上下文参数透传（doc + 文件索引判定 + 打开回调），
      `renderInlineChildren` / `renderInlineNode` 的文本间隙与行内代码走链接化；围栏 / 缩进代码块、
      锚内文本、URL 节点不链接化
- [x] 2.2 可点元素：`<button type="button">`、可聚焦、Enter 触发、点击只走面板注入的打开回调
      （不产 `href`、不走 webview 默认导航）；样式落 `src/harness-panel.css`（复用既有链接色值与
      下划线，不新增 token / 色值 / 字号）
- [x] 2.3 面板依赖：装配层下发 vault 文件路径集（装载时与 watch 增量两个同步点）、注入
      `openVaultPath(path, line?)`；`vaultChanged` 带上文件集。**索引只有一份**：不为本功能另建
      第二条文件集合
- [x] 2.4 渲染单测（`tests/unit/harness-transcript-render.test.ts` 扩展或以同手法新建）：命中项
      文本不变且产可点元素；未命中仍是文本节点；行内代码在列；围栏代码 / 锚内在列性反向；同段多路径
      按序；流式尾块重渲稳定

## 3. 行号锚定与 CL-2

- [x] 3.1 `src/main.ts`：`openVaultPath` 走唯一链路 `openFile(path, openKind(path), "new")`；成功且
      带行号时调 `editor.revealLine(line)`
- [x] 3.2 跳转编排抽成可注入依赖的纯函数（`src/harness-path-link.ts`）：打开 → 窗口包裹 reveal →
      下一帧复核选区未变时至多补发一次（补发单独开窗）；单测断言顺序、两轮窗口包裹、选区变更不补发
- [x] 3.3 `src/editor.ts` 的 `revealLineAt` 与 `src/toc.ts` 的 `jumpTo` 对齐捕获语义：dispatch 包进
      `duringViewportTransition`（TOC 落点算式不变）；注释写明依据与 CL-2
- [x] 3.4 CL-2 单测：断言跳转编排的 reveal 发生在转场窗口内（两轮各自开窗），窗口前已排期的位置
      不被丢弃；「窗口内中间态不落盘」的机制由既有 reading-position / viewport-transition 用例守
      （同一开窗器，本 change 不复制第二套窗口语义）

## 4. 工具卡片路径

- [x] 4.1 `src/harness-panel.ts`：`keyArgOf` 与路径目标共用同一张「工具 → 路径字段」表；`createToolText`
      按目标把展示文本切成可点段（展示文本不新增分隔符，Move 两段各自可点）
- [x] 4.2 live 行、批准卡（diff 头）、恢复行三处同口径接线；解析失败 / 截断摘要 / `vault_list` 不产
      可点元素
- [x] 4.3 单测覆盖 4.1–4.2 的产物形态：`splitToolText` 的切分（含 Move 两段 / 同路径两次 / 无目标
      / 目标找不到）由纯函数用例钉死；DOM 接线（可点元素数、点击落点）由真机场景 161 的
      `AXButton` 判据覆盖；既有视觉场景 m351 的 `.lumir-hp-tool-args` 文本断言逐字不变

## 5. 打开语义与安全

- [x] 5.1 新标签意图 + 单标签不变量（已打开文件切到既有标签，不重复开）；不创建文件；目录 / vault 外
      绝对路径 / `..` 不链接化
- [x] 5.2 失败表现沿用既有打开链路（索引过期时由它提示）；不新增面板文案、不静默吞错
- [x] 5.3 边界复核：面板不拼绝对路径、不自行放宽边界；`openFile` → Rust `resolve_in_vault` 的权威
      校验未被绕过（代码走查 + 单测覆盖候选侧拒绝）

## 6. 路径引用纪律（依赖 `harness-prompt-files` 合并）

- [ ] 6.1 rebase 到含 `src-tauri/src/harness/prompts/` 布局的分支后，新增
      `src-tauri/src/harness/prompts/path-reference.md`（完整相对路径 + 扩展名、`:行号`、只引用真实
      出现过的路径、不用 Markdown 链接语法、目录说清是目录）
- [ ] 6.2 `src-tauri/src/harness/context.rs`：以固定段装配（与 `QUOTE_REFERENCE` 同构），
      `AssemblySource` 记 `path_reference` 条目；Rust 单测断言注入文本与清单条目
- [ ] 6.3 抽样观察记录：真实 provider 若干轮的路径写法抽样，结论写入完成报告（如实标注未覆盖，不进
      机器判据）

## 7. 真机验收场景

- [x] 7.1 新增 `scripts/acceptance/scenarios/161-harness-path-link.md` + mock fixture（全合成：中文
      文件名、目标文件含可判读的标记行、目录、不存在的路径、一条 Read 工具调用）
- [x] 7.2 断言：中文路径 + `:行号` 点击 → 新标签打开、目标行文本出现；不存在的路径 / 目录不产可点
      元素（`ax: not` 反向验证）；工具卡片路径点击 → 新标签；截图留存行落点现场
- [x] 7.3 回扫既有验收场景：grep 所有 fixture / 场景期望里会被本次链接化改变的文本（含 harness
      fixture 里的 vault 内路径串），逐条确认 AX 文本期望不变或改准；`node scripts/acceptance/run.mjs
      --check` 通过
- [x] 7.4 如实登记覆盖边界：行落点的**位置**证据靠截图人工判读（套件无 `scrollTop` 读数，与 CL-1 /
      CL-2 的已知边界同源），不包装成机器断言

## 8. 验证

- [ ] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 8.2 `bash scripts/gate.sh quick` 全绿（读数照抄 `GATE RESULT` 原文行 + 退出码）
- [ ] 8.3 `bash scripts/gate.sh visual`（动过 `src/harness-panel.css`）：读数照抄 `GATE RESULT` 原文行
      + 退出码；本项目 scope 不含 `tests/visual`，不新增视觉场景；若既有基线因样式改动变红，基线更新
      须先经 Alex 过目（人肉裁决点）
- [ ] 8.4 `node scripts/acceptance/run.mjs 161` 真机跑通，证据落 `test-results/acceptance/<日期>/`；
      环境不满足导致 INVALID 时如实登记并复跑，不把无效运行写成 PASS
- [ ] 8.5 信息卫生清扫：新增 fixture / 场景 / 文档对改动面做一次 text 级 grep，真实 vault 内容、
      真实路径、真实人名零命中（合成文件名与合成路径）
