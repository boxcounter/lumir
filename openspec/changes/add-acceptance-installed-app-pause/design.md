# Design: 安装版显式暂停通道 + 通用「保存全部」

## 1. 决策与范围

Alex 2026-11-26（节点 1）：除恢复外无异议；**「退出后就不需要恢复了，如果我需要用安装版我会自己
启动」**。因此本设计把原草案里的恢复面整段删除：

| 原草案 | 本设计 |
|---|---|
| 暂停后自动重开安装版 | **删除**：退出即结束，用户需要时自己启动 |
| LaunchServices 恢复注册 / 重新 open | **删除**：没有任何 open / lsregister 恢复调用 |
| 工作区指纹（判断「还是同一个工作区」） | **删除**：不保存、不比对 |
| `--recover-installed` 子命令 | **删除**：不提供入口 |
| 恢复失败的处理 / 重试 / 报告 | **删除**：不存在这条路径 |

代码里 MUST NOT 保留这些死路径或兼容层（「变更默认直接切断」）。崩溃 / 断电同样没有恢复入口，
但**不得**因此把一次没跑完的暂停报成成功：失败一律退出码 2，现场原样保留。

## 2. 产品侧：`document.save-all` 是「保存屏障」而不是「多按几次 ⌘S」

验收通道要在退出安装版之前拿到一个**正观测**：所有会丢的东西都真的落盘了。五步串成一条链
（`src/main.ts` 的 `saveAllBarrier`）：

1. `save.saveAllDirty()`：全部 pane 的全部脏标签逐条保存（既有实现；一条失败不打断其余）；
   `false` = 至少一条没闭环（冲突 / 写失败 / 无落盘基准）。
2. `switcher.flush()`：标签会话**真实落盘**（store 无条件写一份当前快照——退出路径上没有第二次
   机会，多写一次比漏一次便宜）。
3. `readingPositions.flush()`：阅读位置真实落盘（仅 pending；无 pending 算成功）。
4. **复查新 dirty**：前两步的 `await` 期间用户可能继续编辑；出现新 dirty 即失败。
5. **后端 dirty 镜像同步**：`await document_set_dirty(false)` 的真实往返（不是 fire-and-forget）；
   失败即屏障失败。成功后才允许退出守卫放行 ⌘Q。

**正向完成信号**：只有五步全绿才发 D1035「已保存全部更改」（success toast）；任一步失败发 D1036。
验收通道只认这条信号——**不得**以「没有错误提示」「AX 空树」「dirty 点消失」冒充成功
（REVIEW.md「读不到当成空」「断言等价于子串」条）。

**为什么 flush 要返回 boolean**：会话 / 阅读位置的写失败在既有实现里只降级为 warning（不拦停
切换 / 退出），这是对的；但「保存全部」需要区分「写成功」与「写失败但只 warning」。两个 store 的
`flush()` 因此改成 `Promise<boolean>`：写失败 → `false`（warning 照旧由 `deps.warn` 给出），
无内容可写 / 写成功 → `true`。既有调用方（`beforeunload`、`syncActiveDocument`、切 vault）继续
`void` 忽略返回值，行为逐字不变。

**为什么是普通命令 + 菜单项**：`document.save-all` 进 `COMMAND_IDS` 并登记
`KEYLESS_COMMAND_IDS`（默认不占键位——⌘S 仍是单文档保存；⌘⇧S 语义在不同应用里分歧，且菜单键
等价会在 NSApplication 分发阶段截走物理键，M131 / M149 / M627 同一机制）。原生 File → Save All
不带 accelerator，点击经 `MENU_COMMAND_EVENT` 回同一命令实现（`menu_command_of` → `saveAll`），
MUST NOT 另开保存链路。菜单插在 File 子菜单**开头**：关闭项让位之后末项是自定义 Close，插在末尾
会破坏既有结构假设。

## 3. 验收侧：暂停通道

### 3.1 阶段与判据

```
发现 → 身份复核（before-save）→ 按 pid 激活 → File → Save All → 等完成信号
     → 身份复核（before-quit）→ 真实 ⌘Q → 等原 pid 消失
```

- **发现**（`discoverInstalledApp`，纯函数）：只认唯一、canonical 的 `/Applications/Lumir.app`，
  bundle id 必须等于产品 id（从本仓 `tauri.conf.json` 现读），pid / startedAt 必须可读。dev 实例、
  验收 bundle、别的 `.app` 副本、多实例、身份不可读一律 `PauseRefused`（退出码 2、**零副作用**——
  不激活、不点菜单、不 ⌘Q）。
- **身份复核**（`verifyInstalledTarget`）：pid + startedAt（±2s，`etime` 只有秒级精度，容差用于
  抗读数漂移、同时能识别 pid 复用）+ app 根 + bundle id。保存前与 ⌘Q 前各一次。
- **激活**：`System Events` 的 `set frontmost of first process whose unix id is <pid>`。MUST NOT
  按名字（会解析到别的副本）；MUST NOT Apple Event quit（直连 `terminate:`，不经过 ⌘Q 守卫）。
- **菜单**：AX 节点 `AXMenuBarItem (File)` → AXPress，再 `AXMenuItem (Save All)` → AXPress；
  读不到即失败，不退回快捷键（该命令按设计没有默认键位）。
- **完成信号**：节点级**精确相等**（`AXStaticText` 的 title / label / value 等于 D1035 的 zh 或
  en 列），不是全树子串——正文里写着同一句话不得冒充。失败终态（D1036）出现即失败；空树 /
  读失败 / 超时一律失败，**不 ⌘Q、不跑批**。
- **退出**：真实 `press_key(pid, "cmd+q")`，轮询 `listLumirInstances()` 直到**原 pid** 消失。
  超时（dirty 守卫挡住 / 无响应）→ `PauseFailed`，现场保留；不补 SIGTERM / SIGKILL。

### 3.2 锁与登记

- **独立暂停锁** `/tmp/lumir-acceptance-installed-pause.lock`：`mkdir` 原子；持有人存活 → 拒绝
  第二次暂停；pid 已死 → 崩溃残留回收；读不到 pid → 拒绝（不贸然接管）。
- **活动 runner 登记** `/tmp/lumir-acceptance-runners/<pid>.json`：每条真跑批启动时写、退出时
  只删自己 pid 的那一份。暂停要求**没有别的活动 runner**（全机独占）；普通跑批启动时若暂停锁
  持有人活着则拒绝（暂停窗口内）。两条普通跑批之间不受影响（自定义 vault 并行照旧）。读不出 pid
  的登记 = 归属不明 → 暂停拒绝。
- **顺序**：先登记自己 → `assertPauseExclusive`（暂停）/ `assertNoActivePause`（普通）→ 跑批锁 →
  暂停段持暂停锁。暂停锁在暂停段结束释放（跑批继续）；登记覆盖整轮。
- **无自动恢复**：本 change 没有任何「恢复安装版」的函数或分支。

### 3.3 失败与不恢复

| 失败点 | 行为 |
|---|---|
| 目标不成立（多实例 / 别的副本 / 身份不可读） | 退出码 2，零副作用 |
| 保存屏障失败 / 超时 / AX 不可读 / 出现新 dirty | 退出码 2，**不 ⌘Q**，安装版仍开着 |
| 身份复核失败 | 退出码 2，不继续 |
| ⌘Q 受阻 / 超时 | 退出码 2，现场保留（不代点「放弃修改」、不补刀） |
| 跑批 FAIL / INVALID / SIGINT / 异常 | 保留原退出码；安装版**不重开、不恢复** |

收尾声明（终端 + `run.log`）：成功时「安装版已按请求保持关闭，需时由用户自行启动（本通道不会
自动重开或恢复）」；未运行时「安装版当时未运行，本次未拉起」；停在中途时「安装版未由本通道关闭
（暂停前已停手），现场保持原样；本通道不会自动重开或恢复」。

### 3.4 证据与信息卫生

`INSTALLED-PAUSE phase=…` 行只写 pid / app path / bundle id / 阶段 / 计数 / 错误。**不写**真实
vault 名、标签标题或正文；AX 读取一律 `mode: "ax"`（不带截图），安装版阶段默认不截图。错误文本
里也不引用 AX 原文（能读到标签标题）。

## 4. 测试与反向验证

- `scripts/acceptance/lib/installed-app.test.mjs`（39 条，挂进 `check-suite.sh`）：发现 / 身份 /
  编排顺序 / 完成信号 / 菜单 / ⌘Q / 锁与登记 / 文案对账。平台副作用全部注入假实现。
- **必红的反向验证**（本轮实测并留证据）：
  1. 去掉「等完成信号」（把等待改成直接返回）→ 编排测试必红；
  2. 完成信号退回全树子串（正文命中）→ 「正文里同句不算」用例必红；
  3. 删掉暂停排他检查 → 「别的活动 runner 必须拒绝」用例必红。
- 产品侧：`tests/unit/vault-switcher.test.ts` / `reading-position.test.ts` 断言 flush 的 boolean
  语义（失败 false、成功 / 无内容 true）；`command-meta.test.ts` 断言 `document.save-all` 的
  标签 / KEYLESS / 无默认绑定。
- 真机场景 880（File → Save All）：两标签脏内容一次落盘 + 正向完成信号 + 磁盘判据。
- **待真机项**（本轮不执行）：真实安装版的发现 → 菜单 → 完成信号 → ⌘Q 整链路；AX 菜单栏可达性；
  两个语言面的完成文案。

## 5. 已知边界

- 安装版必须是含 `document.save-all` 的构建；旧构建会在「等不到菜单项」处退出码 2（不碰文档）。
- 完成信号文案取自本仓文案表（zh / en 两列）；若安装版来自另一个文案版本，匹配会失败（安全侧：
  不 ⌘Q）。菜单项固定 en（原生菜单先例）。
- 菜单可达性依赖 KimiCU 暴露菜单栏节点；读不到即失败，不退回快捷键。
