# Tasks: global-line-numbers-toggle-nov23

## 0. 裁决与提案

- [x] 0.1 节点 1 已通过：Alex 2026-11-23 对 UX 改进第 4 项明确「按推荐」，七项取舍见
  `proposal.md` 的「评审记录」（默认 off；md / code 合并；⌘⇧N + modeline 钮全局切换并持久化；
  `⌥G` 临时 gutter；只统一开关不统一外观；`[ui] line_numbers` + `data-line-numbers` 单一运行
  真源；旧键硬切断 + 启动 warning，不迁移、不双读）
- [ ] 0.2 实现期发现新的价值 / 行为取舍时停手，更新 `proposal.md` 并重走节点 1；MUST NOT 静默
  扩 scope（AGENTS.md 影响面升级线）

## 1. 制品与自验

- [x] 1.1 `proposal.md` / `design.md` / `tasks.md` / `carryover.md` /
  `specs/keymap-commands/spec.md` / `specs/ui-design-system/spec.md` 起草完成
- [x] 1.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（本 change 的
  `--type change` 亦单独 PASS；读数落主仓 `.local/reviews/ux-improvements/line-numbers-*.log`）
- [x] 1.3 `bash scripts/docs-check.sh` 通过（含相对链接、归档对账、backlog 出口、验收场景契约）

## 2. Rust schema 与 TS 绑定

- [x] 2.1 `src-tauri/src/config.rs`：新增 `LineNumbers { On, Off }`（`#[serde(rename_all =
  "lowercase")]` + ts-rs 导出），`UiConfig.markdown_line_numbers` 换成
  `line_numbers: LineNumbers`，`UiConfig::default()` 取 `Off`
- [x] 2.2 `RawUiConfig`：`line_numbers: Option<String>`；旧键字段改为
  `markdown_line_numbers: Option<serde_json::Value>`，注释写明「只用于发退场 warning，MUST NOT
  参与生效值 / MUST NOT 回写 / MUST NOT 作别名兜底」
- [x] 2.3 `validate()`：`"on"` / `"off"` 生效；缺失默认 `Off` 不告警；非法值回落 `Off` +
  `warn_at("ui_line_numbers_invalid", "ui.line_numbers", …)`；旧键携带**非 `null` 值** →
  `warn_at("ui_markdown_line_numbers_retired", "ui.markdown_line_numbers", …)` 且
  **不改变** `line_numbers` 的求值结果；显式 `"markdown_line_numbers": null` 与键缺席同义、
  MUST NOT 告警
- [x] 2.4 单测替换 `config.rs:5136-5194` 的旧三档用例：缺失 → `Off`；两档各自生效；非法值
  warning + 回落；旧键（非 null）warning + 生效值不受影响（旧键 `"always"` 无新键 ⇒ `Off`；
  旧键 + `"line_numbers":"on"` ⇒ `On`）；**显式 `null` 不告警、生效值仍按新键 / 默认**；
  `"line_numbers": 2` 整文件回落；旧键类型错（数字）只告警、不触发整文件回落
- [x] 2.5 重导出 `src/bindings/**`：`LineNumbers.ts` 新增、`UiConfig.ts` 重生成、
  `MarkdownLineNumbers.ts` **手工删除**；重导出产物先 `git add`，再跑 `scripts/gate.sh quick`
  确认 bindings-drift 不再报红（AGENTS.md 的口径）
- [x] 2.6 改写 `config.rs` 模块头 `:41` / `:51-54`、字段注释与枚举注释：不得再出现「md 专属
  三档 / code 恒常显 / 运行期 MUST NOT 回写」的旧表述（REVIEW.md「设定类现状断言」条）

## 3. 纯逻辑与文案

- [x] 3.1 新增 `src/line-numbers.ts`：`currentLineNumbers(root)` / `nextLineNumbers(current)` /
  `LINE_NUMBERS_INDICATOR_LABEL(state)` / `LINE_NUMBERS_SAVE_FAILED_TEXT(reason)`；零 DOM 依赖、
  零第三方 import（照 `src/theme.ts` 的分层）
- [x] 3.2 `src/copy-data.ts` + `文案-Copy.md`：D972 专供**命令短标签**（`COMMAND_META.labelKey`）；
  绑定的三来源说明独立一键（`D_binding`）、指示钮一钮（`D_indicator`，含 `{state}`）、写失败
  toast 一钮（`D_save_failed`，含 `{reason}`）——后三者按实现期 deck 末位连续取号，起草期不写
  死编号；四键互不复用，`on` / `off` 作为读数不译文
- [x] 3.3 新增 `tests/unit/line-numbers.test.ts`：属性缺失 → `null`；`"on"` / `"off"` 读取；
  `null` 取反落到 `"on"`；两档互转；指示钮 / 写失败两条文案的占位与取值（按实现期取到的键）

## 4. 编辑器侧

- [x] 4.1 `src/editor.ts`：`mdGutterCompartment` → `gutterCompartment`（模块级、注释改写）；
  同批更新 `tests/unit/pane-state-migration.test.ts:206` 的源码守卫名单（四个 compartment 的
  名字列表）
- [x] 4.2 `mdGutterExtensions()` → `gutterExtensions()`：`lineNumbersOn || gotoGutterVisible`
  时返回 `lineNumberGutterExtensions()`；md 与 code 两个分支都经
  `gutterCompartment.of(gutterExtensions())` 装载（同一棵树只引用一次）
- [x] 4.3 `reconfigureMdGutter()` → `reconfigureGutter()`：遍历全部会话（md 与 code），前台
  dispatch、后台 `session.state.update({effects}).state`；旧实现的 `session.mode !== "md"`
  跳过必须去掉
- [x] 4.4 `setMarkdownLineNumbers(tier)` → `setLineNumbers(on: boolean)`：`EditorHandle` 的接口
  与实现（`editor.ts:1545-1554` / `:3508-3526`）以及 `main.ts` 的复合句柄（接口 `:109-110`、
  广播 `:1087-1090`）同一批改名；值未变直接 return（保留 M281 的启动期零事务守卫），变化时写
  实例态并 `reconfigureGutter()`
- [x] 4.5 `setGotoLineGutterVisible(visible)`：**先 no-op 守卫（值未变 return），再写
  `gotoGutterVisible = visible`，然后才按 `lineNumbersOn` 提前 return**，最后
  `reconfigureGutter()`。赋值 MUST NOT 挪到 `lineNumbersOn` 判断之后：两个交叉态
  （`on → ⌥G → 切 off`、`off → ⌥G → 切 on → 收起输入条`）都靠它成立，顺序写反会分别错误卸除 /
  错误保留 gutter（design §4.2 有两个方向的失败说明）
- [x] 4.6 改写 `editor.ts:1540-1554` / `:1870-1879` / `:2201-2214` / `:2227-2279` /
  `:3505-3526` 的契约注释：两模式共用一个开关、一个在场判据；`⌥G` 的临时 gutter 与持久开关
  解耦
- [x] 4.7 几何实测（写进 `tests/visual` 与任务证据）：md 1200 / 640 两档开关前后 `.cm-content`
  rect 逐值不变；code 1200 逐值不变；code 640 无横向滚动、行号不裁切、正文从 gutter 右缘起排
  ——code 窄窗的让位是 design §10.1 的已知边界，MUST NOT 当成缺陷修

## 5. 装配层、命令与视觉

- [x] 5.1 `src/main.ts`：新增 `applyLineNumbers(on)`（唯一写 `document.documentElement.dataset.lineNumbers`
  的点：同时 `editor.setLineNumbers` + `syncLineNumbersIndicator`）；删除
  `currentMarkdownLineNumbers` 与 `editor.setMarkdownLineNumbers(...)` 启动调用
- [x] 5.2 `src/main.ts`：新增 `toggleLineNumbers()`（读 `currentLineNumbers` 取反 → `applyLineNumbers`
  → `configSetUiValue("line_numbers", next)`）；写失败 toast（`D_save_failed`）+ `logEvent("config_warning",
  { source: "line-numbers", message })`，运行期不回滚
- [x] 5.3 启动装配块用 `applyLineNumbers(snapshot.config.ui.line_numbers === "on")`；
  新 pane（`createPaneHandle`）改为从 `document.documentElement` 读当前值后
  `setLineNumbers`，不再读跟踪变量
- [x] 5.4 `onRelabel` 追加 `syncLineNumbersIndicator()`（只重取文案 / 显隐，不重配编辑器）
- [x] 5.5 `src/shell.ts` + `src/style.css`：新增 `.modeline-line-numbers` button（初始
  `hidden`），右段顺序 meta → version → **lineNumbers** → theme → language；样式并入
  `.modeline-theme` / `.modeline-language` 的共用 pill 规则，eink 用同一描边规则，零新色值 /
  零新尺寸 token
- [x] 5.6 `src/keys.ts`：`view.toggle-line-numbers` 进 `NON_TAB_GLOBAL_COMMAND_IDS`，不进
  `KEYLESS_COMMAND_IDS`；新增 `{ key: "Cmd-Shift-N", command: "view.toggle-line-numbers",
  scope: "global", docKey: "D_binding" }`（`D_binding` 是实现期取号的**独立**文案键，MUST NOT
  复用 `D972` 的短标签）；`doc` 写三条来源结论，组注释只写共性口径（作用域 / 前缀 / 默认绑定）
- [x] 5.7 实现前补测 `⌘⇧N` 的 macOS 系统级占用（三条来源的第③条，上一轮未复核）：按
  `defaults export com.apple.symbolichotkeys` 同一条纪律复核并记录。**若被系统占用：停手上报
  Alex 裁决**，MUST NOT 自行改用 `⌘⇧G`（备选只是记录，不是落槌值）
- [x] 5.8 `src/command-meta.ts`：新增 `view.toggle-line-numbers` 的 `labelKey: "D972"` 与别名
  （`line numbers` / `line numbers toggle` / `gutter`）；D972 只放短标签、MUST NOT 承载三来源
  说明（后者在 `D_binding`）；`tests/unit/command-meta.test.ts` 的键集对账全绿
- [x] 5.9 扩展 `tests/unit/keys.test.ts`（照 ⌘⇧T 的既有专项用例）：① 真实事件
  `{ key: "N", code: "KeyN", metaKey: true, shiftKey: true }` 经 `keyToken` 得到
  `Cmd-Shift-N`，与表内 token 相等；② `binding.scope === "global"`、命令在
  `NON_TAB_GLOBAL_COMMAND_IDS` 里、不在 `KEYLESS_COMMAND_IDS` 里；③ `docTextOf(binding)`
  同时含「表内」「muda / 原生菜单」「macOS」三段（不是仅非空）；④ `[keys]` 重绑（如
  `Ctrl-;`）与解绑各一条
- [x] 5.10 `src/bindings-panel.ts` 不改：命令经 `NON_TAB_GLOBAL_COMMAND_IDS` 自动进「全局」组；
  跑 `tests/unit/bindings-panel.test.ts` 确认零兜底组、且该命令恰一行
  - 同批同步 `tests/visual/scenes/m133-describe-bindings.spec.ts` 的「全局」档计数：新命令使该组
    多一行，NON_TAB_GLOBAL 22 → 23、合计 34 → 35（「35 条命令 · 2 组」）。这是计数的预期变化，
    产品与分组逻辑零改动；完整视觉复跑时该条因此先红，改计数后 15/15 PASS。

## 6. 测试（单测 / 视觉 / 桩）

- [x] 6.1 重写 `tests/visual/scenes/m281-goto-line.spec.ts` 的行号段：标题与注释从「三档」改
  「两档 + 跳转临时档」；用例改为 `line_numbers: "on"` / `"off"`；`off` 下 `⌥G` 临时 gutter
  （md / code 各一例）与四条收起路径；`on` 下输入条开 / 关不改在场；**交叉态两个方向**：
  ① `on → ⌥G（可见）→ ⌘⇧N off` ⇒ gutter 仍在，Escape 收起后消失；② `off → ⌥G（可见）→
  ⌘⇧N on` ⇒ 收起后仍常驻（覆盖 `gotoGutterVisible` 的赋值顺序，design §4.2）
- [x] 6.2 `m281` 几何用例改判据：md 1200 / 640 开关前后 `.cm-content` rect 逐值不变；code
  1200 逐值不变；code 640 无横滚 / 无裁切
- [x] 6.3 新增视觉断言（可并入 m281 或新 spec）：`⌘⇧N` 与钮点击各切一次；md / code 同时在场
  / 同时消失；**非编辑器焦点的快捷键**：搜索框（⌘F 打开后焦点在输入框）与 harness composer
  内各按一次（`global` 作用域判据）；双 pane 同步；后台标签切回是新态；新 pane 继承；
  `__uiValueWrites` 断言写回 `{ key: "line_numbers", value: "on" | "off" }`；写失败注入
  （`failures` 通道）后不回滚 + toast；桩重载配置后按 `ui.line_numbers` 生效；非法值与旧键
  warning 在 console。双 pane 的临时 gutter 归属按 design §10.7 的现状记录（广播到全部 pane），
  不写成本 change 的判据
- [x] 6.4 指示钮视觉：三主题（light / dark / eink）形态、eink 描边、520px 窄窗右段不溢出且
  主题 / 语言钮不被吃掉；`hidden` 初态在施加前不显示；`on` / `off` 两种读数下钮等宽、右段
  其它元素（meta / 版本号 / 主题 / 语言）rect 逐值不变（切换不是布局事件）；**同批更新
  `tests/visual/scenes/modeline.spec.ts`**：右段文本断言补 `.modeline-line-numbers` = `off`，
  并重截 `modeline-bar.png` 元素基线（diff 交 Alex，不机械 `--update`）
- [x] 6.5 `tests/visual/scenes/gutter-copy-path-line.spec.ts`：桩配置 `markdown_line_numbers:
  "always"` → `line_numbers: "on"`；`on-demand` 用例改 `off` + `⌥G`；补 `off` 且输入条关闭时
  右键无复制 / 无反馈
- [x] 6.6 `tests/visual/scenes/tauri-stub.ts`：Config 类型与 `mockConfig` 的
  `markdown_line_numbers` → `line_numbers`（默认 `"off"`，与 Rust `Default` 同值）；注释说明
  默认变化对既有基线的影响
- [x] 6.7 回扫 `m130-text-open-trap.spec.ts:90`、`markdown-parser.spec.ts:113-119` 的旧口径注释，
  按新语义改准（不得把「md 默认 on-demand / code 恒有 gutter」当现状）
- [x] 6.8 **模式判据回扫（默认 off 的直接受害者）**：`tests/visual/scenes/end-marker.spec.ts:286`
  与 `:549-569` 用 `.cm-lineNumbers` 是否存在当「code 模式」判据（注释明说「若日后把默认档改成
  `always` 这里会红」）——默认改 `off` 后该判据两端都为假，会抛「模式判据不成立」。逐处改成
  与行号无关的模式信号（或给该场景显式 `line_numbers: "on"` 并说明这是为判据服务的构造），
  `markdown-parser.spec.ts:113` 的 code 模式 gutter 断言同批处理
- [x] 6.9 基线复核面（不预先缩成 m281 / code）：① `modeline.spec.ts` 的右段文本断言与
  `modeline-bar.png` 元素基线（行号钮在 `off` 下也常驻，元素基线必变）；②
  `titlebar-identity.spec.ts:212` 的右段整体文本正则（`.modeline-right` 的全文本断言只有这一处；
  现行只匹配前缀，新钮加入后会继续绿但不再证明注释所称的完整拼接）——改为含行号钮的完整拼接
  断言；③ `m281-md-gutter` /
  `m281-goto-prompt`；④ **全部含 modeline 的整页截图**（不只 code 场景——`off` 也会让
  modeline 多一个钮）。先跑出 diff 交 Alex 过目，**过目后才** `--update`；基线更新是人肉
  裁决点，MUST NOT 机械执行

## 7. 真机验收（WKWebView）

- [x] 7.1 场景 `56-goto-line.md`：标题 / 步骤措辞从「on-demand 默认档」改「默认 off，`⌥G`
  临时带出」；其余断言（预填、共 M 行、落点、钳制、取消、重绑）逐条保持
- [x] 7.2 场景 `707-gutter-copy.md`：`config.markdownLineNumbers: always` →
  `lineNumbers: on`；覆盖边界段改「on / off 两档 + 临时 gutter」；补一条 `off` + `⌥G` 的
  临时 gutter 右键复制（剪贴板逐字 + 输入条不被收起）
- [x] 7.3 新增场景 `722-line-numbers-toggle.md`（id 722：起草期写的 721 已被
  `721-harness-vault-unread` 占用，按「避开已用编号」顺延到 722）：
  - oracle：**行号 gutter 右键复制**——剪贴板拿到 `{path}:{line}` ⇒ gutter 在场，拿不到 ⇒
    不在场（AX 读不到 gutter）；
  - 默认 `off`：md 与 code 各一次右键 → 无复制、无成功提示、剪贴板哨兵不变；`⌥G` 后右键 →
    复制成功，Escape 后恢复无复制；
  - `⌘⇧N` 切 `on`：md 与 code 各右键一次 → 复制成功（`{path}:1`）；再按一次 → 恢复无复制；
  - 指示钮：点一次切 `on`（右键 oracle 复核）、再点一次切 `off`；
  - 持久化：切到 `on` 后用 `file:` 断言 `env:config.json` 的 `"line_numbers": "on"`；
    `do: restart` 后右键 oracle 仍是 `on`；
  - 双 pane / 后台标签：切到另一 pane / 标签再切回，右键 oracle 与切换后一致；
  - 交叉态至少一条：`on` 下 `⌥G` 后按 `⌘⇧N` 切 `off`，右键 oracle 仍复制成功（gutter 还在），
    Escape 收起后恢复无复制
  - 截图证据：三态（off / on / 临时）各一张
- [x] 7.4 `scripts/acceptance/lib/execute.mjs`：`markdownLineNumbers` 参数与校验（`:536-542`、
  `:4444-4446`）改为 `lineNumbers`，闭集合 `on` / `off`；缺省不写 = 出厂 `off`
- [x] 7.5 `scripts/acceptance/lib/app.mjs`：`writeConfig` 的 `markdownLineNumbers` → `lineNumbers`
  （`:204-289`），落 `[ui].line_numbers`
- [x] 7.6 `scripts/acceptance/COVERAGE.md`：更新 56 / 707 两行的口径，新增 722 行；跑
  `node scripts/acceptance/coverage.mjs` 重新生成并 `node scripts/acceptance/run.mjs --check`
- [x] 7.7 真机执行 56 / 707 / 722，证据落 `.local/acceptance/<日期>/`（不进 git）；FAIL 项与
  手感项进完工报告
  - 2026-11-24 首轮：56 PASS；707 / 722 FAIL——根因是**场景手势**，不是产品回归：① `⌥G` 是
    editor 作用域，`do: open` 打开已存在标签（含重启恢复）后焦点留在 chrome 上，按键不命中；
    ② 负向右键落在**没有 gutter 的正文**上会弹 WKWebView 原生菜单（产品不接管 `contextmenu`
    的预期行为），菜单吞掉后续键盘与第一次鼠标动作；③「没有成功提示」负向断言被上一条成功
    toast 污染。修法（只动场景）：每次 `⌥G` 前 `clickEditor` 并断言 `focused: AXTextArea`；
    每个负向右键后 `Escape` 关菜单并 `waitFor: not /AXMenuItem/`（收起有动画延迟，必须轮询）；
    code-off 负向断言前等 `已复制` toast 消退。
  - 最终复跑（返修含评审 P2-1 的后台标签覆盖顺序）：**3/3 PASS**——56（21.7s）、707（40.2s）、
    722（44.4s）；无游离实例（STRAY-SCAN none）。证据：主仓
    `.local/acceptance/2026-11-24-global-line-numbers/`，日志副本
    `.local/missions/global-line-numbers-nov23/acceptance-56-707-722-final.log`。

## 8. 既有场景与文档回扫

- [x] 8.1 全仓 `rg "markdown_line_numbers|MarkdownLineNumbers|mdGutter"`：代码 / 当前文档 /
  测试 / 验收套件逐处改准；`openspec/changes/archive/**` 与其它活跃 change 的历史正文不回改
  （历史记录）
- [x] 8.2 全仓 `rg "on-demand"`（限定 `src/`、`tests/`、`scripts/acceptance/`、`docs/specs/`、
  `openspec/specs/`）确认没有残留的旧档位语义；命中项逐个判「读数 / 历史 / 需改」
- [x] 8.3 `docs/specs/config-reference.md`：`[ui]` 表行改 `ui.line_numbers`（类型 / 默认
  `"off"` / 两档 / 启动 + 运行期切换 + 切换即回写）、`:104` 的段落改写、`:113` 与 `:454` 的
  类型不符示例改名、§3 的运行期回写键清单补 `ui.line_numbers`
- [x] 8.4 `tests/unit/error-text.test.ts`：`LOG_ONLY_DIAGNOSTIC_CODES` 删
  `ui_markdown_line_numbers_invalid`、加 `ui_line_numbers_invalid` 与
  `ui_markdown_line_numbers_retired`（反向判据要求两项都在 Rust 有真实构造点）
- [x] 8.5 `src/scroll-position.ts:45`、`src/scroll-position-view.ts:84` 的旧键注释改准
- [x] 8.6 仓库信息卫生：对改动面做一次 text 级 `rg` 清扫（真实 vault 人名 / 项目名 / 目录名 /
  文档正文零命中）；新增 fixture 全用合成内容；动过原型 HTML 才需要重截截图（本 change 无原型）

## 9. 门禁与证据

- [x] 9.1 `pnpm test` 全绿（含新增 / 改写的单测）
- [x] 9.2 根 `pnpm exec tsc --noEmit` 与 `tests/visual` 的 tsc 全绿
- [x] 9.3 `scripts/gate.sh quick` 全绿（bindings-drift 按「先 `git add` 重导出产物」的预期
  口径处理）——`GATE RESULT: 13/13 PASS（SKIP 0）`，exit 0
- [x] 9.4 `scripts/gate.sh visual` 全绿（动过 `src/style.css` / `src/preview/**` /
  `tests/visual/scenes/**`，像素层必须本地跑；CI 绿不代表像素层没回归）
- [x] 9.5 `bash scripts/docs-check.sh` 全绿
- [x] 9.6 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 全绿
- [x] 9.7 门禁输出按 `GATE RESULT` 原文行记录（SKIP 单列，不并进 PASS 数）；日志落主仓
  `.local/missions/global-line-numbers-nov23/`——quick `13/13 PASS（SKIP 0）`；批准基线后完整视觉
  `15/15 PASS（SKIP 0）`、1302 passed / 1 skipped；路径已复核存在

## 10. 归档放行（实现 PR 合并时执行）

- [x] 10.1 `docs/backlog.md` 的归档跟踪队列落一条本 change 条目（tasks 全勾时 docs-check 的
  归档队列判据要求有且仅有一条；当前文件 76 行、硬上限 80，只加一行）
- [x] 10.2 改名通道的机器门禁**只查结构**：`node scripts/openspec-archive-check.mjs` 判 REMOVED
  旧条存在、ADDED 不与 living 同名，**不比较旧块与新块的正文 / 场景**（对本 change 的口径就是
  `0 条 MODIFIED / 对比 0 段`）；它的 PASS 不得当作「无静默丢合同」的证据。按 `carryover.md`
  的 A / B 两节（13 个正文段落 + 20 个场景）逐项核对承接，结论写进评审记录
- [x] 10.3 独立 reviewer 判 `clean / merge` 且绑定当前 tip；verdict 里 MUST 含 `carryover.md`
  的逐项签字（A.1 / A.2 / B.1 / B.2 四项 + 结论）——r3 clean / merge 绑定 `08c90d17`，四项签通过
- [x] 10.4 要求的门禁与真机证据齐（9.x + 7.7）；节点 2 五要件逐条写进 `proposal.md` 的
  节点 2 块；无证据缺口
