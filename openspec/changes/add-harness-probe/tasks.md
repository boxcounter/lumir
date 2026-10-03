# Tasks: add-harness-probe

## 1. 配置

- [x] 1.1 `[harness]` 节：`RawHarnessConfig` 宽容解析 + `validate()` 逐字段回落（provider 闭集合 kimi/deepseek/mock、providers 表、permissions 规则表、loop_max、warn_ctx_pct），单测钉住非法值行为
- [x] 1.2 `config_set_ui_value` 泛化为 `config_set_value(section, key, value)`，`ui` 表行为回归不变
- [x] 1.3 bindings 重导出并入索引（bindings-drift 纪律）

## 2. 对话运行时（Rust core）

- [x] 2.1 `harness.rs` 模块：会话状态（vault → 会话映射：messages、循环计数、累计 usage；切 vault 切换、关 vault 丢弃、重启清空）、「新会话」重置、`harness:<event>` 事件契约、`CommandError` 信封接入
- [x] 2.2 LLM client：reqwest blocking + 专线程，OpenAI Responses API + function tools，语义化 SSE 事件解析（不引 tokio）；kimi / deepseek 预设（base_url 默认值 + usage 映射 + 上下文窗口表）；显式 `store: false`；对着 deepseek 兼容表验证请求形状（其不支持参数静默忽略）；reasoning 项回传纪律
- [x] 2.3 系统上下文装配：固定身份段 + AGENTS.md 双层（user-wide + vault 根）+ Skill 索引
- [x] 2.4 工具循环：tool_call 执行与结果回送、`loop_max` 上限终止、错误回送模型重试
- [x] 2.5 mock provider：fixture 脚本化响应（含 tool_call 序列与 usage 数值）
- [x] 2.6 会话 JSONL 留存（配置目录、append-only、含批准决策与 usage）
- [x] 2.7 压缩续聊：超限错误捕获 → 摘要生成 → 新会话注入

## 3. 工具集与权限机制

- [x] 3.1 `vault_read` / `vault_search`（复用 fs-io 读取与遍历，尊重忽略规则表）
- [x] 3.2 `fs_patch_file`：唯一命中校验、revision CAS、watch 自身写盘标记、打开中会话同步、image/binary 拒绝（fs-io 增量）
- [x] 3.3 `vault_create`：O_EXCL 不覆盖
- [x] 3.4 Skill 发现与 `skill_load`：双根扫描、vault-wide 覆盖、索引注入、根内限定读取
- [x] 3.5 `cli_run`：argv 直传（无 shell 展开）+ 输出截断
- [x] 3.6 权限机制：三层规则表（deny > allow > 默认分层）、tool/模式两级规则语法
- [x] 3.7 批准闸（ask 档）：挂起循环、`approval_request` 事件（diff / 命令）、采纳执行 / 拒绝回送

## 4. 面板 UI 与上下文组装

- [x] 4.1 上下文组装模块（activePath + 选区 / 视口，只依赖 EditorHandle）+ 注入 chip
- [x] 4.2 右栏 dock 接入：网格第三列 `0px` ↔ `--layout-dock-w` 新 token；标题栏 toggle 钮（产品标识块左侧）
- [x] 4.3 面板本体：流式渲染（rAF 合帧、纯 DOM）、Markdown 渲染（GFM 基本面 + 代码高亮复用 + 全转义）、工具调用可见、diff 预览 + 采纳 / 拒绝、「新会话」按钮与命令、压缩标记（摘要可展开）
- [x] 4.4 用量显示：ctx% / cache hit% 常驻条 + 阈值警示
- [x] 4.5 文案全部进 copy-data（D 编号、zh/en）+ `onRelabel` 注册；`src/harness-panel.css` 只消费 token、eink 降级
- [x] 4.6 toggle 命令进 keys.ts 命令表

## 5. 验证

- [x] 5.1 验收场景（mock provider）：选区唤起 + 上下文 chip / 工具循环读文件 / patch 批准落盘且未触及部分 sha256 不变 / 拒绝不落盘 / 新建 O_EXCL / 权限规则（deny 拒绝、allow 免闸）/ 用量显示 / Skill 索引与加载；`SCENARIO_CONFIG_KEYS` 扩 `[harness]` 键
- [x] 5.2 视觉门禁本地全跑，新表面整页基线 Alex 过目后 `--update`
- [x] 5.3 `scripts/gate.sh quick` 全绿（含 bindings-drift）
- [x] 5.4 性能合同复测：keypress-to-paint 无回归、常驻内存 <200MB（面板展开态实测）
- [x] 5.5 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
