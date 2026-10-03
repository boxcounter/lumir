# Tasks: pane-system-split-view

> 实施分期建议：**分组 1–4 先行**（容器与路由——先有 pane 模型和活跃 pane，全部行为口径
> 才有着落），**分组 5（持久化）随后**（恢复路径依赖容器与移动标签的稳定语义）；分组 6 的
> 键位可与分组 4 并行。单 pane 常态与现状逐像素 / 逐语义不变是第一判据，任何一步破坏它即回退。

## 1. pane 容器与装配（先行）

- [ ] 1.1 pane 容器模块：pane 列表（v1 上限二）、活跃 pane 指针、split / close / moveTab 操作、对外提供「活跃 pane 的 EditorHandle」「遍历全部 pane」；空 pane 合法在场
- [ ] 1.2 内容区泛化为 pane 容器：单 pane 时几何与现状逐像素一致（视觉场景照绿、零基线更新）；双 pane 时标题栏标签区左右分区槽挂载点（槽宽比例随分隔条、与 `pane_split_ratio` 同源）+ 分隔条（hairline token、容器级）
- [ ] 1.3 `createEditor` 第二实例化：`createEditor`（editor.ts:1277）自包含工厂不动，装配层为每 pane 各建一个 `EditorView`；能力注入（折行 / 字号 / 主题 / 栏宽等）收敛为单一「遍历全部 pane」入口（setMode / applyTypography / setContentWidth / reconfigure）
- [ ] 1.4 tabs 改 per-pane：每 pane 自己的会话子列表与标签条（单 pane 挂标题栏标签区、位置与几何逐像素不变；双 pane 挂标题栏左右分区槽，槽宽比例随分隔条、与 `pane_split_ratio` 同源，顶部恒一条横带）；双 pane 时标题栏右簇退让（产品标识块退 modeline、harness 开关钮隐藏，单栏不变）；标签并集 = 该 vault 打开的全部标签

## 2. 单例捕获改造（先行；每模块一条 commit， reviewer 逐模块映射 diff）

- [ ] 2.1 toc：内容源跟随活跃 pane 的 view；浮层打开期间跨 pane 切换即时换源
- [ ] 2.2 save-controller：保存落点改「活跃 pane 的前台标签」；dirty / revision CAS / 崩溃备份 debounce 的逐路径键控不变
- [ ] 2.3 link-follow：链接解析基准改活跃 pane 的前台文档；打开走活跃 pane 会话
- [ ] 2.4 harness-panel 上下文源：`assembleHarnessContext` 的 `HarnessContextSource` 注入改活跃 pane（接口形状不变，harness-context.ts:31）
- [ ] 2.5 content-width 拖柄：双 pane 全局共享 `ui.content_width`（单配置键不动）；施加动作遍历全部 pane 各自 `requestMeasure()`
- [ ] 2.6 notice：提示点名跟随活跃 pane；跨 pane 批量提示维持既有「数量 + 当前 vault」口径
- [ ] 2.7 search：搜索 / 替换作用域改活跃 pane 的 view；面板持焦期间目标不漂移
- [ ] 2.8 goto-line：行号输入条作用于活跃 pane 的 view；跨 pane 切换的失效路径复用「不跨会话跳转」
- [ ] 2.9 fullscreen 族（table / code-block 遮罩）：源元素取自活跃 pane；焦点归还**来源 pane**（遮罩打开后活跃 pane 可能已切换，如实记录该例外）
- [ ] 2.10 `openFile` 落点改活跃 pane 会话列表；`syncActiveDocument` 改为「活跃 pane 的前台标签 ⇄ chrome」唯一同步点

## 3. 命令路由（先行）

- [ ] 3.1 `isEditorEvent`（main.ts:1282）泛化为「目标落在任一编辑器 pane contentDOM 内（含 widget）」；editor 作用域边界不放宽到 chrome 焦点
- [ ] 3.2 命令分发（main.ts:1194 现状的摊平）改为分发时按活跃 pane 解析该 pane 的 `editor.commands`；绑定表结构不变（一个 token 一条绑定、来由、对账）
- [ ] 3.3 装配期对账与单 pane 行为回归：`COMMAND_IDS` / `KEY_BINDINGS` / `KEYLESS_COMMAND_IDS` 校验照过；单 pane 下全部键位行为与 pane 化前逐语义一致（既有单测 / 视觉场景照绿）

## 4. 会话所有权与跨 pane 移动标签（先行）

- [ ] 4.1 移动标签实现：标签带 `EditorState`（撤销史 / 选区）与滚动位置整体迁到目标 pane；`view.setState` 复用，MUST NOT 重建 state / 重新解析 / 制造撤销事件
- [ ] 4.2 触发路径：活跃 pane 内一切「打开」意图（树单击 / 双击 / ⌘-点击、链接跟随、序号直达）命中他 pane 已开文件时执行移动；链接跟随的目标已开时移动并激活、当前标签保留
- [ ] 4.3 `pane.close`（裁决点 2 倾向 A）：收起 pane 时全部标签按序并入另一 pane，不丢标签、不触发关标签确认；`pane.other` 切活跃；空 pane 不自动收起
- [ ] 4.4 `killSlot` 保持全局单例不动；跨 pane kill-yank 验证
- [ ] 4.5 守卫口径跨 pane：切 vault / 退出守卫取全部 pane 全部标签的 dirty 并集；⌘S 只存活跃 pane 前台标签；外部变更处置覆盖全部 pane

## 5. 持久化（随后）

- [ ] 5.1 vault-sessions schema 扩展：`panes: [{tabs, active}]`、`harness_pane`（恒 false）、`pane_split_ratio`；版本号递增；无 `panes` 字段旧文件读取侧按「单 pane = 顶层 tabs/active」解释。`harness_pane` 是 ADR 0008 Decision 6 登记的 Phase 2 契约位（Phase 2 harness 归位 pane 后消费），Phase 1 只随 schema 落盘、无消费者——在此标注消费点，防「声明了却没有消费者」误判（design §10）
- [ ] 5.2 写入纪律复用：tmp + rename、版本不符=无历史、写失败降级 warning、`valid_entry` 路径校验；写入触发点（pane / 标签 / 激活项 / 分隔条变化，防抖 + 切 vault 前与退出前 flush）
- [ ] 5.3 恢复路径：装载后按 pane 布局恢复（第一步当帧建 pane 与标签条、第二步激活项装载 + 首前台装载）；单 pane 存储恢复不出第二 pane；全部条目不可用回落单 pane 空态
- [ ] 5.4 分隔条拖拽：实时重排，松手位置写入会话文件（per-vault，MUST NOT 复用 `ui.content_width` 全局键）；拖拽 MUST NOT 改文档 / 进撤销栈 / 改 dirty

## 6. 键位与文案

- [ ] 6.1 pane 命令族进 `KEY_BINDINGS` / `GLOBAL_COMMAND_IDS`：`pane.split` / `pane.close` / `pane.other`，默认键位按节点 1 落槌（起草倾向 ⌥S / ⌥W / ⌥O）；三线来源（表内 / 原生菜单 accelerator / 系统级）零冲突核对写入绑定 `doc`
- [ ] 6.2 新增文案进 copy-data（D 编号、zh/en 双档）+ `onRelabel` 注册（空 pane 引导、分隔条读屏名、双 pane 右簇退让（harness 开关钮隐藏 / 产品标识块退 modeline）相关读屏名等）；样式只消费既有 token
- [ ] 6.3 `app.describe-bindings` 面板自动列出三条新命令（不新增分组或按既有分组落位）

## 7. 验证

- [ ] 7.1 **新增 / 更新真机验收场景**（scripts/acceptance，随本 change 同 PR）：分栏出现双 pane、`pane.other` 往返、跨 pane 移动标签（撤销史 / 滚动保留）、活跃 pane 路由（B 输入 → modeline / 树高亮跟随 B）、布局按 vault 往返恢复、`pane.close` 标签并入、双 pane 下 ⌘S 只存活跃 pane 前台；并核对既有场景的 AX 锚点（原假设唯一 contentDOM / 唯一标签条）不受影响
- [ ] 7.2 视觉门禁本地全跑（`scripts/gate.sh visual`）：单 pane 基线逐像素零 diff；新增双 pane 表面整页基线按「基线更新是人肉裁决点」走 Alex 过目后 `--update`；按卫生纪律核对受影响基线时间戳
- [ ] 7.3 **双 pane 常驻内存实测并登记读数**（单 pane 基线 vs 双 pane 常驻，证据落 `test-results/` 并在完成报告引用绝对路径）；**门禁提阈提案**随 PR 提交（Alex 已裁决 2026-10-03：按实测提高门禁、专项治理后置）——门禁数字改动本身走 Alex 过目，不静默改
- [ ] 7.4 跨实例全局态验证并如实登记：双 pane 下 mermaid 渲染（同文档 / 异文档）、`lists.ts` document 级观察器行为
- [ ] 7.5 `scripts/gate.sh quick` 全绿（含 bindings-drift；schema 扩展若动 Rust 导出面，先 `git add` 重导出产物再跑）
- [ ] 7.6 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
