## MODIFIED Requirements

### Requirement: 编辑器排版的 token 层与其配置来源

排版基线 SHALL 在 token 层（`src/style.css` 的 `:root`，值的唯一权威文本是
[design-tokens-v1.md](../../../../../docs/specs/design-tokens-v1.md)）之上提供一层**编辑器作用域**的
token：`--editor-font-family`（正文族，默认引用 `--font-sans`）、`--editor-mono-family`（等宽族，
默认引用 `--font-mono`）、`--editor-font-size`（编辑器内容字号，默认 `15px`）。编辑器内的一切字体族
与字号引用 SHALL 走这一层，MUST NOT 直接引用 shell 基线 token；shell（左栏文件树、标题栏、modeline、
浮层、键位面板、搜索面板）MUST NOT 受编辑器 token 影响——「配置只影响编辑器」SHALL 由 token 分层
结构性保证，MUST NOT 依赖逐处记得改。

出厂默认值由 `restyle-ui-tokens-v1` 的节点 1 裁决 **D1** 定为 `15px`（「编辑器即阅读表面」，与批准的
定稿图同密度），行高比取 `--lh-reading` = `1.7`；`typography` 的**配置机制与档位口径不变**（倍率
`1.1`、区间 `[12, 32]`、三条步进命令、⌘0 回配置值），变的只是基准点——`--font-body` 随之更名为
`--font-sans`，`--font-display` / `--line-height` / `--measure` 三个旧 token 由 token 层整体替换
（标题族退场，标题走 sans 字重阶梯；栏宽改定值 `--layout-doc-measure`）。本能力 MUST NOT 自己
改这三个新 token 的值——它们是 token 层的取值，本能力只消费。

这条 SHALL 覆盖**JS 侧的取值点**，不只是 CSS 引用：按 `getPropertyValue` 读字体族字符串的消费者
（列表标记宽度的 canvas 测量）读到的 SHALL 与它渲染所用的**同一个 token**——MUST NOT 出现「渲染走新的
编辑器 token、测量仍读 shell token」的分叉（那会在非默认等宽族下表现为标记与正文对不齐）。CSS 引用改名
时 JS 取值点不会自动跟着变，因此这条 SHALL 由断言钉住，MUST NOT 靠人记得改。**字号比值同样同源**：
标记的渲染字号比与测量比值都取 `.cm-lp-list-marker` 的 `font-size: .9em`（= 字号阶梯的 13.5px 档，
restyle 前是 `.85em`），两处是同一比值的两个写值。

编辑器内容的字号 MUST NOT 有两处写值：真源 SHALL 只有 token 默认值（`--editor-font-size`）一处，
Rust 侧的 `DEFAULT_FONT_SIZE`、`src/typography.ts` 的 `DEFAULT_FONT_SIZE` 与 CSS 默认值三处 SHALL
同值（`15`），且 SHALL 由计算属性断言钉住。

配置面 SHALL 提供三个 `[editor]` 字段：`font_family`（正文族）、`mono_font_family`（等宽族）、
`font_size`（数值 px）。前两项缺省 / 空串 / 纯空白 SHALL 等价于「沿用基线」（正常状态，MUST NOT 因此
改变观感）；`font_size` 缺省为 `15`，合法区间 SHALL 是 `[12, 32]`，区间外 SHALL 回落默认并附一条
人话 warning。配置 SHALL 只在启动装载时读一次（本能力不引入热重载），运行期变更由字号步进命令承担。

用户提供的字族值 SHALL NOT 直接进入样式层：值 SHALL 先经 CSS 支持性判定（`CSS.supports`），不通过时
SHALL 记一条 warning 并保持基线；通过时写入 token 的 SHALL 是「用户值 + 基线后备栈」（用户值在前），
使「字族名写错」或「本机未安装该字体」退化为**基线观感**，MUST NOT 退化成浏览器默认字体。

#### Scenario: 默认口径就是 change 之前的观感

> 场景名沿用 living spec 的原名（openspec 的 MODIFIED 会整块替换，改名会被 validate 判为
> 「丢了场景」；归档依赖名字匹配）。**语义已由 D1 裁决重定义**：这句里的「change 之前」现在指
> 「`restyle-ui-tokens-v1` 落地后的出厂口径」，不再是 M195 之前的那套观感。

- **WHEN** 以缺省配置（三个字段都未设）打开一份 Markdown
- **THEN** `getComputedStyle(.cm-content).fontSize` 为 `15px`、`getComputedStyle(.cm-editor).fontFamily`
  为基线正文族 token 的值、单行行盒高 = 15 × 1.7；代码块（mono 12px/1.55）与 frontmatter 区块按
  tokens 文档的阶梯取值

#### Scenario: 配置生效且只作用于编辑器

- **WHEN** 配置 `editor.font_family` 为一个本机已安装的字族、`editor.font_size` 为 `20`
- **THEN** 编辑器内容的字体族与字号随之变化（正文与代码块按各自的 token 取到新族，字号为 20px，
  行高 = 20 × 1.7）；左栏文件树、标题栏、modeline、键位面板、搜索面板的字体与字号逐项不变

#### Scenario: 测量与渲染同源

- **WHEN** 配置 `mono_font_family` 为一个与本机默认等宽族不同的字族，打开一份含列表的 Markdown
- **THEN** 列表标记（序号 / 项目符号）**渲染**用的字体族与列表标记宽度**测量**用的字体族是同一个值
  （都取自等宽 token）；MUST NOT 出现「渲染用新族、测量仍按旧族算宽」导致标记与正文错位的状态

#### Scenario: 非法值与未安装字体都退化为基线

- **WHEN** 配置的 `font_family` 不是合法的 CSS 字族值（或为空串 / 纯空白）
- **THEN** 记一条 warning、排版保持基线（观感与缺省配置逐像素相同），MUST NOT 出现「编辑器退化成浏览器默认字体」
- **WHEN** 配置的字族名语法合法但本机未安装
- **THEN** 文本按基线后备栈呈现（观感与缺省配置一致），不报错、不阻断打开

#### Scenario: 字号区间与回落

- **WHEN** 配置 `font_size` 为 `16` / `20` / `32` / `12`
- **THEN** 编辑器内容字号分别为该值（正文、代码块与 code 模式同步）
- **WHEN** 配置 `font_size` 为 `8` / `64` / `-1`
- **THEN** 回落 `15px`（`DEFAULT_FONT_SIZE`）并附一条 warning；界面其余部分无可见变化

### Requirement: 字号步进的运行期口径

系统 SHALL 提供三条命令承担运行期字号步进：`view.text-scale-up`（放大一档）、`view.text-scale-down`
（缩小一档）、`view.text-scale-reset`（回到基准）。档位 SHALL 以倍率 `1.1` 递进并取整为整数 px
（向下为除以 `1.1` 后取整，避免反复乘除造成的漂移）；字号 SHALL 被钳在 `[12, 32]` px，到达上下限后
继续按键 SHALL 无变化、无提示、不报错。出厂基准 `15px` 的档位表 SHALL 为：向上
`17 / 19 / 21 / 23 / 25 / 28 / 31`（七档）后第 8 档触顶 `32`；向下 `14 / 13 / 12`（三档）后第 4 档
在界上返回原值。这**不改变档位机制**，只把整张表随 D1 的基准平移（`typography-and-zoom` 的
`16px` 表相应退役）。

字号状态 SHALL 是**应用运行期**的一份值：全部会话（含后台标签页）取同一口径，新标签页 SHALL 取当前
运行期值而 MUST NOT 取配置默认。`view.text-scale-reset` SHALL 回到**当前配置值**（MUST NOT 回到出厂
`15px`）。

三条命令 MUST NOT 写文档、MUST NOT 进撤销栈、MUST NOT 改变 dirty、MUST NOT 落盘、MUST NOT 回写
`config.json`——`config.json` 的内容在命令前后逐字节不变（ADR 0002 §5「配置即数据」，与折行开关的
瞬态口径同纪律）。命令 SHALL 只改字号，MUST NOT 改动字体族。

#### Scenario: 逐档放大与缩小

- **WHEN** 基准为 15px 时依次按 `⌘=`（或 `⌘+`）三次、随后按 `⌘−` 一次
- **THEN** 字号依次为 17 → 19 → 21（取整后的档位）再回到 19；文档内容、dirty 与撤销栈全程不变

#### Scenario: 上下限钳制

- **WHEN** 字号已在 32px 时继续按放大键；或已在 12px 时继续按缩小键
- **THEN** 字号不变，无提示、无报错、不写日志噪音

#### Scenario: 重置回到配置值

- **WHEN** 配置 `font_size` 为 18，按放大键两档后按 `⌘0`
- **THEN** 字号回到 18（配置值），而不是 15（出厂值）

#### Scenario: 全会话一致

- **WHEN** 打开两个标签页、按放大键一档，随后切到另一个标签页
- **THEN** 两个标签页的字号一致（含切换前处于后台的那个）；此后新开的标签页也取当前运行期值

#### Scenario: 不落盘、不碰文档

- **WHEN** 按三次放大键
- **THEN** `config.json` 的内容与 mtime 逐字节不变（没有新增回写字段）；磁盘上的文档字节不变
  （ADR 0003 §3）

### Requirement: 排版变更后的重测量

每次应用排版值（启动时的配置或运行期的字号步进）之后，系统 SHALL 让编辑器重新测量，使行高、光标矩形、
选区矩形与列表标记宽度与新字号一致；MUST NOT 出现「样式换了而坐标还是旧的」状态。重测量 SHALL 覆盖
内容区高度与行高的重新计算；MUST NOT 因此重新解析文档或遍历全文档（ADR 0002 §6 的性能合同）。

#### Scenario: 改字号后坐标与行高一致

- **WHEN** 光标停在某一行、按放大键一档
- **THEN** 该行的 `getBoundingClientRect().height` 等于「新字号 × 行高（1.7）」的实测值；`coordsAtPos`
  给出的光标位置与 DOM 选区矩形一致（不出现错位）；列表标记的宽度按新字号重测

#### Scenario: 改字号后光标仍可见

- **WHEN** 文档超过一屏、光标在中部时按放大键
- **THEN** 光标仍在视口内（或按既有的揭示口径被滚入视口），MUST NOT 出现整屏跳到篇首或视口内容错位

### Requirement: 出厂默认口径不变

出厂默认（无配置文件 / 配置缺省 / 配置中三个字段缺失）下，编辑器排版 SHALL 等于**本 change 落地的
出厂口径**（`restyle-ui-tokens-v1` 的 D1 裁决）：内容字号 `15px`、正文字体族与等宽字体族取 token 层的
`--font-sans` / `--font-mono`、行高比 `1.7`、阅读栏宽 `--layout-doc-measure`（664px 居中）。这条
SHALL NOT 再表述为「与本能力实现之前逐项相同」——那句约束的时效止于 `restyle-ui-tokens-v1` 的裁决
（D1 显式改基准），此后「出厂默认」的名词含义就是上面这一组值；本能力 MUST NOT 再单独改这些默认值，
要改 SHALL 走 token 层的裁决。

既有视觉基线在 `restyle-ui-tokens-v1` 中**全量重建**（独立批次动作、逐张经人过目），本能力的
「既有基线逐张零差异」口径随之作废并由新基线继承；非默认口径的基线（大字号 / 自定义字体）SHALL 独立
新增，MUST NOT 覆盖默认口径的基线。

#### Scenario: 默认口径零回归

- **WHEN** 以默认配置打开一份 Markdown
- **THEN** 计算属性读数与上面列出的五组值逐项一致；`git diff` 里没有本能力引入的默认值改动
  （默认值的任何变化 SHALL 走 token 层的裁决，MUST NOT 由本能力就地改）

#### Scenario: 非默认口径用独立基线

- **WHEN** 需要固化「大字号」或「自定义字体」的呈现
- **THEN** 新增独立的、带明确命名的基线，既有基线的文件不被改写
