# Tasks: move-harness-to-pane-chat-frame

## 1. 容器改造：harness 归位 pane，dock 移除

- [ ] 1.1 装配层：harness 面板挂载从 dock 列改为 pane 内容件（面板接口不动，ADR 0008 survey 的窄接口口径）；`⌘⇧A` 与标题栏 toggle 钮语义改「在旁侧 pane 打开/收起」（无第二 pane 自动分栏、默认 1:2；已有第二 pane 则其标签并入另一 pane 后换位）
- [ ] 1.2 dock 列移除：`--layout-dock-w`、`.dock-open`、骨架 grid 第三列及关联代码清扫
- [ ] 1.3 空 pane 只读条款显式排除 harness pane；pane 命令族对 harness pane 的语义（close = 关 harness、other 可切、split 无操作）
- [ ] 1.4 `harness_pane` 字段消费：按 vault 恢复面板在场（空会话）；旧版会话文件按 false 兼容

## 2. 标题栏

- [ ] 2.1 harness 段：会话名下拉（含新建会话动作项）+ 新建会话钮；段宽按 pane 实际宽度装配层现算、与分隔条像素对齐
- [ ] 2.2 会话名：首条用户消息截断（约 20 字；未发消息显示「新会话」）——裁决点 2 倾向 A 口径
- [ ] 2.3 产品标识块移到 traffic 灯区（系统按钮旁）；窄窗 <640px 退让条款与双 pane 右簇退让条款相应修订（标识块不再退 modeline，toggle 钮双 pane 隐藏保留）

## 3. composer 控制行

- [ ] 3.1 模型 chip：列出 `[harness].providers` 已配置 provider，选择经 `config_set_value` 写回、下一轮生效；chip ellipsis + hover 全名
- [ ] 3.2 ctx% 读数迁入控制行；超阈值高亮 + ⓘ 钮气泡（向上展开、右缘对齐）；常驻警示句移除；自动压缩与压缩标记不变

## 4. 发送/停止、复制、进度

- [ ] 4.1 发送钮两态 + Rust core 中断 in-flight 轮次（已产出保留并标注「已停止」、待决批准项收回、JSONL 记录中断）；停止后可继续提问
- [ ] 4.2 复制消息：hover 浮现钮、复制 Markdown 源文本、成功就地将息反馈
- [ ] 4.3 不定态进度条 + 阶段指示（无百分比）；工具调用完成即折叠一行摘要；eink 明度/线宽表达

## 5. 文案与文档

- [ ] 5.1 文案表 zh/en 双档（harness 段、模型 chip、ⓘ 气泡、已停止标记、复制反馈、阶段指示等全部新可见文案）+ 文案-Copy.md 同步

## 6. 验证

- [ ] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 6.2 真机验收：⌘⇧A 分栏/收起不丢标签、harness_pane 往返恢复、ctx% 位置与 ⓘ 气泡、停止中断（mock 长流）、复制（clipboard 断言）、模型写回；既有 dock 场景改写 pane 口径
- [ ] 6.3 视觉：dock 移除 / 标题栏 / 控制行 / 进度态基线批次末一次性重建（Alex 过目后 --update）；dock 元素相关整页基线时间戳逐张核对
- [ ] 6.4 `scripts/gate.sh quick` + `visual` 全绿
