# Tasks: add-acceptance-installed-app-pause

## 1. 产品侧：保存全部（命令 / 菜单 / 屏障）

- [x] 1.1 `src/keys.ts`：`document.save-all` 进 `COMMAND_IDS` 并登记 `KEYLESS_COMMAND_IDS`（默认不绑键）；`src/command-meta.ts` 挂 D1048 标签与 `save all` 别名。
- [x] 1.2 `文案-Copy.md` / `src/copy-data.ts`：D1048 命令标签、D1049 完成终态、D1050 失败终态、D1051 并发提示（中英两列）；deck 末位与分配记录更新。
- [x] 1.3 `src-tauri/src/vault_session.rs` / `reading_position.rs`：两条 put 命令返回 `Ok(true|false)`（磁盘写失败仍记 warning 但如实回 false）；`src/vault-switcher.ts` / `src/reading-position.ts` 的 `flush()` 改返回 `Promise<boolean>`，把后端的 resolved false 原样上抛；既有退出 / 切换调用方保持 `void` 语义。
- [x] 1.4 新增 `src/save-all.ts`：保存全部屏障 + **追加式状态日志**（`save-all-log s<seq>:g<代次>:<状态>`）+ 单飞；步骤含 saveAllDirty → 会话 flush → 阅读位置 flush → 前置 dirty 复查 → awaited 镜像同步 → **同步后再复查 dirty**（有新 dirty 先恢复镜像 true 再失败）→ 成功标记。`src/main.ts` 只装配真实依赖、隐藏标记元素与 toast，`document.save-all` / `MENU_COMMANDS.saveAll` 接到同一实现。
- [x] 1.5 `src-tauri/src/lib.rs`：File → Save All 原生菜单项（无 accelerator，点击经 `MENU_COMMAND_EVENT`），`menu_command_of` 映射 `saveAll`；结构假设不成立时保留默认菜单并告警。

## 2. 验收侧：显式暂停通道

- [x] 2.1 新增 `scripts/acceptance/lib/installed-app.mjs`：目标发现 / 身份复核 / 按 pid 激活（默认 exec 读 stdout 与退出码）/ File → Save All 菜单触发 / **读状态日志基线并把完成信号归属到本次操作**（锁定第一条新 running 的代次，只接受同代次 ok）/ 正常 ⌘Q / 暂停锁 / 活动 runner 登记 / 编排与收尾声明；平台副作用全部注入（默认 exec 用真实可执行探针覆盖）。
- [x] 2.2 `scripts/acceptance/run.mjs`：`--pause-installed` 开关；真跑批登记活动 runner；暂停段在 `preflight()` **之前**执行且持独立暂停锁；普通跑批遇暂停拒绝；成功 / FAIL / INVALID / SIGINT / 异常都写「安装版按请求保持关闭，需时由用户自行启动」且不重开。
- [x] 2.3 不做恢复面：无自动重开、无 LaunchServices 恢复、无工作区指纹、无 `--recover-installed`、无恢复失败处理（Alex 2026-11-26 决定）。

## 3. 测试

- [x] 3.1 `scripts/acceptance/lib/installed-app.test.mjs`（48 条）：目标发现、保存前 ⌘Q = 0、保存失败不跑、只正常 ⌘Q、安装版未运行、成功 / 失败 / 中断均不 open、第二次调用零副作用、锁归属、退出码语义、**日志归属（基线 g3 → g5 ok / busy 被别代 ok 覆盖 / 跨代 ok / 旧 ok / 快速完成）+ 跨层格式对账**、默认 exec 的真实可执行探针。
- [x] 3.2 挂进 `scripts/acceptance/check-suite.sh`（docs-check 与 gate 共用）。
- [x] 3.3 产品侧单测：新增 `tests/unit/save-all.test.ts`（11 条：三种失败、前置 / 同步期间新 dirty、并发单飞、代次单调、日志容量）；`vault-switcher.test.ts` / `reading-position.test.ts` 断言 resolved-false 与 reject 两档；`command-meta.test.ts` 断言新命令的标签 / KEYLESS / 无默认绑定；Rust 侧两条 `put_reports_false_when_disk_write_fails`。
- [x] 3.4 反向验证（本轮实测留证，原卷在 `.local/missions/add-acceptance-installed-app-pause/mutations/`）：① 去掉本次操作等待；② 接受任意 ok（不看 running 归属）；③ 删除暂停排他检查；④ 删除屏障最后 dirty 复查（旧 P1-4）；⑤ Rust put 在磁盘失败时回 true（旧 P1-1）；⑥ 退回「代次大于基线即 ok」旧规则（K3 第二轮原 bug）；⑦ 删除 busy 拒绝；⑧ 删除日志容量上限（cap 不再滚动）；⑨ 把 cap 改成错误值。每项均变红并还原复绿。

## 4. 验收制品与文档

- [x] 4.1 新增真机场景 `scripts/acceptance/scenarios/880-save-all.md`（File → Save All：两标签落盘 + 完整状态日志 `s1:g1:running → s2:g1:ok` 的节点级精确判据 + 磁盘判据）与 `880b-save-all-session-flush-failure.md`（envChmod 造会话写失败 → `s2:g1:failed`、恢复后 `s3:g2:running → s4:g2:ok`），`coverage.mjs` 重生成 COVERAGE。
- [x] 4.2 `scripts/acceptance/README.md`：`--pause-installed` 用法、目标 / 身份 / 屏障 / ⌘Q / 锁与登记 / 证据 / 不恢复口径 / 已知边界（含待真机项）。
- [x] 4.3 登记 `quitBundleApp` 注释矛盾为独立 finding（不在本批修）：`.tower/comms/findings/20261126-worker-installed-pause-quitbundleapp-comment-appleevent-quit.md`（git 外）。

## 5. 验证

- [x] 5.1 `pnpm exec tsc --noEmit`（根）与 `tests/visual` 的 tsc 通过。
- [x] 5.2 `node tests/unit/run.mjs` 通过。
- [x] 5.3 `cargo test --manifest-path src-tauri/Cargo.toml`（目标 Rust 测试）通过。
- [x] 5.4 `bash scripts/docs-check.sh` 通过（含 acceptance 契约 / 自测与 backlog 门禁）。
- [x] 5.5 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 5.6 `node scripts/acceptance/run.mjs --check` 通过。

## 7. K3 返修（2026-11-26，逐项关闭）

- [x] 7.1 P1-1：Rust put 命令返回真实落盘结果；store flush 把 resolved false 上抛；Rust + 前端失败链测试。
- [x] 7.2 P1-2：验收默认 exec 读 stdout / 退出码；真实可执行探针（`/usr/bin/printf` + 临时 shell 桩）覆盖默认通道。
- [x] 7.3 P1-3：产品 `save-all-log s<seq>:g<代次>:<状态>` 追加式日志 + 单飞；验收触发后锁定第一条新 running 的准确代次、只接受同代次 ok；基线 g3→g5 ok、busy 被别代 ok 覆盖、旧 ok 反向测试。
- [x] 7.4 P1-4：镜像同步 await 后复查 dirty；有新 dirty 先恢复镜像 true 再失败；deferred 竞态测试（旧实现必红）。
- [x] 7.5 P2-1：场景 880 改节点级代次判据；新增 880b 会话真实写失败；屏障失败 / 竞态由 `save-all.test.ts` 覆盖。
- [x] 7.6 P2-2：既有七项变异 + 本轮新增 cap 删除 / cap 值改错，共九项的具体 diff、失败输出、还原复绿原卷；design / evidence 清单一致。

## 6. 待真机 / 待终审（本轮不执行，未勾即未完）

- [ ] 6.1 真实 `/Applications/Lumir.app` 的整链路真机验收：发现 → 身份复核 → 菜单 → 完成信号 →
      ⌘Q → 原 pid 消失；以及「保存屏障失败时不 ⌘Q」「退出受阻时现场保留」两个负向现场。
      **放弃 / 转后续（2026-11-27 归档处置）**：本批真机只覆盖 880 / 880b 的 Save All 链路；
      暂停通道保持「未触碰真实安装版」的边界，整链路留待后续真机窗口，不在本 change 归档前补跑。
- [x] 6.2 场景 880 / 880b 的真机 PASS：880 **PASS 17 断言**、880b **PASS 9 断言**，证据
      `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-27-ux-goal-r4/`（见 summary.md 两行）。
- [x] 6.3 独立终审（非作者 reviewer clean / merge）与归档放行：K3 对 `08cec340` 判 clean / merge
      （`.local/reviews/add-acceptance-installed-app-pause/k3-verdict.md`）；归档队列条目已落
      `docs/backlog.md`（同批删除一条已归档历史腾行，保持 80 行）。
