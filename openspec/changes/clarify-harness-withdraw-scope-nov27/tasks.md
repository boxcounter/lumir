# Tasks: clarify-harness-withdraw-scope-nov27

## 1. 实现

- [x] 1.1 撤回钮图标化：12px 撤销箭头 SVG（`aria-hidden`），按钮盒 20×20（不放大）；保留 hover /
      focus-visible 才显形；`applyLabels` 不再写 `textContent`（否则图标被清掉）。
- [x] 1.2 读屏名与提示分家：`aria-label` = D1052「撤回这一轮」；`title` = D1089 完整后果句；busy
      时仍读 D1053。
- [x] 1.3 预览：`is-withdraw-preview` 标在最后一条用户消息 + 其后 transcript 顶层内容节点
      （排除 `progress` / 空态提示）；CSS 只用 outline + 底色，零布局影响。
- [x] 1.4 清理：pointerleave / blur / Escape（escape 层栈顶层）/ 在途状态变化 / `resetView` /
      面板摘除；不改变其它层的 Escape 顺序。
- [x] 1.5 文案同口径：D1054 二次确认条、D1056 成功 toast；deck 与 `copy-data.ts` 同步，新增 D1089。
- [x] 1.6 真机场景对账：882 / 887 点击目标改 `^撤回这一轮$`；882 加入口可访问名 / 悬停提示断言与
      hover 预览截图证据，并更新场景头注释的读屏名口径。

## 2. 测试（先红后绿）

- [x] 2.1 `tests/visual/scenes/harness-withdraw-message-nov26.spec.ts`：预览范围（用户消息 + 回答 +
      工具记录，前缀不亮）、指针移出 / 失焦 / Escape / 在途事件 / 切换会话清理、无布局变化
      （transcript 子节点 rect 与 scrollHeight 前后逐值相同）、入口读屏名与提示、确认条不撤销口径。
- [x] 2.2 `tests/unit/harness-withdraw-scope-copy.test.ts`：D1052 / D1054 / D1056 / D1089 中英双档；
      禁止「后续回答」措辞；toast 必须表达消息 + 回答 + 输入框；确认条必须带「不会撤销」。

## 3. 验证

- [x] 3.1 `bash scripts/gate.sh quick` → `GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0。
- [x] 3.2 目标视觉 + 全量视觉：结构 10/10；全量 `1937 passed / 13 skipped / 1 failed`（失败为
      `markdown-editing-stability` 的 teardown flake，单跑 142/142 绿；无像素差异，未更新基线）。
      读数与归因见 `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/withdraw-scope-feedback-nov27/visual-and-verification.md`。
- [x] 3.3 `node scripts/docs-check.sh`（quick 内）。
- [x] 3.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`（quick 内）。
- [x] 3.5 `node scripts/acceptance/run.mjs --check` → 312 场景静态校验通过。
- [ ] 3.6 真机执行 882 / 887（由主会话跑，本 mission 只交场景改动与自验证读数）。
