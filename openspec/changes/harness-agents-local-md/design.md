# Design: harness-agents-local-md

技术设计说明。节点 1 评审以 [proposal.md](proposal.md) 为准；本文记录实现期技术细节与行为合同，供实现 worker 与归档评审对账。

**术语**：沿用 living spec `harness` 的装配术语（`assemble_system` / 装配清单 / `session_open.assembly`）。**本地覆盖层**（本 change 用语，就地定义）：vault 根 `AGENTS.local.md`——与本机私有内容对应、不随 vault 版本控制走的第三层 AGENTS 指令文件。

## 1. 调研结论（现状事实锚点）

以下经只读调研核实（worktree wt-426，base master），是设计决策的事实基础：

- **装配是串行三段**：`assemble_system`（`src-tauri/src/harness/context.rs:103-153`）依次装配——IDENTITY → QUOTE_REFERENCE（`push_section`）→ user-wide AGENTS.md → vault 根 AGENTS.md → Skill 索引；每层先 `manifest.push`（`AssemblySource::file`）再按存在与否 `push_section`。**正文顺序 = 清单顺序**是现存的隐含不变量，本 change 保持。
- **读取与判定单一入口**：`vault_root.join("AGENTS.md")`（`:122`）+ `read_agents_md`（`:174-179`）——`is_file()` 为假直接 `None`；否则 `fs::read_to_string().ok()`，非 UTF-8 / IO 错误一律 `None`，静默跳过。第三层完全复用此函数，零新判定逻辑。
- **清单元素形态**：`AssemblySource { source: &'static str, path, exists, bytes, skills }`（`:58-71`）；来源标识为静态串。新增来源名 **`agents_vault_root_local`**（与既有 `agents_vault_root` 并列）。
- **section 形态**：`push_section(out, title, body)` 产出 `\n\n===== <title> =====\n<body>`（`:157-159`）；标题是给模型的可读锚，也是本 change 表达覆盖语义的载体。
- **现有测试须同步**：`assemble_system_skips_missing_agents_and_includes_index`（`:372-437`）断言 `manifest.len() == 5` 并按下标读来源（2 = user-wide、3 = vault 根、4 = skill_index）；加第三层后 len 变 **6**、skill_index 下标 4→**5**，该测试必须同步更新（否则单测红，不是「顺带」）。

## 2. 行为合同（对应 spec 增量）

- **注入顺序**：user-wide `AGENTS.md` → vault 根 `AGENTS.md` → vault 根 `AGENTS.local.md` → Skill 索引。第三层排在 vault 根 `AGENTS.md` 之后、Skill 索引之前。
- **覆盖语义靠位置 + 标题表达**：system prompt 是给模型的平面文本，没有结构化优先级字段。第三层「后位为准」由两件事共同表达——(a) 注入位置在后；(b) 该节标题显式声明「本机本地覆盖层，与上文 AGENTS.md 冲突时以此为准」。模型据此后置覆盖/补充；系统 MUST NOT 自行解析、合并或判定两层内容的语义（本 change 不引入 merge 算法）。
- **缺失口径**：第三层文件不存在 / 非文件 / 读取失败 ⇒ 静默跳过（不注入、不告警、不阻断会话），与既有两层逐条一致。
- **装配清单**：无论存在与否，`session_open.assembly` 都含 `agents_vault_root_local` 条目（路径 + `exists` + `bytes`；不存在时 `exists:false`、`bytes:0`）。清单顺序即：identity、quote_reference、agents_user_wide、agents_vault_root、**agents_vault_root_local**、skill_index。

## 3. 装配细节

装配点（`assemble_system`，紧跟 vault 根 AGENTS.md 的 push 之后、`discover_skills` 之前）：

```rust
let vault_local_path = vault_root.join("AGENTS.local.md");
let vault_local = read_agents_md(&vault_local_path);
manifest.push(AssemblySource::file(
    "agents_vault_root_local",
    vault_local_path,
    vault_local.as_deref(),
));
if let Some(vault_local) = &vault_local {
    push_section(
        &mut out,
        "vault 根 AGENTS.local.md（本机本地覆盖层，与上文 AGENTS.md 冲突时以此为准）",
        vault_local,
    );
}
```

- 复用 `read_agents_md` 与 `AssemblySource::file`（零新类型、零新判定）；插入点保证正文顺序与清单顺序一致。
- section 标题措辞即覆盖语义的载体：把「本机本地覆盖层」与「冲突时以此为准」写进标题，是模型据以在两层冲突时选对后者的唯一依据。
- 零配置、零 UI、零 ts-rs 面变化（`context.rs` 不导出新类型）。
- 读取时点与会话建立 /「新会话」/ 自动压缩三者共用 `assemble_system`——运行期新增或修改 `AGENTS.local.md` 下个会话生效（与既有两层同口径，本 change 不引入文件 watcher）。

## 4. 测试与验收

**Rust 单测**（`context.rs` 的 `mod tests`，复用 `HOME_LOCK` + `EnvGuard` 既有基建，fixture 全部合成）：

1. **三处齐备**：user-wide / vault 根 `AGENTS.md` / vault 根 `AGENTS.local.md` 各写合成内容 → `assemble_system` 文本含三份内容；断言字符串下标顺序 `vault AGENTS.md 内容 < AGENTS.local.md 内容`（顺序不变量）；`manifest.len() == 6`，新来源 `path` 以 `AGENTS.local.md` 结尾、`exists`、`bytes` 正确。
2. **缺失静默跳过**：仅本地层缺失（其余照常）→ 文本不含其内容、不 panic；该清单条目 `exists:false`、`bytes == 0`。其余各层注入不受影响。
3. **同步既有断言**：更新 `assemble_system_skips_missing_agents_and_includes_index` 的 `manifest.len()`（5→6）与下标（skill_index 4→5），并在其「空 HOME + 空 vault」分支补断言本地层条目的 `exists:false`。

**真机验收**（`scripts/acceptance`，mock provider；fixture 全部合成）：新会话 → 读会话 JSONL 的 `session_open`，断言装配清单含 `agents_vault_root_local` 条目且 `exists` 与 fixture 布置一致；fixture vault 预置三处文件时断言 system prompt 中本地层内容排在 vault 根 `AGENTS.md` 内容之后。

## 5. 边界与已知 Limit（如实登记）

- **空文件**：`read_to_string` 返回空串 ⇒ `exists:true`、`bytes:0`，`push_section` 注入一个空体节——与既有两层现状一致，本 change 不特判（MUST NOT 因此把空文件读成「不存在」）。
- **大文件 / 超长内容**：不设长度上限，与既有两层同（AGENTS 类文件是人写的短指令文件，不额外设限）。
- **不做内容级合并**：两层冲突时的取舍完全交给模型（见 §2），本 change MUST NOT 引入解析/合并/diff——那是独立议题，且会与「system prompt 平文本」的事实冲突。
- **文件树可见性**：`AGENTS.local.md` 落在 vault 根会被文件树列出（与 `AGENTS.md` 同），本 change 不隐藏、不加角标——Non-goal。

## 6. 归档对账

- `openspec archive` 只并入 requirement 增量，**不重写既有 capability 的 Purpose**。living spec `harness` 的 Purpose 现有「AGENTS.md 双层（user-wide `~/.agents/AGENTS.md` + vault 根）」措辞——归档时须手改为三层口径（任务 3.4），否则 living spec 的概览与 requirement 正文自相矛盾。
