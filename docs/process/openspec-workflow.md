# OpenSpec 流程：提案 → 评审 → 实现 → 归档

目录结构与命令速查见 [openspec/README.md](../../openspec/README.md)。本文是全流程约定：谁在哪一步做什么、Alex 在哪几个节点评审、每个 change 必须产出哪些制品。

## 全流程

```
起草 change ──► validate --all --strict ──► 提交 PR ──► 【评审节点 1：提案评审】
                                                        │ 通过
实现（勾选 tasks） ◄── Alex 批准 ◄──────────────────────┘
        │
        ▼
validate --all --strict + CI 门禁 ──► 提交 PR ──► 【评审节点 2：归档评审】
                                                  │ 通过
openspec archive（并入 living spec） ◄── 节点 2 通过 ◄────┘
```

一个 change 对应一个 PR 序列：提案 PR 与实现 PR 可以合并为一个 PR（小型变更），也可以拆开（提案先行锁定意图）。判断标准：Alex 是否需要在实现前就裁决"做不做"。需要则拆开。

## Alex 的评审节点

| 节点 | 时机 | 看的制品 | 通过标准 |
|---|---|---|---|
| 1. 提案评审 | 实现开始前 | `proposal.md`（+ `design.md` 如有） | 不看代码即可裁决：为什么改、改什么、不做什么，三者都答清楚了 |
| 2. 归档评审 | 实现完成、archive 前 | `tasks.md` 勾选状态、`specs/` 增量 | tasks 全部勾选或标注放弃原因；spec 增量与 proposal 的意图一致，无实现期静默扩scope。delta 相对 living spec 无新增内容的纯目录移动可由机器判据替代人肉评审（见下） |

两个节点都是硬门禁：**未经节点 1 通过的 change 不进入实现；未经节点 2 通过的 change 不 archive。** 这是"人不 review 代码"模式下意图层唯一的防线（ADR 0004）。节点 2 的「通过」有两条通道——Alex 人肉评审，或纯目录移动情形下的机器判据替代（见下）。

**节点 2 的机器判据替代**（2026-10-18 Alex 裁决）：归档命令与归档对账脚本合起来判「delta 相对 living spec 无新增内容、无静默丢段」时，归档**不等 Alex 人肉点头**，机器判据即通过。两个机器读数缺一不可：

- 归档命令输出 `Specs already in sync; no files changed`（1.12.0 原文）——delta 相对 living 无任何新增 / 改动，归档是纯目录移动；
- 归档提交后 `node scripts/openspec-archive-check.mjs --archived <change-id>` 输出 `PASS`——无静默丢段，且 delta 的每个段落都完整落进了归档后的 living spec。

delta 相对 living spec **有新增内容**时仍走人肉节点 2：机器只能证「没丢东西」，证不了「新增的东西是对的」。裁决原话（2026-10-18）：「如果只是需要两个字，不需要我做什么，那真的有必要等我回一句吗？」——机器能判定「无事可裁」时，再等人肉回一句没有价值。首个适用现场：change `trim-ignore-default-names`（M571 归档，delta 与 living 逐字相同，两个读数均如上）。

评估性约定（ADR 0004 第 4 条）：自首个全循环跑通起算，跑满 ≥3 个全循环或满两周，先到为准，评估"评审制品是否真的让 Alex 不看代码也能裁决"。不达标则退化为 `docs/proposals/` + 模板自建约定，不留恋。

## 制品清单（每个 change）

| 制品 | 必填 | 起草时机 | 模板 |
|---|---|---|---|
| `proposal.md` | 是 | 提案阶段 | [templates/proposal.md](templates/proposal.md) |
| `tasks.md` | 是 | 提案阶段（可随实现细化） | [templates/tasks.md](templates/tasks.md)。改权限 / 闸语义时必含「回扫既有验收场景的闸期望」一项（见下） |
| `design.md` | 技术复杂时；**有原型时必填**，且须含「视觉保真」一节（见下） | 提案阶段 | — |
| `specs/<capability>/spec.md` | 是 | 提案阶段起草，实现期可修订 | 见下方 spec 增量约定 |

spec 增量（delta）约定：change 目录下的 `specs/<capability>/spec.md` 只写增量操作——`## ADDED Requirements` / `## MODIFIED Requirements` / `## REMOVED Requirements` / `## RENAMED Requirements`。每个 requirement 用 `### Requirement: <名称>` 起头，正文含 `SHALL`/`MUST`，且至少一个 `#### Scenario:`。archive 时这些增量并入 `openspec/specs/<capability>/spec.md` 成为 living spec。

**MODIFIED 是整块替换，不是逐段合并**（2026-10-18 实测 + 对账门禁）：`openspec archive` 处理 MODIFIED requirement 时，用 delta 的同名块覆盖 living spec 里那一整条——delta 里少抄的段落会在归档时**静默消失**，`validate --all --strict` 与相对链接检查都看不见（现场：change `add-harness-chat-completions-dialect` 的「会话本地留存」漏抄一段 847 字符的既有正文，归档后从 `openspec/specs/harness/spec.md` 消失，事后人工恢复）。因此写 MODIFIED 的做法是**整条复制现行 requirement 正文再改**，不要只写「改动的那段」。

这条判据已机器化：`scripts/openspec-archive-check.mjs`（挂在 `scripts/docs-check.sh` 里，本地 `gate.sh quick` 与 CI 的 docs-check.yml 同时继承）。对每个活跃 change 的 MODIFIED 块，它把 living requirement 的段落与 delta 同名块按逐字相等对齐：被删的段落必须在 delta 里有替代内容（改写），否则报红并给出可直接抄的声明行。确属本次删除的段落，在 delta 文件首个 `## ` 之前加一行显式认领（写在 requirement 块内会被归档原样搬进 living spec）：

```
> 归档对账声明：删除「<该段里 8 字以上的原样片段>」
```

归档之后可再对指定 change 做一次事后审计（用 git 里归档提交的前后快照核对是否真的丢了段落，已被人工恢复的只报 INFO）：

```
node scripts/openspec-archive-check.mjs --archived <change-id>
```

已知边界：同一 gap 里删一段、增一段时按位置配对判「改写」，故「删一段、原地写一段无关内容」会被当作改写放行——这类改动在 PR diff 里是可见的，不属本判据守的静默丢失面。

**活跃 change 的 MODIFIED 内容 MUST NOT 提前写进 living spec**（2026-10-18 Alex 裁决；原话：「如果只是需要两个字，不需要我做什么，那真的有必要等我回一句吗？」——机器判据要在无事可裁时替代人肉点头，前提就是 delta 必须留下可对账的增量，不能先写进 living 把判据掏空）：living spec 只由 `archive` 从 delta 并入；change 仍活跃时直接改写 living，会让 delta 与 living 逐字相同——归档退化为纯目录移动，节点 2 评审没有增量可看，上面的对账门禁也同样判不出任何东西（delta == living ⇒ 无段落可丢）。现场：change `trim-ignore-default-names` 的 delta 在活跃期被直接写进 `openspec/specs/{fs-io,file-tree}/spec.md`，沉淀为 finding `.tower/comms/findings/20261018-worker-m569-improve-change-trim-ignore-default-names-delta-living-spec-living.md`，M571 以「直接归档」处置。特例：行为随实现合并立即生效、living spec 必须描述现状（读者拿 living 当现状读）时允许提前改写，但须 tower 在 mission 里**显式授权**并写明理由；授权只针对该 change，不构成后续 change 的先例。

## 有原型时的设计合同：视觉保真必填（2026-10-06）

凡有原型的 change——`design/prototypes/` 下的原型、Alex 过目定稿的原型截图、或提案期以屏幕形态定下的方向——`design.md` 的合同**必须含「视觉保真」一节**，逐屏（或逐表面）列出可直接对账的视觉口径：

- **布局节奏**：各区域的比例、间距、对齐锚点（如 pane 1:1、段落间距、标签段与分隔条的像素对齐关系）。
- **卡片 / 气泡样式**：边框、圆角、底色、阴影、强调条的宽窄与颜色族。
- **字层级**：标题 / 正文 / meta 行各取哪一档字号、字重、行高、字族。
- **各状态样式**：hover / focus / 处理中 / 空态 / 高用量等状态的差异（颜色、动效、退让）。

**禁止只写「沿用既有设计系统」打发视觉层**：这句话对实现者不构成可执行口径、对 reviewer 不构成可判据——合同只写了行为，视觉层就落进无人负责的真空，实现照合同把行为做对、形态走样，评审按合同核验也抓不到（现场：harness pane，2026-10-06，Alex「粗糙、美观度为零」）。失效点在起草期：worker / reviewer 进场前合同已定稿，补记在别处都晚一步。

验收口径按**观感一致**而非逐像素：原型若是独立 HTML，其字体度量、数据内容都与产品不同，逐像素在技术上不可达、追求它只会逼出假对齐。核对用**并排截图对照**（原型截图 vs 实现截图），不追求像素相等。**reviewer 出 verdict 前必须做这一步对照**：合同里没有的真源，实现者不会补、reviewer 按合同文字也无从核——「相对原型的偏差」只有并排截图看得见（REVIEW.md「原型只提取行为」条的两次现场）。

原型已退役（`design/prototypes/` 目录随实现落地删除）而屏位原文仍有用的，从 git 历史提取——`git show <退役提交>^:<原型路径>`——把屏位要点落进本节（先例：`openspec/changes/archive/2026-10-06-move-harness-to-pane-chat-frame/design.md` §9「屏位设计合同附节」，从 `4e011d6^:design/prototypes/phase2-harness-chat/` 提取）。手感 / 审美类（拖拽节奏、动效曲线）显式标注「归 Alex 手感裁决，不进机器判据」，不留含糊。

## 改权限 / 闸语义的 change：tasks 必须含回扫既有验收场景的闸期望（2026-10-16）

凡改动**权限 / 批准闸语义**的 change——默认档放行矩阵、ask / allow 规则、工具白名单这类，`tasks.md` **必须含一项**「全量回扫既有验收场景里对该闸、该模式的期望，逐条改准」，只新增覆盖新语义的场景**不算**完成。

失效点在现场（M407 → M480，2026-10-13）：M407（change `add-harness-permission-modes`）把默认档（`vault_write`）改为 `vault_patch` / `vault_create` / `vault_move` 自动放行，living spec 同步更新；而归档 change 的 tasks §6.7 只**新增**了场景 109/110/111，没**回改** M302/M304 时代写下的场景 72/73/74 的「写类工具默认 ask」期望（场景 96 靠显式 allow 规则绕闸、注释口径同样过期）。10-09 起 72/73/74 必红，两个批次连中被读成「写工具绕过批准闸」的安全缺陷——排查方向被这个假红带偏，最后才发现是场景期望过期。

为什么单列一条：验收场景里的闸期望是写死在场景文件里的「当时的产品语义」，改闸语义时它们不会自己跟着变；而这类过期期望产生的红看起来正好像产品缺陷（安全类尤其吓人），归因成本远高于顺手回扫。与「新功能 mission 的 tasks 必须附带新增 / 更新验收场景一项」（AGENTS.md 真机验收套件节）分工：那条管**新增**场景，本条管**回扫既有**场景的过期期望——改闸 / 改语义时两条都要落。

## AI agent 的操作指令

1. **起草**：在 `openspec/changes/<change-id>/` 下创建制品。change-id 用 kebab-case 动词短语（如 `add-perf-measurement-methodology`）。复制 `docs/process/templates/` 下的模板。有原型的 change，`design.md` 还须含「视觉保真」一节（见上）。
2. **自验**：`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 必须通过；CI 会重复此校验。
3. **提案 PR**：提交并在 PR 描述中 @ Alex 请求节点 1 评审。未通过则按批注修订，保持 change 不进入实现。
4. **实现**：按 `tasks.md` 逐项实现并勾选（`- [x]`）。发现 proposal 意图需要变更时，停下：更新 proposal 并重新走节点 1，不静默扩 scope。
5. **归档评审**：tasks 全部勾选（或标注放弃原因）后提交 PR 请求节点 2 评审；delta 相对 living spec 无新增内容的纯目录移动按上文「节点 2 的机器判据替代」直接归档，不等人肉点头。
6. **归档**：节点 2 通过后执行 `npx --yes @fission-ai/openspec@1.12.0 archive <change-id> --yes`，living spec 自动并入 `openspec/specs/`；随后按上文跑一次 `--archived` 事后审计。

## 批次收尾 checklist（归档跟踪）

实测失效模式（M150 归档对账，2026-09-17）：**实现 PR 合并后没人跟进归档**——当时 11 个活跃 change 里 7 个已实现未归档（`add-wikilink` 积压 12 天），living spec 因此长期落后于实现，其间还出现 living spec 与实现直接矛盾（`editor-live-preview` 自称「M1 只读口径」而 md 模式早已可编辑）。防线是把它做成批次收尾的强制项：

- [ ] **本批 merge 的 change 全部列入归档待办并跟踪到归档**：每个 change 在实现 PR 合并时即落一条归档跟踪记录（记在 `docs/backlog.md`；待归档属可客观核对的事项，由 tower 记账、不进「待 Alex 裁决」区），批次收尾时用 `npx --yes @fission-ai/openspec@1.12.0 list` 逐个核对——列表里出现 `✓ Complete` 却仍在活跃列表里的，就是漏跟踪的那个。
- [ ] **归档前逐条对账**（对账口径）：tasks 勾选状态 / spec 增量 / 当前实现三者一致才归档；任务未勾但有正当理由的，先就地标注放弃原因再归档；spec 增量与实现矛盾的，**不归档**，并在 `docs/backlog.md` 说明矛盾点。其中「spec 增量没丢掉 living spec 的既有段落」由机器判据兜底（`scripts/openspec-archive-check.mjs`，随 `scripts/docs-check.sh` 在 PR 阶段就跑）；归档完成后再对该 change 跑一次 `node scripts/openspec-archive-check.mjs --archived <change-id>` 复核。纯目录移动（delta 与 living 逐字相同）的归档按上文「节点 2 的机器判据替代」走，不等 Alex 点头。
- [ ] **归档后核对新建 capability 的 Purpose**：`archive` 会为新建的 living spec 写入占位 Purpose（`TBD - created by archiving change …`），`validate --all --strict` 会因此报红——须手写替换为「这个 capability 是干什么的」，再跑一次 validate 确认全绿。
- [ ] **backlog 卫生（2026-10-12 Alex 裁决）**：本批核销 / 裁决落地的条目**直接从 `docs/backlog.md` 删除、不留索引**（git 历史即台账；含仍在生效的长期口径时改移「承接残项」）；条目一律一行 gist + 证据指针，批次报告与全量回归总表只留指针；只记改变未来动作的信息（结论 / 待办 / 裁决点 / 复现口径）——过程性验证状态（「跑完、PASS」类）不入账（2026-10-16 Alex 裁决，口径见该文件头部「维护规则」）；顺带检查体量红线——`wc -l docs/backlog.md` 超 **300** 行即触发一次结构清理（口径见该文件头部的「维护规则」；无核销/僵尸项可清时记「已查」即过，不为压行数删活条目）。
- [ ] **finding 落账率对账（2026-10-12 Alex 认可）**：本批 `.tower/comms/findings/` 新增文件数与 `docs/backlog.md` 新增条目数逐一核对，不等即查漏——漏落账的 finding 等于没登记。
- [ ] **复发对账（2026-10-17 Alex 裁决）**：本批踩的坑若命中 REVIEW.md 已有条目（含已固化删除、只存于 git 历史的条目），复发 = 居所没拦住——先查防线该不该往更近的居所搬（人读 → tower 注入 → 机器门禁）或改写，不是只往该条证据里补一行现场。
- [ ] **新条目准入与引用写法自检（2026-10-12 Alex 认可）**：本批新增的「待 Alex 裁决」条目只收**价值取舍 / 产品语义**类（答案客观可核的由 tower 直接裁并记录）；跨文件引用 backlog 条目一律用**主题关键词锚**，不用编号 / 行号。
- [ ] **版本与打包（仅本批需要交付安装包时）**：按 `docs/process/release.md` 执行——semver 口径、bump 面（`src-tauri/tauri.conf.json` 的 `version` 为唯一真源，`package.json` / `Cargo.toml` / `Cargo.lock` 同步；视觉桩钉死 9.9.9 不跟随）、打包前置条件、产物路径与 sha256 记录惯例均以该文为 canonical（M522 落地，2026-10-15）。

## 撤回（withdrawn）：放弃一个 change

僵尸提案（从未进入实现，其能力已由别的 mission 实现、或路线已废）不能留在活跃列表里——`openspec list` 会永远把它们当在办事项。OpenSpec CLI 没有 withdraw 命令，本项目口径（M150 首次执行）：

1. 把 change 目录整体移到 `openspec/changes/archive/<日期>-withdrawn-<change-id>/`：活跃列表清空、提案全文留档（含 design 与证据文件）、CI 的 change 制品检查跳过 `archive/`。`withdrawn-` 前缀把「撤回」与「已合并归档」在目录名上分开。
2. 在它的 `proposal.md` 头部补一段「撤回记录」：日期、为什么不再推进、问题由谁承接、以及**遗留了什么**（未按其形态产出的验收面、未进 living spec 的口径缺口）——三件事缺一，撤回就退化成静默删除。
3. 同步配套文档：`docs/specs/*` 的状态头改为「已撤回（留档作重启输入）」，并在 `docs/backlog.md` 落核销条目。三处（archive 目录、spec 状态头、backlog）要能互相印证。
4. 撤回件不再受 `validate --archived` 的「任务全勾」约束（该检查本就不在 CI 与 `gate.sh` 里）。

## 首个全循环对象：性能测量方法学 spec（与 M8 的约定）

ADR 0004 第 4 条指定 OpenSpec 的首个全循环验证对象为 M8（feat/perf-spec-ci）的性能测量方法学 spec。约定如下：

- **change-id**：`add-perf-measurement-methodology`。
- **capability**：`perf-measurement`（living spec 落在 `openspec/specs/perf-measurement/spec.md`）。
- **proposal 内容要点**：为 ADR 0002 第 6 条的四个性能数字（冷启动 <300ms、keypress-to-paint <16ms、打开 1MB Markdown <100ms、常驻内存 <200MB）各写一节测量方法学——测量端点、工具链、采样口径、fixture 规格；注明空壳 app 阶段的口径（headless CI 注入近似为下界、占位 fixture），绝对值仅用于 ADR 0002 revisit 的一次性校准，不代表达标。
- **本 mission（M10）提供的衔接物**：上述模板 + 本流程文档即 M8 的操作依据。M8 worker 启动后，如有制品格式分歧，通过 tower 消息对齐；模板改动的所有权在 M10 归档后的 repo 现状，谁改谁负责同步更新本文件。
