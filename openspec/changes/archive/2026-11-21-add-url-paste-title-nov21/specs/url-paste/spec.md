# url-paste 增量规格

> 起草注记（非规格正文）：这是新 capability 的第一份 spec。它只覆盖「粘贴一个 http(s) URL 时
> 自动取网页标题」这一条能力；图片粘贴仍归 `clipboard-image-paste`，HTML-only 粘贴的空操作仍归
> `clipboard-image-paste` 的「非图片剪贴板降级」条。实现边界（异步区间映射、Rust 网络参数、
> 撤销 / dirty 口径）见 [design.md](../../design.md)。

## ADDED Requirements

### Requirement: 粘贴 URL 自动取标题

md 模式下、可编辑会话、**空选区**时，若剪贴板 `text/plain` 整段恰好是一个 http / https URL，
系统 SHALL 先按普通粘贴把 URL 原文落地，再异步取该网页的标题；成功时 SHALL 把**同一段 URL**
原地替换为 `[title](url)`，失败时 MUST 保留原始 URL 原文，MUST NOT 产生半截 Markdown、MUST NOT
吞掉文本、MUST NOT 重复插入。

标题 SHALL 按**纯文本**处理：换行与控制字符折叠为空格、连续空白折叠、首尾 trim；`\`、`` ` ``、
`*`、`_`、`[`、`]`、`<`、`>`、`~`、`^`、`$`、`|`、`&`、`:` 等可能在行内制造 Markdown / HTML /
公式 / 表格 / 实体 / emoji 结构的 ASCII 标点 SHALL 以 CommonMark 反斜杠转义写入链接标签，
MUST NOT 让标题变成 HTML 标签、第二条链接、强调、行内代码、表格 cell 或公式。标题为空或超过
500 个字符时 SHALL 视为「没有可用标题」并保留 URL。

异步改写 MUST 以「区间里的文本仍是当初粘贴的 URL 原文」为前提：用户在等待期间于区间内编辑、
撤销粘贴或该段文本被替换时，系统 MUST NOT 改写文档；在区间外键入 / 删除时，区间 SHALL
随事务映射，改写 MUST NOT 落到错的位置。

切换标签 SHALL 采用**切走即取消**：离开会话（切换标签 / 关闭标签）时 SHALL 立即撤清该会话的
取标题 pending，切回 MUST NOT 恢复或补写；标题响应在**非前台**（inactive）到达时 MUST 撤清
该会话的 pending，且 MUST NOT 对当前前台 view 派发任何事务。整篇重载同样 SHALL 撤清 pending。

成功改写与首次粘贴 SHALL 各自是一次独立的 `input.paste` 事务，MUST NOT 绕过 dirty / 撤销栈；
第一次撤销 SHALL 只回退标题升级回到 URL，第二次 SHALL 回退原粘贴，回到粘贴前文本。失败路径
MUST 只撤账、MUST NOT 派发文档变更，也 MUST NOT 多出一次撤销事件。

取标题 SHALL 只对 http / https 发起，并遵守以下网络边界：总超时 5 秒；只接受 2xx 响应；
`Content-Type` 头部 MUST 存在，取第一个 `;` 前的 media type、trim 后**精确等于** `text/html`
或 `application/xhtml+xml`（`text/html-anything` 这类前缀伪装不接受），charset 独立解析；正文
最多 512 KiB；只解码 UTF-8（显式声明非 UTF-8 的页面视为没有标题）；不执行 JavaScript
（`script` / `style` / `textarea` raw-text 里的 `<title>` 不算文档标题）。任一不满足或网络失败 /
超时 SHALL 走「失败保留 URL」路径，MUST NOT 把它变成用户可见的错误提示（粘贴本身已成功）。
网络 / 读取失败 SHALL 返回错误，非 2xx 与无可用标题 SHALL 返回「无标题」——两者在前端都保留
原始 URL，但语义不得混写。

#### Scenario: 成功取到标题

- **WHEN** 在空选区处粘贴 `https://example.invalid/article`，网页返回 200、`text/html` 且
  `<title>` 为 `示例 标题`
- **THEN** 文档先出现 `https://example.invalid/article`，随后原地变为
  `[示例 标题](https://example.invalid/article)`；URL 只出现一次、`[` 只出现一次；一次粘贴只发
  一次取标题请求

#### Scenario: 没有可用标题

- **WHEN** 粘贴一个 http(s) URL，而响应 200 但不是 HTML、没有 `<title>`、标题为空、标题超长，
  或页面显式声明非 UTF-8
- **THEN** 文档逐字节保留原始 URL；没有 `[` 结构、没有重复插入、没有用户可见错误提示

#### Scenario: 网络失败 / 超时 / 非成功响应

- **WHEN** 取标题请求连接失败、超过 5 秒、或返回 404 / 500
- **THEN** 文档逐字节保留原始 URL；粘贴文本仍在、选区 / 撤销栈 / dirty 不被异步失败路径损坏

#### Scenario: 等待期间用户编辑了区间

- **WHEN** 粘贴 URL 后、标题返回前，用户在 URL 区间内键入或删除字符
- **THEN** 标题返回后不产生任何改写；用户编辑后的文本原样保留

#### Scenario: 标题包含 Markdown / HTML 结构字符

- **WHEN** 网页标题是 `[点我](https://evil.invalid) <b>粗</b> *斜* \`码\` | cell | $x$ :smile:`
- **THEN** 生成的链接标签把这些字符按纯文本呈现（反斜杠转义），整份文档仍只有一条链接，
  MUST NOT 出现 HTML、强调、行内代码、公式或第二条链接

### Requirement: 粘贴 URL 取标题的接管边界

自动取标题 MUST 只接管「md 模式 + 可编辑 + 空选区 + 整段 `text/plain` 恰好是一个 http / https
URL」的粘贴。以下粘贴 MUST NOT 进入取标题通道，SHALL 保持既有粘贴行为：

- 剪贴板含 `image/*` 文件项（图片通道优先，归 `clipboard-image-paste`）；
- 非空选区（保留 CM 既有的 `pasteURLAsLink` / 默认替换语义，本能力 MUST NOT 抢）；
- code / text 模式、只读会话；
- 非 URL 文本、URL 前后带空白或正文、`www.` / 裸邮箱 / `mailto:` / `file:` / `javascript:` 等
  非 http(s) 文本、已有 Markdown（如 `[x](url)`）；
- HTML-only / 只有文件项的剪贴板（`text/plain` 与 `text/uri-list` 都为空，仍归既有的严格空操作）。

#### Scenario: 非空选区不接管

- **WHEN** 选中一段文本后粘贴一个 http(s) URL
- **THEN** 不发起取标题请求；正文按既有粘贴路径处理（无论 CM 走 `pasteURLAsLink` 还是默认替换），
  MUST NOT 生成 `[网页标题](URL)`

#### Scenario: 图片 / HTML-only / 非 URL 粘贴不接管

- **WHEN** 粘贴剪贴板图片、只有 HTML 的剪贴板、普通文本或已有 Markdown
- **THEN** 行为与能力存在之前逐字节相同；MUST NOT 发起取标题请求、MUST NOT 改写为链接

#### Scenario: 非 md / 只读会话不接管

- **WHEN** 在 code 模式或只读文档里粘贴一个 http(s) URL
- **THEN** URL 按默认文本粘贴落地（或按只读 / 非 md 的既有规则拒收），MUST NOT 取标题、MUST NOT
  生成链接

#### Scenario: 切走即取消与 inactive 撤账

- **WHEN** 在 A 粘贴 URL 后切到 B；标题响应在 B 前台时到达，随后切回 A
- **THEN** A 的文档仍是原始 URL，MUST NOT 被升级为 `[title](url)`；B 的文档逐字节不变；A 的
  pending 在离开 A 时（或响应 inactive 到达时）已撤清，不得无限滞留

#### Scenario: 两次撤销

- **WHEN** 成功把 URL 升级为 `[title](url)` 后连续按两次撤销
- **THEN** 第一次回到原始 URL，第二次回到粘贴前文本；最终 dirty=false，MUST NOT 留下半截
  `[` / 重复 URL / 额外撤销事件
