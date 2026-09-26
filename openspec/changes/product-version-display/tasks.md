# Tasks: product-version-display

实现前提：提案节点 1 裁决通过（D1 落位 / D2 窄窗退让 / D3 文案字档——若裁决改备选，
先按备选改写本清单与 specs delta 再动工）。

## 1. 前端标识块

- [ ] 1.1 `src/shell.ts`：标题栏 append 第三段子容器 `span.titlebar-identity`（产品名段 +
  版本号段 + 分隔符，照 design §3.1；带读屏名、非 button）；文件头标题栏注释（:48-56）
  两段式自述改三段式
- [ ] 1.2 `src/style.css`：标识块样式——`flex: none` + `margin-left: auto` 钉右端、
  `gap: var(--sp-3)`、`user-select: none`；产品名 `--fs-ui-s` / `--fw-emphasis` /
  `--text-2`，分隔符与版本号 `--text-3` 常规字重；**零新 token、零组件级 eink 覆盖**；
  `src/style.css:338-342` 的「本版没有动作钮」自述补「标识块钉右端、未来动作钮排其左侧」
  的排列约定
- [ ] 1.3 `src/main.ts`：启动装配读取 `getName()` / `getVersion()`（`@tauri-apps/api/app`）
  一次并写 DOM；失败降级 = 标识块 `hidden` + `logEvent` 一条（MUST NOT 渲染假版本号，
  design §3.3）；运行期不刷新
- [ ] 1.4 窄窗退让（**D2 改选备选**，2026-09-25）：`src/modeline.ts` 新模块承担退让逻辑——
  窗口宽 < 640px（`matchMedia`）时隐藏标题栏的 `ti-sep` / `ti-version` 两段，版本号拼进
  modeline 右段尾部（独立 span，不与 `syncModelineMeta` 的 meta 段合写）；≥ 640px 恢复。
  产品名始终留标题栏右端（design §3.2）

## 2. ACL

- [ ] 2.1 `src-tauri/capabilities/default.json`：增加 `core:app:allow-name` 与
  `core:app:allow-version`；description 补来由（照现有三条权限的注释密度）；**不加则
  getVersion 被 ACL 静默拒绝**（M26 listen 先例）——实现期先故意不加跑一次确认真机
  降级路径成立（标识块隐藏 + logEvent），再加上
- [ ] 2.2 若内置通道在本仓 CSP/ACL 下实测不可用（design §4 的例外条款）：回落自写 Rust
  命令 `app_meta()`，照 `config_get` 模板 + ts-rs 导出 + ACL，并在 design §4 补记回落原因

## 3. 验证

- [ ] 3.1 单元测试（tests/unit）：文案组装（产品名 + 分隔符 + 版本号只有一处真源）、
  降级路径（getVersion reject → hidden + logEvent，MUST NOT 显示占位串）
- [ ] 3.2 视觉场景（`tests/visual/scenes/`）：tauri 桩补 `plugin:app|name` /
  `plugin:app|version` 两条 invoke 路由（fixture 值 "Lumir" / "0.0.0"）；新增结构层断言
  场景——标识块在场且文案形态正确、钉右端（tabstrip hidden 的空态也在右端）、三主题
  计算样式取 `--text-2`/`--text-3`；断言按 REVIEW.md 第 1 条纪律先造必须 FAIL 的反向
  输入实测一次
- [ ] 3.3 视觉门禁卫生（REVIEW.md 第 3 条 + AGENTS.md 硬规则）：标识块出现在**空态主界面**
  等既有整页基线的画面里——`bash scripts/gate.sh visual` 跑红后，逐一核对受影响整页基线
  清单，截图 Alex 过目再 `--update`
- [ ] 3.4 真机验收场景 **`scripts/acceptance/scenarios/39-titlebar-identity.md`**（编号接
  38-content-width-drag；端口与隔离纪律照旧，1420/1430 不碰）：标识块显示「Lumir ·
  0.0.0」且版本号与 src-tauri/tauri.conf.json 的 version 逐字节一致（读文件比对，不硬编码
  预期值）；窗口调窄（≈520px）后版本号退入 modeline 右段、产品名留标题栏右端（D2 备选），
  拉宽恢复；标识块上按下拖拽窗口成立（drag region 不被阻断）；三主题各一张标题栏截图证据
- [ ] 3.5 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 3.6 `bash scripts/gate.sh quick` 全绿；真机验收套件 `node scripts/acceptance/run.mjs 39`
  PASS（合并后、Alex 验收前由 agent 先跑一遍，AGENTS.md 执行时机）

## 4. 收尾

- [ ] 4.1 归档顺序核对：`openspec list` 确认 restyle-ui-tokens-v1 已归档（本 change 的
  ui-design-system delta 含 MODIFIED，它未归档则 archive 会被拒）；未归档则在
  `docs/backlog.md` 待裁决节登记本 change 的待归档状态，不强行 archive
