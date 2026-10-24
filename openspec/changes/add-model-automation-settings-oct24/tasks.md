# Tasks: add-model-automation-settings-oct24

## 1. 提案与原型（节点 1 交付，已完成）

- [x] 1.1 `proposal.md` / `design.md` / `tasks.md` 与 `specs/{settings,harness,keymap-commands}` delta 起草完成
- [x] 1.2 自包含可点击原型 `design/prototypes/model-automation-settings-oct24.html`（内置控制面板覆盖全部场景与三主题，合成数据）
- [x] 1.3 原型交互断言先写后实现并跑绿；light / dark / eink 关键屏截图落 `.local/reviews/model-automation-settings-oct24/`
- [x] 1.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 与 `scripts/docs-check.sh` 通过

## 2. 配置层（Rust）

- [ ] 2.1 把 `validate()` 的 warning 生产改为结构化诊断（`ConfigDiagnostic { code, path, severity, message }`），`ConfigSnapshot.warnings` 由诊断的 `message` 派生、文案逐字不变
- [ ] 2.2 给设置面路径的诊断补 code / path；建立**阻断级词表**（模型 id 空 / 重复、window 越界、effort·vision 非布尔、半配置、wire 档非法·不支持、base_url 空串、未知字段），词表只在 Rust 一处维护
- [ ] 2.3 新增严格读 + `update_json_atomic_strict`（与既有原子写共用锁与 `write_file_atomic`）；文件不可解析时返回解析错误而非按 `{}` 处理
- [ ] 2.4 把 `write_config_value_to` / `write_last_vault_to` 改为在 `update_json_atomic` 闭包内读—改—写，关闭「读发生在取锁之前」的丢更新窗口
- [ ] 2.5 新增 `src-tauri/src/settings.rs`：`SettingsSnapshot`（raw vs 生效、键缺席 vs 显式、坏模型行可见、API Key 只回末 4 位、文件状态、默认值 / 能力矩阵）
- [ ] 2.6 实现 `SettingsPatch` 与 apply 算法：锁内 revision 比对 → 合并 raw → 严格复解析 → 非回归判据 → 原子写；`Reset` / `Clear` 删键；`models` 按 id 保留未知子键
- [ ] 2.7 `HarnessProviderConfig` 增加派生的 `configured`（api_key 非空且 models 非空），模型 chip 选项改为「已配置 ∪ 当前 provider」、仍过滤 mock
- [ ] 2.8 设置快照 / patch / 结果类型经 ts-rs 导出，重导出 `src/bindings/**` 并随实现提交

## 3. 前端

- [ ] 3.1 命令 `app.settings-open`（global、默认 `⌘,`）+ 应用菜单「设置…」项（无 accelerator、结构假设失败降级）
- [ ] 3.2 `src/settings-panel.ts`：模态面板、provider 切换、基础区 / 高级区、模型清单行编辑、四个开关、页级「还原默认」
- [ ] 3.3 草稿状态机：clean / dirty / saving / saved / blocked / conflict / file-invalid；保存后用返回值重建基线
- [ ] 3.4 可访问性：背景 `inert`、`role="dialog"` + `aria-modal`、焦点圈定与交还、三条关闭路径、脏面板两步确认、`role="status"` polite live region
- [ ] 3.5 字段错误按 path 回填、`aria-invalid` / `aria-errormessage`、首错聚焦；顶部横幅（回落 / 文件不可解析 / 冲突 + 两个动作）
- [ ] 3.6 文案：新增设置面文案；D402 / D403 / D404 从「去 `config.json`」改为「去设置面板」并补 `vision`；config warning 与 `harness_model_missing` 的字段清单补 `vision`
- [ ] 3.7 面板关闭后 chip 重新取数一次（沿用 `configGet`），不引入全局配置状态层
- [ ] 3.8 样式按 design §10 的 token 口径落地（含 eink 1.4px 边框 / 无阴影 / 黑白开关）

## 4. 文档与规格

- [ ] 4.1 `docs/specs/config-reference.md`：补设置面的写回路径与新描述（既有 §3 写回清单漂移按 finding 单独处理，本 change 只加自己的行）
- [ ] 4.2 `docs/specs/config-reference.md` §1.5 的 `models[]` 指向新增的「模型清单声明」requirement
- [ ] 4.3 `design/prototypes/index.html` 增加本原型条目
- [ ] 4.4 实现 PR 合并时在 `docs/backlog.md` 落该 change 的归档跟踪条目（判据见 `docs/process/openspec-workflow.md`）
- [ ] 4.5 归档时把新建 capability `settings` 的占位 Purpose 替换为「应用内设置面板：模型接入与自动化开关的可见编辑面」，再跑一次 `validate --all --strict`

## 5. 验证

- [ ] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 5.2 `scripts/docs-check.sh` 通过（含 `openspec-archive-check.mjs` 的 MODIFIED 段落对账）
- [ ] 5.3 Rust 单测：快照 raw/生效、patch 类型拒绝、非回归判据、并发 revision、未知子键保留、半配置、文件不可解析只读
- [ ] 5.4 前端单测（`pnpm test`）：草稿状态机、错误回填与 ARIA、开关键盘操作、三条关闭路径、脏面板确认
- [ ] 5.5 视觉场景：1280×800 与 900×700 下打开即完整可见（O1/O2）、无水平溢出、Tab 不逃出面板、三主题各一屏
- [ ] 5.6 `scripts/gate.sh quick` 与本地 `scripts/gate.sh visual` 通过
- [ ] 5.7 回扫既有验收场景里对模型 chip 选项、D402–D404 文案、模型清单空态、`harness_model_missing` 的期望，逐条改准（只新增场景不算完成）
- [ ] 5.8 新增验收场景：`⌘,` 与菜单打开同一面板；首次接入（Key + 模型）保存后 chip 出现该 provider；越界窗口保存被拒且文件逐字节不变；外部修改冲突；未保存关闭两步确认
- [ ] 5.9 真机验收套件全量跑一遍，证据落 `.local/acceptance/`
- [ ] 5.10 全程只用合成 Key（形如 `test-key-…`）；MUST NOT 读取或写入真实 `~/.config/lumir` 与真实 vault
