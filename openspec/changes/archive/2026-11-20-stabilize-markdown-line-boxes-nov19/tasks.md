# Tasks: stabilize-markdown-line-boxes-nov19

## 1. 合同与实现

- [x] 1.1 读取 REVIEW.md 与 M842 两条 finding，确认链接尾标与裸 marker 的行盒增高机制。
- [x] 1.2 新增 editor-live-preview 行盒稳定 requirement：链接与裸 marker 在 active/inactive、焦点切换下行高/基线/后续行 top 稳定，横向源码显露与合法换行合同不变。
- [x] 1.3 以局部 CSS / 渲染几何修复两处；保留链接可点性、尾标语义与裸 marker widget，不做全局行高统一或运行时补偿。

## 2. 回归

- [x] 2.1 将链接与裸 marker 从允许纵向重排改为稳定断言，同时保留渲染态切换的区分度。
- [x] 2.2 覆盖 light/eink、12 轮光标循环及失焦/聚焦；修复前确认目标断言判红。
- [x] 2.3 既有像素变化先保存 actual/expected/diff 供 Alex 过目；批准后仅重录获批基线。
  - `render-link` 与 `render-link-bare-url` 各 13638 pixels（ratio 0.02）；六张证据在 `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/m856-line-boxes/`。Alex 明确批准更新，重录结果与审阅 actual 逐字节一致，SHA-256 均为 `fa0682076e113334510a10dde3a3b9695d17ca788abdb1945b5df68da69bf40e`；其他基线未改。

## 3. 验证

- [x] 3.1 目标 spec 在 Chromium 与 webkit-realua 通过，使用独立端口 4395。
  - 完整 spec：86 passed，3.0m，exit 0；证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/M856/`。
- [x] 3.2 经 tower 批准后运行完整 `scripts/gate.sh quick` 与 `LUMIR_VISUAL_PORT=4395 scripts/gate.sh visual`：
  `GATE RESULT: 13/13 PASS（SKIP 0）` 与 `GATE RESULT: 15/15 PASS（SKIP 0）`，退出码均 0；
  visual-regression 1268 passed / 4 skipped，未改其他基线；原始日志 `.local/missions/M856/`。
- [x] 3.3 最终 diff 仅含 mission scope（实现、测试、两张获批 PNG、change 制品共 7 个文件），
  提交后 TowerComplete 并获独立 review clean/merge；无额外真机手感项。
