# keymap-commands Specification

## ADDED Requirements

### Requirement: 链接跟随——⌘⏎ 与 ⌘-Click 同一命令

系统 SHALL 提供一个链接跟随命令承担「激活光标/点击处的链接」，命令 id SHALL 为 `link.follow`，作用域 SHALL 为 `global`，默认绑定 SHALL 为 `⌘⏎`。该 id 取代 `wikilink.follow`（命令跟随的已经是**链接**这件事本身，不再只管 wikilink；旧 id 不再使用，`[keys]` 配置里引用旧 id 会按既有口径产生未知命令 warning 并忽略该条）。⌘-Click SHALL 走同一条命令实现——鼠标路径就地判定（键位表只管键盘），MUST NOT 衍生第二套跟随逻辑。

跟随 SHALL 按键盘路径的当前选区（head）或鼠标路径的点击位置判定，按链接类别分流（分类口径见 `editor-live-preview` 的链接形态矩阵）：

1. **wikilink**：SHALL 走既有跳转链路（Rust `link_graph` 解析 → 打开目标文件 → 锚点定位），MUST NOT 新建第二套解析或打开路径。未解析（`unresolved`）时 SHALL 只给提示，MUST NOT 创建文件——自动创建是作者没做过的动作，提示里既有的「创建并打开」显式入口不变。
2. **外链**：SHALL 交给系统默认应用打开（见下）。
3. **应用内笔记**（相对路径 md）：SHALL 按**相对当前文件所在目录**的路径语义解析（`./` `..` 归一、以 `/` 开头按 vault 根相对、`#fragment` 忽略）后走与 wikilink 同一条「打开一篇笔记」链路（同一 `openFile`），MUST NOT 新建第二套打开路径。MUST NOT 复用 wikilink 的名称匹配语义（`[x](note.md)` 与 `[[note]]` 可能指向不同文件）。解析不到时 SHALL 只给「链接目标不存在」提示，MUST NOT 创建文件、MUST NOT 跳转。
4. **vault 内资产**（非 md 文件 / 目录）：SHALL 交给系统默认应用打开；目标 MUST 先经 vault 内路径校验（拒绝绝对路径、`..` 穿越与符号链接逃逸，且目标必须存在），校验不通过 SHALL 拒绝并给提示，MUST NOT 交给系统。
5. **纯锚点**：SHALL 给出「暂不支持锚点跳转」提示，MUST NOT 做文档内滚动跳转（当前没有锚点→行号的文档内链路，不做半个实现）。
6. **不可用形态**（白名单外 scheme）：SHALL 无操作——不产生任何打开请求、不移动选区、不给提示；该形态在渲染层就是原文，没有"看起来能开"的外观，因此无操作与外观自洽。光标不在链接上时同样无操作。

外链打开的 scheme 白名单（`http` / `https` / `mailto`，大小写不敏感）SHALL 在 Rust 侧校验并作为**打开许可**的唯一权威判定：前端可以按同一白名单决定"是否渲染成外链、是否发起打开请求"这类呈现层判断，但 MUST NOT 以自身判断代替校验；scheme 不在白名单内、或目标还原后含空白 / 控制字符时，后端 SHALL 拒绝并返回 `open_url_rejected` 错误信封（前端按人话 toast 展示），MUST NOT 交给系统打开。

vault 内资产的路径校验同理 MUST 在 Rust 侧（`link_open_path`）：前端只把「在哪个文件里、目标原文是什么」递过去，MUST NOT 自行拼绝对路径，也 MUST NOT 以自身判断代替校验。

打开链路 SHALL 只有一条：webview MUST NOT 被授予 `opener` 插件的任何直接调用权限（capabilities MUST NOT 新增 `opener:*` 条目），唯一入口是本仓的 `open_external_url`（外链）与 `link_open_path`（vault 内资产）两个 command；插件自身注入的「点击 `<a target=_blank>` 直接开浏览器」脚本 SHALL 关闭——那是绕开校验的第二条打开路径。

链接激活 SHALL 落下 `link_open` 诊断事件（`LogEventName` 成员），字段 SHALL 只有 `category`（链接类别：`external` / `internal-md` / `asset` / `anchor` / `blocked-scheme`）、`outcome`（`opened` / `unresolved` / `unsupported` / `rejected` / `failed`）与 `scheme`（可选，仅外链路径上有值：归一后的协议名，白名单外与无 scheme 归 `other`）。系统打开类（`external` / `asset`）由 Rust 侧记录（判定与调用都在那一侧），其余类别由前端记录（分类只在前端）。URL / 目标原文与文档内容 MUST NOT 写入日志——那是文档内容，`logging` 的隐私边界（负载里没有文档正文与键入内容）优先于排查便利。

#### Scenario: ⌘⏎ 打开光标处的外链

- **WHEN** 光标落在 `[示例站点](https://example.invalid/site)` 的显示文本内，按下 `⌘⏎`
- **THEN** 系统默认应用打开 `https://example.invalid/site`；诊断日志出现 `link_open`（`category=external`、`scheme=https`、`outcome=opened`），日志中没有该 URL 原文

#### Scenario: ⌘-Click 与 ⌘⏎ 同一路径

- **WHEN** 在 `[写邮件](mailto:someone@example.invalid)` 上 `⌘-Click`，随后在 `[包裹形式](<https://example.invalid/wrapped>)` 上把光标移入并按下 `⌘⏎`
- **THEN** 两次打开的目标分别是 `mailto:someone@example.invalid` 与 `https://example.invalid/wrapped`（尖括号包裹形式开的是里面的目标），走的是同一条命令实现

#### Scenario: 相对路径 md 跳进 vault 内的笔记

- **WHEN** 在 `notes/index.md` 里对 `[指南](../docs/guide.md)` 按下 `⌘⏎`，且 vault 里有 `docs/guide.md`
- **THEN** 编辑器切到 `docs/guide.md` 的内容（与 wikilink 跳转同一条打开链路）；诊断日志出现 `link_open`（`category=internal-md`、`outcome=opened`）

#### Scenario: 相对路径 md 解析不到

- **WHEN** 在 `[不存在的笔记](missing.md)` 上按下 `⌘⏎`，且 vault 里没有 `missing.md`
- **THEN** 弹出「链接目标不存在：missing.md」提示，跳到 `missing.md` 的动作 MUST NOT 发生，vault 里 MUST NOT 出现新文件（一键创建是 wikilink 的显式动作）；诊断日志出现 `category=internal-md`、`outcome=unresolved`

#### Scenario: vault 内非 md 资产交系统默认应用

- **WHEN** 对 `[说明书](docs/manual.pdf)` 按下 `⌘⏎`，且 vault 里有 `docs/manual.pdf`
- **THEN** 系统默认应用打开该文件；诊断日志出现 `category=asset`、`outcome=opened`

#### Scenario: 资产目标越出 vault 被拒

- **WHEN** 对 `[越界](../outside.pdf)` 按下 `⌘⏎`（归一后越出 vault 根）
- **THEN** 后端拒绝并返回 `link_path_rejected` 错误信封，前端 toast 展示「打不开这个目标：…——它不在 vault 内」；MUST NOT 有任何文件被系统打开

#### Scenario: 纯锚点只给提示

- **WHEN** 对 `[去标题](#小节)` 按下 `⌘⏎`
- **THEN** 弹出「暂不支持锚点跳转」提示；文档不做滚动跳转、选区与文档内容都不变

#### Scenario: wikilink 两态

- **WHEN** 光标落在一条已解析的 `[[note]]` 上按下 `⌘⏎`；随后落在一条未创建的 `[[missing]]` 上按下 `⌘⏎`
- **THEN** 前者打开 `note.md` 并按锚点定位（既有链路，行为不变）；后者只弹出未创建提示，vault 里 MUST NOT 出现新文件——除非作者在提示里点了「创建并打开」

#### Scenario: 非白名单 scheme 被拒

- **WHEN** 光标落在 `[别开我](javascript:alert(1))` 上按下 `⌘⏎`
- **THEN** 不产生任何打开请求、不弹提示（该形态在渲染层就是原文，跟随命令判定为"不可用形态"）；即使前端判断失误把非法目标递到后端，`open_external_url` 也 SHALL 独立拒绝并返回 `open_url_rejected`

#### Scenario: 光标不在链接上无操作

- **WHEN** 光标停在普通正文里按下 `⌘⏎`
- **THEN** 不打开任何 URL、不弹提示、文档与选区都不变

## MODIFIED Requirements

### Requirement: 鼠标路径的 ⌘ / ⌃ 拆分

`⌘`-Click SHALL 跟随光标处（点击位置）的**链接**——wikilink、外链、相对路径 md 与 vault 内资产都算——命中链接时阻止选区落点并激活链接；`⌃`-Click SHALL NOT 被当作链接激活——`⌃`-Click 在 macOS 是系统级次级点击（右键等价手势），MUST 让回系统；裸点击 SHALL 不拦截（链接文本可正常落点编辑）。该拆分与 D1 的键盘拆分同源：`⌘` 系归 mac 惯例、`⌃` 系归 Emacs / 系统手势。

需要 vault 上下文的类别（wikilink 与 vault 内路径类链接——解析基准是当前文件）在没有打开中的 md 文件时 `⌘`-Click 不跟随；外链与纯锚点不需要 vault 上下文，`⌘`-Click 照常生效。

#### Scenario: ⌃-Click 不跳转、⌘-Click 跳转

- **WHEN** 在含 `[[target]]` 的文档里先 `⌃`-Click 该链接，再 `⌘`-Click 该链接
- **THEN** 第一次不跳转（仍在原文件、无提示，选区正常落点）；第二次跟随链接打开目标文件

#### Scenario: 无 vault 上下文时外链仍可开

- **WHEN** 没有打开中的 md 文件（无 vault 上下文），在文档里 `⌘`-Click 一条外链
- **THEN** 外链照常交给系统默认应用打开（外链打开不依赖 vault 上下文）
