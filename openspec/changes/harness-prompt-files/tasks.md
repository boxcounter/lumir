# Tasks: harness-prompt-files

> 节点 1（提案评审）已于 2026-10-17 通过（Alex 批准；tower 转达命名与 scope 裁决），实现期逐项勾选。

## 1. 提示词文件与嵌入

- [x] 1.1 新增 `src-tauri/src/harness/prompts/identity.md`：正文由旧 `IDENTITY` 字面量机械生成（临时夹具 `format!("{IDENTITY}\n")` 写盘），逐字节迁移，未手抄。Rust 行尾续行 `\` 不产生字节：字面量里用 `\` 拼接的位置在 Markdown 里是同一物理行，未折行；空行原样保留（11 行 / 1346 字节，含文件尾换行）
- [x] 1.2 新增 `src-tauri/src/harness/prompts/quote-reference.md`：同样机械生成（1 行 / 1171 字节，含文件尾换行）；正文本身无换行，尾换行交给装配处 trim 消化
- [x] 1.3 `context.rs`：`IDENTITY` / `QUOTE_REFERENCE` 改为 `include_str!("prompts/identity.md")` / `include_str!("prompts/quote-reference.md")`，两份 Rust 字面量已删除；模块头注释改为指向提示词文件
- [x] 1.4 `context.rs`：装配处对两段各 `trim_end()` 一次，注入文本与 `bytes` 都用 trim 后的结果（其余不做任何规范化）
- [x] 1.5 `AssemblySource::fixed` 增来源路径参数：`identity` → `src-tauri/src/harness/prompts/identity.md`、`quote_reference` → `src-tauri/src/harness/prompts/quote-reference.md`（仓内相对路径常量）；`path` 字段注释同步（旧「固定段为 null」说法已删）

## 2. 行为不变证明

- [x] 2.1 迁移期一次性判据：确定性夹具（隔离空 HOME + 空 vault、无 AGENTS.md、无 Skill）下捕获 `assemble_system` 全文——迁移前 `before/assemble.txt`、迁移后 `after/assemble.txt`，**`diff` 为空、sha256 相同**（`6c698070…b854`，2557 字节）。证据目录：`/Users/boxcounter/Code/Boxcounter/lumir/test-results/m551-prompt-files/`（`assemble.diff` 0 字节；`manifest.diff` 只含预期的固定段 `path` 变化与临时目录 pid）。临时捕获夹具已在验证后删除
- [x] 2.2 常驻单测（新增）：
  - `fixed_segments_keep_migrated_bytes`：两段固定文本的 FNV-1a 64 指纹 + 长度（取自迁移前字面量 trim 后字节；注释写明取数来源与重算方法——重算 = 有意改 prompt，须显式更新常量）
  - `fixed_segments_are_sourced_from_prompt_files`：`CARGO_MANIFEST_DIR` 下按清单路径常量读文件，`trim_end()` 后等于嵌入文本；路径非绝对 / 非 `..`
  - 尾空白不进注入文本：`assemble_system_fixed_prefix_is_identity_then_quote_reference` 断言空环境装配结果恰好等于「identity + `\n\n===== 引用摘录的回指纪律 =====\n` + quote」，不以换行结尾
  - 清单形状：既有装配用例内断言 `identity` / `quote_reference` 条目 `path` 为仓内相对路径、`exists:true`、`bytes == 注入文本 len()`
- [x] 2.3 既有测试原样通过：`context.rs` 的「Lumir 的内置助手」断言、`quote_reference_covers_both_excerpt_forms`、`manifest.len() == 6` 与各来源下标断言（8 个 context 用例全绿）
- [x] 2.4 装配顺序不随目录变化：`assemble_system_fixed_prefix_is_identity_then_quote_reference` 以「空环境装配结果 == 两段常量按固定顺序拼接」钉住——`prompts/` 目录内容 / 枚举顺序不参与装配

## 3. 验收场景（`scripts/acceptance`）

- [x] 3.1 更新 `scripts/acceptance/scenarios/105-harness-wire-retention.md`：固定段断言从 `"path":null` 改为仓内相对路径（identity + quote_reference 各一条），断言口径说明段同步改写。scope 已由 tower 扩入本 mission
- [ ] 3.2 真机跑一次场景 105（mock provider），确认 `session_open.assembly` 的两条固定段条目与断言一致
  - 承接注记：真机验收套件的执行时机是 dogfood 批次每次合并后、Alex 验收前（AGENTS.md「真机验收套件」节），本实现 mission 未执行；合并后由 dogfood 批次承接

## 4. 验证

- [x] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（`✓ change/harness-prompt-files`）
- [x] 4.2 `cargo test` 全绿（487 个 lib 用例 + 各集成套件全过，0 failed）
- [x] 4.3 `scripts/gate.sh quick` 全绿：`GATE RESULT: 9/9 PASS（SKIP 1）`，退出码 0（SKIP = tsc-visual，tests/visual 依赖未装，非失败）
- [ ] 4.4 归档节点：living spec 并入后核对——新增 requirement 与实现一致；Purpose 段无需改动（现有 Purpose 未描述固定段来源，AGENTS 三层措辞不受影响）
