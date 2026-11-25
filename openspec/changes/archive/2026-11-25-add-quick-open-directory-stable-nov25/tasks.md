# Tasks: add-quick-open-directory-stable-nov25

## 0. 批准与合同

- [x] 0.1 记录 Alex 2026-11-25「Quick Open 按推荐」节点 1 批准及完整范围
- [x] 0.2 起草 proposal/design/tasks 与 quick-open、fs-io delta；接续 overlay-width 活跃 change，TOC 不改
- [x] 0.3 `docs/specs/overlay-visibility.md` 增加 O7 输入框几何稳定不变量

## 1. 旧实现红灯

- [x] 1.1 前端目录/异步/接受/普通搜索与 `:line` 回归测试先在旧实现跑红，证据落 mission 目录
- [x] 1.2 Rust 外部命令安全/零写入测试先在旧实现跑红，证据落 mission 目录
- [x] 1.3 Chromium 三主题×状态×窄宽/resize 几何测试先在旧实现跑红，证据落 mission 目录
- [x] 1.4 direct action 删除的新断言先在旧实现取得 39 passed / 8 failed；精确路径 Enter 打开保留正向判据

## 2. 目录与后端实现

- [x] 2.1 Quick Open 显式目录语境、一层条目、pending/empty/missing/unreadable、renderSeq 与 100 条截断
- [x] 2.2 文件/目录/外部候选接受；子目录进入、焦点与游标复位；普通搜索和 `path:line` 不变
- [x] 2.3 `fs_list_external_dir` Rust 只读命令、ts-rs payload、注册与前端 IPC；`fs_read_external` 不变
- [x] 2.4 vault 根与 lazy 经 `fs_scan_dir` 一层读取，不进普通索引
- [x] 2.5 删除 direct action 行类型、DOM/鼠标入口、ARIA option、游标空间与专属样式；Enter 的 `openDirect` 保留

## 3. 稳定浮层

- [x] 3.1 输入置底、候选/空态同区域、提示在输入上方、至少 6 行与单一列表滚动
- [x] 3.2 Quick Open 独立 `clamp(26em,50vw,56em)` + viewport max-width，TOC 不动
- [x] 3.3 80vh 与 modeline 上方可用高度共同限高，窄窗/resize/三主题几何矩阵转绿

## 4. 真机制品（不启动真机）

- [x] 4.1 `geom` bbox record/unchangedSince，缺基线或 bbox fail-closed，并补套件自测与 README
- [x] 4.2 新增 `874-quick-open-external-directory-and-stable-layout`，第二合成 vault、只读与零写入判据；`$vault2` 步骤级解析与套件端到端自测已通过，真机 PASS（33 断言）
- [x] 4.3 全库回扫 direct action 旧合同并更新 230a/230b/230c/230d/231/707：真实候选或通用帮助为正向观测，无 direct 行；230a 以 ⌥G 预填值 `39` 精确断言行号落点。静态检查通过，230a/230b/230c/707 真机 PASS（40/34/20/49 断言）
- [x] 4.4 874 增加外部精确路径无 direct action、通用帮助保留、无普通空态、Enter 仍只读打开的静态合同；真机 PASS（33 断言）

## 5. 验证与交付

- [x] 5.1 前端单测、三份 tsc、Rust fmt/clippy/test 与 bindings 漂移检查通过（cargo mkdir 原子锁）
- [x] 5.2 独立端口 Chromium 目标场景通过；最终 tip 完整 `gate visual` `GATE RESULT: 15/15 PASS（SKIP 0）`，未更新视觉基线
- [x] 5.3 `bash scripts/docs-check.sh` 与 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 5.4 完整视觉候选与精确清单落 `.local/reviews/quick-open-directory-stable-nov25/`；Alex 2026-11-25 已批准，45 张候选非正式基线
- [x] 5.6 在 direct action 删除后的最终树重生成 45 候选并更新 MANIFEST commit；视觉基线零改动，完整 `gate visual` 15/15 PASS、真机 874 PASS
- [x] 5.5 证据落 `.local/missions/quick-open-directory-stable-nov25/`（r3 真机、静态复验与最终 gate 日志）；最终 commit `e2f38af9`；tower verdict clean/merge；节点 2 归档按五要件执行，不 push/merge
