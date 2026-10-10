# Proposal: composer 草稿自动保存与恢复

- Change ID: composer-draft-persistence
- 日期: 2026-10-11
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录：
> 节点 1（提案评审）：留白（待 Alex 裁决）。
> 节点 2（归档评审）：留白（实现完成后填写）。

## Why

Alex 原话（2026-10-11）：「现在 composer 里的内容会自动保存和恢复吗？」——真实诉求是：**在 composer 里打的字，
切走再回来（切 vault、重开 app）之后是否还在原位**。今天不会，没有任何草稿持久化。

**现状锚点**（本提案全部事实性断言都对着 worktree wt-445 的源码核实）：

- **composer 内容只在内存里，且真源是 DOM**：块模型由 `readBlocksFromDom()` 每次现从 DOM 读
  （`src/harness-panel.ts:2431-2451`），卡片的块数据挂在 `WeakMap` 缓存 `cardData`（`:2181`）上，撤销史
  `undoHistory` 快照 `{ blocks, caret }`（`:2184-2191`）同样只活在这一段进程里。**没有任何一处把 composer
  内容写进磁盘**（全仓 `src/` 无 `localStorage` / `sessionStorage` 使用）。
- **composer 在三个时刻被清空**：① 发送后（`src/harness-panel.ts:4917-4918`）；② **切 vault 时**
  （`vaultChanged` `:4874-4883`，清空动作在 `:4879-4880`，附注释说明「草稿是在旧 vault 的上下文里写的」）；
  ③ app 启动时（`:5452` 初始化为一个空段落）。
- **勘误（与 mission 转述的上下文不一致，如实登记）**：**切换会话不会清空 composer**。「新会话」
  （`startNewSession` `:5137-5151`）与「恢复历史会话」（`resumeSession` `:5322-5337`）都只调 `resetView()`
  （`:4828-4861`），而 `resetView` **只清 transcript 视图、不碰 composer**。⇒ 今天的实际行为是：同一 vault 内
  切会话，草稿会**串台留着**（在上一个会话里打的字，切到另一个会话后仍在输入区）；真正会丢草稿的是
  **切 vault** 与 **重开 app**。这个事实改变了本 change 的定位（见 What Changes 第 4 条与裁决点 1）。
- **app 重启不仅丢草稿，也不恢复任何会话**：会话表是内存态（`RuntimeInner.sessions`，`src-tauri/src/harness.rs:85`），
  `Runtime::snapshot` 只读内存、**从不读磁盘**（`harness.rs:237-248`），重启后映射为空 → 快照为空 →
  transcript 与 composer 一起是空的（模块文档自陈「app 重启清空」，`harness.rs:6`）。
- **前端既不知道 vault id，也不知道会话 id**：装配层 `applyVault(root, entries, vaultId, restored)`
  （`src/main.ts:2735-2740`）手里有 `vaultId`，但调面板时只传了 root（`main.ts:2790` 的
  `harnessPanel.vaultChanged(root)`）；面板只跟踪 `currentVault`（root 路径字符串，`src/harness-panel.ts:2170`）。
  `harness_state` 快照也不含会话 id（`StateSnapshot` 字段见 `src-tauri/src/harness/session.rs:113-125`），
  `resumeSession` 也丢掉了返回的 `info.session_id`。这是「按什么粒度给草稿编址」的关键约束。
- **会话在本仓是单向追加的日志，不是可来回切换的对象**：新建会话懒建立——`ensure_session`
  （`harness.rs:814-853`）到**首条消息发出时**才铸出 session id（`jsonl::new_session_id`，`jsonl.rs:43-59`）；
  历史会话「恢复」实为**读旧文件灌进一个全新会话、铸新 id、开新文件**（`harness.rs:321-469`）；自动压缩也是
  **转到新文件新 id**（`turn.rs:1007-1099`）。⇒ 会话 id **不稳定、且在「新会话」首条消息前根本不存在**，
  而草稿最常诞生的正是这段「还没有 id」的窗口。
- **后端命令自带当前 vault 的稳定 id**：`VaultScope { root, policy, vault_id }`（`harness.rs:59-66`）由
  `vault_scope()`（`harness.rs:895-902`）解析；已有范例是 M440 的 `harness_write_image`——前端**不传 vault**，
  后端按当前 scope 解析落点（`harness.rs:956-960`）。草稿命令照此即可，前端无需新拿 vault id。
- **同族先例（可直接照搬的落盘纪律）**：per-vault 的 JSON sidecar 已有两份——`<config_dir>/vault-sessions/<id>.json`
  （`src-tauri/src/vault_session.rs:81-82`，命令 `vault_session_get` / `vault_session_put` `:245-260`）与
  `<config_dir>/reading-positions/<id>.json`（`src-tauri/src/reading_position.rs`），**写入纪律同为 tmp + rename
  原子替换**（`vault_session.rs:231-241`、`reading_position.rs:132-141`）；前端对应两个防抖写控制器
  （`SESSION_WRITE_DEBOUNCE_MS = 1000`，`src/vault-switcher.ts:51`；`READING_POSITION_DEBOUNCE_MS = 1000`，
  `src/reading-position.ts:39`），且都在**切 vault 前显式 flush**（`src/main.ts:2744-2745`）。草稿是同一种东西，
  照这条链走即可，不新造机制。
- **图片卡片引用可直接序列化**（M440 已奠基）：`ImageRef { name, sourceMime }` 与 `ImageCard`
  （`src/quote-card.ts:51-64`）里的 `name` 是**内容寻址文件名** `pasted-<hash16>.<ext>`，纯字符串；附件字节落
  `<config_dir>/harness/attachments/<vault 稳定 id>/`（`src-tauri/src/harness/attachments.rs:77-100`）、
  **不被清理**（M440 design §5.7）。⇒ 草稿只需存这个名字，恢复后仍可经 `harness_read_image` 读回缩略图；
  引用名**只在同一 vault 目录内唯一**（M440 design §5.2），故草稿必须与 vault 绑定解析——与下面裁决点 1 的
  「per vault」取向互相印证。

## What Changes

逐条对应 `specs/harness/spec.md` 增量里的 requirement（本 change 只 ADDED ×1，不 MODIFIED 既有
requirement——理由见 design §2：避免与仍在途的 `harness-composer-image-paste` change 的增量撞车）：

1. **composer 草稿按 vault 自动保存**（harness，ADDED）：composer 内容 SHALL 作为**当前 vault 的草稿**自动落盘到
   `<config_dir>/harness/drafts/<vault 稳定 id>.json`（tmp + rename 原子替换；MUST NOT 触碰 vault，沿用会话留存
   「落配置目录」的既有铁律）。粒度 = **一个 vault 一份草稿**（裁决点 1）。保存 SHALL 为**防抖**
   （编辑停顿后落盘，沿用 1000ms 同族先例）+ **切 vault / 关面板 / 窗口失焦或退出 / 发送前后**这些离散时点的
   **显式 flush**（MUST NOT 只依赖防抖：切走之后就再没有「当前 vault」这个上下文）。无 vault 打开时 SHALL 只
   在内存里工作、**不落盘、不报错**（无可归属身份 ≠ 错误）。写失败 SHALL 降级为人话 warning、MUST NOT 阻断输入。
2. **composer 草稿自动恢复**（harness，ADDED）：装载 vault 时（app 启动 + 切 vault）SHALL 读回该 vault 的草稿并
   还原到 composer（块序、块类、光标落位、图片卡片引用一致）；无草稿 / 陈旧 / 损坏时 SHALL 安静回落到空输入区
   （MUST NOT 报错、MUST NOT 伪造内容）。恢复出来的草稿是**新的编辑史**（旧撤销史不跨进程恢复，Non-goal）。
3. **草稿数据形态**（harness，ADDED）：草稿 SHALL 存**块模型 JSON**（`ComposerBlock[]`，即 composer 的真模型
   与撤销栈快照形态），MUST NOT 存面板文本 XML 投影（后者 round-trip 有损：`headingPath` 不序列化、
   图片宽高缺省即丢——`src/harness-panel.ts:700`、`src/quote-card.ts:60-64`）。图片卡片 SHALL 以内容寻址名
   （`pasted-<hash16>.<ext>`）+ 源 mime（+ 可选宽高）的**引用形态**入草稿，MUST NOT 内联 base64（与会话留存
   「不内联 base64」同口径）。未知块类 SHALL 保守保留、MUST NOT 静默丢弃（向前兼容未来的块类）。
4. **与其他时刻的交互**（harness，ADDED）：发送**成功**后草稿 SHALL 清除（含落盘）；发送**被拒 / 失败**时草稿
   SHALL 原样保留（与今天 `harness_image_unsupported` 回滚重渲输入区一致）。**切 vault** 时 SHALL 先 flush
   当前 vault 草稿、再装载目标 vault 草稿（⇒ 早先「切 vault 即清空草稿」的行为被替换，这是本 change 的核心
   改变之一）。**切会话 / 新建会话 / 压缩**对草稿 SHALL 无影响（草稿属 vault 而非会话，「新会话」是否例外见
   裁决点 4）。删除会话 MUST NOT 牵动草稿。

## Alex 裁决点

| # | 裁决点 | 选项 | 起草倾向 |
|---|---|---|---|
| 1 | 草稿**粒度** | A. per vault（一个 vault 一份草稿）；B. per 会话（每会话一份）；C. per vault 起步、接口预留 per 会话 | **倾向 A**——会话 id 在本仓不稳定且在「新会话」首条消息前不存在（`ensure_session` 懒建立、resume/压缩都铸新 id），而草稿最常诞生在这段窗口，「按会话编址」没有可挂的键；反过来 vault 是唯一稳定身份，per-vault 对齐的是**内存态「一个 vault 一个活跃会话」**这一收窄事实（`RuntimeInner.sessions` 按 vault 键控、resume 铸新 id 替换该槽位）——**不是**「一个 vault 一个会话」这个已过时的整体表述：M433 落地后盘上按 vault 分目录可并存**多份历史会话留存**、浮层可切换 / 新建 / 恢复，per-vault 对齐的仅是前者。同时它把今天「同 vault 内切会话草稿还在」的既有行为（`resetView` 不碰 composer）**持久化**——在一 vault 多会话的现实下，该行为客观上意味着草稿在 vault 内跨会话共享，per-vault 只是把这份共享从「内存意外留存」变成「显式落盘」。B 需先改造会话模型（稳定 id + 持久化活跃会话），是更大的变更，建议另立 |
| 2 | 草稿**存哪里** | A. 独立 sidecar `<config_dir>/harness/drafts/<vault 稳定 id>.json`（照 `vault-sessions/` / `reading-positions/` 先例，tmp+rename）；B. 写进会话 JSONL（新增 `draft` sidecar 记录）；C. 前端 `localStorage` / webview storage | **倾向 A**——JSONL 是「wire/input 形态 + 恢复充分性」的会话记录（living spec「会话本地留存」），草稿是**编辑状态**、按防抖频次变动，混进去既污染 wire 记录流、又让 append-only 文件随每次击键膨胀，且 JSONL 会在 resume/压缩/新建时转新文件、草稿会被拆散；C 是本仓从未用过的存储面（全仓零 `localStorage`），不 vault 绑定、不随备份走。A 与既有 per-vault sidecar 完全同形 |
| 3 | **保存时机** | A. 防抖（1000ms）+ 离散时点 flush（切 vault / 关面板 / 窗口失焦或退出 / 发送前后）；B. 只在离散时点写；C. 每次编辑即写 | **倾向 A**——A 的防抖窗口照 `SESSION_WRITE_DEBOUNCE_MS` / `READING_POSITION_DEBOUNCE_MS` 的 1000ms 先例；flush 是不可省的一半（切走之后没有「当前 vault」可写，先例 `main.ts:2744-2745`）；B 在崩溃时会丢掉整段时间的编辑；C 每键一次 IPC + 写盘，无谓且触碰 keypress-to-paint 预算 |
| 4 | **「新会话」是否清空草稿** | A. 不清空（与今天行为一致、也与 per-vault 语义一致）；B. 清空（「新会话 = 全新开始」） | **倾向 A**——「新会话」换的是会话上下文，草稿是「还没发出去的输入」；不因换上下文就丢掉用户刚打的字（打字不可恢复，会话历史留在旧 JSONL 里可恢复）。B 是相对今天的**行为改变**，代价比 A 高，故不作为默认 |
| 5 | **发送后清除**的边界 | A. 发送**成功**后清草稿；被拒 / 失败时草稿与输入区一并保留；B. 一点发送就立即清 | **倾向 A**——与今天「发送闸拒绝时回滚重渲输入区、内容原样保留」（`src/harness-panel.ts:4938-4954`）的合同一致；B 会在发送被拒时把用户的字一起吞掉，正是要避免的丢失 |
| 6 | 草稿里的**图片卡片形态** | A. 块模型 JSON，图片存内容寻址名 + 源 mime（+ 宽高）的引用，无 base64；B. 存面板文本 XML 投影 | **倾向 A**——A 无损（面板文本有损：`headingPath` / 缺省宽高会丢），且它就是撤销栈快照用的同一形态，天然 round-trip；引用名可解析（附件字节不被 GC、恢复后 `harness_read_image` 仍读得回），无 base64 与会话留存同口径。B 便宜但会静默丢字段，与 REVIEW.md 第 8 条（同一语义不要两处真源、lossy 面别当权威）相抵触 |

## Non-goals

- **多草稿 / 多槽位**：一个 vault 只留一份草稿，不做草稿列表、不做命名草稿。
- **撤销史跨进程恢复**：只恢复「当前草稿」，撤销 / 重做栈不落盘（重启后从零开始）。
- **其他面板 / 编辑器的草稿**：编辑器侧有自己的未保存与崩溃备份机制（`src/save-controller.ts`），本 change 只覆盖
  harness composer。**编辑器草稿与崩溃备份链路逐字节不变**。
- **草稿同步 / 导出 / 加密**：本地单机，不做云端同步、不做导出、不做静态加密。
- **草稿的版本历史 / 时间机器**：只保最新一份，不保留历史版本。
- **附件的垃圾回收**：草稿引用的图片附件不被清理（与 M440 的 Non-goal 同向），不做引用扫描与 GC。
- **改造会话模型**：不引入稳定会话 id、不持久化「活跃会话」（裁决点 1 选 A 即不触及；选 B 才需要，届时另立）。

## Impact

- **影响的 specs**：`harness`（ADDED ×1：composer 草稿自动保存与恢复；拆成存储 / 恢复 / 形态 / 生命周期四条子句，
  同属一个 requirement）
- **影响的代码/系统**：
  - src：composer 的防抖保存控制器（照 `vault-switcher.ts` / `reading-position.ts` 的 store 形态，无 DOM 可单测）、
    装载时的恢复钩子（在 `vaultChanged` 里替换现有的「清空草稿」为「先存后退」）、发送成功 / 被拒时的清除与回滚
    挂点（`src/harness-panel.ts`）、块模型的 (反)序列化面（`src/quote-card.ts`）、IPC 包装（`src/ipc.ts`）；
  - src-tauri：新命令对 `harness_draft_get` / `harness_draft_put`（按当前 `VaultScope.vault_id` 解析落点，前端不传
    vault）、草稿 sidecar 的读写与 tmp+rename 原子替换（照 `vault_session.rs` / `reading_position.rs` 的既有函数）、
    路径逃逸防护、ts-rs bindings 重导出；
  - scripts/acceptance：新增真机验收场景（见 design §9）；
  - tests/unit：防抖窗口与 flush 时机的单测、(反)序列化 round-trip、图片引用不内联 base64 的断言、无 vault 不落盘。
- **关联约束**：ADR 0002 §6 性能合同（写盘走防抖、脱离 keypress-to-paint 热路径，`openspec/project.md:22`）；
  「MUST NOT 写入 vault」既有铁律（会话留存同款，`src-tauri/src/harness/jsonl.rs:4-5`）；
  ADR 0003 永不改写源文件；REVIEW.md 第 8 条（草稿语义只在一处产出）；REVIEW.md 第 21 条（不引入无消费者的兼容层）；
  仓库信息卫生（验收 fixture 全合成，不搬真实 vault 内容）。
- **与在途 change 的关系**：`harness-composer-image-paste`（M440）尚未归档。本 change 只 ADDED 新 requirement、
  不 MODIFIED 既有文本，故两条增量不冲突；草稿模型把图片卡片当「一类块」处理，M440 落地前该块类不存在、落地后
  自动纳入（见 design §2 / §6）。

## 观测闸三问（低成本口径）

- **怎么知道用户用了它**：产品零埋点，天然痕迹就是草稿文件本身——`<config_dir>/harness/drafts/<vault 稳定 id>.json`
  存在即「有草稿被保存过」、其 mtime 即「最近一次编辑时间」；dogfood 期 agent 批次收尾 `ls` 一眼即可。
- **怎么知道它有效**：主判 Alex dogfood 手感——「切 vault 再回来」「重开 app」后，输入区是否还是原来那段字、图片卡片
  是否还在原位；辅判草稿文件内容随编辑变化（改了字再 `cat` 一眼）。
- **出问题怎么发现**：机器面兜底——新真机验收场景（编辑→重启→恢复 / 切 vault 各留各的 / 发送成功后清除 / 发送被拒
  保留 / 图片引用 round-trip / vault 零写入）见 design §9；单元测试覆盖防抖窗口、flush 时机、(反)序列化 round-trip、
  无 vault 不落盘。失败路径都有可见出口（写失败 warning + 不阻断输入），不静默。
