# Design: 一键创建的索引外同名探测

> 依据：只读方案（Alex 授权材料，2026-11-22）与 `src-tauri/src/{commands,fs_io,link_graph}.rs`
> 的现状。本文件只写「怎么做」与判据落点；Requirement 正文在
> `specs/wikilink-resolution/spec.md` 与 `specs/fs-io/spec.md` 的 delta。

## 1. 不变量

- **I1 单份匹配语义**：候选判定 MUST 走 `LinkGraph::resolve_link`，MUST NOT 另写大小写 /
  alias / heading / `.md` 补全 / 路径后缀的匹配代码。探测因此天然覆盖 resolver 的全部形态。
- **I2 不完整 ≠ 不存在**：扫描只在「完整走完 vault」且「零候选」时返回放行；超限、目录 /
  条目读取失败、异步任务异常一律拒绝创建。
- **I3 冲突优先**：扫描已看到的候选是既成事实，即使随后超限也照报 `wikilink_target_exists`；
  只有「零候选 + 不完整」才落 `wikilink_create_failed`。
- **I4 扫描不持锁**：`VaultState.inner` 的锁只覆盖两段短临界区（取快照 / 提交创建）。扫描在
  `spawn_blocking` 线程上，MUST NOT 捕获 `tauri::State`。
- **I5 索引不受探测影响**：临时 `LinkGraph` 用完即弃；`materialized` 集合不变；探测不读文档
  正文、不读新 `.gitignore`（用户规则取装载时编译的那一份）。
- **I6 代际对账**：提交前核对 root + generation（与 `apply_fs_changes` 同一先例）；不一致即
  整包丢弃，两个 vault 都不得误写。

## 2. 两阶段流程（`commands.rs`）

```
wikilink_create (async command)
  └─ create_note_guarded(state, from, link)
       └─ create_note_guarded_with_budget(state, from, link, ProbeBudget::default())
            ① 短持锁：root / policy.clone() / generation；graph.create_target(from, link)?
               （词法、路径、unsupported、「当前索引已可解析」都在这里，语义不复制）
            ② spawn_blocking(probe_unindexed_duplicate(root, policy, from, link, budget))
               —— 不捕获 State；闭包只拥有 root/policy/from/link
            ③ finish_create_in_same_generation(state, root, generation, from, link)
               root + generation 相符 → graph.create_note(root, from, link)
```

- 第 ① 段的 `create_target` 返回值不参与后续（提交段会重算），只作为既有校验的入口；
- 第 ② 段的 `JoinError` → `wikilink_create_failed`（"同名探测任务异常结束"）；
- 第 ③ 段复用原有 `create_note`：它会再查一次索引并按 `create_new`（O_EXCL + 逐级
  `O_NOFOLLOW`）创建，不覆盖既有文件。

## 3. 有界扫描（`fs_io::scan_vault_for_wikilink_target`）

返回 `ProbeScan { files, complete, incomplete_reason }`；预算类型 `ProbeBudget
{ max_entries: 20_000, max_duration: 250ms }`（`Default` 即生产值）。

遍历口径：

| 条目 | 处置 |
|---|---|
| `hidden` 档目录 | 整棵剪掉（不递归、不进候选） |
| `hidden` 档文件 | 不进候选 |
| 配置 `lazy` 档 / 用户规则命中的目录 | **照常递归**（本缺陷的关键面） |
| 普通目录 | 递归 |
| 普通文件 | 收进候选（不读正文） |
| 符号链接（文件 / 目录 / 环） | 不跟随、不读目标；按**非目录候选**收进（目录链接不会递归） |
| 非 UTF-8 / 越界路径 | 跳过（wikilink 无法引用，不构成候选，也不算失败） |
| 目录读取失败 / 条目读取失败 / `file_type` 失败 | `complete = false` 并停止（fail-closed） |
| 访问条目数 > `max_entries`，或耗时 ≥ `max_duration` | `complete = false` 并停止 |

deadline 在每个目录与每个条目处理前检查；不做整目录排序，结果集不越过预算。

**为什么不能复用 `scan_vault_files`**：它无上限、跳过 `lazy` 目录、静默忽略读取失败——三项
都恰好与本判据相反。也不能用 `scan_workspace` / `scan_dir`：前者不递归惰性目录，后者会登记
materialized 并带临时文件清理副作用。

## 4. 临时图与判定（`commands::probe_unindexed_duplicate`）

1. `scan_vault_for_wikilink_target(root, policy, budget)`；
2. 对 `scan.files` 逐条 `graph.upsert(path, None)`（不读正文：标题锚点只影响 anchor 状态，
   不影响 resolved / ambiguous）；
3. `graph.resolve_link(from, link)?`：
   - `Resolved` → `wikilink_target_exists`，诊断消息带命中路径；
   - `Ambiguous` → `wikilink_target_exists`，诊断消息带候选列表（不选择、不打开）；
   - `Unresolved` → 继续；
   - `Unsupported` 不可达（`create_target` 已拒绝 `#^` 块引用）；
4. `!scan.complete` → `wikilink_create_failed`，消息带 `incomplete_reason`；
5. 否则 `Ok(())`，进入提交段。

## 5. 错误与文案映射（复用，不新增）

| 情形 | code | 前端文案 |
|---|---|---|
| 索引外已有候选（含多候选） | `wikilink_target_exists` | D192「目标已存在（索引可能已过期）」 |
| 超限 / 读不到 / 任务异常 / 代际变化 | `wikilink_create_failed` | D194「无法创建目标文件」 |
| 最终确定路径被外部抢先占用 | `wikilink_target_exists`（来自 `create_note` 的 O_EXCL） | D192 |
| vault 未打开 / 词法 / 路径非法 | 既有 code 不变 | 既有文案 |

D192 / D194 的文案模板没有占位符，因此这些构造点不追加 `params`；`src/link-follow.ts` 的
失败路径已是「清缓存 + 重解析 + toast，不打开文件」，本次零改动。

## 6. 预算初值与实测口径（待办）

初值 20,000 项 / 250ms **不是性能结论**。实测按四档读 p50 / p95 后再校准：小 vault、约两万
项的 vault、深惰性子树、符号链接环。单次 `read_dir` / `file_type` 系统调用不可被 deadline
中断，所以本设计只承诺「访问量有界 + 不占 IPC 主线程」，**不宣称硬实时上限**。

## 7. 判据落点

- `src-tauri/src/commands.rs`（`#[cfg(test)]`）：配置 / 用户规则惰性目录、多候选、大小写 /
  alias / heading、路径后缀、真正不存在仍创建、极小预算、目录不可读、hidden、符号链接目录
  不跟随、符号链接文件构成冲突、提交后落盘（索引过期）、代际变化（同 vault 重开 / 切换）。
  冲突类断言同时比较**全树快照**（零新增、字节不变）、常驻图仍 `unresolved`、`materialized`
  未变。
- `src-tauri/src/fs_io.rs`（`#[cfg(test)]`）：扫描口径（递归惰性 / 剪 hidden / 不登记物化）、
  条目与时长预算、目录不可读、符号链接不跟随且不读目标。
- `src-tauri/tests/wikilink_fixtures.rs`：既有 createCases 与
  `create_never_overwrites_existing_file`、符号链接父目录逃逸测试**原样保留**（它们测的是
  `create_note` 原语，语义未变）。
- 真机：新增合成验收场景（惰性 fixture 的 `tutorial.md` + 根文档 `[[tutorial]]`，点
  「创建并打开」→ D192 toast、仍在原文档、vault 零新增文件）。**本会话未起真机实例，
  场景未跑**（证据缺口如实登记在 tasks.md）。

## 8. 剩余边界

- 「探测结束 → 创建」之间外部进程往别的目录放同名文件：不可防（跨进程竞态）。最终索引复查
  与 O_EXCL 只保护确定路径。
- 拒绝后常驻索引仍解析为 `unresolved`（惰性候选不进索引是 I5 的必然结果）；用户再次点
  「创建并打开」会再次被拒——这是预期行为，不是死循环缺陷（产品没有提供逃生口，见 proposal
  的非目标）。
- 20k / 250ms 在超大 vault 上可能频繁触发 fail-closed；读数出来之前按安全侧处理。
