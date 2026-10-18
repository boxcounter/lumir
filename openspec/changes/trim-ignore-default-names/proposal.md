# Proposal: 从忽略地图默认名单里移除 `test-results` 与 `perf-results`

- Change ID: trim-ignore-default-names
- 日期: 2026-10-18
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

`DEFAULT_IGNORE`（`src-tauri/src/config.rs`，缺省忽略地图的唯一真源）里有两名是**本仓自己的产物目录**：`test-results`（证据根，2026-10-18 已迁移为 `.local/`）与 `perf-results`（perf 读数通道，同批并入 `.local/perf/`）。它们混在 `node_modules` / `.venv` / `target` / `dist` 这类**用户 vault 的通用形态**中间，等于产品替用户猜「这个名字大概是构建产物」——而这个名字的出处是本仓的历史布局，与用户的 vault 无关。

Alex 2026-10-18 原话（节点 1 裁决，直接给出了要做什么）：

> 「两个老目录之前硬编码在代码里（ignore 特性），并且也在我的配置文件里，都可以去掉了吧。」

「必须保留的就合并」是同一句裁决的另一半：要保留的是这两个目录的**内容与用途**（证据与 perf 读数），去合并成 `.local/` 下的场景桶；不保留的是它们的**名字**作为产品默认知识的一部分。

事实依据：

- 默认地图现值 16 名（2 hidden + 14 lazy），其中 `test-results` / `perf-results` 两名见 `src-tauri/src/config.rs` 的 `DEFAULT_IGNORE`；默认语义是「缺键即整图取默认」（living spec `fs-io`「全类型递归枚举」）。
- 用户配置面已由 Alex 自行收敛：本机 `~/.config/lumir/config.json` 的 `vault.ignore` 现为 14 名（与改后的 `DEFAULT_IGNORE` 逐名一致），两名均已不在其中。即本次改动是把**代码默认**拉齐到 Alex 已认可的那张表，不影响他的存量行为。

## What Changes

1. **删除 `DEFAULT_IGNORE` 里的两个 Lazy 条目**：`test-results`、`perf-results`。数组长度 16 → 14，档位划分 2 hidden + 14 lazy → 2 hidden + 12 lazy。
2. **行为变化（逐条写清楚，避免被读成「无变化」）**：
   - 没写 `vault.ignore` 的 vault：两个名字不再出惰性行，按普通目录逐层枚举、进索引。
   - 显式写了 `vault.ignore` 的 vault：**零变化**（整图按配置解释，默认表不参与）。
   - 新建 / 改名末段名为这两个名字：此前允许（lazy 档不拒），现在仍允许（不在图里 ⇒ 第三档），行为一致。
3. **spec 增量**：`fs-io`「全类型递归枚举」MODIFIED（默认地图清单 + 「已知边界」里补一句本仓产物名不再列入）；`file-tree`「全类型文件树展示」MODIFIED（默认 lazy 档名数 12、并写明名单 MUST NOT 在树侧硬编码）。两处都是同一语义的表述同步，不引入新能力。
4. **测试与验收同步**：`config.rs` 的默认地图不变量测试（16→14 名、14→12 lazy）、`fs_io.rs` 的逐名匹配测试（两名移入「MUST NOT 命中」组）、真机场景 67 的第三个惰性档探针（`test-results` → `.cache`，该场景验的是惰性档可见性，不是本仓目录名）。

## Non-goals

- **不改用户已有配置**：Alex 的 `~/.config/lumir/config.json` 已自行删掉两名；仓内不做任何「迁移 / 双写 / 兼容层」（零读者场景，按「变更默认直接切断」）。
- **不动两档机制本身**：`hidden` / `lazy` 的档位语义、判定顺序、用户规则优先级、临时文件模式恒定硬编码，逐字不动。
- **不新增第三个档位或「显示被忽略项」开关**（既有 proposal 已记为后续候选，与本 change 无耦合）。
- **不改 `docs/specs/perf-measurement.md` 的合同数字**，也不改 `.local/perf` 通道本身——perf 产出路径的迁移由同一 mission 的路径改动承担，不在本 change 的 spec 增量里。
- **不改历史证据文档**里写着 `test-results/...` 的旧指针（mission 报告、探针读数、历史评审）；换算规则见 `.local/README.md`。

## Impact

- 影响的 specs：`fs-io`（1 条 MODIFIED）、`file-tree`（1 条 MODIFIED）
- 影响的代码/系统：`src-tauri/src/config.rs`（`DEFAULT_IGNORE` 与一处默认地图不变量测试）、`src-tauri/src/fs_io.rs`（一处逐名匹配测试的名单与两处注释里的名数）、`scripts/acceptance/scenarios/67-vault-open-ignore-set.md`（第三个惰性档探针改名）、`scripts/acceptance/lib/app.mjs`（同一句 fixture 注释）、`docs/specs/config-reference.md`（默认地图表）
- 关联约束：ADR 0002 §5（缺省即默认的口径不变）；ADR 0004（本 change 走 OpenSpec 节点 1 / 节点 2 两个评审点）

## 评审记录

### 节点 1：提案评审

- **日期**：2026-10-18
- **裁决**：通过（Alex 原话即裁决，含要做什么与为什么）
  > 「两个老目录之前硬编码在代码里（ignore 特性），并且也在我的配置文件里，都可以去掉了吧。」
- **裁决面**：`DEFAULT_IGNORE` 移除 `test-results` / `perf-results` 两条；「必须保留的就合并」= 两个目录的**内容**并入 `.local/`（证据桶 + `.local/perf`），删除的是它们的名字在默认表里的位置。
- **落地口径确认**：Alex 的配置文件面已自行收敛（`vault.ignore` 现 14 名，两名不在其中），因此本 change 不涉及用户配置迁移，只把代码默认拉齐。
