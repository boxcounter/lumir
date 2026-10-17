# Proposal: 忽略分档改成单键地图（名字 → 档位）

- Change ID: ignore-tiers-map
- 日期: 2026-10-17
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> **裁决留痕（2026-10-17，逐字）**
>
> Alex 指出问题（原话）：「但这里有一个隐式语义：hidden 比 lazy 更严格，hidden 里的默认就具备了
> lazy 的效用。但是从命名上看不出来这个隐式语义。」
>
> 随后裁决（原话）：「采纳你的推荐方案（单键地图）。」
>
> 推荐方案原文：「改结构：单键地图。`"vault": { "ignore": { ".git": "hidden",
> "node_modules": "lazy", ... } }`——档位从「键名」变成「值」，每个名字的级别写在自己身上，
> 隐式语义从结构上消失。附带好处：同名冲突规则（「两键都有按 hidden 生效 + warning」）
> 整个不需要了，移动档位从「跨数组剪切粘贴」变成「改一个词」。」
>
> **预审（2026-10-17，「都采纳」）**：单键 `ignore` 地图（名字 → `hidden` / `lazy`）；缺省即默认
> 不变；同名冲突规则消亡；行为语义（四层判定、watch 分流、剪枝）不变、只换配置面；对刚归档的
> `hidden` / `lazy` 两键**直接切断、零兼容层**。据此本 change **不再设提案评审节点**（预审已覆盖
> 节点 1 的裁决面），实现完成后直接进归档评审。

## Why

1. **旧形态带一条从名字读不出来的隐式语义**。change `ignore-tiers-config`（2026-10-17 归档）把忽略
   名单拆成 `[vault].hidden` 与 `[vault].lazy` 两个名字数组。这里 `hidden` 比 `lazy` 更严格：一个
   `hidden` 名字同时具备 `lazy` 的全部效用（不进枚举、不进索引），反过来不成立。档位的「强弱」
   只存在于代码的判定顺序里（fs-io「全类型递归枚举」的 `hidden` → `lazy` → 用户规则 → 可见），
   配置文件上两个并列的数组看不出这层关系——写配置的人会先读成一个错误的语义（「两个互斥的
   分类」），再被行为纠正。
2. **同名冲突规则是旧结构逼出来的补丁**。两个数组允许同一个名字同时出现在两边，于是要定义
   「按 `hidden` 生效 + warning」。这不是产品语义，是两个容器之间的结构缺陷。
3. **移动档位在旧结构里是剪切粘贴**：把 `target` 从惰性挪成不可见 = 从 `lazy` 数组删一行、往
   `hidden` 数组加一行，两处编辑、顺序还会影响 warning 的判读。
4. **单键地图让这三件事同时消失**：档位成为值（`"target": "hidden"`），每个名字的级别写在自己
   身上；对象键天然唯一，同名冲突这个类别结构上不存在；移动档位是改一个词。

配置面本身的解析、校验、warning 与生效时点沿用 `ignore-tiers-config` 已落地的模型（ADR 0002
第 5 条：配置即数据、schema 校验、非法值人话回落）。本 change 只换**配置面的形状**，不动判定行为。

## What Changes

对应 `specs/fs-io/spec.md` 的 1 条 MODIFIED 与 `specs/file-tree/spec.md` 的 1 条 MODIFIED——
两者都只改「名字从哪来」这一段的表述，判定链、惰性语义、索引 / watch / 剪枝行为零改动。

1. **配置面**（`[vault]` 表内，与 `rule_files` 并列）：

   ```json
   {
     "vault": {
       "rule_files": [".gitignore", ".git/info/exclude"],
       "ignore": {
         ".git": "hidden",
         ".DS_Store": "hidden",
         "node_modules": "lazy",
         "target": "lazy",
         "...": "lazy"
       }
     }
   }
   ```

   键是**名字**（与旧形态相同的合法性：非空、不含 `/`、不是 `.` / `..`、不含 gitignore 元字符
   `* ? [ ] ! # \`、首尾无空白），值是**档位**（闭集合 `"hidden"` / `"lazy"`）。

2. **缺省即默认，粒度改为整图**：`vault.ignore` 缺席（或缺整个 `[vault]` 节、或配置文件不存在）
   ⇒ 用代码内置的**默认地图**；键存在（含 `{}`）⇒ 整图按配置解释。MUST NOT 在安装时把默认值
   快照写入配置文件。默认地图与旧版默认名单逐名等价：

   | 档位 | 名字 |
   |---|---|
   | `hidden` | `.git`、`.DS_Store` |
   | `lazy` | `node_modules`、`.venv`、`venv`、`__pycache__`、`.next`、`.nuxt`、`.cache`、`.pnpm-store`、`.tox`、`.gradle`、`test-results`、`perf-results`、`target`、`dist` |

   不在图里的名字 ⇒ 走用户规则 / 完全可见（「第三档」照旧，不需要第三个键）。

3. **同名冲突规则消亡**：名字是 JSON 对象的键，一个名字只能有一个值。「两键都有 ⇒ 按 `hidden`
   生效 + warning」这条规则与它对应的 warning 一并删除，不保留、不改为「重复键 warning」。

4. **非法项的处理口径不变、落点改为地图项**：名字非法 ⇒ 丢该项 + 一条人话 warning；档位值非法
   （非字符串 / `"invisible"` 一类）⇒ 丢该项 + 一条人话 warning；其余项照常生效。整个 `ignore`
   键给错类型（如 `"ignore": "hidden"` 或 `"ignore": []`）仍走既有解析模型的**整文件回落**。

5. **行为语义一律不变**：四层判定（`hidden` → `lazy` → 用户规则 → 可见）、前两档命中即定格、
   用户规则取反翻不动前两档、watch 按档分流、惰性条目不进索引、`hidden` 档剪枝、临时文件模式
   恒定硬编码——全部保持 change `ignore-tiers-config` 归档后的现行文本，本 change 只把「名单从
   两个数组来」改成「名单从一张地图来」。

6. **对 `hidden` / `lazy` 两键直接切断**（AGENTS.md「变更默认直接切断」）：**零兼容层**——不读旧
   键、不双写、不给迁移提示以外的过渡路径、不留「旧键仍在时按旧键」的分支。举证（消费者是谁）：
   该配置面发布不足一天，唯一消费者是 Alex 本人的 `~/.config/lumir/config.json`；该文件的迁移由
   tower 在合并后执行（Alex 已预授权，备份 `config.json.bak-20261017`），不在本 change 的代码范围内。

## Non-goals

- **不支持模式**（`*.log`、`build*`、`!foo`）：键仍然只收名字。
- **不做 per-vault 覆盖**：一份全局配置，与 `rule_files` 同口径。
- **不做运行期热生效**：改配置下次装载生效。
- **不新增档位**：`hidden` / `lazy` 两档不变，不引入 `visible` 之类的显式第三值——「不在图里」
  就是第三档。
- **不改临时文件模式**：`.lumir-*` / `.*.lumir-*` 仍恒定硬编码、不在配置面内。
- **不写迁移代码 / 不读旧键**：见 What Changes 第 6 条。
- **不改 `rule_files`**：语义、默认值、校验与生效时点一律不动。

## Impact

- **影响的 specs**：
  - `fs-io`：1 条 MODIFIED——「全类型递归枚举」的「名字由配置给出」段与相关 scenario 的键名，
    判定链、watch、索引、剪枝、临时文件模式条款原样保留。
  - `file-tree`：1 条 MODIFIED——「全类型文件树展示」里两个档位的键名引用（`vault.lazy` /
    `vault.hidden` → `vault.ignore` 的档位值），可见集与「单一真源」条款不变。
- **影响的代码/系统**（概述，细节见 design.md）：
  - `src-tauri/src/config.rs`：`VaultConfig` 的 `hidden` / `lazy` 两字段换成 `ignore` 单键地图
    （名字 → 档位枚举）；两个默认常量收成一张默认地图；`validate_vault` 改为逐项校验地图项；
    单测全面改写。
  - `src-tauri/src/fs_io.rs`：`IgnorePolicy::load` 的入参改为一张地图（内部仍编译 hidden / lazy
    两个匹配器，判定链不变）；单测构造口径同步。
  - `src-tauri/src/commands.rs`：`prepare_vault_open` 把地图交给 `IgnorePolicy::load`。
  - `src-tauri/src/harness/{tools,turn}.rs`：**仅测试模块**里构造默认策略的 5 个调用点随
    `IgnorePolicy::load` 入参改动（生产代码零改动）。
  - `src-tauri/tests/**`：构造默认策略的调用点同步。
  - `src/bindings/**`：ts-rs 重导出（新增档位枚举、`VaultConfig` 形状变化）。
  - `docs/specs/config-reference.md`：`[vault]` 节改写成单键地图（含默认地图全表与非法项口径）。
  - `scripts/acceptance/scenarios/67-vault-open-ignore-set.md`：覆盖边界里键名的表述改准；
    场景断言本身走默认值，无需重写。
- **关联约束**：ADR 0002 第 5 条（配置即数据 / schema 校验 / 非法值人话回落）；ADR 0002 第 6 条
  （性能合同：惰性条目不递归、不进索引，本 change 不引入新的枚举量）；ADR 0002 第 7 条
  （fs_io 不依赖 tauri 类型）；REVIEW.md「同一语义两处真源」条（默认名单只留一张表，档位只存在
  一处）。

## 裁决点

无。设计要点已由 Alex 2026-10-17 预审「都采纳」，原文见文首裁决留痕。
