# Design: composer-draft-persistence

技术设计说明。节点 1 评审以 proposal.md 为准；本文记录实现期的技术选型与行为合同细节，供实现 worker 与归档评审
对账。

**术语**：沿用既有制品——**composer** = harness 面板的混排输入区（`contenteditable`，`div.lumir-hp-composer`）；
**block / 块** = composer 的顶层单元（`ComposerBlock`）；**草稿**（本 change 自造词，就地定义）= composer 当前未发送
内容的按 vault 持久化快照；**vault 稳定 id** = vault 注册表 id（`vault-<pid>-<n>`，`VaultScope.vault_id`）。

## 1. 调研结论（现状事实锚点）

以下经只读调研核实（wt-445），是设计决策的事实基础。

- **composer 是纯内存、真源是 DOM**：块模型每次由 `readBlocksFromDom()` 现读（`src/harness-panel.ts:2431-2451`），
  卡片块数据在 `WeakMap cardData`（`:2181`），撤销史快照类型 `ComposerSnapshot = { blocks, caret }`（`:2184-2187`）。
  **零持久化**：全仓 `src/` 无 `localStorage` / `sessionStorage`。
- **清空点只有三处**：发送 `:4917-4918`、切 vault `vaultChanged` `:4874-4883`（清空在 `:4879-4880`）、启动初始化
  `:5452`。**切会话不清空**（`resetView` `:4828-4861` 只清 transcript；由 `startNewSession` `:5137-5151` 与
  `resumeSession` `:5322-5337` 调用）——即今天同 vault 内切会话草稿串台留存。
- **重启不恢复任何会话**：会话表内存态（`harness.rs:85`），`Runtime::snapshot` 不读盘（`harness.rs:237-248`），
  重启后快照为空（`harness.rs:6`）。
- **前端没有 vault id / 会话 id**：`applyVault(root, entries, vaultId, restored)` 有 `vaultId`（`src/main.ts:2735-2740`），
  但调面板只给 root（`src/main.ts:2790`）；面板只有 `currentVault`（root，`src/harness-panel.ts:2170`）；快照
  `StateSnapshot` 无会话 id（`src-tauri/src/harness/session.rs:113-125`）；`resumeSession` 丢弃 `info.session_id`。
- **会话 id 懒建立且不稳定**：`ensure_session`（`harness.rs:814-853`）在**首条消息时**才铸 id
  （`jsonl.rs:43-59`）；「恢复」铸新 id（`harness.rs:321-469`）；压缩转新文件新 id（`turn.rs:1007-1099`）。
- **后端命令按当前 scope 取 vault id**：`VaultScope { root, policy, vault_id }`（`harness.rs:59-66`）经
  `vault_scope()`（`harness.rs:895-902`）解析；M440 的 `harness_write_image` 即此形态（`harness.rs:956-960`）。
- **可照搬的 per-vault sidecar 先例**：`vault-sessions/<id>.json`（`src-tauri/src/vault_session.rs:81-82`，命令
  `vault_session_get/put` `:245-260`）与 `reading-positions/<id>.json`（`src-tauri/src/reading_position.rs`），
  写入纪律 tmp + rename 原子替换（`vault_session.rs:231-241`、`reading_position.rs:132-141`）；前端防抖写控制器
  `SESSION_WRITE_DEBOUNCE_MS = 1000`（`src/vault-switcher.ts:51`）、`READING_POSITION_DEBOUNCE_MS = 1000`
  （`src/reading-position.ts:39`），切 vault 前显式 flush（`src/main.ts:2744-2745`）。
- **图片卡片引用可序列化**：`ImageRef { name, sourceMime }` / `ImageCard`（`src/quote-card.ts:51-64`）的 `name` 是内容
  寻址名；附件在 `<config_dir>/harness/attachments/<vault 稳定 id>/`（`attachments.rs:77-100`）且不被 GC；
  引用名**只在同一 vault 目录内唯一**（M440 design §5.2）。
- **面板文本投影有损**：`serializeQuoteMessage`（`src/quote-card.ts:258-260`）产出的 XML 里 `QuoteCard.headingPath`
  不序列化、图片 `width/height` 缺省即丢；`parseQuoteMessage`（`src/harness-panel.ts:652-746`）还原时 `headingPath`
  退化为 `heading`（`:700`）。

## 2. 设计合同与输入

- 设计合同：本 change 的 `specs/harness/spec.md` 增量（ADDED ×1，四条子句）。
- 行为基准：living spec 的「混排对话输入区」（`openspec/specs/harness/spec.md:315`）、「会话边界」（`:219`）、
  「会话本地留存」（`:258`）。
- **不 MODIFIED 既有 requirement 的理由**：`harness-composer-image-paste`（M440）尚未归档，其增量含对「混排对话
  输入区」的 MODIFIED——若本 change 也 MODIFIED 同一 requirement，两处增量会互相覆盖对方的重述文本。故本 change
  只用 ADDED 新增一个自足的 requirement，与 M440 的增量正交。
- NOT 清单：见 proposal §Non-goals。
- **单源纪律**（REVIEW.md 第 8 条）：草稿的读写只有一个定义点（sidecar + 一个前端 store）；「块模型 ⟺ 草稿 JSON」
  的 (反)序列化只应有一处实现，面板文本投影仍然只用于投递与会话名，**不得**作为草稿的存储形态。
- **无兼容层**（REVIEW.md 第 21 条）：草稿是**新制品**，零存量，不存在旧格式消费者——首版即终态，不加版本迁移分支；
  唯一的向前兼容是「未知块类保守保留」（见 §6），那是防御而非迁移。

## 3. 存储位置与粒度（裁决点 1 / 2）

**落点**：

```
<config_dir>/harness/drafts/<vault 稳定 id>.json
```

- 与会话留存 `harness/sessions/<vault 稳定 id>/`、附件 `harness/attachments/<vault 稳定 id>/` 同族（同一个
  vault 稳定 id 分层）；目录名纪律复用 `jsonl::vault_dir_name`（`jsonl.rs:100-103`，`valid_id` 通过且 ≠ 保留名
  `_orphaned`）。用**文件** `drafts/<id>.json` 而非子目录，是一份草稿为一个 vault 的粒度决定的。
- **id 来源**：后端命令经 `vault_scope()` 拿当前 scope 的 `vault_id`——**前端不传 vault**，与 `harness_write_image`
  同形态（`harness.rs:956-960`）。⇒ 前端无需新拿 vault id（现状里它没有，`main.ts:2790`）。
- **MUST NOT 触碰 vault**：草稿落配置目录，与 `sessions/` / `attachments/` 同侧；沿用会话留存铁律
  （`jsonl.rs:4-5`，ADR 0003）。
- **无 vault**：命令拿不到合格 id → **静默不落盘**（草稿是无副作用 UI 状态，不同于附件的「拒绝落盘 + 报错」，后者是
  因为一张丢掉的图会被误以为已投递）。此时 composer 照常在内存工作，只是不持久化。**MUST NOT** 落任何兜底目录。

**为什么独立 sidecar 而非 JSONL / localStorage**：见 proposal 裁决点 2 起草倾向（JSONL 是 wire 真相、append-only、
且会转文件把草稿拆散；localStorage 在本仓无先例且不跟 vault 绑定）。

**为什么 per vault 而非 per 会话**：见 proposal 裁决点 1 起草倾向（会话 id 不稳定且为新会话首条消息前不存在，
唯一稳定身份是 vault）。**对齐面须写准**：per-vault 对齐的是**内存态「一个 vault 一个活跃会话」**
（`RuntimeInner.sessions` 按 vault 键控，`harness.rs:85`；resume 铸 new_id 替换该槽位，`harness.rs:321-469`），
**不是**「一个 vault 一个会话」这个整体表述——盘上按 vault 分目录可并存**多份历史会话留存**（M433 落地的一 vault
多会话：浮层可切换 / 新建 / 恢复，living spec「会话边界」`openspec/specs/harness/spec.md:219-221`）。而
「切会话不丢草稿」的既有行为（`resetView` `:4828-4861` 只清 transcript、不碰 composer）在一 vault 多会话的现实下，
客观上就是**草稿在 vault 内跨会话共享**——per-vault 只是把这个既有事实从「内存意外留存」变成「显式落盘」。

## 4. 保存时机（裁决点 3）

- **防抖**：编辑停顿 `DRAFT_WRITE_DEBOUNCE_MS = 1000` 后落盘一次（与 `SESSION_WRITE_DEBOUNCE_MS` /
  `READING_POSITION_DEBOUNCE_MS` 同值、同族）。store 形态照 `src/reading-position.ts` 的
  `createReadingPositionStore`（无 DOM、可脱离浏览器单测：防抖窗口 / flush 时机 / 无变更不写）。
- **显式 flush**（MUST NOT 只依赖防抖——切走之后没有「当前 vault」这个上下文了）：
  - 切 vault 时：`applyVault` 里**装载新 vault 之前** flush 旧 vault 草稿（照 `main.ts:2744-2745` 的
    `switcher.flush()` / `readingPositions.flush()` 位置），随后装载新 vault 的草稿（§5）；
  - 面板关闭（pane 收起）时；
  - 窗口失焦 / 退出时（best-effort，沿用崩溃备份同族的时机）；
  - 发送前后（§7）。
- **无变更不写**：store 保留「上次已落盘的内容」，内容未变则跳过写盘（照 reading-position 的既有口径）。
- **性能**：写盘经防抖、异步 IPC，**脱离 keypress-to-paint 热路径**（ADR 0002 §6，`openspec/project.md:22` 的
  <16ms）；草稿体量是 KB 级，写一次可忽略。
- **崩溃边界（如实声明）**：防抖窗口内崩溃会丢最近一次编辑（≤1000ms 的输入），只能恢复到上一次已落盘的内容。
  这是 best-effort，不承诺「逐击键可恢复」——真要做到那一步得每键写盘，与热路径预算相悖。验收口径按「最近一次
  已保存草稿」判，不按「最后一个字符」判。

## 5. 恢复时机与会话生命周期交互

**恢复点**：装载 vault 时读回该 vault 草稿并还原到 composer：

- **app 启动**：启动装载 vault 后（`vaultChanged` 通道）恢复——注意重启**不恢复活跃会话**（会话表空），草稿恢复进的是
  一段**新会话**的 composer；草稿里的引用卡片带 vault 相对路径、图片卡片带本 vault 的内容寻址名，二者都 vault
  绑定，恢复后仍然有效（§6）。
- **切 vault**：先 flush 旧 vault（§4），再装载新 vault 草稿。
- **回落**：无草稿 / 文件损坏 / 解析失败 → 安静回落到空的单段落输入区（MUST NOT 报错、MUST NOT 伪造内容，
  照「读取失败不是内容为空」的既有防线，REVIEW.md 第 2 条——判据是「是否拿到合法草稿」，不是「`?? ""`」）。

**会话生命周期交互**：

| 事件 | 对草稿的处置 | 理由 |
|---|---|---|
| 切会话（恢复历史会话） | 无影响（草稿属 vault） | 草稿不属会话；per-vault 粒度下本就该留 |
| 新建会话 | 无影响（倾向 A，裁决点 4） | 换的是会话上下文，不丢用户打的字 |
| 自动压缩 | 无影响（草稿属 vault） | 压缩只转会话文件 |
| 删除会话 | 无影响，MUST NOT 删草稿 | 草稿不与任何会话文件绑定；且删除不吃掉未发送内容 |
| 切 vault | 先 flush 旧、再装新（§4/§5） | 本 change 的核心改变之一 |
| 发送成功 | 清除草稿（含落盘） | 内容已进会话，草稿使命完成 |
| 发送被拒 / 失败 | 原样保留 | 见 §7 |

## 6. 草稿数据形态（裁决点 6）

**存块模型 JSON**，形如：

```jsonc
{
  "version": 1,
  "blocks": [
    { "kind": "paragraph", "text": "帮我看下这段" },
    { "kind": "quote", "card": { "file": "notes/a.md", "heading": "标题", "lines": "3-5", "text": "…" } },
    { "kind": "image", "card": { "name": "pasted-<hash16>.webp", "sourceMime": "image/png", "width": 800, "height": 600 } }
  ]
}
```

- **为什么不存面板文本投影**：面板文本 XML 有损（`headingPath` 不序列化、图片缺省宽高丢，§1），而块模型是 composer
  的真模型、也是撤销栈快照用的同一形态，天然无损 round-trip。存储形态与投递/展示形态**分开**，各用各的投影。
- **图片卡片**：只存内容寻址名 + 源 mime（+ 可选宽高），**MUST NOT 存 base64**（与会话留存同口径，
  `attachments.rs:12-14`）。引用名只在同一 vault 目录内唯一（M440 design §5.2），故草稿必须与 vault 绑定解析——
  per-vault 粒度（§3）正好保证了这一点：读回时按同一 `vault_id` 解析 `attachments/<id>/`，仍可经
  `harness_read_image` 取回缩略图。附件字节不被 GC（M440 design §5.7），故恢复后引用恒可解析。
- **`version` 字段**：留一个显式版本号供未来结构演进；首版无迁移分支（零存量，REVIEW.md 第 21 条）。
- **未知块类保守保留**：解析到 `kind` 不在已知集合内的块 SHALL 原样保留在内存模型里（未来的块类落地前也不丢内容），
  与既有「快照恢复解析未知元素 MUST NOT 静默丢内容」同口径。这条同时是 M440 的向前兼容面：M440 落地前 `image`
  块不存在、落地后自动纳入。
- **`currentVault` 与 root vs id**：草稿按 `vault_id` 编址（与 sessions/attachments 同域）；前端 store 的内存镜像
  仍可只记一个「当前 vault 是否已装载」的布尔，落盘/读回一律走后端命令（前端不持有 id）。

## 7. 清除与失败回滚（裁决点 5）

- **发送成功后清除**：`send()`（`src/harness-panel.ts:4891-4959`）在**发送被接受**后清空 composer 与草稿文件
  （今天是在乐观清空 `:4917-4918`；本 change 要把「清落盘草稿」的时点钉在发送成功的 callback 里，或等价地用
  「抑制清空触发的自动保存 + 成功即删」）。
- **发送被拒 / 失败时保留**：今天的回滚合同是——`harness_image_unsupported` 时不建会话、撤下乐观上屏的用户消息、
  **回滚重渲输入区原内容**并标出图片卡片（`src/harness-panel.ts:4938-4954`）。草稿必须与之同步：**不得**在
  乐观清空与回滚之间把草稿文件写成空、留下一个「崩溃即丢字」的窗口。实现口径：发送清空触发的自动保存对该窗口
  **挂起**，成功→删草稿文件、失败→按回滚后的块重新落盘、用户新编辑→恢复正常自动保存。
- **不变量**：任意时刻「草稿文件的内容」都应等于「用户最后一段**未发送**的输入」——发送成功即它不再未发送而清掉；
  发送失败则它仍是未发送而保留。

## 8. 视觉保真

**无原型、不引入新视觉元素**——本 change 不新增任何可见控件（草稿恢复后就是 composer 里原本的内容），故
`docs/process/openspec-workflow.md` 的「视觉保真」一节（有原型时必填）不适用。唯一可见的新反馈是**保存失败时的人话
warning**（toast 语义，沿用既有文案通道），与既有 toast 同族，不新立视觉物种。

## 9. 验收面（机器判定锚点）

- **真机验收新场景**（scripts/acceptance，mock provider，fixture 全合成）：
  ① **编辑 → 重启 → 恢复**：在 composer 输入一段文本 + 一个引用卡片 → 等待防抖落盘 → 重启 app → 输入区恢复为
     相同块序与内容；
  ② **切 vault 各留各的**：vault A 输入草稿 → 切到 vault B（输入区为空或 B 自己的草稿）→ 切回 A → A 的草稿原样；
     `drafts/<A id>.json` 与 `drafts/<B id>.json` 各自独立；
  ③ **vault 零写入**：上述过程中 vault 目录零新增 / 修改（负向断言）；
  ④ **发送成功后清除**：发送一条消息 → 输入区清空且 `drafts/<id>.json` 被清除（或内容为空）；
  ⑤ **发送被拒保留**：构造 `harness_image_unsupported`（模型声明 `vision:false`）→ 发送被挡 → 输入区原内容
     （含图片卡片）保留、草稿文件内容不变；
  ⑥ **图片卡片 round-trip**：草稿含图片卡片 → 重启 → 卡片引用名一致、缩略图可经 `harness_read_image` 读回；
     草稿文件内**不含 `data:image` / 长 base64 串**（负向断言）；
  ⑦ **无 vault 不落盘**：无 vault 打开时编辑 → 不产生任何 `drafts/` 文件、不报错。
- **单元测试**（tests/unit，零 DOM）：store 的防抖窗口与 flush 时机（无变更不写 / flush 写走 / 切走丢弃上一 vault 的
  待写）；块模型 ⟺ 草稿 JSON 的 round-trip（含引用卡片三属性、图片卡片引用、未知块类保留、零编号）；无 vault 时
  命令不落盘；损坏 / 空文件解析回落而不报错。
- **Rust 单测**：`harness_draft_get` / `harness_draft_put` 的写出与读回、tmp+rename 无残留、路径逃逸防护、
  目录名非法拒绝。
- **门禁**：`scripts/gate.sh quick` 全绿；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- **不新增视觉基线**：无新视觉元素（§8），故不新增像素基线；若实现期动了 `src/harness-panel.css` 才按纪律补跑
  `gate.sh visual` 并核对既有基线时间戳。

## 10. 后续项（本 change 不做，登记 backlog）

- **per 会话草稿**（裁决点 1 的 B）：若 Alex 要「每会话一份草稿」，需先改造会话模型（稳定会话 id + 持久化活跃会话），
  是独立变更。
- **附件 GC**：草稿引用的孤儿图片清理，与 M440 的 Non-goal 同题，另案。
- **崩溃级逐击键恢复**：若要丢掉「防抖窗口内的最后一次编辑」这个 best-effort 边界，需另设计（与热路径预算权衡）。
