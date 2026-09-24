## ADDED Requirements

### Requirement: 编辑器排版的 token 层与其配置来源

排版基线 SHALL 在既有 token 层（`src/style.css` 的 `:root`）之上提供一层**编辑器作用域**的 token：
`--editor-font-family`（正文族，默认引用 `--font-body`）、`--editor-mono-family`（等宽族，默认引用
`--font-mono`）、`--editor-font-size`（编辑器内容字号，默认 `16px`）。编辑器内的一切字体族与字号引用
SHALL 走这一层，MUST NOT 直接引用 shell 基线 token；shell（左栏、masthead、浮层、键位面板、搜索面板）
MUST NOT 受编辑器 token 影响——「配置只影响编辑器」SHALL 由 token 分层结构性保证，MUST NOT 依赖逐处
记得改。三个 token 的默认值 SHALL 等于本 change 之前的观感（字体族、字号、行高、栏宽逐项相同）。

编辑器内容的字号 MUST NOT 再有两处写值：本 change 之前 `src/style.css` 与编辑器主题各写一份 `16px`
（后者带作用域类、specificity 更高，是实际生效的那一份），实现后真源 SHALL 只有 token 默认值一处，
且 SHALL 由计算属性断言钉住。

配置面 SHALL 提供三个 `[editor]` 字段：`font_family`（正文族）、`mono_font_family`（等宽族）、
`font_size`（数值 px）。前两项缺省 / 空串 / 纯空白 SHALL 等价于「沿用基线」（正常状态，MUST NOT 因此
改变观感）；`font_size` 缺省为 `16`，合法区间 SHALL 是 `[12, 32]`，区间外 SHALL 回落默认并附一条
人话 warning。配置 SHALL 只在启动装载时读一次（本能力不引入热重载），运行期变更由字号步进命令承担。

用户提供的字族值 SHALL NOT 直接进入样式层：值 SHALL 先经 CSS 支持性判定（`CSS.supports`），不通过时
SHALL 记一条 warning 并保持基线；通过时写入 token 的 SHALL 是「用户值 + 基线后备栈」（用户值在前），
使「字族名写错」或「本机未安装该字体」退化为**基线观感**，MUST NOT 退化成浏览器默认字体。

本能力的配置面 SHALL NOT 触碰 `--font-display`（标题 / 装饰族）、`--line-height`、`--measure` 的默认值。

#### Scenario: 默认口径就是 change 之前的观感

- **WHEN** 以缺省配置（三个字段都未设）打开一份 Markdown
- **THEN** 编辑器正文、代码块、frontmatter、列表标记的字体族与字号与 change 之前逐项相同；
  `getComputedStyle(.cm-content).fontSize` 为 `16px`；既有整页基线逐张零差异

#### Scenario: 配置生效且只作用于编辑器

- **WHEN** 配置 `editor.font_family` 为一个本机已安装的字族、`editor.font_size` 为 `20`
- **THEN** 编辑器内容的字体族与字号随之变化（正文与代码块按各自的 token 取到新族，字号为 20px）；
  左栏文件树、masthead、键位面板、搜索面板的字体与字号逐项不变

#### Scenario: 非法值与未安装字体都退化为基线

- **WHEN** 配置的 `font_family` 不是合法的 CSS 字族值（或为空串 / 纯空白）
- **THEN** 记一条 warning、排版保持基线（观感与缺省配置逐像素相同），MUST NOT 出现「编辑器退化成浏览器默认字体」
- **WHEN** 配置的字族名语法合法但本机未安装
- **THEN** 文本按基线后备栈呈现（观感与缺省配置一致），不报错、不阻断打开

#### Scenario: 字号区间与回落

- **WHEN** 配置 `font_size` 为 `16` / `20` / `32` / `12`
- **THEN** 编辑器内容字号分别为该值（正文、代码块与 code 模式同步）
- **WHEN** 配置 `font_size` 为 `8` / `64` / `-1`
- **THEN** 回落 `16px` 并附一条 warning；界面其余部分无可见变化

### Requirement: 字号步进的运行期口径

系统 SHALL 提供三条命令承担运行期字号步进：`view.text-scale-up`（放大一档）、`view.text-scale-down`
（缩小一档）、`view.text-scale-reset`（回到基准）。档位 SHALL 以倍率 `1.1` 递进并取整为整数 px
（向下为除以 `1.1` 后取整，避免反复乘除造成的漂移）；字号 SHALL 被钳在 `[12, 32]` px，到达上下限后
继续按键 SHALL 无变化、无提示、不报错。

字号状态 SHALL 是**应用运行期**的一份值：全部会话（含后台标签页）取同一口径，新标签页 SHALL 取当前
运行期值而 MUST NOT 取配置默认。`view.text-scale-reset` SHALL 回到**当前配置值**（MUST NOT 回到出厂
`16px`）。

三条命令 MUST NOT 写文档、MUST NOT 进撤销栈、MUST NOT 改变 dirty、MUST NOT 落盘、MUST NOT 回写
`config.json`——`config.json` 的内容在命令前后逐字节不变（ADR 0002 §5「配置即数据」，与折行开关的
瞬态口径同纪律）。命令 SHALL 只改字号，MUST NOT 改动字体族。

#### Scenario: 逐档放大与缩小

- **WHEN** 基准为 16px 时依次按 `⌘=`（或 `⌘+`）三次、随后按 `⌘−` 一次
- **THEN** 字号依次为 18 → 20 → 22（取整后的档位）再回到 20；文档内容、dirty 与撤销栈全程不变

#### Scenario: 上下限钳制

- **WHEN** 字号已在 32px 时继续按放大键；或已在 12px 时继续按缩小键
- **THEN** 字号不变，无提示、无报错、不写日志噪音

#### Scenario: 重置回到配置值

- **WHEN** 配置 `font_size` 为 18，按放大键两档后按 `⌘0`
- **THEN** 字号回到 18（配置值），而不是 16（出厂值）

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
- **THEN** 该行的 `getBoundingClientRect().height` 等于「新字号 × 行高」的实测值；`coordsAtPos` 给出的
  光标位置与 DOM 选区矩形一致（不出现错位）；列表标记的宽度按新字号重测

#### Scenario: 改字号后光标仍可见

- **WHEN** 文档超过一屏、光标在中部时按放大键
- **THEN** 光标仍在视口内（或按既有的揭示口径被滚入视口），MUST NOT 出现整屏跳到篇首或视口内容错位

### Requirement: 出厂默认口径不变

出厂默认（无配置文件 / 配置缺省 / 配置中三个字段缺失）下，编辑器排版 SHALL 与本 change 之前逐项
相同：内容字号 `16px`、正文字体族与等宽字体族取基线 token、行高 `1.75`、阅读栏宽 `80%`。既有视觉
基线 SHALL 逐张零差异；任何既有基线的变化 SHALL 按缺陷处理（先查是否引入了与字体无关的位移），
MUST NOT 以「有意变更」重拍掩盖。非默认口径的基线 SHALL 独立新增，MUST NOT 覆盖既有基线。

#### Scenario: 默认口径零回归

- **WHEN** 以默认配置本地跑视觉门禁全量（含整页像素层）
- **THEN** 30 张既有基线逐张零差异；本 change 新增的基线只增不改

#### Scenario: 非默认口径用独立基线

- **WHEN** 需要固化「大字号」或「自定义字体」的呈现
- **THEN** 新增独立的、带明确命名的基线，既有基线的文件不被改写
