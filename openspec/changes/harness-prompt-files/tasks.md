# Tasks: harness-prompt-files

> 节点 1（提案评审）通过前不得动 `src-tauri` 实现代码。本文件的任务在实现阶段逐项勾选。

## 1. 提示词文件与嵌入

- [ ] 1.1 新增 `src-tauri/src/harness/prompts/identity.md`：正文自 `src-tauri/src/harness/context.rs` 现有 `IDENTITY` 字面量逐字节迁移。注意 Rust 行尾续行 `\` 不产生字节：字面量里用 `\` 拼接的位置在 Markdown 里是同一物理行，MUST NOT 折行；字面量里的空行（段落间距、`工具使用纪律：` 前、结尾段前）照原样保留
- [ ] 1.2 新增 `src-tauri/src/harness/prompts/quote-reference.md`：正文自 `QUOTE_REFERENCE` 字面量逐字节迁移（现字面量每个源码行都以 `\` 续行，实际正文是**单行**无换行文本；文件写成一行，行尾换行交给装配处 trim 消化）
- [ ] 1.3 `context.rs`：`IDENTITY` / `QUOTE_REFERENCE` 改为 `include_str!("prompts/identity.md")` / `include_str!("prompts/quote-reference.md")`，删除两份 Rust 字面量；模块头注释改为指向提示词文件（文件即真源，注释不复述文案）
- [ ] 1.4 `context.rs`：装配处对两段各 `trim_end()` 一次，注入文本与 `bytes` 都用 trim 后的结果（其余不做任何规范化）
- [ ] 1.5 `AssemblySource::fixed` 增来源路径参数：`identity` → `src-tauri/src/harness/prompts/identity.md`、`quote_reference` → `src-tauri/src/harness/prompts/quote-reference.md`（仓内相对路径常量，与 `include_str!` 的文件一一对应）；`path` 字段注释同步（删去「固定段为 null」的旧说法）

## 2. 行为不变证明

- [ ] 2.1 迁移期一次性判据：在未改动的工作树上用确定性夹具（隔离空 HOME + 空 vault、无 AGENTS.md、无 Skill）捕获 `assemble_system` 全文为 `before.txt`；迁移后同夹具再捕获 `after.txt`；`diff before.txt after.txt` 为空。两件与 diff 输出落 `test-results/`（git 外），完成报告给绝对路径
- [ ] 2.2 常驻单测（新增）：
  - 两段固定文本的字节指纹（FNV-1a 64 常量，取自迁移前的字面量；注释写明取数来源与重算方法——重算 = 有意改 prompt，须显式更新常量）
  - 来源文件与嵌入文本同源：`CARGO_MANIFEST_DIR` 下按清单路径常量读文件，`trim_end()` 后等于常量；证明清单路径不是死字符串
  - 尾空白不进注入文本：`IDENTITY` / `QUOTE_REFERENCE` 自身等于 `trim_end()` 结果，且装配输出不以换行结尾
  - 清单形状：`identity` / `quote_reference` 条目 `path` 为仓内相对路径（非 `null`、非 `/` 开头）、`exists:true`、`bytes == 注入文本 len()`
- [ ] 2.3 既有测试原样通过：`context.rs:412` 的「Lumir 的内置助手」断言、`quote_reference_covers_both_excerpt_forms`、`manifest.len() == 6` 与各来源下标断言
- [ ] 2.4 装配顺序不随目录变化：`prompts/` 新增无关 `.md` 时装配输出不变的断言（实现顺序是代码调用序，测试钉住这一点）

## 3. 验收场景（`scripts/acceptance`）

- [ ] 3.1 更新 `scripts/acceptance/scenarios/105-harness-wire-retention.md`：固定段断言从 `"path":null` 改为仓内相对路径（断言口径：`src-tauri/src/harness/prompts/identity.md`；说明段同步改写）
  - 写域注记：本 mission 的写域不含 `scripts/acceptance/**`，此项需 tower 授权扩 scope 或另立 worker 承接——实现报告须明确此项的实际归属与完成状态
- [ ] 3.2 真机跑一次场景 105（mock provider），确认 `session_open.assembly` 的两条固定段条目与断言一致

## 4. 验证

- [ ] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 4.2 `cargo test` 全绿（含 2.2–2.4 的新增 / 既有用例）
- [ ] 4.3 `scripts/gate.sh quick` 全绿（完成报告照抄 `GATE RESULT` 原文行与退出码）
- [ ] 4.4 归档节点：living spec 并入后核对——新增 requirement 与实现一致；Purpose 段无需改动（现有 Purpose 未描述固定段来源，AGENTS 三层措辞不受影响）
