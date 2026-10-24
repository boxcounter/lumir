# Tasks: add-semantic-image-naming

> **实现范围**：`src-tauri/src/{config,fs_io,commands,link_graph}.rs`、后端命名任务模块
> （新建）、`src-tauri/src/harness/llm.rs`（仅复用，不改协议）、`src-tauri/tests/**`、
> `src/bindings/**`、`src/{paste-image,editor,main,save-controller,copy-data}.ts`、
> `文案-Copy.md`、`docs/specs/config-reference.md`、`scripts/acceptance/**`（新增场景 + 新
> fixture + `lib/app.mjs` 的 `harness.attachment_naming` 配置通道）、`openspec/changes/add-semantic-image-naming/**`。
>
> **前置**：节点 1（提案评审）通过后才可开工；slug 字符集与「默认开」已于 2026-10-18 落槌
> （原文见 proposal「裁决记录」），开工时不再重开。**配置面形态**后经同日「配置面重塑」裁决
> 调整：落在 `[harness].attachment_naming { enabled, provider, model }`，原顶层 `[attachments]`
> 表废除（见 proposal「裁决记录」第 4 条）。

## 1. 配置面（`src-tauri/src/config.rs`）

- [x] 1.1 新增 `[harness].attachment_naming` 表与 `AttachmentNamingConfig { enabled: bool（默认 true）, provider: Option<HarnessProvider>（默认 None = 会话当前 provider）, model: Option<String>（默认 None = 该 provider 的生效模型） }`，挂在 `HarnessConfig` 上；doc comment 写清缺省即默认、布局判据（配置跟随资源域）与两方向的生效时机。
- [x] 1.2 校验：类型不符走整文件回落模板；`provider` 闭集合外回落 `None` + 人话 warning；`model` 不可用（未在**选定 provider** 的 `models` 清单 / 未声明 `vision: true` / mock 下非空）只点名警告、**值原样保留**（资格不通过即保留暂存名，MUST NOT 静默换成别的模型）；空串归一为 `None` + warning。
- [x] 1.3 单测：整表缺席 / 单键缺席 / 三键显式值 / `provider` 非法回落 / `model` 三类不可用（未列出、未声明 vision、mock 非空）/ 空串 / 类型不符整文件回落 / 旧顶层 `attachments` 表静默忽略。
- [x] 1.4 `src/bindings/**` 由 ts-rs 重导出（`AttachmentNamingConfig.ts` 等），重导出产物先 `git add` 再跑门禁（bindings-drift 纪律）；旧 `AttachmentsConfig.ts` 删除。
- [x] 1.5 唯一解析口 `HarnessConfig::attachment_naming_target(session_provider)`（与会话自动命名的 `title_target` 同形：provider / model / wire_api / api_key / base_url 五字段同出一个 provider 条目），替换旧的 `attachment_naming_model`；单测钉住跨 provider 不混用。

## 2. 内容寻址去重改造（`src-tauri/src/fs_io.rs`）

- [x] 2.1 粘贴去重探测同时覆盖两族名字：精确 `pasted-<hash16>.<ext>`；同扩展名、stem 末段为十六进制短后缀且其前 6 位等于 `hash6` 的文件（覆盖 6 / 8 / 12 / 16 位后缀）。
- [x] 2.2 第二族命中后重新计算该文件字节的 SHA-256 与本次转码结果比对；不一致即视为未命中（MUST NOT 只凭后缀判同图）。
- [x] 2.3 单测：语义名文件 + 同内容再贴 ⇒ 命中既有路径、零写盘；构造 hash6 相同但内容不同的两张图 ⇒ 第二张正常写盘、不合并；首贴位置赢在两种命名形态下都成立。
- [x] 2.4 去重遍历口径零改动（hidden / lazy 档跳过、用户规则惰性目录照旧遍历、不跟随符号链接）——复用既有函数，不新增第二套遍历。

## 3. 改名与目标名规划（`src-tauri/src/fs_io.rs` / 新模块）

- [x] 3.1 单文件改名原语：同目录 rename、不覆盖既有文件；目标名撞名且内容不同时按短哈希后缀 6 → 8 → 12 → 16 位扩展取未占用名。
- [x] 3.2 目标名规划纯函数：`slug + "-" + hash6 + "." + ext`，ext 取原文件扩展名（不重编码）。
- [x] 3.3 单测：撞名后缀扩展逐档；扩展名不变；改名后字节逐字节不变；hash16 名字可由同一内容哈希重建（撤销用）。

## 4. 命名任务与模型调用（新模块，建议 `src-tauri/src/attachment_naming.rs`）

- [x] 4.1 任务入口：入参 = vault 根 / 文件 vault 相对路径 / 笔记路径 / 粘贴时刻的光标前后段落文本；只对「本次新写盘 + 文件名是暂存名 + 开关开」的调用投递。
- [x] 4.2 资格判定：`harness.attachment_naming.enabled` 为 true；`attachment_naming_target` 解析出的选定 provider + 模型声明 `vision: true`（mock 恒支持、但无模型维度）；不满足即静默返回、不发请求。
- [x] 4.3 读取字节并计算 hash16 / hash6；放弃判据（前置快检：文件不在 / 哈希不符 / vault 已切换）先于请求，改名前的最终判定再复核一次（同一规则）。
- [x] 4.4 一次性 vision 请求：复用 `harness::llm::client` 与图片展开链路；单条 user 消息（文本指令 + `input_image`）、无工具、无历史、非流式；**不建 harness 会话、不写会话 JSONL**。
- [x] 4.5 上下文装配：粘贴时刻快照的段落各截断到固定上限 + 笔记标题（文件名 stem，无路径取空串）；MUST NOT 在异步返回时重读光标。
- [x] 4.6 输出解析与 slug 规整：取第一行、去引号 / 反引号 / 围栏 / 扩展名；字符集纯 ASCII kebab-case（只留 `a-z` / `0-9` / `-`）：大写折叠为小写，空白与下划线折成 `-`，非 ASCII 字符剔除且不音译，连续 `-` 折叠、首尾 `-` 裁掉；上限 40 字符；空结果即失败。
- [x] 4.7 失败分类（网络 / 超时 / 错误响应 / 输出不可用 / 无模型 / fixture 缺失）统一走「保留暂存名 + 诊断日志一条」，不弹 toast；诊断事件不落正文与图片字节。
- [x] 4.8 调度：串行队列（同一时刻至多一个请求）、同路径任务合并、固定超时上限；任务完成时校验 vault 根一致。
- [x] 4.9 单测：slug 清洗全形态（引号 / 围栏 / 扩展名 / 空白 / 下划线 / 非法字符 / 空串 / 超长 / 大写折叠 / 连续 `-` 折叠 / 首尾 `-` 裁掉 / 纯非 ASCII（中文 / emoji）剔除后为空即失败）；资格判定四档（开 + 有 vision / 开 + 无 vision / 关 / mock）；放弃判据三例（文件不在 / 哈希不符 / vault 已切换）；提示注入串只被当文件名（不产生路径）。

## 5. 引用更新（`src-tauri/src/link_graph.rs` / 新模块）

- [x] 5.1 `WikiLink` 增 `path_span: (usize, usize)`（纯词法信息，不改变语义）；`tests/wikilink-fixtures/cases.json` 的 parseCases 增断言。
- [x] 5.2 全 vault 扫描：第一遍按去重同一套剪枝口径收文件路径；第二遍逐篇 md 读盘、`parse_links` + `resolve`，收集解析结果等于旧路径的链接的改写点与读时内容哈希。
- [x] 5.3 改写规则：只替换 target 末段为新文件名；`!` 前缀、目录前缀、`#heading`、`|alias` 与链接外正文逐字节不变；同一文件多处按 span 从后往前应用。
- [x] 5.4 rename 后 / 撤销时的反向匹配：解析结果等于新路径，或 target 末段与目标文件名相等（大小写折叠复用解析器同一规则，MUST NOT 另写一份）。
- [x] 5.5 逐篇写盘：写前重读并核对内容哈希，一致才 tmp + rename 原子写；不一致跳过并计数；MUST NOT 覆盖并发修改。
- [x] 5.6 扫描范围口径：只扫 `*.md`；hidden / lazy 档目录跳过；用户规则惰性目录照旧；不跟随符号链接。
- [x] 5.7 单测：五种引用形态（裸名 / 目录前缀 / 别名 / 锚点 / 大小写变体）全部命中且只改末段；代码块 / 行内代码 / frontmatter 内同串不命中；整篇除链接末段外逐字节不变；并发改写跳过计数；确定性（两次扫描同一结果）。

## 6. IPC 与前端接线

- [x] 6.1 后端命令 `attachment_semantic_name`（async）：执行 §4 + §5 + 改名，返回旧名 / 新名 / 旧路径 / 新路径 / 被改写笔记与新 revision / 跳过计数 / 撤销令牌。
- [x] 6.2 后端命令 `attachment_semantic_undo`：按令牌执行对称反向操作；令牌过期 / 不可识别 / 放弃条件命中时返回结构化错误。
- [x] 6.3 纯函数命令 `wikilink_retarget_text(text, from_rel, to_rel)`：对给定文本重算改写点（供 dirty 文档的内存对账），MUST NOT 写盘。
- [x] 6.4 `src/paste-image.ts` + `src/editor.ts`：粘贴成功后投递命名任务（不 await、不阻塞插入事务）；开关关闭 / 非本次写盘 / 非暂存名不投递。
- [x] 6.5 `src/main.ts` 对账：图片文件打开时 `remapSessionPaths` + `save.noteRenamed`；笔记 clean 时按既有 reload 路径重载；**全部打开的可编辑会话**用 `wikilink_retarget_text` 取当前坐标改写点（未命中返回空变更），有变更的按编辑事务应用（保留撤销栈与未保存内容）；不能只按后端磁盘命中列表挑文件（刚粘贴未保存的引用只在内存）。
- [x] 6.6 `src/save-controller.ts`：新增磁盘 revision 基准推进入口（如 `noteRevisionAdvanced`），供 §6.5 的 dirty 分支使用；单测断言推进后保存不报 CAS 冲突。
- [x] 6.7 watch 回声抑制：invoke 发起时按路径登记、结果处理后撤除（与 `renameEcho` 同形）；单测覆盖「结果晚于 watch 事件」的顺序。
- [x] 6.8 toast：成功 = 文本含新文件名 + 「撤销」动作；部分引用未更新 = 点名数量；撤销失败 = 人话说明。文案进 `src/copy-data.ts` 与 `文案-Copy.md`（zh / en 两档，编号按 deck 续编）。
- [x] 6.9 前端单测：投递时机与不投递三档；dirty / clean 对账分支；撤销令牌传递；toast 动作触发撤销命令。

## 7. 文档与配置参考

- [x] 7.1 `docs/specs/config-reference.md` 新增 `harness.attachment_naming` 节：三键的类型 / 默认 / 取值 / 生效时机 / 真源指针，布局判据（配置跟随资源域），以及「`enabled` 关→开需重启、开→关立即生效」「`model` 缺省 = 该 provider 的生效模型、不可用即资格不通过」的口径。
- [x]（归档时执行，本 mission 不动 living spec）7.2 `openspec/specs/clipboard-image-paste/spec.md` 的 Purpose 段补一句语义命名的边界（归档时由增量并入，不提前改 living spec）。
  —— 2026-10-24（M713）：Purpose 已补「语义命名是同一通道的异步后续、不属落盘原语」一句——落盘仍先取暂存名 `pasted-<hash16>.<ext>`，仅在 `harness.attachment_naming.enabled` 开且选定 provider 声明 vision 模型时于粘贴成功后发起独立命名调用，成功才改名 `<slug>-<hash6>.<ext>` 并按解析结果更新全 vault 引用（toast 一次撤销）；失败 / 超时 / 开关关闭保留暂存名，粘贴路径不等待、不阻塞插入。归档当场 `validate --all --strict` → `Totals: 37 passed, 0 failed (37 items)`。

## 8. 验收场景

- [x] 8.1 `scripts/acceptance/lib/app.mjs` 增加 `harness.attachment_naming` 配置通道（随 `harness` 结构化参数透传三键），`execute.mjs` 挡非表形态；供场景构造 `enabled` / `provider` / `model`。
- [x] 8.2 新增 mock fixture（脚本化返回一个固定 slug，供命名调用消费）；新增场景「贴图 → 语义改名 → toast 撤销」：断言终态文件名 `<slug>-<6 hex>.webp`、正文引用同名、暂存名文件不残留、toast 带「撤销」；点撤销后文件名与引用都回到 `pasted-<hash16>.webp`。
- [x] 8.3 回扫既有 112 / 113 / 116：核对在验收默认配置（provider 非 mock、无 vision 模型声明）下不发起命名、既有 `pasted-<hash16>` 期望不变；在场景注释里写明该前提。
- [x] 8.4 新增「无 vision 模型时保持暂存名」的断言：粘贴后经过明确观察窗口，vault 内不存在语义名文件、无命名 toast（复用 112 的驱动通道）。
- [x] 8.5 `node scripts/acceptance/run.mjs --check` 通过；新场景与 112 / 113 / 116 真机 PASS，证据落 `.local/acceptance/<日期>/`。
  （M709，2026-10-24 真机收口：`--check` 234 个场景 PASS；`node scripts/acceptance/run.mjs 168 112 113 116`
  4/4 PASS、45 条断言 0 红、退出码 0。**168**：终态 `harness-arch-c982bc.webp` 恰一个、暂存名文件 0 个、
  toast「已命名为 harness-arch-c982bc.webp」带「撤销」；点撤销后文件与渲染引用都回到
  `pasted-c982bca91f016511.webp`（hash6 = hash16 前 6 位）、语义名文件 0 个。**112**：默认配置观察窗口内
  无语义名文件、无命名 toast、暂存名保持（`pasted-9902da88ef019a8b.webp`）。**113**：同图跨笔记全 vault
  仍一份（`pasted-a878f4b7cd4bb4d3.webp`）、第二目录 0 副本。**116**：剪贴板 PNG 35055 B → 落盘 WebP
  6030 B。证据 `.local/acceptance/2026-10-24-m709/`（git 外，主仓；含 steps.md / ax dump / 截图）。）

## 9. 验证

- [x] 9.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 9.2 `cargo test` 与 `pnpm test` 全绿。
- [x] 9.3 `scripts/gate.sh quick` 全绿；照抄 `GATE RESULT` 原文行与退出码进完成报告。
- [x] 9.4 视觉相关代码未改动；若最终仍动到 `src/style.css`（toast 动作钮样式复用既有类，预期零改动），须补跑 `scripts/gate.sh visual` 并说明。
