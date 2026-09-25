# Tasks: live-theme-switch

实现前提：提案节点 1 裁决通过（D1 命令形态 / D2 默认键位 / D3 配置写回——若裁决改备选，
先按备选改写本清单与 specs delta 再动工）。

## 1. 前端切换机制

- [ ] 1.1 `src/main.ts`：新增 `applyTheme(theme)` 单一施加点（写 `documentElement.dataset.theme`
  + 刷新 modeline 主题指示文案）；启动装配（现 `main.ts:980`）改为经它施加，同步改写
  `main.ts:969-979` 的「运行期不切换」注释
- [ ] 1.2 `src/preview/mermaid.ts`：新增 `invalidateMermaidTheme()` 出口——`initialized` 复位 +
  `renderCache` 清空 + 世代号自增；世代号检查守在缓存唯一写入点（`ensureMermaidRender` 的
  settle 回调，`mermaid.ts:244-246`）：任务入队时记世代号、写缓存前比对，不一致丢弃（不写
  缓存、不通知、不重排队——重渲由 previewRefresh 重建路径承担，防止同一 source 排两遍）；
  未懒加载时幂等 no-op；同步改写文件头 :12-16 的自述
- [ ] 1.3 `src/main.ts`：切换命令实现——读当前主题、循环取下一档（light→dark→eink）、
  `applyTheme` + `invalidateMermaidTheme()` + dispatch `previewRefresh` + 触发配置写回（§3）
- [ ] 1.4 `src/shell.ts` + `src/main.ts`：modeline 右段主题指示钮（button，文案 = 当前主题名，
  点击走与命令同一实现路径）；样式吃 token（eink chip 描边化），零新色值

## 2. 键位与命令

- [ ] 2.1 `src/keys.ts`：`view.theme-cycle` 进 `NON_TAB_GLOBAL_COMMAND_IDS`；默认绑定
  `Cmd-Shift-T`（scope global），doc 按三来源格式写冲突核实（表内 / muda 预置 accelerator /
  macOS 系统级）；`KEYLESS_COMMAND_IDS` 不变
- [ ] 2.2 键位面板（`app.describe-bindings`）如实列出该命令与绑定；`[keys]` 重绑 / 解绑生效
  （既有机制，补一条单测钉住该命令在覆盖通路里可走）

## 3. 配置写回

- [ ] 3.1 `src-tauri/src/config.rs` / `commands.rs`：新增 `config_set_ui_theme(theme)` 命令——
  照 `write_last_vault_to` 模板（serde_json::Value 级合并、tmp+rename 原子写、失败
  `CommandError`）；注册进 `lib.rs` 的 invoke handler 清单与 `capabilities/default.json` 的 ACL
- [ ] 3.2 Rust 单测：正常写回（合并保留其他字段）、非法取值拒绝、写失败路径（只读目录）
  的错误形态
- [ ] 3.3 前端写回调用：不等结果；失败 → `logEvent` + toast「主题已切换，但写入配置失败，
  重启后将回到 <配置文件值>」
- [ ] 3.4 `src-tauri/src/config.rs` 的 `UiConfig` doc comment 去掉「重启生效」自述，ts-rs 重新
  导出（`src/bindings/UiConfig.ts` 随构建刷新）

## 4. 验证

- [ ] 4.1 单元测试：主题循环顺序、mermaid 世代号丢弃迟到结果（含 in-flight 竞态用例）、
  `invalidateMermaidTheme` 幂等、键位三表对账（新命令有绑定且不在 keyless 清单）
- [ ] 4.2 视觉场景（`tests/visual/scenes/`）：新增三主题切换场景——桩注入启动主题 → 调切换
  命令（或点击 modeline 钮）→ 结构层断言 `data-theme` 变化、代表性表面计算样式跟随（含
  eink 覆盖命中 / 失效）、mermaid 块重渲后 SVG 内联色变化（先造必须 FAIL 的反向输入实测
  断言会红）；**改动 `tests/visual/scenes/**` 后本地跑 `bash scripts/gate.sh visual`**；
  不新增像素基线（口径见 design §4 末行）
- [ ] 4.3 真机验收场景（`scripts/acceptance/scenarios/36-theme-live-switch.md`，编号接
  35-restyle-three-themes）：快捷键切换三档循环一周逐档断言 `data-theme` 与计算样式；
  modeline 钮点击切换；含 mermaid 块的文档切换后重渲 settle；切换后读 config.json 断言
  `[ui] theme` 已写回；重启实例断言首帧为最后切换的主题（持久性闭环）；断言按 REVIEW.md
  第 1/2 条纪律带反向验证
- [ ] 4.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 4.5 `bash scripts/gate.sh quick` 全绿；真机验收套件 `node scripts/acceptance/run.mjs 36`
  PASS（合并后、Alex 验收前由 agent 先跑一遍，AGENTS.md 执行时机）

## 5. 收尾

- [ ] 5.1 归档顺序核对：`openspec list` 确认 restyle-ui-tokens-v1 已归档（本 change 的
  ui-design-system delta 是 MODIFIED，它未归档则 archive 会被拒）；未归档则在
  `docs/backlog.md` 待裁决节登记本 change 的待归档状态，不强行 archive
