# Tasks: fix-quick-open-active-target-nov25

## 0. 批准与合同

- [x] 0.1 记录 Alex 2026-11-25「选择器按推荐」节点 1 批准及范围（只改 Quick Open 游标起点）
- [x] 0.2 起草 proposal / design / quick-open delta；其余三个选择器与视觉基线不在范围
- [x] 0.3 不变量写进 delta：「高亮行 = Enter 目标，否则无高亮；`aria-activedescendant` 与之一致」

## 1. 旧实现红灯

- [x] 1.1 纯函数矩阵 5 条先在旧策略（恒首行）上跑红：多候选判决行不在首位、direct-only、探测在途
      ——`unit-red-old-policy.log`（43 pass / 3 fail）
- [x] 1.2 浏览器矩阵先在旧实现上跑红：多候选（期望 `plan.md`、实得 `notes/plan.md`）、移动覆盖默认、
      探测在途（期望 0 高亮、实得 1）——`visual-red-old.log`（3 passed / 4 failed，第 4 条为断言笔误，
      修正后 `visual-red-dir-guard.log` 绿）

## 2. 实现

- [x] 2.1 `quickOpenCandidates` 行构造收口（DOM 与测试共用）
- [x] 2.2 `quickOpenStartIndex` 纯函数（open → 判决行 / -1；undecided 在途 → -1；其余 → 首行）
- [x] 2.3 `apply()` 起点改调策略；异步保位行消失时回落策略起点
- [x] 2.4 `confirm()` 的 `open` 分支动作前同步游标（判决行或清空），不改 direct 打开能力；
      游标行 = 判决路径时仍走精确打开（保住 `:行` 落点）

## 3. 测试与规格

- [x] 3.1 `tests/unit/quick-open.test.ts` 新增「游标起点」5 条并全绿
- [x] 3.2 新增 `tests/visual/scenes/quick-open-active-target.spec.ts`（7 条，全绿）
- [x] 3.3 既有 `quick-open.spec.ts` / `quick-open-directory-stable.spec.ts` 全绿（42 passed）
- [x] 3.4 `openspec/changes/.../specs/quick-open/spec.md` 的 MODIFIED requirement（游标条款改写 +
      三个新场景）

## 4. 验收场景（静态检查；真机由主会话串行）

- [x] 4.1 230a：精确路径 / 多候选 / 行号落点段增加「高亮行 = Enter 目标」观测
- [x] 4.2 230b：lazy 与 vault 外只读段增加「无高亮、无 activedescendant、Enter 仍打开」
- [x] 4.3 230c：重启与焦点作用域段复核无「首行假高亮」的旧表述
- [x] 4.4 230d：⌘A 与目录子项段复核高亮断言与新语义一致
- [x] 4.5 231-quick-open-long-path-width：长路径段复核未写死「恒首行高亮」
- [x] 4.6 874：外部目录与稳定布局段增加精确路径无高亮的观测

## 5. 验证与交付

- [x] 5.1 目标单测、目标视觉场景、两份场景 tsc、`bash scripts/docs-check.sh`、
      `openspec validate --all --strict`
- [ ] 5.2 完整 `gate quick` / `gate visual` 与真机复验由主会话串行执行（本 worker 不启动真机）
- [x] 5.3 证据落 `.local/missions/quick-open-active-target/`；提交本分支，不 push / merge / archive
