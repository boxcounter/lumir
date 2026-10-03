// 滚动 / 视口几何收敛类 poll 的统一预算（M311，backlog「m132 ⌃V/⌥V 翻屏在全量负载下
// flake」的处置）。
//
// 此类 poll 等的是 CM 滚动 / 测量循环（或视口尺寸变更后的布局）收敛，默认 5s 预算在
// 全量负载（多 worktree 并行、CPU 争用）下会被吃完：m132 的 ⌥V「scrollTop == 0」三次
// 实证假红（失败读数恒为 8，单跑必绿；M288 / M298 / M299，docs/backlog.md 有登记）。
// 提到 15000ms 覆盖全量负载档。只提预算——期望值一律不动，放宽期望等于拿容差吞回归
//（REVIEW.md 第 3 条同族）；真机语义不动（判别层在真机验收套件）。
export const SCROLL_SETTLE_TIMEOUT = 15_000;
