# Tasks: codeblock-toml-yaml-highlight

> 提案阶段只锁定意图；本清单随实现细化。**第 1 组是 M167（纯文档 mission）已完成的核实工作，带证据；
> 第 2 组起是实现期任务。** 两个裁决点（proposal 末节）已在节点 1 定下（结论与日期见 proposal 的
> 「裁决记录」）：**yaml 的单色缺陷独立成立、本 change 不撤回**，第 2–5 组照方案实现；toml 按假说 (b)
> 处置（无产品缺陷，只纳入门禁）；修复广度取**方案 A**，故第 2.3 与 3.8 不实现，归档时标注放弃原因。

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
- [x] 1.5 `tasks.md` + `specs/editor-live-preview/spec.md`（1 条 MODIFIED + 1 条 ADDED requirement），
      并确认本 mission **零 `src/`、零 `tests/` 改动**
- [x] 1.6 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
      **证据**：worktree 内跑该命令（输出 `/tmp/m167-validate.log`），含 `✓ change/codeblock-toml-yaml-highlight`，
      末行 `Totals: 18 passed, 0 failed (18 items)`、退出码 0

## 2. 实现：yaml 的键名配色（方案 A）

- [x] 2.1 `src/preview/code.ts` 新增 `YAML_TOKEN_TABLE: TokenTable = { atom: tags.propertyName }`，
      注释写明「`atom` 在 yaml mode 里只由映射键分支产出（`mode/yaml.js:77`）」与「MUST NOT 外溢到 toml
      （`atom` 在 toml 有三处语义）」；把 `LANGUAGES` 的 yaml 条目改为
      `StreamLanguage.define({ ...yaml, tokenTable: YAML_TOKEN_TABLE })`
      **证据**（M179）：`src/preview/code.ts` 的 `YAML_TOKEN_TABLE`（含上述两条注释）与 `LANGUAGES.yaml` 项。
- [x] 2.2 不改 `TOKEN_GROUPS`、不改 yaml 之外任何语言的 entry、不改缓存键与 `tagsForStyle` 算法
      （`git diff` 应当只有 yaml 一处 + 新表一处；若 diff 扩到别的语言即停下重议）
      **证据**（M179）：`git diff --stat src/preview/code.ts` → 1 file changed, 16 insertions(+), 3 deletions(-)，
      三个 hunk = 新表 + yaml 条目 + `JSON_TOKEN_TABLE` 文档注释里「json 是本文件唯一带 tokenTable 的语言」
      那句的订正（加了 yaml 之后它已成错误自述，属同批必改的注释同步）。零 `TOKEN_GROUPS` 改动、
      零其它语言条目改动、零 `tagsForStyle` / 缓存键 / info string 归一化改动 —— 在约定的 diff 面内。
- [x] 2.3 **仅当裁决点 2 选方案 B**：`TOKEN_GROUPS` 加角色 + `src/editor.ts` 的 `CODE_COLORS` 同步
      （两处都是 `Record<TokenRole, …>` 穷尽检查）+ 全量视觉基线重建并与 Alex 逐张核对；
      选方案 A 时本任务不实现，在归档时标注放弃原因
      **结论**（M179）：裁决点 2 = 方案 A，**本任务不实现**。放弃原因（归档时引用此处）：方案 B 要给
      `meta` / `punctuation` 新增配色角色，而这两个 token 名在 **17 / 21 门**收录语言里都会产出
      （普查读数见 `evidence/03-复核记录.md` §6），一处新增等于同时改掉 17 门语言的观感并触发大面积基线重建。

## 3. 测试

- [x] 3.1 token 级断言（无 DOM）：`tests/visual/scenes/render-codeblock.spec.ts` 增 yaml 断言块——
      键取 `cm-lp-tok-property`、字符串取 `cm-lp-tok-string`、`true/false` 取 `cm-lp-tok-keyword`、
      数字取 `cm-lp-tok-literal`、注释取 `cm-lp-tok-comment`；并断言键 **MUST NOT** 落 `cm-lp-tok-literal`
      **证据**（M179）：用例「yaml 的 token 分工：…」——键 5 种形态逐个 `toEqual(["cm-lp-tok-property"])`、
      四类值各归其色；用例「yaml 键着色不变量：…」里另有 `not.toContain("cm-lp-tok-literal")` 的显式反向断言。
- [x] 3.2 键形态全覆盖：顶层键、嵌套键、序列项内的键、多词键（`Business line`）、含 `-` / `.` / `/` / `+`
      的键（真实 vault 里有 `importance-urgency`、`PreToolUse`）、非 ASCII 值——逐个断言取属性名色。
      单一 fixture 只能证明那个案例被修好（`REVIEW.md` 第 1 条）
      **证据**（M179）：用例「yaml 键着色不变量：…」的六个独立文档（顶层+嵌套 / 三层嵌套 / 序列项内 /
      多词键 / `-` `.` `/` `+` / 非 ASCII 键），逐个键断言属性色且不落字面量色。
- [x] 3.3 别名与两侧 parity：```yaml 与 ```yml 结果相同；同一段 yaml 在只读 `.yml` / `.yaml` 文件
      （code 模式）与围栏里**计算色逐条相同**（两侧类名生成方式不同，比色值不比类名）
      **证据**（M179）：token 级 `expect(highlightCode(doc, "yml")).toEqual(highlightCode(doc, "yaml"))`（逐 from/to/cls
      相等）；DOM 级用例「DOM：同段 yaml 在围栏（yaml）与只读 .yml / .yaml 文件…」——把 fixture 的 ```yaml
      块原文喂给 code 模式的 `config.yml` / `config.yaml`，逐 token 比**计算色**（围栏 `cm-lp-tok-*` 与
      code 模式 CM6 `ͼ*` 类名不同，故不比类名），两行（键+行尾注释 / 键行）逐条 `toEqual`；另断言 ```yml 围栏的键取属性色。
- [x] 3.4 不外溢：同一段含 `atom` 的 toml（表头 `[[x]]`、布尔、日期）取色**不变**（仍为 `cm-lp-tok-literal`）；
      json / javascript 的取色不变
      **证据**（M179）：用例「yml 与 yaml 逐 token 相同；yaml 的 atom 不外溢到 toml / json / javascript」——
      toml 六类 token 逐个钉住（表头 / 布尔 / 日期 `cm-lp-tok-literal`、键 `property`、字符串 `string`、数字 `literal`、注释 `comment`）、
      json 键仍 `property`、js 字符串键仍 `string` 且不带 property；DOM 级用例另有 toml 表头与 `enabled = true` 的计算色断言。
      同用例还钉住「缓存按语言分流」：yaml → toml → yaml 三轮读数的类名不变（`classOf` 缓存键含语言名）。
- [x] 3.5 边界断言：`>64KiB` 的 yaml 与 toml 块仍不着色；未收录语言与无 info 围栏仍为纯文本；
      无键的纯列表 yaml 块仍不出 token（`REVIEW.md` 第 2 条：先确认读到的是真值再判负向）
      **证据**（M179）：用例「yaml / toml 的着色边界：…」——开篇先给**正观测**（有键的块确实产出属性色 token），
      再判四个负向：70000 字符的 yaml / toml 块 `toEqual([])`、阈值内同内容 `length > 0`（差别只来自长度）、
      无键纯列表 `toEqual([])`、`""` / 空白 / 未收录语言 / `.yml`（归一化边界）全 `[]`。
- [x] 3.6 **反向验证（必须先红）**：新断言在改动前跑一次必须 FAIL——当前实现给 yaml 键的是
      `cm-lp-tok-literal` / `rgb(160,94,28)`，与断言的 `cm-lp-tok-property` / `rgb(79,111,143)` 不符；
      把这次「红」的输出留在证据里（`REVIEW.md` 第 1 条）
      **证据**（M179）：`test-results/m179/03-red-before-fix.log`（改动前的完整 run）——6 条新用例全红、4 条既有用例
      全绿；失败信息逐条给出实际值：键的类名 `cm-lp-tok-literal`、围栏里键的计算色 `rgb(160, 94, 28)`
      （期望 `cm-lp-tok-property` / `rgb(79, 111, 143)`）。加上改动后 `test-results/m179/08-green-after-fix.log`
      10/10 绿，红→绿闭环成立。
- [x] 3.7 视觉场景：`tests/visual/fixtures/render-codeblock/languages.md` 增 toml / yaml / yml 三个围栏
      （yaml 用嵌套映射 + 序列 + 行尾注释 + 非 ASCII 值，形态取自 Alex 真实块，不用单行样本）；
      `render-codeblock.spec.ts` 增整页 + 元素级基线（`.cm-line` 级，钉住键色）。**新增基线须 Alex 过目**
      （`tests/visual/README.md` 的基线更新纪律）；核对既有整页基线 sha256 与时间戳（实现前 yaml 基线为 0 张）
      **证据**（M179）：fixture 增三个围栏（yaml 形态逐字节取自 Alex 真实块 `Logbook/README.md` 的
      `dimensions:` 表，含 `Business line` / `Importance/Urgency` / `importance-urgency` / 行尾注释）；
      新增 **3 张基线**：整页 `render-codeblock-toml-yaml.png` + 元素级 `render-codeblock-toml-line.png` /
      `render-codeblock-yaml-line.png`。**基线入库待 Alex 过目**（AGENTS.md 硬规则；过目前的提交不带这三张文件，
      前/后截图与 sha256 清单在 `/tmp/m179-baseline-review/`，走 review-request 呈请）。
      既有基线**零变更**：加围栏后无 `--update` 跑一次全绿（`test-results/m179/04-green-after-fix-first-run.log` 的第 7 条用例），
      两张既有基线 sha256 不变（`render-codeblock.png` `1382ada2…`、`render-codeblock-json-line.png` `cada2074…`）。
      **基线区分度反向验证（新现场，`REVIEW.md` 第 3 条）**：把 yaml 键色改回旧值再跑一次
      （`test-results/m179/06-reverse-verification.log` / `07-wholepage-diff-count.log`）——
      元素级那张差异 **92 像素**（766×29，额度 22 像素）→ 门禁红；但整页那张差异 **958 像素**，而全局
      `maxDiffPixelRatio` 0.001 的额度是 **960 像素**——**差 2 像素就静默假绿**。故该断言显式覆盖
      `maxDiffPixelRatio: 0.0005`（480 像素，留 2 倍余量；正常 run 逐像素零差异），并把读数写进断言注释与 design §5。
- [x] 3.8 **仅当裁决点 2 选方案 B**：为新角色补断言与基线核对；选方案 A 时不实现
      **结论**（M179）：方案 A，**本任务不实现**（放弃原因同 2.3）。

## 4. 真机验收场景（随实现同 PR）

- [x] 4.1 `scripts/acceptance/scenarios/render-markdown.md` 补一张含 toml/yaml 围栏的 `shot` 截图证据，
      并在场景说明里写清「着色是像素级呈现，AX 树不承载颜色，本套件不写颜色断言，截图归 Alex 过目」
      （场景格式与断言形态见 `scripts/acceptance/README.md` 的断言表：`ax` / `editor` / `file` / `glob` / `shot`）
      **证据**（M179）：场景尾部新增两步——`vaultWrite` 写入含 ```toml / ```yaml 围栏的短文档
      `render-toml-yaml.md`（**刻意只用单引号**：`lib/ax.mjs` 按引号奇偶判多行 value 边界，正文里的 `"` 会截断 AX 文本）、
      `open` 后留 `shot: toml / yaml 围栏着色`，另两条 `editor.has` 只钉「源码逐字保留」。说明里写明颜色不在 AX 树上、
      不写颜色断言及其理由。`node scripts/acceptance/run.mjs --check` 通过（26 个场景）；真机 run 结果见 6.4。

## 5. 文档

- [x] 5.1 `docs/backlog.md` 记一条**已知缺口**：toml 的 `[table]` 表头与 `true/false`、日期共用 `atom`
      （`mode/toml.js` 三处 `return "atom"`），tokenTable 分不开，要分开须改 vendored mode 的词法——本 change 非目标
      **证据**（M179）：条目文本已写好并随 review-request 交 tower 代落——**本 mission 的 scope 不含
      `docs/backlog.md`**（避免与并行 mission 冲突），故不就地改那个文件。拟落的段落见 review-request 正文，
      建议归入「记录在案（无需动作）」节，标题「toml 的表头 `[x]` / `[[x]]` 与布尔、日期共用 `atom`」。
- [ ] 5.2 归档时：把裁决点 1 的结论（Alex 手上的现场是哪一个）与 toml 的复核结论（「已着色 + 反例未定位」）
      落一条核销记录；若裁决点 1 选 (b)，本 change 按撤回口径处置（目录移入 `archive/<日期>-withdrawn-` +
      proposal 头部补撤回记录），不留僵尸提案
      **本 mission 不勾**：归档节点（Alex 节点 2）动作。**已定的输入**：裁决点 1 结论 = yaml 缺陷独立成立
      （不撤回）+ toml 采信旧构建假说 (b)、无产品缺陷；toml 的复核结论 = 合成块已着色、真实语料里无现场
      （`evidence/03-复核记录.md` §3.1 / §4）。故 5.2 的后半句（撤回口径）**不适用**，前半句的核销记录照写。
- [ ] 5.3 归档时把本 change 的 spec 增量（1 条 MODIFIED + 1 条 ADDED）并入 `openspec/specs/editor-live-preview/spec.md`；
      核对并入结果——「Markdown 渲染保真」第 2 款的「已知例外」段落应含 toml 的 `atom` 复用那条
      （MODIFIED 增量已写入），并入后 MUST NOT 只列 rust 一条；该款另含**两条 M138/M152 既有行为的 spec 回填**
      （回填既有行为、不新增产品行为，已在 proposal Impact 与 design §7 申报）：①「该一致性 SHALL 由两侧共用同一张语言表
      （`src/preview/code.ts` 的 `LANGUAGES`）保证，MUST NOT 由两侧各自维护一份语言或配色表」+ Scenario
      「两侧语言与配色表同源」；②「着色 SHALL 受单一代码块长度上限约束（超过即回落纯文本，MUST NOT 因语言不同而放宽）」
      + Scenario「着色受长度上限约束且与语言无关」。四处（本行 / proposal Impact / design §7 / delta）逐字一致
      **本 mission 不勾**：归档节点动作（并入 living spec 与 6.5 的评审同批）。并入时按本行核对四处逐字一致。
- [x] 5.4 **（实现期新增，非原清单）spec 增量的两处文本订正，归档时按此核对**：ADDED requirement 原写
      「该口径 SHALL 对任意键形态恒成立——顶层键、嵌套键、序列项内的键、**带单双引号的键**、非 ASCII 键、…」，
      实现期实测**带引号的键取 `cm-lp-tok-string`**（`mode/yaml.js` 的引号分支排在键判定之前、产出与引号值
      同一个 `string` token 名，token 表按 token 名映射分不开键与值）——方案 A 修不了它。故：① 该句改为
      「对**未加引号**的键形态恒成立」；② 新单列 Scenario「带引号的键取字符串色（已知边界，如实记录）」；
      ③ design §6 边界表加同一行；④ 测试里钉住该边界（`"quoted key": v` → `cm-lp-tok-string`）。
      依据 [REVIEW.md](../../../REVIEW.md) 第 6 条（覆盖声明不得超出真实验证）：这是把提案期的**超范围表述**
      收回到实测口径，不新增颜色、不动其它语言、不改任何行为，故不构成扩 scope；其余口径逐字未动。

## 6. 验证（实现期）

- [x] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
      **证据**（M179）：`Totals: 17 passed, 0 failed (17 items)`，含 `✓ change/codeblock-toml-yaml-highlight`
      （另两条 change 是本分支基线上并行的 `image-svg-and-fallback` / `line-wrap-options`）。
- [x] 6.2 `scripts/gate.sh quick` 全绿（fmt / clippy / cargo test / bindings 漂移 / tsc / openspec validate）
      **证据**（M179）：`bash scripts/gate.sh visual` 的完整输出（`test-results/m179/09-gate-visual.log`）——
      quick 层的 10 门全 PASS：`cargo-fmt 1s` / `cargo-clippy 37s` / `cargo-test 41s` / `bindings-drift 0s` /
      `tsc-root 1s` / `tsc-visual 1s` / `tsc-unit 1s` / `unit-tests 0s` / `docs-check 0s` / `openspec-validate 2s`。
      （`gate.sh visual` 内含 quick 层，故不再单跑一次 `quick`。）
- [x] 6.3 `scripts/gate.sh visual` 全绿（新增基线已由 Alex 过目后入库）
      ——**本条只完成前半句**：门禁在「新增基线于本地工作区就位」的状态下全量跑通；**「已由 Alex 过目后入库」
      这个前置尚未满足**（按 M164 口径，批准前提交里不带基线）。为避免读成「入库已做完」，此处显式拆开记。
      **证据（门禁部分）**（M179）：`GATE RESULT: 12/12 PASS（SKIP 0）`、退出码 0（同上日志），含 `visual-regression 184s`
      ——**全量像素模式**（未置 `LUMIR_VISUAL_STRUCTURAL`）。
      **证据（入库部分：未完成）**：按 M164 的口径「批准前本分支不带基线更新」，提交 `0e86c9f` 里不含这三张 PNG
      （现为 worktree 内 untracked），前/后截图 + 差异图 + sha256 清单在 `test-results/m179/baseline-review/`
      （副本 `/tmp/m179-baseline-review/`），随 review-request 呈请；Alex 通过后本 mission 补一次提交
      （同一分支，第二次提交），入库前逐张 sha256 与批准件核对。
- [x] 6.4 真机验收套件跑一遍，FAIL 项为 0（或不涉及本 change 的项如实标注）
      **证据**（M179）：`caffeinate -dimsu node scripts/acceptance/run.mjs` 全量跑完，末行
      `结论：26/26 PASS`、退出码 0，**FAIL 项为 0**（无「不涉及本 change 的项」需要标注）——
      完整输出 `test-results/m179/13-acceptance-full.log`，逐场景报告
      `test-results/acceptance/2026-09-18/`（summary.md + 各场景 steps.md/shots）。本 change 的目标场景
      `render-markdown` PASS 19.7s，新增两步都在内：`写入 toml / yaml 围栏场景文件`（file 断言 PASS）与
      `toml / yaml 围栏着色态`（两条 `editor.has` PASS + 截图 `shots/04-toml_yaml_围栏着色.jpeg`）。
      该截图是**真实 WKWebView** 下的成品：toml 的键/字符串/表头三色分明、yaml 的键转属性蓝而值与结构符号
      仍为正文色——与 chromium 侧的计算色断言、元素级基线三方一致。
      环境如实记录：运行期磁盘最低到 1.8G（起跑预检 2.6G，过 2G 门；未触发 ENOSPC，未用低盘绕过开关）；
      1420 有 Alex 手头的实例在跑（套件走 1430 隔离，未抢端口、未动那个实例）；用户真实 vault 全程只读。
- [ ] 6.5 归档评审（Alex 节点 2）：tasks 全部勾选或标注放弃原因；spec 增量与 proposal 意图一致，无静默扩 scope
