# Tasks: codeblock-toml-yaml-highlight

> 提案阶段只锁定意图；本清单随实现细化。**第 1 组是 M167（纯文档 mission）已完成的核实工作，带证据；
> 第 2 组起是实现期任务，本 mission 不勾。** 两个裁决点（proposal 末节）在节点 1 定下后：
> 若裁决点 1 选 (b)「旧实例、非产品缺陷」，第 2–5 组按撤回口径处置（只留 5.2 的核销记录）；
> 若裁决点 2 选方案 B，第 2.3 与 3.8 才实现。

## 1. 提案期（M167，已完成，零 `src/`、零 `tests/` 改动）

- [x] 1.1 核实 vendored `@codemirror/legacy-modes` 是否含 toml 与 yaml 模式（版本号 + 文件路径），
      盘点 M138 的语言注册机制与 fence 别名处理（`yaml` / `yml` 两个 fence 名），给出注册点 file:line
      **证据**：`@codemirror/legacy-modes@6.5.4`；`mode/toml.js`（`export const toml`）与 `mode/yaml.js`
      （`export const yaml`）都在；注册点 `src/preview/code.ts:31-32`（import）/`:87-88`（`LANGUAGES`）/
      `:121`（别名 `yml: "yaml"`）；扩展名面 `src/preview/attachments.ts:54-56`；M138 提交 `ca81b7c` 的
      同一批行、M152 未触碰（`git show 6e8e70a -- src/preview/code.ts | grep -c '^[-+].*toml\|^[-+].*yaml'` → 0）。
      **结论：不缺，无需替代来源。**
- [x] 1.2 真实渲染复核（chromium + 真实前端 + Tauri 桩，加载 master 的 `src`）：toml 围栏 / `.toml` 文件 /
      yaml 与 yml 围栏 / 围栏位置边界（首行、引用块、列表项、callout、四反引号、`~~~`、大写、带 attrs）
      **证据**：`evidence/03-复核记录.md` §3；截图 `evidence/01-yaml-block-as-is.png`（Alex 真实 vault
      `4_Archives/Engineering/Logbook/README.md` 第一个围栏块的逐字节复刻）与 `evidence/02-toml-block-as-is.png`；
      逐 span dump 在 `/tmp/lumir-probe-m167/real.log`（git 外）。
- [x] 1.3 语料普查：vault 1525 份 `.md` 的围栏信息串统计（`yaml` 8 / `toml` 0 / `yml` 0），
      确认报告里的 toml / yml 现场在可触及语料里不存在
      **证据**：`evidence/03-复核记录.md` §4 的命令与原样输出。
- [x] 1.4 `proposal.md` / `design.md`：范围与边界（含 `>64KiB` 安全阀同样适用）、着色 parity 校验方法
      （逐 token 对照 CM6 或快照，沿用 M138 口径）、两个裁决点
      **证据**：`proposal.md` 的 Why / What Changes / Non-goals / Impact / 裁决点；`design.md` 的 §1–§7。
- [x] 1.5 `tasks.md` + `specs/editor-live-preview/spec.md`（1 条 ADDED requirement），
      并确认本 mission **零 `src/`、零 `tests/` 改动**
- [x] 1.6 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
      **证据**：worktree 内跑该命令（输出 `/tmp/m167-validate.log`），含 `✓ change/codeblock-toml-yaml-highlight`，
      末行 `Totals: 18 passed, 0 failed (18 items)`、退出码 0

## 2. 实现：yaml 的键名配色（方案 A）

- [ ] 2.1 `src/preview/code.ts` 新增 `YAML_TOKEN_TABLE: TokenTable = { atom: tags.propertyName }`，
      注释写明「`atom` 在 yaml mode 里只由映射键分支产出（`mode/yaml.js:77`）」与「MUST NOT 外溢到 toml
      （`atom` 在 toml 有三处语义）」；把 `LANGUAGES` 的 yaml 条目（`:88`）改为
      `StreamLanguage.define({ ...yaml, tokenTable: YAML_TOKEN_TABLE })`
- [ ] 2.2 不改 `TOKEN_GROUPS`、不改 yaml 之外任何语言的 entry、不改缓存键与 `tagsForStyle` 算法
      （`git diff` 应当只有 yaml 一处 + 新表一处；若 diff 扩到别的语言即停下重议）
- [ ] 2.3 **仅当裁决点 2 选方案 B**：`TOKEN_GROUPS` 加角色 + `src/editor.ts` 的 `CODE_COLORS` 同步
      （两处都是 `Record<TokenRole, …>` 穷尽检查）+ 全量视觉基线重建并与 Alex 逐张核对；
      选方案 A 时本任务不实现，在归档时标注放弃原因

## 3. 测试

- [ ] 3.1 token 级断言（无 DOM）：`tests/visual/scenes/render-codeblock.spec.ts` 增 yaml 断言块——
      键取 `cm-lp-tok-property`、字符串取 `cm-lp-tok-string`、`true/false` 取 `cm-lp-tok-keyword`、
      数字取 `cm-lp-tok-literal`、注释取 `cm-lp-tok-comment`；并断言键 **MUST NOT** 落 `cm-lp-tok-literal`
- [ ] 3.2 键形态全覆盖：顶层键、嵌套键、序列项内的键、多词键（`Business line`）、含 `-` / `.` / `/` / `+`
      的键（真实 vault 里有 `importance-urgency`、`PreToolUse`）、非 ASCII 值——逐个断言取属性名色。
      单一 fixture 只能证明那个案例被修好（`REVIEW.md` 第 1 条）
- [ ] 3.3 别名与两侧 parity：```yaml 与 ```yml 结果相同；同一段 yaml 在只读 `.yml` / `.yaml` 文件
      （code 模式）与围栏里**计算色逐条相同**（两侧类名生成方式不同，比色值不比类名）
- [ ] 3.4 不外溢：同一段含 `atom` 的 toml（表头 `[[x]]`、布尔、日期）取色**不变**（仍为 `cm-lp-tok-literal`）；
      json / javascript 的取色不变
- [ ] 3.5 边界断言：`>64KiB` 的 yaml 与 toml 块仍不着色；未收录语言与无 info 围栏仍为纯文本；
      无键的纯列表 yaml 块仍不出 token（`REVIEW.md` 第 2 条：先确认读到的是真值再判负向）
- [ ] 3.6 **反向验证（必须先红）**：新断言在改动前跑一次必须 FAIL——当前实现给 yaml 键的是
      `cm-lp-tok-literal` / `rgb(160,94,28)`，与断言的 `cm-lp-tok-property` / `rgb(79,111,143)` 不符；
      把这次「红」的输出留在证据里（`REVIEW.md` 第 1 条）
- [ ] 3.7 视觉场景：`tests/visual/fixtures/render-codeblock/languages.md` 增 toml / yaml / yml 三个围栏
      （yaml 用嵌套映射 + 序列 + 行尾注释 + 非 ASCII 值，形态取自 Alex 真实块，不用单行样本）；
      `render-codeblock.spec.ts` 增整页 + 元素级基线（`.cm-line` 级，钉住键色）。**新增基线须 Alex 过目**
      （`tests/visual/README.md` 的基线更新纪律）；核对既有整页基线 sha256 与时间戳（实现前 yaml 基线为 0 张）
- [ ] 3.8 **仅当裁决点 2 选方案 B**：为新角色补断言与基线核对；选方案 A 时不实现

## 4. 真机验收场景（随实现同 PR）

- [ ] 4.1 `scripts/acceptance/scenarios/render-markdown.md` 补一张含 toml/yaml 围栏的 `shot` 截图证据，
      并在场景说明里写清「着色是像素级呈现，AX 树不承载颜色，本套件不写颜色断言，截图归 Alex 过目」
      （场景格式与断言形态见 `scripts/acceptance/README.md` 的断言表：`ax` / `editor` / `file` / `glob` / `shot`）

## 5. 文档

- [ ] 5.1 `docs/backlog.md` 记一条**已知缺口**：toml 的 `[table]` 表头与 `true/false`、日期共用 `atom`
      （`mode/toml.js` 三处 `return "atom"`），tokenTable 分不开，要分开须改 vendored mode 的词法——本 change 非目标
- [ ] 5.2 归档时：把裁决点 1 的结论（Alex 手上的现场是哪一个）与 toml 的复核结论（「已着色 + 反例未定位」）
      落一条核销记录；若裁决点 1 选 (b)，本 change 按撤回口径处置（目录移入 `archive/<日期>-withdrawn-` +
      proposal 头部补撤回记录），不留僵尸提案
- [ ] 5.3 归档时把本 change 的 spec 增量并入 `openspec/specs/editor-live-preview/spec.md`；
      核对并入后「Markdown 渲染保真」第 2 款的「已知例外」段落是否需补 toml 一条（现有段落只列 rust）

## 6. 验证（实现期）

- [ ] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 6.2 `scripts/gate.sh quick` 全绿（fmt / clippy / cargo test / bindings 漂移 / tsc / openspec validate）
- [ ] 6.3 `scripts/gate.sh visual` 全绿（新增基线已由 Alex 过目后入库）
- [ ] 6.4 真机验收套件跑一遍，FAIL 项为 0（或不涉及本 change 的项如实标注）
- [ ] 6.5 归档评审（Alex 节点 2）：tasks 全部勾选或标注放弃原因；spec 增量与 proposal 意图一致，无静默扩 scope
