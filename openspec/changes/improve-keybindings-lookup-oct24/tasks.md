# Tasks: improve-keybindings-lookup-oct24

> 阶段门：0.2（Alex 节点 1 评审）通过前 MUST NOT 改产品代码 / living spec。本 change 的提案批只交付
> `proposal.md` / `design.md` / 本文件 / `specs/keymap-commands/spec.md` 与原型；实现批按本清单逐项勾选。
> 实现期发现 proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/keymap-commands/spec.md` / 本文件
- [x] 0.2 原型：`design/prototypes/keybindings-lookup-oct24.html`（自包含、控制面板、P1/P2/P3/P4/P6 场景、三主题）
- [x] 0.3 断言先行：`.local/reviews/keybindings-lookup-oct24/assert.mjs` 红（17 条全红）→ 绿（17 条全绿），
      两次输出留档（`assert-red.txt` / `assert-run-final.txt`）
- [x] 0.4 Alex 节点 1 评审通过（硬门禁；D1–D6 一并裁决，未回的按提案里的倾向落地）——Alex 2026-10-24 回复「采纳。」
- [x] 0.5 裁决结果回填 proposal 的「评审记录」块（逐字），按裁决修正 design 与 delta

## 1. 数据单一来源

- [x] 1.1 新增 `src/command-meta.ts`：`COMMAND_META: Record<CommandId, CommandMeta>`（`labelKey` /
      `labelParams?` / `aliases?`）、`SCOPE_LABEL_KEYS`、`SCOPE_DESCRIPTION_KEYS`
- [x] 1.2 `文案-Copy.md` + `src/copy-data.ts`：71 条命令的中英标签（按功能族分批；`tab.goto-N` 用模板 +
      `labelParams`）、面板标题 / 占位 / 捕获 / 计数 / 空态 / 详情 / scope / `when` / 菜单文案；D63 标题改
      「键位速查（生效中）」（D656 起草期占位退为空号，见 deck「不复用编号」）
- [x] 1.3 `src/keys.ts`：5 条带 `when` 的绑定各补 `whenKey`（详情全文）+ `whenShortKey`（行内短徽标），
      两份文案住文案表、面板不截断；`editor.focus-block-scroll` 保持无 `when`；零新命令 / 零新绑定
- [x] 1.4 新增 `src/key-glyphs.ts`：`glyphOfToken`（`normalizeKey` 同源；Apple 顺序 `⌃⌥⇧⌘`；SHIFT_IMPLIED
      反解物理键；具名键表）
- [x] 1.5 单测 `tests/unit/command-meta.test.ts`：键集 = `COMMAND_IDS`、无幻影、`labelKey` 在 `COPY`、
      中英非空、模板参数齐全；别名是非空字符串（允许 `select all` / `quick open` 这类含空格的自然短语）
- [x] 1.6 单测 `tests/unit/key-glyphs.test.ts`：§2.3 矩阵 + 全部默认 token 不含 token 字面（反向区分度）
- [x] 1.7 单测不变量：`when` ⇔ `whenKey` ⇔ `whenShortKey`；两个键都在 `COPY` 且短徽标非空；
      `BINDING_GROUPS` 零兜底组仍成立；一条 token 一条绑定不变

## 2. 面板本体（`src/bindings-panel.ts`）

- [x] 2.1 行聚合：`effectiveBindings` 按命令归桶；一行一条命令、多键合并；未绑定命令仍成行；scope 取
      `scopeOfCommand`；行内条件取 `whenShortKey`、详情取 `whenKey`；组与组序沿用 `BINDING_GROUPS`
- [x] 2.2 搜索输入：显式 label + `role=combobox` / `aria-controls` / `aria-activedescendant`；空查询全量；
      语料 = 中英标签 + 别名 + 命令 id；`filterIndices` 复用；来由 MUST NOT 进语料；计数 / 空态
- [x] 2.3 按键捕获：显式按钮、等待 / 已捕获两态；`keyToken` / `normalizeKey` 同源；捕获键不执行命令；
      Esc 取消 / 清除分层；⌃G 在等待态作为待查询键被捕获；进入捕获时作用域重置为全部；无绑定空态
- [x] 2.4 详情：行内手风琴，一次一个；中英标签 / 命令 id / scope 说明 / `when` 全文（`whenKey`）/
      原始 token / 来由 / 未绑定成因 + `[keys]` 示例；无嵌套滚动；`aria-expanded` / `aria-controls`
- [x] 2.5 分组 / 折叠 / 作用域：sticky 组头；组头按钮 `aria-expanded`；查询时匹配组自动展开；手风琴折叠
      在查询变化时清空；scope 单选组 `role=radiogroup` + roving tabindex
- [x] 2.6 键盘与焦点：打开聚焦输入框；Tab 四停循环（空态追加动作钮）；↑↓/⌃N⌃P、Enter/Space、←/→、
      Home/End、PageUp/Down；Esc 分层；`⌃G` 关闭；IME 组合期不刷新；关闭走 `restoreFocus()`
- [x] 2.7 样式：重排面板区；保留 `.lumir-bindings-overlay` / `.lumir-bindings-panel` /
      `.lumir-bindings-body` 与 `native-overlay` 滚动条档；不新增色值 / 字号 / 圆角 token
- [x] 2.8 i18n：所有新文案经 `t()`；面板打开时语言切换经 `onRelabel` 重绘

## 3. 非自指入口

- [x] 3.1 `src-tauri/src/lib.rs`：Help 子菜单追加 `Keyboard Shortcuts` 自定义项（`MenuItemBuilder::with_id`，
      不设 accelerator）；`menu_command_of` 映射到 `describe-bindings`；结构假设失败时打 stderr、保留默认菜单
- [x] 3.2 `src/main.ts`：菜单事件落到与 `app.describe-bindings` 同一条 toggle 路径（`MENU_COMMANDS`
      的 `"describe-bindings"` 一项，零新分发 / 零第二个面板实例）
- [x] 3.3 文案：菜单项锁 en「Keyboard Shortcuts」
- [x] 3.4 Rust 单测：`menu_command_of("lumir.keyboard_shortcuts") == Some("describe-bindings")`；
      菜单项无 accelerator（结构上没有调用 `.accelerator()`）；结构变化时降级不 panic

## 4. 测试与验收

- [x] 4.1 单测：语料不含来由（`M447` / 「已删除」零命中）；别名允许自然短语；行聚合（多键一行 / 未绑定
      一行 / scope 来源）；捕获归一化（含 Alt physical code）；空态三成因；计数分母 = 作用域筛选后的命令数
- [x] 4.2 视觉场景 `m133-*`：空查询行数 = `COMMAND_IDS` 数（71）、每命令一行、多键合并、scope / 条件徽标、
      未绑定行、查询 / 捕获 / 空态 / 详情、三主题结构断言；另含已捕获态重捕获、详情 `labelParams`
      插值与 `aria-expanded` false→true→false；结构化模式 15/15 PASS
- [x] 4.3 像素基线：面板行模型变化让整页基线失效；before / after / diff 已备
      （`.local/reviews/keybindings-lookup-oct24-M715/`）。Alex 2026-10-25 对该材料明确回复
      「批准。」，授权更新这一张基线；已用
      `scripts/visual/run.sh --update scenes/m133-describe-bindings.spec.ts` 仅重截
      `describe-bindings-panel-chromium-darwin.png`，其 sha256（c32d1aa4…）与批准材料的 after
      **逐字节相同**；其余 76 张基线的 sha256 与 mtime 均未变化
- [ ] 4.4 真机验收场景（`scripts/acceptance/`）：新增 235（查询）/ 236（捕获）/ 237（键盘），同步
      `COVERAGE.md`；r1 返修后真机 **3/3 PASS**，断言数按 `steps.md` 实际口径 **26 / 54 / 40**
      （235 / 236 / 237），证据 `.local/acceptance/2026-10-24-m715/`。**未勾满，明确未验范围**：
      ① 菜单栏在 AX 通道点不到，菜单点击 → toggle 由 Rust 单测 + 视觉 `fireMenuCommand` 覆盖；
      ② `Home` 在块级横滚容器持焦时对 `scrollLeft` 的效果不可机读（AX 不暴露滚动偏移），场景 21
      只覆盖 End / Home 被容器消费；③ 已捕获态重捕获、⌃G/⌘/ 关闭例外、PageDown/PageUp 的视口行集
      变化与 ⌃D 焦点交还可执行判据已补进 236/237
- [x] 4.5 `bash scripts/gate.sh quick` 全绿：`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0（日志
      `/tmp/m715-gate-quick-baseline.log`；13 项含 cargo fmt/clippy/test、tsc/unit、perf fixture、
      acceptance 语法、docs-check、openspec validate）
- [x] 4.6 `bash scripts/gate.sh visual` 全绿：Alex 批准后重截 m133 基线，完整视觉门禁
      `GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0（835 passed / 1 skipped / 0 failed，日志
      `/var/folders/z5/r89bpbqn13v64t09ngnk03200000gn/T/lumir-gate-visual-regression.aNikpNG2HO`）；
      m133 基线 update 后全量复跑，未再出现任何像素红
- [x] 4.7 性能 / 手感：真机 235 / 237 打开 71 行、连续输入查询与键盘导航无运行失败；手感 / 密度归 Alex

## 5. 文档与登记

- [x] 5.1 `文案-Copy.md` 末尾「消费点」映射表补 D593–D694 与 D63–D67 的现行归属；
      `tests/unit/copy.test.ts` 漂移门禁全绿
- [x] 5.2 `docs/specs/config-reference.md`：本 change 不改 `[keys]` schema，未改该文件（不适用）
- [x] 5.3 `docs/backlog.md`：实现批落一条归档跟踪记录（`improve-keybindings-lookup-oct24`）
- [ ] 5.4 归档时 delta 相对 living spec 有新增内容，走人肉节点 2；归档后跑
      `node scripts/openspec-archive-check.mjs --archived improve-keybindings-lookup-oct24`
- [x] 5.5 信息卫生：新增文案 / 场景 / 截图全为合成数据，无真实 vault 内容；改动面 text 级清扫通过

## 6. 验证

- [x] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（含在 gate quick 的
      `GATE PASS openspec-validate` 一行）
- [x] 6.2 `bash scripts/docs-check.sh` 通过（含在 gate quick 的 `GATE PASS docs-check` 一行）
- [x] 6.3 `bash scripts/gate.sh quick` 通过：`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0
- [ ] 6.4 节点 2 前逐条对账：tasks 勾选状态 / spec 增量 / 实现三者一致；未勾项就地标注放弃原因
