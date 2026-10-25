# 长期口径与已裁暂缓事项

- 日期: 2026-10-24
- 角色: Alex Lee（裁决），AI agent（整理迁移）

## 这份文件是什么

`docs/backlog.md` 只留活项（每条的出口见该文件）。曾长期留在 backlog「记录在案」的裁决、暂缓与否决迁到这里：它们仍约束未来的措辞 / 口径，但不是待办。

**产品语义的 canonical 仍是对应 living spec / ADR**——本文件不复制条款，只登记「已裁 / 暂缓 / 已知边界」与去向。相关能力下次动到时，把仍生效的口径并入其 living spec / ADR，并从本文件删除对应条目（git 历史留档）。接受现状类条目要在改动对应能力时复核一次。

## 一、已裁暂缓 / 否决（技术）

- **增量建图暂缓**（M283 裁）：`build_graph` 的持久化缓存本阶段不做——收益与索引一致性风险不成比例。复核：大 vault 建图成为实测瓶颈，或索引一致性机制落地时。
- **树 DOM 虚拟化否决**（M283 裁）：否决依据是代码结构——切换路径上的 DOM 行数 = 根级条目数，不是「一次建出 8000+ 行」；代价是跨 capability 高风险重写。复核：文件树渲染路径重写时。
- **快捷键治理后置**（Alex 2026-10-03，pane 化提案节点 1 裁定）：等产品总体框架基本敲定后再做专项键位治理；此后各 change 的键位指配按「单段、顺手、零冲突」从简，不做跨功能全局键位体系。复核：总体框架定稿。
- **仅大小写改名不可达**（M244 r1 P2-3，tower 裁「本批不做两步改名」）：大小写不敏感文件系统上方向 fail-safe（拒绝而非覆盖）。要修时落点 `fs_io::rename_entry`：识别「目标存在且与源同一个文件」时先改临时名再改目标名，自带回滚与文案。复核：出现「只改大小写」的用户需求时。
- **rename 的「撞名不覆盖」是复查 + 极窄窗口，不是原子保证**（M244 r1 P2-2）：零窗口需平台原子排他改名（macOS `renamex_np(RENAME_EXCL)` 等），引 libc 与平台分支收益与风险不成比例。复核：需要跨进程原子保证时。
- **`applyListIndent` 的 `state.readOnly` 守卫当前无可达入口**（M249，tower 裁「保留守卫」）：文档 / 场景只许写成「不可达、不构成覆盖声明」。复核：`applyListIndent` 的调用面变化时。
- **`vault_append`（追加工具）视盘点后补**（2026-10-09，change `add-harness-permission-modes` 的 Non-goal）：触发条件 = vault 写工具的 dogfood 盘点出现「追加」类高频缺口；届时按 ADR 0007 Decision 7 的边界原则判断是否立项。
- **harness 会话键 = vault 根路径字符串**（M312，不修）：`VaultScope::key()` 返回根路径字符串，同一 vault 的两种路径拼写各成一个会话；会话留存目录名另用注册表 id（`sessions/<id>/`），运行时 key 与留存目录**解耦**。复核：仅改运行时 key（规范化 / 换键）**不要求**迁移 `sessions/<id>/`，要复核的是恢复归属匹配（归属判据读留存首行 `session_open.vault_root`）；只有改 vault 稳定 id 或存储布局时才涉及目录迁移。
- **wire 原生增量留存：未来评估**（M394，2026-10-08）：现行为全量落盘；是否改 Claude Code / Kimi Code 形态的增量记录，等留存体积成为实测问题。
- **js / ts 对象字面量键的复合 `property` token 有意不修**（M147，low）：`{1: "x"}` 的数字键取数字色、字符串键取字符串色（通行呈现）；伴一条 `Unknown highlighting tag property` console 噪声。若将来裁「对象键一律属性色」，做法见 finding `20260917-worker-jsonhl-improve-javascript-typescript-property-token-console-json-js-ts`。
- **`format_argv` / `formatArgv` 的空白字符类边际分叉**（M528 r1 P2-2，low）：Rust `char::is_whitespace` 按 Unicode White_Space，JS `\s` 额外含 U+FEFF——含 U+FEFF 的参数一侧加引号、另一侧不加，与 `src-tauri/src/harness/turn.rs` 声明两处产出「必须逐字一致」相悖（Rust 在 `:1592-1595`，前端在 `src/harness-panel.ts:2504-2508`）。现实 CLI 参数路径不可达（无含 BOM 的现实来源），只登记不改；复核：CLI 参数面出现 BOM / 不可见字符来源，或两处 `format_argv` 实现被改动时，二选一——Rust 显式排除 U+FEFF，或前端不再把 U+FEFF 当空白，并同步两处 doc comment。
- **共享 `CARGO_TARGET_DIR` 不采纳；dev-only 脚本化驱动入口另议**（Alex 2026-10-25 裁）：跨 worktree 复用 target 曾致假绿（M372，旧二进制被判成本轮产物），防线只做「测试二进制 mtime 晚于本轮最早源码改动」的机器判据，不做共享目录；脚本化驱动入口留作长期候选，本轮不立项。复核：门禁判据退化到无法机器判定「本轮确实重编译」，或驱动入口出现明确消费者（同类假绿再次发生）时。
- **82/83/85 与场景 148：产品侧 reconcile 暂缓**（Alex 2026-10-25 裁）：先由套件自有 CGEvent 探针（P2）定性 post-menu 态的注入通道；产品 reconcile（P1）不按首批立项，P3（click 落点参数 + 剪贴板 Paste）留备选。实施项见 `docs/backlog.md` 的 CGEvent 探针条。复核：探针结论出来、或菜单 Paste 注入族（134/141/150）再次阻塞验收时。
- **vault 切换 perf 门禁取相对回归**（Alex 2026-10-25 裁）：新增 `vault-switch` 端点，判据沿用 `docs/specs/perf-measurement.md`「相对回归门禁」的既有统计口径（当次 median vs 滚动基线 median + 逐指标容忍线），不设绝对阈值。端点与读数实现见 `docs/backlog.md` 的 vault perf 端点条。复核：该指标噪声带稳定后仍掩盖真实回归时，再评估绝对阈值。

## 二、UI / 设计长期口径

- **S15 / S16 · 键位面板维持 680px 三列**（Alex 2026-09-25 裁，M220 登记）：有意偏离定稿的 440px 两列——命令列对排查自定义 `keys` 配置有实际用途。复核：键位面板重做时。
- **UX 动荡期整页基线纪律**（Alex 2026-10-03，M311）：UX 改动期内整页像素基线不在每个批次中途重刷，攒到 UX 批次末尾一次性 `--update-snapshots=all` + Alex 过目一次；元素级断言与 CI 结构层照常逐批守。纯基线增量 commit（零代码）的复审轮由 tower 亲自做机械核验后落 verdict。复核：UX 批次收尾。

## 三、环境观察

- **M458 标题栏 / modeline 偏移**（worker-flicker-a524，2026-10-15 探针收窄）：内置屏 display-sleep/wake 路径已排除——WindowServer 日志证纯面板电源循环（无 display reconfigure / mode change），睡眠前后窗口 backing store 逐字节一致；剩余候选触发源 = 外接显示器插拔 / 分辨率-ProMotion 档位变化 / 跨屏移动 / 合盖。症状再现时先截图别动窗口取证；Cmd± 与拖 1px 均不自愈（自愈假设已证伪）。survey 全文 `.tower/comms/inbox/20261015-worker-flicker-a524-tower-survey-summary.md`（`.tower/**` 不入 git）。

## 四、已迁 canonical 的记录（指针，不复制正文）

| 主题 | canonical 居所 |
|---|---|
| 链接形态矩阵（相对路径非 md / 纯锚点 / 带锚点 md） | `openspec/specs/editor-live-preview/spec.md` 的 `classifyLinkTarget` 五类与 `↗︎` 口径 |
| composer「一步必有位移」豁免档 | `docs/specs/harness-composer.md` 的 HC3 已知边界 |
| A2 · 结束标记维持短双线 | `openspec/specs/editor-live-preview/spec.md`「正文末尾的结束标记」 |
| C6 · 代码块头部条维持围栏行 | `openspec/specs/editor-live-preview/spec.md` 的块级复制 / 全屏口径 |
| `config.json` 解绑 ≠ 关闭能力 | `openspec/specs/keymap-commands/spec.md` 的原生选择器例外 |
| `scrollbar-gutter: stable` 禁则 | `openspec/specs/ui-design-system/spec.md`「滚动条分档与滚动容器注册表」 |
| toml 的 `[x]` / `[[x]]` 与布尔、日期共用 `atom` token | `openspec/specs/editor-live-preview/spec.md` 的代码高亮「已知例外」 |
| Harness UX 一揽子（事件标识 / 原型 / 宽度 / 模型选择 / 摘录卡片） | `docs/adr/0008-pane-system-split-view-and-harness.md` |
| 版本号 bump 口径 | `docs/process/release.md` |
| M277 块级复制 / 代码块全屏七条边界 | `openspec/specs/editor-live-preview/spec.md` 的块级复制与全屏 requirement、`docs/specs/table-reading.md` 的 64 KiB 降级；仅「窄块按钮向左溢出」「blur 兜底关闭未真机验」仍为已知边界（复核：块级复制 / 代码块全屏下次动到时） |
