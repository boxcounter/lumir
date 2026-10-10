# Tasks: startup-window-pane-defaults

> 本 change 的提案阶段制品（proposal / design / tasks / spec delta）由 M427 起草，并按裁决点 1 的裁决（2026-10-10，只记尺寸）修订；
> 下列实现任务在**节点 1 提案评审通过后**执行。派工时按「有机器验收」分档：
> §1（窗口尺寸）有单测 + 真机验收场景兜底；§2（pane 默认值）有视觉与验收场景兜底。
>
> **实现进度（M434，2026-10-10）**：§1 与 §2（除 2.6）已实现，4.1–4.3 已验。
> **3.1 / 3.2 / 4.4 顺延到后续 mission**——`scripts/acceptance/**` 不在本次实现 mission 的
> 改动面内（与并行 mission M433 的 scope 冲突，tower 裁决 2026-10-10）。
> 4.5 属归档评审节点（`openspec archive` 之后），不在实现期。

## 1. 窗口尺寸：首启规则与持久化（spec：`app-window`）

- [x] 1.1 新模块 `src-tauri/src/window_state.rs`：存档类型（`version` / 逻辑像素 `width` / `height`——**无位置字段**）+ 读写（配置目录 `window-state.json`，tmp + rename）+ 六类读取降级（缺失 / 不可读 / 非 JSON / 版本不符 / 字段缺失 / 类型非法）与读侧 warning 口径，照 `reading_position.rs` 的既有纪律
- [x] 1.2 尺寸纯函数（零窗口 API、可注入工作区矩形）：首启尺寸算式（90% 四舍五入取整）、逻辑↔物理换算、工作区钳制（存档尺寸大于工作区 / 小于工作区两态）
- [x] 1.3 `src-tauri/src/lib.rs` 接线：`setup` 内施加启动尺寸（读档 → 存档尺寸钳进工作区 / 首启 90% → `set_size`）后 `window.show()`；**不调 `set_position`**（位置交给 OS 默认放置）；尺寸施加内部降级不返回致命错误，`show()` 保证执行（design §3.3）
- [x] 1.4 `src-tauri/tauri.conf.json`：加 `"visible": false`；`width`/`height` 保留为占位尺寸（加注释说明其新语义）
      —— 落脚偏差：`tauri.conf.json` 是严格 JSON（无注释语法），占位尺寸的新语义写在 `src-tauri/src/lib.rs` 的 `apply_startup_size` 文档里，配置文件里只有 `"visible": false` 这一处改动
- [x] 1.5 写侧：`WindowEvent::Resized` → 更新内存尺寸缓存 + 防抖落盘（建议 500ms）；**不监听 `Moved`**（位置不入档）；`RunEvent::Exit` 臂追加 flush（macOS Cmd+Q 经 `applicationWillTerminate` 到达，design §1 证据链）
- [x] 1.6 单测（`window_state.rs` 内嵌）：首启尺寸算式（含取整）、六类降级、版本不符、工作区钳制两态、逻辑↔物理往返；全部注入目录与矩形，**不碰真实配置目录与真实屏幕**

## 2. pane 默认比例 1:2 → 1:1（spec：`pane-layout` + 四处复述）

- [x] 2.1 `src/main.ts:683` 的 `HARNESS_DEFAULT_DOC_RATIO`：`2 / 3` → `1 / 2`
- [x] 2.2 `src/main.ts:681`、`:773`、`:2759` 三处注释改准为 1:1，并附来由（原 1:2 系 2026-10-05 裁决、本 change 按 2026-10-10 裁决改为 1:1）
- [x] 2.3 确认 `src/main.ts:782` 的施加判据与 `storedRatioApplied` 生命周期**零改动**（默认只在无存储值时生效；`pane-layout.ts:57` 与 `vault_session.rs:47` 的 `DEFAULT_SPLIT_RATIO = 0.5` 亦不动）
- [x] 2.4 文案表 D345 正文改准「harness:文档 = 1:1」：同步 `文案-Copy.md` 与 `src/copy-data.ts:785-786`（zh/en 双档），跑既有 copy drift 测试
- [x] 2.5 视觉场景注释与断言改 1:1：`tests/visual/scenes/m303-harness-panel.spec.ts:8,95`（注释 + 宽度比断言，现「约两倍」）、`tests/visual/scenes/m345-quote-card.spec.ts:103`（注释）；涉及整页 / 元素基线更新时按「基线更新是人肉裁决点」截图交 Alex 过目后再提交
- [ ] 2.6 验收场景 `scripts/acceptance/scenarios/86-harness-pane-toggle.md` 改 1:1：`:4`（frontmatter `title`「自动分栏默认 1:2」）、`:49`（判据「文档侧 2/3」）、`:100-101`（注释「默认宽度比 1:2」）
      —— **顺延**（验收场景归后续 mission；tower 裁决 2026-10-10：`scripts/acceptance/**` 归 M433）
- [x] 2.7 流程文档 `docs/process/openspec-workflow.md:46`（「视觉保真」一节的布局节奏示例「如 pane 1:2」）改 1:1——**该处描述的是当前行为，故不在提案期改**，随实现一并改准（r1 评审 finding）

## 3. 真机验收场景（`scripts/acceptance/`）

- [ ] 3.1 新增窗口尺寸场景：① 清空存档 → 启动 → 窗口约为工作区 90%（位置不作断言）；② 调整尺寸 → 退出 → 再启动 → 首帧尺寸与退出前一致（位置不作断言）；③ 存档写成非法 JSON → 启动 → 按 90% 规则出现且不报错；④ 存档尺寸大于当前工作区 → 启动后窗口被钳到工作区尺寸。判据取**相对值**（≈ 工作区 ×0.9 ± 容差），不写绝对像素；另断言 `window-state.json` 只含 `version` / `width` / `height`（无位置字段）
      —— **顺延**（验收场景归后续 mission；tower 裁决 2026-10-10：`scripts/acceptance/**` 归 M433）
- [ ] 3.2 场景 86 补一条「无存储比例时自动分栏为 1:1」的断言（与既有「存储比例优先」断言并存，覆盖裁决点 ② 的两面）
      —— **顺延**（同上）

## 4. 验证

- [x] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 4.2 `scripts/gate.sh quick` 全绿（含 `openspec-validate`、Rust 测试、copy drift、session-schema-drift）
- [x] 4.3 动了视觉相关面（`tests/visual/scenes/**`）后本地跑 `scripts/gate.sh visual`；整页 / 元素基线的任何更新逐张交 Alex 过目
- [ ] 4.4 真机验收套件全绿（`node scripts/acceptance/run.mjs`，含 §3 新增场景与场景 86 的补充断言），证据落 `test-results/acceptance/`
      —— **顺延**（同上：真机场景本体归 M433）
- [ ] 4.5 归档前对账：`app-window` 的占位 Purpose 手写替换为「这个 capability 是干什么的」后复跑 validate（新建 capability 的既有归档纪律）
      —— 归档评审节点（节点 2）执行，不在实现期
