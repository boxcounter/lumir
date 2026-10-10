# Design: harness-composer-image-paste

技术设计说明。节点 1 评审以 proposal.md 为准；本文记录实现期的技术选型与行为合同细节，供实现 worker 与
归档评审对账。

**术语**：沿用既有制品——**composer** = harness 面板的混排输入区（`contenteditable`，`div.lumir-hp-composer`）；
**block / 块** = composer 的顶层单元（`ComposerBlock`）；**图片卡片**（本 change 自造词，就地定义）=
本 change 新增的第三类顶层块，视觉上是图片缩略图 + 元信息 + 移除钮的原子卡片；**harness 附件**（本 change
自造词）= 落 `<config_dir>/harness/attachments/<vault 稳定 id>/` 下的内容寻址图片文件（与 vault 附件物理分开）；
**投递投影**（本 change 自造词）= 把混排块序列映射为 Responses `input` 数组 content parts 的纯函数。

## 1. 调研结论（现状事实锚点）

以下全部经只读调研核实（worktree wt-424 @ e13739a），是设计决策的事实基础：

- **user 消息项今天是单一 `input_text`**：`session::user_item(text)`（`src-tauri/src/harness/session.rs:453`）
  产出 `{"role":"user","content":[{"type":"input_text","text":…}]}`；`turn::run_turn_for` 用它入
  `Session.input`（`src-tauri/src/harness/turn.rs:242`）。assistant 项走 `assistant_item`
  （`session.rs:472`，空正文不发消息项，M372）。请求体只在 `llm.rs:408-415` 拼一次
  （`model` / `instructions` / `input` / `tools` / `tool_choice` / `stream`）。
- **JSONL 记的就是 `request.input`**：`record_llm_request`（`turn.rs:577-593`）把传给 client 的同一个结构化
  `Request`（`system` / `input` / `tools` / `params`）落 `llm_request` 记录，注释自陈「记录点与发送点同点、
  无二次序列化」。→ **input 项里若内联 base64，JSONL 就内联 base64**，且会话后续每一轮 `llm_request.messages`
  都再存一份。这是裁决点 2 的机制事实。
- **恢复路径从 wire 项重建面板**：`restored_panel_messages`（`src-tauri/src/harness.rs:654`）逐项扫
  `restored`（= 上一条 `llm_request` 的 messages），user 项经 `message_content_text`（`harness.rs:597`：
  数组里逐 part 取 `part["text"]` 拼接）落 `PanelMessage.text`。→ 图片要让恢复路径还原，**必须能从 wire 项
  里读出**（引用形态天然满足：`image_url` 就在 part 上）。
- **composer 的块模型与序列化**：`ComposerBlock = quote | msgquote | paragraph`（`src/quote-card.ts:50`）；
  `serializeQuoteMessage(blocks)`（`quote-card.ts:157`）把块序压成**一个字符串**（`<quote>` / `<msg-quote>` /
  段落文字，XML 转义、零编号）；发送路径 `src/harness-panel.ts:4670` 调它，把字符串交 `harnessSend(text, context)`。
  拆段插入 `insertBlockAtCaret`（`harness-panel.ts:253`）对任意块生效（卡片是原子块，两条卡类共用）。
- **粘贴今天只收 text/plain**：`harness-panel.ts:4831` 的 paste 处理器 `preventDefault` 后
  `getData("text/plain")`，空则不动作；drop 同口径（`:4845`）。**图片字节在这里被丢**。
- **前端已有可复用的贴图判据与载荷段**：`imagePasteItemIndex(session, items)`（`src/paste-image.ts:55`，
  只判「md 模式且可编辑 + 剪贴板含 `image/*` 文件项」，返回序号）与 `blobToBase64(blob)`
  （`paste-image.ts:88`，分块 btoa）。注意 `imagePasteItemIndex` 的 `session.mode/editable` 判据**对 harness
  不适用**（composer 没有编辑器模式），复用的是「items 里找 `image/*` 文件项」这一步语义。
- **后端贴图原语**（vault 附件链路，`src-tauri/src/fs_io.rs`）：`attachment_target`（`:1761`，mime → 是否转码 +
  扩展名）、`transcode_png_to_webp`（`:1799`，纯 Rust 无损）、`short_hash`（`:1776`，转码后字节 SHA-256 前 16 位）、
  `write_attachment_atomic`（`:1903`，原子写 + 撞名不覆盖）、`resolve_attachment_dir`（`:1831`，vault 内解析，
  逃逸防护）——最后这个**不能复用**（harness 附件不在 vault）。
- **配置目录与留存目录**：`config::config_dir()`（`src-tauri/src/config.rs:822`，`$XDG_CONFIG_HOME` 或
  `~/.config/lumir`）；会话留存 `<config_dir>/harness/sessions/<vault 稳定 id>/`（`harness/jsonl.rs:74` 的
  `sessions_dir` 与 `:103` 的 `vault_sessions_dir`，M425 已合并落地）→ harness 附件取**兄弟根**
  `<config_dir>/harness/attachments`，其下按**同一个 vault 稳定 id** 分层（§5，2026-10-10 裁决）。
- **vault 稳定 id 已在手**：`VaultScope.vault_id`（`harness.rs:64`，M425 落地）——harness 侧落点解析不需要新造
  查表；目录名字符集纪律复用 `jsonl.rs:96` 的 `vault_dir_name`（`valid_id` 通过且 ≠ 保留名 `_orphaned`）。
- **模型能力声明链**：`HarnessModelSpec {id, effort, window}`（`config.rs:567-577`）→ 逐项校验
  `validate_harness_model_specs`（`config.rs:1454`：缺 `effort` → false + warning、类型不符丢该项）→ 读取点
  `effort_supported`（`config.rs:633`：精确匹配、未列出 = false、mock 恒 true）。→ `vision` 键**照抄这条链**。
- **真 provider 冒烟的既有先例**：`src-tauri/tests/harness_real_deepseek.rs`（`#[ignore]`、从
  `~/.config/lumir/config.json` 原地读 key、无 key 自动 SKIP、key 绝不打印、模型 id 可用环境变量临时覆盖）。
- **既有缺口（如实登记）**：M373/M381 落地的「`models` 逐项能力声明（`effort` / `window`）」**尚未进 living
  spec**——`openspec/specs/harness/spec.md` 的「配置节 [harness]」没有 `models` 表。本 change 只为 `vision`
  写 ADDED requirement（见 §6），不顺手把既存的 `effort` / `window` 补进 spec（那是别处的 scope，另立 finding）。

## 2. 设计合同与输入

- 设计合同：本 change 的 `specs/harness/spec.md` 增量（ADDED ×3 + MODIFIED ×1 及其验收场景）。
- 行为基准：living spec 的「混排对话输入区」「引用消息序列化协议」「会话本地留存」「上下文注入与可见性」
  （`openspec/specs/harness/spec.md:315 / 334 / 258 / 42`）；composer 的换行/视口质量合同
  [docs/specs/harness-composer.md](../../../docs/specs/harness-composer.md)（新块类 MUST NOT 破 HC1/HC2）。
- NOT 清单：图片生成/编辑、Files API、URL 形态、一次多图、附件 GC、历史会话图片迁移、前端独立能力提示
  （proposal §Non-goals）。
- **一致性原则**（Alex 2026-10-06，全文适用）：投递给模型的上下文要素对人必须也可查——图片卡片把"图进了上下文"
  这件事对人是可见的（卡片可看、可移除、发送后可回顾）；被丢弃的图片（如能力闸拦下的消息）MUST NOT 假装已投递。

## 3. 数据模型：ImageCard 与第三类块

```ts
/** harness 附件引用（内容寻址名，如 pasted-<hash16>.webp）——单文件系统名的单一真源。 */
interface ImageRef {
  /** 内容寻址文件名 `pasted-<hash16>.<ext>`。序列化与留存里用的就是它。 */
  name: string;
  /** 原始剪贴板 mime（仅供前端显示/诊断，不进投递内容）。 */
  sourceMime: string;
}

/** 图片卡片数据。 */
interface ImageCard extends ImageRef {
  /** 缩略图渲染用的字节来源：卡片渲染时经读回命令取（见 §5）。 */
  /* 不落 data URL 进数据模型——避免 base64 渗进快照与 JSONL */
}

/** 混排块（新增第三类变体）。 */
type ComposerBlock =
  | { readonly kind: "quote"; readonly card: QuoteCard }
  | { readonly kind: "msgquote"; readonly card: MessageQuoteCard }
  | { readonly kind: "image"; readonly card: ImageCard }   // 本 change 新增
  | { readonly kind: "paragraph"; readonly text: string };
```

- **原子块**：`isCardBlock`（`harness-panel.ts:237`）扩展纳入 `image`——拆段插入、光标落点、移除、整体选择
  全部与既有卡片同语义，**零新机制**。
- **不塞进 QuoteCard / MessageQuoteCard**：卡片的「核」（file/lines、role/at）与图片语义无关；沿用 M423 的
  判据（`quote-card.ts:90` 一路的「角色字段是判别键」思路），用 `kind` 作顶层判别。
- **元信息行内容**：卡片元信息行**从文件名开始**（内容寻址名 `pasted-<hash16>.<ext>`），**无 `image ·`
  类型前缀**——Alex 2026-10-10 看 demo 后裁决：该前缀不提供有效信息、还占卡片空间（原型的名字行形态是
  `image · <name>`，据此改准）。尺寸（`W×H`）排在其后，由落盘命令一并回传（后端解码时已知）；元信息行不进投递内容。

## 4. 投递协议：content parts 投影

### 4.1 投影函数

`serializeQuoteMessage(blocks): string`（现有）保留为**文本面**的序列化（`<quote>` / `<msg-quote>` / 段落）。
新增一个**投递投影**（纯函数，`src/quote-card.ts` 或同层新模块）：

```ts
type DeliveryPart =
  | { kind: "text"; text: string }                  // 已 XML 序列化的文本块（可为多行）
  | { kind: "image"; name: string };                // harness 附件名

function serializeDelivery(blocks: readonly ComposerBlock[]): DeliveryPart[];
```

规则：**按块序走**——连续文本块累积成一个 `text` part（多块之间以 `\n` 连接，与既有序列化一致），遇到
`image` 块则 flush 当前文本 part、推一个 `image` part。因此 `[段落, 图, 段落]` → `[text, image, text]`，
交错顺序逐位保留（裁决点 4）。

向后兼容：纯文本/卡片消息的投影是**单** `text` part，与今天逐字节一致（`serializeQuoteMessage` 仍是它的
文本字段，现有消费者不受影响）。

### 4.2 Rust 侧：内容数组与引用

- `session::user_item` 扩展为接受投递投影：产出
  `{"role":"user","content":[{"type":"input_text","text":…}, {"type":"input_image","image_url":"lumir-attachment://<name>"}, {"type":"input_text","text":…}]}`
  ——`input_text` part 逐个来自投影的 `text` part；`image` part 的 `image_url` 是 **harness 附件引用**，
  带自定义 scheme `lumir-attachment://`（不是 data URL，见 §4.3）。
- **`harness_send` 的入参形态**：现有签名 `harness_send(message: String, context_json: String)`（`harness.rs:862`）。
  投递投影是**有序 parts**，字符串承载不了交错，故改为把投影整体作为 JSON 传入（`message` 字段沿用为
  「序列化文本」以便面板/留存读，或新增 `parts_json`；实现期定其一，**不得**让同一语义有两处真源）。
  前端仍是序列化的唯一执行者（与现状分工一致），Rust 只做「parts → content 数组」的构造。
- **面板消息文本**：`PanelMessage.text` 仍需要一个**单字符串**形态（transcript 渲染 + 快照恢复 + 摘录手势的
  文本面）。投影里的 `image` part 在面板文本里落成一个占位元素（如 `<image ref="pasted-….webp"/>`）——
  **面板文本与投递 parts 是同一块序列的两个投影**，两者 MUST 在**同一个函数**里产出（REVIEW.md 第 8 条：
  不允许两处各写一份、各判一次），且面板文本**不进模型上下文**（模型看到的是 `input_image` part）。
  实现期必须钉住「同一块序列 ⟺ 同一投影」（round-trip 单测）。

### 4.3 引用展开：JSONL 无 base64

- **会话侧（内存 input 项 / JSONL 留存）恒为引用形态**：`image_url` = `lumir-attachment://<name>`。
  → `record_llm_request` 落的 `messages` 天然不含 base64（裁决点 2）。
- **wire 展开点**：`ResponsesClient::complete_inner`（`llm.rs:408`）在 `.json(&body)` 之前，把 `input` 数组里的
  `lumir-attachment://` 项就地换成
  `{"type":"input_image","image_url":"data:image/<sub>;base64,<…>"}`（`<sub>` 由附件扩展名映射；取字节的落点
  按当前会话作用域的 vault id 解析，见 §5.2）；读文件失败 → 本轮以人话错误收口（MUST NOT 发一条静默缺图的请求）。
- **恢复充分性口径的修订（诚实声明）**：living spec 的「会话本地留存」判据是「仅凭 JSONL 逐字节重建任意一轮
  发给模型的请求」。引用形态下，重建 = JSONL（引用）+ harness 附件的**同 id 目录**（`attachments/<vault 稳定 id>/`，
  内容寻址名 → 字节）。因为文件名是
  内容寻址的哈希，`ref → 字节` 是确定性的；spec 增量把这条口径写实（不是放宽"逐字节"，而是补上"字节在哪个
  共存制品里")。这是**知情的口径收窄**，实现期须在 spec 与 design 两侧一致。
- **mock provider**：不发生网络请求，按其契约消费 `Request`（mock 的 `MockClient::complete`）。测试/验收要断言
  「wire 上真的是 `input_image`」，因此给 mock 一条与真 client 同路的**展开投影**（抽出纯函数
  `expand_image_refs(input) -> Vec<Value>`，真 client 与 mock 都调它），验收场景断言展开后的形状（§9）。

## 5. harness 侧存储与读写命令

### 5.1 落点与目录命名纪律（2026-10-10 裁决：按 vault 分层）

```
<config_dir>/harness/attachments/          ← 附件根（sessions/ 的兄弟目录）
├── vault-1234-1/                          ← 目录名 = vault 注册表稳定 id
│   ├── pasted-<hash16>.webp
│   └── ...
└── vault-1234-2/
```

- **目录名 = vault 稳定 id**：不 hash、不消毒、不加前缀（消毒名有撞名面，M309 现场）；与
  `sessions/<vault 稳定 id>/`（`jsonl.rs:103` 的 `vault_sessions_dir`，M425 已落地）、`vault-sessions/<id>.json`、
  `reading-positions/<id>.json` 共用同一份身份。这一层正是 M433 finding 点出的 M425 排依赖缺口
  （`docs/backlog.md`「harness 附件落点未按 vault 分置」）：改齐后一个 vault 的**引用与字节**落在同名目录下，
  成对可取（见 §5.5）。
- **id 的来源**：`VaultScope.vault_id`（`harness.rs:64`，M425 落地）——粘贴时面板所在 vault 的 id 已在手，
  写命令不新造查表；目录名字符集纪律复用 sessions 的 `vault_dir_name`（`jsonl.rs:96`：`valid_id` 通过且
  ≠ `_orphaned`）。
- **不可归属的处置（与 sessions 不同，如实说明）**：sessions 的 `_orphaned/` 桶服务两处——**一次性归位脚本**的
  保底存放（存量平铺文件搬不动），以及**运行时非法 id 的防御分支**（`vault_sessions_dir` 对不合格 id 记 stderr
  后按 `_orphaned/` 落盘，`jsonl.rs:103`；sessions change design §2 同款明文，该分支被标注为不可达）。附件
  **零存量**（本能力尚未实现、线上零附件数据），没有归位面，故 **不建 `_orphaned/` 桶、不写归位脚本**。剩下的
  唯一「不可归属」是**写时拿不到合格 vault id**（作用域缺失 / id 形态非法，理论上仅发生在无 vault 打开时）：
  处置 = **拒绝落盘** + 人话错误（前端 toast、不插卡片、无半截文件），MUST NOT 落进任何兜底目录——附件读路径
  按当前 vault id 解析，落进兜底目录即永远命不中，等于静默缺图，违背 §2 一致性原则（被丢弃的图片 MUST NOT
  假装已投递）。
- **首次写时创建** `attachments/<id>/`（`create_dir_all`，与 `vault_sessions_dir` 同口径）。MUST NOT 触碰 vault。

### 5.2 命名、去重边界与引用解析

- **文件名**：`pasted-<hash16>.<ext>`，哈希 = **转码后字节**的 SHA-256 前 16 位（与 vault 附件同口径，
  `fs_io.rs:1776`）；扩展名由 `attachment_target`（`fs_io.rs:1761`）决定：png → webp（无损转码）、jpeg / webp
  原样、其余拒绝。
- **去重范围 = 当前 vault 目录内**：写前 `exists` 判定即可（**不做** vault 那样的全 vault 扫描）。
- **同一张图贴进两个 vault 会各存一份**——分层布局的诚实代价（换来了 vault 边界清晰与成对归档）。
- **引用名不是全局唯一（分层带来的新事实）**：`pasted-<hash16>.<ext>` 只在**本 vault 目录内**唯一。因此**读回与
  展开 MUST 按当前会话作用域的 vault id 解析**（`attachments/<id>/`），MUST NOT 在附件根下做跨 vault 查找——
  那既越界，也把"名字全局唯一"这个错误假设钉进实现。

### 5.3 原语复用（裁决点 3）

把 `transcode_png_to_webp` / `short_hash` / `write_attachment_atomic` 与 `base64_decode` / `ATTACHMENT_MAX_BYTES`
判据**提为共用函数**（同模块内的 `pub(crate)` 或参数化落点解析），新命令
`harness_write_image(data_base64, source_mime) -> { name, width, height }` 只替换「落点解析」为
`attachments/<当前 scope 的 vault id>/`；落点解析失败即按 §5.1 的「拒绝落盘」口径回人话错误。**MUST NOT** 复制
一份转码 / 寻址实现。

### 5.4 读回

新命令 `harness_read_image(name) -> base64`：落点 = `attachments/<当前 scope 的 vault id>/`，限
`pasted-<hash16>.<ext>` 形态、限尺寸、路径逃逸防护同 `fs_io` 口径（解析出的路径必须仍在该 vault 目录内）——供
缩略图渲染与（若需要）恢复期取字节。前端把 base64 转 blob URL 渲染，**数据模型与快照里不落 base64**。

### 5.5 清理 / 归档与 vault 边界（2026-10-10 裁决补口径）

- **删会话不牵动附件**：`harness_delete_session` 只删 `sessions/<id>/<session_id>.jsonl`；附件是内容寻址的，
  同 vault 内可能被多个会话引用，删会话不做引用扫描 → 附件字节**原地保留**（不静默删：只凭一个会话文件无法判定
  哪些字节仍被引用；GC 是 Non-goal）。
- **按 vault 备份 / 归档 = 取同名 id 的两个目录**：`sessions/<id>/`（引用）+ `attachments/<id>/`（字节）成对复制
  即自足的恢复单位——这正是 §4.3「引用 + 字节」恢复充分性口径要求的**共存制品**，分层后二者同 id 可对。
- **vault 注册项消失**（手工移除注册项 / 卷未挂载）：`attachments/<id>/` 成为不可达残留、无自动清理——与 sessions
  的 vault 目录同处置，如实登记，不在本 change 的处理面。
- **附件目录 MUST NOT 触碰 vault**（既有口径不变，ADR 0003）。

### 5.6 上限

沿用 `ATTACHMENT_MAX_BYTES`（50MB），判定在转码前（与 vault 链路同口径）；MUST NOT 降采样（裁决点 5）。

### 5.7 孤儿

不做删除 / 迁移（Non-goal），登记 `docs/backlog.md`；分层后 GC 有了逐 vault 收敛的抓手（一个 vault 的会话与附件
同 id 成对），设计时可按 vault 扫描。

## 6. 能力声明与发送闸

- **声明**：`HarnessModelSpec` 增 **`vision: bool`**（键名 2026-10-10 由 `image` 改名，避免与 `image_generation`
  混淆，见 proposal 评审记录）；`validate_harness_model_specs` 缺 `vision` → false + warning、类型不符 →
  丢该项 + warning（逐字照抄 `effort` 的分支形态，`config.rs:1481-1495`）；新增读取点
  `vision_supported(provider, model)`（照 `effort_supported`，`config.rs:633`；未列出 = false；mock 恒 true）。
- **发送闸（单一判据在后端）**：`harness_send` 在装配前检查——投递投影含 `image` part 且
  `!vision_supported(生效 provider/model)` → 返回 CommandError `harness_image_unsupported`（人话 message +
  `param`：模型名），**不建会话、不入队**。前端收到该 code → toast（新 D-code，zh/en 双档）+ 把该消息里的
  图片卡片标成错误态（边框/底色，卡内保留、可移除后重发）。
  - **不允许两个判据**（REVIEW.md 第 8 条）：前端**不**自行判能力，MUST NOT 让前端也有一个 `vision_supported`
    分支——能力语义只在后端一处产出。
  - 「标出哪张卡」不靠编号（协议与 UI 均无编号，一致性原则）：前端知道自己刚投影的块序列里哪些是图片卡，
    整体标出即可。
- **真机实测（tasks §5）**：Alex 配置里各模型的 `vision` 值由真 provider 冒烟实测得出，不靠猜。

## 7. 手势与装配

- **粘贴拦截**：`harness-panel.ts:4831` 的 paste 处理器改为——若 `event.clipboardData.items` 含 `image/*`
  文件项（复用 `paste-image.ts` 的「找第一个 image file 项」语义），则读该 Blob → `blobToBase64` → 调
  `harness_write_image` → 成功后 `withModel(insertBlockAtCaret(blocks, caret, {kind:"image", card}))`；
  **图优先**（图文同板取图；文本不再走净化），失败 → toast（新 D-code 复用/新增）、不插卡片、无半截文件。
  非图片剪贴板：走既有纯文本净化，逐字节不变。
- **卡片插入落点**：复用 `insertBlockAtCaret`（`harness-panel.ts:253`）——面板未开先开、光标处拆段、插入后
  光标落卡片下一行的段落（与引用卡片 / 消息摘录卡完全一致）。
- **transcript 同构沉淀**：发送后用户消息在 transcript 按相同交错顺序呈现（图片卡片无移除钮，缩略图可见）。
  渲染读字节走 `harness_read_image`。
- **快照恢复 round-trip**：`parseQuoteMessage`（`harness-panel.ts:631`）扩展识别面板文本里的图片占位元素，
  还原 `{kind:"image"}` 块（与 `<quote>` / `<msg-quote>` 同口径）；未知元素维持既有保守行为（MUST NOT 静默丢内容）。
  **历史会话恢复**（`restored_panel_messages`，`harness.rs:654`）从 wire part 的 `image_url` 取回引用、按 §4.2
  的面板文本形态重建。
- **composer 质量合同不破**：图片卡片不占文本行（同卡片），HC1/HC2（`docs/specs/harness-composer.md`）的
  行数/视口判据按「卡片不占文本行」既有口径继续成立——实现期按该合同的生成器把新块类纳入分布。

## 8. 渲染与视觉保真

**原型已过目**（M431 的 composer 贴图交互原型，Alex 2026-10-10 看过后「通过」，唯一调整是元信息行去 `image ·`
前缀）：视觉口径以该原型 + **产品内既有卡片族**为基准，并排对照既有引用卡片（`.lumir-hp-qcard`，
`src/harness-panel.css:1540` 起的一族）与 M423 消息摘录卡。逐面对账：

- **布局节奏**：图片卡片与既有卡片同族——原子块、同一水平缩进、与段落之间同 `margin`；缩略图在卡片内左对齐，
  元信息行（**从文件名开始、无 `image ·` 类型前缀**，Alex 2026-10-10 看 demo 后的裁决）在其右或下方，与
  qcard 的「竖条 + 主区」骨架保持一致的比例感。
- **卡片容器样式**：复用 `.lumir-hp-qcard` 的边框 / 圆角 / 底色（**不新立视觉物种**）；图片卡片不画引号竖条
  （那是引用的语义符号），改用缩略图本身作为左锚——这条差异是本 change 显式的视觉决定，不是遗漏。
- **缩略图**：`object-fit: contain`，高度上限取一行到三行正文的高度档（量级口径，实现期取 token 层既有档位值），
  宽度不超卡片宽；加载中占位与加载失败占位按既有图片占位语义（`attachment-display` 口径）给可见回退，
  **不出现零高度空白**。
- **字层级**：元信息行取现有卡片出处行（`-qc-src`）同一档字号/颜色，不新增字号；行内容**从文件名开始**
  （如 `pasted-<hash16>.webp`），**MUST NOT** 带 `image ·` 之类的类型前缀（Alex 2026-10-10 看 demo 后裁决：
  该前缀不提供有效信息、还占空间），尺寸等信息排在其后。
- **各状态样式**：hover / focus / 移除钮沿用既有卡片；**错误态**（能力闸拦下）用既有
  error 语义色（token 层，不新写色值）+ 一次可见强调；eink 主题按既有 token 降级规则走。
- **手感 / 审美**（缩略图大小选取、错误态强调的强弱）归 Alex dogfood 手感裁决，不进机器判据。

## 9. 验收面（机器判定锚点）

- **真机验收新场景**（scripts/acceptance，mock provider，fixture 全合成）：
  ① 粘贴图片 → 落 `<隔离 config>/harness/attachments/<vault 稳定 id>/`、vault 零新增、composer 出现图片卡片；
  ② 图文同板图优先、非图片粘贴逐字节不变；
  ③ wire 形态：`llm_request.messages` 的 user content 数组按块序含 `input_text` / `input_image` 交错，
     `image_url` 为 `lumir-attachment://` 引用；
  ④ **JSONL 无 base64**：`llm_request` 记录里不含 `data:image` 或长 base64 串（反向断言）；
  ⑤ 能力闸：把当前模型声明成 `vision: false` → 含图片卡的消息发送被挡、toast 出现、卡片错误态可见、会话不推进；
  ⑥ 快照恢复 round-trip：重启后带图消息的图片卡片按原交错还原；
  ⑦ **按 vault 分置**：在 vault A 与 vault B 各贴一张图并发送 → 字节分别落在 `attachments/<A 的稳定 id>/` 与
     `attachments/<B 的稳定 id>/`，两处各自可读回（缩略图可见），跨 vault 目录不被读到。
  - 展开投影（`input_image` → data URL）的断言：mock 走同一条 `expand_image_refs`，场景 ③/④ 一起判"引用在
    JSONL、展开在 wire"两侧。
- **单元/属性测试**（tests/unit，零 DOM）：投递投影的不变量（交错顺序、文本 part 合并规则、纯文本单 part 与今天
  逐字节一致、XML 转义 round-trip、零编号）；面板文本 ⟺ 投递 parts 的双向一致性（同一块序列）；`vision_supported`
  的 config 判定（`effort` 同款负向用例：缺键 / 类型错 / 未列出）；引用展开纯函数（含读文件失败路径的分支）。
- **视觉**：图片卡片（composer 态 × transcript 态 × 错误态 × 加载失败态）新增场景基线，Alex 过目后 `--update`；
  动过 `src/harness-panel.css` 后跑 `gate.sh visual`，既有基线按纪律核对时间戳。
- **门禁**：`scripts/gate.sh quick` 全绿；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。

## 10. 后续项（本 change 不做，登记 backlog）

- **降采样策略**：大图进上下文的 token 成本（裁决点 5 的 B 方案）留 dogfood 数据后另裁。
- **harness 附件孤儿清理**：目录只增不减；何时清、按会话还是按年龄，另案。分层后有了逐 vault 收敛的抓手
  （一个 vault 的会话与附件同 id 成对），GC 设计时可逐 vault 扫描。
- **Files API / file_id 通道**：若 Kimi 端 `input_image` 实测受限（如 data URL 被拒），file_id 是后备路径。
- **living spec 的既有缺口**：M373/M381 的 `models` 逐项能力声明（`effort` / `window`）未进 spec（§1 末条），
  另立 finding 报 tower，不在本 change 顺手扩 scope。
