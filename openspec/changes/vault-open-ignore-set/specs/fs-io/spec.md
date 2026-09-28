# fs-io 增量规格

> 起草注记（非规格正文）：本 delta 只有一条 MODIFIED，基线是 living spec
> [openspec/specs/fs-io/spec.md](../../../../specs/fs-io/spec.md) 的「全类型递归枚举」
> （本 change 起草时的 master 上无活跃 change，无需等待别的归档）。

## MODIFIED Requirements

### Requirement: 全类型递归枚举

系统 SHALL 提供 `fs_scan_workspace` command 对当前 vault 做全类型递归枚举，返回条目清单：相对路径、文件/目录类型、大小、mtime。枚举 MUST NOT 按扩展名过滤（ADR 0001 全文件类型一等公民）。旧 stub 签名（`WorkspaceSnapshot` / 返回 `Option`）废弃，MUST NOT 在其上累代码（架构复查 P2-5）。

默认忽略集 SHALL 硬编码为 `.git`、`.DS_Store`、`node_modules`、`target`、`dist`、`build`、`out`、`vendor`、`.venv`、`venv`、`__pycache__`、`.next`、`.nuxt`、`.cache`、`.pnpm-store`、`.tox`、`.gradle`、`test-results`、`perf-results`。⚠ 裁决点 C 的原始理由（忽略集保护性能合同；一等公民的是文件类型而非 VCS 内部目录）仍然成立；本 change 把名单从「VCS 与包管理内部目录」扩到「构建产物目录族」，依据与实测见 change `vault-open-ignore-set` 的 proposal 与 design §2。该集合本 change 内仍不可配置——「读 VCS 配置（`.gitignore` / `.git/info/exclude`）」与「用户自定义忽略名单」都是独立裁决（该 change 的裁决点 1），MUST NOT 顺手实现。

忽略判据 SHALL 是**名字的纯函数**：逐字节精确匹配（大小写敏感、不含通配与前后缀——`dist-old` 不命中 `dist`，`Target` 不命中 `target`）、在**任意深度**生效（不只在 vault 根）、且与条目类型无关（同名目录连同其整棵子树一并剪掉，同名文件同样被忽略）。判据 MUST NOT 依赖条目类型或磁盘 stat：`watch` 事件侧的同一判据只能看到路径组件（被删条目 stat 不到），依赖类型会让枚举与 watch 分叉。vault 根自身的名字不参与判据（`target` 目录本身可以作为 vault 根打开）。

枚举、watch 事件流、目录改名的子树展开、新建/改名的末段名校验 SHALL 共用**同一份**名单真源，MUST NOT 在各处另抄一份列表（REVIEW.md 第 8 条）。被忽略的条目 SHALL NOT 进入枚举结果、watch 事件流与由枚举建出的链接索引，因此也不参与 wikilink 解析、附件索引与文件树。新建/改名命中名单时 SHALL 返回 `fs_name_invalid`（沿用既有行为，MUST NOT 因扩集而放松）。

**已知边界（如实记录）**：名单是启发式，MUST NOT 被读成完备解——构建系统的输出目录名不可枚举（`_build` / `zig-out` / `.svelte-kit` / `coverage` 等不在名单内）；名字匹配不折叠大小写；且按名隐藏会让用户内容静默消失（一个叫 `build` 的笔记目录会从树、链接索引与 wikilink 解析里一起消失，用户新建/改名成这些名字会被拒绝）。取舍、代价与缓解（诊断日志的忽略计数）见该 change 的 design §3。

#### Scenario: 混合类型 vault 全量列出

- **WHEN** vault 内含 md、代码文件、图片、PDF、无扩展名文本与嵌套目录
- **THEN** 枚举结果包含全部条目（忽略集除外），不只含 Markdown

#### Scenario: 忽略集生效

- **WHEN** vault 根含 `.git/` 目录、`node_modules/`、`target/`、`dist/`、`test-results/` 与 `.DS_Store` 文件
- **THEN** 枚举结果不含这些条目及其子孙

#### Scenario: 任意深度的构建产物目录被剪枝

- **WHEN** `crates/app/` 下有构建产物目录 `crates/app/target/debug/x`，同目录另有内容文件 `crates/app/notes/a.md`
- **THEN** 枚举结果含 `crates/app/notes/a.md`，不含 `crates/app/target` 及其下的任何条目

#### Scenario: 名字相近的目录照常枚举

- **WHEN** vault 内含 `dist-old/`、`targets/`、`builds/` 目录
- **THEN** 它们与其中的文件正常出现在枚举结果里（判据是精确名字，不是前缀或通配匹配）

#### Scenario: 同名文件与目录一视同仁

- **WHEN** vault 内含一个名为 `build` 的无扩展名文件
- **THEN** 它同样被忽略（判据与条目类型无关，理由见本条正文）

#### Scenario: vault 根与忽略集同名不影响

- **WHEN** 用户把名为 `target` 的目录作为 vault 打开，其内含 `a.md`
- **THEN** 打开成功，枚举结果含 `a.md`（vault 根自身的名字不参与判据）
