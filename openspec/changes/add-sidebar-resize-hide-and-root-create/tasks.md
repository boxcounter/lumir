# Tasks: add-sidebar-resize-hide-and-root-create

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；实现期发现
> proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。

## 0. 提案（节点 1）

- [ ] 0.1 起草 `proposal.md` / `design.md` / `specs/{ui-design-system,keymap-commands,file-tree}/spec.md` / 本文件
- [ ] 0.2 Alex 节点 1 评审通过（硬门禁；六个起草期取值 D1–D6 一并裁决）

## 1. 宽度：token、配置与拖拽

- [ ] 1.1 新增 `src/sidebar-width.ts`：`SIDEBAR_WIDTH_TOKEN` / `DEFAULT_SIDEBAR_WIDTH`（236）/
      `SIDEBAR_WIDTH_MIN`（180）/ `SIDEBAR_WIDTH_MAX`（480）/ `clampSidebarWidth()` / 运行期窗口
      钳制（`min(480, 0.4 × window.innerWidth)`）；断言三处默认值同值（Rust / TS / CSS）
- [ ] 1.2 `src-tauri/src/config.rs`：`UiConfig` 新增 `sidebar_width: f64` + `RawUiConfig` 的同名
      `Option<f64>` + 校验分支（照 `content_width` 模板：越界回落默认 + warning、类型不符走整文件
      回落）；`UiConfig::default()` 与常量同值
- [ ] 1.3 重导出 `src/bindings/UiConfig.ts`（ts-rs）并**先 `git add`** 再跑门禁（`bindings-drift`
      的预期流程）
- [ ] 1.4 `src/shell.ts`：`.app-shell` 内插入 `.sidebar-divider`（`role=separator`、vertical、
      可聚焦、读屏名走文案 deck、`aria-valuenow` 由装配层写）；`AppShell` 暴露该元素
- [ ] 1.5 `src/main.ts`：分隔条拖拽编排（pointer capture → rAF 合并施加 → 松手一次
      `configSetUiValue("sidebar_width", w)`；写失败 toast + `config_warning`、运行期不回滚）；
      启动装配区按配置施加一次宽度
- [ ] 1.6 `src/style.css`：分隔条的静止态零足迹与 hover / 拖拽 / `:focus-visible` 一档 `--hover`；
      光标 `col-resize`；MUST NOT 新增色值 / 字号 / 圆角
- [ ] 1.7 单测（`tests/unit/sidebar-width.test.ts`）：钳制端点 / NaN / 越界、运行期钳制与静态区间
      叠加、默认值三处同值对账

## 2. 收起与展开（⌘B）

- [ ] 2.1 `src/keys.ts`：新增命令 `view.toggle-sidebar` + 默认绑定 `Cmd-b`（scope `global`）；
      **不进** `KEYLESS_COMMAND_IDS`；`CommandRunner` 记录里补齐实现入口
- [ ] 2.2 `src/main.ts`：命令实现——按 design §2.2 的固定顺序收尾在手状态（关菜单 → 取消行内
      编辑 → 焦点交还活跃文档 pane）→ 切 `.app-shell` 的 `is-sidebar-hidden`
- [ ] 2.3 `src/style.css`：收起态几何（首列 0、`.pane-filetree` 不显示、`.titlebar-traffic` 宽
      回到 auto）；展开态零足迹
- [ ] 2.4 单测 / 断言：命令经统一分发器执行（焦点在编辑器、文件树、composer 三种情形）、
      `[keys]` 重绑与解绑语义、无重复键（构造期检查自然覆盖）
- [ ] 2.5 补一条边界：收起时正进行行内编辑 → 按取消处理（不提交、不留半个临时行）；树右键菜单
      开着 → 收起即关闭

## 3. vault 根右键新建

- [ ] 3.1 `src/tree-menu.ts`：`menuItemsFor` 增加 `"root"` 档 → `[新建文件, 新建子目录]`；
      `menuActionsFor` 同步；root 项集的唯一真源就在这一处
- [ ] 3.2 `src/tree.ts`：`contextmenu` 在 `rowLiAt(...) === null` 时 `preventDefault()` 并回调
      `onContextMenu({ path: "", kind: "dir", name: vaultName, anchor: 头部按钮 }, at)`；
      命中行时行为逐字节不变；未装载 vault 时不产菜单
- [ ] 3.3 `src/main.ts`：`runTreeAction` 的 `new-file` / `new-dir` 对 `path === ""` 走同一
      `tree.beginCreate("", kind)`（不另写分支）；焦点归还锚点取头部入口
- [ ] 3.4 单测：`menuItemsFor("file" | "dir" | "root")` 的项集与顺序、`menuActionsFor` 对账；
      若有既有菜单单测，扩展而不是另起文件

## 4. 视觉门禁（chromium + `tauri-stub`）

- [ ] 4.1 新增场景（或扩既有 `app-main` 场景）：默认态读取 `--layout-sidebar-w`、
      `.pane-filetree` 宽、`.titlebar-traffic` 宽三处逐值一致（默认 236）
- [ ] 4.2 同场景：拖拽分隔条 80px → 三处读数同步变化；松手恰好一次 `config_set_ui_value`
      （桩记录 invoke 序列）；写失败注入 → toast 出现且宽度不回滚
- [ ] 4.3 同场景：`Cmd-b` 收起 → 首列计算宽 0、`.pane-filetree` 不可见、traffic 宽 = 标识块
      自然宽、正文贴左；再按一次 → 三处读数与收起前逐值相同
- [ ] 4.4 同场景：树头部右键与尾部空白右键 → 菜单在场且项集为两条新建；打开/关闭菜单不改当前行
      与标签；条目行右键 → 仍为既有项集（反向验证）
- [ ] 4.5 既有整页基线：默认态未变 ⇒ **零更新**；若实现导致任何基线变化，停下按「基线更新是
      人肉裁决点」报 Alex 过目后再 `--update`

## 5. 真机验收场景

- [ ] 5.1 新增 `scripts/acceptance/scenarios/<编号>-sidebar-resize-toggle-root-create.md` + 合成
      vault fixture（宽文件名、一个目录、根下新建两种条目）
- [ ] 5.2 断言：拖宽 → 重启 app → 宽度保持；⌘B 收起（左栏消失、焦点仍在文档、可在编辑器键入）→
      ⌘B 恢复且宽度回到拖出的值；根右键新建文件 → 自动打开；根右键新建目录 → 出现在树里且父目录
      不被自动展开
- [ ] 5.3 回扫既有验收场景：grep 所有对「左栏在场 / 236px / 树右键」有期望的场景，逐条确认仍然
      成立或改准；`node scripts/acceptance/run.mjs --check` 通过
- [ ] 5.4 如实登记覆盖边界（真机点击手感、分隔条拖拽节奏归 Alex 手感裁决，不进机器判据）

## 6. 验证

- [ ] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 6.2 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码）
- [ ] 6.3 `bash scripts/gate.sh visual` 全绿（动过 `src/style.css` 与视觉场景，必须本地跑）
- [ ] 6.4 信息卫生清扫：新增 fixture / 场景 / 文档对改动面做一次 text 级 grep，真实 vault 内容、
      真实路径、真实人名零命中
