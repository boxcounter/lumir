# Design: 行号全局开关（`global-line-numbers-toggle-nov23`）

## 1. 现状与问题边界

| 层 | 位置 | 现状 |
|---|---|---|
| Rust schema | `src-tauri/src/config.rs:454-459` `UiConfig.markdown_line_numbers`；默认 `:475` `OnDemand`；枚举 `:506-522` | md 专属三档 `on-demand` / `always` / `off` |
| Rust 解析/校验 | `:1854-1858`（`RawUiConfig`）、`:2792-2807`（validate）、单测 `:5136-5194` | 闭集合校验 + 人话 warning |
| TS 绑定 | `src/bindings/UiConfig.ts:36-43`、`src/bindings/MarkdownLineNumbers.ts` | 三档类型 |
| 编辑器契约 | `src/editor.ts:1545-1554`（明文「运行期 MUST NOT 回写」）、`:1714-1724`（`mdGutterCompartment`）、`:1870-1879`（实例状态）、`:2201-2214`（md 走 compartment、code 恒装）、`:2227-2279`（`lineNumberGutterExtensions` / `mdGutterExtensions` / `reconfigureMdGutter`）、`:3508-3526`（setter） | md 与 code 两条在场路径 |
| 装配 | `src/main.ts:282` `currentMarkdownLineNumbers`、`:437` 新 pane 喂值、`:1087-1090` 广播、`:1477-1480` 跳转输入条联动、`:4478-4484` 启动装载 | 一份配置值广播到全部 pane |
| 状态行 | `src/shell.ts:237-251`（`.modeline-theme` / `.modeline-language`）；`src/style.css:741-773` 共用 pill；`src/main.ts:3097-3158` `applyTheme` / `cycleTheme` | 只有主题 / 语言两个指示钮 |
| 命令/键位 | `src/keys.ts:369-459` `NON_TAB_GLOBAL_COMMAND_IDS`、`:496-520` `KEYLESS_COMMAND_IDS`、`:811` 主题绑定；`src/command-meta.ts:99-100` | 没有行号命令 |
| 规格 | `openspec/specs/keymap-commands/spec.md:1062`（三档 + 明文「MUST NOT 提供运行期切换档位的命令 / 键位 / UI」）、`:1082-1090`（三档 scenario）、`:1369-1445`（gutter 右键复制引用该键）；`docs/specs/config-reference.md:90-113` | 两处规格都指向旧键 |

结论：这不是「加一个按钮」。它同时改三件事——配置键的语义（md 专属三档 → 全局二元）、
运行期能力（不可切换 → 可切换且持久化）、以及行号 gutter 的在场判据（两模式合一）。
本 change 是一次明确的**改裁**，不是增量叠加。

## 2. 真源分层（单一运行真源）

照 `applyTheme` / `data-theme` 的既有架构分三层，MUST NOT 出现第四层：

1. **启动真源**：`config.json` 的 `[ui] line_numbers`（`"on"` / `"off"`，默认 `"off"`）。
   合法性只在 Rust 侧判一次（ADR 0002 §5）；前端不复制闭集合判定。
2. **运行期唯一生效面**：`<html data-line-numbers="on|off">`。唯一写入者是
   `src/main.ts` 的 `applyLineNumbers(on)`；命令、modeline 钮、启动装载、语言重绘全部经它
   或它的只读读取口。MUST NOT 在 `main.ts` 另存一个 `currentLineNumbers` 变量（旧
   `currentMarkdownLineNumbers` 删除），当前值一律用 `src/line-numbers.ts` 的
   `currentLineNumbers(document.documentElement)` 从属性读。
3. **编辑器实例态**：`createEditor` 内的 `lineNumbersOn` 只由 `setLineNumbers(on)` 写，
   `gutterExtensions()` 是 gutter 在场判据的唯一来源。它不参与「当前值是谁」的判定——
   `applyLineNumbers` 每拍都把同一值同时写给属性和编辑器，两者不会各判一次。

`<html data-line-numbers>` 的初态：属性缺失 = 未施加 = 按默认 `"off"` 处理（与
`currentTheme` 对缺失 `data-theme` 的处理同款：缺失不是第四档，是「还没施加」）。因此
`toggleLineNumbers()` 在属性缺失时按 `"off"` 取反，第一次按键落到 `"on"`，与屏幕上的
可见变化一致。

## 3. Rust schema 与旧键硬切断

### 3.1 新枚举与默认

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum LineNumbers { On, Off }
```

- `UiConfig.line_numbers: LineNumbers`，`UiConfig::default()` 取 `LineNumbers::Off`。
- 字段位置放在原 `markdown_line_numbers` 处（`theme` 之后、`language` 之前），保持 `[ui]`
  表的人读顺序稳定。
- 字符串枚举（不是 bool）是 Alex 裁决的一部分：配置可读、与 `theme` / `language` 同形；
  将来若要加档不必换类型。前端拿到的一定是两档之一，不再判非法。

### 3.2 旧键只留「检测」，不参与生效值

`RawUiConfig` 删除 `markdown_line_numbers: Option<String>`，改为：

```rust
/// 已退场键：只用于发一条启动 warning（AGENTS.md「变更默认直接切断」）。
/// 取值类型收 `serde_json::Value`：旧键写错类型（如数字）也不得拖垮整份配置——
/// 它已经不被读取为生效值，没有理由让一个退场键触发整文件回落。
markdown_line_numbers: Option<serde_json::Value>,
```

`validate()` 里：

```rust
if raw.ui.markdown_line_numbers.is_some() {
    sink.warn_at(
        "ui_markdown_line_numbers_retired",
        "ui.markdown_line_numbers",
        "配置项 ui.markdown_line_numbers 已退场，取值被忽略（改用 ui.line_numbers：on / off）",
    );
}
```

告警条件是 `Some`（**非 `null`**）：显式 `"markdown_line_numbers": null` 经 `Option<Value>`
折叠为 `None`，与键缺席同义、MUST NOT 告警——`null` 不表达「用户配置了一个旧值」，把它当成
退场提示只会制造噪声。纪律（写进实现处注释）：该字段 MUST NOT 参与 `line_numbers` 的求值、
MUST NOT 被回写、MUST NOT 作为别名兜底。不迁移、不双读；旧键的非 `null` 值本身就是要告诉
用户「这个键没用了」。

### 3.3 新键的校验

照 `ui.theme` 模板：

- 字段缺失 → 默认 `Off`，不告警；
- `"on"` / `"off"` → 直接生效；
- 其它字符串 → 回落 `Off` + `warn_at("ui_line_numbers_invalid", "ui.line_numbers",
  "配置项 ui.line_numbers 取值 \"{other}\" 非法（可选：on、off），已回退为 off")`；
- 类型不符（`"line_numbers": 2`）→ serde 解析期失败 → 整文件回落（与 `theme` 同路，
  不发明逐字段类型容忍）。

两个新诊断 code 都只进 `ConfigSnapshot.warnings` 与 console / 诊断日志（`[ui]` 不在设置
面板范围），因此必须登记进 `tests/unit/error-text.test.ts` 的 `LOG_ONLY_DIAGNOSTIC_CODES`，
并移除 `ui_markdown_line_numbers_invalid`。该表的反向判据会扫 Rust 构造点，漏登记即红。

### 3.4 绑定重导出

`LineNumbers` 经 ts-rs 生成 `src/bindings/LineNumbers.ts`，`UiConfig.ts` 重新生成；
`src/bindings/MarkdownLineNumbers.ts` 必须**手工删除**（ts-rs 不会清理孤立产物；留着就是
REVIEW.md「值或开关声明了却没有消费者」条点名的假能力）。重导出产物先 `git add` 再跑
`gate.sh quick`（AGENTS.md 的 bindings-drift 口径）。

### 3.5 已否决的替代方案

| 方案 | 否决理由 |
|---|---|
| 保留 `markdown_line_numbers` 作为只读别名，读不到 `line_numbers` 时回退 | Alex 裁决「硬切断、不迁移、不双读」；两个键并存会让「哪个说了算」变成长期歧义。 |
| 把旧键标成 `deprecated` 并在设置面提示迁移 | 本仓没有设置面消费 `[ui]`；且用户只有一个，迁移层没有读者（AGENTS.md「变更默认直接切断」）。 |
| 旧键类型不符也走整文件回落 | 退场键没有生效值，整文件回落会让一个无读者的键拖垮 `last_vault` 等真配置。 |

## 4. 编辑器侧：一个 compartment、一个在场判据

### 4.1 命名与结构

- `mdGutterCompartment` → `gutterCompartment`（模块级，跨实例状态迁移的既有前提）。
  `tests/unit/pane-state-migration.test.ts:206` 的源码守卫按名字断言「四个 compartment
  模块级」，改名必须同批更新该清单。
- `mdGutterExtensions()` → `gutterExtensions()`：**两模式共用的唯一在场判据**：

  ```ts
  function gutterExtensions(): Extension {
    return lineNumbersOn || gotoGutterVisible ? lineNumberGutterExtensions() : [];
  }
  ```

  - `"on"`：常驻，跳转输入条开 / 关不改变在场；
  - `"off"` + 输入条打开：临时在场（`gotoGutterVisible`），收起即卸；
  - `"off"` + 输入条关闭：不在场。
- `reconfigureMdGutter()` → `reconfigureGutter()`：遍历**全部**会话（md 与 code），前台
  `view.dispatch({ effects })`、后台 `session.state = session.state.update({ effects }).state`
  （照 `reconfigureWrap` 的既有分流）。旧实现跳过 code 会话，是因为 code 不进 compartment；
  两模式合流后这一跳必须去掉——否则后台 code 标签切回来仍是旧态。
- 两个模式都经 `gutterCompartment.of(gutterExtensions())` 装载：md 分支与 code 分支各引用
  一次，同一棵扩展树里只有一处引用（CM 的 `Duplicate use of compartment` 禁忌不触发；
  视图按 mode 二选一，永不并存）。
- `lineNumberGutterExtensions()` 保持**唯一装配点**（行号渲染 + 右键处理），本次不改。

### 4.2 Setter 与不变量

- `EditorHandle.setMarkdownLineNumbers(tier)` → `setLineNumbers(on: boolean)`：
  - 值未变 → **直接 return**，不派发任何事务。M281 实测过启动期一次无谓 reconfigure 会
    让 CM 全量重测量、扰动同一拍的滚动恢复（m132 的 ⌥V 翻页读到 `scrollTop=8`）；该守卫
    必须保留。
  - 值变了 → `lineNumbersOn = on; reconfigureGutter();`，立即生效到全部会话（含后台）。
- `EditorHandle.setGotoLineGutterVisible(visible)` 保留，**赋值必须发生在任何按常驻开关提前
  return 之前**：
  1. 值未变 → return（no-op 守卫，既有口径）；
  2. 写 `gotoGutterVisible = visible`——它记录的是「输入条当前是否开着」，与常驻开关无关；
  3. `lineNumbersOn` 为真 → return（在场已由常驻开关决定，不白走 dispatch）；
  4. 否则 `reconfigureGutter()`。

  为什么第 2 步不能挪到第 3 步之后：若实现成「先判 `lineNumbersOn` 再赋值」，两个方向都会错——
  `on → ⌥G → 切 off` 时标志仍是 `false`，切 off 会错误卸掉正在用的临时 gutter；
  `off → ⌥G → 切 on → 收起输入条` 时标志仍是 `true`，之后再切 off 会错误保留 gutter
  （收起的输入条不存在了，标志却还亮着）。
- `gotoGutterVisible` 仍是**实例变量**而不是 state 扩展：在场判据在 `gutterExtensions()`
  里读一次、再经 compartment 落进 state（与现状同构）。
- 几何：md 的 gutter 落在左侧空余轨道（`minmax(24px, 1fr)`，见 `src/preview/theme.ts:427-453`
  与 `src/editor.ts:2095-2105` 的注释），中列定值，装 / 卸不改变 `.cm-content` rect。
  code 的模板是 `minmax(max-content, 1fr)`——左侧轨道的宽度是「gutter 自然宽」与「剩余空间的
  一半」中的较大者。因此判据分两档：**左侧余量的一半 ≥ gutter 自然宽**（1200px 定窗属此档）时，
  关掉 gutter 不移动正文；余量更小时（含正文列被压到栏宽以下），gutter 会撑宽左轨道、关掉后
  正文列左移一个 gutter 宽——这是模板的固有语义，本 change 不为它新增占位空条（见 §10 已知
  边界）。窄档的判据因此是「无横向滚动、行号不裁切、正文从 gutter 右缘起排」。

### 4.3 局部重配 ≠ 全量重建

沿用 M281 的选择：gutter 走独立 compartment，不重配 `modeCompartment`——后者会连带重建
live preview 与语法高亮的整批装配，代价高且扰动视口。`reconfigureGutter` 只重配 gutter 层。

## 5. 装配层：施加点、命令、按钮、持久化

### 5.1 `applyLineNumbers` 是唯一施加点

```ts
function applyLineNumbers(on: boolean): void {
  document.documentElement.dataset.lineNumbers = on ? "on" : "off";
  editor.setLineNumbers(on);          // 全部 doc pane（含后台会话）
  syncLineNumbersIndicator();         // 文案 / 显隐
}
```

- 启动装配块里调用一次（`snapshot.config.ui.line_numbers === "on"`），替换旧的
  `editor.setMarkdownLineNumbers(...)` 与 `currentMarkdownLineNumbers` 赋值。
- 运行期切换与启动施加都只经它；MUST NOT 出现第二处写 `data-line-numbers` 的代码
  （REVIEW.md「同一语义两处真源」条）。
- 首帧前（`src/boot.ts`）**不写**该属性：首帧没有编辑器，行号不可见；多一处写入者只会
  制造第二个真源。

### 5.2 `toggleLineNumbers` 是唯一切换路径

```ts
function toggleLineNumbers(): void {
  const next = currentLineNumbers(document.documentElement) === "on" ? "off" : "on";
  applyLineNumbers(next === "on");
  configSetUiValue("line_numbers", next).catch((e) => {
    toast(LINE_NUMBERS_SAVE_FAILED_TEXT(errorMessage(e)));
    logEvent("config_warning", { source: "line-numbers", message: errorMessage(e) });
  });
}
```

- 命令与 modeline 钮**直接调它**，不绕命令分发器（与 `cycleTheme` 同一条先例：两处入口
  一个实现）。
- 写回走通用合并写 `config_set_ui_value`（`src-tauri/src/commands.rs:643-690`）。写通道
  不校验取值，非法值由下次启动的 `validate()` 兜（与 `theme` / `language` 同款既有边界）。
- 写失败：toast + `config_warning` 诊断日志；运行期**不回滚**，开关保持已切换状态；toast
  文案说明「重启后将回到配置文件里的值」（措辞 MUST NOT 点名具体档位——写失败时前端说不出
  文件里到底是哪一档）。
- 开关是**全局持久偏好**（与 `ui.theme` / `ui.language` 同族），不按 pane、不按 vault。

### 5.3 新 pane 与重启

- 新 pane（`createPaneHandle`，`src/main.ts:437` 附近）不再读跟踪变量，改为
  `editor.setLineNumbers(currentLineNumbers(document.documentElement) === "on")`——从唯一
  运行真源读，pane B 与 pane A 同口径。
- 重启：启动块从 `snapshot.config.ui.line_numbers` 施加；配置文件缺失该键时默认 `off`。

### 5.4 语言切换后的重绘

`onRelabel`（`src/main.ts:3948-3956` 附近）追加 `syncLineNumbersIndicator()`：
- 可见文本是 `on` / `off` 读数，不译文；
- 悬停提示与读屏名取自文案表，必须随语言重取；
- 重绘 MUST NOT 重配编辑器（指示钮文案与 gutter 在场无关）。

### 5.5 状态行钮的 DOM 与位置

- `src/shell.ts` 新增 `.modeline-line-numbers` button，初始 `hidden = true`；
- 右段顺序：`modelineMeta` → `modelineVersion` → **`modelineLineNumbers`** → `modelineTheme`
  → `modelineLanguage`（主题 / 语言继续占最右，版本号退让段仍在 meta 之后）；
- 只在 `applyLineNumbers` 里 `hidden = false`（与主题钮同口径：宁可不显示，也不显示一个
  尚未生效的状态）。
- **`on` / `off` 等宽**：`off` 比 `on` 多一个字符；若按自然宽排版，切换会让右段其余元素整体
  位移。钮因此取 `min-width` 覆盖较长读数并居中，切换是状态变化、不是布局事件（判据：两种
  读数下钮 rect 宽相同、其它元素 rect 逐值不变）。
- 窄窗：520px 下右段全部元素在场、不溢出（版本号退让段此时也在场，是本行的压力面）；不给
  行号钮单独设隐藏档——它和主题 / 语言钮一样是常驻读数。

## 6. 命令与键位

- 命令 id：`view.toggle-line-numbers`。取 `view.` 前缀而不是 `editor.`：它改的是**应用
  运行期**的显示口径（与折行 / 字号 / 主题 / 语言 / 侧栏同族），作用域由
  `NON_TAB_GLOBAL_COMMAND_IDS` 机械派生为 `global`——焦点在左栏 / 搜索框 / 浮层 / harness
  composer 内时同样要能按。
- 有默认绑定，MUST NOT 进 `KEYLESS_COMMAND_IDS`；键位面板「全局」组经
  `NON_TAB_GLOBAL_COMMAND_IDS` 自动收纳，不需要改 `BINDING_GROUPS`（`D64.11` 组）。
- 默认键位 `⌘⇧N`，token `Cmd-Shift-N`（单段、无空白，`[keys]` 可重绑 / 解绑）。语义取
  N = Numbers，与既有 `⌘⇧T`（主题）/ `⌘⇧L`（语言）/ `⌘⇧O`（大纲）/ `⌘⇧A`（harness）同族。
- 键位占用的三条独立来源（结论必须写进绑定对象的 `doc`，表即文档）：
  1. **表内**：`src/keys.ts` 即真源，`Cmd-Shift-N` 不在现表（⌘⇧ 系现有 `Cmd-Shift-z` /
     `Cmd-Shift-o` / `Cmd-Shift-T` / `Cmd-Shift-L` / `Cmd-Shift-A` / `Cmd-Shift-,` /
     `Cmd-Shift-.`）。
  2. **原生菜单 accelerator**：muda 预置项集合（`⌘C / ⌘X / ⌘V / ⌘Z / ⇧⌘Z / ⌘A / ⌘M /
     ⌃⌘F / ⌘H / ⌥⌘H / ⌘W / ⌘Q`）不含 ⌘⇧N。
  3. **macOS 系统级**：本轮**尚未实机复核**（上一轮 `defaults export
     com.apple.symbolichotkeys` 只覆盖了当时表内既有键）。实现前 MUST 按同一条三条来源
     纪律补测并把结论写进 `doc`；若被系统占用，**停手上报 Alex 裁决**，MUST NOT 自行改成
     `⌘⇧G`（那个候选只是记录在案的备选，不是已批准的落槌值）。
- `COMMAND_META` 新增 `labelKey: "D972"` 与别名（`line numbers` / `line numbers toggle` /
  `gutter`）。`tests/unit/command-meta.test.ts` 的「键集与 COMMAND_IDS 逐项相等」会强制它
  在场。**`D972` 只承载短标签**；绑定的三来源说明另取一个独立的 `docKey`（`D_binding`，
  实现期按 deck 末位取号），MUST NOT 复用 `D972`——主题命令的 `D645`（短标签）/ `D311`
  （绑定来由）就是这条先例，一个键两种消费者会把短标签撑长或把说明截短。
- 专项单测（`tests/unit/keys.test.ts`，照 ⌘⇧T 的既有用例）：① 真实事件
  `{ key: "N", code: "KeyN", metaKey: true, shiftKey: true }` 经 `keyToken` 得到
  `Cmd-Shift-N`，与表内 token 相等；② binding 的 `scope === "global"`、命令在
  `NON_TAB_GLOBAL_COMMAND_IDS` 里、不在 `KEYLESS_COMMAND_IDS` 里；③ `docTextOf(binding)`
  同时含「表内」「muda / 原生菜单」「macOS」三段（不是仅非空）；④ `[keys]` 重绑与解绑各一条。
- 命令命中条件：无。行号开关与焦点 / 会话内容无关，`global` 作用域即全部语义。

## 7. 纯逻辑模块与文案

新增 `src/line-numbers.ts`（零 DOM 依赖的最小面，可在 `tests/unit` 直接加载，照
`src/theme.ts` 的分层）：

- `currentLineNumbers(root): "on" | "off" | null`——只读 `root.dataset.lineNumbers`；
  `null` = 未施加（不是第四档）。
- `nextLineNumbers(current: "on" | "off" | null): "on" | "off"`——`null` 按 `"off"` 取反。
- `LINE_NUMBERS_INDICATOR_LABEL(state: "on" | "off"): string` → 文案 `D_indicator`（实现期取号，
  含 `{state}`）。
- `LINE_NUMBERS_SAVE_FAILED_TEXT(reason: string): string` → 文案 `D_save_failed`（实现期取号，
  含 `{reason}`）。

文案表（`src/copy-data.ts` + `文案-Copy.md`）：`D972` 在起草期锁定（评审时 deck 的最大编号是
D971）；其余三键（`D_binding` / `D_indicator` / `D_save_failed`）在实现期按 deck 末位连续取号，
起草期只约定内容与顺序、不写死编号（deck 可能先被别的 change 占用）。

| 编号 | 用途 | 约束 |
|---|---|---|
| D972 | 命令**短标签**（`COMMAND_META.labelKey`，键位面板行） | 一句动词短语；en / zh 两档；MUST NOT 承载三来源说明 |
| `D_binding`（实现期取号） | 绑定的 `docKey`（三来源说明） | 必须含「表内」「muda / 原生菜单」「macOS」三段；MUST NOT 与 D972 共用 |
| `D_indicator`（实现期取号） | 指示钮悬停提示 / 读屏名 | 含 `{state}`；`{state}` 的取值是 `on` / `off` 读数本身，MUST NOT 译成中文（与 `light` / `dark` / `en` / `zh` 同族） |
| `D_save_failed`（实现期取号） | 写失败 toast | 含 `{reason}`；必须同时交代「已生效」「未写入」「重启回落到文件值」；MUST NOT 点名具体档位 |

编号纪律：`D972` 在起草期锁定为短标签（评审已确认 deck 末位可用）；其余三个键在实现期按
`文案-Copy.md` 的末位连续取号，起草期只约定内容与顺序、不写死编号（deck 可能先被别的 change
占用）。三者互不复用、也不与 D972 共用——同一个键被两个消费者读时，短标签与长说明必然互相
拉扯（主题命令的 D645 / D311 是分键的既有先例）。

### 7.1 改名通道的承接核对（`carryover.md`）

本 change 的两条旧 requirement 走 `REMOVED + 新名 ADDED`（原因见 delta 头部）。机器门禁在改名
通道**只查结构**：`scripts/openspec-archive-check.mjs` 对 REMOVED 只判「旧条在 living 里存在」、
对 ADDED 只判「不与 living 同名」，不比较旧块与新块的正文 / 场景；`--archived` 也只核新段落是否
落盘。因此它的 PASS 不能当作「无静默丢合同」的证据（对本 change 的口径就是
`0 条 MODIFIED / 对比 0 段`）。

`carryover.md` 补这段缺口：逐条列出两条旧块的正文段落（7 + 6）与全部场景（11 + 9）到新块的
映射，标明「逐字承接 / 改写 / 改名 + 改写 / 新增」。reviewer 出 verdict 前 MUST 逐项核对并在
结论里签字；`tasks.md` 的 10.2 把这一步写成归档前要件，MUST NOT 用门禁 PASS 替代。

## 8. 旧键清扫面（同一语义不留两处真源）

实现期 MUST 逐处改准；`openspec/changes/archive/**` 与其它活跃 change 的历史正文**不回改**
（归档件按 git 历史追溯）。清单：

- `src-tauri/src/config.rs`：模块头 `:41` / `:51-54`、`UiConfig` 字段与注释、`Default`、
  枚举、`RawUiConfig`、`validate`、单测 `:5136-5194`。
- `src/bindings/UiConfig.ts`（重生成）、`src/bindings/LineNumbers.ts`（新增）、
  `src/bindings/MarkdownLineNumbers.ts`（删除）。
- `src/editor.ts`：`:44` import、`:1540-1554` 契约注释、`:1714-1724` compartment、
  `:1870-1879` 实例状态、`:2201-2214` 装配注释、`:2227-2279` helper、`:3505-3526` setter。
- `src/main.ts`：`:16` import、`:282` 跟踪变量、`:437` 新 pane、`:1087-1090` 广播、
  `:1477-1480` 跳转联动、`:4476-4484` 启动块。
- `src/scroll-position.ts:45`、`src/scroll-position-view.ts:84`（两条注释引用旧键）。
- `src/shell.ts`、`src/style.css`（新增钮；旧注释不涉及键名）。
- `tests/unit/error-text.test.ts:397`（log-only 列表）、`tests/unit/pane-state-migration.test.ts:206`
  （compartment 名字守卫）。
- 视觉层：`tests/visual/scenes/m281-goto-line.spec.ts:386-630`、
  `gutter-copy-path-line.spec.ts:179-424`、`tauri-stub.ts:206-210` / `:585-588`、
  `m130-text-open-trap.spec.ts:90`、`markdown-parser.spec.ts:113-119`、
  `end-marker.spec.ts:286` / `:549-569`（用 `.cm-lineNumbers` 当 code 模式判据——默认 off 后
  判据失效，必须换信号或显式开行号）。
- 验收层：`scripts/acceptance/lib/execute.mjs:536-542` / `:4444-4446`、`lib/app.mjs:204-289`、
  场景 `56-goto-line.md`、`707-gutter-copy.md`、`COVERAGE.md:90` / `:248`。
- 文档：`docs/specs/config-reference.md:90-113`、`:454`、以及 §3 的运行期回写键清单（补
  `ui.line_numbers`）。

## 9. 测试矩阵

| 层 | 判据 |
|---|---|
| Rust 单测 | 缺失 → `Off`；`"on"` / `"off"` 各自生效；非法值 → `Off` + `ui_line_numbers_invalid`；旧键携带**非 `null` 值**（如 `"always"`）→ `ui_markdown_line_numbers_retired` 且生效值不受其影响（`"markdown_line_numbers":"always"` + 无新键 ⇒ `Off`；+ `"line_numbers":"on"` ⇒ `On`）；**显式 `null` → 不告警、生效值按新键 / 默认**；`"line_numbers": 2` 整文件回落；旧键类型错不拖垮整文件 |
| TS 单测 | `line-numbers.ts` 的当前值 / 取反 / 两档文案；`keys` 三项对账（新命令有绑定、不在 keyless、清单无幻影）；`command-meta` 键集相等；`bindings-panel` 归组自动覆盖；`error-text` 两个新 code 的登记 |
| 视觉（chromium） | 默认 `off`：md / code 打开都无 gutter；`⌘⇧N` 切到 `on`：两种模式都出现、行号 = 源行号、当前行高亮；再切回 `off`：都消失；`off` 下 `⌥G` 临时出现、四条收起路径都卸除（md / code 各一轮）；`on` 下输入条开 / 关不改在场；**交叉态两个方向**（`on → ⌥G → 切 off` 收起后才消失；`off → ⌥G → 切 on` 收起后仍常驻）；**非编辑器焦点**的 `⌘⇧N`（搜索框、harness composer 各一次）；双 pane 同步 + 后台标签切回仍是新态；新 pane 继承；`__uiValueWrites` 断言写回 `{key:"line_numbers"}` 与值；写失败注入 → 不回滚 + toast + 日志；重启（桩重载配置）后用配置值；非法值与旧键 warning（显式 `null` 不告警）；指示钮三主题形态 + 520px 不溢出；`.cm-content` 实测 rect：md 1200/640 两档逐值不变、code 1200 逐值不变、code 640 无横滚 / 无裁切；gutter 不在场时右键无复制、无反馈 |
| 真机（WKWebView） | **在场上限的 oracle = 行号 gutter 右键复制**：剪贴板拿到 `{path}:{line}` ⇒ gutter 在场；在旧 gutter 位置右键拿不到 ⇒ 不在场（AX 读不到 gutter，线宽 / 元素都不在 AX 树）。`⌘⇧N` 切 on / off 后各验一次（md 与 code），指示钮点击一次，`off` 下 `⌥G` 临时 gutter 再右键一次；**交叉态至少一条**：`on` 下 `⌥G` 后切 `off`，右键 oracle 仍成功、Escape 后恢复失败；重启后读 `config.json` 的 `[ui] line_numbers` 断言持久化；改配置为 `on` 重启后首帧即有 gutter（右键 oracle） |
| 基线 | 默认 `off` 同时改两件事：code 失去常驻 gutter，**modeline 右段多一个常驻钮（`off` 时也显示）**。复核面 MUST 包含：`tests/visual/scenes/modeline.spec.ts` 的右段文本断言与 `modeline-bar.png` 元素基线；`tests/visual/scenes/titlebar-identity.spec.ts:196-214` 的右段拼接口径（现行正则只匹配前缀，新钮加入后会继续绿但不再证明完整拼接）；`m281-md-gutter` / `m281-goto-prompt`；以及**全部含 modeline 的整页截图**（不只 code 场景）。基线更新是 **Alex 人肉裁决点**：先出 diff 送审，过目后才 `--update` |

## 10. 风险与已知边界

1. **code 的几何让位边界**（上文 §4.2）：code 的左侧轨道是 `minmax(max-content, 1fr)`，当窗口的
   左侧余量不足一半容不下 gutter（含正文列被压到栏宽以下）时，关掉 gutter 会让正文列左移约
   一个 gutter 宽。本 change 不新增占位空条（空行号槽会变成常驻视觉噪声）；判据改为「无横向
   滚动、行号不裁切、正文从 gutter 右缘起排」。若 Alex 要求所有宽度都零跳动，另立视觉 change
   （保留固定宽度的占位轨道），不在本 change 内自行加。
2. **`⌘⇧N` 的系统级占用未复核**：实现前补测；冲突则停手上报（§6）。
3. **默认 `off` 对 code 用户是一次行为变化**：这是 Alex 明确裁决的代价（阅读面优先，代码用户
   按一次快捷键即恢复且持久化）。文档与 toast 不得把它说成「回归」或「bug」。
4. **旧键的退场 warning**：携带非 `null` 值时它进 `ConfigSnapshot.warnings`，每次启动都会出现，
   直到用户删掉该值；显式 `null` 与键缺席同义、不告警。这是有意的——静默忽略一个非 `null` 的旧值
   会让用户以为键还生效。
5. **临时 gutter 与右键复制的交互**：`off` 档临时 gutter 由输入条带出，右键的 `mousedown`
   默认行为已被消费（change `gutter-copy-path-line-nov21` 的既有实现），临时 gutter 不会在
   `focusout` 中先被卸除。本 change 不改这条路径，但真机场景要覆盖它（`off` + `⌥G` + 右键）。
6. **两份活跃 change 的同文件冲突**：`improve-keybindings-lookup-oct24` 与
   `fix-escape-overlay-close-oct24` 仍活跃，改 `src/keys.ts` / `src/command-meta.ts` /
   `src/bindings-panel.ts` 前需按真实文件集核对依赖；本 change 的实现排在这两者之后或
   明确串行（不影响本提案的 delta：它只重写行号相关的两条 requirement 并新增一条，不触碰
   `improve-keybindings` 改的「键位查看面板」条）。
7. **临时 gutter 的 pane 归属保持现状**：`onVisibilityChange` 目前经复合句柄广播到**全部**
   doc pane（`src/main.ts:1477-1480` 的 `forEachEditor`），因此双 pane 下打开跳转输入条时，
   另一个 pane 也会临时显示 gutter，直到输入条收起。本 change 的语义是「开关是全局的」，
   不改这条广播路径（改成只有属主 pane 临时显示需要另立行为裁决）；双 pane 的断言只覆盖
   持久开关的同步，临时 gutter 的 pane 归属按现状记录、不作为本 change 的判据。
