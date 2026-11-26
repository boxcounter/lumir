# Proposal: 显式 Skill 留下可见痕迹

- Change ID: `add-explicit-skill-trace-nov26`
- 日期: 2026-11-26
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 节点 1（提案评审）**已批准**（2026-11-26）。Alex 裁决原话：对「显式 Skill 留下可见痕迹」回复
> 「采纳」。批准范围：每个显式选择的 Skill 在 harness pane 显示类似工具调用的一条记录；能看到
> 名称、已加载或失败原因；只显示痕迹不显示 Skill 正文；复用工具行折叠与视觉体系；切换会话 /
> 恢复历史后痕迹仍存在；不改变 Skill 权限、加载、内容注入逻辑；自动 `skill_load` 既有表现保持
> 不变。

## Why

用户显式选择 Skill 后，面板今天**没有一条可核对的记录**：

- 成功加载只把带 `lumir_skill` 标记的正文 part 追加进用户消息
  （`src-tauri/src/harness/turn.rs` 的 `explicit_skill_parts`），而面板投影
  （`panel_text_of_content`）有意跳过该 part——消息气泡里只剩用户原文，看不出选中的 Skill 是否
  真的加载了。
- 部分失败（权限拒绝、元数据非法、禁手动）只在 **live** 发一对 `tool_call` 事件并写内存面板
  （`emit_explicit_skill_error`），不留任何可恢复载体；grammar 不合、发现不到、文件不可读、无正文
  等失败当前连 live 痕迹都没有，直接静默跳过。
- 恢复 / 切换会话时面板从 `llm_request.messages` 重建
  （`restored_panel_messages`），上述两类痕迹都不在重建面里——切走再回来，痕迹全部消失。

结果是用户无法回答「我选的 Skill 加载成功了吗、失败是为什么」。这与「显式选择 = 用户按键确认
的显式调用」（`openspec/specs/harness/spec.md`「Skill 的混合调用、入口策略与候选接受」）的
可核对性不匹配。

## What Changes

1. **`harness` 新增 requirement「显式 Skill 加载痕迹」**
   - 每个显式选择在面板留一条与工具调用同形的痕迹行（工具名 `explicit_skill`，与模型自主的
     `skill_load` 区分），成功呈「已加载」，失败呈失败终态并给出具体原因。
   - 失败面补齐：名字不合 grammar、不存在、SKILL.md 缺失 / 不可读 / 超限、加载结果无正文、
     调用元数据非法、禁手动、权限拒绝，全部留痕，不再静默。
   - 痕迹只含名称、终态、错误码与人话原因；SKILL.md 正文与目录内其他文件内容 MUST NOT 进入
     面板、辅助技术树或痕迹载体。
2. **痕迹的可恢复载体**：痕迹随该用户消息进入会话 `input` / `llm_request.messages` 的本地字段
   `lumir_skill_trace`（`{name,status,code?,message?,ts}` 数组），在 provider wire 展开时与
   `lumir_skill` 一并剥除（模型不可见）。恢复路径从该字段重建同一批工具行；live 与恢复不重复、
   重试不重算。
3. **不变量**：权限判定、执行期正文加载器、正文注入 part、面板正文投影、自动命名素材与自动
   `skill_load` 的工具行 / 结果回送全部保持既有语义。

## Non-goals

- 不向模型注册新工具（`explicit_skill` 只是面板痕迹的呈现名）、不改变 `skill_load` 的参数 / 结果合同与
  权限判定顺序，不扩大权限。
- 不把 Skill 正文、路径、frontmatter 原文放进痕迹行、面板或 AX。
- 不改变自动 `skill_load` 的既有工具行、折叠与结果回送。
- 不新增配置开关、不新增面板筛选 / 搜索 / 导出能力。
- 不改变工具行折叠与视觉体系（痕迹行只是同一套行件的一个消费者）。
- 不在本 change 内处理自动压缩后的历史（压缩换新逻辑会话，旧痕迹与既有工具行同口径地不承诺
  保留）。

## Impact

- 影响的 specs：`harness`（新增 requirement）。
- 影响的代码/系统：`src-tauri/src/harness/turn.rs`（显式加载管线与痕迹产出）、
  `src-tauri/src/harness/attachments.rs`（wire 剥离）、`src-tauri/src/harness.rs`（恢复重建）、
  `src/harness-panel.ts`（`explicit_skill` 参数格人话化）、对应 Rust / 前端单测与验收场景 726。
- 关联约束：不触及性能合同与「不改写源文件」铁律；不新增持久化文件，痕迹随既有会话留存
  （JSONL）走。
