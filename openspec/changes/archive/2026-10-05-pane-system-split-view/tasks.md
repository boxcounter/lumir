# Tasks: pane-system-split-view

> 实施分期建议：**分组 1–4 先行**（容器与路由——先有 pane 模型和活跃 pane，全部行为口径
> 才有着落），**分组 5（持久化）随后**（恢复路径依赖容器与移动标签的稳定语义）；分组 6 的
> 键位可与分组 4 并行。单 pane 常态与现状逐像素 / 逐语义不变是第一判据，任何一步破坏它即回退。

> 归档记录（2026-10-05，M326）：分组 1–7 全部勾选。实施批 M315–M322 与预存验收失败修复批
> M323–M325 全合并；全量真机验收 **82/82 PASS 零扣除**（`test-results/acceptance/2026-10-04/summary.md`）；
> 归档评审（节点 2）已由 Alex 点头通过。任务原文逐字保留，证据按实现批次附注。
> 注：**§2 单例改造跨 M316（装配批）与 M317（路由 / 所有权批）两个 mission**，逐项按模块归属标注。

## 1. pane 容器与装配（先行）

- [x] 1.1 pane 容器模块：pane 列表（v1 上限二）、活跃 pane 指针、split / close / moveTab 操作、对外提供「活跃 pane 的 EditorHandle」「遍历全部 pane」；空 pane 合法在场
  （证据：M315，merge `9509346`，交付纯逻辑模块 `src/pane-layout.ts` + 单测 `tests/unit/pane-layout.test.ts`）
- [x] 1.2 内容区泛化为 pane 容器：单 pane 时几何与现状逐像素一致（视觉场景照绿、零基线更新）；双 pane 时标题栏标签区左右分区槽挂载点（槽宽比例随分隔条、与 `pane_split_ratio` 同源）+ 分隔条（hairline token、容器级）
  （证据：M316，merge `97acf2f`——`src/shell.ts` / `src/style.css` / `src/main.ts` 泛化内容区、标题栏左右分区槽与容器级分隔条）
- [x] 1.3 `createEditor` 第二实例化：`createEditor`（editor.ts:1277）自包含工厂不动，装配层为每 pane 各建一个 `EditorView`；能力注入（折行 / 字号 / 主题 / 栏宽等）收敛为单一「遍历全部 pane」入口（setMode / applyTypography / setContentWidth / reconfigure）
  （证据：M316，merge `97acf2f`——装配层 per-pane `EditorView`，能力注入遍历入口见 `src/main.ts:206` / `:220` / `:238`）
- [x] 1.4 tabs 改 per-pane：每 pane 自己的会话子列表与标签条（单 pane 挂标题栏标签区、位置与几何逐像素不变；双 pane 挂标题栏左右分区槽，槽宽比例随分隔条、与 `pane_split_ratio` 同源，顶部恒一条横带）；双 pane 时标题栏右簇退让（产品标识块退 modeline、harness 开关钮隐藏，单栏不变）；标签并集 = 该 vault 打开的全部标签
  （证据：M316，merge `97acf2f`——`src/tabs.ts` per-pane 标签条 + `src/modeline.ts` 右簇退让）

## 2. 单例捕获改造（先行；每模块一条 commit， reviewer 逐模块映射 diff）

- [x] 2.1 toc：内容源跟随活跃 pane 的 view；浮层打开期间跨 pane 切换即时换源
  （证据：M317，merge `156727c`——`src/toc.ts` 改注入活跃 pane 的 view）
- [x] 2.2 save-controller：保存落点改「活跃 pane 的前台标签」；dirty / revision CAS / 崩溃备份 debounce 的逐路径键控不变
  （证据：M317，merge `156727c`——`src/save-controller.ts` 落点改活跃 pane 前台标签）
- [x] 2.3 link-follow：链接解析基准改活跃 pane 的前台文档；打开走活跃 pane 会话
  （证据：M317，merge `156727c`——`src/link-follow.ts` 基准改活跃 pane 前台文档）
- [x] 2.4 harness-panel 上下文源：`assembleHarnessContext` 的 `HarnessContextSource` 注入改活跃 pane（接口形状不变，harness-context.ts:31）
  （证据：M316，merge `97acf2f`——`src/harness-panel.ts` 上下文源改活跃 pane，接口形状不变）
- [x] 2.5 content-width 拖柄：双 pane 全局共享 `ui.content_width`（单配置键不动）；施加动作遍历全部 pane 各自 `requestMeasure()`
  （证据：M316，merge `97acf2f`——`src/shell.ts` / `src/style.css` 拖柄施加遍历全部 pane）
- [x] 2.6 notice：提示点名跟随活跃 pane；跨 pane 批量提示维持既有「数量 + 当前 vault」口径
  （证据：M316，merge `97acf2f`——`src/main.ts` 提示点名跟随活跃 pane）
- [x] 2.7 search：搜索 / 替换作用域改活跃 pane 的 view；面板持焦期间目标不漂移
  （证据：M316/M317 批次，merge `97acf2f` / `156727c`——`src/editor.ts` 搜索作用域按活跃 pane 解析）
- [x] 2.8 goto-line：行号输入条作用于活跃 pane 的 view；跨 pane 切换的失效路径复用「不跨会话跳转」
  （证据：M316/M317 批次，merge `97acf2f` / `156727c`——`src/editor.ts` goto-line 作用于活跃 pane view）
- [x] 2.9 fullscreen 族（table / code-block 遮罩）：源元素取自活跃 pane；焦点归还**来源 pane**（遮罩打开后活跃 pane 可能已切换，如实记录该例外）
  （证据：M316/M317 批次，merge `97acf2f` / `156727c`——`src/editor.ts` 遮罩源元素与焦点归还按来源 pane）
- [x] 2.10 `openFile` 落点改活跃 pane 会话列表；`syncActiveDocument` 改为「活跃 pane 的前台标签 ⇄ chrome」唯一同步点
  （证据：M317，merge `156727c`——`src/main.ts` openFile 落点与 syncActiveDocument 唯一同步点）

## 3. 命令路由（先行）

- [x] 3.1 `isEditorEvent`（main.ts:1282）泛化为「目标落在任一编辑器 pane contentDOM 内（含 widget）」；editor 作用域边界不放宽到 chrome 焦点
  （证据：M316/M317，merge `97acf2f` / `156727c`——`src/main.ts:2035` 起 `isEditorEvent` 遍历 `paneLayout.panes()` 的 contentDOM）
- [x] 3.2 命令分发（main.ts:1194 现状的摊平）改为分发时按活跃 pane 解析该 pane 的 `editor.commands`；绑定表结构不变（一个 token 一条绑定、来由、对账）
  （证据：M317，merge `156727c`——`src/main.ts` 命令分发按活跃 pane 解析 `editor.commands`；绑定表结构不变）
- [x] 3.3 装配期对账与单 pane 行为回归：`COMMAND_IDS` / `KEY_BINDINGS` / `KEYLESS_COMMAND_IDS` 校验照过；单 pane 下全部键位行为与 pane 化前逐语义一致（既有单测 / 视觉场景照绿）
  （证据：M316/M317，merge `97acf2f` / `156727c`——`tests/unit/keys.test.ts` 表不变量全绿，视觉场景单 pane 零基线更新）

## 4. 会话所有权与跨 pane 移动标签（先行）

- [x] 4.1 移动标签实现：标签带 `EditorState`（撤销史 / 选区）与滚动位置整体迁到目标 pane；`view.setState` 复用，MUST NOT 重建 state / 重新解析 / 制造撤销事件
  （证据：M317，merge `156727c`——`src/pane-layout.ts` moveTab 复用 `view.setState`，移动不制造撤销事件）
- [x] 4.2 触发路径：活跃 pane 内一切「打开」意图（树单击 / 双击 / ⌘-点击、链接跟随、序号直达）命中他 pane 已开文件时执行移动；链接跟随的目标已开时移动并激活、当前标签保留
  （证据：M317，merge `156727c`——`src/main.ts` / `src/link-follow.ts` 打开意图命中他 pane 已开文件即移动）
- [x] 4.3 `pane.close`（裁决点 2 倾向 A）：收起 pane 时全部标签按序并入另一 pane，不丢标签、不触发关标签确认；`pane.other` 切活跃；空 pane 不自动收起
  （证据：M316（`src/main.ts` `closeActivePane` / `activateOtherPane`）+ M317，merge `97acf2f` / `156727c`；空 pane 保持在场）
- [x] 4.4 `killSlot` 保持全局单例不动；跨 pane kill-yank 验证
  （证据：M317，merge `156727c`——`killSlot` 维持模块级单例；跨 pane kill-yank 由真机场景 79 断言）
- [x] 4.5 守卫口径跨 pane：切 vault / 退出守卫取全部 pane 全部标签的 dirty 并集；⌘S 只存活跃 pane 前台标签；外部变更处置覆盖全部 pane
  （证据：M317，merge `156727c`——`src/main.ts` 守卫取 `paneLayout.panes()` 各标签 dirty 并集，单测 `tests/unit/pane-state-migration.test.ts`）

## 5. 持久化（随后）

- [x] 5.1 vault-sessions schema 扩展：`panes: [{tabs, active}]`、`harness_pane`（恒 false）、`pane_split_ratio`；版本号递增；无 `panes` 字段旧文件读取侧按「单 pane = 顶层 tabs/active」解释。`harness_pane` 是 ADR 0008 Decision 6 登记的 Phase 2 契约位（Phase 2 harness 归位 pane 后消费），Phase 1 只随 schema 落盘、无消费者——在此标注消费点，防「声明了却没有消费者」误判（design §10）
  （证据：M318，merge `fc6f489`——`src-tauri/src/vault_registry.rs` schema 扩展 `panes` / `harness_pane` / `pane_split_ratio`，读取侧兼容无 `panes` 旧文件）
- [x] 5.2 写入纪律复用：tmp + rename、版本不符=无历史、写失败降级 warning、`valid_entry` 路径校验；写入触发点（pane / 标签 / 激活项 / 分隔条变化，防抖 + 切 vault 前与退出前 flush）
  （证据：M318，merge `fc6f489`——写入沿用 tmp+rename、版本不符=无历史、写失败降级、`valid_entry` 校验）
- [x] 5.3 恢复路径：装载后按 pane 布局恢复（第一步当帧建 pane 与标签条、第二步激活项装载 + 首前台装载）；单 pane 存储恢复不出第二 pane；全部条目不可用回落单 pane 空态
  （证据：M318（merge `fc6f489`）两步恢复；M321（merge `9e7b320`，`992f7b4`）修复双 pane 恢复后标签归位原 pane，验收场景 `80-pane-session-restore.md`）
- [x] 5.4 分隔条拖拽：实时重排，松手位置写入会话文件（per-vault，MUST NOT 复用 `ui.content_width` 全局键）；拖拽 MUST NOT 改文档 / 进撤销栈 / 改 dirty
  （证据：M318，merge `fc6f489`——分隔条松手写 per-vault 会话文件 `pane_split_ratio`，独立于全局 `ui.content_width`）

## 6. 键位与文案

- [x] 6.1 pane 命令族进 `KEY_BINDINGS` / `GLOBAL_COMMAND_IDS`：`pane.split` / `pane.close` / `pane.other`，默认键位按节点 1 落槌（起草倾向 ⌥S / ⌥W / ⌥O）；三线来源（表内 / 原生菜单 accelerator / 系统级）零冲突核对写入绑定 `doc`
  （证据：M319，merge `fb34abf`——`src/keys.ts:608-610` 注册 `Alt-KeyS`→`pane.split` / `Alt-KeyO`→`pane.other` / `Alt-KeyW`→`pane.close`，docKey D365–D367）
- [x] 6.2 新增文案进 copy-data（D 编号、zh/en 双档）+ `onRelabel` 注册（空 pane 引导、分隔条读屏名、双 pane 右簇退让（harness 开关钮隐藏 / 产品标识块退 modeline）相关读屏名等）；样式只消费既有 token
  （证据：M319，merge `fb34abf`——`src/copy-data.ts` 新增 D365–D367 及 pane 相关文案 zh/en 双档 + `onRelabel` 注册）
- [x] 6.3 `app.describe-bindings` 面板自动列出三条新命令（不新增分组或按既有分组落位）
  （证据：M319，merge `fb34abf`——三条命令随既有分组进 `app.describe-bindings` 面板）

## 7. 验证

- [x] 7.1 **新增 / 更新真机验收场景**（scripts/acceptance，随本 change 同 PR）：分栏出现双 pane、`pane.other` 往返、跨 pane 移动标签（撤销史 / 滚动保留）、活跃 pane 路由（B 输入 → modeline / 树高亮跟随 B）、布局按 vault 往返恢复、`pane.close` 标签并入、双 pane 下 ⌘S 只存活跃 pane 前台；并核对既有场景的 AX 锚点（原假设唯一 contentDOM / 唯一标签条）不受影响
  （证据：新增 `scripts/acceptance/scenarios/79-pane-split.md`（M319 7.1，commit `6c46c61`）与 `80-pane-session-restore.md`（M321，commit `992f7b4`）；全量真机验收 **82/82 PASS 零扣除**——`test-results/acceptance/2026-10-04/summary.md`）
- [x] 7.2 视觉门禁本地全跑（`scripts/gate.sh visual`）：单 pane 基线逐像素零 diff；新增双 pane 表面整页基线按「基线更新是人肉裁决点」走 Alex 过目后 `--update`；按卫生纪律核对受影响基线时间戳
  （证据：M320，merge `4342c11`——新增 4 张双 pane 整页基线 `tests/visual/baselines/m320-pane-split.spec.ts-snapshots/` 下 pane-split-two-docs / pane-split-empty-right / pane-split-titlebar-two-docs / pane-split-titlebar-empty-right，**2026-10-04 经 Alex 过目批准**后 `--update`；单 pane 既有基线零改动（本轮只新增，未改既有）；空 pane 引导基线 `pane-split-empty-right` 随 M322 更新，**Alex 豁免过目**（merge `5cadbe2`））
- [x] 7.3 **双 pane 常驻内存实测并登记读数**（单 pane 基线 vs 双 pane 常驻，证据落 `test-results/` 并在完成报告引用绝对路径）；**门禁提阈提案**随 PR 提交（Alex 已裁决 2026-10-03：按实测提高门禁、专项治理后置）——门禁数字改动本身走 Alex 过目，不静默改
  （证据：`test-results/m320-memory/README.md` + `round1–3/resident-memory-pane{0,1,2}.json`；本地 max 读数 pane0 276.38 / pane1 283.75 / pane2 常驻 293.86 MB，合成估计 CI 双 pane ≈226–232MB < 250MB 门禁；提阈提案（A：阈值不动 / B：新增 pane2 指标）随 M320 提交，**Alex 2026-10-04 裁决采 A**——阈值 250 不动、不新增 CI 指标）
- [x] 7.4 跨实例全局态验证并如实登记：双 pane 下 mermaid 渲染（同文档 / 异文档）、`lists.ts` document 级观察器行为
  （证据：M320，merge `4342c11`——新增视觉场景 `tests/visual/scenes/m320-pane-globalstate.spec.ts` 钉双 pane 下 mermaid 与 `lists.ts` document 级观察器行为）
- [x] 7.5 `scripts/gate.sh quick` 全绿（含 bindings-drift；schema 扩展若动 Rust 导出面，先 `git add` 重导出产物再跑）
  （证据：主仓 `bash scripts/gate.sh quick` **GATE RESULT 10/10 PASS**——M320 收官批次全绿，本 mission 归档前复跑同绿）
- [x] 7.6 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
  （证据：`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 全绿——本 mission 落 specs 后复跑，见完成报告读数）
