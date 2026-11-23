# Design: Harness 阅读排版与任务信息可读性

## 1. 合同来源与验证边界

唯一调研输入是主仓 `.local/reports/harness-typography-nov23/`：`README.md`、`probe.spec.ts`、
`metrics.json`、`manifest.json` 与 195 张合成 fixture 截图。推荐组合是 `refined-rows-720`。

- Chromium：1200×800 / 1800×900 / 2400×1000 × light / dark / eink × 五候选，45 组；退出码 0。
- 45/45 组 transcript 无横溢且可纵滚到底，长代码均可局部横滚；窄 pane 宽表可局部横滚。
- WKWebView：86 / 97 / 218 / 234 / 152 / 72 / 711 / 719 八场景实际运行，**7/8 PASS，退出码 1**。
  候选 CSS 没有注入真机，所以这些截图只是现行产品参照，不是候选真机验收。
- 152 的两条 FAIL 来自连续 `你 · N秒前` / `Agent · N秒前` 正则；真实 AX 为角色节点与相邻时间节点。
  本设计不把这个失败改名成 PASS，也不把它归因于排版。

## 2. 候选实际 CSS（与探针一致）

以下只作为实施合同，不是本提交对产品的修改。字号继续消费 `--lumir-hp-scale`；默认 scale=1 时的
15px / 13px / 12.5px / 12px 都来自既有 token。`--layout-review-measure` 已是 720px，不新增字面值真源。

```css
.lumir-hp-transcript {
  padding: var(--sp-8) var(--sp-8) var(--sp-6);
  gap: var(--sp-8);
  font-size: calc(var(--fs-body) * var(--lumir-hp-scale, 1));
  line-height: var(--lh-chat);
}
.lumir-hp-composer-area { padding: var(--sp-3) var(--sp-8) var(--sp-8); }
.lumir-hp-who { margin-bottom: var(--sp-2); }
.lumir-hp-role { color: var(--text-2); }
.lumir-hp-when { color: var(--text-3); }
.lumir-hp-msg-user > .lumir-hp-body { padding: var(--sp-4) var(--sp-6); }
.lumir-hp-msg-assistant .lumir-hp-body p,
.lumir-hp-msg-assistant .lumir-hp-body ul,
.lumir-hp-msg-assistant .lumir-hp-body ol,
.lumir-hp-msg-assistant .lumir-hp-body pre,
.lumir-hp-msg-assistant .lumir-hp-body blockquote,
.lumir-hp-msg-assistant .lumir-hp-body table,
.lumir-hp-msg-assistant .lumir-hp-body .lumir-hp-block-slot { margin: var(--sp-4) 0; }
.lumir-hp-msg-assistant .lumir-hp-body > :first-child,
.lumir-hp-msg-assistant .lumir-hp-body .lumir-hp-block-slot:first-child { margin-top: 0; }
.lumir-hp-msg-assistant .lumir-hp-body > :last-child,
.lumir-hp-msg-assistant .lumir-hp-body .lumir-hp-block-slot:last-child { margin-bottom: 0; }
.lumir-hp-msg-assistant .lumir-hp-body .lumir-hp-block-slot > .lumir-hp-codeblock,
.lumir-hp-msg-assistant .lumir-hp-body .lumir-hp-block-slot > .lumir-hp-table-scroll,
.lumir-hp-msg-assistant .lumir-hp-body .lumir-hp-block-slot > .lumir-hp-table-scroll > .lumir-hp-table { margin: 0; }
.lumir-hp-msg-assistant .lumir-hp-body ul,
.lumir-hp-msg-assistant .lumir-hp-body ol { padding-left: var(--sp-10); }
.lumir-hp-msg-assistant .lumir-hp-body li + li { margin-top: var(--sp-1); }
.lumir-hp-msg-assistant .lumir-hp-body li p { margin: var(--sp-2) 0; }
.lumir-hp-msg-assistant .lumir-hp-body { overflow-wrap: anywhere; word-break: normal; }
.lumir-hp-codeblock { padding: var(--sp-5) var(--sp-6); border-radius: var(--r8); }
.lumir-hp-tool-row { height: auto; min-height: 28px; }
.lumir-hp-approval { padding: var(--sp-5) var(--sp-6); }
.lumir-hp-approval-purpose,
.lumir-hp-approval-basis,
.lumir-hp-approval-note,
.lumir-hp-diff,
.lumir-hp-argv,
.lumir-hp-reason { margin-bottom: var(--sp-4); }
.lumir-hp-approval-actions button { min-height: 32px; padding-inline: var(--sp-6); }
.lumir-hp-composer {
  min-height: 48px;
  padding: var(--sp-5) var(--sp-6) var(--sp-2);
  font-size: calc(var(--fs-body) * var(--lumir-hp-scale, 1));
  line-height: var(--lh-chat);
}
.lumir-hp-composer.is-empty::before { top: var(--sp-5); left: var(--sp-6); }
.lumir-hp-empty {
  padding: var(--sp-10);
  color: var(--text-2);
  font-size: calc(var(--fs-ui) * var(--lumir-hp-scale, 1));
  line-height: var(--lh-chat);
}
.lumir-hp-msg-assistant .lumir-hp-body table {
  font-size: calc(var(--fs-ui) * var(--lumir-hp-scale, 1));
  line-height: var(--lh-ui);
}
.lumir-hp-table th,
.lumir-hp-table td {
  padding: var(--sp-3) var(--sp-5);
  border: 0;
  border-bottom: 1px solid var(--border-soft);
}
.lumir-hp-table th { border-bottom-color: var(--border); }
.lumir-hp-transcript > .lumir-hp-msg { max-inline-size: var(--layout-review-measure); }
.lumir-hp-approval-sub,
.lumir-hp-approval-basis,
.lumir-hp-approval-note,
.lumir-hp-tool-out,
.lumir-hp-stage,
.lumir-hp-composer.is-empty::before { color: var(--text-2); }
```

实施时应修改现有声明，不附加一套长期覆盖层。上述选择器沿用现有 DOM，不要求产品 TS 改动。若现有
CodeMirror composer 的内部行盒还需要同步，只能在同一 `.lumir-hp-composer` 作用域内完成，且不得改文本
状态、选区、IME 或键位。

### 2.1 面板表格与全屏快照的作用域边界

13px/1.5 只由 `.lumir-hp-msg-assistant .lumir-hp-body table` 承担，因此只作用于 Harness 面板内的表格。
全屏深克隆 `<table>` 后脱离这条 body 祖先链，继续由 `.lumir-table-fs-snapshot` 消费
`--editor-font-size`，默认档为 15px；本 change MUST NOT 给全屏补 13px，也不改变其编辑器缩放语义或
全屏专属布局。

`.lumir-hp-table th/td` 的横线与 6/10px padding 挂在共享结构类上，会随克隆进入全屏。验收必须拆成两组：
面板断言 13px/19.5px；全屏断言 `--editor-font-size`、共享横线 / padding、快照内容、固有宽和开关行为。
报告中的 45 组面板截图不构成全屏候选证据，实施必须单独跑全屏结构场景。

## 3. 几何与排版合同

### 3.1 默认 scale=1 的计算值

| 表面 | 合同值 |
|---|---|
| transcript | 15px / 23.7px；padding `16px 16px 12px`；gap 16px |
| 普通块 | margin 8px 0；首末块相应外边距 0 |
| 列表 | padding-left 24px；`li + li` margin-top 2px；项内段落 margin 4px 0 |
| 用户气泡 | padding 8px 12px；其余气泡配方不变 |
| meta 行 | 10.5px；margin-bottom 4px；角色 `--text-2`、时间 `--text-3` |
| 代码块 | 12.5px / 19.375px；padding 10px 12px；radius 8px |
| Harness 面板表格 | 13px / 19.5px；cell padding 6px 10px；仅底边横线 |
| 全屏表格快照 | 继续 `--editor-font-size`（默认 15px）；既有全屏布局与缩放语义不变；共享横线和 6/10px cell padding |
| 工具行 | 12px；min-height 28px；height auto |
| 批准卡 | padding 10px 12px；指定决策段 margin-bottom 8px |
| 批准按钮 | min-height 32px；padding-inline 12px |
| composer | 15px / 23.7px；min-height 48px；padding 10px 12px 4px |
| composer 外侧 | padding 12px 16px 16px |
| placeholder | top 10px；left 12px；`--text-2` |
| 空态 | 13px / 20.54px；padding 24px；`--text-2`；现有居中布局不变 |

非默认缩放只缩放字号及其行高计算结果；固定 token 间距、28 / 32 / 48px 控件尺寸和 720px 阅读宽不随
缩放倍率二次放大。`⌘0` 后两面仍回各自基线。

### 3.2 720px 是上限，不是布局重写

消息宽公式为 `min(消息可用宽, 720px)`。消息左缘与 transcript 内容左缘一致（±1px），MUST NOT 使用
`margin-inline:auto` 或把用户消息右对齐。`.lumir-hp-transcript > .lumir-hp-msg` 是唯一宽度作用点；
`.lumir-harness`、pane、`.lumir-hp-composer-area` 与 `.lumir-hp-composer` 不获得该上限。

| 视口 | 无上限候选正文宽 | 720 候选正文宽 | 实施断言 |
|---|---:|---:|---|
| 1200×800 | 448.5px | 448.5px | 上限不触发；与无上限候选差 ≤1px |
| 1800×900 | 748.5px | 720px | 钳到 720px；左缘不变 |
| 2400×1000 | 1048.5px | 720px | 钳到 720px；左缘不变；composer 宽仍 >720px |

### 3.3 溢出归属

- 九组均要求 `transcript.scrollWidth === transcript.clientWidth`，纵滚设置到底后实际 `scrollTop > 0`。
- 长代码必须先满足 `code.scrollWidth > code.clientWidth`，再写 `scrollLeft=120` 并断言读数 >0。
- 窄 pane 宽表先满足 `tableScroll.scrollWidth > tableScroll.clientWidth`，再写 `scrollLeft=120` 并断言
  读数 >0；1800 / 2400 下同一合成表不溢出是既有固有宽合同的正确结果，不得为制造滚动而拉宽表。
- 正文长 URL 由 `overflow-wrap:anywhere; word-break:normal` 承担；表格 URL 仍由固有宽与局部横滚承担。
- 不新增 overflow 容器，因此滚动条注册表与三档归属不变。若实现意外新增容器，先停止并回写设计。

## 4. 对比度合同与实测依据

机器判据分两层：元素颜色必须等于指定 token；按实际计算前景与合成背景计算 WCAG 相对对比度。
任务型次级文字 ≥4.5:1，用户气泡正文 ≥7:1。缺元素、缺背景或颜色不可解析一律 FAIL，不按空串跳过。

| 文本 | 当前 light / dark / eink | `refined-rows-720` light / dark / eink | 合同 |
|---|---:|---:|---|
| 用户气泡正文 | 13.178 / 10.170 / 21.000 | 不变 | ≥7:1 |
| Agent 角色 | 2.252 / 2.655 / 5.099 | 4.915 / 5.832 / 10.862 | `--text-2`，≥4.5:1 |
| 批准依据 | 2.375 / 2.529 / 5.099 | 5.183 / 5.556 / 10.862 | `--text-2`，≥4.5:1 |
| 工具尾注 | 2.252 / 2.655 / 5.099 | 4.915 / 5.832 / 10.862 | `--text-2`，≥4.5:1 |
| composer placeholder | 2.375 / 2.529 / 5.099 | 5.183 / 5.556 / 10.862 | `--text-2`，≥4.5:1 |

批准副句与后果、运行提示、空态与上表同取 `--text-2`，按各自实际背景断言同一阈值。时间仍取
`--text-3`，不纳入“所有文字必须 ≥4.5”的错误泛化。

## 5. Chromium 三主题 × 三宽度验收矩阵

新增 `tests/visual/scenes/harness-typography-nov23.spec.ts`，复用报告中的合成消息结构：长段落、三级列表、
长 URL、长代码、宽 / 窄表、完成工具行、待决批准卡与 composer。九组均执行结构断言；每组再用
`expectScreenshot(page.locator(".lumir-harness"), …)` 留一张候选元素基线。

| 视口 | 主题 | 每组共同断言 | 宽度专项 |
|---|---|---|---|
| 1200×800 | light / dark / eink | §3.1 全部计算值；角色 / 时间 token；任务文字 ≥4.5；用户正文 ≥7；transcript 无横溢；代码局部横滚；工具 / 批准 / composer 控件在面板内 | 消息约 448.5px；宽表局部横滚；次级长动作不裁切 |
| 1800×900 | light / dark / eink | 同上；同一宽表不强制溢出 | 消息 720px 左对齐；composer 不封顶 |
| 2400×1000 | light / dark / eink | 同上；同一宽表不强制溢出 | 消息 720px 左对齐；composer 实际宽 >720px |

另有三组不进九格计数但必须同 PR 覆盖：

1. **非默认 scale**：正文 / composer / 表格 / 代码 / 工具按倍率变化，行高比不变，720px 与固定间距不变。
2. **空态与运行态**：空态合同与阶段提示 `--text-2`；报告未单独覆盖空态综合图，实施必须补场景图。
3. **交互回归**：代码复制与全屏、批准采纳 / 拒绝、工具折叠、长次级动作、composer 输入与发送沿用现有
   场景；表格全屏另按 §2.1 拆成面板 13px/19.5px 与全屏 `--editor-font-size` 两组断言，不能用同一个
   WHEN/THEN 把二者都写成 13px，也不能因换 CSS 改行为断言来换绿。

像素断言必须经 `expectScreenshot`，CI 结构模式只跳过像素、不跳过上述计算属性与几何断言。新增小元素的
存在性不能只靠像素容差判定。

## 6. 真机八场景与 152 前置复用

实施后在真实 WKWebView 复跑：

| 场景 | 排版相关验收点 |
|---|---|
| 86-harness-pane-toggle | 空态、composer 与 pane 开合；720px 不改变 pane 布局 |
| 97-harness-stream-visible | 流式正文、阶段提示、停止收口；滚动行为不变 |
| 218-harness-bubble-and-scrollbar | 三主题气泡、正文与代码局部横滚；用户正文 ≥7:1 的截图参照 |
| 234-harness-table-horizontal-scroll | 横线表、固有宽与真实横向滚轮；末列可达 |
| 152-harness-transcript-link-and-time | 长链接与恢复消息；角色 / 时间分色；消费前置 `metaLine` 判据 |
| 72-harness-patch-approve | 批准卡、按钮、diff 与采纳行为 |
| 711-harness-retry-tools | 工具尾注、错误与重试动作 |
| 719-harness-retry-approval | 批准依据 / 后果、第二次批准与完成态 |

152 不再由本 change 实现。`test/harness-transcript-time-ax-nov23` 的 `6575e753` 已加入 `metaLine` 执行器、
相邻节点判定和单测，tip `ede07e8400f30f6418385ea2718847a02afecaf4` 已把恢复档时间集合收窄为
`N秒前 / N分钟前 / N小时前`（含 `0秒前`），并用「刚刚 / 昨天必须 FAIL」防判据弱化。本 change 只确认该
tip 已前置或同批合并，再复跑八场景；不得复制或改写第二份 AX 执行器、单测和场景判据。

该分支场景文档明确记录“改断言后的真机复跑尚未执行”，所以前置代码存在不等于真机 PASS。原始调研仍是
7/8 PASS、退出码 1；最终 summary 必须照抄本次 runner，若仍有 FAIL 就报告 FAIL 数与退出码，不预写 8/8。

真机 AX 不提供可靠 CSS 几何，字号、宽距、scrollWidth 与对比度的机器判定归 Chromium；真机保留行为断言
和截图证据，不把截图目检包装成自动 PASS。

## 7. 三项 change 的有序链与承接门禁

顺序固定为 `fix-harness-approval-visibility-nov23` → `refine-harness-typography-nov23` →
`move-harness-progress-to-output-tail-nov23`，不是可并行施工的三份样式草案。

| 时点 | 硬门禁与承接 |
|---|---|
| 本 change 施工前 | `fix-harness-approval-visibility-nov23` 已归档且 `--archived` PASS；152 的 `ede07e84` 已前置或同批合并。未满足不得修改产品或测试代码 |
| 前置 → 本 change | 前置阶段行 `--text-3` 由本 change 升为 `--text-2`；待批优先级和阶段文案不动。gap 8→16px，transcript padding `8/8/4`→`16/16/12px` |
| 本 change 落地时 | 空态仍用 `margin:auto`，只改 13px/1.58、`--text-2`、24px padding；不提前执行尾行 change 的绝对定位或移动进度区 |
| 本 change → 尾行 change | 本 change 已归档且 `--archived` PASS，候选基线经 Alex 批准并落盘；尾行 change 以新的 living spec / CSS / idle 基线为重基线，未满足不得施工 |
| 尾行颜色与间距 | 继承阶段行 `--text-2`，不得恢复 `--text-3`；若仍取 2px 净间距，margin 从旧 `calc(var(--sp-2) - var(--sp-4))` 改为 `calc(var(--sp-2) - var(--sp-8))` |
| 尾行空态 | 仅在尾行 change 中改为绝对定位；四边取 `top/right/left:var(--sp-8); bottom:var(--sp-6)`，继承 13px/1.58、`--text-2`、24px padding，不再使用旧 `8/8/4px` 偏移 |
| 尾行基线 | 其“idle 零漂移”只相对本 change 后的新 idle 基线成立；不得把本 change 的空态 / composer 像素变化误记为尾行回归，也不得借零漂移恢复旧值 |

尾行 change 的 proposal / design / spec delta 在施工前必须回写上述承接值；本 change 不直接修改另一 worktree
的提案文件，但把这些内容作为其开工硬门禁。

## 8. 基线影响清单

本节是实现期的**候选清单**，不是授权更新。先跑结构与本地全量视觉门禁、生成 actual / candidate，再由
Alex 逐张过目；批准后才允许统一 `--update`。禁止零碎更新和改容差。

### 8.1 预计变化的既有基线（7 张）

| 基线（均位于 `tests/visual/baselines/`） | 变化来源 |
|---|---|
| `m351-harness-visual-fidelity.spec.ts-snapshots/m351-harness-messages-chromium-darwin.png` | 正文字号 / 行高、消息节奏、气泡 padding、角色色 |
| `m351-harness-visual-fidelity.spec.ts-snapshots/m351-harness-composer-chromium-darwin.png` | 外侧 / 输入 padding、15px/1.58、48px 最小高、placeholder |
| `m303-harness-panel.spec.ts-snapshots/harness-panel-open-chromium-darwin.png` | 空态与 composer 所在整页 |
| `persistence-health-nov23.spec.ts-snapshots/harness-degraded-chromium-darwin.png` | 空态与 composer 所在整页 |
| `persistence-health-nov23.spec.ts-snapshots/harness-history-gap-chromium-darwin.png` | 同上 |
| `persistence-health-nov23.spec.ts-snapshots/harness-history-gap-written-chromium-darwin.png` | 同上 |
| `persistence-health-nov23.spec.ts-snapshots/recovery-banner-chromium-darwin.png` | 同一 Harness 整页；横幅本身不变 |

### 8.2 新增候选基线（9 张）

在 `harness-typography-nov23.spec.ts-snapshots/` 下按
`harness-typography-{light|dark|eink}-{narrow|wide|ultrawide}-chromium-darwin.png` 命名，共 3×3 张。
这些文件在提案阶段不存在；只有 Alex 看过九组候选图并批准后才生成正式基线。

### 8.3 不应变化的相邻基线

- `m303…/titlebar-with-harness-toggle-chromium-darwin.png`：标题栏不在作用域。
- `m347-harness-composer…/m347-ctxpop-cache-metrics-chromium-darwin.png`：浮层排版不变。
- `m345-quote-card…/m345-quote-gesture-button-chromium-darwin.png`、`m423-message-excerpt…/` 两张：
  手势钮和引用卡自有字号 / 行高，行为与元素外观不变。
- `m440-harness-image-card…/` 四张与 `m454-composer-image-mention…/` 两张：图片卡字号、缩略图和卡片
  padding 不变；若出现差异先查继承泄漏，不直接接受为新基线。
- `persistence-health-nov23…/` 三张 `*-warning-block-*.png` 与 `recovery-banner-element-*.png`：警示块 /
  横幅元素本身不改，只有其所在整页允许变化。
- 其他不含 Harness 的编辑器、文档预览、设置与 chrome 基线全部不应变化。

实施后须核对所有受影响整页基线的时间戳；删除 / 移动元素不在本提案内，因此不得以“容差通过”替代逐张
核对。若实际差异超出 §8.1 / §8.2，先回写清单并送 Alex，不机械扩大更新面。

## 9. 非目标与退路

- 不移动进度区，不重做运行态；后续 `move-harness-progress-to-output-tail-nov23` 负责位置与信息架构。
- 不改全屏快照的 `--editor-font-size`、编辑器缩放语义或全屏专属布局，不把面板表格 13px 扩散到全屏。
- 不重复实现 152 的 `metaLine` 执行器、单测或场景判据；只复用指定前置分支。
- 不改跟随滚动、回到底部、滚动条档位或任何现有局部横滚结构。
- 不给 pane / composer 设置 720px 上限或固定宽，不居中消息。
- 不改交互、配置、Rust、文档源文件、留存格式。
- 若 15px/1.58 在真机造成控制区遮挡、批准动作裁切或局部横滚失效，不得通过缩回 13px、隐藏内容或重写
  滚动静默交付；保留 FAIL 证据并回到节点 1 调整候选。
