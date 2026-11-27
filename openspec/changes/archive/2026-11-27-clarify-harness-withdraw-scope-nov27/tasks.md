# Tasks: clarify-harness-withdraw-scope-nov27

## 1. 实现

- [x] 1.1 撤回钮图标化：12px 撤销箭头 SVG（`aria-hidden`），按钮盒 20×20（不放大）；保留 hover /
      focus-visible 才显形；`applyLabels` 不再写 `textContent`（否则图标被清掉）。
- [x] 1.2 读屏名与提示分家：`aria-label` = D1052「撤回这一轮」；`title` = D1089 完整后果句；busy
      时仍读 D1053。
- [x] 1.3 预览：`is-withdraw-preview` 标在最后一条用户消息 + 其后 transcript 顶层内容节点
      （排除 `progress` / 空态提示）；CSS 只用 outline + 底色，零布局影响。
- [x] 1.4 清理：指针悬停 / 键盘焦点两个激活源分别跟踪，任一仍成立时保留、两者都退出才清；
      Escape（escape 层栈顶层）/ 在途状态变化 / `resetView` / 面板摘除 / 撤回动作开始等强制
      清理复位全部源；不改动其它层的 Escape 顺序。
- [x] 1.5 文案同口径：D1054 二次确认条、D1056 成功 toast；deck 与 `copy-data.ts` 同步，新增 D1089。
- [x] 1.6 真机场景对账：882 / 887 点击目标改 `^撤回这一轮$`；882 加入口可访问名 / 悬停提示断言与
      hover 预览截图证据，并更新场景头注释的读屏名口径。
- [x] 1.7 尾部通知：目标之后存在 `.lumir-hp-notice`（后端 `harness_withdraw_tail_notice`）时整段
      不预览；预览期间到达这类通知立即撤下；按钮与后端错误语义不变。

## 2. 测试（先红后绿）

- [x] 2.1 `tests/visual/scenes/harness-withdraw-message-nov26.spec.ts`：预览范围（用户消息 + 回答 +
      工具记录，前缀不亮）、指针移出 / 失焦 / Escape / 在途事件 / 切换会话清理、双激活源的两种
      退出顺序（焦点留指针退、指针留焦点退，全部退出才清）、尾部通知不预览、无布局变化
      （transcript 子节点 rect 与 scrollHeight 前后逐值相同）、入口读屏名与提示、确认条不撤销口径。
- [x] 2.2 `tests/unit/harness-withdraw-scope-copy.test.ts`：D1052 / D1054 / D1056 / D1089 中英双档；
      禁止「后续回答」措辞；toast 必须表达消息 + 回答 + 输入框；确认条必须带「不会撤销」。

## 3. 验证

- [x] 3.1 `bash scripts/gate.sh quick` → `GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0。
- [x] 3.2 目标视觉（结构层，r2 tip）：**13/13**（含双激活源两种退出顺序、尾部通知整段不预览、
      预览期间到达通知立即撤下）；原始日志
      `.local/reviews/withdraw-scope-feedback-nov27/target-visual-r2-green.log`。
      r1 历史读数（仅归因，不构成当前状态）：全量 `1937 passed / 13 skipped / 1 failed`，唯一失败为
      `markdown-editing-stability` 的 teardown flake（`Target page, context or browser has been
      closed`），单跑该 spec 142/142 绿；r2 最终完整视觉见 3.7。
- [x] 3.3 `bash scripts/docs-check.sh`（quick 内 + 归档前复跑）。
- [x] 3.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`（quick 内 + 归档前复跑）。
- [x] 3.5 `node scripts/acceptance/run.mjs --check` → 312 场景静态校验通过。
- [x] 3.6 真机（新 tip `a62b7df1`）：882 PASS 15 断言 / 887 PASS 17 断言，2/2 PASS；
      证据 `.local/acceptance/2026-11-27-withdraw-scope-feedback-r2/`（`summary.md` 与各场景
      `status.txt`）。
- [x] 3.7 **最终完整视觉**：`bash scripts/gate.sh visual` → `GATE RESULT: 15/15 PASS（SKIP 0）`，
      exit 0；`visual-regression` 1375s，无像素差异，未更新基线。汇总与原始日志分别为
      `.local/reviews/withdraw-scope-feedback-nov27/gate-visual-final-summary.log` 与
      `.local/reviews/withdraw-scope-feedback-nov27/gate-visual-final.log`。

## 4. r2：独立终审 P2 修复

- [x] 4.1 P2-1 双激活源：`withdrawPreviewPointer` / `withdrawPreviewFocus` 分别跟踪；任一仍成立
      时保留预览，两者都退出才清；强制清理（Escape / busy / 换代 / 摘除 / 动作开始）复位全部源。
- [x] 4.2 P2-2 尾部通知：目标之后的 `.lumir-hp-notice` 使整段预览不显示（不是只排除通知）；
      预览期间到达这类通知立即撤下；入口与后端错误语义不变。
- [x] 4.3 组合测试：两种退出顺序 + 全部退出才清；合成 fixture（普通轮次仍有预览；尾部通知时
      预览数 0、通知无类、按钮可用且仍发 `confirm=false`）；预览期间到达通知立即撤下。
- [x] 4.4 每条新增 / 修改断言做反向必红与恢复绿（四条：pointerleave 直接清、blur 直接清、
      通知未拦截、appendNotice 未撤预览；日志见 `.local/reviews/withdraw-scope-feedback-nov27/`）。
- [x] 4.5 复跑目标视觉、`pnpm test`、quick，原始日志保存到
      `.local/reviews/withdraw-scope-feedback-nov27/`（不跑全量 visual / 真机，主会话在最终 tip 上跑）。
- [x] 4.6 主会话在新 tip `a62b7df1` 复跑真机 882 / 887：2/2 PASS（882 15 断言、887 17 断言；
      `.local/acceptance/2026-11-27-withdraw-scope-feedback-r2/`，summary.md 与各场景 status.txt）。
