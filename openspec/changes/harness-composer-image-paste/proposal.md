# Proposal: harness composer 粘贴剪贴板图片（图随消息进上下文）

- Change ID: harness-composer-image-paste
- 日期: 2026-10-10
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录：
> 修订（2026-10-10，UX demo 评审）：Alex 看过 composer 贴图交互原型后「通过」，只提一处小调整——**图片卡片
> 元信息行去掉 `image ·` 类型前缀、直接从文件名开始**（proposal 与 design §3 / §8 已改准）。
> 同日第二处修订（命名）：模型图片能力的 config 布尔键由 `image` 改名 **`vision`**——`image` 易与
> `image_generation` 混淆，且 `vision` 与 `effort` / `window` 同为单词、同样式（tower 建议、Alex 未反对；
> **Alex 可推翻**）。proposal / design / tasks / spec 增量已同步改准；配套读取点一并改名
> `vision_supported`（照 `effort_supported` 与键名同形）。**不在改名面内**：错误码
> `harness_image_unsupported`、协议字段 `input_image` / `image_url`、内容侧命名（图片卡片 / `{kind:"image"}` 块 /
> `harness_write_image` / `harness_read_image` / `expand_image_refs`）——它们说的是"图片"这件事，不是配置键。
> 同日第三处修订（落点，Alex 2026-10-10 裁决「按 vault 分层」）：harness 贴图附件与 M425 会话布局的层级不一致
> 按「按 vault 分层」案处理——附件落点由平铺 `<config_dir>/harness/attachments/` 改为
> `<config_dir>/harness/attachments/<vault 稳定 id>/`，与 `sessions/<vault 稳定 id>/` 同族（目录名 = vault
> 注册表稳定 id；附件根与会话根互为兄弟目录，vault 层各自在其下）。贴图功能尚未实现、线上零附件数据，故为
> **纯设计修订**：无归位脚本、不建 `_orphaned/` 桶；写时拿不到合格 id 即**拒绝落盘**（MUST NOT 落兜底目录）；
> 删会话不牵动附件，按 vault 备份取 `sessions/<id>/` + `attachments/<id>/` 同名两目录。proposal / design §5 /
> spec 增量 / tasks 已同步改准。
> 节点 1（提案评审）：留白（待 Alex 裁决）。
> 节点 2（归档评审）：留白（实现完成后填写）。

## Why

Alex 原话（2026-10-10）：「Harness composer 支持黏贴剪贴板里的图片」。
归宿裁决（同日，tower 转述）：「发给模型看」——**多模态**，图片随消息进上下文，模型直接理解截图内容，与
Kimi Code 的贴图体验一致。

**现状锚点**（本提案全部事实性断言都对着 worktree wt-424 @ e13739a 的源码核实）：

- harness 走 **OpenAI Responses API**，请求体的 `input` 数组里用户消息只有一种内容形态：单条
  `{"type":"input_text","text":…}`（`src-tauri/src/harness/session.rs:453` 的 `user_item`；请求体装配
  `src-tauri/src/harness/llm.rs:408-415`）。**今天没有任何图片通道**。
- 模型能力已是**逐模型、config-only 声明**（M373 建、M381 终裁「彻底不使用内置表」）：`HarnessModelSpec`
  `{id, effort, window}` 只来自 `config.json` 的 `[harness].providers.<id>.models`，未声明 = 不支持
  （`src-tauri/src/config.rs:567-577` 的类型、`:633` 的 `effort_supported` 读取点、`:1454` 的逐项校验）。
  图片能力**应进同一体系**，不再另立一套。
- 编辑器侧贴图链路**已经存在**（change `paste-clipboard-image`，2026-10-10 归档）：剪贴板 `image/*` 拦截
  （`src/paste-image.ts:55` `imagePasteItemIndex`）、落盘后端 `fs_io::write_attachment`
  （`src-tauri/src/fs_io.rs:1937`：base64 解码 → 50MB 上限 → PNG→WebP **无损**转码（`:1799`）→
  SHA-256 前 16 位**内容寻址**命名 `pasted-<hash16>.<ext>`（`:1776`）→ **原子写**（`:1903`）。**但归宿不同**：
  它是**vault 附件**（落当前笔记目录、插 `![[文件名]]` 引用、全 vault 去重），harness 贴图不是 vault 附件。
- composer 是**混排编辑区**（`ComposerBlock` 两类变体：`quote` / `msgquote` 卡片与 `paragraph`，`src/quote-card.ts:50`；
  消息摘录卡 M423 刚落地），而**粘贴今天被"净化"成纯文本**：`src/harness-panel.ts:4831` 的 paste 处理器
  `preventDefault` 后只取 `text/plain`，**图片数据被静默丢弃**。这正是本条需求的现状缺口。

**外部信源**（协议形态，非本仓实测）：

- Responses API 的图片输入项形态为 `{"type":"input_image","image_url": …}`，`image_url` 可为 http(s) URL、
  base64 data URL、或 Files API 的 file id；支持 png / jpeg / webp / 非动画 gif
  （[Images and vision — OpenAI API](https://developers.openai.com/api/docs/guides/images-vision)）。
- Kimi 侧：视觉模型支持图片输入，且官方视觉文档**明说 URL 形态暂不支持、只支持 base64 与文件 ID**
  （[配置 Kimi 视觉模型 — Kimi API 开放平台](https://platform.kimi.com/docs/guide/use-kimi-vision-model)）；
  `kimi-k3` 支持文本与图片输入（[Kimi API — 阿里云 Model Studio](https://help.aliyun.com/zh/model-studio/kimi-api)）。
- **本仓未实测**：harness 打的是 Kimi 的 Responses 端点（`src-tauri/src/harness/llm.rs:203`，base_url
  `https://api.moonshot.cn/v1`），该端点对 `input_image` 的**接受性**没有本地证据——列为本 change 实现期的
  真机实测项（tasks §5，先例 `src-tauri/tests/harness_real_deepseek.rs` 的真 provider 冒烟）。实测结论决定
  Alex 配置里各模型的 `vision` 声明值。

## What Changes

逐条对应 `specs/harness/spec.md` 增量里的一个 requirement：

1. **图片粘贴卡片**（harness，ADDED）：composer 粘贴的剪贴板含 `image/*` 数据时拦截粘贴，把图片落
   **harness 侧存储**（`<config_dir>/harness/attachments/<vault 稳定 id>/pasted-<hash16>.<ext>`，按 vault 稳定 id
   分层、与会话留存 `sessions/<vault 稳定 id>/` 同族，**不落 vault**、不改写 vault
   任何文件），在光标处插入 block 级**图片卡片**（缩略图 + 元信息行 + 移除钮；元信息行**从文件名开始**、无
   `image ·` 类型前缀——Alex 2026-10-10 看 demo 后的裁决）；图文同板图优先、多图只取第一张；卡片
   是 composer 原子块（与引用卡片同族的拆段 / 光标落点 / 移除语义），发送后 transcript 同构沉淀，快照恢复
   从留存内容解析还原（与 `<quote>` 同 round-trip 口径）；落盘失败一律人话 toast，不留半截。
2. **图片消息投递协议**（harness，ADDED）：发送时把混排块投影为 Responses 的 content parts——文本块仍按既有
   XML 序列化（`<quote>` / `<msg-quote>` / 段落），图片块产出 `input_image` part，`input_text` 与
   `input_image` **按混排顺序交错**。会话侧（内存 input 项与 JSONL 留存）记的是**附件引用**（内容寻址名），
   `image_url` 在**发送前**由后端展开为 base64 data URL；**会话 JSONL MUST NOT 内联 base64**。历史会话恢复
   路径从引用还原图片卡片。
3. **模型图片能力声明**（harness，ADDED）：`[harness].providers.<id>.models` 的逐项声明新增 **`vision`** 布尔键
   （键名 2026-10-10 由 `image` 改名，避免与 `image_generation` 混淆；与 `effort` / `window` 同一条 config-only
   链）：`true` = 该模型接受图片输入；未声明 / 未列出 = 不支持
   （保守默认，与 `effort` 同侧）。当前生效模型不支持时，含图片卡片的消息**在发送时**被挡下并给人话错误，
   同时标出该消息里的图片卡片——**允许贴入、发送时挡人话错误，不静默吞图**。
4. **混排对话输入区**（harness，MODIFIED）：粘贴净化的作用面收窄——`image/*` 项不再被丢弃，交给上列新能力；
   其余（纯文本 / 富文本 / 非图片文件）粘贴行为逐字节不变。

## Alex 裁决点

| # | 裁决点 | 选项 | 起草倾向 |
|---|---|---|---|
| 1 | provider/模型**不支持图片输入**时的交互 | A. 允许贴入，发送时挡下（人话错误 + 标出图片卡片，用户可移除后重发）；B. 粘贴时就拒绝（不产卡片）；C. 静默降级（丢图或转成文字描述） | **倾向 A**——与 Alex 原话「支持黏贴」一致：贴入的动作不该被能力声明拦住；用户当场看得见卡片、发时得到明确拒绝，比"粘了没反应"好；C 是静默吞图，明确排除 |
| 2 | 图片字节在**会话留存**中的形态 | A. 存 harness 侧内容寻址文件，input 项里记**引用**，JSONL 留存记引用、发送前展开 data URL；B. base64 内联进 input 项（也就内联进每一条后续 `llm_request`）；C. JSONL 只记"有图"标记、不留引用 | **倾向 A**——B 会让同一张图在会话后续每轮请求里各存一份 base64（膨胀且违背"留存记 wire 的轻形态"），C 让恢复路径无法还原卡片；A 的引用是内容寻址名，`ref → 文件 → 字节` 确定性可重建 |
| 3 | 与既有编辑器贴图链路的**复用边界** | A. 复用**原语**（PNG→WebP 无损转码、SHA-256 内容寻址、原子写），不复用 vault 落点解析与 `![[…]]` 引用插入；B. 整链路复用（落 vault 附件目录、插 `![[…]]`）；C. 完全另写一套 | **倾向 A**——归宿不同（harness 存储 vs vault 附件）是裁决定的；B 会把对话产物写进用户 vault（违背"会话留存不落 vault"的既有口径），C 复制转码/寻址逻辑即制造第二个真源（REVIEW.md 第 8 条） |
| 4 | 图片在**投递**里的表达 | A. 混排顺序投影为 content parts（`input_text` 与 `input_image` 按块序交错）；B. 文本单 part + 图片一律追加在末尾；C. 图片只在文本里留一个占位标记、不发 `input_image` | **倾向 A**——混排的语义就是"图与问题交替"，位置是用户表达的一部分；B 丢掉交错、C 等于没把图发给模型（违背本 change 的归宿裁决） |
| 5 | 图片**尺寸策略** | A. 不降采样（沿用编辑器贴图口径：WebP 无损、50MB 上限、分辨率不动），token 由 provider 侧 resize 兜底；B. 客户端降采样/压缩到固定边长上限 | **倾向 A（首版）**——截图上的文字是主要信息，降采样损 OCR 细节；token 成本靠"不自动复制、用户贴几张就几张"控制；B 的具体上限与是否可配留 dogfood 后另裁 |

## Non-goals

- **编辑器贴图链路**：`clipboard-image-paste` 的既有行为（落 vault、`![[…]]` 引用、WebP 转码、全 vault 去重）
  逐字节不变；本 change 只加 harness 侧通道。
- **图片生成 / 编辑**：不发 `image_generation` 工具，不做图生图。
- **Files API / file_id 通道**：首版只走 base64 data URL（Kimi 官方视觉文档虽列了 file id，但需文件上传 API
  另建）；URL 形态排除（Kimi 视觉文档明说不支持 URL）。
- **一次粘贴多图**：剪贴板多图只取第一个 `image/*` 项（与编辑器贴图同口径）；多张要分多次贴。
- **harness 附件的自动清理 / 垃圾回收**：孤儿图片不做迁移、不做删除（与 M309「旧文件不续写、不迁移」同向），
  只落 `docs/backlog.md` 登记。
- **历史会话图片的迁移 / 回填**：旧会话 JSONL 不含图片项，恢复路径不伪造。
- **图片作为「摘录来源」**：消息摘录（M423）MUST NOT 把图片卡片内部当可摘录面（无文本可选）。
- **前端独立的图片能力提示**：能力判据**只在发送路径**（后端单一真源），不在前端另立第二个判据
  （REVIEW.md 第 8 条）；发送前的主动提示样式留 dogfood 后另裁。

## Impact

- **影响的 specs**：`harness`（ADDED ×3：图片粘贴卡片 / 图片消息投递协议 / 模型图片能力声明；MODIFIED ×1：
  混排对话输入区）
- **影响的代码/系统**：
  - src：composer 粘贴拦截与图片卡片块模型（`src/harness-panel.ts` 的 paste 处理器、`ComposerBlock` 扩展、
    卡片渲染与 transcript 同构、快照恢复解析）、投递投影（`src/quote-card.ts` 的序列化面扩展）、纯判据新模块
    （对齐 `src/paste-image.ts` 的分层）、文案表新 D-code；
  - src-tauri：user 消息项内容形态从单 `input_text` 扩为 content parts（`harness/session.rs`）、发送前把附件引用
    展开为 data URL（`harness/llm.rs`）、harness 侧附件的写/读原语（复用 `fs_io` 的转码/寻址/原子写原语）、
    模型声明的 `vision` 键（`config.rs` 的 `HarnessModelSpec` 与逐项校验）、发送闸（`harness_send` 错误码）、
    ts-rs bindings 重导出；
  - scripts/acceptance：新增验收场景（mock provider 下断言 wire 形态与 JSONL 无 base64）；
  - tests/unit、tests/visual：投递投影/解析不变量单测、图片卡片与缩略图基线。
- **关联约束**：M373/M381 的 config-only 模型注册表（`vision` 同体系声明）；一致性原则（Alex 2026-10-06，
  投递给模型的要素对人必须也可查——图片卡片可见、不可见的图不得进上下文）；ADR 0002 §6 性能合同（base64 展开
  在发送线程，不进 keypress-to-paint 路径）；ADR 0007 双向记录（会话留存仍须满足恢复充分性，图片以引用参与）；
  仓库信息卫生（fixture 截图全合成，不搬真实 vault 内容）。

## 观测闸三问（低成本口径）

- **怎么知道用户用了它**：产品零埋点，天然痕迹在 wire 留存——含 `input_image` 项的 `llm_request` 记录可直接在
  会话 JSONL 里 grep 到（`.tower` 外也可查）；dogfood 期 agent 批次收尾顺手统计即可。
- **怎么知道它有效**：主判 Alex dogfood 手感（贴一张截图问它"这里哪里不对"，回答是否真读懂了图）；辅判抽看
  JSONL 里该轮模型的回答是否引用了图里的具体内容（答非所图 = 有效性的负信号，多半是投递形态或模型能力问题）。
- **出问题怎么发现**：机器面兜底——新验收场景（粘贴落盘 / wire 交错顺序 / 引用展开 / JSONL 无 base64 /
  恢复 round-trip / 能力闸），投递投影与解析不变量单测，图片卡片视觉基线；失败路径（落盘失败、能力不支持）都
  有用户可见出口（toast + 卡片标出），不静默。
