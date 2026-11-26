# Tasks: add-acceptance-installed-app-pause

## 1. 产品侧：保存全部（命令 / 菜单 / 屏障）

- [x] 1.1 `src/keys.ts`：`document.save-all` 进 `COMMAND_IDS` 并登记 `KEYLESS_COMMAND_IDS`（默认不绑键）；`src/command-meta.ts` 挂 D1034 标签与 `save all` 别名。
- [x] 1.2 `文案-Copy.md` / `src/copy-data.ts`：D1034 命令标签、D1035 完成终态、D1036 失败终态（中英两列）；deck 末位与分配记录更新。
- [x] 1.3 `src/vault-switcher.ts` / `src/reading-position.ts`：`flush()` 改返回 `Promise<boolean>`（写失败 false、warning 保留）；既有退出 / 切换调用方保持 `void` 语义。
- [x] 1.4 `src/main.ts`：`saveAllBarrier`（saveAllDirty → 会话 flush → 阅读位置 flush → 复查新 dirty → awaited dirty 镜像同步 → 正向终态）；`document.save-all` 命令与 `MENU_COMMANDS.saveAll` 接到同一实现。
- [x] 1.5 `src-tauri/src/lib.rs`：File → Save All 原生菜单项（无 accelerator，点击经 `MENU_COMMAND_EVENT`），`menu_command_of` 映射 `saveAll`；结构假设不成立时保留默认菜单并告警。

## 2. 验收侧：显式暂停通道

- [x] 2.1 新增 `scripts/acceptance/lib/installed-app.mjs`：目标发现 / 身份复核 / 按 pid 激活 / File → Save All 菜单触发 / 正向完成信号 / 正常 ⌘Q / 暂停锁 / 活动 runner 登记 / 编排与收尾声明；平台副作用全部注入。
- [x] 2.2 `scripts/acceptance/run.mjs`：`--pause-installed` 开关；真跑批登记活动 runner；暂停段在 `preflight()` **之前**执行且持独立暂停锁；普通跑批遇暂停拒绝；成功 / FAIL / INVALID / SIGINT / 异常都写「安装版按请求保持关闭，需时由用户自行启动」且不重开。
- [x] 2.3 不做恢复面：无自动重开、无 LaunchServices 恢复、无工作区指纹、无 `--recover-installed`、无恢复失败处理（Alex 2026-11-26 决定）。

## 3. 测试

- [x] 3.1 `scripts/acceptance/lib/installed-app.test.mjs`：目标发现、保存前 ⌘Q = 0、保存失败不跑、只正常 ⌘Q、安装版未运行、成功 / 失败 / 中断均不 open、第二次调用零副作用、锁归属、退出码语义、反向口径（缺完成信号 / AX 空树 / 正文同句不算 / 锁检查）。
- [x] 3.2 挂进 `scripts/acceptance/check-suite.sh`（docs-check 与 gate 共用）。
- [x] 3.3 产品侧单测：`tests/unit/vault-switcher.test.ts` / `reading-position.test.ts` 断言 flush 的 boolean；`tests/unit/command-meta.test.ts` 断言新命令的标签 / KEYLESS / 无默认绑定。
- [x] 3.4 反向验证（本轮实测留证）：去掉完成信号等待、完成信号退回全树子串、删除暂停排他检查——三种变异各自让对应用例变红，随后还原。

## 4. 验收制品与文档

- [x] 4.1 新增真机场景 `scripts/acceptance/scenarios/880-save-all.md`（File → Save All：两标签落盘 + 正向完成信号 + 磁盘判据），`coverage.mjs` 重生成 COVERAGE。
- [x] 4.2 `scripts/acceptance/README.md`：`--pause-installed` 用法、目标 / 身份 / 屏障 / ⌘Q / 锁与登记 / 证据 / 不恢复口径 / 已知边界（含待真机项）。
- [x] 4.3 登记 `quitBundleApp` 注释矛盾为独立 finding（不在本批修）：`.tower/comms/findings/20261126-worker-installed-pause-quitbundleapp-comment-appleevent-quit.md`（git 外）。

## 5. 验证

- [x] 5.1 `pnpm exec tsc --noEmit`（根）与 `tests/visual` 的 tsc 通过。
- [x] 5.2 `node tests/unit/run.mjs` 通过。
- [x] 5.3 `cargo test --manifest-path src-tauri/Cargo.toml`（目标 Rust 测试）通过。
- [x] 5.4 `bash scripts/docs-check.sh` 通过（含 acceptance 契约 / 自测与 backlog 门禁）。
- [x] 5.5 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 5.6 `node scripts/acceptance/run.mjs --check` 通过。

## 6. 待真机 / 待终审（本轮不执行，未勾即未完）

- [ ] 6.1 真实 `/Applications/Lumir.app` 的整链路真机验收：发现 → 身份复核 → 菜单 → 完成信号 →
      ⌘Q → 原 pid 消失；以及「保存屏障失败时不 ⌘Q」「退出受阻时现场保留」两个负向现场。理由：
      本轮 mission 明确不执行真机，归下批真机窗口。
- [ ] 6.2 场景 880 的真机 PASS（需要先构建含本 change 的 app）。理由同上。
- [ ] 6.3 独立终审（非作者 reviewer clean / merge）与归档放行；归档时在 `docs/backlog.md`
      归档跟踪队列落条目（当前 80/80 行已触顶，须同批腾出一行）。理由：本 mission 明确
      「不要归档，等独立终审」。
