# Design: quote 链路一致性修复

- Change ID: `quote-pipeline-consistency-oct24`
- 日期: 2026-10-24

本 change 的四条修法各有一个「为什么不是另一种做法」的判断，集中记在这里。行为口径的
canonical 居所是 `specs/` 增量；本文只记结构决策与取舍。

## D1 失败留痕的载体：结果数组 + 侧表 / 输入区状态行，不动块模型

**问题**：`quoteImagesFromVault` 的旧契约是「失败只 toast、返回成功的卡片」，调用方无法知道
「有几张没进来」。留痕要持久（不是 3 秒 toast），但块模型只有四类块（quote / msgquote /
image / paragraph）——为「未引用」发明第五类块会污染投递投影、草稿与恢复路径。

**选择**：结果数组的元素从 `QuotedImage` 改为判别联合
`{ ok: true, image } | { ok: false, failure }`，**保持数组形态**：

- 装配层（`src/main.ts`）只做 `length === 0` 判空与直传，元素类型变了但源码零改动——这一层
  不在本 mission 的改动面里，契约兼容是硬约束；
- 面板按 `ok` 分拣：成功项走原有插入编排（一次 `withModel` = 一个撤销步）；失败项落到两处
  纯呈现态：
  - **有文本卡片** → `WeakMap<QuoteCard, number>`（与 `imageSourceOf` 同档的人侧侧表），
    卡片出处行渲染「N 张图片未能引用」；整面重渲按同一份表重建，草稿 / 留存不带它；
  - **无文本卡片**（图片悬停引用钮 / 纯图片选区）→ 输入区上方的状态行（`role="status"`），
    下一次引用 / 发送 / 切会话收口。
- 输入区状态行复用出处行的小字样式（`.lumir-hp-qc-src`），**不新增样式面**（CSS 不在本
  change 的改动面）；卡片上的读数接在出处行同一行内，卡片几何零改动。

**为什么不 stuck 在 toast**：Alex 的现场是「点引用 → 报错 → 下一眼图没了」。toast 的生命
周期是 3 秒，留痕要覆盖「下一次看输入区」这个时刻。

## D2 含图读数：从摘录原文派生，不给 QuoteCard 加字段

**问题**：卡片模型没有图片字段是设计（design §4.2「图片块只有一种形态」），而且失锚链的
前缀校验要求摘录原文逐字不变——加字段（哪怕不序列化）会把「卡片数据 = 投递投影的唯一真源」
这条不变量变松。

**选择**：`countExcerptImageRefs(text, filePath?)`（`src/preview/attachments.ts`）由原文派生
计数，渲染时现算：

- 判据与选区枚举 `collectImageRefs` **同源**：标准 md 图片走 GFM 语法树（与编辑器同一
  `@lezer/markdown` 配置）、`![[…]]` 走 `findWikilinkSpans`；代码上下文 / 表格内 / 远程
  http(s) / 非图片扩展不算；同一目标只算一次。
- 计数**只**进人侧读数（D587 角标），不进序列化 / 投递 / 草稿；恢复出的卡片重算得到同一读数
  （原文在，派生在），不需要任何存储。
- 与「引用事务成功了几张」无关：角标回答「这段摘录里原本有什么」，失败读数（D586）回答
  「这次没进来几张」，两个读数各有各的问题。

## D3 会话名回落：同一语义两层实现 + 一份共享 fixture

**问题**：前端活态路径手里是块序列，后端读留存时只有 wire 文本——两层输入形态不同，无法
共享代码。

**选择**：两侧各自实现「取首个非空问题段落」的口径，但**共享同一份素材与期望值**：
`tests/unit/fixtures/session-name-fallback.json` 由前端测试与 Rust 单测各读一遍。fixture 的
`parts` 字段要求由前端 `projectDelivery` 生成并**断言相等**——fixture 不是手抄的 wire 文本，
而是序列化器的输出，从而不能与真实 wire 形态漂移。

后端按 **parts** 遍历而不是先拼串：图片 part 把消息切成若干 text run，拼串会丢掉块边界
（`[段落, 图, 段落]` 会取错段落）。卡片元素按三种序列化形态剥离（`<quote>` / `<msg-quote>` /
`<image …/>`），`<image>` 兼容旧留存的单串形态；元素不完整时按「不是元素」处理（宁可把角括
号写进名字，也不整段丢失）。

**为什么口径一致能修到「浮层行不改名」**：`retitleOpenSessRows` 按**上屏名**匹配（后端快照 /
清单不暴露活跃 session id，无法按 id 匹配）。两侧回落口径一致时旧名相等、改名命中；不一致
时那行就停在旧名上——这正是 Alex 现场看到的形态。

## D4 格式单一真源：Rust 表为准，前端镜像 + 跨层漂移断言

**问题**：可引用格式的判定面横跨三层（预览枚举 / 写入口 / 读回与缩略图），任一处漂移都没有
运行期症状，只在某个格式上「枚举成功、落盘拒绝」。

**选择**：Rust `fs_io::ATTACHMENT_TARGETS`（源 MIME → 是否转码 / 落盘扩展名）是唯一判定面：

- 读回侧（`harness::attachments` 的 `is_attachment_name` / `mime_of_name`）从同一张表的落盘
  列派生，扩展名集合不再各写一份；
- 前端镜像同一张表（`QUOTABLE_TARGETS` → `QUOTABLE_IMAGE_EXTENSIONS` /
  `ATTACHMENT_STORED_EXTENSIONS`，MIME 取既有 `IMAGE_MIME`），缩略图回读 MIME 与引用路径的
  格式预检都从它派生；
- 跨语言共享不了内存，能共享的是同一份清单 + 一条机器判据：
  `tests/unit/attachment-format-drift.test.ts` 解析 Rust 源文件里的表，与前端派生的两份读数
  逐项比对，并附「少一项 / 多一项 / 改一项」的反向输入（断言有区分度）。同族先例：
  `tests/unit/registry-drift.test.ts`。
- **为什么不把表做成运行期 IPC**：预检发生在用户手势的同步路径上（格式判定决定「这张图走不
  走 IPC」），运行期暴露需要一个启动期异步种子 + 桩环境缺省值，多一个失败面；漂移断言在 CI
  就能拦住「后端扩了、前端没跟」，与运行期暴露的效力相同。

**预检与后端的关系**：预检只是「知道得更早的地方说清楚」（省两条白跑的 IPC + 引用语境文案），
后端写原语仍是最后一道闸——它拒绝时的错误信封也按引用语境渲染（`quoteImageErrorText`）。
