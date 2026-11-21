# Design: 粘贴 URL 自动取标题

## 1. 链路总览

```
DOM paste (text/plain)
  └─ pastedHttpUrl(text)            纯判据：整段恰好一个 http(s) URL？
       ├─ 否 → 既有 paste 路径逐字节不变
       └─ 是 → view.dispatch(插入 URL，userEvent=input.paste)
                + addPendingUrlTitle（StateField 记区间）
                + port.fetchTitle(url)（异步，Rust fetch_url_title）
                     ├─ 失败 / null → 移除 pending，文档不再变
                     └─ 成功 → 读当前 state 的 pending（已随事务映射）
                          └─ urlTitleReplacement(doc, pending, title)
                               ├─ 区间文本 ≠ 原 URL → 移除 pending，放弃
                               └─ 是 → view.dispatch(替换为 [title](url)，userEvent=input.paste)
```

## 2. 为什么先落地 URL 再异步升级

- 网络可能 5 秒超时；等标题返回再插入会让「粘贴」这个动作看起来丢字 / 卡住。
- 失败路径因此天然是「什么都不做」：URL 已经在文档里，无需回滚、无需 toast、不会留下半截状态。
- 代价是成功路径多一次文档变更（第二次事务）。两次都用 `userEvent: "input.paste"`，撤销栈
  正常工作：先撤掉标题升级回到 URL，再撤掉 URL 本身；不把异步结果塞进「不记录历史」的旁路，
  也不手改 history。

## 3. 区间映射与改写闸门

`pendingUrlTitleField: StateField<PendingUrlTitle[]>` 存在每个会话 state 里：

- 每个 pending 带 `{ id, from, to, url }`；
- 任何 `tr.docChanged` 都用 `tr.changes.mapPos` 映射：`from` 用 assoc 1、`to` 用 assoc -1——
  边界外插入的新文本不会被吞进区间；
- 标题返回时只认当前 state 里的同名 pending，并用 `doc.sliceString(from, to) === url` 再判一次；
- 区间内编辑 / 撤销粘贴 / 文档重载 → 切片对不上或 pending 不存在 → 只移除 pending，不写文档；
- **切走即取消**：`activate()` 离开会话时立即把该会话的 pending 撤清（只换代它的 state，
  不向即将被换掉的 view 派发）；切回不会恢复或补写；
- 标题响应在非前台（inactive）到达时，撤清 `session.state` 里该会话的 pending，MUST NOT 对
  当前前台 view 派发；关闭标签时 state 直接丢弃；整篇重载（`loadedState` / 前台装载事务）
  同样带撤清 effects。

`id` 由模块级自增计数器分配，同一文档里多次粘贴互不覆盖。

首次粘贴与标题升级都带 `isolateHistory.of("full")`：两次事务各自独立进撤销栈，第一次撤销只回
URL、第二次回粘贴前；失败路径只派发撤账 effect，不产生额外文档事务 / 撤销事件。

## 4. 接管边界

只在以下全部成立时接管：

1. `pasteUrlTitlePort !== null`（装配层接线）；
2. `active.mode === "md"` 且 `active.editable`；
3. `view.state.selection.main.empty`；
4. `pastedHttpUrl(clipboardData.getData("text/plain")) !== null`。

图片通道在 paste 处理器里先判（`imagePasteItemIndex`），有 `image/*` 文件项时直接消费事件，
不进入本分支。非空选区放行给 CM 的默认粘贴 / `pasteURLAsLink`；HTML-only / 只有文件项时
`text/plain` 为空，`pastedHttpUrl` 返回 null，落到既有的严格空操作闸门。

`pastedHttpUrl` 用 `new URL()` 校验（不是手写 URL 正则），要求整段无前后空白、无内部空白 /
控制字符、协议 http(s)、host 非空；返回**原始文本**（不写 `new URL().href` 的规范化结果）。

## 5. 标题 → 纯文本链接标签

`markdownLinkLabel(title)`：

1. 控制字符 → 空格；`\s+` 折叠为一个空格；trim；
2. 空 / 超过 500 字符 → null（失败保留 URL）；
3. 对 `\`、`` ` ``、`*`、`_`、`[`、`]`、`<`、`>`、`~`、`^`、`$`、`|`、`&`、`:` 做 CommonMark
   反斜杠转义。CommonMark 只对 ASCII 标点认反斜杠转义，因此这些字符渲染回字面文本；标题里的
   `[x](url)`、`<b>`、`*斜*`、`` `码` ``、`|`、`$x$`、`:smile:` 都不会变成结构。

URL 目标用 `escapeDestination` 转义 `\`、`(`、`)`、`<`、`>`；`links.ts` 的
`decodeEscapes` 在解析时还原，分类 / 打开拿到的仍是 URL 原文。

## 6. Rust `fetch_url_title`

- 命令：`#[tauri::command(rename_all = "snake_case")] pub async fn fetch_url_title(url: String)
  -> Result<Option<String>, CommandError>`；阻塞客户端（连同它的构建与销毁）整体放进
  `tauri::async_runtime::spawn_blocking`（与 `vault_list` 同线程语义）。MUST NOT 写成
  `#[command(async)]` + 同步 body：那条路径的 body 跑在 async 运行时的 worker 上，
  `reqwest::blocking` 在 debug 构建里自建的 shell runtime 在 worker 上 drop 即
  `Cannot drop a runtime in a context where blocking is not allowed`，命令永不返回
  （fix/url-title-blocking-nov21 的现场与回归）。
- 网络：复用 `reqwest::blocking`（Cargo.toml 已有，`blocking` + `rustls-tls`），不新增依赖。
  `Client::builder().timeout(5s).user_agent("Lumir/<crate version>")`。
- 边界：`Url::parse` 后只接受 http / https；非 2xx → `Ok(None)`；`Content-Type` 头部必须存在，
  取第一个 `;` 前的 media type、trim 后**精确等于** `text/html` 或 `application/xhtml+xml`
  （`text/html-anything` 不接受），否则 `Ok(None)`；显式 `charset` 不是 UTF-8 → `Ok(None)`；
  正文 `take(512 KiB)`；`String::from_utf8_lossy` 后交给纯函数 `extract_title`。网络 / 读取失败
  是 `Err`，非 2xx / 无可用标题是 `Ok(None)`。
- `extract_title`：大小写不敏感找 `<title`（标签名边界 + 跳过 HTML 注释与 `script` /
  `style` / `textarea` raw-text），取 `>` 与 `</title` 之间；解码 `&amp; &lt; &gt; &quot;
  &apos; &nbsp;` 与数字实体；控制字符 → 空格、空白折叠；空 / 超 500 字符 → None。
- 已知边界：不解析完整 DOM、不执行 JS；`script` / `style` / `textarea` raw-text 已跳过，
  但属性里含 `>` 等更复杂的页面仍可能取不到；GBK 等非 UTF-8 页面视为无标题（不猜编码、
  不引入第二个解码器）。这些都走「保留 URL」，不构成数据损坏。

## 7. 失败与用户可见面

失败路径**不弹 toast**：粘贴已成功，取不到标题不是用户需要行动的错误。错误信封只用于调试 /
未来埋点；编辑器在 `fetchPastedUrlTitle` 里 catch 后按「无标题」处理。

## 8. 测试策略

- 纯函数单测（`tests/unit/paste-url.test.ts`）：URL 识别、转义后用真 markdown 解析器回读、
  区间映射、改写闸门、长度上限。
- chromium 视觉场景（`tests/visual/scenes/url-paste-title.spec.ts`）：合成 paste、桩的
  `fetch_url_title` 成功 / null / reject / 延迟，验 URL 先落地、成功替换、失败保留、等待期编辑
  放弃、区间外映射、两次 undo + dirty、并发粘贴、切走/切回、inactive 响应、关闭标签、整篇
  重载、有选区不接管、非 URL / Markdown 逐字节不变。
- Rust 单测（`src-tauri/src/url_title.rs`）：HTML 标题提取 / 实体 / 注释 / 长度 / charset；
  用 `127.0.0.1` 一次性 TCP server 覆盖 200、404、非 HTML、无标题、GBK、超时，全部离线。
- 真机场景 269 B / C 段：`.invalid` 网络失败保留 URL；loopback dev server 成功取标题并 ⌘S
  验证磁盘源码。
