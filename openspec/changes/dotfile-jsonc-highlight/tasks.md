# Tasks: dotfile-jsonc-highlight

实现顺序：注册表 → 语言表 → 穷尽表涟漪 → 单测 → 门禁 → 真机验收。每条完成后就地勾选；
跑不动的项写「未验」并附原因，MUST NOT 写成已验（REVIEW.md 第 6 条）。

**口径基线**：D1 自写 StreamParser（gitignore/gitattributes）、D2 复用 legacy json
mode（jsonc）、D3 只收 `.gitignore` / `.gitattributes` 两个精确 basename（以上三项
待节点 1 落槌，本文件以推荐项起草）；「顺带可编辑」已由 Alex 预裁决（2026-09-26），
可编辑性经 M231 注册表通道获得（design §5），本 change MUST NOT 自建 editable 开关。

## 1. 注册表（src/preview/attachments.ts）

- [ ] 1.1 新增 `FILENAME_REGISTRY`（basename 精确、大小写敏感 → ExtensionInfo）：
      `.gitignore` → `{ class: "code", language: "gitignore" }`、
      `.gitattributes` → `{ class: "code", language: "gitattributes" }`；
      `CODE_EXTENSIONS` 增 `jsonc: "jsonc"`（design §2.2）
- [ ] 1.2 新增 path 感知查询 `fileClassOfPath(path)` / `codeLanguageOfPath(path)`，
      判定顺序 = 文件名表优先、扩展名表其次、未命中落 `text`（design §2.1）；
      模块注释写清两个查询口分工（path 版 = 文件打开裁决唯一入口；ext 版 = 无路径
      上下文的底层查询），`fileClass(ext)` 注释标注「打开文件请用 path 版」
      （design §2.3，REVIEW.md 第 8 条防线）
- [ ] 1.3 消费侧切 path 版：`src/editor.ts:1016-1021`（`codeLanguageFor`）、
      `src/editor.ts:1056-1059`（`modeForPath`）、`src/tree.ts:32` 与 `:40`、
      `src/main.ts:207` 与 `:618`；切换后全仓 grep 确认打开链路不再有
      `fileClass(extensionOf(` / `codeLanguage(extensionOf(` 残留
- [ ] 1.4 单测（`tests/unit/`，新文件或并入既有注册表测试——实现期先 rg 确认无
      同类表再落点）：文件名优先于扩展名、精确匹配（`foo.gitignore` 不命中）、
      大小写敏感（`.GitIgnore` 不命中）、`.secret` 对照组仍为 `text` 纯文本、
      `x.jsonc` → code/jsonc。反向用例先写红再实现（REVIEW.md 第 1 条）

## 2. 语言表（src/preview/code.ts）

- [ ] 2.1 `LANGUAGES` 增三条目：`jsonc` 复用 json 条目（同一
      `StreamLanguage.define({ ...json, tokenTable: JSON_TOKEN_TABLE })` 实例）；
      `gitignore` / `gitattributes` = 自写 StreamParser，共享一个参数化 tokenizer，
      token 只落既有 TOKEN_GROUPS role（design §4），零新增颜色
- [ ] 2.2 ALIASES 增 `gitignore` / `gitattributes` 两个 fenced info string
      （`jsonc → json` 已在 `:133`，不动）
- [ ] 2.3 单测：gitignore 的 `#` 注释 / `\#` 转义 / 行首 `!`（非行首不生效）/
      行尾 `/`；gitattributes 的 pattern / 属性名 / `-attr` / `attr=value` 切分；
      jsonc 的注释与尾逗号 token 化（对照 design §1.4 探针口径）。token 断言走
      既有「StreamInternals 驱动 + LEGACY_TAGS」测试形态，反向用例先红

## 3. 穷尽表涟漪（编译期合同强制，缺一编译失败）

- [ ] 3.1 `src/code-structure.ts:313` `STRUCTURE_SUPPORT` 补
      `gitignore / gitattributes / jsonc: null`（T3，与 json/toml/yaml 同口径）；
      确认大纲对三类文件按「不支持」呈现
- [ ] 3.2 `src/code-identifiers.ts:341` `BINDING_RULES` 补同三键 null（双击变量
      高亮不生效）
- [ ] 3.3 状态栏语言标签核对：`src/main.ts:606-618` 对三类文件显示语言名而非
      "Plain text"

## 4. 可编辑性（依赖 M231，本 change 零接线）

- [ ] 4.1 核对 M231 合入态：D1 为全量文本类时三类自动可编辑（零动作，复验即可）；
      D1 若裁成白名单，白名单显式收录 `.gitignore` / `.gitattributes` / `.jsonc`
      （design §5/§7.1）
- [ ] 4.2 M231 合入后复验：三类文件编辑 → dirty → Cmd+S 落盘 → 回读字节一致；
      未落地前维持只读高亮（本 change 不为可编辑写任何代码）

## 5. spec 增量归档准备

- [ ] 5.1 `specs/editor-live-preview/spec.md` 两条 ADDED requirement 与最终实现
      逐句对账（实现期发现口径偏差时先改 spec 再写代码）；「可编辑性」requirement
      在 M231 未合入前归档时保持「通道落地前维持只读」措辞，M231 若被弃则在归档
      评审摘除该条（design §7.1）

## 6. 门禁

- [ ] 6.1 `node tests/unit/run.mjs` 全绿（含既有计数）；`bash scripts/gate.sh quick`
      全绿，输出留档 `test-results/m233-impl/`（实现 mission 自编号目录）
- [ ] 6.2 `bash scripts/gate.sh visual` 本地跑一次（动了 `src/preview/code.ts` =
      着色相关，CI 结构层不覆盖像素；AGENTS.md 视觉门禁纪律）；
      `m130-text-open-trap.spec.ts` 回归绿（其 dotfile 用例是 `.secret`，应保持
      不变——红了说明误伤未收录 dotfile 口径）
- [ ] 6.3 `npx --yes @fission-ai/openspec@1.12.0 validate dotfile-jsonc-highlight --strict`
      通过

## 7. 真机验收（agent 执行，不进 CI；随实现同 PR）

本节场景序号按 tower 对账口径分配：36 = live-theme-switch、37 = heading-hierarchy-ramp、
38 = content-width-drag、39 = product-version-display、40 = table-fullscreen-view
（M229）、41 / 42 = M231（nonmd-edit）、43 = list-tab-indent（M230）、
45 = tab-cycle-keys（M232，wt-232）；44 在仓内未查到声明但 36-45 按 tower 口径
视为已占；**46 = dotfile-jsonc-highlight（本 change）**，取号前已全仓 grep
`scenarios/46` 无撞号（2026-09-26，含全部在途 worktree 的 openspec/changes）。

- [ ] 7.1 新增场景 `scripts/acceptance/scenarios/46-dotfile-jsonc-highlight.md`：
      合成 vault 预置 `.gitignore` / `.gitattributes` / `x.jsonc` / `.secret`
      fixture，逐一打开，断言 = 编辑器文档文本逐字节回读（ADR 0003 §3）+ AX /
      截图留档着色现场（注释 / 键值 / 取色 token 的 DOM 类名断言）；`.secret`
      对照组断言无着色类名。断言走「回读 + 字节比对」，不用注入自报当判据
      （REVIEW.md 第 5 条）；不可读一律判 FAIL，不把缺失值当空值（第 2 条）
- [ ] 7.2 条件项：若实现期 M231 已合入，场景 46 顺手补「三类文件可编辑」冒烟断言
      （编辑 → 回读 → 保存落盘字节一致）；未合入则本项标注「未验（M231 未落地）」，
      可编辑行为断言归 M231 场景 41/42
- [ ] 7.3 `node scripts/acceptance/run.mjs --check 46` 静态校验绿；真机跑通后证据落
      `test-results/acceptance/`（git 外），跑前确认 1420 / 1430 无 Lumir 实例
      （REVIEW.md 第 11 条）
