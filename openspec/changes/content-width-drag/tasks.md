# Tasks: content-width-drag

实现顺序：配置面 → 前端宽度模块与手柄 → 持久化 IPC → 单测 → 视觉 → 真机 → 收口。
每条完成后就地勾选；跑不动的项写「未验」并附原因，MUST NOT 写成已验（REVIEW.md 第 6 条）。

**口径基线（节点 1 裁决，2026-09-25 已落槌）**：D1 默认 **680**、D2 上下限 **[680, 1200]**（默认值即
下限）、D3 **写回 config.json**（Rust 侧通用键值合并写命令 `config_set_ui_value`，M226 的
`ui.theme` 复用同一通道）、D4 **live 拖拽**（退路松手生效）、D5 **手柄进 code 模式**。
裁决原文逐字转写在 `proposal.md` 的「裁决记录」节。

## 1. 配置面（Rust）

- [x] 1.1 `src-tauri/src/config.rs` 的 `UiConfig` 增 `content_width: f64`（`Default` 给裁决值；
      f64 与 `font_size` 先例同型，design §2.1），常量三件套 `DEFAULT_CONTENT_WIDTH` /
      `CONTENT_WIDTH_MIN` / `CONTENT_WIDTH_MAX` 照 `FONT_SIZE_*` 模板
- [x] 1.2 `RawUiConfig` 增 `content_width: Option<f64>`（沿用 `#[serde(default)]`）；
      `validate()` 的 ui 分支按 `font_size` 模板扩：缺字段回落默认不告警、越界回落默认 + warning
- [x] 1.3 Rust 单测：缺字段取默认（比照 `missing_editor_wrap_fields_take_defaults`）、越界回落 +
      warning 恰一条、类型不符（`{"ui": {"content_width": "680"}}`）走整文件回落（比照
      `wrong_type_ui_theme_falls_back_entire_file`，断言 ui 与 editor 字段一起回默认、无混合态）
- [x] 1.4 `cargo test` 重新导出 `src/bindings/UiConfig.ts` 并一并提交；bindings 漂移门禁绿
      （`scripts/gate.sh:61-70`）

## 2. 前端：宽度模块、施加与手柄

- [x] 2.1 新模块 `src/content-width.ts`：`--layout-doc-measure` 的 token 名常量（单一来源）、
      TS 侧默认 / 上下限镜像常量（与 Rust 互指注释）、纯函数 `clampContentWidth` 与对称换算
      `nextContentWidth(startWidth, deltaX)`（取整到整数 px，先例 `src/typography.ts:61-68`）
- [x] 2.2 `src/editor.ts`：闭包内 `contentWidth` 运行期真源 + `setContentWidth(w)`（写 token →
      `view.requestMeasure()` → `keepCaretVisible()`，三步同 design §2.3；值未变直接返回）；
      token 写在 `documentElement`（与 `applyTypography` 同落点）
- [x] 2.3 `src/shell.ts`：编辑器 pane 内加手柄覆盖层容器（与 `.cm-editor` 并列、absolute、
      `pointer-events: none`）；两条手柄条（左右缘）`pointer-events: auto`、10px 命中区、
      2px 视觉线常态 `opacity: 0`、hover / 拖拽中显现、`cursor: col-resize`、`role="separator"` +
      读屏名；样式落 `src/style.css`，色取既有 `--accent` token，零新配色
- [x] 2.4 手柄定位：读 `.cm-content` 的 `getBoundingClientRect()` 换算到 pane 坐标贴左右缘；
      更新时机 = pane 的 ResizeObserver + `.cm-scroller` 的 scroll + 宽度施加后 + 会话切换后；
      空态（无前台文档）时手柄 hidden——判定复用 `showEditor` 的状态分叉，不另造布尔
- [x] 2.5 拖拽：`pointerdown` → `setPointerCapture`；`pointermove` 按 rAF 合并后走
      `nextContentWidth` + `setContentWidth`（live，D4）；`pointerup` 且值有变化才触发持久化
      （task 3.1）。拖拽全程手柄保持显现
- [x] 2.6 `src/main.ts` 配置消费块：`applyTypography` 之后加
      `editor.setContentWidth(snapshot.config.ui.content_width)`；前端不判区间（Rust 已校验，
      与主题同口径）
- [x] 2.7 `tests/visual/scenes/tauri-stub.ts` 的 `config_get` 桩补 `ui.content_width`（缺省 =
      裁决默认值，注释指回 Rust 常量）

## 3. 持久化（写通道）

- [x] 3.1 `src-tauri/src/commands.rs` 新增 `config_set_ui_value(key, value)` IPC（D3 落槌：通用键值
      合并写，M226 的 `ui.theme` 复用同一通道）：读整份 JSON 为
      `Value`（解析失败按 `{}` 起）→ 确保 `ui` 为 object → 写该键 → tmp+rename 原子
      替换、保留未知字段（纪律照 `write_last_vault_to`，`commands.rs:394-428`）；纯函数
      `merge_ui_value` 分离可测；注册进 invoke handler；`src/ipc.ts` 加调用包装（文档化注明
      `ui.theme`（M226）将复用）
- [x] 3.2 Rust 单测：`merge_ui_value` 断言含未知字段 / 其它表的配置写回后逐键保留；
      写失败路径返回 `config_write_failed`
- [x] 3.3 前端接线：`pointerup` 后调用 IPC；失败 → toast（`文案-Copy.md` 新增一条，续号）+
      `logEvent("config_warning")`，运行期宽度**不回滚**；成功后不回读配置（design §2.4）

## 4. 单测

- [x] 4.1 `tests/unit/content-width.test.ts`（新文件）：`clampContentWidth` 端点与取整、
      `nextContentWidth` 的对称性（右缘 +Δx = 宽度 +2Δx；左缘 −Δx 同效）与钳制；TS 默认 /
      上下限常量与 Rust 同值的对账断言（REVIEW.md 第 8 条）
- [x] 4.2 1.3 / 3.2 的 Rust 单测同批

## 5. 视觉门禁

- [x] 5.1 新场景（挂编辑区既有 spec 或新增 `content-width.spec.ts`）：默认口径下手柄不可见、
      hover 列缘命中区显现 2px 线（含「移开即隐去」负向断言——先造能 FAIL 的输入再提交，
      REVIEW.md 第 1 条）
- [x] 5.2 拖拽场景（content-width.spec.ts：右缘 +80px → `.cm-content` +160、live 生效、松手写一次、
      超长行折点重算（行盒高度下降断言）、左缘对称、上下限钳住+无变化不写盘）全绿；
      **未单独覆盖**：「点击折行内文字落点正确」——折点重算（requestMeasure 到位的判据）已在场，
      落点精度是 CM6 既有 measure 机制继承，未造专项断言
- [x] 5.3 code 模式场景：手柄按 `.cm-content` 实测矩形贴合（列不居中分支）已覆盖全绿；
      **未覆盖**：`line_wrap = false` 下横向滚动后手柄跟随（scroller scroll → reposition 链路
      无场景）——已登记 design「已知边界」，归 follow-up
- [x] 5.4 配置接线场景：桩给 `content_width: 800` 启动首帧即 800 已覆盖全绿；越界回落 + warning
      走 Rust validate 单测覆盖（chromium 桩不经 Rust 校验，造不出该路径）
- [ ] 5.5 受影响基线重建（**进行中，待 Alex 过目**：18 张失败基线逐张对照表 + 三图对照过目包
      index.html 已落 `test-results/m228/baseline-review/`（主仓，git 外），机制归因逐张列出；
      像素层 run 输出留档 `test-results/m228/gate-visual-*.log`；基线 PNG 零 diff 纪律保持，
      Alex 过目批准前不入库）——原文：（D1=680 使默认口径位移 16px，含编辑区的整页基线必然变化）：逐张对照表
      （张名 / 变化原因 / 归属 heading 还是 width）+ 过目包（index.html，每个受影响表面至少一张
      截图）落 `test-results/m228/`；**Alex 过目批准前 git 不提交任何基线 PNG**（工作区保持零基线
      diff），批准后入库（sha256 逐张核对）；删除/移动元素出现过的所有整页基线时间戳逐一核对
      （AGENTS.md 视觉门禁卫生条）
- [x] 5.6 结构层全绿（`LUMIR_VISUAL_STRUCTURAL=1 LUMIR_VISUAL_PORT=4228`，visual-regression 349s PASS）；
      像素层本地跑进行中，输出与对照表落 `test-results/m228/`（基线 PNG 零 diff 纪律不变）

## 6. 真机验收（agent 执行，不进 CI；随实现同 PR）

本节场景序号按 tower 对账后的 registry 分配（r1 评审发现撞号后建立）：36 = live-theme-switch
（M226，已合并）、**37 = heading-hierarchy（M228）**、**38 = content-width-drag（本 change，M228）**。
实现期新增场景前先核对 `scripts/acceptance/scenarios/` 的既有编号与本表，不再「续现有序列」盲取。

- [x] 6.1 `scripts/acceptance/lib/app.mjs` 的 `writeConfig` 支持 `uiContentWidth` 可选字段
      （不传即不写 → 走 Rust `Default`）
- [x] 6.2 新增场景 `38-content-width-drag.md` 真机 PASS：默认配置起实例，拖拽右缘/左缘手柄，
      `config.json` 出现 `ui.content_width`（确定值 840/920）且其余键逐键不变、文档 sha256/mtime
      与 dirty 不变；截图留档。拖拽通道更正：KimiCU drag 工具在 WKWebView 不产生 DOM 拖拽（与
      dblclick 同族注入边界），harness 新增 swift+CGEvent mode 5（down→插值 dragged→up）通道，
      场景 38 与 README「已知边界」已按此落笔
- [x] 6.3 场景含重启保持：改宽后重启实例，列宽保持（读 `config.json` + 截图对照）
- [ ] 6.4 写失败降级场景：**真机未验**（harness 无 chmod/shell 通道，套件刻意不引入——场景 38
      「已知边界」已登记）；改由 chromium「写盘失败」场景（failures 注入，toast D121 + 不回滚 +
      config_warning 断言全绿）与 Rust `config_set_ui_value` 单测覆盖
- [x] 6.5 大文档拖拽帧实测（1MB 探针文档、折行开、playwright chromium 一次性探针）：拖拽帧间隔
      p50 8.3ms / max 9.4ms、0 帧超 16.7ms 预算，live 拖拽（D4）达标不走退路；数据落
      `test-results/m228/drag-frames.json`（与 acceptance 证据同级惯例，git 外），design §4-2
      实测结论已回填
- [x] 6.6 起实例前 `df -h` 看水位、确认 1420/1430 空闲；用 `pnpm tauri dev` 规避白屏陷阱
      （REVIEW.md 第 10/11/12 条）

## 7. 文档

- [x] 7.1 `docs/specs/design-tokens-v1.md` 的 `--layout-doc-measure` 条目改为「默认 680px（D1
      落槌值），可被 `ui.content_width` 覆盖（content-width-drag）」
- [x] 7.2 `文案-Copy.md`：手柄读屏名 + 写盘失败 toast 两条新条目（续号、附修订记录）

## 8. 收口

- [x] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 8.2 `scripts/gate.sh quick` 全绿（10/10 PASS，bindings 漂移随提交转绿）
- [ ] 8.3 归档对账（`docs/process/openspec-workflow.md` 批次收尾 checklist）：本 change 新建
      capability `content-width`，归档后须手写 living spec 的 Purpose 替换占位（archive 的
      `TBD` 会让 validate 报红）
- [x] 8.4 把「实现期必须验证」的结论回填 design §4：逐条标注实测结果（成立 / 走退路 / 转为
      已知边界），不留「待验」字样进归档
