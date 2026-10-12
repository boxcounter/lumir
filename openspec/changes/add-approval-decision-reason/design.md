# Design: 判定依据的数据流与落点

> 起草注记（非规格正文）：本文只解决「判定依据从哪里来、怎么到前端、三处落点各自说什么」。
> 判定结论本身一行不改（Alex 2026-10-12：「这个逻辑不用改」）。

## 1. 数据流：Rust 一处判定 → 两条通道 → 前端零推导

约束（mission 原文第一条）：**判定依据 MUST 来自 Rust 判定管线，前端 MUST NOT 自行二次推导**。
落法是把「哪一层拦的」做成判定管线的**返回值的一部分**，随既有两条 UI 通道到达前端：

```text
permissions::decide() -> Verdict { decision, reason: Option<DecisionReason> }
        │
        ├─ Decision::Ask ──► gated_execute ──┬─► ApprovalRequest.reason ──► PendingApprovalSnapshot.reason   （快照通道）
        │                                    └─► events::approval_request_with_purpose(…, reason)             （事件通道）
        └─ Decision::Deny ──► 回送模型的错误文案里拼上规则原文（第 1 层；不产卡）
```

- `DecisionReason` 是 ts-rs 导出类型（`src/bindings/DecisionReason.ts`），前端 import 它做类型标注；
  运行时形状由 serde 产出（internally tagged：`{"kind": …, …}`）。
- 事件与快照**同吃一个 `Verdict`**：`gated_execute` 从 `handle_call` 收 `Option<&DecisionReason>`，
  同一份同时喂 `ApprovalRequest` 与事件函数——不存在第二处判定（REVIEW.md 第 8 条：
  跨层传递的语义只应有一处产出）。
- 前端只做**呈现映射**：`kind` → 文案模板（`approvalReasonText`）；`{mode}` → 既有 `permissionFullName`、
  `{desc}` → 既有 `permissionDescription`（都是 D427–D432 的读数，不是层级推导）。

## 2. 层级枚举：四个变体，各有消费者

```rust
pub enum DecisionReason {
    /// 第 1 层：用户 deny 规则命中（带规则原文）
    DenyRule { rule: String },
    /// 第 3 层：危险黑名单 · shell 包装器（带命令名）
    DangerousWrapper { command: String },
    /// 第 3 层：危险黑名单 · 其余成员
    DangerousCommand,
    /// 第 5 层：模式默认分层（带当时档位）
    ModeDefault { mode: PermissionMode },
}
```

变体选择是**按消费者**定的，不是按管线层数定的（REVIEW.md 第 9 条：声明必须有消费者）：

| 变体 | 消费者 | 为什么不是别的形状 |
|---|---|---|
| `DenyRule` | `turn.rs` 的 deny 错误文案（`rule` 原文拼进去） | 不产卡，故不进 `ask_reason`；规则原文只在错误文案里出现一次 |
| `DangerousWrapper` | 批准卡判定依据行（`command` = 命中的包装器名，如 `zsh`） | 包装器的不透明性正是 Alex 现场疑惑的原点（`zsh -lc` 看起来无害），点名有诊断价值 |
| `DangerousCommand` | 批准卡判定依据行（不带载荷） | **不点名**：`sudo rm -rf /` 这类调用的命中者是递归展开后的内层命令，`decide` 只看得到外层 argv[0]，点名会写出错误主词（裁见 proposal 裁决点 2）。结论不依赖名字——命令原文就在卡上 |
| `ModeDefault` | 批准卡判定依据行（`mode` 用于选档释义） | 带档位而不是让前端读自己的 `permMode`：判定发生在 Rust 读到的配置上，面板的档位读数是另一处状态，两者可在「外部改了 config.json」时漂开（单一真源） |

**没有** `AllowRule` / `Cached` / `VaultRedirect` 变体：它们的路径不产卡、也没有第二处 UI 面
（重定向回送的是结构化错误）——加了就是无消费者的声明。

`Verdict.reason` 是 `Option`：自动放行的层（allow 规则 / 缓存 / 只读白名单 / 重定向）为 `None`。
不变式：`decision == Ask ⟺ reason.is_some()`（产卡的两种 Ask 层都带依据），单测钉住。

## 3. deny 层为什么不上卡（口径修正，tower 2026-10-12 裁决「按 A」）

设计原文第三条写的是「命中规则：「命中 deny 规则 cli(npm run deploy*)」」，读起来是批准卡上的一行。
**但现行管线里规则命中不产批准卡**，判据是 `decide` 的五层短路（`permissions.rs:59-96` 的返回语句即契约）：

| 层 | 判据 | 结论 | 有卡吗 |
|---|---|---|---|
| 1 | deny 规则命中（`:66`） | `Deny` —— **立即返回** | 否（回送模型 `permission_denied`，面板工具行落 `denied` 细分状态） |
| 3 | 危险黑名单（`:82`） | `Ask` | 是 ✓ |
| 4 | allow 规则命中（`:87`） | `Allow` —— **立即返回** | 否（静默放行） |
| 5 | 缓存 / 模式默认分层（`:92-95`） | `Allow` / `Ask` | 是（Ask 侧）✓ |

`Decision::Deny` 的消费在 `src-tauri/src/harness/turn.rs:827-833`：`ToolOutput::err("permission_denied", …)`
回送模型，`gated_execute`（`:838`）只在 `Ask` 分支被调——**deny 进不了批准闸**。

所以第三条按**事实落点**修正：

- 口径：deny 规则命中的**规则原文**拼进既有错误文案，**规则原文领读**（
  「命中 deny 规则 cli(npm run deploy*)：权限规则拒绝了 cli_run（npm run deploy）」）——
  领读的理由（单行省略号会把句末的规则名吞掉）与具体实现见 §4.3。
  面板工具行的 `denied` 细分状态里直接可读。
- **零新增 UI**、拒绝语义一字不改（不产卡、不进批准闸）——Alex「这个逻辑不用改」优先于设计文的落点措辞。
- 依据数据仍与卡片行**同源**：都是 `decide()` 同一处产出（第 1 层走 `DenyRule { rule }`，第 3/5 层走另外三个变体）。
- 替代案（deny 也产批准卡，即「先问再拒」）**不可行**：它把「拒绝」改成「询问」，直接违反
  `openspec/specs/harness/spec.md`「权限机制」的 deny 语义（「该调用被拒绝并把原因回送模型，不进入批准闸」）。

## 4. 落点与文案

### 4.1 批准卡判定依据行

- 元素：`.lumir-hp-approval-basis`（卡内新增的一个 div，样式沿用次级灰配方 `--fs-meta` / `--text-3`，
  与 `.lumir-hp-approval-sub` / `-note` 同族）。
- 位置：问句行（`.lumir-hp-approval-title`）**之下**、purpose / diff / argv 之上——先回答「为什么问我」，
  再看要批准什么。
- 生命周期：与待决副句、决策按钮**同一生命周期**（都是卡 `el` 的后代）——`settleApprovalRecord` 整卡移除，
  依据行随之退场，零残留（m384 场景已有「决策后卡内元素全 `toHaveCount(0)`」的同族断言）。
- 语言切换：`relabelApproval` 内重取（与问句 / 副句 / 按钮同处，切语言后不残留旧串）。

文案（新 D 号，zh/en 双列）：

| 层级 | 文案 | 说明 |
|---|---|---|
| `DangerousWrapper` | 「shell 包装器命令（{command}）：内容不可知，任何权限档都需逐个确认」 | 对上设计原文第一条（示例里的 `zsh -lc …` 简化为包装器名——命令原文就在卡上，重复摘要无增益） |
| `DangerousCommand` | 「命中安全黑名单：任何权限档都需逐个确认」 | 设计原文第一条的兄弟情形（`rm` / 关机 / 磁盘类；名字见卡上命令原文） |
| `ModeDefault` | 「当前为 {mode} 档：{desc}」 | 对上设计原文第二条的语义方向。`{mode}` = 档全名（`D427`–`D429`）、`{desc}` = 档释义（`D430`–`D432`）——**复用浮层那一份释义**，不写第二份（裁决点 3 取 A） |
| 不产卡的层 | 不渲染该行 | `reason` 缺席（旧后端 / 旧快照）同样不渲染——MUST NOT 伪造 |

判定依据行**不带「判定依据：」前缀**：它紧跟在问句下方、与副句同族排版，位置即语义；前缀会把一行
人话撑成表格。若 Alex 过目后觉得需要前缀，按文案微调处理（不新开 D 号，改 `D458`–`D460` 模板）。

### 4.2 权限 chip 悬停提示补档释义

`applyPermChip` 的 `title` / `aria-label` 由 `D426`「权限模式：{mode}（点击切换）」**改形**为
「权限模式：{mode}（点击切换）· {desc}」（`{desc}` = `permissionDescription(permMode)`，即 `D430`–`D432`）。
编号沿用（同 `D334` / `D401` 的改形先例）：这不是新文案，是把浮层里已有的释义**顺带**放进悬停面
（mission 原文「与浮层释义同源，不新增信息」）。可见面（chip 上的短名）与浮层内容一字不动。

### 4.3 deny 规则原文

`turn.rs` 的 `Decision::Deny` 分支：

```rust
Decision::Deny => ToolOutput::err(
    "permission_denied",
    denied_message(&call.name, &subject, verdict.reason.as_ref()),
),
```

`denied_message` 的形态：**规则原文领读** ——

```text
命中 deny 规则 cli(npm run deploy*)：权限规则拒绝了 cli_run（npm run deploy）
```

两处实现期口径（与 tower 裁决文里给的示例措辞不同，理由如下，均记进评审记录）：

1. **规则原文放最前**（裁决文示例里它在句末）。工具行是**单行省略号**行
   （`.lumir-hp-tool-text` = `nowrap + overflow:hidden + text-overflow:ellipsis`，CSS 注释明写
   「截断只落这一格」）——拼在末尾时，窄面板下整段规则名被省略号吞掉，Alex 看到的世界与改造前
   一样（M459 实测：482px 宽的面板里末尾规则名完全不可见，候选图 `03-工具行-deny规则原文.png`）。
   领读位置保证规则原文落在可见头部，被省略的是其后的从属信息。
2. **保留 `权限规则拒绝了 …` 的既有句式**：该 message 同时回送模型（wire 口径），模型需要知道
   「调用被权限规则拒了」，原文一字不改地留在后半句。
3. **超长退回**：拼接结果 > [`SUMMARY_MESSAGE_LIMIT`]（80 字符，与 `summarize_result` 的截断预算
   同一常量）时退回不带规则原文的既有文案——MUST NOT 呈现半截规则名。

## 5. 真源与一致性（对账锚点）

| 语义 | 唯一产出点 | 消费点 |
|---|---|---|
| 判定结论 | `permissions::decide` → `Decision` | `turn.rs::handle_call`（Deny / Ask / Allow / Redirect 四个分支） |
| 判定层级 | `permissions::decide` → `DecisionReason` | 批准卡判定依据行（事件 + 快照）、deny 错误文案 |
| 危险命中的「包装器 or 其余」 | `permissions::dangerous_kind`（`is_dangerous` 改由它实现，单一真源） | `classify_cli`（分类）与 `decide`（层级）共用 |
| 档释义 | `D430`–`D432`（copy 表） | 权限浮层、chip 悬停提示、判定依据行（`{desc}`） |
| 档全名 | `D427`–`D429` | 浮层、chip 悬停提示 `{mode}`、判定依据行 `{mode}` |

## 6. 视觉保真

无原型（本 change 是既有卡上的一行文字 + 既有 chip 提示的一句追加）。

- **批准卡不在任何既有整页像素基线的画面里**：m384 批准卡族场景自陈「本场景不建像素基线」，
  批准闸的 diff 与卡片整段不在任何整页基线里（`tests/visual/scenes/m384-harness-approval-decided.spec.ts:19-21`）。
  故本 change **不触发任何基线 `--update`**。
- **判定依据行的样式口径**（`src/harness-panel.css`，M459 起该文件在改动面内）：信息副行——字号
  meta 档（`--fs-meta` × `--lumir-hp-scale`）、色取次级灰 `--text-3`（弱于用途句的 `--text-2` 与
  命令原文；「不抢命令的视觉重心」是同一族口径）、下边距 `--sp-2`。全部复用既有 token，不引入新值。
  语义身份靠类名 `.lumir-hp-approval-basis`（选择器与断言都用它）。
- 判定依据行的判据落在**结构断言**（在场性 / 文案 / 卡内子元素顺序 / 随决策退场），与卡上其余元素同口径。
- 新增文字的实际观感（字号 / 颜色 / 与问句的间距 / 换行）与 chip 悬停提示的字面**呈 Alex 过目**：
  候选截图复制到主仓 `test-results/alex-review-2026-10-12/`（git 外）并在完工报告附 `open` 命令。
  基线更新纪律：本 change 无基线可更新；若 Alex 过目后要求把该行纳入像素基线，另开一条
  （届时按「基线更新是人肉裁决点」走）。

## 7. 不做的权衡（备查）

- **不给 allow / 缓存 / 重定向加依据**：三种路径都没有「用户被拦下」的观感，加行只会制造信息噪声。
- **不在切档路径加解释**：Alex 的疑惑发生在卡弹出那一刻，切档提示解释的是另一个问题
  （「这一档意味着什么」已由浮层释义承担）。
- **不把判定依据做成可展开详情**：一行够用；展开区会引入「大半的人从不展开」的失效面。
