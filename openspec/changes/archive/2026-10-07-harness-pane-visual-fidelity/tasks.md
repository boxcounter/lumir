# Tasks: harness-pane-visual-fidelity

> 勾选纪律：每条括注证据（文件:行 / 单测名 / 场景名 / 门禁输出）；拿不出证据的不勾。

## 1. 消息区视觉还原

- [x] 1.1 消息结构重构：`.lumir-hp-msg` 内分 who 行 + body 体；用户气泡样式移挂 body（r6 / content-bg / border-soft / 正文 text-2）；Markdown 节奏选择器改挂 body；流式渲染（md-final / md-tail / finalize）改作用于 body　**证据**：src/harness-panel.ts:1799（createWhoLine）/1838（appendUserMessage blocks+body）/2103（ensureStreamingMessage who+body）；src/harness-panel.css:229/239（who/when）、249（`.lumir-hp-msg-user > .lumir-hp-body`）；m351 spec 用例 1 计算样式断言（tests/visual/scenes/m351-harness-visual-fidelity.spec.ts:103）
- [x] 1.2 who/when meta 行：角色（你 / Agent）+ 相对时间（`relativeWhen` 纯函数 + 30s 低频刷新 + relabel 同出口）；快照恢复消息无戳不显示时间　**证据**：src/harness-panel.ts:596（relativeWhen 导出）/1819（refreshWhoLines）/2259（messageTs，M353 `ts` 字段消费）/2652（30s 定时器起清）；单测 tests/unit/harness-panel-control.test.ts 尾部 8 条边界用例（9s/10s/59s/60s/59min/60min/23h/24h/未来戳 clamp × zh/en）；`node tests/unit/run.mjs` 660 pass 0 fail
- [x] 1.3 transcript 节奏对齐原型（底 padding sp-2）；用户消息正文 text-2　**证据**：src/harness-panel.css（transcript 底 padding 块 + :249 text-2）；m351 用例 1 探针断言 transcript padding-bottom = 2px

## 2. composer 视觉还原

- [x] 2.1 圆角卡片容器 `.lumir-hp-composer-box`（content-bg + border + r8 + focus-within accent，eink 加粗线宽）；composer 去自身边框；控制行 `.lumir-hp-ctl` 收进容器底　**证据**：src/harness-panel.ts:1014-1019（composerArea/composerBox/ctl 装配）；src/harness-panel.css:628/634/637（含 eink 1.6px 分叉）/641；m351 用例 3 容器 + focus-within 断言
- [x] 2.2 模型 chip 改无边框小标签形态（24px / r5 / fs-label-s + chevron）；ctx 读数对齐原型（fs-label + 数值 text-2 分档）；ⓘ 气泡宽 224px　**证据**：src/harness-panel.css:660/682/689（chip）、799（ctxpop 224px）；m347 spec 读数断言（tests/visual/scenes/m347-harness-composer.spec.ts:156/166/186）。**偏差登记**：ctx 数值未拆独立 span 分档上色——fs-label 整行同色，分档色（warn/over）既有口径保留在行级类上，见「已知未闭环」
- [x] 2.3 发送钮图标化：26×26 实心，↑ / ■ 两态 SVG glyph 按相位显隐；D329/D378 退 title/aria-label（AX 名断言不变）；busy 态配色与脉冲环**按原型继承**（M356，Alex 2026-10-07 裁决「按照原型做，包括按钮颜色」，推翻此前 tower 的「选 b」记档，M347 danger 实心退役）——配色按原型 accent-fill 三主题值落组件级变量（浅 #38372f+白 glyph / 深 #c7c6bd+深 glyph #222326 / eink 纯黑，不改全局 --accent），busy 加 box-shadow 0→3px 呼吸环（--pulse-cycle 1.6s），环色中性 tint（非产品蓝 --accent-tint），eink 环不可见 glyph 承担状态　**证据**：src/harness-panel.ts（send-go/send-stop 两枚 SVG，`toggleAttribute("hidden")` 切换）+ src/harness-panel.css（`.lumir-hp-send` 26×26 r6、组件级 `--lumir-hp-send-fill/-fill-text/-tint` 三主题值、`svg[hidden]{display:none}`、`.is-busy` → `lumir-hp-send-pulse` 动画 + prefers-reduced-motion 停脉冲）；m347 spec glyph 显隐 + aria-label 两态断言（:191-225）照旧绿；m351 spec 发送钮配色组件变量断言 + busy 脉冲环（动画名 + tint）断言（tests/visual/scenes/m351-harness-visual-fidelity.spec.ts composer 用例）；真机场景 88 两态断言照旧 PASS

## 3. 错误呈现去重

- [x] 3.1 `appendError` 同文案就地替换不堆叠；`resetView` 清引用　**证据**：src/harness-panel.ts:2008（lastErrorEl/lastErrorText + transcript.contains 复核，同文案滚回视野不追加）/2347（resetView 清引用）

## 4. 浮层可访问性

- [x] 4.1 provider 浮层与会话浮层挪出 `<button>`（wrapper 兄弟结构）+ `role="menu"` / 菜单项语义 + `aria-haspopup` / `aria-expanded`　**证据**：src/harness-panel.ts:945/1025（sessionwrap/modelwrap）/969-984（sessPop menu+menuitem）/1039-1044 + 1635-1656（modelPop menu+menuitemradio+aria-checked）
- [x] 4.2 Escape 两段式：先收浮层再收面板　**证据**：src/harness-panel.ts:2602-2608（seg 上 Escape 收 sessPop + stopPropagation）/2629-2631（panel 上先收 modelPop/ctxPop 再 togglePane）
- [x] 4.3 真机场景 90：「选择 + 写回」判据从视觉层升回行为层（AX 点浮层项 + chip 读屏名变更 + env config.json 写回断言）　**证据**：scripts/acceptance/scenarios/90-harness-model-chip.md 重写（浮层项 AX 断言 → 点 kimi → chip 读数翻 + `env:config.json has '"provider": "kimi"'`）；`run.mjs --check` 94 场景全 PASS；真机 PASS 见 6.2

## 5. 验收与基线

- [x] 5.1 新增真机场景 92「连续点新会话幂等不报错」（依赖 M350 合并后跑）；70-91 既有场景按新 AX 树复核修正　**证据**：scripts/acceptance/scenarios/92-harness-new-session-idempotent.md（新建；M350 已并入 master 88b6cea）；75 加展开步（见 5.4）；76/87/88/91/78 逐一核过不受新 DOM 影响；71/72/77 单工具不折叠断言不动；`run.mjs --check` 94 PASS；真机批次结果见 6.2
- [x] 5.2 m347 视觉场景按新 DOM 修断言；新增 m351 场景（消息区 + composer 结构断言 + 元素级基线）　**证据**：tests/visual/scenes/m347-harness-composer.spec.ts（composer-box/ctl 子序列、glyph 显隐）；tests/visual/scenes/m351-harness-visual-fidelity.spec.ts 4 用例（消息区探针 + 快照恢复 ts 两路径 + composer + 工具清单）；m303 spec 发送钮断言改 aria-label + glyph（:97-101）；LUMIR_VISUAL_STRUCTURAL=1 下 m347+m351 5/5 passed；像素层 3 spec 10/10 passed
- [x] 5.3 失效基线重建：候选三联图（原型 / 旧基线 / 新实现）交 tower 给 Alex 过目，**过目前禁止入库**；dock/标题栏相关整页基线时间戳逐张核对　**证据**：候选已生成未 git add（harness-panel-open / m345-harness-quote-card / m345-quote-jump-flash 3 张修改 + m351 2 张新增；titlebar-with-harness-toggle 逐字节不变无 diff——标题栏未受 M351 影响）；候选就位后全量视觉回归（像素层）607 passed / 0 failed；证据包主仓 test-results/m351/（expected/actual/diff 三联 ×3 + m351 候选 ×2 + 原型屏 4-10 截图 ×7）；**待 TowerSend 交 Alex 裁决后入库**
- [x] 5.4 工具调用区还原（Alex 2026-10-06 已裁）：步骤清单块（running 脉冲行 / done ✓ 行，挂 agent 消息内）+ 轮次结束 ≥2 行折叠摘要钮可展开；场景 75 判据改「展开后断言」　**证据**：src/harness-panel.ts:1905（ensureToolsBlock）/1920（collapseTools，≥2 折叠 + data-count）/1954（relabelToolSummaries）/1964（appendToolCall running/done 行）；src/harness-panel.css:374-458（含 eink steps(2) 脉冲分叉、chevron 90°）；m351 用例 4；场景 75 展开步（`target name: "个工具调用 · 全部完成"` → 两条工具行断言）

## 6. 文案与门禁

- [x] 6.1 新可见文案 zh/en 双档（D385/D386 角色 ×2、D387 工具折叠摘要；相对时间复用 D100.1 + Intl 不占新号）+ 文案-Copy.md 同步；D329/D378 备注更新（图标钮的悬停/读屏名口径）　**证据**：src/copy-data.ts D385/D386/D387（formatRelative 加第 4 参 `style`，relativeWhen 传 "narrow"）；文案-Copy.md D385-D387 行 + D329/D378 行备注 + 沿革段 M351 取号记录；deck 漂移门禁 PASS（gate quick docs-check 行）
- [x] 6.2 `scripts/gate.sh quick` 全绿 + `openspec validate --all --strict` 通过 + 真机批次 PASS　**证据**：gate quick 10/10 PASS（含 cargo-test / tsc ×3 / unit-tests 660 / docs-check / openspec-validate / bindings-drift）；openspec validate harness-pane-visual-fidelity --strict（@fission-ai/openspec@1.12.0）通过；真机批次 70-92：首跑 20/23（77/90/92 三处场景断言口径问题——77 漏判双工具折叠、90/92 踩 WKWebView haspopup→AXPopUpButton 映射，非产品缺陷），修正后复跑 3/3 ⇒ 合计 23/23 PASS（证据 test-results/acceptance/2026-10-06/，含 90 的浮层项 AX 可达 + config 写回逐字断言、92 的幂等三连点）

## 已知未闭环（交给后续动作）

1. **tool-meta 行（阶段 + 已进行秒数 + 不定态条）不继承**（design §2.4 有意偏差）：原型屏 4 的「调用工具中 已进行 12 秒」行与 M347 进度条区（阶段行 + 不定态进度条）功能重叠，不重复造；Alex 使用后若想要原型形态再立 change。
2. **单行工具调用不折叠**（阈值 ≥2）：唯一一行本身就是信息，折叠反而藏信息；阈值是否合用待 Alex 体验反馈。
3. **ctx 数值分档色未拆 span**：warn/over 分档色在既有行级类上（M347 口径），原型的数值/标签双色未逐像素继承——观感差异极小，Alex 过目候选基线时一并裁决。
4. **pending 空心行不实现**：原型有「待执行」空心步骤行，但后端协议无 pending 事件源（started/done 二态），硬造会失真。
5. **思考程度浮层（原型屏 10）不在本 change**：产品无思考档位功能，原型屏 10 是占位演示。
