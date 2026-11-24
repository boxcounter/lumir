# Tasks: refine-harness-typography-nov23

> 产品 CSS、Chromium 场景与真机截图说明已实现；`openspec/specs/**` 活跃期只读，未提前改 living spec。
> 0.6 / 5.2 仅登记已完成的前置修复。已 rebase 到 `origin/master@dd33d1fc`（含 hybrid Skill）。
> 图片卡 badge 已恢复可见；m440 / m454 的 24px 外层宽差与 8 个 glyph 色像素分别记录。
> m347 的 19 像素已证明为背景透入，隔离图逐字节一致，改列额外基线裁决项而非产品阻塞。
> 最终 `gate.sh visual` 已复跑，10 个失败全部落在 §8.1 / §8.2 / §8.4。候选基线必须经 Alex 过目，
> 未批准不得 `--update` / `--update-snapshots`。八场景真机复跑由主会话串行执行，本实现提交不预写其结果。
> 有序链硬门禁：`fix-harness-approval-visibility-nov23` → 本 change →
> `move-harness-progress-to-output-tail-nov23`。0.5 / 0.6 未完成时 §1–§7 全部不得施工；
> 本 change 未归档、基线未批准落盘前，后续尾行 change 同样不得施工。

## 0. 提案（节点 1）

- [x] 0.1 阅读实地报告、`REVIEW.md`、现行 `harness` / `ui-design-system` / `typography` / `content-width`
      living specs，以及表格横滚、流式滚动、composer CodeMirror 与近期活动 / 持久化相关 changes
- [x] 0.2 将 `refined-rows-720` 的实际 CSS、几何、对比度、三主题×三宽度矩阵、基线影响与真机边界写入
      proposal / design / tasks / spec delta；真机原始结果保留 7/8 PASS，不冒写 8/8
- [x] 0.3 Alex 完成节点 1 评审，D1–D7 裁决结果回填 proposal——Alex 2026-11-24 回复「批准」；
      采用 `refined-rows-720` 推荐组合；前置未归档前仍不进入实现
- [x] 0.4 点名并写死 `fix-harness-approval-visibility-nov23` → 本 change →
      `move-harness-progress-to-output-tail-nov23`：阶段色 `--text-3`→`--text-2` 由本 change 承接；
      尾行按 16px gap 重算 margin、按 `16/16/12px` 重算空态绝对定位四边，并以排版后新基线为准
- [x] 0.5 施工前确认 `fix-harness-approval-visibility-nov23` 已归档且 `--archived` 审计 PASS；
      未满足不得启动 §1–§7
- [x] 0.6 已确认 `test/harness-transcript-time-ax-nov23@ede07e8400f30f6418385ea2718847a02afecaf4`
      合并推送 master：K3 clean/merge，quick `GATE RESULT: 13/13 PASS（SKIP 0）`，docs CI
      `45215746792` success；本 change 只复用，不复制其 `metaLine` 执行器、单测或场景 152 判据
- [ ] 0.7 归档前核对后续尾行提案已回写承接值：阶段 `--text-2`、净间距公式
      `calc(var(--sp-2) - var(--sp-8))`、空态四边 `sp-8/sp-8/sp-6/sp-8`、13px/1.58 + `--text-2` +
      24px padding，以及“零漂移只相对排版后 idle 基线”；未回写不得放行后续施工

## 1. 阅读核心与任务型次级文字

- [x] 1.1 `src/harness-panel.css`：transcript 改 15px/1.58、`16px 16px 12px` 外侧与 16px 消息间距；
      composer 外侧改 `12px 16px 16px`
- [x] 1.2 普通块 8px 节奏与首末归零覆盖 `slot > codeblock/table-scroll/table`；列表 24px 缩进、项距 2px、
      项内段落 4px；三级列表与长 URL 不越界
- [x] 1.3 用户气泡 padding 改 8/12px，其他气泡配方不变；who 下距 4px，角色 `--text-2`、时间 `--text-3`
- [x] 1.4 批准副句 / 依据 / 后果、工具尾注、阶段提示、placeholder 与空态提示提 `--text-2`；
      不把时间等装饰性 meta 一律提色
- [x] 1.5 空态改 13px/1.58 与 24px padding，保留 margin auto / text-align 等现有布局；运行提示位置与动画不动

## 2. 代码、横线表与决策控件

- [x] 2.1 代码块保持 12.5px/1.55，padding 改 10/12px、radius 改 `--r8`；复制、全屏、细条与局部横滚不改
- [x] 2.2 仅面板表格改 13px/1.5、cell 6/10px；th 底边 `--border`、td 底边 `--border-soft`，移除其余网格线；
      固有宽、cell 单行、嵌套收缩与全屏入口不变。全屏快照继续 `--editor-font-size`（默认 15px）与既有
      全屏布局，只共享横线和 cell padding；不得把面板字号作用到全屏
- [x] 2.3 工具行改 `min-height:28px; height:auto`，保持 12px、参数省略和终态词保护
- [x] 2.4 批准卡 padding 改 10/12px，purpose / basis / note / diff / argv / reason 下距 8px；
      批准按钮 min-height 32px、水平 padding 12px，长次级动作与命令原文行为不变

## 3. 720px 消息阅读宽与 composer

- [x] 3.1 仅给 `.lumir-hp-transcript > .lumir-hp-msg` 加 `max-inline-size:var(--layout-review-measure)`；
      左缘不变、非固定宽、不居中；不得给 pane / composer 添加同上限
- [x] 3.2 composer 输入改 15px/1.58、min-height 48px、padding 10/12/4px；placeholder top/left 同步 10/12px；
      max-height、局部纵滚、CodeMirror 文本 / 选区 / IME / 发送行为不变
- [x] 3.3 检查共享 `--lumir-hp-scale`：非默认档字号与行高同步，间距和 720px 不二次缩放；⌘0 回各自基线

## 4. 新增 / 更新 Chromium 视觉验收场景

- [x] 4.1 新增 `tests/visual/scenes/harness-typography-nov23.spec.ts`：3 主题 × 3 视口九组，逐组断言
      design §3–§5 的计算样式、对比度、几何、transcript 无横溢、代码局部横滚与控件在面板内
- [x] 4.2 窄组增加宽表局部横滚、窄表不拉伸、长次级动作不裁切；宽 / 超宽组断言消息 720px 左对齐、
      composer 不封顶；超宽组 composer 实际宽 >720px
- [x] 4.3 同场景补非默认 scale、空态与运行态三组；空态必须有单独场景图，不能沿用报告“未单独覆盖”的空白
- [x] 4.4 更新 `m351-harness-visual-fidelity.spec.ts` 的旧 padding / min-height / 角色色断言及注释；
      检查 m628 / m703 / m634 / m384 等相邻场景，只改与新合同直接冲突的旧值，不放宽行为判据
- [x] 4.5 拆分面板 / 全屏表格断言：面板为 13px/19.5px；全屏为 `--editor-font-size`（默认 15px）、共享横线
      和 6/10px padding、固有宽、快照内容与开关行为。全屏不得断言 13px，也不得以面板 45 组证据替代全屏场景
- [x] 4.6 九组各留一张 Harness 元素候选图，命名与 design §8.2 一致；先跑结构断言和本地全量像素门禁，
      候选图与差异清单交 Alex 过目

## 5. 新增 / 更新真机验收场景

- [x] 5.1 更新 86 的空态截图说明、97 的阶段提示与流式截图说明、218 的三主题气泡 / 代码截图说明、
      234 的横线表与横滚截图说明、72 的批准卡截图说明、711 / 719 的工具尾注与批准依据截图说明；
      只增加排版证据，不把 AX 不支持的几何写成自动断言
- [x] 5.2 已复核 0.6 的前置 152 修复进入 master：`6575e753` 提供 `metaLine` / 相邻节点判定与单测，
      `ede07e84` 收窄恢复档时间集合；最终真机 152 PASS（15 断言、17.5s），证据
      `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-24-harness-time-ax-final/`；
      本 change 只复用，不再更新 152 执行器、单测或场景判据
- [x] 5.3 `node scripts/acceptance/coverage.mjs` 重生成覆盖索引；`node scripts/acceptance/run.mjs --check
      86-harness-pane-toggle 97-harness-stream-visible 218-harness-bubble-and-scrollbar
      234-harness-table-horizontal-scroll 152-harness-transcript-link-and-time 72-harness-patch-approve
      711-harness-retry-tools 719-harness-retry-approval` 通过
- [ ] 5.4 在 152 前置修复合并后真机复跑上述八场景，证据落主仓 `.local/acceptance/`；报告逐场景结果、真实
      PASS/FAIL 数、断言数与退出码。原始调研证据是 7/8 PASS、退出码 1；前置 152 单场景 PASS（17.5s）
      不替代本 change 的八场景复验，不得预写或倒填 8/8，若仍有 FAIL 原样保留

## 6. 门禁、基线裁决与证据

- [x] 6.1 跑前端单测、根 / 单测 / 视觉 tsc、`scripts/gate.sh quick`；照抄 `GATE RESULT` 原文与退出码
- [x] 6.2 跑本地 `scripts/gate.sh visual`（含像素）；照抄 `GATE RESULT` 原文与退出码。CI 结构层不能替代
      本地像素层，未获 Alex 批准前只保留 actual / candidate，不更新正式基线
- [x] 6.3 将 design §8.1 的 7 张既有候选与 §8.2 的 9 张新增候选逐张交 Alex；§8.3 的不应变化清单同时
      核对。获得明确批准后才允许统一更新，未批准即保持基线不动并如实报告视觉门禁结果
- [ ] 6.4 若 Alex 批准基线：统一更新后核对全部受影响整页基线时间戳，复跑视觉门禁；做一次有区分度的
      反向验证后还原，禁止调容差或零碎更新
- [x] 6.5 `openspec validate --all --strict`、`bash scripts/docs-check.sh`、`git diff --check` 全部通过；
      日志与关键证据放主仓 `.local/`，不使用会被清理的 worktree 内证据路径
- [x] 6.6 对账实际改动面、tasks、delta 与证据；确认没有进度区移动、滚动重写、pane/composer 720px 固定宽、
      全屏 13px 字号扩散、152 重复实现、产品 TS / Rust 改动或未经声明的基线变化

## 7. 归档（节点 2）

- [ ] 7.1 节点 2 五要件齐后归档；归档后跑 `--archived` 审计与链接检查，living spec 只由归档流程并入
- [ ] 7.2 归档与基线落盘前不得放行 `move-harness-progress-to-output-tail-nov23`；完成后将新的 living
      spec / CSS / idle 基线及 design §7 承接门禁交给后续 change，禁止沿用旧阶段色、gap 或空态偏移
