# Tasks: live-theme-switch

实现前提：提案节点 1 裁决通过（D1 命令形态 / D2 默认键位 / D3 配置写回——若裁决改备选，
先按备选改写本清单与 specs delta 再动工）。

## 1. 前端切换机制

- [x] 1.1 `src/main.ts`：新增 `applyTheme(theme)` 单一施加点（写 `documentElement.dataset.theme`
  + 刷新 modeline 主题指示文案）；启动装配（现 `main.ts:980`）改为经它施加，同步改写
  `main.ts:969-979` 的「运行期不切换」注释
- [x] 1.2 `src/preview/mermaid.ts`：新增 `invalidateMermaidTheme()` 出口——`initialized` 复位 +
  `renderCache` 清空 + 世代号自增；世代号检查守在缓存唯一写入点（`ensureMermaidRender` 的
  settle 回调，`mermaid.ts:244-246`）：任务入队时记世代号、写缓存前比对，不一致丢弃（不写
  缓存、不通知、不重排队——重渲由 previewRefresh 重建路径承担，防止同一 source 排两遍）；
  未懒加载时幂等 no-op；同步改写文件头 :12-16 的自述
- [x] 1.3 `src/main.ts`：切换命令实现——读当前主题、循环取下一档（light→dark→eink）、
  `applyTheme` + `invalidateMermaidTheme()` + dispatch `previewRefresh` + 触发配置写回（§3）
- [x] 1.4 `src/shell.ts` + `src/main.ts`：modeline 右段主题指示钮（button，文案 = 当前主题名，
  点击走与命令同一实现路径）；样式吃 token（eink chip 描边化），零新色值
  （实现落点：`src/style.css` 的 `.modeline-theme`——样式居所是 style.css，M237 的 scope
  已按裁决补入该文件）

## 2. 键位与命令

- [x] 2.1 `src/keys.ts`：`view.theme-cycle` 进 `NON_TAB_GLOBAL_COMMAND_IDS`；默认绑定
  `Cmd-Shift-T`（scope global），doc 按三来源格式写冲突核实（表内 / muda 预置 accelerator /
  macOS 系统级）；`KEYLESS_COMMAND_IDS` 不变
- [x] 2.2 键位面板（`app.describe-bindings`）如实列出该命令与绑定；`[keys]` 重绑 / 解绑生效
  （既有机制，补一条单测钉住该命令在覆盖通路里可走）

## 3. 配置写回

- [x] 3.1 **（本 mission 修正过时项）不新增 `config_set_ui_theme` Rust 命令**——直接复用
  M228（change content-width-drag）已落地的**通用合并写 IPC** `config_set_ui_value`
  （`src-tauri/src/commands.rs:449-483`：serde_json::Value 级合并、保留未知键、tmp+rename
  原子写、失败 `CommandError`）。原稿「照 `write_last_vault_to` 模板新增命令」是 M228 之前的
  口径；同一条语义不留两套写通道（REVIEW.md 第 8 条）。ACL / invoke handler 清单因此**无需
  改动**（沿用 `config_set_ui_value` 既有的那条）。
- [x] 3.2 Rust 单测：写回产物必须是**下次启动读得回**的那一份——`write_ui_value_to` 写
  `theme` 后，`config::load` 从同一路径读回 `UiTheme::Dark`，且同表其它字段（`content_width`）
  与未知字段逐键保留（`src-tauri/src/commands.rs` 的单测）。
  **取值校验的分层（原稿「非法取值拒绝」的口径修正）**：通用通道按设计**不校验**取值
  （它是 `[ui]` 的通用键值写入口），闭集合由前端 `UiTheme` 类型 + Rust 侧 `validate()` 的
  「非法值 warning + 回落 light」两层承担——前端只会送出三档之一，写盘产物即使被外部改坏，
  下次启动照样按既有口径回落；写失败路径的形态由既有 `write_ui_value_to_reports_write_failure`
  覆盖（只读目录 / 空键）。
- [x] 3.3 前端写回调用：不等结果；失败 → `logEvent`（复用既有 `config_warning`，`source: "theme"`）
  + toast「主题已切换，但写入配置失败，重启后将回到配置文件里的主题（{原因}）」（文案 D123）
- [x] 3.4 `src-tauri/src/config.rs` 的 `UiConfig` doc comment 去掉「重启生效」自述，ts-rs 重新
  导出（`src/bindings/UiConfig.ts` 随构建刷新）

## 4. 验证

- [x] 4.1 单元测试：主题循环顺序（`tests/unit/theme.test.ts`）、mermaid 世代号丢弃迟到结果
  （含 in-flight 竞态用例、`invalidateMermaidTheme` 幂等、失效后重新 initialize）、键位三表
  对账与 `[keys]` 覆盖通路（`tests/unit/keys.test.ts`）。
  **落点修正**：mermaid 的四条用例进 `tests/visual/scenes/mermaid.spec.ts` 的 Node 侧段
  ——`src/preview/mermaid.ts` 用了 TS 参数属性，Node 的类型剥离（strip-only）拒绝该语法，
  tests/unit 层无法 import 它（tests/unit/tsconfig.json 的注释记着同一条约束）。
- [x] 4.2 视觉场景（`tests/visual/scenes/theme-live-switch.spec.ts`，8 条）：桩注入启动主题 →
  经 ⌘⇧T 与点击 modeline 钮切换 → 结构层断言 `data-theme` 变化、代表性表面的计算样式跟随
  （表面 = 探针读出的当前 token 计算值）、eink 组件级覆盖命中与失效、mermaid 块回落 pending
  占位后按新主题 settle（SVG 内联色跟到新 token，用 MutationObserver 记状态序列）、
  每次切换一次 `config_set_ui_value`；**不新增像素基线**（design §4 末行）。
  反向验证：四条必须 FAIL 的输入实测全红（日志 `test-results/m237/reverse-validation.log`）。
  改动 `tests/visual/scenes/**` 后本地跑了 `bash scripts/gate.sh visual`（`visual-regression` 291s PASS，
  全量 419 条；唯一 FAIL 是提交前的 `bindings-drift`，属预期——`src/bindings/UiConfig.ts` 随 ts-rs 重导出
  更新，提交后即绿）。同批修掉两处被本改动**打破的既有断言**：`titlebar-identity.spec.ts` 的
  `.modeline-right` 整体文本断言（右段最末多了指示钮，判据拆成 meta 段锚定 + 版本号段清空）、
  `mermaid.spec.ts` 的世界代守卫用例（见 §4.1 的落点修正）。
  **像素层如实登记**：指示钮整块 ≈821 px² < 0.001 档的 960 px 预算，整页基线的像素对比结构性
  看不见它（`test-results/m237/chip-area-probe.log`）——套件照绿不等于基线与界面一致，是否重建
  基线归 Alex（`docs/backlog.md` 待裁决第 33 条），本批一律未改基线。
- [x] 4.3 真机验收场景 `scripts/acceptance/scenarios/44-theme-live-switch.md`
  （**编号修正**：不是原稿的 36——36 已被 `36-restyle-content` 占用，本批按 tower 重新分配的
  序列取 44）：快捷键三档循环一周逐档断言主题（真机侧的可读读数是 modeline 指示钮的 AX 文本，
  见该场景「主题的生效怎么判」一节）；modeline 钮点击切换；含 mermaid 块的文档切换后重渲
  settle；切换后读 config.json 断言 `[ui] theme` 已写回；重启实例断言首帧为最后切换的主题
  （持久性闭环）；断言按 REVIEW.md 第 1/2 条纪律带正向锚点与反向输入实测
  （真机实测：**34 断言全 PASS / 55.5s**，证据 `test-results/acceptance/2026-09-26/44-theme-live-switch/`；
  反向验证 3/3 必红 `test-results/m237/reverse-validation-acceptance.log`）。
  **真机侧的主题读数口径**（代理判据，如实登记）：本套件没有计算属性通道，`data-theme` 与
  `getComputedStyle` 在真机上读不到——读数是 modeline 指示钮的 AX 文本
  `AXButton (主题：{主题名}（点击切换）)`，它由唯一施加点 `applyTheme` 与 `data-theme` 同步写入。
  色值 / eink 组件级覆盖 / mermaid SVG 内联色由 chromium 场景守（两侧分工见 §4.2）。
- [x] 4.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（26 passed / 0 failed）
- [x] 4.5 `bash scripts/gate.sh quick` 全绿（提交后 **10/10 PASS**，含 bindings-drift——提交前那条 FAIL 是
  预期：`src/bindings/UiConfig.ts` 随 ts-rs 重导出更新、未提交时被判漂移）；真机验收套件
  `node scripts/acceptance/run.mjs 44` **PASS**（34 断言 / 55.5s）。**全流程无回归**：`node scripts/acceptance/run.mjs`
  全量跑一遍 **46/47 PASS**，唯一 FAIL 是 `32-list-filter` 的「命中的那一行还在（`-b` 那个 vault 的完整路径）」
  ——与 2026-09-25 的既有记录同一断言、同一处（`test-results/acceptance/2026-09-25/`），**先于本 change 存在**，
  已登记 `docs/backlog.md` 待修 findings（本 change 的 scope 不含该场景的失败面）。证据：
  `test-results/m237/acceptance-full.log` 与 `test-results/acceptance/2026-09-26/summary.md`。

## 5. 收尾

- [x] 5.1 归档顺序核对：`openspec list` 显示 `restyle-ui-tokens-v1` **尚未归档**（49/51 tasks），
  而本 change 的 `ui-design-system` delta 是 MODIFIED——此时 archive 会被拒。按原稿口径
  **不强行 archive**，本 change 的待归档状态已登记进 `docs/backlog.md` 的待 Alex 裁决节。
