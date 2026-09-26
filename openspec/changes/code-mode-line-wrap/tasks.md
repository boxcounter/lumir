# Tasks: code-mode-line-wrap

实现顺序：配置面 → 判定与装配 → 视觉场景 → 制品与文档 → 门禁与收口。
每条完成后就地勾选；跑不动的项写「未验」并附原因，MUST NOT 写成已验（REVIEW.md 第 6 条）。

**口径基线（2026-09-27，来自 backlog #35/#36 的 Alex 裁决 + tower 澄清）**：机制 = 可选覆盖键，
出厂直接分叉（code 默认 `false`）；`code_mode_line_wrap` 缺省**不跟随** `line_wrap`；
`view.toggle-line-wrap` 按前台会话模式翻对应轴；配置参考文档随本 change 同批落地；
`describe-config` 面板（#36②）中期另立项、本 change 不碰。backlog #35 与 #36① 在本 change 合并时核销。

## 1. 配置面（Rust）

- [x] 1.1 `src-tauri/src/config.rs` 的 `EditorConfig` 增 `code_mode_line_wrap: bool`，`impl Default` 给
      `false`（出厂分叉的配置面落点）；字段注释写死「键缺席 = 出厂 `false`」与「MUST NOT 跟随
      `line_wrap`」两条语义
- [x] 1.2 `RawEditorConfig` 增 `code_mode_line_wrap: Option<bool>`（与折行两项相邻，注释写明它不读
      `line_wrap`）
- [x] 1.3 `validate()` 的 editor 分支按折行两项的同形扩两行：缺字段 → 回落 `EditorConfig::default()`
      （`false`），不产生 warning
- [x] 1.4 Rust 单测：三态 + **不跟随**（`missing_code_mode_line_wrap_takes_factory_false`——两组输入
      `{mode:"code"}` 与 `{mode:"code", line_wrap:true}` 都必须得到 `false`，后者是本条的判别性所在）
- [x] 1.5 Rust 单测：显式 `true` / 显式 `false` 生效且两键互不改写（`explicit_code_mode_line_wrap_is_loaded`）
- [x] 1.6 Rust 单测：类型不符（`"code_mode_line_wrap": "yes"`）走整文件回落
      （`wrong_type_code_mode_line_wrap_falls_back_entire_file`，断言与同文件合法字段一起回默认）
- [x] 1.7 跑 `cargo test`（`src-tauri`）重导出 `src/bindings/EditorConfig.ts`；bindings 漂移门禁绿

## 2. 前端：判定点、运行期真源与装配

- [x] 2.1 `src/preview/theme.ts`：`WrapSettings` 增第三轴 `codeModeLineWrap`；新增
      `DEFAULT_CODE_MODE_LINE_WRAP = false`（与 Rust `EditorConfig::default` 对账的第二处写值）；
      `wrapSpec` 入参收成 `(mode, settings)`，正文行按模式取轴（md → `lineWrap`，code →
      `codeModeLineWrap`），代码块层判定不变
- [x] 2.2 `src/editor.ts`：运行期真源 `wrap` 增第三轴；`setWrap` 的合并与「值没变就返回」覆盖三轴
- [x] 2.3 `src/editor.ts`：`toggleLineWrap()` 按前台会话模式选轴（md → `lineWrap`，code →
      `codeModeLineWrap`），命令 id / 作用域 / 默认不绑键不变
- [x] 2.4 `src/main.ts` 的配置消费点：`editor.setWrap` 传第三轴（`code_mode_line_wrap`）
- [x] 2.5 `tests/unit/wrap.test.ts`：md 四组合与一元素一条规则原样保留；新增「两模式分叉」用例
      （code 只读 `codeModeLineWrap`；翻 md 两轴时 code 结论一字不变 = 判别性）+ 出厂默认三值对账
      （375/375 通过）

## 3. chromium 视觉 / 结构断言

- [x] 3.1 `tests/visual/scenes/tauri-stub.ts` 的 config 形状补 `code_mode_line_wrap`（缺省 `false` =
      与 Rust 出厂同值，注释写明它不跟随 `line_wrap`）
- [x] 3.2 新增 `tests/visual/scenes/m247-code-mode-line-wrap.spec.ts`（**纯结构 / 计算属性断言，无像素断言**，
      因此不为本 change 引入任何新基线，CI 结构模式与本地跑同一判据）：① 出厂分叉两侧同框（code `pre`
      + 单视觉行 + 编辑区横向可达；md `break-spaces` + 多视觉行）；② 显式 `true` 时 code 折行、md 零变化；
      ③ code 模式下 `view.toggle-line-wrap` 真的翻 code 轴，且切到 md 文档时正文仍折行（轴分离的判别性）；
      ④ 全程文档逐字节不变
- [x] 3.3 本地跑 `LUMIR_VISUAL_PORT=4273 scripts/gate.sh visual`：**md 侧既有折行场景零变化、既有基线零更新**
      （若要 `--update` 才绿即停手上报）

## 4. 制品与文档

- [x] 4.1 `openspec/changes/code-mode-line-wrap/spec.md` 增量（`specs/editor-live-preview/spec.md`，
      MODIFIED ×3：「折行口径与配置来源」新增第三键 + 出厂分叉 + 不跟随 + 新 scenario；
      「折行渲染与代码块横滚容器」判定表按模式重写 + 新增「code 模式的正文行走 code 模式自己的口径」；
      「折行开关的瞬态口径」写死按前台模式选轴 + 新增对应 scenario）
- [x] 4.2 `proposal.md`：Why（Alex 逐字反馈 + M231 背景 + 行业出厂口径的两条一手信源）/ What Changes /
      Non-goals / Impact + **裁决记录节**（backlog #35/#36 的 Alex 裁决原话、语义张力点的合读口径、
      tower 2026-09-27 的两条澄清）
- [x] 4.3 `design.md`：语义三轴表 + 缺省不跟随的理由 + 判定点单一来源（含被否决的「判定拆两处」走法）+
      toggle 选轴的理由 + 配置面形状（为何 `bool` 而非 `Option<bool>`）+ 测试策略四层 + 风险与已知边界
- [x] 4.4 `docs/specs/config-reference.md` 新建（backlog #36①）：canonical 键值表（顶层 + `[editor]` 7 键 +
      `[ui]` 2 键 + `keys` + `log.level`，逐键给出类型 / 默认 / 取值范围 / 生效时机 / 真源指针）+
      解析容错口径节 + 写回纪律节（合并写、未知键保留、**不推荐**写全量默认）+ 配置目录布局节
      （`workspaces/` 现名与 #37 更名前向注记、`vault-sessions/`、`reading-positions/`、`logs/`，
      同一 vault 实体刻意分存的口径引 `vault_session.rs` 头注释）
- [x] 4.5 `docs/backlog.md`：#35 与 #36① 核销指向本 mission；#36②（`describe-config` 面板）保持
      「中期另立项」不动

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 5.2 `scripts/gate.sh quick` 全绿（cargo fmt / clippy / test / bindings 漂移 / 三份 tsc / 单测 /
      docs-check / openspec validate）
- [x] 5.3 `LUMIR_VISUAL_PORT=4273 scripts/gate.sh visual` 全绿，且**无任何基线更新**（`git status` 里
      `tests/visual/baselines/` 零改动）
- [x] 5.4 md 侧零变化的独立核对：`render-codeblock.spec.ts` 的折行组**一字未改**且全绿；该文件是本
      change 对 md 路径「逐字节不动」的回归护栏
- [x] 5.5 **真机验收场景：本 change 不加**（理由见下），既有真机折行场景保留、口径不变

### 5.5 的说明：为什么本 change 不加真机场景

判据是计算属性（`white-space` / 行盒高度）与文档字节。真机通道（AX 树 + 截图）读不到计算属性——
能拿到的只是「长行有没有折出第二行」这类**派生**证据，而同一条证据在 chromium 层是直接读数、可复算、
可反向验证（本 change 的视觉场景 ③ 就是靠「同一按键在 md 侧结论不变」把轴分离判别出来的）。既有真机
折行场景守的是「配置默认 + `[keys]` 绑定两条端到端路径」的**行为正确性**，本 change 不改这两条路径的
形态（新增的是配置键，命令与键位不变），因此真机侧的增量覆盖为零、成本不为零（一次真实构建 + 实例
操作）。若后续发现真机上 code 模式的横向平移与 chromium 有差异（例如触控板横向手势），届时按手感证据
另提 change 补场景。
