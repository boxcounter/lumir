# Design: add-harness-probe

技术方案与权衡。事实依据：代码集成点见各节引用；外部选项调研来源见 §1（均为一手官方文档，社区观察另注）。

## 1. 对话运行时选型（裁决点 1，已采纳：自研薄循环 Rust core）

四条路线在「可控性 / 实现成本 / 可演进性」三角上的位置：

| 路线 | 工具定义权 | patch-only 做法 | 流式到 UI | subagent 路径 | 结构性成本 |
|---|---|---|---|---|---|
| A. 自研薄循环（Rust core） | 完全自有 | 能力级：工具集里不存在整文件写 | SSE 解析 → Tauri event | 自己组合（受限工具集再跑一个 loop） | 循环本身小；隐性成本在重试 / token 预算（探针期从简） |
| B. headless CLI subprocess（Kimi `-p` / `claude -p`） | 限于对方暴露的旋钮 | 最干净：`--allowedTools` 含 Edit 不含 Write | stream-json 行解析 | 依赖厂商实现 | 「借别人的 agent 人格」；上下文注入只能走 prompt 文本 |
| C. ACP 接外部 agent | 宿主无一等工具 | 批准级：permission 回调里查 diff 拒绝 | `session/update` 通知 | 协议层无概念 | 可控性最低；实测 agent 不一定把文件操作路由经宿主 |
| D. TS 框架 sidecar（Vercel AI SDK） | 自有 | 能力级 | `streamText` 原语 | 自由组合 | 引入 Node runtime 打包负担；webview 内跑则冲撞 <200MB 内存合同 |

**结论：A**。工具集小（6 个）且全部是宿主语义，外部框架可复用部分少；Rust core 同时守住 webview 薄（ADR 0002 §3）、低依赖、内存合同三条既有取向。

**留口**（ADR 0007 Decision 3 的可演进条款）：工具执行层抽象为「工具名 + JSON 参数 → JSON 结果」注册表，语义对齐 ACP fs/permission 模型；UI 层定义「agent 事件 → 对话面板」中间表示（text chunk / tool_call / approval_request / usage / done / error），headless CLI 后端将来翻译成同一中间表示即可接入，面板零改动。

调研来源（均 2026 年在效）：[ACP 官方协议文档](https://agentclientprotocol.com/overview/introduction)与 [Rust crate](https://crates.io/crates/agent-client-protocol)；[Kimi Code CLI 官方仓库](https://github.com/MoonshotAI/kimi-code)；[Claude Code headless 文档](https://code.claude.com/docs/en/headless)；[Vercel AI SDK agents 文档](https://ai-sdk.dev/docs/agents/overview)；[Anthropic tool use 文档](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview)。

## 2. 架构分层

```
面板 UI（TS，右栏 dock）
   │  用户输入 / 采纳决策
   ▼
上下文组装（TS）：activePath + 选区 / 视口 ──► 随首条消息注入
   │  ipc 薄封装（全部经 src/ipc.ts，既有纪律）
   ▼
对话运行时（Rust core，新模块 harness.rs）
   ├─ 会话状态（messages 数组、工具注册表、循环计数、累计 usage）
   ├─ 系统上下文装配：固定身份段 + AGENTS.md（user + vault 根）+ Skill 索引
   ├─ LLM client（OpenAI Responses API + function tools，语义化 SSE 事件流；kimi / deepseek / mock 三 provider，客户端全状态管理、显式 store:false）
   ├─ 工具执行：vault 读 / 搜索（复用 fs-io 函数）；patch 写 / 新建 / CLI（过权限机制）；skill_load
   └─ 事件流：harness:event 推送（text chunk / tool_call / approval_request / usage / done / error）
   ▼
权限机制：三层规则表（allow / ask / deny）；ask 档 = 面板批准闸
```

- **会话状态在 Rust，且绑定 vault**：会话状态是 vault → 会话的映射（一个 vault 一个会话）——语义必然：系统上下文含 vault 根 AGENTS.md 与 vault-wide Skill、工具路径与上下文注入都是 vault 相对的。切 vault 即切到该 vault 的会话（切回恢复）；关闭 vault 丢弃其会话；app 重启全部清空。webview 重载不丢会话；面板只是渲染器。
- **「新会话」动作**：面板提供重置入口（按钮 + 命令），清空当前 vault 会话的消息历史并重新装配系统上下文——解决跨话题干扰（旧话题上下文对新话题是噪音，压缩摘要同样携带旧话题）。JSONL 留存不受影响。这是重置，不是多会话管理：无会话列表、无历史回看。
- **热路径隔离**：LLM 调用与 SSE 解析在专线程；webview 侧流式渲染走 requestAnimationFrame 合帧，不触碰 CodeMirror 状态——keypress-to-paint 路径零新增（ADR 0002 §6）。
- **事件契约**：Rust → webview 事件名 `harness:<event>`，错误信封沿用 `CommandError{code,message,params}`（commands.rs:1-31 的既有约定）。

## 3. HTTP 与流式（首笔网络依赖）

现状：Rust 侧无 HTTP client、无 async 运行时（Cargo.toml 依赖全清单 11 项，lib.rs:410 明确「不需要 tokio」）；TS 侧无任何 fetch/XHR。

选择：**reqwest blocking + 专线程**。SSE 响应按行读取（blocking `Response` 实现 `Read`），逐事件解析后经 `app.emit` 推面板。不引 tokio——单个顺序 SSE 流没有 async 组合需求，与 lib.rs:410 的既有判断一致；依赖增量 = reqwest（blocking feature，rustls）。

**SSE 不过时**（对应 Alex 疑问 5）：2026 年 OpenAI 兼容契约、Anthropic Messages、DeepSeek 的流式输出全部仍是 SSE（`text/event-stream` 分帧）——见 [TokenMix 2026-04 流式指南](https://tokenmix.ai/blog/how-to-stream-ai-api-response)与 [DeepSeek 流式文档](https://deepseekai.guide/api/deepseek-api-streaming/)。

需要区分三个容易被混为一谈的协议名词（对应 Alex 疑问 5 的追问）：**Streamable HTTP** 是 **MCP 的传输层**协议——2025-03-26 版 MCP 规范引入，取代旧的 HTTP+SSE transport，「SSE 被废弃」的传闻真实存在但只发生在 MCP 传输层语境（[MCP 官方传输层文档](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)），与 LLM completion 的 token 流式无关。**Responses API** 是 OpenAI 的新一代 API（相对 Chat Completions），其流式**仍然走 SSE**。

**Responses API 的选型论证与结论（2026-10-02 经 Alex 讨论改判：采用 Responses API）**。两家 provider 官方均已支持：kimi（[官方 Responses schema](https://platform.kimi.ai/docs/api/responses)，实现较完整，含 `prompt_cache_options` TTL 控制与 `cache_write_tokens` 遥测）与 deepseek（[官方 Responses 文档](https://api-docs.deepseek.com/guides/responses_api/)，**无状态实现**：`previous_response_id` / `conversation` / `store` 不支持）。趋势是文档化的：OpenAI 建议新集成用 Responses、新模型只发 Responses（Chat Completions 进入「持续维护但不再进化」状态；真正被弃用的是 Assistants API，2026-08-26 关停）。

决策推理：① 我们刻意把会话状态留在 Rust 客户端，DeepSeek 的无状态实现使「服务端状态撕裂事实源」的顾虑消失——Responses 对我们是**纯报文格式选择**；② 两家上线 Responses 均为服务 Codex 类 agentic 工具负载，恰是我们的负载类型，「多轮 function calling 在新表面里程短」的风险因此有限，残余风险由 mock 钉住循环 + 实现期真 API 验证对冲；③ 额外收益实质：语义化流式事件（类型化事件优于 choice-delta JSON 路径）、**usage 字段两厂统一**（Responses 形态下 kimi 与 deepseek 均走 `input_tokens_details.cached_tokens`，Chat Completions 形态反而要映射两套字段）、kimi 的 cache TTL 控制、deepseek 的 `apply_patch` custom tool 通道（后续增强候选）。

实施纪律：会话状态仍全部客户端化——kimi 侧显式 `store: false`（vault 内容不在 provider 侧留副本，与本地留存策略一致）；逐 provider 核对参数支持表（deepseek 对不支持参数**静默忽略**，请求形状须对着其兼容表验证）；多轮往返中 reasoning 项按各厂规则回传（deepseek 合并进 assistant 消息，kimi 有 `encrypted_content`）。**fallback 留口**：LLM client 抽象不变，未来接入只支持 Chat Completions 的 provider 时加 Chat 适配器；Responses 适配器与 Chat 适配器并存于同一循环之下。

## 4. 工具循环

- messages 数组在 Rust 维护；每轮把模型返回的 tool_calls 逐个执行、结果回送，直到无 tool_call 或达循环上限（默认 8，`[harness].loop_max` 可调，防失控循环）。
- 工具定义（JSON schema，Responses API 的 function tools 形态）：
  1. `vault_read(path, offset?, limit?)` — vault 相对路径，经 `resolve_in_vault` 校验（fs_io.rs:812）。
  2. `vault_search(query, path_glob?)` — vault 内全文搜索（复用 ignore crate 遍历），尊重忽略规则表。
  3. `vault_patch(path, edits[])` — 局部写，见 §8（fs-io 增量）。
  4. `vault_create(path, content)` — 新建文档，O_EXCL 不覆盖。
  5. `skill_load(name)` — 按名加载 Skill 全文，见 §5。
  6. `cli_run(command, args[])` — argv 直传（无 shell 展开），输出截断回送；过权限机制，见 §6。

## 5. Skill 与 AGENTS.md（对应 Alex 反馈 1 与 2.1）

**AGENTS.md 双层自动加载**：会话建立时装配系统上下文 = 固定身份段 + `~/.agents/AGENTS.md`（user-wide）+ `<vault>/AGENTS.md`（vault-wide）。文件不存在则静默跳过（常态）。嵌套子目录级 AGENTS.md 后置（Non-goals）。

**Skill 支持**：Skill = 含 SKILL.md 的目录（name + description + 正文指令的既有约定，与 Alex 现有 `~/.agents/skills` 生态同构）。

- **发现**：扫描两个根——`~/.agents/skills/`（user-wide）与 `<vault>/.agents/skills/`（vault-wide）；vault-wide 同名覆盖 user-wide（就近原则）。
- **索引注入**：系统上下文携带 Skill 索引（name + description 清单），模型据此判断何时加载——progressive disclosure，不预载全文。
- **按需加载**：`skill_load(name)` 读取对应 SKILL.md 全文；路径解析**限定两个 Skill 根**（只读、防逃逸，与 vault 校验同构），skill 引用的附属文件（脚本等）经同一根内相对路径读取。
- **外部能力的接入形态**：Tavily 这类外部工具 = 「Skill（教模型用 tavily CLI）+ `cli_run`（执行）」，不再是内置工具。新增外部能力 = 放一个 Skill 目录，零代码改动。
- 变更检测：会话建立时快照 Skill 索引；运行期新增 Skill 下个会话生效（探针期不监听）。

## 6. 权限机制（对应 Alex 疑问 3；裁决点 5）

**默认权限**：读类工具（`vault_read` / `vault_search` / `skill_load`）默认 **allow**——只读、限定在 vault 与 Skill 根内，逐次批准是纯摩擦。写类工具（`vault_patch` / `vault_create`）与 `cli_run` 默认 **ask**（批准闸）。

**cli_allow 并入权限机制**：是，按行业惯例它本来就是 permission 规则的一个特例（Claude Code 的 `permissions.allow = ["Bash(npm run test:*)"]` 同构），不单设配置键。统一为三层规则表：

```jsonc
"harness": {
  "permissions": {
    "allow": ["cli(tavily *)", "cli(ls *)"],   // 规则语法：tool(模式)
    "deny":  ["cli(rm *)"]                      // deny 优先于一切
  }
}
```

- 判定顺序：deny > allow > 默认分层（读 allow / 写与 CLI ask）。deny 命中直接拒绝并回送模型；allow 命中免批准执行；其余走批准闸。
- 规则粒度：tool 级（`vault_patch`）或 tool+模式级（`cli(tavily *)`，命令前缀匹配）。探针期规则语法只支持这两种，通配语义保持朴素（前缀 + `*`）。
- ask 档的面板形态 = §7 批准闸。

## 7. 写入批准闸与局部 patch 写路径（fs-io 增量）

- **唯一写既有文档的能力**：`vault_patch(path, edits: [{old_string, new_string}])`——old_string 必须**唯一命中**（0 次或多次都报错回模型），替换后未触及部分逐字节不变。工具集中不存在整文件写。
- **ask 档执行流**：写工具 / CLI 调用到达时挂起循环，发 `approval_request` 事件（写文档附 diff 预览——由 edits 在 Rust 侧直接生成 unified 格式；CLI 附完整 argv）；Alex 采纳后执行，拒绝（及可选原因）回送模型。未决批准项不自动超时通过。
- **与既有保存链路衔接**：patch 携带 revision（SHA-256）走 `document_save` 同一套 CAS（fs-io spec.md:98-110），冲突返回 `document_conflict`；落盘走「自身写盘」标记不触发 watch 回声（spec.md:23-69）；被 patch 文件若有打开的编辑器会话，经既有会话刷新通路同步；image/binary 扩展名拒绝（`fs_read_only` 口径）。

## 8. 上下文组装（TS 层独立模块）

- 输入：`editor.activeSession().path`（editor.ts:1055）、`view.state.selection.main`（先例 main.ts:1191）、无选区时 `view.viewport.from/to` 的行范围文本（先例 livePreview.ts:255-258）。
- 输出：结构化上下文块 `{path, selection?|viewport_range?}`，注入为 system 段「当前上下文」节 + 随消息更新。
- **可见性**：面板输入区上方 chip 显示将注入的上下文（文件名 + 选区 / 视口摘要），发送前可核对。
- 与面板 UI 解耦（ADR 0007 Decision 3 的分层纪律）：模块只依赖 `EditorHandle`。

## 9. 上下文用量与触顶（对应 Alex 反馈 2.2 与疑问 4；裁决点 6）

- **用量来源**：每轮响应的 `usage` 字段。Responses 形态下两家字段统一：`input_tokens` / `input_tokens_details.cached_tokens`（kimi 另有 `cache_write_tokens` 可后续展示）；映射表仍写在 provider 预设里，防字段方言回潮。
- **面板显示**：常驻 `ctx NN% · cache NN%`。ctx% = 最近一次请求的 prompt_tokens ÷ 模型上下文窗口（窗口大小进 provider/model 预设表，配置可覆盖）；cache hit% = cached ÷ prompt_tokens。mock provider 在 fixture 里给出 usage，验收可断言。
- **警示**：ctx% 超阈值（默认 85%，可配）时面板显示警示条，「压缩续聊」手动入口自警示出现起可用。
- **自动压缩（auto-compact，Alex 裁决 2026-10-02）**：每轮响应完成后检查 ctx%，越阈值 SHALL 自动执行压缩续聊——会话历史压缩为摘要，开新逻辑会话，注入摘要 + 当前编辑器上下文 + 系统上下文（AGENTS.md / Skill 索引原样保留）。自动压缩 MUST NOT 静默：面板插入可见的压缩标记（摘要可展开查看），JSONL 完整留存压缩前历史。`auto_compact = false` 时退化为纯手动。兜底路径：API 返回 context-overflow 错误时，自动压缩后重试该轮一次。 MUST NOT 静默截断旧消息（模型「忘记」却不告知是最危险的形态）。

## 10. 面板 UI

- **接入**：`.app-shell` 网格第三列 `0px` → `--layout-dock-w`（新 token），style.css:318-336 的注释已把此路径写死；标题栏动作钮槽位填入面板 toggle（产品标识块左侧）。
- **token 纪律**：平铺面板不吃 elevation（ui-design-system spec.md:26-32），底色用已预留的 `--agent-bg`，hairline 分隔；eink 降级 9 条照守。独立样式表 `src/harness-panel.css`（先例 search-panel.css）。
- **文案**：全部进 `src/copy-data.ts` 领 D 编号，zh/en 双档；长驻元素注册 `onRelabel`。
- **流式渲染**：纯 DOM（不挂 CodeMirror），chunk 追加走 rAF 合帧。
- **Markdown 渲染**（对应 Alex 疑问 6）：assistant 消息按 Markdown 渲染（GFM 基本面：标题 / 列表 / 表格 / 代码块，代码高亮复用既有高亮体系与 token）；流式期间按块增量重渲；一切模型输出经转义后注入（MUST NOT 直插 HTML）。渲染实现选型（轻量 md→HTML 依赖 vs 小子集自写）实现期定，基准是上述 GFM 面 + 零 XSS 面。
- **diff 预览**：approval_request 到达时渲染 diff + 采纳 / 拒绝；拒绝原因可选回送。
- **toggle 命令**：进 `src/keys.ts` 命令表。

## 11. 配置与 secret（裁决点 2，已采纳：明文）

`[harness]` 节（`Raw*Config` 宽容解析 + `validate()` 逐字段回落的既有模板，config.rs:631-686 样板）：

```jsonc
{
  "harness": {
    "provider": "kimi",                      // kimi | deepseek | mock（闭集合）
    "providers": {
      "kimi":     { "api_key": "…", "model": "kimi-k2", "base_url": "缺省=官方" },
      "deepseek": { "api_key": "…", "model": "deepseek-chat", "base_url": "缺省=官方" },
      "mock":     { "fixture": "路径" }       // 验收专用
    },
    "permissions": { "allow": [], "deny": [] },
    "loop_max": 8,
    "warn_ctx_pct": 85,
    "auto_compact": true
  }
}
```

- **双 provider 预设**（对应 Alex 反馈 7）：kimi 与 deepseek 均 OpenAI 兼容契约，预设 = base_url 默认值 + usage 字段映射 + 模型上下文窗口表；`provider` 键切换，key 与 model 按 provider 分存。
- **api_key 明文**：自用探针期威胁模型低（单机、本人），配置即数据要求人可读可改。Revisit：任何对外发布动作前改系统钥匙串（ADR 0007 已记出域口径届时一并重估）。
- 运行期写回通道：`config_set_ui_value` 泛化为 `config_set_value(section, key, value)`，`ui` 表行为不变（commands.rs:584-587 现状）。

## 12. persona（对应 Alex 疑问 8；裁决点 7）

v1 **不做 persona 系统**：固定朴素身份段（「你是 Lumir 的内置助手，可以读取与修改本 vault……」+ 工具使用纪律），行为定制由 AGENTS.md 双层加载与 Skill 承担——这正是它们的职责（user-wide AGENTS.md 已经写了「我是谁、我该如何行事」）。persona 系统与之重叠，且 ADR 0005 的对象模型仍是 deferred 状态，不在探针期预建。若未来要做，落点 = system 段的一层可插拔文件，与 AGENTS.md 同构。

## 13. 可测试性

- **mock provider**：`provider = "mock"` 时从 fixture 文件读脚本化响应（含 tool_call 序列与 usage 数值），确定性驱动工具循环——真机验收不依赖真实 API（套件无网络 mock 通道，README 既有边界）。
- **验收场景**（scripts/acceptance 新增）：① 选区唤起 + 上下文 chip；② 工具循环读文件并回答；③ patch 批准闸落盘、未触及部分 sha256 不变、打开中会话同步；④ 拒绝不落盘；⑤ 新建 O_EXCL；⑥ 权限规则（deny 命中拒绝、allow 命中免闸）；⑦ 用量显示（mock usage → ctx% / cache%）；⑧ Skill 索引注入与 skill_load。套件 `SCENARIO_CONFIG_KEYS` 白名单扩 `[harness]` 键。
- **视觉门禁**：新表面整页基线按卫生纪律重跑（AGENTS.md）。

## 14. 风险与开放问题

| 风险 | 对冲 |
|---|---|
| 弱模型 patch 命中失败率高 | 错误带原因回送重试；「按模型选编辑格式」（Aider 纪律）列为已知弹性缺口，探针期不换路线 |
| provider 间 SSE / function calling 方言差异 | 首版只锁 kimi / deepseek 两家实测；mock 钉住循环行为 |
| CLI 被模型利用做危险操作 | deny 规则 + 批准闸 + 无 shell 展开 |
| Skill 根在 vault 外的路径安全 | skill_load 限定两个根、只读、防逃逸（与 vault 校验同构） |
| 面板内存（长会话 messages + DOM） | 循环上限 + 警示阈值；DOM 虚拟化后置；常驻内存合同守门禁实测 |
| 开放问题：面板宽度可调 / 会话跨重启保留 | 探针期固定宽度、重启即清（JSONL 留存仅为记录），使用后再裁决 |
