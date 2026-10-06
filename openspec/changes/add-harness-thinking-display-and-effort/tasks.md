# Tasks: add-harness-thinking-display-and-effort

## 1. Rust core：reasoning 事件与程度参数

- [ ] 1.1 `events.rs` 新增 `reasoning_chunk` 事件（文本片段 + 块序号，信封沿用 ScopedSink vault 标识）
- [ ] 1.2 `turn.rs`/`llm.rs` 输出侧转发 reasoning 文本到新事件；回放路径（捕获/合成/回传）零改动
- [ ] 1.3 会话状态新增思考程度档位（Low/High/Max，默认 High——Alex 节点 1 裁决），新会话重置；命令通道写入档位
- [ ] 1.4 请求构造按 provider 映射三档到实际参数（参数名/取值对真 API 核实后定稿，design §4）
- [ ] 1.5 mock provider：fixture 支持声明 reasoning 项；记录收到的程度参数供断言

## 2. 面板：思考块渲染

- [ ] 2.1 agent 消息内渲染思考块（块在前、正文在后；多块按序号排列；无思考不渲染块）
- [ ] 2.2 折叠为默认（含流式期间）；展开态左边线 + 次级灰正文，全取 token 层现行值
- [ ] 2.3 时长显示（首 chunk 到末 chunk 墙钟差，轮次结束定格，「· N 秒」形态）
- [ ] 2.4 复制消息不含思考内容

## 3. 面板：思考程度 chip 与浮层

- [ ] 3.1 composer 控制行新增「思考：Low/High/Max」chip（模型 chip 后、ctx 读数前），点击弹浮层
- [ ] 3.2 浮层三个裸档位（Low/High/Max，zh/en 两档均保持英文原文）、无释义，当前档位带勾选（原型屏 10 形态）
- [ ] 3.3 provider 不支持时置灰禁用 + hover 说明「当前模型不支持思考程度调节」（Alex 裁决）
- [ ] 3.4 文案全部走 copy 表，新增读屏名

## 4. 验证

- [ ] 4.1 Rust 单测：事件构造/转发、映射表各分支、新会话重置默认、回放路径既有测试不红
- [ ] 4.2 前端单测：思考块四态 + 时长格式 + chip/浮层状态
- [ ] 4.3 新增真机验收场景（思考块三态 + 切档位参数断言 + 无 reasoning 零块反向验证），`run.mjs --check` 过
- [ ] 4.4 `scripts/gate.sh quick` 全绿；动到 `src/style.css` 则补 `visual` 档
