# Tasks: restore-default-caret-width-nov23

> 施工前提：**节点 1 已按推荐批准**（Alex 2026-11-23，「按推荐」）。0.1 / 0.2 已勾；其余实现与
> 验证项在实现期勾选。未勾项不删除，放弃的就地写理由。

## 0. 节点 1 与红线

- [x] 0.1 节点 1 已通过：Alex 2026-11-23 回话「按推荐」，C1–C3 全部采用推荐值（记录见
      `proposal.md` 的节点状态块）
- [x] 0.2 批准值已落到 `proposal.md` / `design.md` / `specs/ui-design-system/spec.md`：宽度 1.2px、
      居中 -0.6px、三主题同值、保留 `--text` 与 1.2s 闪烁
- [x] 0.3 开工前过一遍 `REVIEW.md`，重点对照「同一语义两处真源」「值或开关声明了却没有消费者」
- [x] 0.4 **不改颜色覆盖、不改闪烁**：`borderLeftColor: var(--text)` 必须保留；不写任何
      `.cm-cursorLayer` 的 animation 覆盖（`!important` 会压住 CM 的内联相位重启）
- [x] 0.5 **MUST NOT 回改 2px**：不得以「再粗一点更显眼」为由保留或恢复 2px；eink 也不做特例

## 1. 代码（先红显影，再改）

- [x] 1.1 先在 `m647` 里把宽度 / 居中期望改成 `1.2px` / `-0.6px` 并加反向断言（`!== "2px"`、
      `!== "-1px"`），在未改实现的代码上跑一次，确认三主题全红——证明判据有区分度
      （实现期实测：宽度断言先红，`marginLeft` 断言另用临时停用宽度断言的探针确认同样红；
      日志 `.local/missions/caret-default-nov23/01-red-m647-old-impl.log`、`02-...probe...log`）
- [x] 1.2 `src/editor.ts`：`.cm-cursor, .cm-dropCursor` 覆盖改为只剩
      `{ borderLeftColor: "var(--text)" }`，删除 `borderLeft` 与 `marginLeft`
- [x] 1.3 同处注释按三次改裁改写：2026-10-23 加粗来历、2026-10-24 闪烁改判、2026-11-23 宽度
      回退；写明宽度 / 居中的唯一来源是 CM 基础主题，MUST NOT 再覆盖
- [x] 1.4 `rg "cm-cursor"` 全仓确认没有第二处宽度 / 居中覆盖（预览、全屏代码块、图片查看面都查）
- [x] 1.5 1.1 的用例转绿（另做变异验证：临时把实现改回 2px，三主题必红，日志 `04-...log`）

## 2. 文档清扫（同一语义的多处副本）

- [x] 2.1 `docs/specs/editor-caret.md`：「实现落点」的光标段落（2px → 1.2px、-1px → -0.6px）、
      验证层表格里的 m647 判据、改裁说明补 2026-11-23 一笔
- [x] 2.2 `docs/specs/design-tokens-v1.md`「阴影与 hairline」：删除「光标 2px 是组件常量」的
      登记，改写为「宽度 / 居中取 CM 基础主题默认值，颜色取 `--text`；不新增 token、不登记
      组件常量」
- [x] 2.3 `scripts/acceptance/scenarios/228-caret-visibility.md`：front-matter 标题、eink 步骤
      说明、改裁说明、证据说明里的「2px」逐处改准；步骤结构与断言不动
- [x] 2.4 `scripts/acceptance/COVERAGE.md:208`：与 228 标题同一句改准
- [x] 2.5 `rg "2px"` 逐条核对本 change 面：只改「光标宽度」语义的副本；引用块竖线、tab 激活
      描边等其他 2px 不动
- [x] 2.6 实现后回改 `design.md` 的行号 / 符号名（若与最终代码不一致）；并补 F2a（Chromium
      计算样式取整实测）——提案里「计算样式 = 1.2px」的前提在实现期被证否，判据已改为
      「声明值 = 1.2px + 计算值非 2px」两路（同类修正同步进 proposal / delta / editor-caret）

## 3. 视觉与几何（计算样式是权威判据）

- [x] 3.1 `tests/visual/scenes/m647-caret-geometry.spec.ts`：light / dark / eink 三主题
      `borderLeftWidth` 的级联声明 = `1.2px`、`marginLeft = -0.6px`、颜色 = 该主题 `--text`
      计算值。**实现期校正**：Chromium DPR=1 下计算值把 1.2px 取整为 `1px`（F2a），因此
      宽度判据写成「声明列表 = `["1.2px"]`」+「计算值 ∈ {1px, 1.2px}」
- [x] 3.2 反向断言：声明列表不含 `2px`、`borderLeftWidth !== "2px"`、`marginLeft !== "-1px"`
      （回粗必红；已用变异测试验证——临时改回 2px 时三主题全红）
- [x] 3.3 闪烁判据原样保留并通过：`animationName ∈ {cm-blink, cm-blink2}`、`duration = 1.2s`、
      `infinite`、运行态、0ms / 700ms `opacity = 1 / 0`
- [x] 3.4 几何判据原样通过：光标矩形高度 = 所在行行盒 ±1px、小于 frontmatter 卡高度；列表行
      四个入口的高度判据不变（宽度变化不得影响高度）——完整 `gate.sh visual` 中整份 m647 全绿
      （含 M795 列表行与孤立空项各档）
- [x] 3.5 未聚焦 `display: none` 判据不变
- [x] 3.6 **MUST NOT** 在截图里数设备像素当判据（DPR / 抗锯齿会把 1.2px 落成 1 或 2 个设备
      像素）；截图只作观感证据

## 4. 像素基线（先候选，不 update）

- [x] 4.1 本地跑 `scripts/gate.sh visual`，记录逐张比对结果——`GATE RESULT: 15/15 PASS（SKIP 0）`，
      视觉套件 1258 passed / 1 skipped / 0 failed；逐张像素比对无差异，基线零改动
- [x] 4.2 若出现像素差异：先定位是否来自光标（看 diff 区域位置 / 形状），出候选截图落
      `.local/reviews/ux-improvements/`（git 外）——**未出现差异**，无候选
- [x] 4.3 `--update` 是 Alex 人肉裁决点：未过目不得执行；基线未更新时在报告里写明「候选已出、
      待裁」——本 change 不需要更新基线

## 5. 真机与既有场景回扫

- [x] 5.1 真机场景 228 重跑：属性盒显露 / 恢复、doc-title 与正文点击零写盘、light + eink 截图
      证据；步骤与断言不变，仅文案改准——**PASS 47.8s（28 断言 / 0 失败）**；日志
      `.local/missions/caret-default-nov23/acceptance-228.log`，证据目录
      `.local/acceptance/2026-11-23-caret-default/`（worktree 内生成，已复制到主仓同路径）
- [x] 5.2 回扫所有引用「光标」的既有验收场景（`rg "光标" scripts/acceptance/scenarios/`），
      逐条确认没有把 2px 写成断言；有则改准——实测零命中（无 `2px` / `-1px` 光标断言）
- [x] 5.3 证据落 `.local/acceptance/<批次>/`（git 外）；用绝对路径 `ls` 确认后再写进报告——
      本 change 的证据类型是红绿与门禁日志，按 `.local/README.md` 归
      `.local/missions/caret-default-nov23/`（已 `ls` 确认 10 份文件）；真机截图随 5.1 归
      `.local/acceptance/`
- [x] 5.4 「够不够显眼」归 Alex 手感裁决，不进机器判据；eink 残影 / 闪烁观感同列手感项

## 6. 门禁与收尾

- [x] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过，记录 `Totals:` 原文
      ——`Totals: 37 passed, 0 failed (37 items)`
- [x] 6.2 `bash scripts/docs-check.sh` 通过（含 archive-check 门禁模式与相对链接）——PASS，
      234 项自测全过
- [x] 6.3 `scripts/gate.sh quick` 通过；照抄 `GATE RESULT` 原文行 + 退出码（SKIP 单列）
      ——`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0
- [x] 6.4 `scripts/gate.sh visual` 通过（动过 `tests/visual/scenes/**`，必须本地跑）
      ——`GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0；视觉套件 1258 passed / 1 skipped
- [x] 6.5 真机 228 PASS；证据指针可 `ls`——PASS 47.8s，证据
      `.local/acceptance/2026-11-23-caret-default/`（summary.md / shots / ax 齐全）
- [x] 6.6 视觉基线未更新；若确需更新，先送 Alex 过目——逐张像素比对无差异，未触及基线
- [x] 6.7 `tasks.md` 全部勾选或就地写理由（未勾项：6.8）——5.1 / 6.5 已在 2026-11-23 真机
      228 PASS 后补勾；6.9 已随独立评审 clean/merge 补勾
- [ ] 6.8 实现 PR 合并时在 `docs/backlog.md` 的归档跟踪队列落一条本 change 记录（队列当前 76
      行、硬上限 80；落条前先核可删的僵尸条目，不为压行数删活条目）——**合并时由 tower 执行**，
      worker 不 merge
- [x] 6.9 交独立 reviewer；verdict 绑定当前 tip；归档前逐条核对节点 2 五要件——verdict
      **clean / merge**（独立 reviewer，非作者），评审 tip `c9fd7d06`；五要件材料见
      `proposal.md` 的节点 2 块；merge / archive 待 tower 执行

## 7. 信息卫生

- [x] 7.1 视觉 fixture 与真机场景只用合成文档名 / 内容；不出现真实 vault 名、人名或正文
- [x] 7.2 提交前对改动面做一次 text 级 grep 清扫；截图类证据只落 `.local/`（git 外）
