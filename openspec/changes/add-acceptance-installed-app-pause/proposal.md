# Proposal: 安装版显式暂停通道 + 通用「保存全部」

- Change ID: add-acceptance-installed-app-pause
- 日期: 2026-11-26
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

起跑自检（`assertNoForeignLumir`）会把同机任何 Lumir 实例挡住，而用户手头常驻的
`/Applications/Lumir.app` 正是最常见的一类。此前的口径是「由人先 ⌘Q」（README「被挡住的非在途
实例」），agent 跑批因此卡在人肉节点；而 ad-hoc 的 Apple Event 退出**不经过 ⌘Q 的菜单守卫**，
dirty 时照样退出，正是丢数据的那条路。

要把它做成机器流程，需要的不是「怎么发退出信号」，而是**退出之前怎么证明不会丢东西**：脏标签
写盘只是第一步，标签会话、阅读位置与后端 dirty 镜像各自还有一条写入路径。因此这个 change 同时
引入产品侧的**保存全部**（一条有终态的保存屏障）与验收侧的**显式暂停通道**（发现 → 身份复核 →
保存屏障 → 正常 ⌘Q）。

**Alex 2026-11-26 的决定**（节点 1 回复：「没有其他异议，请你安排」；并明确「退出后就不需要恢复
了，如果我需要用安装版我会自己启动」）：暂停后安装版**保持关闭**，不自动重开、不做 LaunchServices
恢复、不做工作区指纹、不提供 `--recover-installed`、不处理恢复失败；这些原设计范围**整段删除**，
不留死路径 / 兼容层。

## What Changes

- **产品侧：`document.save-all` 命令**（统一命令层，默认不绑键、登记进 `KEYLESS_COMMAND_IDS`）：
  依次执行「保存全部脏标签 → 标签会话真实 flush → 阅读位置真实 flush → 复查无新 dirty →
  后端 dirty 镜像 awaited 同步 → **同步后再次复查 dirty**」，全部成功才写**带操作代次的完成标记**
  （`save-all#<gen> ok`）并给正向终态（D1035），任一步失败给失败终态（D1036）且不清 dirty、
  不冒充成功。旧完成信号 / 并发触发（单飞 busy）MUST NOT 让下一次操作提前放行。
- **产品侧：原生 File → Save All 菜单项**（不带 accelerator；点击经 `MENU_COMMAND_EVENT` 回同一
  命令实现，MUST NOT 另开保存链路）。
- **产品侧：两处 flush 增加真实落盘判据**：`vault_session_put` / `reading_position_put` 返回
  `Ok(true|false)`（磁盘写失败仍记 warning 但如实回 false，普通调用方照旧降级 / 不拦停）；
  `VaultSessionStore.flush()` / `ReadingPositionStore.flush()` 返回 `Promise<boolean>` 并把
  resolved false 原样上抛；既有退出 / 切换调用方仍按 `void` 忽略，语义不变。
- **验收侧：`run.mjs --pause-installed`**（opt-in，默认行为一字不变）：只认唯一、canonical 的
  `/Applications/Lumir.app` + 产品 bundle id + 可读 pid / startedAt；dev / 验收 bundle / 多实例 /
  归属不明一律退出码 2 且零副作用；保存前与 ⌘Q 前各复核一次身份。
- **验收侧：保存屏障与退出通道**：经原生 File → Save All 触发；触发前读取机器标记
  `save-all#<代次> <state>` 的基线，只接受**代次更大且 ok** 的完成标记（旧 toast / 同一代次旧信号 /
  并发 busy 一律不放行）后才发真实 `cmd+q`，等**原 pid** 消失；禁止 Apple Event quit / SIGTERM /
  SIGKILL / pkill；保存或退出受阻即退出码 2、现场保留。
- **验收侧：全机独占**：独立暂停锁 `/tmp/lumir-acceptance-installed-pause.lock` + 活动 runner 登记
  `/tmp/lumir-acceptance-runners/<pid>.json`；第二次暂停、暂停与普通跑批并发都拒绝；自定义 vault
  的普通并行保留。锁 / 登记只释放自己的 session，无自动恢复逻辑。
- **验收侧：承诺不恢复**：跑批成功 / FAIL / INVALID / SIGINT / 异常都不重开安装版，保留原退出码，
  并在结果与 `run.log` 写明「安装版按请求保持关闭，需时由用户自行启动」。
- **验收侧：证据口径**：只记 pid / app path / bundle id / 阶段 / 计数 / 错误；不记真实 vault 名、
  标签标题或正文；安装版阶段默认不截图。
- **验收制品**：新增真机场景 880（File → Save All 的多标签落盘 + 代次标记）与 880b（会话真实写失败 →
  failed、恢复后新代次 ok），更新
  `scripts/acceptance/README.md`（用法、边界、待真机项），新增 `lib/installed-app.mjs` 及 36 条
  单测并挂进 `check-suite.sh`。

## Non-goals

- **不恢复安装版**：无自动重开、无 LaunchServices 恢复、无工作区指纹、无 `--recover-installed`、
  无恢复失败处理；崩溃 / 断电也没有恢复入口。
- **不改默认跑批行为**：没有 `--pause-installed` 时不触达安装版；`--check` / `--list` 不碰机器资源。
- **不改既有 ad-hoc 授权边界**：README「被挡住的非在途实例」的 Apple Event 口径保持原样；本通道是
  opt-in 的机器流程，不是「代退出」的通用授权。
- **不修 `quitBundleApp` 的注释矛盾**（其注释称 AppleEvent quit「与用户 ⌘Q 等价」，与 README
  「Apple Event 不经过退出守卫」冲突）：本 change 不用它退出安装版，矛盾登记为独立 finding，
  不在本批顺手改（它会牵动既有的验收 bundle `quitApp` 场景）。
- **不做真机执行**：本轮 mission 明确不真机；真实安装版整链路登记为待真机项。
- **不扩 `.local` / `.tower` 证据入 git**：证据仍在主仓 `.local/missions/` 下。

## Impact

- 影响的 specs：`multi-tabs`（新增「保存全部」requirement）；`keymap-commands` 不新增 requirement
  ——新命令登记在 `KEYLESS_COMMAND_IDS`，键位分发表的既有条款已覆盖「有实现、有意不占键位」。
- 影响的代码 / 系统：`src/keys.ts`、`src/command-meta.ts`、`src/copy-data.ts`、`文案-Copy.md`、
  `src/main.ts`（保存屏障与命令接线）、`src/vault-switcher.ts`、`src/reading-position.ts`、
  `src-tauri/src/lib.rs`（File → Save All 菜单项）；`scripts/acceptance/{run.mjs,README.md,
  check-suite.sh,COVERAGE.md,scenarios/880-save-all.md,lib/installed-app.mjs,lib/installed-app.test.mjs}`。
- 关联约束：不改写源文件（本 change 只读展示用户文档）；仓库信息卫生（安装版阶段的证据不含真实
  vault / 标签 / 正文）；「变更默认直接切断」（恢复范围整段删除，不留兼容层）。
