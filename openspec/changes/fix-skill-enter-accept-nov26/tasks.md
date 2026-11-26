# Tasks: fix-skill-enter-accept-nov26

> 行为依据是 Alex 2026-11-26 节点 1 批准的 Enter 新合同（proposal 六条）。顺序是硬约束：
> **先红后绿**——1.x 用新合同写判据并实测旧实现判红，留证据后再进 2.x；3.x 才是文档与验收收口。
> 实现期若发现合同本身需要新裁决，停下更新 proposal 再改，不静默扩 scope。

## 0. 提案

- [x] 0.1 起草 `proposal.md` / 本文件 / `specs/harness/spec.md`（整条 MODIFIED）
- [x] 0.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 39/39 与
      `bash scripts/docs-check.sh` PASS

## 1. 先红：新合同判据对旧实现

- [x] 1.1 `tests/unit/skill-menu.test.ts` 改写为高亮即 armed：部分匹配、多候选首项、无候选、
      按名字保留、异步回包不换项；旧实现上实测 **11 failed / 7 passed**，日志
      `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/skill-enter-accept-nov26/unit-red.log`
      （修后同文件 19/19，`unit-green.log` / 全量 2049/2049 `unit-final.log`）
- [x] 1.2 `tests/visual/scenes/skill-hybrid.spec.ts` 补真实按键用例：`/tmp` 接受、`/in`
      多候选首项、无匹配发送、`/tmp` 无匹配态、Esc 后发送原文、延迟 catalog 不重开/不换项、
      Tab 接受；旧实现上 **9 failed / 65 passed**（`visual-red.log`），异步回落项另以旧 src
      单跑判红 `data-armed="false"`（`visual-red-async.log`）

## 2. 实现（绿）

- [x] 2.1 `src/skill-menu.ts`：`items` 非空时 `armed` 恒真；同 token 的异步回包按名字保留
      目标（新出现的同名项也不得改选）；更新状态机注释；保留 `skillSelectionSpec` 的 armed 守卫
- [x] 2.2 `src/harness-panel.ts`：更新接受键与点击接受注释（高亮即接受、无修饰 Enter/Tab）
- [x] 2.3 单元测试转绿：目标文件 19/19、全量 `node tests/unit/run.mjs` 2049/2049 PASS
- [x] 2.4 视觉目标用例转绿：`skill-hybrid.spec.ts` 76/76（chromium，`visual-final.log`）；
      相邻 `skill-visible-selection-nov25.spec.ts` chromium + webkit-realua 14/14（`visual-adjacent-green.log`）

## 3. 文档与验收收口

- [x] 3.1 `docs/specs/selector-contract.md` C4 整节改写（高亮即 armed、异步不得换项、观测口径）
- [x] 3.2 `docs/specs/skill-menu.md` 更新 S1 并新增 S5（接受/发送边界、Esc 原文、异步稳定）
- [x] 3.3 `specs/harness/spec.md` delta 与 living 逐段对账：旧 requirement 整条 REMOVED + 新名 ADDED，
      「Skill 支持」交叉引用 MODIFIED；`openspec validate --all --strict` 39/39、archive-check 无丢段
- [x] 3.4 验收 868：`/tmp` 段翻转为接受，补多候选首项 / 无匹配发送 / Esc 原文；`726` 的
      `/tmp` 普通文本路径改为先 Esc；`node scripts/acceptance/run.mjs --check` 298 场景通过
- [x] 3.5 静态与目标门禁：`pnpm exec tsc --noEmit` 0、`tests/visual` tsc 0、`docs-check` PASS、
      `openspec validate --all --strict` 39/39、`acceptance --check` 298；完整 `gate.sh` 与真机 868
      留主会话执行
- [x] 3.6 提交并回报 tip、红绿证据、待真机事项（不 merge / 不 push / 不归档 / 不改正式基线）；
      提交由本 change 的首个 commit 完成，tip 在完工回报中给出

## 覆盖边界

- IME：真机 AX 无法注入原生 TSM 组合；本 change 的 IME 判据落在 `skill-hybrid.spec.ts` 的真实
  keydown + 合成 CompositionEvent 序列（组合期不吞、结束后重算一次），原生 IME 人工终判仍归
  `156-harness-composer-ime-composition-freeze` 的人工矩阵，不在本 change 内冒充。
- 异步 catalog：浏览器场景用可控 deferred `harness_skills_list` 回包验证「不换项 / 不重开」；
  真机 868 不伪造后端回包时序，该分支以浏览器场景为准。

## 4. 真机返修（2026-11-26，主会话复跑前）

- [x] 4.1 **A：WKWebView 滚动后同坐标 mousemove 抢走键盘游标。** 红测试
      `skill-hybrid.spec.ts`「滚动把另一行搬到静止指针下时，同坐标 mousemove 不得抢走键盘游标」：
      旧实现在指针停在第 0 项、键盘到第 12 项、列表滚动后补发同坐标事件，游标被改成指针下的第 9 项
      （`visual-red-pointer.log`，received `option-9`）。修复：`mousemove` 只在 `clientX/Y` 相对上次
      变化时更新指针选意，同坐标事件直接忽略；真实鼠标移动仍生效（既有 hover 用例全过）。修后
      `skill-hybrid` 77/77 PASS（`visual-pointer-green.log`）。
- [x] 4.2 **B：726 恢复等待失败。** 根因不是恢复渲染或历史 wire：失败时 AX 里会话浮层仍打开且唯一
      项就是当前会话（时间「现在」），而恢复行 click handler 第一行同步 `setSessPop(false)`——浮层
      未收起说明 DOM click 从未触发；该步用坐标 `clickInNode`，同次运行 runner 报告「前台焦点未取得
      或被中途抢走」。且干净 env 下清单只有当前会话，`harness_resume_session` 对当前 id 返回
      `switched=false`（前端直接 return、不重建面板），「当前编辑器上下文：」不可能出现；r5 通过是
      因为残留了另一份同名源会话。修复：726 在恢复前先「新会话」确保目标不是当前会话；恢复行改用
      AXPress（`do: click`）并在同一步断言浮层收起；m460 视觉补「恢复 wire 的上下文节原样上屏」
      守卫（4/4 PASS，`visual-m460-full.log`）。**产品恢复路径零改动。**
- [ ] 4.3 主会话真机复跑 868 / 726（本 worker 不跑真机；A 的缺陷现场只在 WKWebView 出现）。

