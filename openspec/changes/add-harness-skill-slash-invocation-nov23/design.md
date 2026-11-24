# Design: Skill 显式选择与模型自主调用的混合方案

- Change ID: `add-harness-skill-slash-invocation-nov23`
- 日期: 2026-11-24（r3.2，拒绝判据限定到各自被拒入口）
- 状态: **节点 1 已批准 H1**（Alex 2026-11-24「批准 Skill 混合方案」）；本文件构成施工依据
- 读者: Alex（裁决面）、实现 agent（施工依据）、reviewer（判据面）

## 1. 目标与边界

### 1.1 目标

1. 用户从候选显式选择 Skill 后，后端确定性读取并注入 SKILL.md 全文；不依赖模型再自觉调用工具。
2. 保留模型现有的「索引 → 按相关性判断 → `skill_load` → 工具结果」自动入口，默认能力不削弱。
3. 每个 Skill 默认用户 / 模型双入口开放；两个 frontmatter 字段分别支持禁模型自动与禁用户手动。
4. 调用策略与权限正交：同一 `skill_load` deny 对两个入口同效；显式选择不是授权。
5. `/tmp` 等普通路径不被文本扫描误判；显式正文可重试、可恢复，自动工具结果沿用现有历史。

### 1.2 非目标

- 文本 token 即调用；`@` / `$` 等第二套显式语法；Skill 卡片 / 块级混排。
- 并行支持 `allow_implicit_invocation` 或主字段别名；宣称所用字段属于 Agent Skills 标准。
- 全量预读、Skill 管理 UI、历史清洗、权限模型修改、完整 YAML 解析器。

## 2. 现状锚点（起草时核实）

| 事实 | 位置 |
|---|---|
| `discover_skills` 双根发现、vault 覆盖 user、按名字升序；名字无 grammar 限制 | `src-tauri/src/harness/context.rs:331-371` |
| `SkillEntry { name, description, dir }`；发现期当前用 `fs::read_to_string` 读入整份 SKILL.md，再只提取 description | `context.rs:320-326`、`:354-356`、`:373-399` |
| 索引在会话建立 / 新会话 / 压缩时装配一次 | `context.rs:15-20`、`:258-276` |
| `skill_load` 的名称 / 路径校验、200KB 上限、读取与错误回执 | `src-tauri/src/harness/tools.rs:1211-1291` |
| 回合开始重新发现 Skill，并交给 `ToolContext` | `src-tauri/src/harness/turn.rs:602-614` |
| `skill_load` 读类放行，deny 优先；权限主体取技能名 | `permissions.rs:107-113`；`tools.rs:439-453` |
| 发送契约 `parts_json` + `context_json` | `harness.rs:1631-1645` |
| 用户消息入队与面板文本共用附件投影 | `turn.rs:568-592`；`attachments.rs:366-471` |
| `lumir_label` 本地字段在 wire 前剥离、面板忽略 | `attachments.rs:300-340`、`:409-433` |
| 重试只校验 `input_len`、不重写内容 | `harness.rs:388-437` |
| 恢复灌回最后一条 `llm_request.messages`，不重新装配 system | `harness.rs:658-729`、`:1373-1497` |
| 压缩开新逻辑会话，输入历史由摘要替换 | `harness/session.rs:1123` |
| composer keydown：IME 闸门 → 撤销 → `mod` 提前 return → Enter 发送 | `harness-panel.ts:9569-9600` |
| `⌃N` / `⌃P` 行移动；单行末尾可原地不动 | `src/keys.ts:634-635`；`harness-composer.ts:376-391` |
| 草稿 v2 / v1 转换 | `src/quote-card.ts:326-410` |
| Escape 层栈与浮层摆放 | `src/escape-router.ts:102-146`；`src/overlay-placement.ts:121` |

### 2.1 两阶段读取定义（全文档统一术语）

| 阶段 | 时机与用途 | 正文是否投递 | 拒绝路径保证 |
|---|---|---|---|
| **发现期元数据读取** | `discover_skills` 为索引和策略发现读取 SKILL.md；当前实现是 `fs::read_to_string` 整份读入，再只做元数据解析（description 保持 frontmatter / 无 frontmatter 首行兜底，另加 invocation 字段） | 正文不作为调用结果投递；只有元数据进入索引 / catalog / 回合快照 | 发生在权限与策略判定之前，不得声称零 IO 或被后续 deny 追溯取消 |
| **调用执行期正文加载** | 显式注入或模型 `skill_load` 在权限、策略放行后调用共享正文加载器 | 显式进入用户消息 part；自动进入工具结果 | 某一入口被拒绝时，该入口加载器调用计数为零、对应输出面无正文；另一放行入口不受影响 |

- 本 design 中「各自被拒入口的加载器未调用」「该入口不注入 / 不回送正文」是拒绝路径的完整安全判据；
  不再单独使用「不读取任何 Skill 文件」或「文件系统读取次数为零」。deny 与非法元数据拒绝两个入口；
  禁自动只拒绝自动入口，禁手动只拒绝显式入口，必须保留另一入口的正文 marker 正向对照。
- 200KB 上限属于执行期正文加载器，不能据此暗示发现期只读前 200KB 或只读 frontmatter。
- 发现期只读 frontmatter 是可选后续优化，不属于本 change；不得借本 change 暗中改变索引内容、快照时机或
  读取错误口径。

## 3. 混合语义与不变量

### 3.1 两个入口，两个事实载体

- **显式入口**：一次候选选择创建 composer ref；当前消息 refs 生成 `skills_json`；后端把全文作为用户消息
  的本地标记 text part 注入。确定性来自后端执行，不来自 `/名字` 字样。
- **自动入口**：模型读取索引后自行调用 `skill_load`；全文作为工具结果返回。它不需要 refs，也不生成
  `lumir_skill` 用户消息 part。
- 同一 Skill 在同轮可被两条入口使用，但本 change 不主动协调或去重跨入口内容；显式入口自身同名去重，
  自动入口是否再次读取由模型决定。不得为了「优化」而删掉既有自动工具结果。

### 3.2 不变量

| # | 不变量 |
|---|---|
| H1 | 没有当前消息 ref，就没有显式注入；后端 MUST NOT 从文本解析技能名 |
| H2 | 默认 Skill 的索引与模型 `skill_load` 能力不削弱；策略只拦被配置禁止的入口 |
| H3 | 用户与模型策略独立；禁自动不拦显式，禁手动不拦自动 |
| H4 | 两入口在执行期正文加载前都经过同一 `skill_load` 权限判定，随后共用同一加载器；发现期元数据读取不在此断言内 |
| H5 | ref 与文本同源；切片不逐字节等于 `/名字`、左边界失效或越界时 ref 失效 |
| H6 | 策略只约束新调用；历史请求、工具结果和旧 JSONL 不按当前策略重写 |

## 4. 调用策略：唯一字段口径

### 4.1 frontmatter

目录名仍是 Skill 名字的唯一来源；frontmatter 的 `name` 不改变现有身份解析。新增两个可选字段：

```yaml
---
description: 部署生产环境
disable-model-invocation: true
---
```

```yaml
---
description: 领域背景知识
user-invocable: false
---
```

| 字段 | 缺省 | `true` | `false` |
|---|---|---|---|
| `disable-model-invocation` | `false` | 禁止模型自主 `skill_load`；用户显式仍可用 | 模型自主可用 |
| `user-invocable` | `true` | 用户显式可用 | 禁止候选选择与显式注入；模型自主仍可用 |

选择这两个拼写是因为它们分别表达两个维度，且缺省值直接对应「默认双入口开放」。它们借用
[Claude Code Skills](https://docs.anthropic.com/en/docs/claude-code/skills) 的词汇，但这里是 Lumir 自己
定义的 frontmatter 合同，不声称 Agent Skills 标准已有这些字段。Codex 的
`allow_implicit_invocation` 仅作[官方实践对照](https://developers.openai.com/codex/build-skills)，不实现。

**只有这一套拼写。**不得增加 `allow_implicit_invocation`、`model_invocable`、`disable-user-invocation`、
嵌套 `invocation:` 或字符串反义映射。未知字段仍按现有 frontmatter 口径忽略。

### 4.2 解析与非法值

- 沿用现有简单 frontmatter 逐行解析，不引入 YAML 依赖；只接受去空白后的精确字面量 `true` / `false`。
- 字段缺失才取缺省。字段重复、带引号、`yes` / `no`、大小写变体、非布尔值均视为非法调用元数据，
  不得猜测作者意图。
- 非法时该 Skill 的 `invocation_valid = false`，两个入口都 fail closed；模型调用返回
  `skill_invocation_invalid`，显式发送给同码非阻断提示。两入口的执行期正文加载器均未被调用，
  显式 `input` / `llm_request.messages` / provider wire 与自动工具结果均无正文。
- 元数据解析与策略判断只在 `context.rs` 形成一份内部表示；候选、索引、自动工具与显式加载不得各自
  重写字段解释（REVIEW.md「同一语义两处真源」条）。

建议内部形状：

```rust
struct SkillInvocation {
    user_invocable: bool,   // 缺省 true
    model_invocable: bool,  // 缺省 true（disable-model-invocation 取反）
    valid: bool,
}
```

`SkillEntry` 增加 `source` 与 `invocation`；vault 覆盖 user 时整项替换，不能把一个根的正文与另一个根的
策略拼接。

### 4.3 策略在发现面的呈现

- 系统提示索引继续列出所有已发现 Skill。默认项的索引文本保持不变；非默认项追加简短策略标记，
  非法项追加元数据错误标记。模型可据此知道「应请用户点名」或「仅供自动使用」，但执行层仍必须强制。
- `harness_skills_list` 返回所有符合 `/` grammar 的条目，DTO 为
  `{name, description, source, user_invocable, model_invocable, invocation_valid}`，不含 `dir`。
  候选只显示 `invocation_valid && user_invocable` 的条目；其他字段供既有 ref 的 chip 状态使用。
- 清单包含禁手动项不等于允许选择；前端过滤与后端发送时复核缺一不可。

## 5. 显式候选状态机与键位

```
closed ──(键入 "/" 且边界 + 前缀匹配)──► open(list, highlight = none)
open ──(↑ / ↓ / 指针悬停)──────────────► selecting(highlight 移动，到端停住)
selecting ──(Enter / Tab / click)──────► closed(写入 /名 + 空格；创建 ref)
open ──(Enter)─────────────────────────► 原语义（发送）
open ──(Tab)───────────────────────────► 原语义（不消费）
open / selecting ──(Esc)───────────────► closed（共享层栈，焦点不动）
open / selecting ──(⌃N / ⌃P)───────────► closed（主动关；按键不消费）
任意态 ──(光标离开 token / 删除 / 失焦 / compositionstart / 发送 / 会话复位)──► closed
```

- 被动态 `highlight === none`，不消费 Enter / Tab；`↑` 从末项进入、`↓` 从首项进入。
- 选择态方向键移动，到端停住不环绕；Enter / Tab / 点击选中。`mousedown` 防止焦点离开 composer。
- 选中只替换当前 token；已有尾随空格时扩展替换范围，避免双空格。
- `Esc` 走 `harness-skill-menu` 共享层栈，一次只关最上层，不收面板、不移焦点。
- IME 组合期不触发、不导航、不吞确认 Enter；`compositionstart` 关闭已有候选。

现有捕获处理器顺序必须保持，`⌃N` / `⌃P` 专用关闭分支位于 generic `mod` return 之前：

```
1. event.isComposing / imeGateState / imeGateKeydown
2. ⌘Z / ⌘⇧Z / ⌘Y 撤销
3. ⌃N / ⌃P：若候选打开则 close；不 preventDefault、不 stopPropagation；return
4. generic mod 键 → return
5. 候选 ↑ / ↓ / Enter / Tab（仅相应状态消费）
6. Enter → 发送 / ⇧Enter → 换行
```

测试必须驱动真实捕获处理器，断言 `defaultPrevented === false` 且行移动仍发生，不能只测抽离伪分支。

## 6. 选择引用、chip 与草稿

### 6.1 refs

```ts
interface ComposerSkillRef {
  name: string;
  from: number; // UTF-16，指向 "/"；to = from + 1 + name.length
}
```

- composer 增加 `StateField<readonly ComposerSkillRef[]>`；选中同事务替换文本 + add effect，
  `invertedEffects` 让撤销同步移除。
- 文档变化以 `mapPos` 映射；随后校验切片等于 `/名字` 且左边界合法，不满足即移除。
- `ComposerContent` 增加 `skills`；`composerIsEmpty` 仍只看 text + cards。
- `mergeRejectedComposerContent` 保留 restored refs、偏移 current refs，再逐条校验。
- `projectComposerDelivery` / `composerBlocks` 不变；refs 不进文本投影。
- `send()` 只取当前 refs，按 from 排序、同名首次、grammar 过滤后生成 `skills_json`；历史 refs 不提交。
- 选中后改名字、删字符、cut+paste、程序性整段替换都会使校验失败；不会误调用另一个名字。

### 6.2 chip 与 catalog 状态

chip 只从 refs 派生，使用 `Decoration.mark`，不改文本、选区、复制或投递，`pointer-events: none`。

| catalog 结果 | chip 状态 |
|---|---|
| 名字存在、元数据合法且 `user_invocable = true` | 正常 |
| 名字存在但 `user_invocable = false` | `is-disabled`，title 表明当前禁止用户手动调用 |
| 名字存在但 `invocation_valid = false` | `is-disabled`，title 表明元数据非法 |
| 最新成功 catalog 中名字不存在 | `is-missing` |
| catalog 请求失败 / 解析失败 | 只按 ref 渲染，不误标 missing 或 disabled |

catalog 按 vault 缓存最新成功清单：新 `/` 强制刷新；关闭候选后保留；草稿装载异步取一次但不打开候选；
切 vault / 会话复位清空并作废在途；失败不阻断输入。草稿恢复先按 refs 出 chip，不等 catalog。

### 6.3 草稿 v3

- 新草稿为 `{version:3,text,caret,cards,skills}`；refs 保存 `{name,from,to}`，不保存策略快照。
- CRLF 归一是所有版本的共同出口：先得到仍含原始坐标的 `{text,caret,cards,skills}`，再把 `\r\n` / `\r`
  归一为 `\n`，用同一份原始 offset → 归一 offset 映射重定位 caret、每张卡的 `at` 与每个 ref 的
  `from` / `to`；refs 的范围 / 切片 / grammar 校验在归一之后执行，写回 v3 与创建 `EditorState`
  共用这份归一草稿。
- v1 / v2 是明确消费者：读时一次性归一为 v3、skills 为空，立即写 v3；此后只读写 v3，不双写。
  v2 / v1 的卡片按既有规则全部落 `at: 0`，不因 skills 为空而改变 `at` 处理。
- v3 读取校验范围、切片与 grammar，脏 refs 丢弃，其余内容照常恢复。
- 策略在发送时按当前 Skill 重新判定。恢复一个后来变成禁手动 / 非法的 ref，不代表仍可显式注入。

## 7. 命名 grammar 与发现面

- `/` 显式入口只支持 `^[A-Za-z0-9][A-Za-z0-9_-]*$`。
- 清单 DTO、前端 ref 与后端 `skills_json` 校验使用同一 grammar 常量（Rust / TS 各一处导出或交叉测试钉住）。
- `discover_skills` 不按这个 grammar 过滤：含点（非点开头）/ 空格 / CJK 的名字仍进索引，仍可由模型
  自主 `skill_load`；点开头的名字仍进索引，但按现行 `skill_name_invalid` 被拒绝。
- 禁手动不等于从索引删除；禁自动不等于从 catalog 删除。发现、索引、候选是三个不同投影，不得混写。

## 8. 统一读取链与显式确定性加载

### 8.1 共享顺序

两个入口都按以下语义解析执行期正文加载：

```
发现期元数据读取（当前可整份读入 SKILL.md；只用于元数据解析，不投递正文）
  → 名称校验
  → 以 skill_load + name + {"name": name} 调现行权限 decide
  → 检查当前入口的 invocation_valid / invocation policy
  → 调用共享执行期正文加载器（根内路径校验 + 200KB 上限 + 文件读取）
  → 按入口投递正文
```

- 权限先于策略，保持现有 deny 优先级；两入口的任何非 `Allow` 都不调用执行期正文加载器。该断言不追溯
  否认第一步已经完成的发现期元数据读取。
- 模型入口的策略错误作为 `skill_load` 工具错误回送；显式入口的策略错误为非阻断 tool 行，均不伪装成
  `skill_not_found`，且正文加载器未调用、对应输出面无正文。
- 自动入口可通过 `file` 参数加载 Skill 目录内文件；禁自动 / 非法时不得调用正文加载器加载 SKILL.md 或
  其他文件。显式入口只确定性加载 SKILL.md，不新增 `file` 参数。
- 把 `skill_load` 的名称解析、路径 / 大小校验和执行期正文读取抽成共享内部函数；不得复制出第二套 200KB
  或防逃逸逻辑。测试给这个共享加载器加调用计数，不给发现期文件系统读取加零计数断言。

### 8.2 发送契约

`harness_send(parts_json, context_json, skills_json)`：

- `skills_json` 是必填字符串数组，无技能时 `"[]"`。唯一前端调用方同步改，不做旧前端兼容层。
- 非数组、非字符串元素、坏 JSON → `harness_skills_invalid`，不建会话、不入队。
- 不合 grammar 的名字防御性丢弃、发送照常；未知 / 超限 / 读取失败同样跳过且不阻断。
- `TurnInput::User` 显式携带名字数组；子运行 / cron / 既有测试构造点显式传空数组，不以缺省掩盖遗漏。

### 8.3 注入形态

`run_turn_core` 在当回合 `discover_skills` 后、用户消息入队前处理显式名字：

```json
{
  "type": "input_text",
  "text": "[已加载 Skill：<name>]\n<SKILL.md 全文>",
  "lumir_skill": "<name>"
}
```

- 先 `apply_context_section`，再按名字数组顺序追加 part；同名只注入一次。
- 权限 deny：执行期正文加载器未调用、不注入，发送照常；非阻断 tool 行 `skill_load` +
  `permission_denied` + 命中规则原文；`input` / `llm_request.messages` / provider wire 无正文。
- 策略禁用 / 非法：执行期正文加载器未调用、不注入，发送照常；分别报告
  `skill_user_invocation_disabled` / `skill_invocation_invalid`，上述输出面同样无正文。
- `lumir_skill` 只活留存 / 装配面。`expand_image_refs` 在无图片早退之前无条件剥离本地字段、保留正文；
  无图片时仍不解析或创建附件目录。三个 client 的 wire body 都需断言。

## 9. 自动入口的保留与策略闸

- 默认 Skill 的索引内容、工具定义、`skill_load` 参数、工具结果信封与循环顺序不改。
- 模型对 `disable-model-invocation: true` 的条目调用时，权限通过后返回
  `skill_model_invocation_disabled`；执行期正文加载器未调用，SKILL.md 与其他目录内文件均无正文进入
  工具结果。该错误可提示模型请用户显式选择，但不能由模型自己改成显式注入。发现期仍可按现状读取
  SKILL.md 以取得索引与策略元数据。
- `user-invocable: false` 不改变索引与自动工具调用；背景知识仍按 description 由模型按需取得。
- 回合开始发现的策略快照供本回合工具使用；系统提示索引仍是会话快照。会话中途策略变化可出现索引标记
  与当回合执行结果不同，执行层以当回合发现为准，不为消除差异重装配 system。
- 既有自动场景 77 与其 fixture 不改语义；新增独立 fixture 覆盖策略，不拿 mock 的脚本化调用证明真实模型
  一定遵守索引提示。

## 10. 留存、重试、恢复与压缩

| 面 | 显式选择 | 模型自主 |
|---|---|---|
| 会话 `input` | 含带 `lumir_skill` 的用户消息 part | 沿用现有工具调用 / 结果历史，不新增该 part |
| `llm_request.messages` | 含该 part，恢复时原样灌回 | 含既有工具历史，恢复时原样灌回 |
| provider wire | 剥离 `lumir_skill` 字段，正文与段头保留 | 不变 |
| live / 恢复面板 | `panel_text_of_content` 跳过显式正文 part | 工具行沿用现有投影 |
| 自动命名 | `title::item_text` / `title::material` 跳过显式正文 part | 不变 |
| 重试 | 回放 `input`，显式预加载器调用计数不增 | 沿用现有重试；不额外保证模型再次调用 |
| 恢复 | 回放最后请求，不重新执行显式注入 | 回放最后请求，不按当前策略重写旧工具结果 |
| 自动压缩 | 显式正文作为普通内容参与摘要，不逐字节保证 | 工具结果按现有摘要机制处理 |
| 策略变更 | 只影响新发送；旧正文仍在历史 | 只影响新工具调用；旧工具结果仍在历史 |

历史后续回合会重复携带显式正文，产生 token 成本。压缩只沿用现有超限机制尽力恢复，不承诺任意数量 /
任意大小 Skill 都能进入上下文，也不新增截断策略。权限或策略拒绝的显式正文从未进入 `input` /
`llm_request` / wire；拒绝 tool 行只作 live 非阻断反馈，不另造模型上下文说明。

## 11. 系统提示与验收诚实口径

`identity.md` 增加约定：

> 消息中出现「[已加载 Skill：名字]」段时，那是用户显式选择的技能，按该段正文行事。不要根据 `/名字`
> 字样推断显式调用，`/tmp` 这类斜杠路径是普通文本。其他可自动调用的技能仍按索引使用 `skill_load`；
> 标记为仅用户调用的技能不得由模型自行加载，应请用户显式选择。

- 段头常量与 identity 字面量由单测交叉钉住；固定段字节指纹同步更新。
- 索引装配测试覆盖默认项无标记、禁自动 / 禁手动 / 非法项标记；这证明提示装配，不证明真实模型遵守。
- 真机 mock 只证明注入、留存、投影、策略执行与发送链路。真实模型遵守率仅作 dogfood 记录，不进机器门禁。

## 12. 权限与安全

- 不改 `permissions.rs` 的档位、工具分类、规则优先级或缓存。
- 两入口都以 `skill_load` + 名字 + 同参数判定；tool 级与名字模式 deny 在三档下均不调用执行期正文
  加载器，显式 `input` / `llm_request.messages` / provider wire 与自动工具结果均无正文。
- 显式选择不是授权；Skill 内容引发的 `cli_run` 按现行档位、规则、命令分类与缓存执行。`full_access`
  对普通写命令自动放行，危险命令仍短路；不得写成「任一档都请求批准」。
- invocation policy 是入口治理，不是新权限档，也不能被用来放宽 allow / deny。
- Skill 正文仍可能含提示注入文本，与既有自动 `skill_load` 同信任模型；本 change 不新增隔离。

## 13. 视觉合同与可访问性

- 浮层绝对定位，复用 `placeOverlay` 的 `list` 档；caret 下方、空间不足翻上方、钳在 pane 内，最多 6 行，
  超出纵向滚动并登记 `scrollbar-registry`。
- 技能名正文档、描述次要档单行省略；被动无高亮，选择态用既有 hover 底色 + 左缘 2px 强调条；三主题复用
  token，eink 用描边。
- chip 行内、`--r-pill` 级圆角、既有弱强调面；missing / disabled 变暗并以 title 区分；无动画。
- 浮层 `role="listbox"`，候选项 `role="option"`；选择态高亮 `aria-selected="true"`，composer 编辑根
  带 `aria-autocomplete="list"` 与 `aria-activedescendant`；被动态不设后者，关闭后清除。
- 不新增整页像素基线；结构 / 计算属性断言为主。实现若动 `src/harness-panel.css`，仍须本地跑视觉门禁。

## 14. 性能

- 键入路径只做 O(token 长度) 边界判断与 O(refs) 映射，不读文件、不扫全文。
- 新 `/` 与草稿装载的 catalog 请求异步，不阻塞键入；chip 只为可视范围 refs 建 decoration。
- 执行期显式加载只在发送路径执行，每个名字沿用 ≤200KB；自动路径仍按需加载，不做全量正文预注入。
  发现期仍按现有索引 / 回合快照节奏读取元数据，当前实现可能整份读入，本 change 不宣称这部分零 IO。
- 显式正文进入历史后随请求重复；多技能成本与压缩边界按 §10 明示，不新增隐藏截断。

## 15. 判据映射

| 层 | 用例 | 断言 |
|---|---|---|
| Rust 单测 | 默认双入口 | 缺字段时 user / model 均允许；默认索引无策略标记；原有自主 `skill_load` 结果不变 |
| Rust 单测 | 策略矩阵 | 禁自动：仅自动加载器未调用 / 工具结果无 marker，显式 input / request / wire 有 marker；禁手动：仅显式加载器未调用 / 留存与 wire 无 marker，自动工具结果有 marker |
| Rust 单测 | 非法元数据 | 重复 / 引号 / yes / 大小写变体均 `skill_invocation_invalid`；两入口执行期加载器未调用，各输出面无正文 |
| Rust 单测 | 两入口权限 | 三档 × tool / 名字 deny × 显式 / 自动：执行期加载器未调用；显式 `input` / request / wire 与自动工具结果无正文 |
| Rust 单测 | 发现期已读后的 deny 反例 | 先发现并成功解析 description / 策略（证明文件已读），再 deny；执行期加载器计数为零，显式 input / request / wire 与自动工具结果无唯一正文 marker；不得断言文件系统零读取 |
| Rust 单测 | 显式注入 | 选中 → 带 `lumir_skill` part；未知 / 超限 / 读失败 / 不合 grammar 跳过；重复去重 |
| Rust 单测 | wire / 投影 | 三 client 无 `lumir_skill` 字段且正文在；无图片也剥离；live / 恢复 / 命名素材无正文 |
| Rust 单测 | 重试 / 恢复 / 压缩 | 显式 part 原样在，预加载计数不增；自动旧工具结果不被策略重写；压缩不重新显式注入 |
| Rust 单测 | 清单与索引 | 同源覆盖、无 dir；禁手动只在候选过滤；禁自动仍可选；grammar 外名字的现有自动能力不变 |
| Rust 单测 | 提示装配 | identity 含显式段头与路径约定；索引策略标记正确；固定段指纹更新 |
| 前端单测 | 候选 | 被动 Enter / Tab 不消费；选择态才消费；禁手动 / 非法项不出现；点击与 Esc 正常 |
| 前端单测 | refs / chip / 草稿 | 编辑失效、undo / redo、merge 偏移；missing / disabled 不混；v3 与 v1/v2 转换正确 |
| 前端单测 | ⌃N / ⌃P | 真实捕获处理器主动关闭、不消费，单行边界与跨行行移动保持 |
| 视觉结构 | 浮层与 chip | 两态高亮、ARIA、位置钳制、missing / disabled 样式、关闭零残留 |
| 真机 | 普通路径 | `/tmp` 行首 / 空格后 / 列表项 + Enter 无显式注入，候选不抢键 |
| 真机 | 混合调用 | 默认 Skill 可显式注入且既有自动场景通过；禁自动只能显式；禁手动只能自动 |
| 真机 | 历史 | 恢复后显式正文仍不上屏；旧自动工具结果仍在；策略变更不回写旧 JSONL |
| 真机 | 权限 / 键位 / 草稿 | deny 两入口执行期加载器未调用、输出面无正文；IME / ⌃N/P 无回归；草稿往返后按当前策略执行 |

## 16. 已知边界（接受清单）

1. `/tmp` 在存在同前缀 Skill 时可显示被动候选；Enter 仍发送，只有方向键 / 点击才选择。
2. refs 不跨 cut+paste、外部整段替换与降级到旧版本；旧版本读 v3 草稿可能按损坏处理。
3. catalog 失败不误标 missing / disabled；chip 仍按 refs 渲染。
4. grammar 外名字不能经 `/` 选择，但其现有索引 / 自动加载能力不收紧；点开头仍按现有规则拒绝。
5. 禁自动只阻止新模型工具调用，禁手动只阻止新显式注入；二者都不擦除历史正文。
6. 索引是会话快照，工具策略是回合快照；会话中途变化可产生标记与执行层时差，以执行层为准。
7. 显式正文随历史重复，压缩后只保证参与摘要，不承诺逐字节保留或任意规模可用。
8. 面板与复制面不含显式 Skill 正文；自动工具行仍按现有摘要 / 展开口径。
9. 结构非法 `skills_json` 拒绝发送；未知名字、策略禁用、权限 deny 均不阻断用户消息。
10. 同轮显式与自动重复加载不去重，避免为省 token 改动自动工具语义。
11. dev flavour 不隔离 `HOME` 时真实用户 Skill 可能出现；验收只断言合成名，不断言清单总数。
12. 发现期当前会整份读入 SKILL.md 解析元数据，且发生在权限 / 策略判定前；拒绝路径只保证各自被拒
    入口的执行期正文加载器未调用与对应输出面无正文，另一放行入口仍有正文正向对照。发现期只读
    frontmatter 留作后续独立优化，不在本 change 承诺。

## 17. 信息卫生

- fixture 只用 `acc-skill-abc` / `tmp-acc` / `acc-deploy` / `acc-background` 等合成名与合成正文。
- 真机预置只写验收 vault 的 `.agents/skills/`，不写真实 user-wide Skill；新 fixture 独立命名，不覆盖场景 77。
- 证据落 `.local/acceptance/`（git 外）；入库文档与截图不得含真实 vault 或 Skill 内容。
