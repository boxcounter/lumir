# Tasks: harness-path-link-keep-position-nov23

> 施工前提：**节点 1 已按推荐批准**（Alex 2026-11-23，「按推荐」）。0.1 / 0.2 已勾；其余实现与
> 验证项在实现期勾选。未勾项不删除，放弃的就地写理由。

## 0. 节点 1 与红线

- [x] 0.1 节点 1 已通过：Alex 2026-11-23 回话「按推荐」，L1–L4 全部采用推荐值（记录见
      `proposal.md` 的节点状态块）
- [x] 0.2 批准值已落到 `proposal.md` / `design.md` / 两份 spec delta：行锚照旧滚动、裸路径不切
      pane、1400ms + `--sel-band`、工具卡片同规则
- [x] 0.3 开工前过一遍 `REVIEW.md`，重点对照「同一语义两处真源」「断言等价于子串」「读不到当成
      空」「新增 overflow 容器没先定档」（本条不新增滚动容器，确认没有触碰）
- [x] 0.4 **不改行锚语义**：`路径:行号` / `:起-止` 仍滚到目标行 + 行高亮；不改
      `openPathAtLine` / `jumpPlanFor` 的算式
- [x] 0.5 **不改通用打开语义**：`openFile` / `activate` / 跨 pane 分支一律不动；不为跨 pane 设计
      新行为
- [x] 0.6 闪烁时长只用 `NAVIGATION_HIGHLIGHT_MS`（1400ms）；MUST NOT 新造第三个时长值
- [x] 0.7 **工具卡片 `offset` 不产生行高亮**：只滚动落行 + 闪标签；既有禁令不变，MUST NOT 为了
      「同一条判定」把卡片高亮加回来
- [x] 0.8 **焦点留在 composer**：正文与卡片路径按钮各自加按钮级 `mousedown.preventDefault()`；
      MUST NOT 挂容器级监听；`click` 与 Enter 激活不变
- [x] 0.9 **标签栏有销毁路径**：`TabsHandle.dispose()` 接入 `disposePaneHandle`（销毁 editor 前）
      或 `assembly.unsubs`；闪烁中收 pane 不得留计时器 / 状态

## 1. 先红（旧实现上必须红）

- [x] 1.1 新增 chromium 场景：长文档滚到中部 → 点裸路径（目标已在前台）→ 断言
      `scrollTop` / `selection` / 正文逐字节不变、`.tab.is-flash` 在场；旧实现没有 `.is-flash`，
      必红
- [x] 1.2 新增「未打开不闪」用例：点一个未打开文件的裸路径 → 新标签打开且无 `.is-flash`；
      旧实现同样无 flash，本用例用于钉住「不要给新标签加闪烁」
- [x] 1.3 新增「后台标签恢复自身位置」用例：目标在后台、离开时停在文档中部 → 点击后 `scrollTop`
      等于离开时快照而不是 0，且闪一次
- [x] 1.4 新增反向用例：点行锚链接 → 照旧滚动 + `.cm-line-highlight` 在场 + 闪一次（证明没有
      误伤 L1）
- [x] 1.5 新增「卡片 offset 无行高亮」用例：点带 `offset` 的卡片路径 → 滚动到落点行、闪标签、
      `.cm-line-highlight` **不在场**；旧实现已满足（不传 `lineEnd`），用于钉住不得回加
- [x] 1.6 新增「路径按钮 mousedown」用例：正文按钮与卡片按钮各一例，按下时断言焦点仍在
      composer；旧实现在 mousedown 后焦点已到按钮，必红
- [x] 1.7 新增「闪烁中收 pane」用例：双 pane 下触发右 pane 标签闪烁后收该 pane，断言无残留
      class、无计时器回调报错；旧实现没有 `dispose`，本用例用于钉住生命周期
      - 落地形态 = `tests/unit/tabs.test.ts` 的 `dispose` / 「计时到点时槽已卸载」用例；
        视觉现场不可达（pane 上限二 + harness 在场时文档 pane 唯一，见 4.10 注）
- [x] 1.8 区分度先验：临时把 `.is-flash` 的施加代码去掉，确认 1.1 / 1.3 / 1.4 按预期变红；
      确认 1.2 仍绿（它断言「没有」）；临时去掉 mousedown 监听，确认 1.6 变红

## 2. 分档判定（`src/main.ts` + `src/harness-path-link.ts`）

- [x] 2.1 `harness-path-link.ts` 抽纯函数 `linkDisposition({ exists, foreground, line })` →
      `"flash-only" | "open-and-maybe-flash"`；不 fork `openPathAtLine`
- [x] 2.2 `openVaultPath`：取 `existing = editor.sessionForPath(path)`、
      `foreground = existing === editor.activeSession()`
- [x] 2.3 `existing && foreground && line === undefined` 时**只**调 `activeTabs().flash(existing)`
      并返回；MUST NOT 调 `openFile` / `openPathAtLine` / `activatePane` / `syncActiveDocument`
- [x] 2.4 其余情形保留既有 `openPathAtLine`；`await` 其返回值，`opened && existing` 时
      `flash(existing)`
- [x] 2.5 注释写明「短路是为了不给『看它在哪』附带切 pane / 收浮层等副作用」；写明目录链接不
      走本分支
- [x] 2.6 单测矩阵（`tests/unit/`）：未打开 / 前台裸路径 / 前台行锚 / 后台 / 非活跃 pane 五组，
      逐项断言 disposition 与「是否闪」
- [x] 2.7 `src/harness-panel.ts` 的 `createPathLinkEl`（正文与卡片共用）增加按钮级
      `mousedown` → `event.preventDefault()`；不 `stopPropagation`、不挂容器级；保留既有
      `click` 与 `keydown` Enter 两条激活路径

## 3. 标签闪烁（`src/tabs.ts` + `src/style.css`）

- [x] 3.1 `TabsHandle` 新增 `flash(session: EditorSession): void`
- [x] 3.2 模块内按**会话对象**记账：`flashed: EditorSession | null` + `flashTimer`；重复触发先清
      旧计时器与旧 class，再施加新 class 并重新计时（同一时刻至多一个）
- [x] 3.3 `renderTabs()` 全量重建时，对 `session === flashed` 的标签重新加 `is-flash`
- [x] 3.4 清理：计时结束、会话关闭（单条 / 批量）、`dispose` / 槽卸载时清计时器与状态；回调
      发现卸载时 MUST 先清 `flashed` 与计时器再返回，MUST NOT 只 `return` 留下状态
- [x] 3.5 `src/style.css`：`.tab.is-flash { background: var(--sel-band); }`，位置在
      `.tab:hover` 与 `.tab.is-active` 之后；eink 无需额外规则（`--sel-band` 已有值）
- [x] 3.6 确认不改 `font-weight` / `border` / `box-shadow` / 尺寸；不新增 token / 时长 / 动效
- [x] 3.7 确认没有第二个「标签闪烁」实现（`rg "is-flash|flash\\(" src/`），单一真源
- [x] 3.8 `TabsHandle` 新增 `dispose(): void`：清计时器、清 `flashed`、移除残留 class
      - 区分度：`dispose()` 后**不推进计时**即 `renderTabs()`（会话仍在）不得复活 class；
        `clearTimeout` spy 必须被调用；再以「只摘 class、留状态 / 计时器」的退化实现实测判红
- [x] 3.9 `src/main.ts` 的 `disposePaneHandle` 在 `handle.editor.view.destroy()` 之前调用
      `assembly.tabs?.dispose()`（或注册进 `assembly.unsubs`）；确认关 pane 与双 pane 收拢都
      走这条路径

## 4. 几何 / 焦点 / 链接矩阵（chromium）

- [x] 4.1 前台裸路径：`scrollTop`、`selection.main.anchor/head`、正文逐字节、dirty 点逐值不变；
      **不触发打开 / 同步链路**的仪器成立（跳转行浮层不收起、标签栏无 childList 重建、active
      tab 节点身份不变）；真实 `Meta+z` 撤掉点击前的键入（撤销栈未清空——页面读不到 history
      depth，不伪造深度读数）；`.tab.is-active` 不变；`.is-flash` 立刻在场、1.4s 后有界轮询
      确认消失。正文与工具卡片两个入口各跑一遍。
- [x] 4.2 焦点：点击后 `document.activeElement` 仍是 harness composer 的 `.cm-content`；随后
      直接键入字符只进 composer
- [x] 4.3 标签几何：闪烁前后 `getBoundingClientRect()`（宽 / 高 / x）逐值不变；标签栏
      `scrollLeft` 不变
- [x] 4.4 重绘保持：闪烁中途触发一次 `renderTabs`（改另一个标签的 dirty），新 DOM 仍带
      `.is-flash`，1.4s 后正常消退
- [x] 4.5 连点：1.4s 内连点同一路径两次，计时重置、只有一层 class、无残留
- [x] 4.6 三主题：light / dark / eink 下 `.is-flash` 的 `backgroundColor` 等于该主题
      `--sel-band` 计算值；eink 文字仍为 `--text`
- [x] 4.7 反向矩阵：目录链接、未打开路径、同名不同目录三情形逐项按 design §2.1 断言
- [x] 4.8 工具卡片：裸路径已在前台 → 同 4.1；`offset` 卡片 → 滚动落行 + 闪标签 +
      **无 `.cm-line-highlight`**（既有禁令）
- [x] 4.9 路径按钮 mousedown：正文与卡片各一例——按下后焦点仍在 composer；click 后打开 / 闪烁
      照旧；Enter 激活可用（键盘可达性回归）
- [x] 4.10 闪烁中收 pane：双 pane 右 pane 标签闪烁 → 收 pane；`TabsHandle.dispose()` 被调用、
      `flashed === null`、无残留 class、无计时器回调报错
      - 落地形态 = 单测（`tabs.test.ts` 的 dispose / 槽卸载用例 + `main.ts:458` 的接线）；
        **视觉现场在现行布局下不可达**：pane 上限二，harness 在场时文档 pane 只有一个，
        右 pane 的标签条不可能被 harness 路径链接闪烁命中（与 proposal「跨 pane 分支结构上
        不可达」同一事实）。dispose 用例已改为「不推进计时即重建 + `clearTimeout` spy」，
        并用只摘 class 的退化实现实测判红；关闭被闪会话同样有独立的 `clearTimeout` 判据。
        可达的生命周期面（重建保持 / 重复命中 / 计时到点）在 chromium 场景
- [x] 4.11 截图卫生：所有截图断言前等 1.4s + 一帧，确保闪烁不进入像素基线

## 5. 真机与既有场景回扫

- [x] 5.1 扩展 `scripts/acceptance/scenarios/221-harness-path-line-range.md`：新增「点裸路径
      （目标已在前台）」步骤；点击前 `do: recordEditor` 记基线，点击后
      `editor: { unchangedSince: <基线名> }`；截图紧跟点击（~0.6s，1.4s 窗口内）
- [x] 5.2 同一步加焦点证明：不点任何东西直接 `do: keys` 输入字符 →
      `editor: { unchangedSince: <基线名> }` 仍成立、composer 文本变化；焦点判据复用同一份
      基线，MUST NOT 另写子串近似
- [x] 5.3 「不滚动」的真机判据用「`unchangedSince` 逐字节 + 截图前后对照」；MUST NOT 用
      「`has` 关键标记 + 目标行不出现」这类子串近似，也 MUST NOT 伪造 AX `scrollTop` 读数
      （README 已登记读不到）
- [ ] 5.4 既有行锚步骤（`:39` / `:39-48`）保持 PASS；闪烁断言不改变其高亮判据
      - 未跑真机（本任务约束：不起 Lumir 实例、不跑真机）；步骤未改动，PASS 待主会话验收批次
- [x] 5.5 `rg "harness|路径|goto-line" scripts/acceptance/scenarios/` 回扫所有点路径链接的场景：
      确认没有「点裸路径后期望滚动」或「闪烁窗口内截图」的旧期望；有则改准
- [x] 5.6 若新增场景编号 / 标题 / item，同步 `scripts/acceptance/COVERAGE.md`
- [x] 5.7 证据落 `.local/acceptance/<批次>/`（git 外）；用绝对路径 `ls` 确认后再写进报告

## 6. 像素与门禁

- [ ] 6.1 本地跑 `scripts/gate.sh visual`；闪烁不应出现在任何基线里，出现差异先定位
      - 本任务约束不跑全量 gate（主会话串行做）。已跑相关 chromium 场景 60/60 PASS
        （新场景 + m632 + harness-navigation-nov21 + m149-tabs + tab-menu），本 change 不新增
        截图断言、未改基线
- [x] 6.2 如需新截图，只出候选落 `.local/reviews/ux-improvements/`（git 外）；`--update` 属
      Alex 人肉裁决点
- [x] 6.3 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过，记录 `Totals:` 原文
- [x] 6.4 `bash scripts/docs-check.sh` 通过（含 archive-check 门禁模式、验收场景契约与覆盖表）
- [ ] 6.5 `scripts/gate.sh quick` 通过；照抄 `GATE RESULT` 原文行 + 退出码（SKIP 单列）
      - 本任务约束不跑全量 gate（主会话串行做）。已单独跑 tsc（根 / 视觉 / 单测）+ 全量单测
        1866/1866 PASS + openspec validate + docs-check
- [ ] 6.6 `scripts/gate.sh visual` 通过（动过 `src/style.css` 与 `tests/visual/**`，必须本地跑）
      - 由主会话串行执行；worker 侧已完成相关场景复跑（见 6.1 注）

## 7. 收尾

- [x] 7.1 `tasks.md` 全部勾选，未勾项就地写放弃理由
- [x] 7.2 实现后回改 `design.md` 的行号 / 符号名（若与最终代码不一致）
- [ ] 7.3 实现 PR 合并时在 `docs/backlog.md` 的归档跟踪队列落一条本 change 记录（队列 76 行、
      硬上限 80；先核可删的僵尸条目，不为压行数删活条目）
      - 属合并时动作，本分支只到「可评审」；由 tower 在合并 / 归档批次执行
- [ ] 7.4 交独立 reviewer；verdict 绑定当前 tip；归档前逐条核对节点 2 五要件
      - 属 tower 的评审与归档流程，不在 worker 收尾内

## 8. 信息卫生

- [x] 8.1 视觉桩与真机场景只用合成 vault 名 / 路径 / 文档正文
- [x] 8.2 提交前对改动面做一次 text 级 grep 清扫；截图类证据只落 `.local/`（git 外）

## 9. 施工记录（2026-11-23）

- **单测**：`pnpm test` → `tests 1866 / pass 1866 / fail 0`（完整原文见
  `.local/missions/harness-path-link-nov23/unit-full.log`）。新增用例：`harness-path-link.test.ts`
  的分档矩阵与「打开后是否闪」；`tabs.test.ts` 的 flash 记账 / 重置 / 全量重建 / 关闭 / dispose /
  槽卸载 7 条。
- **chromium**：新场景 18/18 PASS，`--repeat-each=2` 连跑 36/36 PASS（`visual-new-spec.log`）；
  相关套件（新场景 + m632 + harness-navigation-nov21 + m149-tabs + tab-menu）合计 61/61 PASS
  （`visual-related.log`）。场景不含截图断言，未改基线。
- **tsc**：根 / `tests/visual` / `tests/unit` 三处 `tsc --noEmit` 均 exit 0
  （`tsc-root.log` / `tsc-visual.log` / `tsc-unit.log`）。
- **OpenSpec**：`validate --all --strict` → `Totals: 37 passed, 0 failed (37 items)`。
- **docs-check**：PASS（ADR / 链接 / 归档对账 / 验收契约与覆盖表 / 套件语法与自测）。
- **区分度先验**：实现前新场景在旧实现上红（`目标标签立刻闪一次` 收到 `[]`）；临时摘掉
  `createPathLinkEl` 的按钮级 mousedown 后，卡片焦点用例红（`Received: inactive`）；临时在
  短路分支加 `syncActiveDocument()` 后，前台裸路径用例在「跳转行浮层不被收起」处红；把
  `dispose()` 改成只摘 class 后，dispose 用例在「重建不得复活」处红。三次探针均恢复后复跑绿。
- **评审返修（P2-1 / P2-2）**：不重载判据从 `Text` 身份改为副作用仪器 + 真实 undo；dispose /
  关闭路径补「不推进计时即重建 + `clearTimeout` spy」；浏览器场景头部删除并不存在的
  dispose spy / 收 pane / pageerror 覆盖声明。
- **未跑 / 未覆盖（如实登记）**：全量 `gate.sh quick` / `visual`、真机场景 221、真实 WKWebView
  的手感与像素层——按任务约束留给主会话串行；「闪烁中收 pane」的视觉现场在当前布局不可达
  （见 4.10 注），由单测钉 `dispose()`。
