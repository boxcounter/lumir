# Tasks: composer-draft-persistence

## 1. 草稿存储（后端）

- [x] 1.1 草稿 sidecar `<config_dir>/harness/drafts/<vault 稳定 id>.json` 的读写：目录名纪律复用
      `jsonl::vault_dir_name`（id 不合格 → 静默不落盘，MUST NOT 落兜底目录），写入纪律 tmp + rename 原子替换
      （照 `vault_session.rs` / `reading_position.rs` 既有函数，不复制第二份）；MUST NOT 触碰 vault
- [x] 1.2 新命令 `harness_draft_get` / `harness_draft_put`：按当前 `VaultScope.vault_id` 解析落点（前端不传 vault，
      照 `harness_write_image` 形态）；无 vault → get 返回空、put 静默不落盘；路径逃逸防护
- [x] 1.3 ts-rs bindings 重导出（`src/bindings/**`）；`src/ipc.ts` 加对应包装
- [x] 1.4 Rust 单测：写出与读回、tmp+rename 无残留、非法目录名拒绝、路径逃逸拒绝、无 vault 不落盘

## 2. 草稿数据形态（块模型 JSON）

- [x] 2.1 块模型 ⟺ 草稿 JSON 的 (反)序列化，**唯一实现点**（`src/quote-card.ts` 同层）：`ComposerBlock[]` 无损往返，
      含引用卡片（file/heading/lines/text）与图片卡片（内容寻址名 + 源 mime + 可选宽高）；`version` 字段
- [x] 2.2 图片卡片只存引用名与 mime，**MUST NOT 内联 base64**；未知块类保守保留、MUST NOT 静默丢弃
      （同时是 M440 `image` 块的向前兼容面）
- [x] 2.3 单测：round-trip（含图片卡片、未知块类、零编号）、坏文件 / 空文件解析回落不报错

## 3. 前端保存与恢复

- [x] 3.1 草稿 store（照 `src/reading-position.ts` 的 store 形态，零 DOM 可单测）：防抖
      `DRAFT_WRITE_DEBOUNCE_MS = 1000`、无变更不写、flush、切换时丢弃上一 vault 的待写
- [x] 3.2 `vaultChanged`（`src/harness-panel.ts`）改造：**装载新 vault 前 flush 旧 vault 草稿、装载后恢复新 vault
      草稿**——替换现有的「切 vault 即清空草稿」（`:4879-4880`）；无草稿 / 坏文件安静回落到空输入区
- [x] 3.3 恢复钩子：把读回的块序列铺进 composer（块序 / 块类 / 光标落位 / 图片引用一致），撤销史从零开始
- [x] 3.4 离散 flush 挂点：面板关闭、窗口失焦 / 退出（照 `main.ts:2744-2745` 的切换前 flush 先例）
- [x] 3.5 单测：防抖窗口与 flush 时机、无变更不写、切走丢弃待写、恢复与非图片粘贴面互不串台

## 4. 发送语义（清除与回滚）

- [x] 4.1 发送**成功**后清除草稿（含落盘）；清空触发的自动保存对发送窗口挂起，成功即删草稿文件
- [x] 4.2 发送**被拒 / 失败**时草稿与输入区一并保留：与 `harness_image_unsupported` 的回滚重渲
      （`src/harness-panel.ts:4938-4954`）同步，回滚后按内容重新落盘；MUST NOT 留下「崩溃即丢字」的空草稿窗口
- [x] 4.3 单测：发送成功清草稿、发送被拒保留草稿、回滚后草稿内容与输入区一致

## 5. 文案与文档

- [x] 5.1 文案新增（`文案-Copy.md` + `src/copy-data.ts`）：草稿保存失败的人话 warning（D-code 取当前空闲段）；
      同步 copy drift 测试
- [x] 5.2 若实现期发现 proposal / design 的意图需变更：停下，更新 proposal 重走节点 1，不静默扩 scope

## 6. 验收与门禁

- [x] 6.1 新增真机验收场景（scripts/acceptance，mock provider，fixture 全合成）并全绿：编辑→重启→恢复 /
      切 vault 各留各的 / vault 零写入（负向）/ 发送成功后清除 / 发送被拒保留 / 图片卡片 round-trip 且草稿无 base64
      （负向）/ 无 vault 不落盘（design §9 的 ①–⑦）
- [x] 6.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 6.3 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码，SKIP 单列）
- [x] 6.4 未新增视觉元素（design §8），默认不跑 `gate.sh visual`；若实现期动了 `src/harness-panel.css` → 按纪律
      补跑 `gate.sh visual` 并核对既有基线时间戳
- [x] 6.5 信息卫生：改动面一次 text 级 grep 清扫（无真实 vault 内容；验收 fixture 全合成）
- [x] 6.6 归档前逐条对账：tasks / spec 增量 / 实现三者一致

## 实现记录（M452，2026-10-11）

逐条与任务的偏差 / 补充口径（全部如实登记，不静默改口径）：

- **1.3 的 bindings 面不适用**：草稿命令的 IPC 面是 **JSON String**（入参与返回都是字符串 / null），
  没有新增 ts-rs 导出类型——这是 `harness` 模块的既有纪律（`harness.rs` 模块头：「IPC 边界走 JSON
  String（M302 纪律：命令返回值不为此新增 ts-rs 类型）」）。因此 `src/bindings/**` **零 diff**，
  `src/ipc.ts` 的两个包装（`harnessDraftGet` / `harnessDraftPut`）已按 1.3 落地。
- **草稿 JSON 里多一个 `caret` 字段**（design §6 的示例只画了 `version` + `blocks`）：spec 增量与
  proposal 都要求恢复「光标落位」与保存前一致（「块序、块类、**光标落位**与图片卡片引用一致」），
  没有落位就无从一致。形状因此是 `{"version":1,"blocks":[…],"caret":{"block":N,"offset":M}|null}`；
  design §6 的示例是节选（它同一节里也写了「留一个显式版本号供未来结构演进」的口径）。
- **3.2 的 flush 落点改到「离开输入区」而不是 `vaultChanged` 里**：`vaultChanged` 由装配层在
  **后端切完 vault 之后**调用（`applyVault` 跑在 `vault_open_path` 之后），此刻写入会按**新** vault
  解析落点、把旧 vault 的草稿写进新 vault 的文件。而「待写存在」蕴含「输入区持焦」（落盘由编辑
  触发、编辑要求输入区持焦、一次离焦就走 flush），切 vault 又必经「先离开输入区」（⌘O 的浮层自持
  焦点 / 点列表行 / 点 tree 都会先把焦点从 composer 拿走）。flush 因此落在：输入区失焦 / 面板关闭 /
  窗口失焦 / 退出 四个时点；`vaultChanged` 里只做「丢弃旧 vault 的待写 + 装载新 vault 的草稿」。
  `src/harness-panel.ts` 的 `flushDraft` 注释是这条口径的 canonical 居所。
- **6.1 的七条场景新增在 135–139**（①⑥→135、②③→136、④→137、⑤→138、⑦→139），`--check` 通过
  （142 个场景静态校验全绿）。**本轮未跑真机**（前台窗口由 tower 统一安排），逐场景的判据口径与
  覆盖边界写在各自的正文里（含 139 依赖「未打开空态下 ⌘⇧A 仍能开面板」这条待首次跑批确认的构造）。
- **7（会话生命周期的四条不动草稿）没有独立真机场景**：切会话 / 新建 / 压缩 / 删除会话都不经过
  草稿 store（实现面上零触点），判据落在单元层与实现面；如需真机判据另立场景（见 136 的覆盖边界）。
- **6.4 未动 `src/harness-panel.css`**：零新视觉元素（design §8），未跑 visual 门禁。

## 评审 r1 修复（reviewer-m452，2026-10-11，两条 P2 同根：在途写未串行化）

- **P2-1 写失败重试覆盖更新的待写**：`write()` 的 catch 原为无条件 `pending = draftJson`——在途写
  期间用户新编辑的内容会被旧内容的失败重填覆盖。改为 `pending ??= draftJson`（只在期间没有更新的
  编辑时回填；新内容自带防抖定时器会自己写走）。
- **P2-2 在途写与发送成功的删除并发**：写的 rename 与 clear 的 remove 次序无保证，rename 落在
  remove 之后时盘上留下「已发送内容」的草稿，下次装载把它恢复回来。改为**一条 promise 链串行
  store 的全部后端 mutation**（`enqueue`，flush 的写与 clear 的删除共用），删除必然排在在途写之后。
  另加**作废世代**（`epoch`）：`discard`（切 vault / clear）递增，在途写落地时若世代已变则不回填
  待写、也不更新「已落盘」基准——否则 clear 设的 `written = ""` 会被在途写的成功回调改回旧内容，
  用户接着打同样的字会被「无变更不写」吞掉（盘上其实没有那份）。
- **两条新单测**（`tests/unit/harness-draft.test.ts`）：挂起式 `putDraft` 桩驱动「写失败窗口内有
  新编辑」与「flush 在途 + clear」两个现场。两条都做过**反向验证**——分别把修法退回旧写法时对应
  断言如实变红（P2-1 退回后第一条红、P2-2 退回后第二条红且失败详情正是「删除先落地、写在后落地」）。
- 复跑读数：`node tests/unit/run.mjs` → 834 passed / 0 failed；`bash scripts/gate.sh quick` →
  `GATE RESULT: 9/9 PASS（SKIP 1）`，exit 0。
