# Design: add-harness-thinking-display-and-effort

> 读者：实现 worker 与 reviewer。本文件只记「为什么这么做」与跨切面决策；规格条款以
> `specs/harness/spec.md` 为准，任务拆解以 `tasks.md` 为准。

## 1. 设计合同与输入

- 原型 `design/prototypes/phase2-harness-chat/`：屏 9（思考块折叠/展开两态同屏）、屏 10（程度浮层三裸档）、
  composer 控制行（模型 chip → **思考 chip** → ctx 读数 → 发送钮）。原型已获 Alex 批准，本 design 不再
  重开形态问题，只登记实现落点。
- 既有事实（代码核实）：Rust core 自 M306 起捕获 reasoning 项（`llm.rs` §reasoning 回传纪律：kimi 的
  `encrypted_content` 保真、deepseek thinking 模式产出独立 reasoning 项且带 tools 时必须原样回传），
  但 `events.rs` 事件族无 reasoning 事件，前端从未收到思考内容。程度参数当前走厂商默认
  （`llm.rs:11`「探针期用厂商默认」）。

## 2. reasoning 事件：只加「转发给人」，不动「回传给模型」

- 新增事件种类（第八种）`reasoning_chunk`，payload 携带：思考文本片段 + 块序号（同一轮里第几个思考块）。
  信封沿用 `ScopedSink` 的 vault 标识机制，前端按既有只渲染当前 vault 会话的口径过滤。
- **回放纪律零触碰**：reasoning 项的捕获、合成、回传路径（`llm.rs:468-530`）一行不改；新事件是纯输出侧
  增量。这是本 change 最大的风险隔离墙——回放路径碰了会引发真 API 400 族回归（M306 实证）。
- 时长计时在前端：块序号首个 chunk 到末个 chunk 的墙钟差；轮次结束时定格。core 不引入新计时状态。

## 3. 思考块渲染（面板侧）

- 思考块归属 agent 消息：一条 agent 消息内按块序号排列，与正文段的相对位置按「思考块在前、正文在后」
  （各家 provider 均为先 reasoning 后 message，无交错形态）。
- 折叠为默认（含流式期间，Alex 裁决）；展开态样式 = 左边线 + 次级灰正文，全部取 token 层现行值，
  不新增色值/字号。折叠态单行：chevron + 「思考过程 · N 秒」。
- 无 reasoning 内容的消息不渲染块（不是渲染空块）——零噪声。
- 复制消息（提案 2 能力）**不含**思考内容：复制的是 agent 的回答正文。思考块自己的复制不在本期。

## 4. 程度映射：Low/High/Max → provider 实际参数

- 档位命名 Low/High/Max、默认 High，直接沿用 Kimi / DeepSeek 的思考程度命名与默认值（Alex 2026-10-06
  节点 1 裁决）；档位名作为专有名词，zh/en 两档界面均保持英文原文。映射表落在 core 的 provider 调用点
  （`llm.rs` 请求构造），按 provider
  分支。已知约束（实现期**须对真 API 核实**后定稿）：
  - kimi / deepseek 的参数名与取值以各家现行文档为准，档位集合按裁决对齐 Low/High/Max；某 provider
    无对应能力时按裁决点 2 置灰兜底。
  - 后续 OpenAI 系的 reasoning effort 参数以其现行文档为准。
- 档位状态存 core 会话侧（会话状态本来就在 core），前端 chip 经命令通道写入；新会话重置为 High
  （裁决点 1：不写回配置）。
- mock provider：fixture 可声明 reasoning 项（验收确定性）；mock 侧记录收到的程度参数供断言
  （落 fixture 回显或日志，实现期选更稳的一条）。

## 5. 一致性原则自检

本 change 是一致性原则（AI 可见的上下文对人必须也可查）的补全实例：reasoning 文本此前只对模型回放可见，
此后对人同样可见。反向也成立——不对人展示的（如 encrypted_content 密文本体）也不进 reasoning 事件，
前端永远只拿到明文思考文本。

## 6. 验收面（机器判定锚点）

1. 单测（Rust）：reasoning 事件构造与转发、程度映射表各 provider 分支、新会话重置默认。
2. 单测（前端）：思考块折叠默认/展开切换/多块排序/无思考不渲染/时长格式。
3. 真机验收场景：mock fixture 产出 reasoning → 思考块三态（折叠默认、展开见原文、时长在场）；
   切档位后下一轮 mock 收到对应程度参数。
4. 反向验证： fixture 不含 reasoning 时整条 agent 消息零思考块（断言块数为零，防恒真空转）。
