# Tasks: add-wiki-ingest-lint-workflows

> **实现范围（预估）**：`src-tauri/src/wiki/{definitions,checks,guard,run}.rs`（新）、vault 配置装载
> （`src-tauri/src/config.rs` 同族新模块）、`src-tauri/src/harness/**`（会话 sidecar、契约段、工具
> 白名单、写入闸接线）、`src-tauri/src/commands.rs`、`src-tauri/src/logging.rs`、`src/ipc.ts`、
> `src/main.ts`、`src/harness-panel.ts`、`src/tree-menu.ts`、`src/keys.ts`、`src/copy.ts`、
> `docs/specs/wiki-workflows.md`（新）、`scripts/acceptance/scenarios/**`。
>
> **前置**：节点 1（提案评审）通过前不动手；本 change 当前只到提案制品。实现期发现意图需要变更时停下：
> 更新 proposal 并重走节点 1，不静默扩 scope。
>
> **裁决口径**：形态是「工作流定义 + 前台会话」，不是子代理；确定性检查是机制阶段，不是新工具；
> 本 change 不新增工具（工具清单与 ADR 0007 的现行清单一致，起草时为 8 件）；定时调度归 cron。逐条
> 取舍见 proposal 末尾 15 条（其中第 5、13、15 条需 Alex 明确裁决：配置格式 JSON / 是否要原型 /
> 图片是否在 v1 投递）。

## 0. 前置与跨 change 对齐

- [ ] 0.1 确认 ADR 0007 无需修订：本 change 不新增工具、不新增触发源、不新增运行时；把结论写进实现
  PR 描述（引 Decision 7「读操作不建 vault 工具」与 Revisit 条件）。若 Alex 判定「工作流定义」属能力
  扩张，先修订 ADR 0007 再开工，本 change 停在提案。
- [ ] 0.2 与 `add-cron-runtime-daemon` 对齐：在其节点 1 修订时纳入任务的 `workflow` + `inputs` 字段
  （与 `prompt` 二选一）与交接形状（design §8.2）；本 change 不修改其 delta。若 cron 先落地，在 cron
  的 tasks 里补一条「交接工作流运行」，本 change 的装配任务不删。
- [ ] 0.3 与 `add-harness-subagents` 对齐：若 `RunSpec` / `ToolPolicy` / `SessionTarget` 先落地，
  工作流运行以这些字段表达（origin = User / Cron，session_target = Interactive / Unattended，
  tool_policy = 定义白名单），MUST NOT 双写两套装配；若未落地，按既有会话发送通道参数化实现，
  语义一致、字段名可后调。把选择与理由记进实现 PR。
- [ ] 0.4 `.lumir/` 目录约定与 subagents 的定义目录共存：`agents/` 与 `workflows/` 互不扫描、
  互不覆盖；在 `docs/specs/wiki-workflows.md` 写明目录分工。
- [ ] 0.5 确认本 change 不改任何 living spec；`openspec/specs/**` 在提案与实现期都不动（归档时由
  `openspec archive` 并入）。

## 1. Vault 配置与启用

- [ ] 1.1 vault 配置装载（新模块，纯 Rust、无 tauri 依赖）：读 `<vault>/.lumir/config.json` 的
  `[wiki]` 六键；逐键校验（相对路径、无 `..`、解析后不逃逸 vault 根、符号链接检查）、未知键忽略、
  非法值回落缺省 + 人话 warning；文件缺失 = 未启用（不告警）；解析失败 / 占位文件 = 未启用 + warning。
- [ ] 1.2 启用动作：合并写 `enabled=true`，保留其它键；写盘走既有原子替换写核心；失败给 toast、
  不半写（单测：写失败时文件逐字节不变）。
- [ ] 1.3 源目录声明：启用确认框列出 vault 顶层目录，预选除 `dir` / `inbox` / `.lumir` 之外的全部，
  勾选结果写入 `sources`；目录名只来自运行时读取（单测：机制代码里没有目录名常量）；留空时 ingest
  以「未声明源目录」拒绝、lint 不受影响。
- [ ] 1.4 骨架初始化：缺失的 `dir` / `index` / `log` 在用户确认后创建为空骨架；**不写任何模板或
  schema 文案**；已存在文件逐字节不变（单测 + 真机场景）。
- [ ] 1.5 装载时机接线：vault 打开成功、切换 vault、设置变更时重读；不装文件监听；冷启动路径零新增
  （用既有冷启动测量确认）。
- [ ] 1.6 单测：六键各自的合法 / 非法边界；`sources` 为空数组、含 `dir` / `inbox` / `.lumir` 重叠项
  （剔除 + warning）；整节错形状；未知键；占位文件；两个 vault 各自配置互不影响。

## 2. 工作流定义

- [ ] 2.1 `wiki/definitions.rs`：扫描 `<vault>/.lumir/workflows/**/*.md`，递归、身份只看 `name`，
  每层同名取字典序第一个 + warning；YAML frontmatter 解析（复用 subagents 选定的窄解析路径；若该
  change 未落地，按同一「标量 + 列表」子集选型并记录理由）。
- [ ] 2.2 字段校验与逐条丢弃：§design 4.3 表逐行一条单测；`tools` 含 `cli_run` / `task` / 未知工具
  ⇒ 丢弃；`write_scope` 与 `sources` 相交 / 含 vault 根 / `AGENTS.md` / `.lumir/` ⇒ 丢弃；`gate`
  推导与回落；`unattended + gate: writes` 的 warning；`model` 回落；未识别字段 warning。
- [ ] 2.3 内置定义 `wiki-ingest` / `wiki-lint`：以数据形式接入同一装载、校验、列表路径（不是特殊
  分支）；写范围的 `dir` / `inbox` / `log` 由 vault 配置代入；不允许 YAML 里出现具体字段名。
- [ ] 2.4 覆盖规则：vault 级同名覆盖内置 + warning + 列表只出现一次 + 来源标注；单测两种来源组合。
- [ ] 2.5 列表与只读查看接口：定义名、description、inputs、来源（builtin / vault）、是否覆盖内置；
  查看返回 frontmatter 与正文。定义正文 MUST NOT 进列表清单与主会话上下文。
- [ ] 2.6 信息卫生断言：`rg` 检查 `src-tauri/src/wiki/**` 与内置定义里不含具体页面类型名、字段名、
  日志前缀或路径样例（测试断言 + 报告记录命令与零命中）。

## 3. 确定性检查器

- [ ] 3.1 `wiki/checks.rs`：四个检查器的纯计算实现，复用 `link_graph.rs` 的 `parse_links` 与
  `LinkGraph` 解析（MUST NOT 另写链接语义）；不读 `dir` 之外的页面正文。
- [ ] 3.2 `link_graph`：断链（unresolved）、孤儿（入链为 0，index 链接可排除）；参数三开关。
- [ ] 3.3 `index_membership`：双向差集（未登记 / 登记无页），index 按普通 Markdown 解析。
- [ ] 3.4 `frontmatter_fields`：字段在场与类型（string / date / list），日期 `YYYY-MM-DD`。
- [ ] 3.5 `date_expiry`：声明字段与 `grace_days`，按本地日期判定。
- [ ] 3.6 有界输出与稳定排序：列表上限（常量）、`total` / `listed` / `truncated`；同状态两次运行
  输出逐字节相等（单测）。
- [ ] 3.7 前置 / 后置与集合差：`(检查器, 路径, 目标)` 三元组差；新增非空 ⇒ `verification_failed`；
  后置 IO 失败 ⇒ `verify_error`（单测覆盖「总数下降但新增一条」的判红）。
- [ ] 3.8 扫描上限：文件数 / 总字节上限，超限中止前置并给 warning（常量与实测值写进
  `docs/specs/wiki-workflows.md`）。

## 4. 运行装配与门禁

- [ ] 4.1 发起前校验链（design §6.1）：逐项失败码与「零模型请求」断言（mock 脚本零消费）。
- [ ] 4.2 `workflow_open` / `workflow_close` sidecar：字段见 design §6.4；恢复路径按快照重建契约段；
  快照缺失按普通会话恢复并提示，不套当前定义（单测：改定义后恢复仍用快照）。
- [ ] 4.3 上下文装配：system = 固定身份段 + 工作流契约段（design §6.2 五条）+ 三层 AGENTS + Skill
  索引；用户消息 = 输入 + 前置结果块；不注入编辑器选区；单测断言 system 与 messages 形状。
- [ ] 4.4 工具白名单：请求按定义 `tools` 生成；执行层二次校验（`tool_not_allowed`）；`cli_run` 与
  `task` 不在可授予集合（单测）。
- [ ] 4.5 写范围守卫：`vault_patch` / `vault_create` / `vault_move`（两端）/ `vault_delete` 目标判定；
  目录前缀与单文件精确匹配；符号链接解析后判定；越界拒绝 `write_scope_violation`、不进批准闸、
  文件系统不变（单测覆盖四条路径）。
- [ ] 4.6 写入闸：`gate: writes` 时写类工具转 ask，插在重定向 / 黑名单之后、allow 之前（deny 仍最优先）；
  只收紧不放松；拒绝只来自 deny；「本会话不再问」沿用同一缓存（单测：deny 仍优先、allow 不绕过闸、
  读类不受影响）。
- [ ] 4.7 源不变式：有写入时前置哈希 / 收尾重算；`source_changed` 语义与 iCloud 边界（占位拒绝、
  下载耗时不计入模型时间闸）单测。
- [ ] 4.8 `requires_log`：收尾校验 log 变化；未变化 ⇒ `log_missing`（单测）。
- [ ] 4.9 收尾幂等：任何终态一次、`catch_unwind` 后显式收尾、审计与计数只消费一次；用户停止不追加
  「请总结」调用；验证失败不撤销已写入内容（单测 + 真机）。
- [ ] 4.10 cron 交接入口：接受 `{workflow, inputs}`、校验 `unattended`、装配进无人值守槽位、回执会话
  id；无人值守遇批准按 cron 口径中止（单测；端到端待 cron 落地后补，见 §7.11）。
- [ ] 4.11 源内图片引用：前置解析输入源里的本地图片引用（Markdown 图片与 wikilink embed，复用
  `parse_links` / `LinkGraph`），把「未被查看」清单写进首次消息与卡片；契约段禁止基于未查看的图片
  下结论；解析不到的引用并入断链结果；v1 MUST NOT 投递图片字节（单测 + 真机场景 §7.12）。

## 5. 入口与可见面

- [ ] 5.1 文件树右键项「收进 wiki」：仅在 wiki 启用且目标在 `sources` 内时出现；点击发起 ingest。
- [ ] 5.2 工作流选择器：浮层列表（名字 + description + 所需输入）、输入收集、当前文件预填；复用既有
  浮层控件，不新增视觉语言；键盘与读屏可用。
- [ ] 5.3 命令 `wiki.run` 与菜单项：落到同一实现；**不新增默认键位**，用户可经 `[keys]` 自绑。
- [ ] 5.4 运行卡片与验证行：会话开头卡片（输入、检查摘要、来源、「查看流程」只读浮层）；收尾验证行
  （通过 / 未通过、原因、前三项差异 + 总数）；随会话留存与恢复还原。
- [ ] 5.5 禁用态与空态：未启用时入口全部不出现；没有可用预填输入时要求选择文件；无任何 wiki 项时不
  占位。
- [ ] 5.6 文案：全部经 `src/copy.ts` 的 `t()` 新增条目（含拒绝原因码的人话映射）；登记编号并更新
  对应文案清单。

## 6. 诊断与文档

- [ ] 6.1 `logging.rs` 白名单新增五个事件与字段校验；`status` / `reason` / `entry` / `trigger` 闭集合；
  事件不含正文与绝对路径（单测断言字段集）。
- [ ] 6.2 完成事件单一产出点（收尾函数），失败 / 中止 / 验证失败路径同样产出一条（单测）。
- [ ] 6.3 `docs/specs/wiki-workflows.md`（新）：vault 配置键表（缺省 / 合法域 / 消费者 / 生效时机 /
  失效面）、定义格式与校验表、检查器与参数、入口与卡片、诊断事件与读数命令、扫描上限实测值、
  `.lumir/{agents,workflows}` 目录分工。
- [ ] 6.4 观测读数自验：按 proposal「观测」节的三组命令实际跑一次（含一次 verification_failed），
  把命令与读数写进完成报告，注明执行时刻。
- [ ] 6.5 信息卫生清扫：对改动面做 text 级 grep（真实 vault 路径、真实人名、真实笔记标题、真实日志
  条目），记录命令与零命中；验收 fixture 全部用合成数据。

## 7. 真机验收场景（`scripts/acceptance/scenarios/`）

- [ ] 7.1 「启用与骨架」：未启用无入口；启用写 `enabled=true`；缺失的 `dir` / `index` / `log` 建成
  空文件；已存在文件逐字节不变。
- [ ] 7.2 「禁用态」：删除配置或置 `enabled=false` ⇒ 入口消失、命令回 `disabled`、盘上文件不变。
- [ ] 7.3 「文件树入口」：源层内 / 外文件的右键项差异；触发后卡片与输入路径正确。
- [ ] 7.4 「输入拒绝」：不存在路径、`..` 逃逸、源层外文件、iCloud 占位各被拒且 mock 零消费
  （断言无模型请求）。
- [ ] 7.5 「前置检查与有界输出」：合成断链 / 孤儿 / 未登记页，断言计数与列表；超过上限时
  `truncated=true` 且总数完整。
- [ ] 7.6 「写范围」：范围外写入被拒、文件不变、运行继续；范围内成功。
- [ ] 7.7 「写入闸」：`gate: writes` + 默认档逐次出现批准卡；拒绝不落盘、运行继续；`gate: none` 无卡。
- [ ] 7.8 「后置验证」：制造一次新增断链，断言 `verification_failed` + 逐项点名 + 已写入内容保留；
  另造「总数下降但新增一条」仍判红。
- [ ] 7.9 「源不变式与 log 兜底」：运行中改源 ⇒ `source_changed`；不写 log ⇒ `log_missing`。
- [ ] 7.10 「恢复」：结束后恢复会话按快照还原；删除定义文件后旧会话仍可用；无快照旧会话恢复不报错、
  不套当前定义。
- [ ] 7.11 「无人值守交接」（cron 落地后补）：`workflow=wiki-lint` 在无人值守槽位跑完、用户当前会话
  不变、log 追加一条；`unattended=false` 的定义被拒；遇批准中止。
- [ ] 7.12 「源内图片」：源里引用本地图片，断言卡片与首次消息列出「未被查看」、断链引用进入断链
  结果、报告不得声称看过图片。
- [ ] 7.13 `node scripts/acceptance/run.mjs --check` 通过（新增场景静态校验）。
- [ ] 7.14 回扫既有验收场景的闸期望（改闸语义的 change 必做）：全量跑既有批准闸与权限模式相关场景，
  确认交互会话的 ask / allow / deny 行为逐条不变；工作流写入闸的期望只出现在本批新增的工作流场景里，
  MUST NOT 混入交互场景。期望过期的就地改准并写明原因。

## 8. 验证

- [ ] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [ ] 8.2 `cargo test` 通过（含 §1.6 / §2.2 / §2.4 / §3.1–3.8 / §4.2–4.11 / §6.1–6.2 新增单测）。
- [ ] 8.3 前端单测通过（入口可见性、卡片状态映射、拒绝原因文案映射、空态）。
- [ ] 8.4 `bash scripts/docs-check.sh` 通过（相对链接与归档对账）。
- [ ] 8.5 `scripts/gate.sh quick` 全绿（`GATE RESULT` 原文行与退出码照抄进完成报告）；动过
  `src/style.css` / `tests/visual/**` 后本地跑 `scripts/gate.sh visual`，基线更新前截图须 Alex 过目。
- [ ] 8.6 真机跑新增验收场景（§7.1–7.14），证据目录用绝对路径 `ls` 到；失败与跳过项逐条写明原因。
- [ ] 8.7 范围自检：`rg -n "fn run_turn_for|fn run_turn" src-tauri/src` 确认循环入口仍唯一（没有第二套
  会话装配）；`rg -n "write_document_atomic|std::fs::write" src-tauri/src/wiki/` 确认没有第二套写盘通道；
  `rg -n "cli_run|task" src-tauri/src/wiki/` 确认工作流代码不授予 CLI 与委派；工具清单与 ADR 0007
  现行清单一致（本 change 未新增工具）。
- [ ] 8.8 多 vault 冒烟：两个合成 vault 各自启用 / 未启用，切换后入口与运行互不影响；配置与定义随
  vault 走（复制 vault 目录到临时路径后行为一致）。
