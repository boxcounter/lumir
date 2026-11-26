# Design: add-explicit-skill-trace-nov26

## 1. 载体：user 消息项的本地字段 `lumir_skill_trace`

**选择**：痕迹项数组挂在**该用户消息项**上（`{"role":"user","content":[...],"lumir_skill_trace":[...]}`），
与既有本地字段 `lumir_skill`（part 级）、`lumir_label`（part 级）同族；wire 展开时与它们同点剥除。

**为什么不是 live-only / sidecar**：

- 恢复路径的唯一重建源是源文件最后一条会话请求的 `llm_request.messages`
  （`harness.rs::resume_session` → `restored_panel_messages`）。live-only 事件 / 内存面板过不了
  这一关。
- 独立 JSONL sidecar 需要一个排序锚（痕迹行属于哪条用户消息、排在其前还是其后）。消息项本地
  字段天然带位置，且随消息被后续每次请求原样带上，不需要第二套锚或配对逻辑（REVIEW.md
  「同一语义两处真源」条的同族理由）。
- 代价：失败错误码 / 原因文本会出现在**留存的请求记录**里（`llm_request.messages`），但**不进入
  provider wire**——与 `lumir_skill` 正文的处理方式完全一致：记录里有、模型看不到。取值面只写名称、
  终态、错误码、人话原因与 ts，**不写正文**。

**字段形状**（每一项）：

```json
{"name":"acc-skill-abc","status":"done","ts":1757000002}
{"name":"acc-background","status":"error","code":"skill_user_invocation_disabled",
 "message":"技能 acc-background 不允许用户显式调用","ts":1757000002}
```

`status` 取 `done` / `denied` / `error`（与 `PanelMessage.status` 的细分终态同一集合）；
`code` / `message` 失败时在场，成功时缺席。

## 2. 工具行身份：`explicit_skill`

- 痕迹行复用工具行的全部视觉件（icons、参数格、失败尾注、折叠块、时间读数），只有工具名不同：
  `explicit_skill`。理由：模型自主调用今天就叫 `skill_load`（`tool_call` 事件与工具结果），若痕迹
  行同名，用户无法区分「这是我选的」与「模型自己调的」——违反「不要把显式加载描述成模型自主
  调用」。
- 参数格用与既有工具行同形的参数摘要 JSON `{"name":"<技能名>"}`，前端 `keyArgOf` 已按工具名提取
  关键参数；新增一个 `explicit_skill → name` 分支即可，live 与恢复两侧同形。
- 失败行的**名称仍要可见**：恢复路径的失败行参数格走 `humanizeToolArgsStrict`（解析 JSON 才取值），
  故痕迹行的面板 `summary` 恒为参数摘要（而非 `finish_call` 的「失败 = 结果摘要」口径）；失败详情
  由 `text`（工具输出 JSON `{ok:false,code,message}`）承载——`failureTextOf` 正读这一份，与既有
  失败行同一数据源。

## 3. 单一产出点：痕迹项 → 面板消息

Live 与恢复 MUST 用同一个构造函数（`turn::explicit_skill_panel_message`）把痕迹项映射成
`PanelMessage`：名称、summary、status、text、ts 全部由痕迹项派生，恢复侧不另算一套。live 的
`started` / `done` 事件仍发（复用既有 `tool_call` 事件与 call_id 配对），`done` 摘要沿用
`summarize_result`（成功 = 「成功」，失败 = `状态 · 错误码: 原因`）。

## 4. 执行顺序与去重

1. 回合开始按当回合发现结果解析名字（既有顺序：grammar → 去重 → 发现 → 权限 → 元数据 → 入口策略 →
   正文加载）。
2. 每名字产出一个痕迹项（成功或失败）+（成功时）正文 part。
3. 用户消息入队：正文 part 追加到 content 末尾（既有），痕迹数组写 `lumir_skill_trace`；随后写用户
   面板消息，再按痕迹顺序写工具行并逐个发 started/done 事件。
4. 恢复：`restored_panel_messages` 在还原该用户消息后按数组顺序补工具行；数组缺席 / 解析失败时
   静默跳过（旧留存），不伪造。
5. 重试（`TurnInput::Resume`）不经过本管线：输入原样回放，痕迹数组与工具行都不重算；恢复只按
   最后一条请求重建一次，不会因重试多出行。

**同名去重**：按原始名字去重（含 grammar 非法的名字），先到先得；重复选择不再加载、不再留行。
这与既有 `seen` 去重语义一致，只是把去重提前到 grammar 校验之前，避免非法名字重复刷行。

## 5. 失败面清单与状态映射

| 场景 | code | status |
|---|---|---|
| 名字不合 `^[A-Za-z0-9][A-Za-z0-9_-]*$` | `skill_name_invalid` | error |
| 当回合发现结果里没有该名字 | `skill_not_found` | error |
| 权限判定非 Allow | `permission_denied`（文案沿用 `denied_message`） | denied |
| 调用元数据非法 | `skill_invocation_invalid` | error |
| `user-invocable: false` | `skill_user_invocation_disabled` | error |
| SKILL.md 缺失 / 不可读 / 超限 | `skill_file_missing` / `skill_read_failed` / `skill_too_large`（加载器既有码） | error |
| 加载成功但取不到正文字符串（防御分支） | `skill_content_missing` | error |

消息文本不复制工具错误的整份可用列表：显式失败是用户面记录，`skill_not_found` 只写「技能 X 不存在」，
避免把全部技能名塞进每条请求的留存里。

## 6. 不改变的面（回归边界）

- 权限判定调用（`skill_load` + 名字 + `{"name":…}`）与错误码不变；不新增权限分支。
- 正文注入 part、`lumir_skill` 标记、wire 剥离正文的既有行为不变。
- `panel_text_of_content` 继续跳过 `lumir_skill` part；痕迹是**独立消息**，不把正文带进面板文本。
- `title::item_text` / `title::material` 继续跳过显式 part；消息项本地字段不参与素材。
- 自动 `skill_load` 的工具调用 / 结果 / 工具行 / 恢复回填路径零改动。
- 工具行折叠、图标、失败尾注与时间读数全部复用，不新增 CSS。

## 7. 已知边界

- 自动压缩换新逻辑会话后只保留摘要，旧痕迹与既有工具行同口径地不承诺恢复（非目标）。
- 恢复出的 ts 取痕迹项自带的入队时刻，与 live 面板逐值一致；旧留存没有该字段时不存在痕迹行。
