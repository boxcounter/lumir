# Tasks: stabilize-markdown-line-boxes-nov19

## 1. 合同与实现

- [x] 1.1 读取 REVIEW.md 与 M842 两条 finding，确认链接尾标与裸 marker 的行盒增高机制。
- [x] 1.2 新增 editor-live-preview 行盒稳定 requirement：链接与裸 marker 在 active/inactive、焦点切换下行高/基线/后续行 top 稳定，横向源码显露与合法换行合同不变。
- [x] 1.3 以局部 CSS / 渲染几何修复两处；保留链接可点性、尾标语义与裸 marker widget，不做全局行高统一或运行时补偿。

## 2. 回归

- [x] 2.1 将链接与裸 marker 从允许纵向重排改为稳定断言，同时保留渲染态切换的区分度。
- [x] 2.2 覆盖 light/eink、12 轮光标循环及失焦/聚焦；修复前确认目标断言判红。
- [x] 2.3 不新增或更新像素基线；若既有像素变化，保存 actual/expected/diff 供 Alex 过目。
  - `render-link` 与 `render-link-bare-url` 各 13638 pixels（ratio 0.02）；六张证据在 `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/m856-line-boxes/`，已送 tower 转 Alex。

## 3. 验证

- [x] 3.1 目标 spec 在 Chromium 与 webkit-realua 通过，使用独立端口 4395。
  - 完整 spec：86 passed，3.0m，exit 0；证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/m856-line-boxes/target-full-pass.log`。
- [ ] 3.2 经 tower 批准后运行完整 `scripts/gate.sh quick` 与 `LUMIR_VISUAL_PORT=4395 scripts/gate.sh visual`，记录 `GATE RESULT` 原文与退出码。
- [ ] 3.3 核对最终 diff 仅含 mission scope，提交后 TowerComplete；真机手感如需验证由 tower 安排。
