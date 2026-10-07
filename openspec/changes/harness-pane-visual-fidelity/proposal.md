# Proposal: harness pane 视觉保真还原

- Change ID: harness-pane-visual-fidelity
- 日期: 2026-10-06
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录：
> 节点 1（提案评审）：留白（待 Alex 裁决）。
> 节点 2（归档评审）：留白（实现完成后填写）。

## Why

Alex 2026-10-06 真机裁决（原话）：「现在版本类似我们做 pane 化之前我说的『像个 demo，很不好看，要重做 UX』的那个版本。粗糙、美观度为零。」

根因：原型退役（提交 `4e011d6`）时，合同只提取了行为与骨架，消息区 / composer 的视觉细节（meta 行、气泡、间距节奏、卡片容器）未进合同；`move-harness-to-pane-chat-frame` 实现继承了旧 dock 面板的粗糙样式，四轮评审按合同核验，合同没写就没人抓。流程沉淀已由 M352 落地（`docs/process/openspec-workflow.md` 的「视觉保真」提取规则）；本 change 是该规则的**首个执行者**——design 含逐屏视觉保真提取节。

验收口径（Alex 已采纳）：**观感一致 + 并排截图核对，不追求逐像素**——原型是独立 HTML，字体度量与数据内容与真机不同，逐像素在技术上不可达，追求它会逼出假对齐。

已裁决保留的行为取舍（本 change 不顺手改）：Enter 发送（非 ⌘⏎）、模型 chip 缺配置隐藏、会话历史列表不做、思考程度 chip 归提案 3、accent 去蓝走独立小 change。

**已裁决（2026-10-06，Alex）**：原裁决点 1（工具调用区形态）已裁——**还原原型屏 4 的「✓ 步骤清单」形态**，原「完成即折叠一行摘要」口径作废（Alex 原话：「采用原型那样的设计。我使用后会根据体验来改进。」）。本 change 按裁决实现，见 What Changes 第 5 条。

同批顺手修两个真机 findings（都与本 change 的 DOM 重构同面，单列反而制造冲突）：

- **错误 banner 堆叠**（finding `20261006-tower-bug-harness-pane.md` 的前端半）：Alex 真机同一错误堆了 6 条，无去重无替换。
- **浮层读屏不可达**（finding `20261006-worker-hp4-bug-chip-button-wkwebview-ax.md`）：模型 chip 的 provider 浮层与会话名浮层嵌在 `<button>` 内，WKWebView AX 树不暴露浮层项，「选择 + 写回」判据只能退到视觉层。

## What Changes

每条对应 specs/ 增量中的 requirement：

1. **消息区视觉还原**（`harness` ADDED「消息呈现」）：每条用户 / agent 消息带角色 + 相对时间 meta 行（原型 `.who`/`.when`，如「你 · 12 秒前 / Agent · 刚刚」）；用户消息恢复描边气泡（content-bg + border-soft + r6，正文 text-2）；agent 消息平铺排版；transcript 间距节奏对齐原型。相对时间 live 路径由前端在上屏时打戳、快照恢复路径消费后端 `PanelMessage.ts`（M353 已合并）、低频刷新；无时间戳的旧快照 SHALL 省略相对时间（不伪造读数）。
2. **composer 视觉还原**（`harness` MODIFIED「对话面板」）：composer 与控制行收进圆角卡片容器（原型 `.h-box`：content-bg + border + r8，focus-within 出 accent 框，eink 加粗线宽）；控制行在容器底（模型 chip 无边框小标签形态 + ctx 读数 + 发送钮）；发送钮恢复图标形态（26×26 accent 实心，↑ / ■ 两态 glyph，读屏名与悬停沿用 D329/D378）。行为口径不动：Enter 发送、发送/停止两态、模型 chip 缺 `[harness].providers` 配置隐藏。
3. **错误呈现去重**（`harness` ADDED「错误呈现」）：transcript 错误行同文案 SHALL 就地替换（更新原行），SHALL NOT 追加堆叠。
4. **浮层可访问性**（`harness` ADDED「浮层可访问性」）：provider 浮层与会话浮层 SHALL 对辅助技术可达——挪出 `<button>`（wrapper 兄弟结构）并补 `role="menu"` / 菜单项语义与 `aria-haspopup` / `aria-expanded`；Escape SHALL 先收浮层再收面板。修复后真机场景 90 的「选择 + 写回」判据从视觉层升回行为层。
5. **工具调用区还原**（`harness` ADDED「工具调用呈现」，Alex 2026-10-06 已裁）：工具调用按原型屏 4 的清单形态呈现——进行中在当前 agent 消息内挂 hairline 夹区的步骤清单（运行中行带脉冲点、完成行带 ok 色 ✓ 与结果摘要）；轮次结束后多条目（≥2 行）折叠为一行摘要钮（「N 个工具调用 · 全部完成」），点击可展开回看。

## Alex 裁决点

| # | 裁决点 | 起草倾向 |
|---|---|---|
| ~~1~~ | ~~工具调用区形态~~ | **已裁（2026-10-06）**：还原原型屏 4 清单形态，见上 |
| 2 | 相对时间的分档口径 | **刚刚（<10s）/ N 秒前 / N 分钟前 / N 小时前 / 昨天**（原型实例值反推；en 对应 just now / N sec ago / N min ago / N hr ago / yesterday）。快照恢复的历史消息无时间戳 → 只显示角色不显示时间（不伪造） |
| 3 | 发送钮形态：图标钮（原型）还是文字钮（现状） | **图标钮**（原型形态：26×26 accent 实心、↑ / ■ glyph）；D329「发送」/ D378「停止」退为悬停提示与读屏名——真机场景靠 AX 名断言（`AXButton (发送)`），行为层判据不受影响 |

## Non-goals

- **accent 族 token 中性化（去蓝）**：独立小 change（前批裁决点 4 已定路由），本 change 消费现行 token 取值。
- **思考过程呈现与思考程度 chip**：归提案 3（`add-harness-thinking-display-and-effort`，在途）。
- **会话历史列表**（原型屏 7 的最近会话）：节点 1 已裁不做。
- **发送时隐式建会话 / new_session 幂等的后端修复**：归 M350（finding 的后端半）；本 change 只新增其端到端验收场景（依赖 M350 合并后跑真机）。
- **键位新增**（原型 ⌘⇧N 等）：沿用「快捷键后续专项治理」方针。
- **批准闸、压缩标记、工具集、权限规则**：沿用现状。

## Impact

- 影响的 specs：`harness`（ADDED ×3：消息呈现 / 错误呈现 / 浮层可访问性；MODIFIED ×1：对话面板）
- 影响的代码/系统：src（`harness-panel.ts` DOM 重构、`harness-panel.css` 消息区 / composer / 工具调用区样式重写、`copy-data.ts` 新文案 D385–D387）、tests/visual（m347 场景断言按新 DOM 修正；新增 m351 场景钉消息区 / composer / 工具调用区结构与元素级基线；m303 / m345 等含 harness pane 的整页基线失效，按「候选三联图 Alex 过目后入库」纪律重建）、tests/unit（相对时间纯函数单测）、scripts/acceptance（场景 90 判据升回行为层 + 新增 92-new-session 幂等场景 + 场景 75 按折叠形态改判据 + 70-91 按新 DOM 核对）、文案-Copy.md 同步
- 关联约束：ADR 0002 §6 性能合同（相对时间刷新为 30s 低频定时器，不在 keypress-to-paint 路径）；ADR 0004 两节点硬门禁；M350 依赖（场景 92 的真机 PASS 须在其合并后）；M352 的「视觉保真」提取规则（本 change 是首个执行者）
