# OpenSpec 流程：提案 → 评审 → 实现 → 归档

目录结构与命令速查见 [openspec/README.md](../../openspec/README.md)。本文是全流程约定：谁在哪一步做什么、Alex 在哪些节点出现、每个 change 必须产出哪些制品。

## 全流程

```
起草 change ──► validate --all --strict ──► 提交 PR ──► 【评审节点 1：提案评审】
                                                        │ 通过
实现（勾选 tasks） ◄── Alex 批准 ◄──────────────────────┘
        │
        ▼
validate --all --strict + CI 门禁 + 独立 reviewer clean/merge ──► 提交 PR ──► 【节点 2：归档放行】
                                                                              │ 五要件齐
scripts/openspec-archive.mjs <id>（并入 living spec + 修链） ◄────────────────┘
        │
        ▼
归档后强制完成：提交归档结果 → `--archived` 审计 PASS + 记录（不 PASS 不算完成）
```

一个 change 对应一个 PR 序列：提案 PR 与实现 PR 可以合并为一个 PR（小型变更），也可以拆开（提案先行锁定意图）。判断标准：Alex 是否需要在实现前就裁决"做不做"。需要则拆开。

## 评审节点

| 节点 | 时机 | 看的制品 | 通过标准 |
|---|---|---|---|
| 1. 提案评审 | 实现开始前 | `proposal.md`（+ `design.md` 如有） | 不看代码即可裁决：为什么改、改什么、不做什么，三者都答清楚了 |
| 2. 归档放行 | 实现完成、archive 前 | `tasks.md` 勾选状态、`specs/` 增量、独立 reviewer 评审结论、门禁与真机证据 | 默认不找 Alex：下文「节点 2 五要件」全满足即由 tower 归档；命中「必须找 Alex 的例外类别」才送裁 |

节点 1 是硬门禁：**未经节点 1 通过的 change 不进入实现**——这是"人不 review 代码"模式下意图层的第一道防线（ADR 0004）。节点 2 **不是 Alex 的常规动作**（2026-10-25 Alex 裁决）：它仍是必须通过的闸，只是判据换成下文的五要件（独立评审 + 规格对账 + 门禁与真机证据），Alex 只在例外类别上出现。

## 节点 2：归档默认由独立评审 + 机器判据放行（2026-10-25 Alex 裁决）

裁决原话「认可。」：**归档默认机器与独立评审通过即可**，只有真正需要价值 / 行为裁决、审美手感、影响面升级、评审异常或证据缺口时才找 Alex。本节吸收 2026-10-18 的「纯目录移动才可由机器替代」判据（原判据的两个机器读数改挂在**归档后**的强制完成步骤里，不再作为归档前要件；来历见 git 历史与 change `trim-ignore-default-names` 的归档记录）——归档不再按「delta 有无新增内容」分通道，区分改由五要件承担。

**五要件**（归档前缺一不可；每条都要有可 `ls`、可复跑的证据，才由 tower 归档。这里只认**归档前**能取得的读数——`openspec archive` 自己的输出与归档后审计不在此列，见下文「归档后的强制完成步骤」）：

1. **方案已批准**：该 change 的节点 1 已通过（Alex 裁决原话，或整条有序链的批量裁决记录），实现期没有静默扩 scope。
2. **独立 reviewer 结论 clean / merge**：由非作者的 assigned reviewer 评审，结论 `clean`（无 P1 / P2 findings）且合并建议 `merge`，并绑定当前分支 tip——tip 之后有任何改动须重新评审。
3. **tasks 完成或有放弃理由**：`tasks.md` 全部勾选；未勾项就地写明放弃理由（不删任务项、不留空勾）。
4. **要求的门禁与真机证据通过**：该 change 声明的本地门禁（`scripts/gate.sh` 对应档）与真机验收场景 PASS；证据落 `.local/`（不落 worktree——合并后会被清理）；动过视觉的 change 另须本地像素层门禁绿。门禁红灯先修，不送 Alex。
5. **规格对账无丢段（归档前读数）**：`scripts/openspec-archive-check.mjs` 门禁模式（随 `scripts/docs-check.sh` 在 PR 阶段就跑）PASS——delta 的段落相对 living 有替代、无静默删除；`validate --all --strict` PASS；归档跟踪队列有且仅有一条条目（docs-check 门禁）。delta 相对 living 逐字相同（纯目录移动）时五要件照常判，只记为「归档后预期输出 `Specs already in sync; no files changed`」。

**必须找 Alex 的例外类别**（命中任一即停，不得自行归档）：

- **价值 / 行为裁决未决**：新增行为、取舍、产品语义、范围变化需要 Alex 表态；节点 1 已批准不等于实现期新增的行为一并批准。
- **审美手感**：观感、交互手感、视觉基线 `--update`（基线更新本就是人肉裁决点，见 [tests/visual/README.md](../../tests/visual/README.md)）。
- **影响面升级**：对既有产品设定 / 逻辑 / 实现有重大影响乃至推倒重来（[AGENTS.md](../../AGENTS.md)「影响面升级线」）。
- **评审异常**：reviewer 结论不是 clean / merge 且无法按常规返修收口（结论自相矛盾、多轮反复翻转、越界或漏审关键面）、评审 tip 与实际分支不符、评审本身可信度有疑点。
- **证据缺口**：该 change 要求的门禁 / 真机证据拿不出来、已过期或与声明不符——声称「已验」却给不出 PASS 指针即属此类。

**归档后的强制完成步骤**（不属于五要件，而是归档本身的收尾；缺一步归档不算完成）：

1. 执行 `node scripts/openspec-archive.mjs <change-id>`：包装器内调 `npx --yes @fission-ai/openspec@1.12.0 archive <change-id> --yes`（living spec 并入 `openspec/specs/`），随后做归档链接修复并自跑相对链接门禁（规则见下节）。纯目录移动（delta 与 living 逐字相同）时记下输出 `Specs already in sync; no files changed`（1.12.0 原文）。
2. **提交归档结果**：把归档目录（`openspec/changes/archive/<日期>-<change-id>/`）与并入后的 living spec（`openspec/specs/**`）一起提交。`--archived` 不是读工作区 diff——它用 `git log --diff-filter=A` 定位归档目录 `proposal.md` 的首次加入提交，再读该提交与其父提交的 living spec（`scripts/openspec-archive-check.mjs:489-493`、`:510-518`）；**未提交时它必然 FAIL**「无法在 git 历史里定位…归档提交」。
3. **归档提交后**跑 `node scripts/openspec-archive-check.mjs --archived <change-id>`，必须输出 `PASS`（用归档提交的前后快照核对 delta 的每个段落都完整落进了归档后的 living spec，无静默丢段）。
4. `--archived` 不 PASS ⇒ **归档不算完成**：按脚本指出的缺失段落从归档提交的前后快照恢复并提交补回，复跑审计至 PASS；不得用「已归档」或「历史归档」搪塞。批次收尾宣称完成前，本批每一次归档的 `--archived` 都必须 PASS——这是归档期唯一的丢段判据，归档前要件 5 证不到这一段。

**归档链接修复（包装器写侧最小修复，2026-10-28）**：`openspec archive` 把 change 目录移进 `openspec/changes/archive/<日期>-<change-id>/`（深一层）却不重写制品内的相对链接——活跃期按 `../../../docs/…` 写的链接归档后落到 `openspec/docs/…`，`scripts/openspec-links.sh` 判红（现场 M787：归档 `add-harness-activity-presence` 后 3 条不可达，只能手工改深一层再提交）。`scripts/openspec-archive.mjs` 归档后只做一条修复：对归档目录下每份 `*.md` 的每条 markdown 相对链接，**当前目标不可达且前加一层 `../` 后可达**才把目标改成 `../<原目标>`；当前可达（change 内部相对链接、已修过一次的链接）不动，要加两层才可达或目标本就不存在的**不修**——那种真死链仍由 links 判据判红，包装器不遮蔽。**读侧不豁免**：findings 里的方案②（让 links 判据对 `changes/archive/**` 按少一层的基准解析）被否，那会让真死链假绿、判据失去意义。外链 / 纯锚点 / 行内代码跨度 / 围栏代码块 / 非路径占位词不进判据（口径与 links 判据逐条一致）。`openspec archive` MUST 走本包装器；包装器最后自跑 `scripts/openspec-links.sh`，红即非零退出（archive 失败、定位不到归档目录同样非零）。历史归档件**不做批量重写**：既有归档按 `../../../../` 正确深度写、判据全绿，作者起草时照活跃期深度写相对链接即可，不必预判归档后的深度。

**归档记录要求（分两段写，写进 change 的 `proposal.md` 节点 2 块，沿用既有惯例）**：

- **归档前**：五要件各自的事实与指针——节点 1 批准依据；reviewer 的 verdict、评审时 tip 与评审文件路径；tasks 完成数或放弃理由位置；门禁输出行与证据目录绝对路径（`.local/...`）；要件 5 的三项读数（archive-check 门禁模式、`validate --all --strict`、队列条目唯一）。
- **归档后**：在同一块追加（或在该 change 的归档跟踪条目里给指针）归档提交的 hash、包装器（`openspec archive`）的实际输出（纯目录移动记 `Specs already in sync; no files changed`）、包装器的修链读数（`归档后修链 N 处` 与逐条 `from → to`）与 `--archived <change-id>` 的 PASS 读数及时间。
- 属有序链的写清链位置与前一环；命中例外、经 Alex 裁决后才归档的抄录原话与日期，机器放行的写「机器 + 独立评审放行（本节要件）」并列出关键读数——两种记录都不得只写「通过」。

**首批适用现场**：权限链 `harness-permission-rules-oct23` → `readonly-allowlist-tightening-oct23` → `rg-zip-flags-dangerous-oct24`（同一 `harness` 权限 requirement 的三段 delta，后一环以前一环归档后的 living 为基线），以及共用该段 requirement 的 `add-cron-conversational-registration`（排在 `harness-permission-rules-oct23` 之后）。这条链**不再逐个走人肉节点 2**：每环按五要件放行，链序与链内例外裁决一次完成（见下节）。

**存量字样**：既有 change 的 tasks / proposal / backlog 里「人肉节点 2」「待节点 2」按本节口径执行，不必为改字样单独返工（下一批自然消失）；但其中列出的**待裁事项**（如「0.3 / 0.4 待 Alex 追认」）仍是价值 / 行为裁决，照旧送 Alex。

## 归档节奏：批量裁决、材料与依赖（2026-10-25 Alex 裁决）

- **有序 change 链一次批量裁决**：多个 change 改同一条 requirement、delta 叠成先后基线（后一环以前一环归档后的 living 为基线）时，它们是一条**有序链**。链的裁决一次做完：tower 把链内例外项合成一次送裁，Alex 一次回话覆盖整条链；各环达到五要件即按链序归档，不再逐环送裁。链序由 delta 基线决定，MUST 串行归档——乱序归档时，后落的那一环用自己更早的基线整块替换 living，把先落的一环的增量静默抹掉，而对账门禁对此无感（它只比活跃 delta 与当次 living，不回看已归档的历史）。每一环归档后先提交归档结果、取得 `--archived` PASS，再归档下一环——前一环审计不 PASS（或归档没提交、审计定位不到提交），后一环的基线就不可信。
- **小变更合并送裁**：同一批里小型、无价值 / 行为裁决的 change 可以合并成一个评审包，一次过目同一节点（一批节点 1 一起送，或一批例外项一起送）。合并只减少往返次数，不改变裁决面，也不放宽「节点 1 在各自实现前批准」。
- **材料不自动构成阻塞**：送裁材料（评审包、README、截图归档）在场不构成阻塞理由——归档默认走五要件通道，不因「材料已备好、等 Alex 看」而停。阻塞只来自两类事实：命中例外类别且未裁决，或门禁红灯未修。反过来，材料备齐也不等于放行：五要件缺一仍不归档。tower 排期不把「材料齐 / 待送裁」记成队列阻塞项（`docs/backlog.md` 归档跟踪队列只记跟踪项与真实阻塞理由）。
- **依赖按真实文件冲突判**：mission 合并依赖按**实际改动的文件集**重叠判定（`git diff --name-only <base>...<branch>` 的交集），不按 mission scope 里声明的宽泛 glob——`tests/visual/**` 这类声明只用来画越界边界，不是依赖证据（现场：M722 因 M715 的 `tests/visual/**` 被判伪依赖，最终用无真实文件重叠的新 mission 承载同一提交）。伪依赖不得阻塞合并。change 归档顺序是另一回事：按 delta 基线依赖判，见上一条。

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

归档结果提交后 MUST 对指定 change 做一次事后审计（脚本用 `git log` 定位归档提交、读该提交的前后快照核对是否真的丢了段落，已被人工恢复的只报 INFO）——这是「归档后的强制完成步骤」的第 3 步，输出 `PASS` 才算归档完成；未提交归档结果时脚本定位不到提交，必然 FAIL：

```
node scripts/openspec-archive-check.mjs --archived <change-id>
```

已知边界：同一 gap 里删一段、增一段时按位置配对判「改写」，故「删一段、原地写一段无关内容」会被当作改写放行——这类改动在 PR diff 里是可见的，不属本判据守的静默丢失面。

**活跃 change 的 MODIFIED 内容 MUST NOT 提前写进 living spec**（2026-10-18 Alex 裁决，2026-10-25 口径延续；原话：「如果只是需要两个字，不需要我做什么，那真的有必要等我回一句吗？」——归档默认放行的前提就是 delta 必须留下可对账的增量，不能先写进 living 把判据掏空）：living spec 只由 `archive` 从 delta 并入；change 仍活跃时直接改写 living，会让 delta 与 living 逐字相同——归档退化为纯目录移动，独立 reviewer 与「节点 2 五要件」的要件 5 都没有增量可核，上面的对账门禁也同样判不出任何东西（delta == living ⇒ 无段落可丢）。现场：change `trim-ignore-default-names` 的 delta 在活跃期被直接写进 `openspec/specs/{fs-io,file-tree}/spec.md`，沉淀为 finding `.tower/comms/findings/20261018-worker-m569-improve-change-trim-ignore-default-names-delta-living-spec-living.md`，M571 以「直接归档」处置。特例：行为随实现合并立即生效、living spec 必须描述现状（读者拿 living 当现状读）时允许提前改写，但须 tower 在 mission 里**显式授权**并写明理由；授权只针对该 change，不构成后续 change 的先例。

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
4. **实现**：按 `tasks.md` 逐项实现并勾选（`- [x]`）。发现 proposal 意图需要变更时，停下：更新 proposal 并重新走节点 1，不静默扩 scope。**修复类 PR（收掉某个既有 backlog 条目）MUST 同批删除 `docs/backlog.md` 对应条目，reviewer 合并前核对本批 diff 是否带删除**——不把删除留给下一批清理。
5. **归档放行**：tasks 全部勾选（或标注放弃原因）后，同一 PR 在 `docs/backlog.md` 的归档跟踪队列落一条记录（判据见「批次收尾 checklist（归档跟踪）」下的「归档队列的机器判据」——缺条目 / 重复条目会让 docs-check 报红），逐条核对「节点 2 五要件」并把记录写进 proposal 的节点 2 块；五要件齐即由 tower 归档，命中「必须找 Alex 的例外类别」才送裁。
6. **归档与归档后审计**：五要件齐（例外项另经 Alex 裁决）后执行 `node scripts/openspec-archive.mjs <change-id>`（包装器内调 `npx --yes @fission-ai/openspec@1.12.0 archive <change-id> --yes`，living spec 自动并入 `openspec/specs/`，随后修归档链接并自跑相对链接门禁——不要绕过包装器直接调 CLI）；**提交归档结果**（归档目录 + living spec + 修链改动），再按上文「归档后的强制完成步骤」跑 `node scripts/openspec-archive-check.mjs --archived <change-id>` 并取得 `PASS`、把归档提交 hash 与两次读数记进归档记录——**归档提交后审计不 PASS 不算归档完成**。

## 批次收尾 checklist（归档跟踪）

实测失效模式（M150 归档对账，2026-09-17）：**实现 PR 合并后没人跟进归档**——当时 11 个活跃 change 里 7 个已实现未归档（`add-wikilink` 积压 12 天），living spec 因此长期落后于实现，其间还出现 living spec 与实现直接矛盾（`editor-live-preview` 自称「M1 只读口径」而 md 模式早已可编辑）。防线是把它做成批次收尾的强制项：

- [ ] **本批 merge 的 change 全部列入归档待办并跟踪到归档**：每个 change 在实现 PR 合并时即落一条归档跟踪记录（记在 `docs/backlog.md`；待归档属可客观核对的事项，由 tower 记账、不进「待 Alex 裁决」区），批次收尾时用 `npx --yes @fission-ai/openspec@1.12.0 list` 逐个核对——列表里出现 `✓ Complete` 却仍在活跃列表里的，就是漏跟踪的那个。**这条已机器化**（2026-10-24，M684）：tasks 全勾的活跃 change 在 `docs/backlog.md` 没有条目或有多条，`scripts/openspec-archive-check.mjs` 直接报红（判据口径见下）。
- [ ] **归档前逐条对账**（对账口径）：tasks 勾选状态 / spec 增量 / 当前实现三者一致才归档；任务未勾但有正当理由的，先就地标注放弃原因再归档；spec 增量与实现矛盾的，**不归档**，并在 `docs/backlog.md` 说明矛盾点。其中「spec 增量没丢掉 living spec 的既有段落」由机器判据分工兜底——**归档前**由 `scripts/openspec-archive-check.mjs` 门禁模式（随 `scripts/docs-check.sh` 在 PR 阶段就跑）判 delta 有没有静默删段，**归档后**由同一脚本的 `--archived <change-id>` 判 delta 的段落是否真的落进了 living（按上文「归档后的强制完成步骤」执行，不 PASS 不算归档完成）。「节点 2 五要件」齐即由 tower 归档（默认不找 Alex），命中「必须找 Alex 的例外类别」才送裁；纯目录移动（delta 与 living 逐字相同）照跑同一套对账。
- [ ] **归档后核对新建 capability 的 Purpose**：`archive` 会为新建的 living spec 写入占位 Purpose（`TBD - created by archiving change …`），`validate --all --strict` 会因此报红——须手写替换为「这个 capability 是干什么的」，再跑一次 validate 确认全绿。
- [ ] **backlog 卫生（2026-10-12 Alex 裁决；2026-10-24 机器化）**：本批核销 / 裁决落地的条目**直接从 `docs/backlog.md` 删除、不留索引**（git 历史即台账；含仍在生效的长期口径时迁 `docs/specs/standing-decisions.md`）；**修复 PR MUST 同批删除对应条目、reviewer 合并前核对本批 diff 是否带删除**——不把删除留给下一批清理；条目一律一行 gist + 证据指针 + 出口，批次报告与全量回归总表只留指针；只记改变未来动作的信息（结论 / 待办 / 裁决点 / 复现口径）——过程性验证状态（「跑完、PASS」类）不入账（2026-10-16 Alex 裁决，口径见该文件头部「维护规则」）；体量红线 **80 行是硬上限、无 ratchet、无既有豁免**（Alex 2026-10-24 自 300 下调），超限由 `scripts/backlog-check.mjs` 在 docs-check 里直接报红——「已查即过」的免死口已删除；不为压行数删活条目（该删的是已完成 / 无出口的僵尸条目）。
- [ ] **finding 落账率对账（2026-10-12 Alex 认可）**：本批 `.tower/comms/findings/` 新增文件数与 `docs/backlog.md` 新增条目数逐一核对，不等即查漏——漏落账的 finding 等于没登记。
- [ ] **复发对账（2026-10-17 Alex 裁决）**：本批踩的坑若命中 REVIEW.md 已有条目（含已固化删除、只存于 git 历史的条目），复发 = 居所没拦住——先查防线该不该往更近的居所搬（人读 → tower 注入 → 机器门禁）或改写，不是只往该条证据里补一行现场。
- [ ] **新条目准入与引用写法自检（2026-10-12 Alex 认可）**：本批新增的「待 Alex 裁决」条目只收**价值取舍 / 产品语义**类（答案客观可核的由 tower 直接裁并记录）；跨文件引用 backlog 条目一律用**主题关键词锚**，不用编号 / 行号。
- [ ] **push 后跟进到 CI 终态**：按 AGENTS.md「操作流程」的 CI 观察者条执行；未全绿不得宣称批次完成。
- [ ] **版本与打包（仅本批需要交付安装包时）**：按 `docs/process/release.md` 执行——semver 口径、bump 面（`src-tauri/tauri.conf.json` 的 `version` 为唯一真源，`package.json` / `Cargo.toml` / `Cargo.lock` 同步；视觉桩钉死 9.9.9 不跟随）、打包前置条件、产物路径与 sha256 记录惯例均以该文为 canonical（M522 落地，2026-10-15）。

**归档队列的机器判据（2026-10-24，M684）**：上列第一条「每个 change 在实现 PR 合并时即落一条归档跟踪记录」已由 `scripts/openspec-archive-check.mjs` 的门禁模式执行（随 `scripts/docs-check.sh` 进本地 `gate.sh quick` 与 CI 的 docs-check.yml）；判据口径：

- **活跃面按位置判**：`openspec/changes/` 的直接子目录才是活跃 change；撤回件在 `changes/archive/<日期>-withdrawn-<id>/` 之下，天然不在扫描面。不按名字里的 `withdrawn` / `archive` 字样过滤（活跃 id 恰好含这些字样时仍是活跃 change）。
- **完成判定**：`tasks.md` 的 checkbox 行至少一项且全部勾选（`- [x]`）；`]` 之后是否紧跟正文不限（既有 `- [ ]（归档时执行…）` 写法同样算未勾）。零任务项不判完成——避免「没有任务 ⇒ 空真放行」；`tasks.md` 缺失或读不到才报红，制品完整性另由 `validate --all --strict` 兜底。
- **条目判定**：`docs/backlog.md` 里一行列表项，加粗首段**恰好**是 ``序 N · `<change-id>` ``（新批次可省略「序 N ·」，只留反引号里的 change-id），即 ``- **序 3 · `scrollbar-tiers-oct24`**（…）``。完成 change 必须有且仅有一条：缺失报出补登模板，重复报出行号。**正文里的提及不算条目**（如「外部前置」段落里点名一个 change），否则判据会退化成子串匹配（REVIEW.md「断言等价于子串，没有区分度」条）。
- 完成 change 的实现 PR 就须落这条记录（M 号用该实现 mission 的编号，只写可核事实与放行状态：五要件齐待归档 / 命中例外待裁；归档顺序与同 requirement 冲突由 tower 排期时核对）。
- 本判据只判台账在场：**不判节点 2 五要件是否满足、不判归档顺序、不执行 archive**——放行判定按上文「节点 2：归档默认由独立评审 + 机器判据放行」执行。

**backlog 出口的机器判据（2026-10-24，M692）**：`backlog 卫生` 一条里的「核销即删除 / 一行一个可关闭单元 / 80 行上限」已由 `scripts/backlog-check.mjs` 执行（随 `scripts/docs-check.sh` 进本地 `gate.sh quick` 与 CI 的 docs-check.yml）。判据按 `## ` 区块分类，口径：

- **work（标题含 `待修` / `已立项` / `待真机验收`）**：每条必须有一处**带内容**的出口标记（`下一动作：` / `出口：` / `关闭条件：` / `→` 后接空白，且标记后至少一个非空白字符——光写 `→ ` / `下一动作：` 不算出口；`→ →` / `出口： →` 这类连续空标记整链剥完仍无内容同样不算，正文里的 `A → B` 不算被剥）；出现完成标记（已修 / 已核销 / 已落地 / 已收口 / 已接账 / 已解决 / 已关闭 / 已完成）仍留条目 ⇒ 报红。修改类 PR 收掉的问题，条目在该 PR 里删掉，不要改写成「已修」。
- **record（标题含 `记录在案` / `承接残项` / `长期口径`）**：长期口径必须有带内容的出口、canonical 指针（`docs/` `openspec/` `src/` `src-tauri/` `scripts/` `tests/` `demo/` `.github/` 下的仓内路径）或带内容的 `复核：` / `复核口径：` 口径之一（空标记与 `复核： →` 这类空链不算）；canonical 指针必须存在，死指针报红。
- **decision（标题含 `待 Alex 裁决` / `#decide`）与 queue（标题含 `归档跟踪队列`）**：不判出口——前者由 Alex 裁，后者由上面的归档队列判据判条目在场。
- **finding 指针**：`` finding `<slug>` `` 或 `` `.tower/comms/findings/<slug>.md` `` 指向同一 slug 出现在多条 ⇒ 报红；文件不存在 ⇒ 报红。`.tower/` 不入 git，CI 检出与 worktree 没有该目录时只 INFO 跳过——不把「读不到」当「指针丢了」。
- **`.local` 指针**：缺失只 WARN（本地证据桶随清理轮换，见 `.local/README.md`）；整个 `.local` 不存在（CI）时只 INFO 跳过。
- **行数**：`docs/backlog.md` 超过 80 行 ⇒ 报红。**硬上限，无 ratchet、无既有豁免**；不为压行数删活条目。
- **年龄**：0–14 / 15–30 / 31–60 / >60 天分档与无出口计数只进报告，不判红（Alex：「条目年龄先作为报告指标」）。
- 未归类区块只 WARN——新区块须显式归类，否则出口判据会静默漏掉整块。

判据是文本级的，只认区块标题与上述标记写法；「条目内容是否正确」不在它守的面内（那是 review 的事）。

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
