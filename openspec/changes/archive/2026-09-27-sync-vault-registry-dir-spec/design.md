# Design: sync-vault-registry-dir-spec

## §1 为什么是 MODIFIED-only、且只动一条 requirement

`vault-workspace` 的「vault 注册表与显式重映射」是唯一承载注册表目录路径字面的 requirement：全仓
grep `workspaces/` 在 `openspec/specs/**` 只命中 `spec.md:49` 一处；Purpose 段提到的是
`reading-positions/`，与本项无关。因此 delta 只有一条 MODIFIED，没有 ADDED / REMOVED / RENAMED。

MODIFIED 在 OpenSpec 的语义是**整条替换**，所以 delta 里的 requirement 正文必须携带其余全部条款
（稳定 id、remap 门与候选短路、候选按稳定 id 排序、tmp+rename 原子写、幽灵项惰性治理与宽限期、归档项
路径恢复后身份复位、治理幂等）。这些条款逐字照抄 living spec 现值，**只改路径字面并追加迁移段**——
避免「顺手润色」把一次文本追平变成一次无意重写。

## §2 为什么 living spec 与 delta 同批落盘（本仓的既定处置，不是流程创新）

按 `docs/process/openspec-workflow.md`，living spec 的合入发生在 `openspec archive`（节点 2 通过之后）。
但本仓库已有一类明确的例外并以之收口过：**实现先于规格、且 living spec 与实现直接矛盾**时，先落 retro
change + living spec 同步，再走归档对账——先例是 M150 的两件（`add-in-file-search`、
`align-editor-live-preview-spec`，均于 2026-09-17 归档）与 M181 的三件归档（`docs/backlog.md` 的
2026-09-17 / 2026-09-18 条）。

本项属于同一类且更硬：**实现已合并（`d989197`），矛盾点是一个路径字面**——保留矛盾等归档，等于让
「按 spec 排查会找到错误目录」再存活一个批次。M250 的 mission 因此明确要求「先落 change 制品 +
spec 同步，归档评审待 Alex 节点」。

代价与处置：delta 与 living spec 在该 requirement 上**逐字节相同**，因此后续 `openspec archive` 是幂等
替换、living spec 不产生任何 diff；对账只需核 `openspec/specs/vault-workspace/spec.md` 里的 requirement
名恰好出现一次、正文与 delta 一致（`tasks.md` §3 的条目就是这条）。

## §3 迁移条款的措辞依据（逐条对齐实现，不发明语义）

| spec 措辞 | 实现落点 | 说明 |
|---|---|---|
| 启动路径上的一次性迁移 | `lib.rs:118` 调 `migrate_legacy_registry_dir_at_startup()` | 调用点纪律：在**第一次解析配置目录之后、任何读注册表之前**（启动恢复线程与前端 command 都是读者），见 `vault_registry.rs:149-152` |
| 整个目录原子 rename | `vault_registry.rs:140` 的 `fs::rename(&legacy, &current)` | 同目录同文件系统 ⇒ 原子；搬的是整个目录，注册项与残留的 `*.json.tmp` 一并搬走 |
| 旧目录不存在 → 无动作、不记日志 | `RegistryMigration::NotNeeded` + `log_value() -> None`（`:94-113`） | 稳态（已迁过 / 全新安装）；每次启动记一条「无事可做」只会把日志刷成噪音 |
| 旧目录在、新目录不在 → 迁移 + 记一条诊断事件 | `Migrated` + `vault_registry_migrated(value="migrated")` | 事件名与 `outcome` 取值见 `logging.rs:99-100` |
| 新目录已存在 → 不动作 | `SkippedTargetExists`（`:98`、`:137-139`） | `fs::rename` 到非空目录在 Unix 本就失败（ENOTEMPTY）；「不动作」把这条失败转成显式终局而非错误路径 |
| rename 失败 → 旧目录原地保留、本次按空注册表运行、下次重试 | `Failed`（`:100`、`:142-146`） | best-effort：失败不拦启动（注册表读不到只表现为列表与 remap 候选为空，vault 仍可打开并重新注册）——与注册表治理同一条「有损可自愈」论证 |

**没写进 spec 的部分**（有意）：`RegistryMigration` 枚举名、`outcome` 的四个字面量取值、日志的
`eprintln` 文案。它们是实现细节，换实现名字不该让合同变红；spec 只钉「有没有诊断事件」与「注册项不丢」
这两个可观测事实。诊断事件名本身保留在 spec 里，因为它是**外部可观测面**（落盘日志、`LogEventName`
的 TS 联合类型）。

## §4 为什么不补真机 / 视觉判据

迁移的可观测证据现有三处、已足够：① Rust 四态单测（`vault_registry.rs` 的 `mod tests`，四态逐条）；
② 真机场景 `48-vault-registry-migration`（套件新增 `seed.legacyRegistry` 预置通道与 `resetRegistry()`
同清新旧两名目录，M248 同批落地）；③ 诊断事件可从日志直接读。本 change 不新增代码，按仓库纪律
「有实现才写判据」，任何新判据都只会是既有三处的重复。视觉层面无可见元素，不涉及基线。
