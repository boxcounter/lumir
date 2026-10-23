# Proposal: vault 列表移除（sessions 移除已由 M406 交付，本次只核实、不改）

- Change ID: `vault-and-session-removal`
- 日期: 2026-10-23
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**待 Alex 裁决**（2026-10-23 起草）。裁决点 D1–D4 见下方「裁决点」节，
> 每个都给了倾向；逐条回或不回都行——不回即按倾向落地。
> 节点 2（归档评审）：实现完成后填写。

## Why

Alex 2026-10-23 的需求原话（逐字）：

> 「增加 vault 移除和 sessions 移除功能」

调研（逐处读过源码、living spec 与验收套件）得到的现状与这条需求的关系：

**① vault 移除：不存在，且被 living spec 明令禁止。**

- 注册表是 vault 列表的唯一真源：`<config>/lumir/vault-registry/<vault-id>.json`，一项一个文件
  （`src-tauri/src/vault_registry.rs:60` 的 `VaultWorkspace`、`:423` 的 `list_vaults`）。
  `vault_list` 把目录里**全部**注册项返回（`src-tauri/src/vault_registry.rs:481`），前端每次打开
  浮层重新拉取、不维护常驻镜像（`src/vault-switcher.ts:1000`）。
- 没有任何「移除」命令：`src-tauri/src/lib.rs:138-141` 注册的 vault 注册表命令只有
  `vault_register` / `vault_remap` / `vault_list`。前端浮层的行只承担三件事——切换、失效项
  重新定位、底部新增（`src/vault-switcher.ts:1094` 的 `renderRow`）。
- 更硬的阻力：living spec 明文禁止。`openspec/specs/vault-workspace/spec.md:249`：
  「系统 MUST NOT 提供「从列表移除」或硬删除注册项（既有治理口径是只归档不删除）」；`:266` 还有
  一条专钉这件事的 Scenario「没有从列表移除」。现有自动治理只归档（`archived_at` 标记），
  而且归档**不抑制**列表可见性（同文件 `:138`）——所以**每个被打开过一次的目录会永久留在列表里**，
  没有清理通道。这条 prohibition 是 change `multi-vault-workspaces` 的非目标，本 change 要推翻它。

**② sessions 移除：已经存在（M406 面板批次，提交 `dc207470`），本 change 零改动。**

- 后端：`harness_delete_session` 命令（`src-tauri/src/harness.rs:1752`）→ `Runtime::delete_session`
  （`src-tauri/src/harness.rs:736`）：删的是**盘上的会话留存文件**
  `<config>/lumir/harness/sessions/<vault-id>/<session-id>.jsonl`；活跃会话的当前留存拒删
  （`harness_session_active`）、跨 vault 拒删（`harness_session_vault_mismatch`）、文件已不存在按
  幂等成功处理。
- 前端：历史会话浮层每行常驻一枚淡色 `×` 钮（`src/harness-panel.ts:9164`），点击后**行内
  两步确认**，确认才调用命令、取消逐字还原行（`src/harness-panel.ts:9191`；样式
  `src/harness-panel.css:252`）。
- spec 与验收：`openspec/specs/harness/spec.md:353` 已写明「会话浮层每行已提供**单条删除**入口
  （行内两步确认、活跃会话拒删，M406 面板批次落地）」；真机场景
  `scripts/acceptance/scenarios/108-harness-session-delete.md` 逐条覆盖活跃拒删、取消还原、确认删文件。

因此本 change 的增量只落在 vault 一侧。sessions 一侧在提案里如实登记为「已交付、零改动」，并把
「是否还有缺口」放进裁决点 D4 交给 Alex——如果 Alex 说的不是这个入口，D4 里列了两个候选解释，
指一下即可。

**核实方式与其边界**（REVIEW.md「覆盖声明超出真实验证」条）：以上现状全部来自**读**——源码三处、
living spec 两处、验收场景文件一份逐条对照；本 mission 是纯提案，未起 app、未复跑真机场景 108，
因此「会话删除在真机上可用」这一条是**既有证据**（M406 的交付与在册场景），不是本次重新验证的结论。

**为什么值得做 vault 移除**：列表是用户主动打开的面，自动归档不放宽它的可见性，于是列表只会变长
（失效项、一次性试用过的目录、已搬走的项目）。「每个打开过一次的目录永久留在列表里」是既有的
设计非目标，现在 Alex 要求改变它。

## What Changes

1. **新增能力「vault 移除」**（spec delta：`vault-workspace` 的 ADDED Requirement「vault 移除」）：
   浮层里除当前项之外的每个注册项都有行内移除入口，两步确认后从列表消失；移除只删注册表项文件，
   **磁盘上的 vault 目录与其中任何文件一概不动**；带「撤销」出口；失效项同样可清理。
2. **推翻旧 prohibition**（spec delta：`vault-workspace` 的 REMOVED「失效 vault 的处置」+
   ADDED「失效 vault 的处置与清理」承接条）：删掉「MUST NOT 提供从列表移除」的钉死与专钉它的
   Scenario，改述为「失效项同样可移除；自动治理仍只归档不删除」。走「整条移除 + 新名承接条」而不
   走 MODIFIED，是因为 OpenSpec 的 MODIFIED 块不允许改 scenario 名，而旧 Scenario 名「没有从列表
   移除」本身就是被推翻的断言（仓库既有先例：`preview-tab-removal` 的「打开与固定语义」→「打开语义」）。
3. **sessions 一侧零改动**：只核实与登记（见 Why ②）。前端入口、两步确认、磁盘文件删除、活跃拒删
   全部维持 M406 的既有行为。

## 裁决点（每项给倾向；不回即按倾向落地）

### D1 当前打开的 vault 能否从列表移除

- 选项 A（**倾向**）：**不能**。当前项那一行不出现移除入口，后端也拒绝（`vault_remove_current`）。
- 选项 B：能。需要同时定义：dirty 标签怎么拦（复用切换的三出口）、移除后窗口上下文换成什么
  （自动切到别的 vault = 未经请求的上下文替换；退到空态 = 切换器浮层连入口都没有的状态）、
  `last_vault` 怎么清（不清则下次启动按路径重新注册，vault 复活）。
- 倾向理由：移除是**整理列表**的动作，不是**离开当前工作**的动作。B 的每条支路都要独立的守卫与
  半状态处理，成本数倍于 A，而 A 覆盖真实场景——要清理的通常是「不用的、失效的、一次性的」，
  不是正在写的那个。
- A 的代价（明说）：列表里只有一个 vault 时，移除入口整体不可达；要移除唯一 vault 得先「新增 vault…」
  开一个别的目录再切换过去。若 Alex 认为这条代价不可接受，选 B。

### D2 移除删什么

- 选项 A（**倾向**）：只删注册表项文件 `<config>/vault-registry/<id>.json`。vault 目录、标签会话
  （`vault-sessions/<id>.json`）、阅读位置（`reading-positions/<id>.json`）、harness 会话留存与
  附件（`harness/sessions/<id>/`、`harness/attachments/<id>/`）**一律不动**。
- 选项 B：连同按 id 键控的数据一起删（「彻底清理」）。会静默销毁 agent 对话历史与标签历史。
- 选项 C：注册项打 `removed_at` 标记、列表过滤；数据全留，重加同一目录复活同一身份。
- 倾向理由：Alex 的原意是「不删盘上数据」，B 与它直接冲突——「整理列表」不该变成「删数据」。
  C 看起来最温柔，但它引入第三种治理态（缺失 / 已归档 / 已移除），注册表的四条读路径
  （`sweep_registry` / `remap_candidates` / `find_by_path` / `list_vaults`）都要学怎么过滤它，还要
  防「sweep 把已移除项复活」这类隐蔽分支；换来的只是「重加时旧标签还在」这一条便利。A 的删除面
  只有一个文件、行为一眼可见，且撤销（D3）覆盖了误删窗口。
- A 的代价（明说）：移除后 per-id 数据变成不可达的孤儿（留在盘上，界面上再无入口）；之后重新加入
  同一目录会铸新稳定 id，旧标签 / 旧会话历史不会复活。确认文案里会写明「磁盘上的目录与文件不受影响」，
  孤儿一事记在 design 的「已知边界」，不进界面文案。
- 另一条联动（登记，不在本 change 处置）：被移除的 vault 若仍是某个 cron 任务的目标，结局按**触发源**
  分两种（master `18c21ef2` 核对过代码）：
  - **定时 / 启动 / 聚焦 / vault 打开后补跑（无人值守）**：`cron::plan` 的目标 vault 闸门见「目标不是
    当前 vault」即 `Skip(vault_not_current)`（`src-tauri/src/cron.rs:303`），不打开、不切换、不复活；
    后端 `harness_cron_run` 另有 `vault_not_open` 兜底（`src-tauri/src/harness.rs:1452`）。净效果是
    **该任务从此静默停跑**——当天第一次跳过落一条 `cron_run_skipped reason=vault_not_current`
    （`src-tauri/src/logging.rs:939`；同日重算不再记，`record_skip` 按任务 + 日期去重，
    `src-tauri/src/lib.rs:1593`），这才是定时路径的反直觉点。
  - **用户发起（点击运行 / 点击结果通知）**：`cron_click` 与 `cron:open_session` 不走上面那道闸门，
    前端先 `ensureCronVault`（`src/main.ts:2798`）→ `switchToVault` 打开目标 vault，于是
    `reconcile_vault` 铸新 id、列表里以新身份出现，并且**会切走当前 vault**
    （`src/main.ts:2810` `handleCronRun` / `:2856` `handleCronOpenSession`）。`notify-then-run` 任务
    到点只投通知，用户点一下就走这条路径。
  移除是**列表操作**、不是禁令；要彻底摆脱该 vault 得同时删掉指向它的定时任务。是否要在确认态点名
  「该 vault 还有 N 个定时任务」见 design §6 的未采纳项。

### D3 撤销通道

- 选项 A（**倾向**）：有。移除成功后给一条**非 sticky** 提示（带「撤销」动作，8 秒后自动消隐——
  与既有带动作提示同档）；撤销按移除前的原值写回注册项（稳定 id / 路径 / 上次打开时间 / 失效治理
  标记），列表视为从未移除。
- 选项 B：不做撤销。误删只能靠「新增 vault…」重新加入，且得到的是新身份。
- 倾向理由：撤销的成本是「一条提示 + 一个写回命令」，而它把「删除注册表项」这个不可逆动作变成
  可逆；D2 选 A 之后，撤销是唯一能挽回身份（和它名下的会话历史）的通道。

### D4 sessions 移除是否还要动

- 选项 A（**倾向**）：**零改动**。M406 已交付「行内 × + 两步确认 + 活跃拒删 + 删除盘上 JSONL」，
  living spec 与真机场景 108 都在册；Alex 的需求按字面已被满足。
- 选项 B：要更显眼的入口（现在是淡色 `×`，不是文字按钮）。
- 选项 C：要批量能力（如「清空本 vault 的历史会话」）——这属新能力，需要另立裁决与范围。
- 倾向理由：先把「已存在」这件事摆在 Alex 面前；如果他指的是 B / C，回一句「指 B」或「指 C」即可，
  本 change 再扩（扩范围要重走节点 1，不在实现期静默加）。

## Non-goals

- **不删盘上数据**：vault 目录、其中任何文件、都不因移除而改变；不删 per-id 数据（标签会话 / 阅读
  位置 / harness 会话留存与附件）。
- **不提供「移除当前 vault」**（若 D1 改判为 B，本项随裁决解除）。
- **不做批量移除 / 清空列表 / 孤儿数据回收**：一次一行、只处理用户点中的那一项。
- **不处理 cron / 其它打开路径的联动**：移除不构成禁令——定时触发遇目标不是当前 vault 会**跳过**
  （任务静默停跑，不复活）；只有用户点击「运行」/ 点击结果通知才会打开它并重新登记（新 id，见 D2 的
  联动说明）。本 change 不阻断、不加检查。
- **不改 session 删除的既有行为**（入口形态、两步确认、活跃拒删、删盘上留存文件）。
- **不引入第三种治理标记**（`removed_at`）与「已移除但可复活」的状态（D2 选 C 才需要）。
- **不动 `last_vault`**：当前 vault 不可移除（D1 = A），因此 `last_vault` 永远指向一个仍在注册表里的
  vault，无需新写通道。

## Impact

- **影响的 specs**：`vault-workspace`（ADDED「vault 移除」+ ADDED「失效 vault 的处置与清理」承接条
  + REMOVED「失效 vault 的处置」）。
  `harness` 无 delta——会话删除已在该 capability 的 living spec 里（`:353`），本次不改。
- **影响的代码/系统**：`src-tauri/src/vault_registry.rs`（移除 / 撤销两个命令 + 当前 vault 守卫）、
  `src/vault-switcher.ts`（行内移除钮 + 确认态 + 列表刷新）、`src/main.ts`（命令接线 + 撤销提示）、
  `src/ipc.ts`（薄封装）、`src/style.css`（移除钮）、`src/copy-data.ts`（两个新错误码的人话映射）、
  `文案-Copy.md`（新增条目）、视觉基线（浮层元素级截图）、验收套件新场景（编号 223）。
- **归档时要同步的文本**：`openspec/specs/vault-workspace/spec.md:5` 的 capability 概览句
  「（单激活、稳定 id、只归档不删除）」与 `docs/specs/config-reference.md:445` 的同句——前者按纪律
  MUST NOT 在 change 活跃期提前改（归档步骤一并改），后者按实现期改；`src-tauri/src/vault_session.rs:19`
  的模块头注释同口径。
- **关联约束**：AGENTS.md 硬规则「变更默认直接切断」（不引入标记态、不做双读）；「基线更新是人肉
  裁决点」（浮层截图变化须 Alex 过目）；「仓库信息卫生」（验收 fixture 用合成 vault）。
