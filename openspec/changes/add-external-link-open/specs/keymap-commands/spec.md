# keymap-commands Specification

## ADDED Requirements

### Requirement: 链接跟随——⌘⏎ 与 ⌘-Click 同一命令

系统 SHALL 提供一个链接跟随命令承担「激活光标/点击处的链接」，命令 id SHALL 为 `link.follow`，作用域 SHALL 为 `global`，默认绑定 SHALL 为 `⌘⏎`。该 id 取代 `wikilink.follow`（命令跟随的已经是**链接**这件事本身，不再只管 wikilink；旧 id 不再使用，`[keys]` 配置里引用旧 id 会按既有口径产生未知命令 warning 并忽略该条）。⌘-Click SHALL 走同一条命令实现——鼠标路径就地判定（键位表只管键盘），MUST NOT 衍生第二套跟随逻辑。

跟随 SHALL 按键盘路径的当前选区（head）或鼠标路径的点击位置判定，三类落点各有确定行为：

1. **wikilink**：SHALL 走既有跳转链路（Rust `link_graph` 解析 → 打开目标文件 → 锚点定位），MUST NOT 新建第二套解析或打开路径。未解析（`unresolved`）时 SHALL 只给提示，MUST NOT 创建文件——自动创建是作者没做过的动作，提示里既有的「创建并打开」显式入口不变。
2. **外链**（scheme 属于白名单）：SHALL 交给系统默认应用打开（见下）。
3. **其余位置**（不在链接上、或落在本版不支持的链接形态上）：SHALL 无操作——不产生任何打开请求、不移动选区、不给反馈；不支持的链接形态在渲染层就是原文，没有"看起来能开"的外观，因此无操作与外观自洽。

外链打开的 scheme 白名单（`http` / `https` / `mailto`，大小写不敏感）SHALL 在 Rust 侧校验并作为**打开许可**的唯一权威判定：前端可以按同一白名单决定"是否渲染成外链、是否发起打开请求"这类呈现层判断，但 MUST NOT 以自身判断代替校验；scheme 不在白名单内、或目标还原后含空白 / 控制字符时，后端 SHALL 拒绝并返回 `open_url_rejected` 错误信封（前端按人话 toast 展示），MUST NOT 交给系统打开。

打开链路 SHALL 只有一条：webview MUST NOT 被授予 `opener` 插件的任何直接调用权限（capabilities MUST NOT 新增 `opener:*` 条目），唯一入口是本仓的 `open_external_url` command；插件自身注入的「点击 `<a target=_blank>` 直接开浏览器」脚本 SHALL 关闭——那是绕开校验的第二条打开路径。

每次打开尝试（成功 / 被拒 / 系统调用失败）SHALL 落下一条 `link_open` 诊断事件（`LogEventName` 成员），字段 SHALL 只有 `scheme`（归一后的协议名，白名单外与无 scheme 归 `other`）与 `outcome`（`opened` / `rejected` / `failed`）。URL 原文 MUST NOT 写入日志——URL 是文档内容，`logging` 的隐私边界（负载里没有文档正文与键入内容）优先于排查便利。

#### Scenario: ⌘⏎ 打开光标处的外链

- **WHEN** 光标落在 `[示例站点](https://example.invalid/site)` 的显示文本内，按下 `⌘⏎`
- **THEN** 系统默认应用打开 `https://example.invalid/site`；诊断日志出现 `link_open`（`scheme=https`、`outcome=opened`），日志中没有该 URL 原文

#### Scenario: ⌘-Click 与 ⌘⏎ 同一路径

- **WHEN** 在 `[写邮件](mailto:someone@example.invalid)` 上 `⌘-Click`，随后在 `[包裹形式](<https://example.invalid/wrapped>)` 上把光标移入并按下 `⌘⏎`
- **THEN** 两次打开的目标分别是 `mailto:someone@example.invalid` 与 `https://example.invalid/wrapped`（尖括号包裹形式开的是里面的目标），走的是同一条命令实现

#### Scenario: wikilink 两态

- **WHEN** 光标落在一条已解析的 `[[note]]` 上按下 `⌘⏎`；随后落在一条未创建的 `[[missing]]` 上按下 `⌘⏎`
- **THEN** 前者打开 `note.md` 并按锚点定位（既有链路，行为不变）；后者只弹出未创建提示，vault 里 MUST NOT 出现新文件——除非作者在提示里点了「创建并打开」

#### Scenario: 非白名单 scheme 被拒

- **WHEN** 光标落在 `[别开我](javascript:alert(1))` 上按下 `⌘⏎`
- **THEN** 不产生任何打开请求（该形态在渲染层就是原文，跟随命令判定为"不在支持的外链上"）；即使前端判断失误把非法目标递到后端，`open_external_url` 也 SHALL 独立拒绝并返回 `open_url_rejected`

#### Scenario: 光标不在链接上无操作

- **WHEN** 光标停在普通正文里按下 `⌘⏎`
- **THEN** 不打开任何 URL、不弹提示、文档与选区都不变

## MODIFIED Requirements

### Requirement: 鼠标路径的 ⌘ / ⌃ 拆分

`⌘`-Click SHALL 跟随光标处（点击位置）的**链接**——wikilink 或外链——命中链接时阻止选区落点并激活链接；`⌃`-Click SHALL NOT 被当作链接激活——`⌃`-Click 在 macOS 是系统级次级点击（右键等价手势），MUST 让回系统；裸点击 SHALL 不拦截（链接文本可正常落点编辑）。该拆分与 D1 的键盘拆分同源：`⌘` 系归 mac 惯例、`⌃` 系归 Emacs / 系统手势。

wikilink 的跟随需要 vault 上下文（解析基准是当前文件），没有打开中的 md 文件时 `⌘`-Click 不跟随；外链的打开不需要 vault 上下文，`⌘`-Click 照常生效。

#### Scenario: ⌃-Click 不跳转、⌘-Click 跳转

- **WHEN** 在含 `[[target]]` 的文档里先 `⌃`-Click 该链接，再 `⌘`-Click 该链接
- **THEN** 第一次不跳转（仍在原文件、无提示，选区正常落点）；第二次跟随链接打开目标文件

#### Scenario: 无 vault 上下文时外链仍可开

- **WHEN** 没有打开中的 md 文件（无 vault 上下文），在文档里 `⌘`-Click 一条外链
- **THEN** 外链照常交给系统默认应用打开（外链打开不依赖 vault 上下文）
