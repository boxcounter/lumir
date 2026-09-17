# Tasks: multi-vault-workspaces

> 提案阶段只锁定意图；本清单随实现细化。入口形态（裁决点 1）在节点 1 定下后，任务 3.1 / 5.2 / 6.3 按定下的形态落地。

## 1. 后端：注册项字段与列表命令

- [ ] 1.1 `VaultWorkspace`（`src-tauri/src/workspaces.rs:35-50`）增 `last_opened_at: Option<i64>`（`#[serde(default, skip_serializing_if = "Option::is_none")]`）：vault 打开成功时与 `last_vault` 同一次成功路径写入（`src-tauri/src/commands.rs:302-329`（`remember_last_vault` 的降级 warning 口径））；打开失败 / remap 门短路时不写。核对 `vault_register`（`workspaces.rs:218-239`）与 `sweep_registry`（`:85-129`）的整项构造不会清掉该字段（后者用 `..v` 展开，前者是重映射复位路径，需显式保留）
- [ ] 1.2 新增 `vault_list` command：读注册表（复用既有目录读取与「解析失败即跳过」的容错口径）+ 每项返回 `{ id, path, name, available, last_opened_at, tab_count }`；`name` 取 path 的 basename；`tab_count` 来自会话文件的固定标签数（见 2.3）
- [ ] 1.3 可用性判定与线程：路径探测 MUST NOT 在 Tauri 主线程上做（`#[tauri::command(async)]` 或等价迁移）；未归档与已归档项都返回并标 `available: false`（归档只抑制 remap 候选，不抑制列表可见性）
- [ ] 1.4 ts-rs 重新导出新类型到 `src/bindings/` 并一起提交（`cargo test` 触发导出，`scripts/gate.sh quick` 的 bindings 漂移检查会核对）
- [ ] 1.5 Rust 单测：列表含失效项、排序（最近打开倒序 + 不可用项沉底）；`last_opened_at` 只在打开成功时写入；单个注册项损坏时列表仍返回其余项

## 2. 后端：按 vault 的会话存储

- [ ] 2.1 新增会话读写模块（`~/.config/lumir/vault-sessions/<id>.json`）：字段 `version` / `tabs`（有序 vault 相对路径）/ `active` / `updated_at`；写用临时文件 + rename 原子替换；解析失败 / `version` 不匹配 / 字段类型非法 → 返回「无历史」并记 warning，不抛错
- [ ] 2.2 条目校验：丢弃绝对路径、含 `..`、越出 vault 的条目（`..` 与绝对路径的判断与既有 vault 相对路径口径同源）
- [ ] 2.3 命令：`vault_session_get(vault_id)` 与 `vault_session_put(vault_id, tabs, active)`；写失败返回可降级的 warning 语义（不抛错，前端不因它中断切换与打开）
- [ ] 2.4 Rust 单测：往返一致；损坏 / 缺版本等价于无历史；越界条目被丢弃；写失败不 panic 且不影响其它 vault 的会话

## 3. 前端：入口、浮层与键位

- [ ] 3.1 树头部入口按裁决点 1 的形态落地（A：`button.ft-vault`（名称 + `▾` caret，`aria-haspopup="listbox"` / `aria-expanded`）；B：保留 `button.ft-switch-btn`「切换」改为开列表 + 常驻 `＋`）；单 vault 时常驻出现
- [ ] 3.2 浮层渲染：显示名 / 摘要「N 个标签 · 上次打开时间」/ 路径尾部三段 / 当前项唯一标记 / 不可用行（标注 + 「重新定位…」）/ 分隔线 + 「新增 vault…」（A 在浮层底部且是浮层内唯一入口；B 在左栏头部、浮层内不重复）；与 `.lumir-toc` 同手法的绝对定位、不占常驻行高、关闭即消失；宽度允许溢出左栏
- [ ] 3.3 键位：新增命令「打开 vault 切换器」+ 默认 `Cmd-o` 进 `src/keys.ts` 的 `KEY_BINDINGS`（含 `doc` 字段说明来由与冲突核实；键位面板自动收录该条，无需另改 `src/bindings-panel.ts`——面板读的就是该表的 `doc`）；浮层内 ↑↓ 选择、Enter 切换、Esc 关闭（就地消费、不进键位表，与 D86 同口径）
- [ ] 3.4 basename 派生收敛为单一函数（现状 `src/tree.ts:240` 与 `src/main.ts:498` 各一份，列表是第三个消费点——REVIEW.md 第 8 条同族，一并收口）
- [ ] 3.5 列表在每次打开时重新拉取（MUST NOT 维护常驻镜像）；不可用行点击不发起打开

## 4. 前端：切换、会话落盘与装载后恢复

- [ ] 4.1 切换流程：dirty 前置检查（提示点名**当前** vault、带脏标签数，替换 `src/save-controller.ts:247-248` 的两条既有串——旧串不在 deck 里）→ 三动作（保存并切换 / 放弃修改并切换 / 取消，与 D93 同形）→ flush 当前 vault 的会话 → `vault_open_path` → `loadVault`；目标打开失败保留当前上下文，只给一条失败提示（沿用 `src/main.ts:466-470`）
- [ ] 4.2 「保存并切换」在保存未闭环（冲突 / 写失败 / 无落盘基准）时 MUST NOT 继续切换，沿用既有保存失败提示与出口；不可保存的脏标签不给该动作
- [ ] 4.3 切换进行中忽略新的切换请求；`loadVault` 里的既有守卫保留为最后防线
- [ ] 4.4 会话写入时机：标签集合 / 顺序 / 激活项变化后防抖写；切换前与退出前 flush（MUST NOT 只依赖防抖定时器）；预览标签不入盘；摘要数字与入盘数字同源
- [ ] 4.5 装载后恢复：`loadVault` 完成后按会话以**固定标签**意图逐个 `openFile`（MUST NOT 用默认预览意图——第二个起会顶掉前一个，只剩一个标签），随后激活存储的激活项；激活项不可用退化为第一个可打开的；越界 / 缺失 / 打不开的条目跳过并给**一次**计数提示；全部不可用 → 空 vault 首入态
- [ ] 4.6 启动路径衔接：标签恢复挂在 `vault:restore_finished` → `refreshVaultStatus` → `loadVault(..., restored = true)` **之后**（MUST NOT 挂在恢复线程或 `open_vault` 内）；`restore_pending` 为 `true` 时不恢复任何标签；用户已成功装载别的 vault 时不恢复（M156 的让位规则）
- [ ] 4.7 新增 vault：列表内入口 → `vault_open`（取消不改上下文）→ 命中 remap 门时沿用既有两出口浮条（不绕过）→ 成功即自动切换；不引入命名步骤
- [ ] 4.8 失效行「重新定位…」：复用 `vaultRemap` → 成功后打开该 vault；目标路径已被另一个注册项占用时拒绝并给人话提示
- [ ] 4.9 前端单测（`tests/unit`）：会话过滤（预览不入盘 / 越界条目丢弃 / 激活项退化 / 跳过计数）、切换守卫三动作状态机、切换进行中新请求被忽略

## 5. 文案 deck

- [ ] 5.1 把 `demo/multi-vault.html` §7 的新文案落进 `文案-Copy.md`（编号按 deck 末位连续追加，当前末位 D94；五要素齐全），并在文末「文案实现备注」登记归属文件与「轻量大纲 / 多标签」同形的说明
- [ ] 5.2 方案 A 落地时把 D4「切换」标注停用不复用（与 D30 / D2–D3 的既有处置同形）；方案 B 保留原样
- [ ] 5.3 术语核查：界面文案与契约里零 `space`（决策 4）；`V15_guard` 按 M158 r1 修正后的口径点名当前 vault

## 6. 真机验收与视觉制品

- [ ] 6.1 新增真机验收场景（文件名 / `id` / `item` 三者一致，**号取落地时「待真机验收」列表的实际末位项号**——评审时末位为 15、M156 预计占 16，本 change 至少从 17 起；不得复用既有号，`run.mjs` 的筛选同时按 `id` 前缀与 `item` 号匹配，重号会串选）：① 多 vault 列表与切换（A 里打开两个标签 → 切到 B 呈空态引导 → 切回 A 恢复两个标签且激活项正确，`shot` + `ax` 证据）；② 启动时按 `last_vault` 恢复 vault 并一并恢复其标签列表；③ dirty 拦截三动作（「放弃修改并切换」走完，另两条各自闭环）
- [ ] 6.2 合成 vault 补第二个可选目录与会话预置 fixture；验收 runner 的 `configWrite` 支持覆盖 `last_vault`（与 M156 任务 3.4 是同一处能力，落地时合并、不重复加）；同步更新 `scripts/acceptance/README.md` 的动作表
- [ ] 6.3 视觉：新增元素级断言（入口、浮层、当前项、不可用行、单 vault 态入口仍在）；方案 A 下「切换」按钮退场会改动含它的整页基线——`--update` 前的截图须 Alex 过目，并按 REVIEW.md 第 3 条逐一核对该元素出现过的所有整页基线时间戳是否随本次更新（0.001 容差在 1200×800 下约 960px，有静默假绿风险）
- [ ] 6.4 若真机发现套件缺动作（如「预置某个 vault 的会话文件」），登记套件缺口并保留如实结论，不降级为「人工看过」

## 7. 文档与口径

- [ ] 7.1 `docs/backlog.md` 第 10 条（多标签会话恢复）由本 change 承接——归档时更新其状态与口径
- [ ] 7.2 归档时把「用户主动打开 / 切换移出主线程」（design §9 的登记项）落一条 backlog 或 finding，避免这条账只留在 design 里
- [ ] 7.3 对账既有 living spec **到 scenario 粒度**（M161 r1 P2-1 的教训：只对 requirement 粒度会让矛盾 scenario 留在 living spec 里）：逐条核 `vault-workspace` / `multi-tabs` / `file-tree` / `perf-measurement` 的每条 scenario 与本 change 的口径是否一致——本 change 对 `vault-workspace` 只 ADD、对 `multi-tabs` 提交 1 条 MODIFIED（其第三条 scenario 的提示口径），`file-tree` 空态不变、`perf-measurement` 无 delta；delta 里的 MODIFIED requirement 文本须与 living spec 逐字一致（只改该改的那一处）；proposal 的「已建议口径」两表与该对账结论对得上

## 8. 验证

- [ ] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 8.2 `scripts/gate.sh quick` 全绿（fmt + clippy + cargo test + bindings 漂移 + tsc + openspec validate）
- [ ] 8.3 `scripts/gate.sh visual` 全绿；基线变动逐张经 Alex 过目后入库
- [ ] 8.4 `node scripts/acceptance/run.mjs --check` 通过后，按 6.1 落地时的 `id` 前缀跑该批场景，全 PASS（证据留 `test-results/acceptance/`，不入 git）
- [ ] 8.5 冷启动读数前后对比：本 change 不新增 perf 端点、不改阈值与门禁口径；若 CI 冷启动 median 回退 >40%，按真回归排查，不得调整基线
- [ ] 8.6 归档评审前对账一次本 change 的「建议口径」是否被节点 1 翻转（入口 A/B 与 design §9 的未决项）；有翻转则先改 spec 再归档
