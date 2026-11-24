## ADDED Requirements

### Requirement: 消息摘录真机验收通道

使用真实 CGEvent 在 transcript 建立消息选区的验收场景 SHALL 按本轮窗口、fixture 与消息排版标定拖选线段，起点与终点 SHALL 落在目标消息正文文本几何内；窗口尺寸、fixture 或排版变化后 MUST 按本轮截图重新标定，MUST NOT 把落入消息间空白的拖选重试归因成产品选择器失效。选区是否建立 SHALL 继续由浮动「摘录到对话」钮的正观测独立判定，坐标调整 MUST NOT 删除或放宽该断言。

当 composer 采用 inline cards 时，输入定位 SHALL 使用当前 AXTextArea 的占位名与本轮注入文本组合，MUST NOT 依赖旧 tray 才会暴露的卡片角色名；动作内部 SHALL 通过注入前后文本计数变化证明输入落点。

#### Scenario: 消息排版变化后的真实拖选

- **WHEN** 121 在 mock 回答已渲染后执行真实拖选，且消息排版已改变正文行的位置
- **THEN** 按本轮截图把起终点重标定到同一 assistant 正文行内，再执行 CGEvent 拖选；只有浮动「摘录到对话」钮实际出现才算选区建立，几何、入卡、移除与再次摘录断言继续执行

#### Scenario: inline cards 后继续输入第二问

- **WHEN** 消息摘录卡已作为 composer 内 widget 插入，准备在卡片后的文本段落输入问题
- **THEN** typeInNode 通过占位名或本轮注入文本定位同一个 composer，且 N→N+1 回读成立；随后发送、transcript 同构与 `<msg-quote role at>` wire 断言继续执行
