# Proposal: quote 链路一致性修复（引用失败留痕 / 会话名回落口径 / 格式面单一真源）

- Change ID: `quote-pipeline-consistency-oct24`
- 日期: 2026-10-24
- 角色: Alex Lee（反馈 / 裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**来源是 Alex 2026-10-24 的现场反馈 #2 / #3 与 tower 立项的修复批**
>（M662；调查结论见 `.local/reports/quote-image-pipeline-oct24.md`，git 外）。tower 在真机
> JSONL 里补了一条关键证据：出事的 quote 会话**自动命名其实成功了**（有 `session_title`
> 记录），所以 #2b 的缺陷不在命名链路，而是呈现层的回落口径。本 proposal 无待裁裁决点；
> SVG 栅格化（survey 方案 C/E）属新能力，**不在本 change 范围**。
> 节点 2（归档评审）：实现完成后填写。

## Why

三处「同一语义两处真源」的现场，共同表现是**用户看到的东西与系统实际做的事不一致**：

1. **引用失败只给 3 秒 toast，且文案说的是「剪贴板」。** 点图片「引用」报
   `Unsupported clipboard image format: image/svg+xml`——引用不是粘贴，写原语的
   `attachment_type_unsupported` 经 `ERROR_COPY` 落到 D436 的剪贴板措辞。更严重的是失败后
   输入区**没有任何持久痕迹**：下一步看到的就是「图凭空消失」（多图引用部分失败时尤其）。
2. **引用卡片没有图片痕迹。** 卡片数据模型没有图片字段（设计如此：图片块只有一种形态），
   但人侧没有任何读数说明「这段摘录里原本有图」——Alex 原话「目前 harness pane 里的 quote
   card 没有提到图片」。
3. **会话名的回落口径泄漏 wire 原文。** 后端 `first_user_text` 取第一条 `llm_request` 的
   wire 原文，只剥注入的编辑器上下文节，**不剥 `<quote>` / `<msg-quote>` / `<image>` 元素**；
   前端活态路径 `firstUserTextOf` 取的是段落原文。历史浮层行名与恢复会话吃后端回落值，于是
   同一段提问在标题栏是干净文本、在浮层里是 `<quote file="…`。口径不一致还让标题事件到达时
   的「按上屏名原地改名」（`retitleOpenSessRows`）匹配不上，那一行就停在旧名上。
4. **格式白名单三层漂移。** 预览层认 10 种图片（含 svg / gif / heic），写入口只收
   png / jpeg / webp，读回侧的名字形态与 MIME 映射又各写一份——枚举认、落盘拒的半成功路径
   由此而来（survey §4.3）。

## What Changes

1. **引用失败留痕 + 引用语境文案**（D585 / D586）：引用事务把失败项**随结果返回**（结果数组
   形态不变，装配层零改动）；失败人话按调用点分码——`attachment_type_unsupported` 在引用路径
   读 D585「暂不支持引用该格式」，粘贴路径的 D436 一字不动。留痕是**持久**的：有文本卡片时
   挂在卡片出处行（「N 张图片未能引用」），没有卡片时落在输入区状态行；两者都随下一次引用 /
   发送 / 切会话收口。
2. **引用卡片的含图派生读数**（D587）：「含 N 张图片」。读数由摘录原文**派生**（GFM 语法树
   的 Image 节点 + `![[…]]` embed，代码上下文 / 表格内 / 远程引用不算，同一目标只算一次），
   **不进**卡片数据模型 / 序列化 / 投递 / 草稿——失锚链的前缀校验要求摘录原文逐字不变。
3. **会话名回落口径收敛**：后端 `first_user_text` 改为「首个非空问题段落」（剥卡片元素、
   折叠空白、还原 XML 实体），与前端 `firstUserTextOf` 逐条同口径；两侧由**同一份 fixture**
   钉住期望值（`tests/unit/fixtures/session-name-fallback.json`，前端与 Rust 各读一遍）。
   口径对齐后，标题事件到达时浮层里当前会话行的旧名相等、原地改名命中。
4. **可引用格式单一真源**：Rust 写入口的 `ATTACHMENT_TARGETS` 是唯一判定面——读回侧的名字
   形态（`is_attachment_name`）与 MIME 映射（`mime_of_name`）从同一张表派生；前端
   `QUOTABLE_IMAGE_EXTENSIONS` / `ATTACHMENT_STORED_EXTENSIONS` / `attachmentMimeOfName`
   镜像同一张表，并由跨层漂移断言（`tests/unit/attachment-format-drift.test.ts`）双向对账。
   引用路径在 IPC 之前做格式预检（与后端同一条表），后端写原语仍是最后一道闸。
5. **顺带修复 `resolveImagePath` 的栈溢出**：ref 自身以 `..` 开头（逃逸 vault 根）时原实现
   拿同一输入递归自己——摘录里带 `![](../../assets/a.png)` 这种路径就在渲染热路径上崩
   `RangeError`。逃逸改为「钳到根」（多余前导 `..` 丢弃），语义与 spec「回退为 vault 根相对」
   一致。

## Non-Goals

- **SVG 栅格化 / SVG 源码按文本投递**（survey 方案 C / E）：新能力，须 Alex 裁决（ADR 术语下
  属新增能力，不在本修复批）。本 change 只保证「失败可见、文案正确、格式判定只有一处」。
- **扩格式白名单**（gif 等）：没有裁决就不扩；本 change 的格式表结构让扩格式只改一处。
- **自动命名链路本身**（prompt / 模型档 / 真机 163/167 场景）：tower 的真机证据表明命名成功，
  本 change 不碰 title 任务。
- **命名失败的可见性**（`decision=error` 只落 stderr）：survey §3.5 的低优先项，另议。

## 影响面

- 前端：`src/quote-image.ts`、`src/harness-panel.ts`、`src/preview/attachments.ts`、
  `src/copy-data.ts`、`文案-Copy.md`（D585–D587）。
- 后端：`src-tauri/src/fs_io.rs`、`src-tauri/src/harness.rs`、
  `src-tauri/src/harness/attachments.rs`。
- 测试与场景：`tests/unit/**`（新增 4 个用例文件 / 更新 quote-image）、`tests/visual/scenes/**`
  （m633 补读数与失败面、新增 m662 会话标题事件）、验收场景 222 加第 ④ 段 + 一个 svg fixture。
- 零协议变更：块模型、投递 parts、会话留存形状、IPC 命令签名都不变（`insertQuoteWithImages`
  的结果元素类型是内部接口，装配层 source 未改）。
