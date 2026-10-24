# Design: 键位速查——内容模型、查找/捕获、键盘与视觉

- Change ID: `improve-keybindings-lookup-oct24`
- 日期: 2026-10-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）
- 原型: `design/prototypes/keybindings-lookup-oct24.html`
- 机器断言: `.local/reviews/keybindings-lookup-oct24/assert.mjs`（红/绿输出同目录）
- 依据: `.local/reviews/settings-lookup-patterns-oct24.md`（M694 survey，只读，零改动）

## 0. 一句话

**保留就地遮罩外壳，把「一条绑定一行」的调试表换成「一条命令一行」的速查视图**：人类标签 + 多键合并 +
scope / `when` 徽标；一个输入框同时承担文本查询与按键捕获；来由、原始 token、命令 id 移进行详情；
Help 菜单补一个不带加速键的非自指入口。分页、11 族页签、键位编辑都不做。

## 1. 现状与设计边界

### 1.1 现有面板是什么

`src/bindings-panel.ts:1-2` 自述为「dogfood 期的自用查看器……不是 UX 重设计的一部分，只回答一个问题
『某个键现在归谁』」。它的三列（`src/bindings-panel.ts:134-149`）是：

| 列 | 内容 | 为谁服务 |
|---|---|---|
| key | 原始 token（`Ctrl-Alt-KeyS`） | 排查 `[keys]` 配置 |
| command | 内部 id（`editor.focus-block-scroll`） | 排查 `[keys]` 配置 |
| doc | 维护者来由（含 change 名、mission 编号、机制说明） | 解释「为什么是这个键」 |

它按**绑定**渲染、每条绑定一行（`src/bindings-panel.ts:151-182`）：71 命令 / 77 绑定 / 82 行 / 11 组；
首屏 13 行（1200×800 基线）；全表约 10–15 屏（survey §1.3 的估算口径）。它没有人类标签、没有 scope / `when`、
没有查询或捕获、键盘不能滚（焦点在不可滚动的 panel 上，滚动容器是它的子元素）、`Tab` 被锁死、唯一入口是
`⌘/` 且这个键只写在面板自己里面。

### 1.2 本次只动「读」，不动「写」

| 维度 | 本次 | 不做 |
|---|---|---|
| 行单位 | 一条命令一行；同命令多键合并 | 一条绑定一行 |
| 内容 | 人类标签（中英）、scope、`when`、未绑定成因 | 维护者来由继续占行 |
| 查找 | 文本（标签 / 别名 / id）+ 按键捕获 | 模糊匹配、拼音、排序打分 |
| 浏览 | 功能族分组 + 折叠 + 作用域筛选 | 分页、11 族页签 |
| 详情 | 行内手风琴：来由 / 原始 token / id / scope / 条件 | 独立详情页、第二栏 |
| 写 | 零；`[keys]` + 重启 | 键位编辑、冲突视图、回滚 |
| 外壳 | 既有遮罩、680px、三主题 token | 独立设置窗口、`⌘,`、设置爆炸 |
| 入口 | Help 菜单项（无加速键）+ 既有 `⌘/` | modeline 常驻按钮（D1 备选） |

**S15 / S16 的关系**：680px 三列是 2026-09-25 为「排查自定义 `keys`」保留的调试视图。本 change 不删调试信息，
只是把它移进行详情（原始 token、命令 id、来由）；主行腾出来给速查。680px 与三主题 token 不变。

### 1.3 模态边界：为什么不用原生 `<dialog>`

现有 spec 的模态边界是**局部的**：面板只挡 editor 作用域，global 键照常分发（面板开着按 `⌘F` 会打开搜索，
`⌘P` 打开快速打开，`⌘W` 关标签；`openspec/specs/keymap-commands/spec.md` 的「键位查看面板」段与 survey §1.4）。
原生 `<dialog>` 的 `showModal()` 会把背景设为 inert，global 键打开的搜索 / 快速打开面将不可聚焦、不可用——
那是对既有行为的回归。

因此本 change **保留自定义遮罩**，并显式实现：

- `Tab` / `Shift+Tab` 在面板控件之间循环（四停，空态动作钮可见时追加），焦点不逃出；
- 点击遮罩关闭、点击面板本体不关闭；
- global 键仍由 window 上的分发器处理（面板消费的键 `preventDefault`，分发器对已消费事件让路）；
- 捕获等待态是唯一「消费所有键」的状态（见 §3.3）。

代价（明说）：自定义遮罩不享受原生 dialog 的自动 inert。面板打开时，屏幕阅读器的虚拟光标仍可能读到背景；
`aria-modal="true"` 与「global 键仍分发」本来就不完全一致，这是既有口径，本 change 不扩大也不修复它。
真机验收要用 VoiceOver 读一遍面板与列表（见 §7）。

## 2. 数据模型与单一来源

REVIEW.md「同一语义两处真源」条：**标签、scope 文案、`when` 文案、token 字形各只能有一份**。
面板只负责渲染，不逐条硬编码命令文本。

### 2.1 `COMMAND_META`（新模块 `src/command-meta.ts`）

```ts
export interface CommandMeta {
  /** 人类标签：住文案表（文案-Copy.md + src/copy-data.ts），中英两列必填。 */
  labelKey: CopyKey;
  /** 标签模板的插值参数（只有 tab.goto-N 这类带序号的命令用）。 */
  labelParams?: Record<string, string | number>;
  /** 搜索专用别名；不上屏、不要求中英成对、可选。 */
  aliases?: readonly string[];
}

export const COMMAND_META: Record<CommandId, CommandMeta>;
export const SCOPE_LABEL_KEYS: Record<KeyScope, CopyKey>;      // 全局 / 编辑器 / 文本
export const SCOPE_DESCRIPTION_KEYS: Record<KeyScope, CopyKey>; // 详情里的一句解释
```

- **键集 = `COMMAND_IDS`**：类型用 `Record<CommandId, …>` 把「漏写」变成编译期错误；单测再做一次运行期对账
  （键集相等、无幻影、每个 `labelKey` 在 `COPY` 里、每个标签在 zh / en 下都非空、模板参数齐全）。
- **为什么另开模块**：`keys.ts` 是分发表（token → 命令、scope 派生、覆盖应用），不是 UI 元数据；它已经 1100+ 行。
  命令清单仍只有 `COMMAND_IDS` 一份，元数据以它为键，不是第二份命令清单。
- **标签住文案表**：`t()` 的取值链、`onRelabel` 的重绘链、`文案-Copy.md` ↔ `copy-data.ts` 的全量漂移门禁全部复用。
  71 条命令 × 中英两列是本 change 最大的文案工作量；新增命令漏写标签由单测在引入它的那次改动里红。
- **别名只进搜索**：例如 `toc.toggle` 的「目录 / outline」、`app.describe-bindings` 的「快捷键 / keybindings」。
  两列标签**始终都进语料**（zh 界面也能打英文 `outline`），所以别名只为「标签里没有的同义词」而写，不追求覆盖。
  别名文本不是上屏文案，住 `command-meta.ts`，按既有 AST 门禁标 `// i18n-exempt: data`。
- **不做**：把标签塞进 `KeyBinding`（未绑定命令没有 binding）；让面板按命令 id 查一份 `Record<string,string>` 字面量
  （第二份真源）；从 `doc` 里截取第一句当标签（来由不是描述，且不可翻译）。

### 2.2 `whenKey`（`src/keys.ts` 的 `KeyBinding` 增补）

```ts
export interface KeyBinding {
  // …既有字段…
  /** `when` 的人类说明；与 `when` 同生同灭（单测对账）。 */
  whenKey?: CopyKey;
}
```

- 今天的 5 条块级横滚容器绑定共用同一个 `when` 函数；面板不能把一个函数渲染成人话，也不能在面板里另写一份条件描述。
  给这些绑定补 `whenKey`（一条共用文案），面板只读 `whenKey`。
- 不变量（单测）：对 `KEY_BINDINGS` 的每条绑定，`when !== undefined` ⇔ `whenKey !== undefined`。
  `applyKeyOverrides` 合成的绑定两者都没有，不参与该断言。
- `when` 的语义不变（命中条件、scope 判定都不动）；`whenKey` 只是可见说明。

### 2.3 字形（新模块 `src/key-glyphs.ts`）

```ts
/** token → 人类字形；复用 keys.ts 的 normalizeKey 归一化。 */
export function glyphOfToken(token: string): string;
```

规则：

1. **修饰键顺序取 Apple HIG 的 `⌃⌥⇧⌘`**（Control, Option, Shift, Command），如 `⇧⌘O`、`⇧⌘T`、`⌃⌥S`。
   这与 macOS 系统菜单的写法一致；实现批只改**生成字形**，不手改全仓散文里的旧写法。
2. **需要 Shift 才能打出的字符反解成物理键**（`SHIFT_IMPLIED` 集合与 `keys.ts` 同源）：
   `Cmd-}` → `⇧⌘]`、`Cmd-{` → `⇧⌘[`、`Cmd->` → `⇧⌘.`、`Cmd-<` → `⇧⌘,`、`Ctrl-_` → `⌃⇧-`、
   `Cmd-+` → `⇧⌘=`、`Cmd--` → `⌘-`。用户按的是物理键；直接显示 `}` / `<` 会让人找错键。
3. 具名键映射：`ArrowUp/Down/Left/Right` → `↑↓←→`、`Tab` → `⇥`、`Escape` → `Esc`、`Backspace` → `⌫`、
   `Delete` → `⌦`、`PageUp/PageDown` → `PgUp/PgDn`、`Space` → `Space`；`KeyS` / `Digit1` 去前缀。
4. 单字符键大写；含 Alt 的组合按物理键名（`Alt-KeyS` → `⌥S`，与分发层的 `event.code` 口径同源）。
5. 未知键名原样显示；含空白的多段 chord 本版不支持（`[keys]` 也拒绝），不造伪字形。

单测矩阵（必须含反向区分度）：

| token | 期望字形 | 它守什么 |
|---|---|---|
| `Ctrl-Alt-KeyS` | `⌃⌥S` | Alt 物理键 + 顺序 |
| `Shift-Cmd-o` | `⇧⌘O` | Apple 顺序 |
| `Cmd-}` / `Cmd-{` | `⇧⌘]` / `⇧⌘[` | SHIFT_IMPLIED 反解 |
| `Cmd->` / `Cmd-<` | `⇧⌘.` / `⇧⌘,` | 同上 |
| `Ctrl-_` | `⌃⇧-` | 同上 |
| `Cmd-+` / `Cmd-=` | `⇧⌘=` / `⌘=` | 字符 vs 物理键 |
| `Alt-Backspace` | `⌥⌫` | 具名键 |
| `Ctrl-Shift-Tab` | `⌃⇧⇥` | Shift + 具名键 |
| 全部默认 token | 不含 `Cmd-` / `Ctrl-` / `Alt-` / `Shift-` / `Key` / `Digit` 字面 | 没有 token 泄漏给人 |

### 2.4 行聚合

- `groupBindingsByCommand(effectiveBindings)`：`Map<CommandId, KeyBinding[]>`，键序 = 生效表里首次出现的顺序；
  同一命令的多个 token 保持表内顺序（不排序、不去重——重复 token 在装配期已被拒）。覆盖产生的新 token 追加在末尾。
- 行集 = `COMMAND_IDS` 按 `BINDING_GROUPS` 分组；组与组序不变（11 组 + 零兜底「其他」）。未绑定命令仍是行。
- scope 取 `scopeOfCommand(command)`（`src/keys.ts` 的单一来源），不读 `binding.scope`——覆盖产出的绑定 scope
  也是派生的，两处读会漂。
- `when` 取该命令绑定上的 `whenKey`；一行只显示短徽标，详情显示全文。
- 未绑定：无生效绑定。成因复用 `KEYLESS_COMMAND_IDS` 判定（默认不占键位 vs 配置解绑），文案复用 D66.1/D66.2；
  详情给出 `[keys]` 的绑定方法（合成示例，不读用户真实配置）。

### 2.5 搜索语料

```ts
const corpus = (cmd) => [cmd.label.zh, cmd.label.en, ...cmd.aliases, cmd.id].join(" ").toLowerCase();
```

- 匹配语义**复用** `src/list-filter.ts` 的 `filterIndices` / 大小写折叠子串：不重排、不打分、不高亮、不做前缀/模糊。
  `list-filter` 的「匹配对象是显示文本」契约属于 toc / vault 两个浮层；本面板传的是**自己的语料数组**，
  不改变那两个浮层的语义。
- **来由不进语料**（`doc` / `docKey` 文本只在详情）。survey 的读数：来由里的「M447」命中 24 条；
  `toc.toggle` 来由里的「已删除」让「删除」误命中 1 条。把来由放进语料会让查询结果被维护者术语淹没。
- 分组标题、scope 名不进语料（避免「标签」这类词把所有组都拉进来）；用户打的词应落在命令标签/别名/id 上。
- 空查询 = 全量；作用域筛选先于查询；捕获结果再经过作用域筛选（见 §3.3 的例外：进入捕获时把作用域重置为全部）。

## 3. 交互模型

### 3.1 外壳与布局

保留 `.lumir-bindings-overlay` / `.lumir-bindings-panel` 的壳配方（`--preview-bg` + 1px `--border` +
`--shadow-raise` + `--r10`；eink 1.4px 边框、无阴影）。面板仍 680px 宽、`max-height: min(780px, 100%)`；
遮罩 padding 取既有 `--sp-12`（40px）；z-index 沿用 20。

垂直结构（固定行 + 唯一滚动区）：

```
panel
├─ header        标题「键位速查 生效中 · 含 [keys] 覆盖」+ 右对齐计数
├─ search        输入框 + 「捕获按键」；捕获等待/已捕获在下一行给状态
├─ scope         「全部 / 全局 / 编辑器 / 文本」单选组
├─ body          ← 唯一滚动容器（保留 .lumir-bindings-body 类名，滚动条登记不变）
│  ├─ group      sticky 组头（可折叠）+ 行
│  └─ empty      空态（查询 / 捕获 / 作用域三种成因）
└─ hint          ↑↓ 选择 · Enter 详情 · Tab 切换焦点 · PageUp/Down 翻页 · Esc 清除/关闭 · ⌃G 关闭
```

- **`.lumir-bindings-body` 继续是滚动容器**（`tests/unit/scrollbar-registry.test.ts` 的 `native-overlay` 档）；
  给它 `tabindex=0`，让键盘滚动有真实的焦点宿主（旧面板的缺陷正是焦点在不可滚动的 panel 上）。
  不新增第二个 overflow 容器：详情行内展开、长文 `overflow-wrap:anywhere`，代码片段 `white-space:pre-wrap`。
- 组头 `position: sticky; top: 0`，背景 `--preview-bg`，滚动时保持组名与计数可见。
- 每行一条命令；键位 chip 在标签右侧、scope 徽标最右；多键时 chip 允许换行（生产 71 条命令里最多 4 个键，
  正常单行）。
- 详情展开在行下方，一次只开一个（手风琴）；不改变列表滚动位置。

### 3.2 文本查询

- 真 `<input type="text">`，显式 `<label class="visually-hidden">`；`role=combobox`、`aria-controls` 指列表、
  `aria-activedescendant` 指当前行。输入即筛；空查询 = 全量。
- IME：`compositionstart` 置位，`compositionend` 补一次渲染；`input` 事件在 `isComposing` 或组合期直接返回；
  `keydown` 在 `isComposing` / `keyCode === 229` 时让路。与 `src/quick-open.ts:560-573` 同款。
- 查询变化：清空手动的折叠覆盖（匹配组自动展开），滚动回顶部；详情若不再可见则关闭。
- 计数与空态（见 §3.6）。
- 查询是瞬态：打开 / 关闭面板都回到空查询，不写 `config.json`、不跨会话记忆。

### 3.3 按键捕获

**进入方式（D4）**：显式按钮「捕获按键」，不做「按下修饰键就自动捕获」。理由：面板打开期间 global 键
仍照常分发（既有 spec 边界），自动捕获会把 `⌘F` / `⌘P` 静默吞掉；黑名单会长期漂移。

**等待态**：

- 输入框 `readOnly`，占位文案「按下组合键…」；按钮变「取消捕获」；下一行提示「按下组合键…（Esc 取消）」。
- 遮罩的 keydown 消费所有非纯修饰键：`preventDefault` + `stopPropagation`，**不执行任何命令**；
  用 `keyToken` / `normalizeKey` 同源归一化（含 Alt 组合走 `event.code`）。
- **Esc 是唯一退出键**。`⌃G` 在这一个状态下被当作待查询的键捕获（否则 `⌃G` 永远无法反查），`⌘/` 同样被捕获；
  这是捕获态的唯一例外，spec 会写明。
- 纯修饰键（⌃ / ⌥ / ⇧ / ⌘ 单独按下）不构成一次捕获。
- 进入捕获时把作用域筛选重置为「全部」：捕获问的是「这个键归谁」，不应被当前筛选藏掉答案。
- 无绑定 token → 空态「没有命令使用这个键位」，提示换一个键或文本搜索。

**已捕获态**：

- 输入框旁显示字形 chip（如 `⌃⌥S`）+「清除」；结果只剩该 token 的生效命令（若被 `[keys]` 解绑则无结果）。
- 结果行显示命令、scope、`when` 短徽标；详情显示 `when` 全文与原始 token。
- 打印字符 → 退出捕获、转入文本查询（输入框接住字符）；再按带修饰键的组合 → 重新捕获；
  Esc → 清除捕获但面板保持打开；`⌃G` / 当前 `app.describe-bindings` 键 → 关闭面板。
- 捕获不持久化；关闭 / 重开清空。

**为什么能保证「捕获的键不执行」**：遮罩 keydown 先于 window 分发器，捕获态 `preventDefault` + `stopPropagation`；
window 分发器本身也检查 `defaultPrevented`。真机验收要用「同键在面板关闭时确实执行、捕获时不执行」的反例复验
（原型的 assert.mjs 已有这一条：`⇧⌘T` 在面板关闭时切主题，捕获时不切）。

### 3.4 分组 / 折叠 / 作用域

- **组**：沿用 `BINDING_GROUPS` 的 11 个功能族与组序，不按使用频率重排（没有使用数据；重排会打断肌肉记忆）。
  「其他」兜底组仍由单测保证为零。
- **折叠**：组头是 `<button aria-expanded>`，默认展开；点击切换。键盘用户在列表焦点下用 `←` / `→` 折叠 / 展开
  当前活动行所在组。组头 `tabindex=-1`，不占 Tab 停靠点；屏幕阅读器的浏览模式仍可找到并激活它。
  （这是可访问性上的取舍：四停 Tab 优先；真机用 VoiceOver 复核，见 §8。）
- **查询 / 捕获时**：匹配组自动展开，手动折叠是临时的，下一次查询变化即清空；清查询后恢复空查询下的手动折叠状态。
- **作用域筛选**：`全部 / 全局 / 编辑器 / 文本` 是**单选筛选**，不是页签：`role=radiogroup` + roving tabindex，
  `←→↑↓` / Home / End 切换，Tab 只停在选中项。筛选即时生效、不换页、不记入历史。
  `全部` 是默认；筛选后组内计数与总计数一起更新；无行的组隐藏。
- **不做**：分页、11 族页签、按 scope 的三页签、which-key（本仓没有多段 chord）。

### 3.5 详情

- 行内手风琴，一次只开一个；`Enter`（列表 / 输入框）或点击行切换；`aria-expanded` + `aria-controls`。
- 内容：中英标签、命令 id、scope + 一句人话、`when` 全文或「无」、原始 token（调试）、来由（`docKey` 的文本；
  配置覆盖时为 D320）、未绑定成因 + `[keys]` 绑定示例。
- **来由只在这里出现**，不进主搜索语料。
- 详情没有可聚焦控件，不形成新的 Tab 停靠点；长文换行，不做嵌套滚动条。

### 3.6 计数与空态

- 计数（`aria-live="polite"`，实现批做 ~150ms 去抖，避免逐键播报）：
  - 空查询：`71 条命令 · 11 组`；
  - 查询：`命中 N / 71`；
  - 捕获：`按键 ⌃⌥S · 命中 N`；
  - 作用域筛选参与分母/组数计算。
- 空态按成因给不同标题与下一步：
  - 查询：「没有匹配的命令」+ 查询串 + 「试试命令标签、别名或 id」+ 清除 / 捕获按钮；
  - 捕获：「没有命令使用这个键位」+ 换键 / 文本搜索提示；
  - 作用域：「这个作用域下没有命令」+ 切回全部提示。
- 首屏不再是「看起来就是全部」：计数 + sticky 组头 + 半行滚动线索 + 可用的键盘滚动共同解决 survey §1.2 的线索缺陷。

### 3.7 键盘模型（完整表）

| 焦点 | 键 | 行为 |
|---|---|---|
| 输入框 | 可打印字符 / IME | 更新查询；组合期不刷新 |
| 输入框 | `↓` / `⌃N` | 下一行；`↑` / `⌃P` 上一行（活动行） |
| 输入框 | `Enter` | 展开 / 收起活动行详情（无活动行时先落第一行） |
| 输入框 | `Tab` / `Shift+Tab` | 捕获按钮 / 列表（反向回绕） |
| 输入框 | `PageUp` / `PageDown` | 列表翻页（真实滚动） |
| 捕获按钮 | `Enter` / `Space` | 进入 / 取消捕获 |
| 作用域组 | `←→↑↓` / `Home` / `End` | 切换选中作用域（即时筛选） |
| 列表 | `↑↓` / `⌃N⌃P` | 移动活动行；夹在首尾，不环绕 |
| 列表 | `Enter` / `Space` | 展开 / 收起活动行详情 |
| 列表 | `←` / `→` | 折叠 / 展开活动行所在组 |
| 列表 | `Home` / `End` | 第一行 / 最后一行 |
| 列表 | `PageUp` / `PageDown` | 列表翻页 |
| 列表 | `Tab` / `Shift+Tab` | 输入框 / 作用域组 |
| 捕获等待 | 任意非纯修饰键 | 捕获该 token；不执行命令 |
| 捕获等待 | `Esc` | 取消捕获（面板保持打开） |
| 捕获已定 | `Esc` | 清除捕获（面板保持打开） |
| 任意 | `⌃G` | 关闭（捕获等待态除外——它被当作待查询键捕获） |
| 任意 | `app.describe-bindings` 的当前生效键（默认 `⌘/`） | 关闭（由分发器执行命令；面板不硬编码 `⌘/`） |
| 空态 | `Tab` | 输入框 → 捕获 → 作用域 → 清除 → 捕获按钮（空态动作） |

- **Esc 分层**：捕获等待 → 取消；已捕获 → 清除；查询非空 → 清查询；否则关闭。关闭后调用注入的
  `restoreFocus()`（`editor.focusPreservingReadingPosition`），不裸 `editor.view.focus()`。
- **Tab 四停**：输入框 → 捕获按钮 → 作用域选中项 → 列表 → 回输入框；`Shift+Tab` 反向。空态动作钮可见时追加。
  焦点不逃出面板；旧面板「Tab 锁死」的理由（没有可聚焦子元素）已过时，spec 同步改。
- **键盘滚动**：列表获得焦点后，浏览器原生的 PageUp/Down / Home/End 可用；`←/→` 用于折叠，故 Home/End 由面板
  显式处理为「首/末行」（不抢滚动到顶/底的浏览器默认）。PageUp/Down 由面板显式滚动（`scrollTop ± 0.88 × 视口高`）。
- **IME**：组合期不刷新；`compositionend` 补一次。
- **global 键**：面板打开时仍分发（既有边界）。面板消费的键（Tab / Esc / 方向 / Page / Home / End / Enter / Space）
  都 `preventDefault`，分发器让路；捕获态额外 `stopPropagation`。

### 3.8 打开 / 关闭 / 焦点

- 打开：焦点进输入框（不是面板容器）；空查询、全量、默认全展开；滚到顶。
- 关闭：点击遮罩 / Esc 分层 / `⌃G` / 当前 `app.describe-bindings` 键 / 菜单项（toggle）——焦点交还编辑器。
- 重开：查询、捕获、详情、活动行、滚动位置全部重置；作用域筛选与手动折叠是否保留？**作用域重置为全部、
  折叠重置为全展开**——每次打开都是一张干净的速查表；减少「我上次筛过所以看不到」的陷阱。
- 面板打开时再按菜单项：关闭（与命令同一 toggle 语义）。

## 4. 视觉保真（原型 → 实现的对账口径）

原型是**方向稿**，不是逐像素合同；核对用并排截图（原型 vs 实现），按「观感一致」判断。
以下值是原型中已落地的口径，实现优先映射到既有 token，不新增色值 / 字号 / 圆角。

### 4.1 布局节奏

| 元素 | 值 | 说明 |
|---|---|---|
| 遮罩 | `fixed inset 0`；padding `--sp-12`（40px）；`--scrim` | 沿用既有 overlay |
| 面板 | 680px 宽；`max-height: min(780px, 100%)`；padding `--sp-9 --sp-10 --sp-8` | 680 是 S15/S16 的既有裁决 |
| 标题行 | 标题 15px，计数右对齐 10.5px；行下 12px | 计数 `tabular-nums` |
| 搜索行 | 输入框高 30px；按钮高 26px；gap 8px | 输入框底线 1px，focus 转 `--accent` |
| 作用域行 | 按钮高 22px；gap 3px；行下 8px | 选中项有一档 `--hover` 底 + 1px 边框 |
| 列表 | 上边框 1px `--border-soft`；顶部 2px / 底部 8px 内边距 | 唯一滚动容器 |
| 组头 | 高 24px；sticky；组名 10.5px / 650 / 0.08em；计数右端 | 背景 `--preview-bg` |
| 行 | 最小高 28px；padding 2px 4px；列 gap 10px | 标签 1fr / 键位 auto / meta auto |
| 键位 chip | 高 18px；padding 0 5px；gap 4px；11px mono | 可换行，不截断 |
| 详情 | padding 8px 10px 10px 12px；左边 2px `--border` | 不新增滚动 |
| 底部提示 | 上边框 1px；10.5px；行高 1.6 | 关闭提示与键盘提示合并 |

### 4.2 卡片 / 气泡样式

- 面板壳 = tokens v1.1 的浮层配方：`--preview-bg` 底、1px `--border`、`--r10`、`--shadow-raise`；
  eink 边框 1.4px、无阴影（`--shadow-raise: none`）。
- 输入框不另造「搜索框」形态：沿用快速打开 / 大纲浮层的**下划线输入**语汇（1px 底线，focus 转 `--accent`）。
- 键位 chip 取「等宽字 + 1px 边框 + r4」；未绑定 chip 用 `--accent` 虚线边框 + 文案「未绑定」。
- 组头、行、详情都不加卡片阴影 / 渐变 / 圆角堆叠；hover 只换一档底色。

### 4.3 字层级

| 层级 | 字号 / 字重 | token |
|---|---|---|
| 面板标题 | 15px / 650 | `--fs-body` / `--fw-bold` |
| 计数 / 作用域 / 组头 / 条件 / 提示 | 10.5px / 400–650 | `--fs-micro` / `--fs-label` |
| 行标签 | 13px / 400 | `--fs-body-s` 附近（实现取现有正文档） |
| 键位 chip / 原始 token / 代码 | 11px / 400 mono | `--font-mono` |
| 详情正文 / 来由 | 12px / 400，行高 1.65 | `--fs-meta` |

### 4.4 各状态

| 状态 | 视觉 | eink |
|---|---|---|
| 行 hover | `--hover` 底 | 同（明度差） |
| 活动行 | `--sel` 底，`aria-selected=true` | `--sel` = #b9b9b9，黑字 |
| 列表焦点 | 2px `--accent` outline + 2px offset | 2px 黑 outline |
| 输入框焦点 | 底线转 `--accent`（1px；eink 2px） | 黑底线 |
| 捕获等待 | 按钮 `aria-pressed=true`；虚线提示行 | 黑框 + 黑字，无浅色底 |
| 已捕获 | 字形 chip + 清除；计数换「按键 … · 命中 N」 | 同 |
| 未绑定 | 虚线 `--accent` chip | 黑虚线 |
| 条件 | 短徽标「仅块滚动」；详情全文 | 同 |
| 详情 | `--frame` 底 + 2px 左边框 | 黑左边框 |
| 空态 | 居中标题 + 说明 + 两个动作钮 | 同，无灰底 |
| 禁用 / 不可用 | 不使用 `disabled` 隐藏可学习项；未绑定行仍可聚焦/展开 | 同 |

- **动效**：零。面板出现 / 消失即时，与既有遮罩一致；不加入场动画、不做抽屉滑动。
- **阴影**：仅面板壳用 `--shadow-raise`；eink 无阴影。行、chip、详情不加阴影。

### 4.5 三主题

- light / dark / eink 使用 `src/style.css` 现有 token；原型已按同一组值实现三主题。
- eink：所有分隔线黑、选中态靠 1.4–2.4px 线宽与字重承担；不使用 `--accent-tint`（它是 transparent）、
  不用灰底表示选中（活动行用 `--sel` 明度带）。
- 视觉对账：原型截图在 `.local/reviews/keybindings-lookup-oct24/`；实现后按同状态截一组，并排看
  间距、行高、chip 密度、sticky 组头、详情留白。像素差值不是判据（原型字体度量与产品不同）。

### 4.6 原型关键屏

| 文件 | 看什么 |
|---|---|
| `01-panel-light-default.png` | 默认全量：一行一命令、键位 chip、scope、sticky 组头、计数 |
| `02-p1-query-light.png` | 两次击键命中「打开大纲」，目标行在首屏 |
| `03-p2-capture-light.png` | 捕获 `⌃⌥S`：字形 chip、条件短徽标、详情、scope |
| `04-p3-scope-light.png` | 作用域「全局」筛选后「标签」组进入视口 |
| `05-p4-unbound-detail-light.png` | 「折行」未绑定 + `[keys]` 绑定示例 |
| `06-empty-light.png` | 查询 / 捕获无命中的空态 |
| `07-detail-undo-light.png` | 多键合并（撤销 3 键）+ 来由 / 原始 token |
| `08-panel-dark.png` / `09-panel-eink.png` | 暗色 / eink 的边框、层级、对比 |
| `10-collapsed-light.png` | 全折叠后的组头与计数 |
| `11-p6-keyboard-light.png` | 列表焦点 + 活动行（键盘全程的可视证据） |
| `00-entry-menu-light.png` | Help → Keyboard Shortcuts 菜单入口（示意） |

## 5. 复用与实现落点

### 5.1 可直接复用

| 能力 | 来源 | 用法 |
|---|---|---|
| 子串 / 大小写折叠 / 结果下标 | `src/list-filter.ts:20-84` | `filterIndices(corpus, query)`；不重排 |
| 输入框 ARIA / 活动行 / IME / 焦点离开 | `src/quick-open.ts:285-311`、`:520-614` | 机制复用；动作不复用（不打开文件） |
| token 归一化 | `src/keys.ts` 的 `normalizeKey` / `keyToken` | 捕获、字形、表内 token 同源 |
| scope 派生 | `src/keys.ts` 的 `scopeOfCommand` | 行的 scope 徽标 |
| 分组 | `src/bindings-panel.ts` 的 `BINDING_GROUPS` | 组与组序不变 |
| 未绑定清单 / 文案 | `KEYLESS_COMMAND_IDS`、D66.1/D66.2 | 成因与下一步 |
| 文案 / 重绘 | `t()` / `onRelabel` / `applyLanguage` | 标签与 UI 文案随语言切换重绘 |
| 浮层壳 / 滚动条登记 | `src/style.css:1748-1833`、`tests/unit/scrollbar-registry.test.ts` | 保留类名与分档 |

### 5.2 新增 / 修改

| 文件 | 改动 |
|---|---|
| `src/command-meta.ts`（新） | `COMMAND_META` / `SCOPE_LABEL_KEYS` / `SCOPE_DESCRIPTION_KEYS` |
| `src/key-glyphs.ts`（新） | `glyphOfToken` + 修饰键 / 具名键 / SHIFT_IMPLIED 表 |
| `src/keys.ts` | 5 条带 `when` 的绑定各补 `whenKey`；零新命令 / 绑定 |
| `src/bindings-panel.ts` | 重写为速查视图：行聚合、查询、捕获、详情、键盘、焦点循环、空态 |
| `src/style.css` | 面板区重排；保留 overlay / `.lumir-bindings-body` 壳与滚动条分档 |
| `src/main.ts` | 面板装配、`restoreFocus`、菜单事件 → toggle；不新增第二条分发 |
| `src/copy-data.ts` + `文案-Copy.md` | 71 条标签（中英）+ 面板 UI 文案 + scope 文案 + `when` 文案；D63 标题改措辞 |
| `src-tauri/src/lib.rs` | Help 菜单追加 `Keyboard Shortcuts`（无 accelerator），`menu_command_of` 映射到 `describe-bindings` |
| `tests/unit/*` | `command-meta` 覆盖 / 字形矩阵 / 语料不含来由 / 行聚合 / 捕获归一化 / `whenKey` 不变量 |
| `tests/visual/scenes/m133-*` | 行模型、组头、未绑定、详情、空态、三主题；基线需 Alex 过目后重截 |
| `scripts/acceptance/scenarios/*` | 真机：菜单入口 / 查询 / 捕获 / 键盘 / 焦点 / 回滚语义 |

### 5.3 复制文案的规模

- 71 条命令 × 2 列标签 = 142 条文案；加上面板 UI / scope / `when` / 空态 / 菜单，约 170–190 条 deck 条目。
- 这是实现批最大的机械工作量；建议按功能族分批写、每批跑 `tests/unit/copy.test.ts` 与 `command-meta` 门禁。
- 别名不进 deck（搜索专用数据），只为标签里没有的同义词写；不追求 71 条全覆盖。

## 6. 原型与机器断言

### 6.1 原型覆盖

`design/prototypes/keybindings-lookup-oct24.html`：自包含（零外部依赖），27 条合成命令 / 6 组 /
3 种 scope / 3 条未绑定 / 1 条 `when` 绑定；内置控制面板可点击切换主题、场景、查询、作用域、捕获、
分组、详情、入口条、菜单、面板开关；URL query 只作深链，`?panel=0` 关控制面板。
内容全为合成 fixture（虚构文件名、合成来由、`M000`），不含真实 vault 内容。

### 6.2 P1–P6 断言（先写后实现）

`assert.mjs` 用 Playwright 驱动原型，逐条打印 PASS/FAIL，末行 `ASSERT RESULT: PASS|FAIL`。
断言先于实现写出：原型缺位时 17 条全红（`assert-red.txt`），实现后 17 条全绿（`assert-run-final.txt`）。

| 场景 | 断言要点 | 判别性反例 |
|---|---|---|
| P1 命令找键 | 空查询 27 条；两次击键「大纲」→ 恰一条 `toc.toggle`；键位 `⇧⌘O`；目标在列表视口内、`scrollTop=0` | 来由里的 `M000` 零命中；「删除」不误命中 `toc.toggle`；「全屏」命中未绑定命令 |
| P2 键找命令 | 捕获 `⌃⌥S` → `editor.focus-block-scroll`；scope「编辑器」、条件徽标、详情「块滚动容器」；文档逐字不变 | 同一 `⌃⌥S` 在面板关闭时真的执行；捕获全局键 `⇧⌘T` 不切主题 |
| P3 浏览 | 一次作用域筛选让「标签」组进入视口；所有行 ≤31px；键盘 Tab 到作用域组、方向键切换、Tab 到列表、PageDown 真滚动 | 小视口下「标签」组原本在视口之外；滚动量前后对比 |
| P4 未绑定 | 「折行」恰一条、未绑定 chip、详情含「默认不占键位」「[keys]」「config.json」；「关闭」命中关闭标签 | 「折行」不得误命中别的命令（旧面板的假阳性） |
| P6 键盘全程 | `⌘/` 打开、输入、↓/Enter、Tab 四停、Shift+Tab 回绕、PageDown、End/Home、Esc 分层、焦点回编辑器、`__executed` 为空 | 每一步后焦点仍在面板内；PageDown 真的改变 `scrollTop` |
| 入口 | 菜单项可见、无 `⌘` / 斜杠字形、点击打开并聚焦输入框 | 菜单项不带加速键 |
| 控制面板 | 主题 / 场景 / 作用域 / 折叠 / 隐藏与恢复全部点击可达 | 每个状态写回 URL |

**原型的边界**：为了判别「捕获必须消费」，原型的 window 分发器被简化成 `token → 命令`（不模拟 scope / when），
只用来证明「同一个键在面板关闭时真的执行、捕获时不执行」；它不是产品分发语义的声明。真实分发仍以
`src/keys.ts` 与 `src/main.ts` 为准。

## 7. 验收与测试计划

### 7.1 单测（纯逻辑层）

- `COMMAND_META` 键集 = `COMMAND_IDS`；无幻影；每个 `labelKey` 在 `COPY`；中英渲染非空；模板参数齐全。
- 字形矩阵（§2.3），含「全部默认 token 不含 token 字面」反向断言。
- 搜索语料：给定命令，语料包含中英标签 / 别名 / id；**不包含** `doc` 文本；`M447` 类来由词零命中。
- 行聚合：一条命令多绑定 → 一行多 chip；未绑定 → 一行；scope 来自 `scopeOfCommand`；`when` 来自 `whenKey`。
- 捕获：`keyToken` 产出的 token 与表内 token 归一化后相等；Alt 组合走 `code`；无绑定 token → 空。
- 不变量：`when` ⇔ `whenKey`；`BINDING_GROUPS` 零兜底组仍成立；一条 token 一条绑定不变。

### 7.2 视觉层

- 更新 `tests/visual/scenes/m133-*`：空查询行数 = `COMMAND_IDS` 数（71），每条命令恰一行；多键合并；
  scope / 条件徽标；未绑定行；查询 / 捕获 / 空态 / 详情；三主题结构断言。
- 像素基线（整页 / 元素）会因行模型变化而失效——**基线更新是人肉裁决点**，截图先给 Alex 过目；
  不把 `--update-snapshots` 当机械步骤。
- 对账：原型截图 vs 实现截图并排；重点看行高、chip 密度、sticky 组头、详情留白、eink 线宽。

### 7.3 真机验收（`scripts/acceptance/`）

新增场景（命名待实现批按套件规则取号）：

1. 菜单：Help → Keyboard Shortcuts 打开面板；`[keys]` 重绑 / 解绑 `app.describe-bindings` 后菜单仍打开。
2. 查询：输入「大纲」→ `toc.toggle` 行；输入「M447」→ 空态（来由不进语料）。
3. 捕获：面板内捕获 `⌃⌥S` → `editor.focus-block-scroll`；文档逐字节不变；同键在面板关闭时真实执行（反例）。
4. 键盘：`Tab` 四停不逃出；`PageDown` 改变 `scrollTop`；Esc 分层；关闭后焦点回编辑器。
5. IME：组合期不刷新，`compositionend` 后出结果。
6. eink / dark 结构：面板与详情用 token，无新增色值（视觉层兜底；真机看对比）。

### 7.4 门禁

- `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`
- `bash scripts/docs-check.sh`（含归档对账）
- `bash scripts/gate.sh quick`
- `bash scripts/gate.sh visual`（动过 `src/style.css` 后本地必须跑；CI 绿不代表像素层没回归）
- 真机套件：实现批合并后、Alex 验收前跑一遍

## 8. 已知边界与未验证

- **标签 / 别名的措辞质量不可机器判定**：单测只能守「有标签、能渲染」；「这个标签是不是用户会打的词」靠 dogfood
  与 Alex 的裁决。71 条标签的维护成本是本 change 的明账（D6）。
- **子串匹配不是语义搜索**：没有同义词（除非写别名）、没有拼音、没有模糊 / 拼写纠错；`⌘K` 这类符号查询要靠捕获，
  文本查询只认标签 / 别名 / id 里的字面。
- **多段 chord 不支持**：表内没有 chord，`[keys]` 拒绝含空白的键位；捕获也只捕获单段 token。
- **捕获等待态的 `⌃G` 例外**：为了能反查 `⌃G`，它不关闭面板；退出捕获只能 Esc 或点按钮。这是有意取舍，不是遗漏。
- **global 键仍分发**：面板打开时按 `⌘F` / `⌘P` 会打开另一层浮层；本 change 不改变这个既有边界，也不定义
  多层浮层的叠加规则。若 Alex 认为应改为完整模态，需另立 change。
- **ARIA 组头取舍**：组头 `tabindex=-1`，键盘用户用 `←/→` 折叠，屏幕阅读器浏览模式仍可激活；真机 VoiceOver
  需复核（§7.3）。若不可接受，备选是把组头加入 Tab 停靠点（会打破四停模型）。
- **原生菜单不在原型里**：原型用一条标注「原型示意」的菜单栏演示入口；真实菜单项的点击、Help 子菜单结构与
  `[keys]` 重绑的交互要真机验。
- **像素不是合同**：原型用系统字体与合成数据，字体度量与产品不同；只做并排观感对账，不追求逐像素。
- **性能未实测**：71 行全量渲染在旧面板已有先例；本 change 增加分组 / chip / 详情，预计不触及
  16ms keypress-to-paint（面板不在编辑器按键路径上）。实现批应在真机打开一次、滚到底，确认没有可感卡顿；
  不新增 perf 端点。
- **没有使用数据**：P1/P2 的优先级来自 survey 与 Alex 的原话，不是 telemetry；「用户最常按哪个方向」仍未知。

## 9. 实现期取值（不需要 Alex 再裁，记录以便对账）

| # | 取值 | 理由 |
|---|---|---|
| I1 | 面板宽 680px 不变 | S15/S16 的既有裁决；行模型变了，宽度不必变 |
| I2 | 列表滚动容器保留 `.lumir-bindings-body` 类名与 `native-overlay` 档 | 不新增滚动容器、不改注册表 |
| I3 | 组头 sticky，组序不变 | 首屏线索 + 不打断肌肉记忆 |
| I4 | 详情一次只开一个 | 单列、避免多开把列表推得很长 |
| I5 | 查询 / 捕获 / 详情不持久化 | 瞬态 UI 状态，不写 `config.json` |
| I6 | 作用域筛选不持久化，打开重置为「全部」 | 避免「上次筛过所以看不到」 |
| I7 | 捕获进入时作用域重置为「全部」 | 捕获问「这个键归谁」，不应被筛选藏答案 |
| I8 | 关闭后焦点走 `restoreFocus()`（`focusPreservingReadingPosition`） | 与图片 / 表格遮罩同款，不裸 `editor.view.focus()` |
| I9 | `⌘/` 不作为面板硬编码关闭键 | 它可被 `[keys]` 重绑；关闭由当前 `app.describe-bindings` 绑定 / 菜单 toggle 决定 |
| I10 | 菜单项文案锁 en（`Keyboard Shortcuts`） | 与 macOS 原生菜单的英文项一致（先例：D149–D151 的上屏列锁定） |
