# editor-live-preview 增量规格

## MODIFIED Requirements

### Requirement: 折行渲染与代码块横滚容器

折行的判定 SHALL 是「一元素一条规则」：代码块行（围栏 / 缩进代码块）由 `editor.code_block_wrap`
裁决，其余所有行（含只读 code 模式的正文行）由 `editor.line_wrap` 裁决；两者 MUST NOT 互相改写。
四条生效路径 SHALL 为：

| `editor.line_wrap` | `editor.code_block_wrap` | 正文行 | 代码块 |
|---|---|---|---|
| `true` | `false` | 栏内折行 | 不折行，块内横向滚动 |
| `true` | `true` | 栏内折行 | 栏内折行 |
| `false` | `false` | 不折行，编辑区横向平移 | 不折行，块内横向滚动 |
| `false` | `true` | 不折行，编辑区横向平移 | 栏内折行 |

文件级口径为「不折行」时，编辑区 MUST NOT 折行（`.cm-content` 落回 `white-space: pre`），超长行
SHALL 由 `.cm-scroller` 的横向滚动到达——「Horizontal scrolling automatically causes line
truncation」是本条的对齐口径（[Line Truncation](https://www.gnu.org/software/emacs/manual/html_node/emacs/Line-Truncation.html)），
MUST NOT 使用会让内容不可达的方案（如 `overflow: hidden` 式的静默裁切）。

代码块口径为「不折行」时，块内每行 SHALL 不折行（行级 `white-space` 压回 `pre`、`overflow-wrap`
回到 `normal`），且该块 SHALL 由一个**块级横滚容器**承载，使超长行在容器内横向滚动。容器 SHALL：

- 复用 CM6 的 `BlockWrapper` 机制（与表格容器同一机制，`src/preview/livePreview.ts:234-279`）；
  MUST NOT 把代码块替换为 replace widget——源码 SHALL 保持可选中的原文、md 模式下仍可编辑；
- 可聚焦（`tabindex=0`）并带 `region` 角色与读屏可读的名字（与表格容器既有形态一致，
  `src/preview/livePreview.ts:262`）；
  该容器的**焦点入口**在本 change 之后不再存在（如实登记）：编辑器内容区里的 `Tab` 已被列表缩进
  命令 `editor.list-indent` 接管（见本 change 的「列表项缩进键（TAB / SHIFT+TAB）」requirement，
  Alex 裁决 D1a），原生焦点遍历不再从编辑器进入容器；点容器本体亦未验通（场景 21 实测
  `AXPress` 后焦点仍在编辑器，见 `keymap-commands` 的「轨道 D 的 widget 滚动键纳入统一键位表」）。
  本 requirement 的其余部分（可聚焦、五条滚动键的语义、底板、间距口径）**均不变**，
  MUST NOT 在实现或场景里再依赖「`Tab` 移入容器」这条路径；恢复入口记在 `docs/backlog.md`；
- 与表格滚动容器**共用同一「块级横滚容器」判据**，使既有五条 widget 滚动键（`←` `→` `Home` `End`
  `Escape`）对代码块同样生效；判据的 class 单一来源 SHALL 在 `src/keys.ts`（见
  `keymap-commands` 的「轨道 D 的 widget 滚动键纳入统一键位表」）。MUST NOT 为实现横滚另加一条
  `keydown` 路径（键位通路仍只有统一键位表一条）；
- 提供代码块底板：横向滚到右侧时 MUST NOT 露出无底色的空白（底色仍取自既有 `--bg-2` 与 token 配色，
  `src/preview/theme.ts:59`、`:63-68`）；
- MUST NOT 引入额外的纵向内外边距：翻转开关带来的几何变化 SHALL 只来自折行本身。任何必要的间距
  SHALL 用 padding 表达、MUST NOT 用 margin（CM 按 border-box 量行高，margin 对高度图不可见，
  口径见 `src/preview/theme.ts:96-100`、`src/style.css:284-288` 的 M110 注释）；表格容器的
  `padding-block: 12px` MUST NOT 被照抄（它会把代码块下方所有行推走）。

两项口径 SHALL 遵守本 spec 的视口增量纪律（「live preview 装饰层」requirement）：块发现与装饰构建
MUST NOT 因本 change 变成全文档扫描。任何一项 MUST NOT 改写文档（`EditorState.doc` 与磁盘文件逐字节
不变，ADR 0003 §3）。

既有例外原样保留：表格 cell 有自己的 `white-space: pre-wrap`（`src/style.css:325-326`）、块级公式与
mermaid 走自身 widget 渲染路径、表格容器自己的 `overflow-x: auto`——三者 MUST NOT 被本 change 改变。

#### Scenario: 默认口径下代码块不折行且块内可滚

- **WHEN** 默认配置下打开一份含超长代码行（长度超过阅读栏宽）的 Markdown
- **THEN** 该代码行不折行（不产生第二个视觉行），代码块在自己的容器内横向滚动；同一文档里的超长
  正文行仍照常折行（一元素一条规则）

#### Scenario: 文件级不折行 + 代码块折行

- **WHEN** 配置 `{"editor": {"line_wrap": false, "code_block_wrap": true}}` 后打开同一份文档
- **THEN** 代码块的长行在阅读栏内折行（无块内滚动容器），而正文的超长行不折行、由编辑区横向平移
  呈现——两级配置各自作用于各自的对象，互不改写

#### Scenario: 代码块容器的键盘可达性

（场景名沿用归档前的原名，不改名——本 change 之后真机的键盘**入口**已移除，键盘可达性的**行为**由 chromium 层以编程聚焦验证；此处只保证容器与五条键的语义不变。）

- **WHEN** 默认配置下打开含超长代码行的 Markdown，焦点落在代码块横滚容器上时（**本版起真机没有产品
  入口**：编辑器内 `Tab` 已归列表缩进命令、点容器不生效；键盘行为由 chromium 层
  `tests/visual/scenes/render-codeblock.spec.ts` 以编程聚焦承担），依次按 `→`、`End`、`Home`、
  `Escape`
- **THEN** 容器横向滚动 120px、滚到最右、回到最左，`Escape` 把焦点交还编辑器内容区（行为与表格滚动
  容器一致）；全程文档内容逐字节不变、编辑器光标位置不变

#### Scenario: 横滚到右端不露白底

- **WHEN** 把代码块容器横向滚到最右端，读该区域的计算背景色
- **THEN** 代码块底板覆盖整块可见区域（与未滚动时同一色值），MUST NOT 出现无底色的空白条

#### Scenario: 容器不改变代码块的纵向节奏与文档内容

- **WHEN** 打开一份代码行都不超栏宽的 Markdown（默认配置），与 `code_block_wrap = true` 下同一份
  文档对照
- **THEN** 代码块的纵向占位与文字位置一致（容器不引入额外垂直位移）；两种配置下文档内容逐字节
  相同、dirty 状态不变

#### Scenario: 只读 code 模式的正文行走文件级口径

- **WHEN** 默认配置下打开一个非 md 文件（只读 code 模式），其某行长于栏宽
- **THEN** 该行按 `editor.line_wrap`（默认折行）呈现——`editor.code_block_wrap` 对 code 模式没有
  作用对象，MUST NOT 产生容器、MUST NOT 报错或提示
