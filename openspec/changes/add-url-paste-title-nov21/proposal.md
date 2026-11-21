# Proposal: 粘贴 URL 自动取网页标题

- Change ID: `add-url-paste-title-nov21`
- 日期: 2026-11-21
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

## Why

### 需求来源（Alex 原话，逐字保留）

> 「贴 URL 自动提取标题（成功 `[title](url)`，失败保留 URL）」

这是 2026-11-21 已下达的需求批中的一条；需求来源为先于本提案的产品裁决，不是 agent 自行发现的
改进项。

### 现状与缺口

现在粘贴一个 URL 只是把 URL 原文插进正文。用户想把它变成可读链接时，得自己去网页复制标题再手写
`[标题](URL)`。本 change 把这一步自动化：URL 先按普通粘贴落地，标题在后台取回后原地升级成
`[title](url)`；取不到就什么都不做，保留 URL——**失败不是错误态**，粘贴本身已经成功。

### 关键约束

- **不能吞文本 / 不能延迟落地**：网络可能慢 / 失败；文档必须先出现 URL，不能等标题返回才插入。
- **不能写坏位置**：用户在等待期间继续编辑，异步返回的改写只能落在「仍是当初那段 URL」的区间；
  区间随事务映射，区间内被编辑就放弃。
- **标题是纯文本**：网页标题不可信，不能把 `<b>`、`[x](url)`、`|`、`$` 等原样写进链接标签变成
  HTML / 第二条链接 / 表格 / 公式；转义规则要有机器判据。
- **不抢别的粘贴**：图片 / 文件 / HTML-only / 已有 Markdown / 非空选区 / code 模式都不归本能力。
- **网络能力在 Rust**：webview 不直接发网络请求（ADR 0002 第 3 条）；`reqwest` 已在依赖树里
  （harness 用），本 change 复用，不新增第三方依赖。

## What Changes

1. **新 capability `url-paste`：粘贴 URL 自动取标题（ADDED 两条 requirement）**
   - 成功：URL 先落地，异步取标题后原地变为 `[title](url)`；失败 / 超时 / 非 2xx / 非 HTML /
     无标题 / 空标题 / 超长标题一律保留 URL。
   - 标题纯文本转义；空选区 + md + 可编辑 + 整段单个 http(s) URL 才接管。
2. **Rust 侧新增 `fetch_url_title` command**：5 秒超时、只认 http(s)、只读 2xx、`Content-Type`
   必须存在且 media type 精确为 `text/html` / `application/xhtml+xml`、正文 512 KiB、UTF-8、
   标题 500 字符；HTML 标题提取是纯函数、可离线单测。
3. **前端新增 `src/paste-url.ts` 纯判据 + `EditorHandle.setPasteUrlTitlePort`**；装配层
   `src/main.ts` 注入 `ipc.fetchUrlTitle`；异步区间用 `StateField` 随事务映射。

## Non-goals

- 不做标题缓存 / 预取 / 后台抓取；一次粘贴只对用户明确粘贴的那个 URL 请求一次。
- 不把标题写进文件名、不修改 URL、不生成引用块或卡片。
- 不接管非空选区（保留 CM 既有粘贴语义）、不接管图片 / 文件 / HTML-only / code 模式 / 只读。
- 不支持 `mailto:` / `file:` / `javascript:` / `www.` / 裸邮箱；只认 http(s)。
- 不引入 HTML 解析库、`encoding_rs` 或新 HTTP 客户端；不执行 JS、不解析完整 DOM。
- 不新增用户可见的「取标题失败」toast / 状态；失败静默保留 URL。

## Impact

- 影响的 specs：新增 `url-paste`。
- 影响的代码：`src/paste-url.ts`（新）、`src/editor.ts`（paste 分支 / 端口 / StateField）、
  `src/main.ts`（端口注入）、`src/ipc.ts`（command 包装）、`src-tauri/src/url_title.rs`（新）、
  `src-tauri/src/commands.rs` 与 `src-tauri/src/lib.rs`（command 注册）。
- 测试：`tests/unit/paste-url.test.ts`（新）、`tests/visual/scenes/url-paste-title.spec.ts`（新）、
  真机场景 `269-url-paste-and-cjk-boundary-nov21` 的 B / C 段。
- 关联约束：ADR 0002 第 3 条（Rust core 承担网络）、ADR 0003 §3（粘贴是用户动作，允许改文档，
  但不改写用户已有内容）；不新增依赖、不更新视觉基线。
