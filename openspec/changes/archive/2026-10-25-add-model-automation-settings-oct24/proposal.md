# Proposal: 模型接入与自动化的可见设置面板（完整 provider 管理）

- Change ID: `add-model-automation-settings-oct24`
- 日期: 2026-10-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**待 Alex 裁决**（2026-10-24 起草；r2 同日下午语义纠偏；r3 按 Alex
> 「全功能版本」反馈重做）。事实底稿是同日的配置面盘点
> `.local/reviews/settings-config-audit-oct24.md`（本地留存、git 外；50 个叶键逐键取证，
> 证据锚点为 `src-tauri/src/config.rs` 与 `docs/specs/config-reference.md`）。本提案只交付
> 提案、spec delta 与可点击原型，不改产品代码、不改 living spec。
>
> **r4（M730，2026-10-25）——按 Alex 对原型的六项反馈重做自动化节**：会话命名 / 图片命名的
> 目标**内联到各自开关行**，provider 与模型都可编辑（默认跟随当前 provider）；关闭功能时
> 控件禁用但选择与配置保留；图片命名的模型选项标出 vision 资格；选择旁只保留**一行**实际
> 生效说明；移除自动化节顶部那块独立的命名目标摘要框；并确认本批不做编辑器 / 权限设置页、
> 不预设多 TAB——模型接入与自动化仍是同一页的两个分节。provider 管理与写通道不变。
>
> **r3（M716，2026-10-24）——承认 r1/r2 的意图误解并修正**：Alex 原话「我希望的全功能版本，
> 不是残疾版。现在连增删 provider 都没有。你是不是误解了我的意图？」。r1/r2 把「provider
> 固定为 `kimi` / `deepseek` / `mock` 闭集合」当成不可动的产品边界，只做了「两项的编辑器」，
> 并把「新增 provider」推给一个不存在的 schema change——这是把实现现状当成产品边界。r3 把
> 固定三字段改成**以稳定 id 为键的可扩展映射**，设置页提供完整的 provider 增 / 删 / 改、
> 删除保护与替代目标、一次性迁移与默认回退。design §0.2 列了这次 schema 变化的完整消费者
> 清单（30 个文件 / 255 处引用；去掉 ts-rs 生成物 21 / 233；产品源码 13 / 211）。
>
> **r2（M704）**保留的四处语义纠偏：① 四个自动化开关是全局键，不是 provider 的子项；
> ② 会话命名不是每轮生成（首轮 / 5 轮周期 / 漂移提前 / 3 轮下限 / 失败重试 / 单飞行 /
> 异步落盘）；③ 模型清单只来自 `config.json`，原型与截图是合成数据；④ 命名目标只有一处
> 解析、每次只调用一个目标。r2 的第 ⑤ 条「provider 固定不可增删」在 r3 被**推翻**：
> provider 由用户增删改，这正是本版的核心。
>
> 节点 2（归档评审）：**机器 + 独立评审放行**（`docs/process/openspec-workflow.md` 节点 2 五要件；
> 归档前读数由 M743 整理，docs 批的 reviewer 落章于 tip `72a32313`（见第 2 条），归档由 M744 执行）。
>
> 1. **方案已批准**：Alex 节点 1 对完整 provider 提案「通过，请你安排开发。」（2026-10-25，经 tower
>    转达并记入 M732 的 mission context）。实现期无静默扩 scope：M732 / M733 / M734 只落 tasks
>    §2–§5；M743 只落 §6–§7（文档、回扫、门禁、真机证据），未改产品代码。
> 2. **独立 reviewer clean / merge**：实现批
>    `review-feat-land-settings-panel-frontend-oct25-reviewer-settings-panel-land-o-r1.md`
>    （`status: clean` / `merge: merge`，reviewed_commit `49ec1613414b99430cf2c58e194881422bf34497`，
>    M742；与 M734 r5 评审同一 commit，其 11 张像素基线由 tower 消息 `…-m734-alex-05-06.md` 记录
>    Alex「确认」）；docs 收尾批
>    `review-feat-finalize-provider-docs-checks-oct25-reviewer-provider-docs-final-r-r1.md`
>    （`status: clean` / `merge: merge`，reviewed_commit `72a3231368ecd712ec3b94030a76caf61bbd1eed`，
>    M743 r1 的 1.7 / 7.3 未勾选修复后复审；评审文件均在 `.tower/comms/reviews/`）。该 tip 之后本
>    change 目录逐字未改（`git diff 72a32313 9150da9 -- openspec/changes/add-model-automation-settings-oct24`
>    空）；M744 只追加本归档记录，不改 delta / tasks / 实现。
> 3. **tasks**：§1–§7 全部勾选（60/60；原「未完成 / 待裁决」四项的处置见文末「实现批记录」与
>    「收尾批记录」；像素基线 11 张已获 Alex「批准。」）。
> 4. **门禁与真机**：实现批 tip `49ec1613` 的 `scripts/gate.sh visual`（M742）=
>    `GATE RESULT: 15/15 PASS（SKIP 0）`，exit 0（`.local/reviews/m742-land/gate-visual-run.log`）；
>    docs 批 `51d75de3` 由 reviewer 独立复跑同档 = `GATE RESULT: 15/15 PASS（SKIP 0）`，exit 0
>    （`.local/reviews/m743-finalize/reviewer-gate-visual.log`）；M743 本机首跑为 14/14 PASS（SKIP 1）
>    ——SKIP 为 tsc-visual 的环境缺依赖，依赖装好后单跑 `tsc --noEmit` 退出码 0。真机全量 242 场景 =
>    **PASS 211 / FAIL 24 / INVALID 7**（证据 `.local/acceptance/2026-10-25-m743/`，复跑
>    `.local/acceptance/2026-10-25-m743-retry/`）。本 change 直接相关的场景
>    （90/99/101/102/128/138/250/251）全绿；24 条 FAIL 逐条归因为工具行路径按钮化的旧断言（4）、
>    CGEvent/键盘注入通道（6）、固定坐标拖选漂移（2）、AX role 漂移（1）、hover bbox（1）、
>    已知 backlog 项（5），另有 5 条复跑转绿（131/231/235/236/237，其中 235–237 是本 change 新增
>    命令导致的计数 71→72 期望漂移，已在本批改准）；INVALID 7 条 = bundle-only 3 + 环境 fixture
>    缺口 4。没有一条红落在 provider / 设置面代码路径上。
> 5. **规格对账**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS（9 份 delta / 9 条
>    MODIFIED / 对比 117 段，无静默丢段；归档队列 2 项已完成 change 均有唯一条目）；
>    `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` = `Totals: 33 passed, 0 failed`；
>    `bash scripts/docs-check.sh` = PASS。以上三项由 M744 在 master `9150da9`（含 M743 `72a32313`）
>    复跑，读数与 M743 记录一致。`docs/backlog.md` 归档跟踪队列有且仅有一条本 change 条目。
>    `specs/settings/spec.md` 已写最终 Purpose（1.12.0 归档时携带，临时副本实跑 archive 后 strict
>    仍 33 passed）。
>
> 归档后项见本块末尾的「归档后」追加段。

## Why

**唯一「不改 JSON 就完不成」的用户任务，仍然没有界面。** 配置面盘点（50 个叶键）结论：
零设置页；首次接入模型所需的 `api_key` 与 `models[]` 没有任何界面，现有出口是三句把用户
指向 `config.json` 的文案（D402 / D403 / D404）。用户第一次打开 Lumir 想发一句话，必须
先手写一段 JSON。

**而现在的「接入」连 provider 本身都管不了。** provider 是 Rust 闭集合 `kimi` / `deepseek` /
`mock`，`config.json` 的 `providers` 是三个固定字段（`config.rs:937`）。这带来四个用户任务
全都没有出口：

- **接第二个同厂商 provider**（工作 / 个人两把 Kimi Key、两个不同的网关）：不可能，id 只有
  一个 `kimi`。
- **接一个 OpenAI 兼容端点**（本地 Ollama / LM Studio、公司网关、第三方中转）：不可能。
- **删掉不用的 provider**：不可能，界面没有删除，配置删了也只是回落成空条目。
- **改一个 provider 的协议预设**：不存在「预设」这个概念，行为只能由硬编码的 id 决定。

这个固定枚举不是一行配置，而是 **30 个文件、255 处引用**（去掉 ts-rs 生成物仍有 21 个文件 /
233 处；产品源码 13 / 211）共同假设「世界上只有三家 provider」：配置类型、能力读取、命名解析、校验、LLM 装配、运行期写回、并发闸、mock 分支、
会话记录、IPC、前端选择器、生成类型、单测、集成测试、验收套件（design §0.2 逐面列出）。
「新增 provider 须另立 schema change」因此不是一条产品规则，而是把重构成本转嫁给用户。
**全功能版本的第一件事就是把这个假设拿掉。**

**手改的代价比「配置多」更硬。** 50 个键里有 **41 个**在类型写错时会触发**整份配置回落
默认**——`last_vault` 一起丢，下次启动要重新打开 vault（`config.rs` 的解析模型：表内类型
不符 → serde 解析期失败 → 整文件回落；config-reference §2 有同口径说明）。纯数值 / 布尔
输入框只要把 `"font_size": 15` 打成 `"15"` 就命中这条路径。

**四个默认开启的自动行为没有可见面。** `auto_compact`、`session_naming.enabled`、
`attachment_naming.enabled`、`subagents.enabled` 出厂全开，其中图片命名会把图片字节与
前后各 500 字送出本机（`attachment_naming.rs` 模块头）。四个开关都会产生模型调用费用；
`subagents.enabled` 是**子代理调用**的唯一总开关，不是「唯一花钱的开关」。四个开关都只能
手改配置文件——「默认开 + 会出域 / 花钱 + 无可见面」是本轮唯一同时成立的组合。

**现有写通道有三个硬缺口，设置页必须先补齐：**

1. **写通道不校验取值**（`commands.rs:600` 段）：`config_set_value` 把任意 JSON 值直接
   合并进文件，「非法值由下次启动的 `validate()` 兜」——设置页如果把一个字符串写进数值
   字段，下次启动就是整份配置回落。
2. **没有删键能力**（`commands.rs:637-703` 只做 merge）：所以「恢复默认」当前只能是「把
   默认值写死」而不是「删掉这个键、跟随默认」；config-reference §3 明确反对把默认值写进文件。
3. **`config_get` 只返回生效值**（`commands.rs:112` → `validate()`）：分不清「键缺席」与
   「显式写成默认值」；数组里的未知子键不可见；被丢弃的坏项也看不见。

**配置 warning 至今没有 UI 出口。** `main.ts` 只写 console + 诊断日志；
`ConfigSnapshot.warnings` 没有界面消费者。设置页是它天然的第一个出口，但前提是 warning
带得上「属于哪个键」的结构——现在只有人话字符串。

**同批要收口的三个规格 / 实现漂移**（盘点 §7，均可复核）：

- `models[]` 的元素 schema 没有 living spec（config-reference §1.5 把它委托给 harness
  spec，而那条没列 models）。
- 模型声明指引四处漏 `vision`（`config.rs:3141`、`harness/llm.rs:618`、D402、D404）；
  `vision` 是图片发送与图片命名的唯一依据。
- 模型 chip 的 provider 选项恒为 kimi + deepseek，而 living spec 写的是「已配置的
  provider」（`harness/spec.md:699` vs `harness-panel.ts:1573-1574`）：`HarnessProviders`
  三个字段恒序列化，前端 `id in configured` 永远为真。provider 动态化之后，「已配置」第一次
  成为用户能改变的事实，这条口径必须先定准。

## What Changes

| 切片 | 用户可见行为 | spec 增量 |
|---|---|---|
| A 设置面板 | `⌘,`（或应用菜单「设置…」）打开一个模态面板，只有「模型接入」与「自动化」两节；其余配置不出现在这里 | 新增 capability `settings`：面板形态与范围 |
| B provider 生命周期 | provider 列表可添加 / 编辑 / 删除；id 创建后不可改；预设决定协议行为；重复 id 被拒；可以删到空清单 | `settings`：provider 的增删改与稳定 id |
| C 删除保护 | 删除当前使用的 provider 必须选替代目标；被会话 / 图片命名引用时必须重定向（或改为跟随当前）；被删项的未保存草稿要确认；不允许留下悬空引用 | `settings`：删除保护与替代目标 |
| D provider 编辑面 | 每个 provider：API Key（掩码、可替换 / 清除）、模型清单（id / effort / vision / window 逐行）、高级区（预设只读、Base URL、Wire 方言）；Base URL 旁常驻「密钥会发往该地址」；预设创建后不可改 | `settings`：模型接入的编辑面；`harness`：provider 条目与预设、模型清单 |
| E 安全写通道 | 保存 = 一次强类型 patch：后端校验、revision 冲突检测、原子写、按需删键；增删改与引用重定向在同一笔里完成 | `settings`：设置写通道 |
| F 自动化与命名目标 | 四个**全局**开关逐项可见；会话命名 / 图片命名两行各自内联**可编辑**的目标（provider + 模型，默认跟随当前 provider），关闭时禁用但保留；图片命名标 vision 资格；每行一行实际生效说明，无独立摘要框 | `settings`：自动化开关与命名目标（可编辑）；`harness`：配置节的命名目标（语义不变） |
| G chip 与缺失态 | chip 列出已配置 provider ∪ 当前 provider；没有 provider 时 chip 显示空态并可去设置；切换 provider 经配置写通道持久化 | `harness`：模型选择（MODIFIED） |
| H 入口 | 命令 `app.settings-open`，默认 `⌘,`；应用菜单「设置…」是同一命令的鼠标路径（不带 accelerator） | `keymap-commands`：设置面板入口 |
| I 一次性迁移 | 旧配置启动时补齐三个内置条目的 `preset`，运行行为不变（除新增的 `preset` 外文件逐字节不变）；只写一次、幂等、无第二套读取路径 | `harness`：provider 配置迁移 |

### A · 面板形态与范围

- **模态面板**，形态与既有键位查看面板（`⌘/`）同族：全屏遮罩 + 居中卡片，打开即完整可见、
  不越出视口（`docs/specs/overlay-visibility.md` O1/O2），关闭后焦点交还来源。
- **只放两类内容**：模型接入（B/C/D）与自动化（F）。主题、语言、字号、栏宽、权限模式、
  忽略规则、cron、键位等一律**不搬进来**——它们各有更近的使用位置，搬进来只会让同一读数
  出现两处（盘点 §6）。
- **单页两节，无 TAB / 侧边导航**：两节自上而下排布；不做编辑器 / 权限设置页，也不为将来
  预留点不开的空壳页。要加第三类设置时另立提案，不在本页留入口。
- 面板头部固定显示配置文件路径；API Key 字段旁常驻一句「`api_key` 以明文存储在该文件中」。
- 关闭语义与既有浮层一致：`Escape` / 点遮罩 / 再按 `⌘,` 三条路径；有未保存修改时先转
  「放弃修改？」两步确认。

### B · provider 生命周期（本 change 的核心）

- **列表即管理面**：模型接入节左侧是 provider 列表（id + 预设标签 + 可用状态 + 「当前」徽标），
  右侧是选中项的编辑表单。列表底部「+ 添加 provider」。
- **添加**：行内表单，输入 `id` + 选预设（Kimi / DeepSeek / OpenAI 兼容）。三个预设各有
  一行说明（官方地址、缺省 wire、是否要求 Key）。添加成功后选中该项；若是第一个 provider，
  同一笔保存自动设为当前使用。
- **id 规则**：`^[a-z0-9][a-z0-9_-]{0,31}$`，不含点（点分写回路径按 `.` 分段）、创建后
  不可改名。重复 id（目标已存在）、非法字符、保留 id `mock` 一律拒绝，错误回填到 id 输入框。
  后端在锁内重新核对，不能只信前端草稿。
- **编辑**：每个 provider 独立保存自己的 Key / 模型清单 / Base URL / Wire 方言；互不覆盖。
- **删除**：表单底部危险区；删除是草稿动作，点「保存」才落盘（见 C）。
- **空清单**：允许删到一个不剩。空态显示「还没有 provider」+「添加第一个 provider」；
  composer 的模型 chip 进入空态，发送给 `harness_provider_missing`（指向设置）。
- **预设创建后不可改**：预设决定官方 Base URL、是否发送 `store:false`、超限特征串与 wire
  缺省；允许编辑时切换会在用户不知情的情况下改变协议行为。要换协议就新增一个 provider、
  再删旧的。
- **`mock` 不进列表**：验收专用的 fixture 档，保留 id；设置页不呈现、不可新增 / 删除，
  配置仍可手写。

### C · 删除保护与替代目标

删除不是「先删掉、再让用户去别处修」。引用面分三档，全部在同一笔保存里解决：

| 引用 | 处理 |
|---|---|
| 当前使用的 provider | 删除确认里必须选一个替代 provider；删最后一个时允许，active 变「无」并明确告知发送会被挡下 |
| 会话命名 / 图片命名显式指向它 | 每个引用必须选「跟随当前 provider」或另一个 provider；目标变化时清除对应的 `model` 覆盖（它属于旧 provider 的清单） |
| 被删项的未保存草稿 | 确认框多一行「该 provider 有未保存的修改，删除会一并丢弃」 |
| cron 任务 / 子代理定义的 `model` 覆盖（软引用） | 只提示「下次运行时按当前 provider 重新校验」，不阻断（运行期已有回落 + warning） |

- 缺替代目标 / 目标不存在 / 目标等于被删项 → 整笔保存被拒，文件逐字节不变，错误指出具体键路径。
- 删除后 MUST NOT 留下悬空引用；手改文件造成的悬空仍在装载期回落到当前 provider + warning，
  但那是兜底，不是设置面允许产生的状态。

### D · provider 编辑面

- **基础区**：API Key + 模型清单。
  - API Key 是掩码输入：**已配置的 Key 永不回显**；只显示「已配置 · …末 4 位」或「未配置」，
    提供「替换」「清除」。字段旁常驻明文存储说明（Alex 已裁：掩码输入、明确明文存储）。
  - 模型清单逐行编辑四个字段：`id`（文本）、`effort`（开关）、`vision`（开关）、
    `window`（整数，tokens）。行可增删；保存前不允许空 id、重复 id、越界窗口。
  - 模型清单只来自该 provider 的 `config.json` 条目；系统不内置模型表，也不提供模型目录。
- **高级区**（默认折叠）：
  - **预设**：只读标签（创建时选定），旁边一句「换协议请新增 provider」。
  - **Base URL**：为空 = 用预设官方地址（generic 预设在有 Key 或模型时必填）；自定义值旁
    **常驻**一句「带密钥的请求会发往该地址」——这是「密钥目的地」警示，不是普通表单提示。
  - **Wire 方言**：`responses` / `chat_completions`；不支持的档位置灰并说明（deepseek 的
    chat 档在 v1 未实现）。
  - `generic` 预设：Base URL 在条目已有 Key 或模型时必填；缺省 wire 是 `chat_completions`
    （OpenAI 兼容端点的主流形态）；**允许空 API Key**（本地模型不发 Authorization 头，见 Q9）。
- 每个字段（含两个高级项）在「键显式存在」时提供「恢复默认」——语义是**删键**，不是写死
  默认值。页级「还原此页默认」把所有设置面键标为删除（provider 条目本身保留，清空的是各条目
  的设置值），但仍需「保存」才落盘。

### E · 安全写通道

设置页不复用「前端取整份配置 → 改 → 整份写回」。它是一组窄接口：读一份只含设置面的快照，
写一次只含改动字段的 patch，校验与落盘全在 Rust。

1. **类型安全在 IPC 边界**：patch 是强类型结构（ts-rs 导出），未知字段拒绝。
2. **校验单一来源**：合法性与 warning 都出自 Rust 的同一套判据；前端只渲染，不复制窗口
   区间、枚举表、id 规则或互斥关系。
3. **写前可证「不会引入回落」**：patch 合并到当前 raw JSON 后按装载同一路径重新解析校验；
   任何与改动路径相交的阻断级诊断出现即整笔拒绝（`0 → 10000001` 这种「非法换另一种非法」
   同样拒绝）。文件本身解析不了时只读、保存禁用。
4. **增删改原子**：添加 / 编辑 / 删除 / active 切换 / 命名目标重定向在同一把配置写锁、
   同一个 revision 下完成；删除缺替代目标时整笔拒绝，不留半状态。
5. **多写者与冲突**：读—校验—写在 `CONFIG_WRITE_LOCK` 内；revision 覆盖设置面能写的键，
   锁内比对不一致即冲突，用户选「重新载入」或「仍然保存」（后者把同一 patch 重新应用到
   当前文件，不用旧快照覆盖）。
6. **未知字段保留**：provider 条目只改提交的字段；模型清单按 `id` 保留未知子键；其它节不在
   patch 路径上。

### F · 自动化与命名目标

四个开关是 `harness.*` 下的**全局**键，不是 provider 的子项：只有一份，切换 / 新增 / 删除
provider 不会复制、重排或改变归属。逐项呈现名称、行为、生效时机、敏感性（费用 / 出域），
以及「当前是默认值还是显式设置」。默认值全部为开。

| 开关 | 配置键 | 生效时机 | 敏感性 |
|---|---|---|---|
| 自动压缩 | `harness.auto_compact` | 下一回合 | 费用（多一次压缩调用） |
| 会话命名 | `harness.session_naming.enabled` | 下一次评估触发点（在途结果落盘前复核开关，关掉即丢弃） | 出域 + 费用（一次便宜档调用） |
| 图片命名 | `harness.attachment_naming.enabled` | 关→开需重启；开→关立即 | 出域（图片字节 + 前后各 500 字）+ 费用（一次视觉调用） |
| 子代理 | `harness.subagents.enabled` | 下一回合 | 费用（子代理调用独立计费） |

**两个命名调用的目标内联在各自开关行里，可编辑。** 会话命名与图片命名各有一组
`provider` / `model` 覆盖键；面板把它们做成开关旁的两个选择器：

```
会话命名                                          [默认] [开关]
  发往  [跟随当前 provider（默认） ▾]  [生效模型（默认：k3-256k） ▾]
  实际：kimi-work / k3-256k · 跟随当前 provider · 下一次评估触发点生效

图片命名                                                 [开关]
  发往  [跟随当前 provider（默认） ▾]  [k3-256k ✓ vision ▾]
  实际：kimi-work / k3-256k ✓ vision · 跟随当前 provider · 下一次粘贴生效
```

- **默认跟随当前 provider**：provider 选择器的空值 = **删键**（`harness.<kind>.provider`
  缺省），不是把「当前项」快照进去。当前 provider 变了，跟随的目标跟着变。
- **模型选择器只列目标 provider 的 `models`**：空值 = 该 provider 的生效模型（删
  `harness.<kind>.model`）。换 provider 时旧的模型覆盖被清除（它属于旧 provider 的清单），
  同一笔保存里显式选的模型按**新目标**的清单校验。UI 只提供清单里的模型，保存后不会出现
  新的悬空引用。
- **文件里已有、但不在目标清单的覆盖模型**（手改或历史值）：会话命名**回落**该 provider 的
  生效模型并在行内写明这次回落；图片命名原样保留、vision 资格不通过即跳过、保留暂存名。
  两类后果 MUST NOT 混写，MUST NOT 把会话命名显示成「无模型 / 会跳过」。
- **图片命名的模型选项标 vision 资格**：每项后缀 `✓ vision` 或 `未声明 vision`。选到未声明
  vision 的模型时，行内说明直接写后果——跳过命名、保留暂存名、不换模型；不把它做成保存期
  阻断（手工写进配置的同类值本来就按运行期资格闸处理）。
- **关闭功能时禁用、但不清理**：两个选择器置灰，**选择与草稿保留**，`config.json` 里的键也
  不动；重新开启后按原选择执行。MUST NOT 在关闭时把选择清成「跟随」或写空值。
- **选择旁只有一行实际生效说明**（`实际：<provider> / <model> · 跟随当前 / 指定目标 · 生效
  时机`）。MUST NOT 再单独渲染一块命名目标摘要框——同一读数出现两处必然漂移；这一行已经
  回答了「图片优化到底用哪个模型」。
- **每次触发只解析出一个 provider + 一个模型、只发一次调用**：MUST NOT 对每个 provider 各做
  一次，也不把同一结果按 provider 复制。每组目标只有一份全局键，不按 provider 各存一份。
- **provider 变化只刷新选项与那一行说明**：MUST NOT 复制这两个目标选择器，也不生成
  「Kimi 的会话命名 / DeepSeek 的会话命名」这类复本。
- **会话命名的触发节奏必须在行内写清**：首轮正常完成后生成初始标题；此后每 5 轮重估一次；
  话题漂移可提前，但任两次评估至少间隔 3 轮；初始生成失败后在满足 3 轮间隔的下一个正常完成
  轮重试（已有标题时失败不立即重试，按自然节奏再来）；同一逻辑会话同时最多一个调用在途
  （触发点跳过、不排队）；结果在后台异步计算、会话空闲时落盘。MUST NOT 写成「每轮生成」，
  也 MUST NOT 承诺「下一轮必定生效」。
- **图片命名的触发与后果**：每次粘贴新图异步触发一次（串行队列，同一文件至多一个任务），
  粘贴路径不等待模型；开关「关闭立即生效；重新开启需重启应用」的方向不对称在行内写出，
  MUST NOT 只给一个笼统的「需重启」。
- 删除被命名引用项的替代目标仍按 C 在同一笔保存里解决；保存后两行立即显示新目标。

**单页、两个分节，不引入 TAB。** 本批确认不做编辑器 / 权限设置页：面板就是「模型接入」+
「自动化」两节自上而下排布，没有侧边导航、没有 TAB 栏，也没有点不开的空壳页。将来要放
编辑器 / 权限设置时另立提案，不在本页预留入口。

### G · chip 与配置缺失

- `HarnessProviderConfig` 增加后端派生的 `configured` 读数：`mock` = fixture 非空；
  `generic` = 模型清单非空且 Base URL 非空；`kimi` / `deepseek` = Key 非空且模型清单非空。
  模型 chip 的选项 = 已配置 provider ∪ 当前 provider（过滤 mock）。前端 MUST NOT 用「键是否
  存在」推断已配置——那正是今天恒真的原因。
- **空态**：没有任何 provider 时，chip 显示「未配置模型」；点开是「还没有可用的 provider」+
  「去设置」；发送返回 `harness_provider_missing`，文案指向设置面板。
- 切换当前 provider：chip 与设置面板的「设为当前使用」都可以（删除当前 provider 时必须选
  替代，两者是同一语义）。都经配置写通道持久化，下一回合生效，不打断进行中的轮次。
- D402 / D403 / D404 三句从「去 `config.json` 手写」改为「去设置面板」，字段清单补 `vision`。

### H · 入口

- 命令 `app.settings-open`，作用域 `global`，默认 `⌘,`（macOS 惯例；表内与原生菜单均无占用）。
- 应用菜单加「设置…」一项，点击经既有 `MENU_COMMAND_EVENT` 到同一个命令；**不带 accelerator**
  ——否则 `[keys]` 重绑之后菜单仍会触发原键，制造第二套键位。
- 不加常驻 modeline 钮：面板是低频目的地，发现路径 = 菜单 + `⌘/` 键位面板。

### I · 一次性迁移

- 现有 `providers` 已经是「对象 + `kimi` / `deepseek` / `mock` 三个键」的形状：**不搬字段、
  不改 id、不改值**，只给三个内置条目补 `preset`（`kimi` / `deepseek` / `mock`）。
- 加载期一次改写、幂等；第二次加载不再写。已有的 `preset` 是用户显式值，不覆盖。
- 写失败不阻断：内存里的值已补齐（本次行为正确），只多一条 warning，下次加载再试。
- **无双写**：迁移在同一份 JSON 上原地补齐后原子写回；不存在「旧结构和新结构并存」或
  「旧键继续读」的第二条路径。改完之后 `HarnessProvider` 枚举整体删除。
- 历史会话 JSONL 里的 `provider` 字段本来就是字符串，`kimi` / `deepseek` / `mock` 仍合法，
  不改写历史文件。

## Non-goals

- **不把其余配置搬进设置页**：主题 / 语言 / 字号 / 折行 / 栏宽、权限模式与规则、vault 忽略
  规则、键位表、cron 任务、日志等级、`editor.*` 一律维持现有落点。设置页不是「配置总览」，
  也不做成通用 schema 表单（`describe-config` 面板仍是 backlog 里另立项的中期能力）。
- **不做系统钥匙串 / 加密存储**：`api_key` 继续明文存 `config.json`（Alex 已裁）。
- **不做 `cron.tasks` 编辑器**：对话式注册已是它的入口。
- **不做 per-vault 设置**：本页全部是全局配置。
- **不做编辑器 / 权限设置页，也不预设多 TAB**：本页是单页两节；主题 / 字体 / 权限 / 忽略
  规则等仍各有落点（见上一条），不为将来预留空壳导航。
- **不做模型目录 / 模型发现**：不请求厂商的 models 列表、不做「推荐模型」；模型 id 由用户
  声明，来源只有 `config.json`。
- **不做 provider 重命名 / 预设热切换**：id 与预设创建后不可改（要换就新增 + 删除）。
- **不把命名目标做成按 provider 的多份配置**：每组命名目标仍只有**一份**全局覆盖键
  （`harness.session_naming.*` / `harness.attachment_naming.*`），面板编辑的是这一份键，
  不是给每个 provider 各存一组「命名用模型」；不做「哪些 provider 允许命名」的白名单。
- **不热重载启动期配置**：本页只覆盖「每回合 / 每次触发 / 每次粘贴现读」的键，唯一的重启
  提示是图片命名关→开；不为设置页引入文件监听。
- **不重构 `config_get` 的暴露面**：它仍返回完整生效配置（含 `api_key`）。设置面改用独立
  快照（只回末 4 位），收窄既有命令属另一个 change。
- **不做配置回滚 / 备份 / 历史**：冲突处理只到「重载 / 以本页为准」。
- **不引入 OAuth / 浏览器登录式 provider 接入**：v1 的接入模型仍是 Base URL + Key + wire 方言。

## 影响面

- **specs**：新增 `settings`；修改 `harness`（配置节、模型选择、模型图片能力声明；新增
  provider 条目与预设、provider 配置迁移、模型清单声明）；修改 `keymap-commands`（新增
  「设置面板入口」requirement）。
- **代码 / 系统**（实现计划见 tasks；本 mission 不实现）：
  - 配置与校验：`src-tauri/src/config.rs`（映射 schema、preset、迁移、结构化诊断、严格读、
    revision、删键）。
  - 运行时：`src-tauri/src/harness/llm.rs`（预设查表、动态 id 装配、generic 空 Key）、
    `harness.rs`（`with_model_override` 写 active 条目）、`harness/scheduler.rs`（闸键
    `String`）、`harness/subagents.rs` / `harness/agents.rs`（mock 判定）、
    `attachment_naming.rs`（目标解析）。
  - 设置写通道：`src-tauri/src/settings.rs`（新模块：快照、patch、删除计划、非回归判据）、
    `src-tauri/src/commands.rs`（设置命令；既有写入口改为锁内读）。
  - 前端：`src/settings-panel.ts`（新）、`src/harness-panel.ts`（动态 provider 选项 / chip
    空态）、`src/copy-data.ts`（D402–D404 与新错误文案）、`src/main.ts`（命令装配 / 菜单）、
    `src/style.css`（面板样式）。
  - 生成类型：`src/bindings/**` 重导出。
- **测试 / 验收**：`config.rs` 单测、6 个集成测试的 provider 构造、前端单测、视觉场景、
  真机验收场景（新增 + 回扫既有 chip / D402–D404 / 模型清单期望）。
- **关联约束**：
  - ADR 0002 §5「配置即数据，带 schema 校验」：设置页不得成为绕过 schema 的第二写通道。
  - ADR 0002 §6 性能合同：设置面板是低频打开，不进 keypress-to-paint 路径。
  - ADR 0004：提案让 Alex 不看代码即可裁决。
  - 动过 UI：合并前须本地跑 `scripts/gate.sh visual`；新面板适用 overlay-visibility O1–O5。
  - 仓库信息卫生：原型、fixture、截图全部使用合成数据（合成 Key 只保留末 4 位提示）。

## 已裁前提

| 编号 | 裁决 | 本提案落点 |
|---|---|---|
| D1 | `api_key` 用掩码输入，并**明确**它是明文存储 | D 的 API Key 字段 + 常驻说明 |
| D2 | 自动压缩 / 会话命名 / 图片命名 / subagents 四个开关提供可见设置 | F |
| D3 | `base_url` / `wire_api` 不排斥在 provider 外，与 `api_key` / `models[]` 同页，分基础区 + 高级区 | D 的高级区 |
| D4 | 设置页只含模型接入与自动化；其余配置不搬入 | A / Non-goals |
| D5 | **provider 必须可增删改（全功能，不是固定两项的编辑器）** | B / C / D / I |
| D6 | 命名目标内联到各自开关、可编辑、默认跟随当前会话；关闭禁用但保留选择与配置；图片标 vision；选择旁一行生效说明；移除独立大摘要框；单页不做编辑器 / 权限 TAB | F / A |

## 裁决点（本提案新增）

每项给倾向；Alex 只否掉不同意的项即可。编号 Q 与 design.md §14 一一对应。

- **Q1 面板形态与入口**：模态面板（`⌘,` + 应用菜单「设置…」，不加 modeline 钮）还是独立全窗页？
  **倾向模态**：与 `⌘/` 键位面板同一族，打开即可对照底层界面；全窗页要新增导航与「返回」语义，
  对一个只有两节的页面过重。
- **Q2 保存模型**：显式「保存 / 取消」（草稿态）还是逐字段即时写？
  **倾向显式保存**：模型清单是多行结构，增删 provider 也涉及多个字段与引用重定向；逐字段
  即时写会写入半条，而且「保存状态」本身需要被看见。
- **Q3 `api_key` 的已配置提示**：只显示「已配置」，还是显示末 4 位（`…3f9a`）？
  **倾向末 4 位**：文件本来明文可读，末 4 位不增加实质暴露，但能区分多把 Key、确认替换是否
  成功。无论哪种，完整 Key 都不回显。
- **Q4 半配置（有 Key、无模型）是否阻断保存**：**倾向阻断**——「接入」的完成态是可用；
  阻断时给两条出路（加一个模型 / 清除 Key）。备选：仅警告放行（允许先存 Key、稍后补模型）。
- **Q5 外部修改冲突**：阻断保存并给「重新载入（丢弃草稿）」与「仍然保存（把同一 patch 重放到
  当前文件）」，还是静默覆盖？**倾向阻断 + 两个显式动作**。
- **Q6 模型清单里的未知子键**：按 `id` 匹配保留，还是整表替换、未知键丢弃？**倾向保留**：
  整表替换是「旧 UI 降级写回」最典型的静默丢数据场景。
- **Q7 设置面板能否切换当前 provider**：列表提供「设为当前使用」，还是只允许 chip 切换？
  **倾向允许**：删除当前 provider 时必须选替代目标，若面板不能切换就自相矛盾；代价是 chip
  不再是唯一入口，harness 的「模型选择」条同步改成「chip 是日常切换入口，设置面板也可设置」。
- **Q8 删除 active / 被命名引用项的时机**：在同一笔保存里选替代目标，还是先阻断、让用户切好
  再来删？**倾向同一笔**：先阻断会产生「删一半 → 报错 → 不知道去哪修」的半状态。
- **Q9 generic 预设是否允许空 `api_key`**：**倾向允许**（空 = 不发 Authorization 头）——本地
  Ollama / LM Studio 通常不要 Key；不允许则用户必须填一个假 Key，第一次请求可能被网关拒绝。
- **Q10 provider id 是否允许改名**：**倾向不允许**（创建后不可改）。改名要同时搬配置路径、
  会话记录、命名目标三处引用；换 id = 新增 + 删除，代价低得多。
- **Q11 preset 是否允许在编辑时切换**：**倾向不允许**。preset 决定官方地址、`store:false`、
  超限识别与 wire 缺省；允许切换会在用户不知情下改变协议行为。
