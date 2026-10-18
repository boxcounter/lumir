# 发布（打包）流程与版本口径

Lumir 正式版本的版本口径与打包、交付步骤。口径来自 Alex 裁决（修复批 = patch、特性批 = minor），步骤全部来自一次已实操的完整发布——0.7.0 打包（M512，2026-10-14，证据 `.local/releases/release-0.7.0/`），并按该次实操与 git 历史（bump 提交 `6579b64`）逐条溯源。**本文只写 0.7.0 验证过的步骤，不引入未验证流程**；下次实操长出新步骤时再加进来。

## 版本口径

semver。0.x 期间按批次性质 bump：

- **特性批（含新能力）= MINOR**：0.3.0、0.4.0、0.5.0、0.6.0、0.7.0。
- **修复批（仅缺陷 / 套件修复）= PATCH**：0.5.1、0.6.1。
- major 在 0.x 期间不使用。

版本号在多处同步，逐处跟改（0.7.0 bump 提交 `6579b64` 的改动面即下列四文件）：

| 位置 | 字段 |
|---|---|
| `src-tauri/tauri.conf.json` | `version`（唯一真源：上屏版本与应用元信息的来源） |
| `package.json` | `version` |
| `src-tauri/Cargo.toml` | `[package] version` |
| `src-tauri/Cargo.lock` | `[[package]] name = "lumir"` 的 `version`（改 `Cargo.toml` 后跑一次 cargo 命令自动跟随，不手改） |

视觉桩**不跟随**版本号：`tests/visual/scenes/tauri-stub.ts` 缺省 `appMeta` 与 `tests/visual/scenes/titlebar-identity.spec.ts` 的 `VERSION` 刻意钉死 `9.9.9`（2026-10-02 Alex 裁决，提交 `9f19088`：跟随会让每次 bump 都推动标题栏像素基线、多一次人肉过目）。真机上屏的真实版本由真机验收场景 39 以 `$appVersion` 占位符逐字节比对负责。

bump 提交信息惯例：`chore(release): X.Y.Z——<本批内容>，<MINOR bump / 按 patch 口径>`（见 `6579b64` / `b4e44a4` / `ff508e6`）。

## 打包前置

- 版本号已按上节 bump 并提交（0.7.0 打包前版本号已就绪，M512 不再 bump）。
- 在 master、tracked 干净；打包用主仓 checkout，不用 worktree。
- `bash scripts/gate.sh quick` 全绿。报告时**照抄 `GATE RESULT` 原文行并附退出码**，不用「X/Y PASS」复述（REVIEW.md 「门禁报告口径」条：分母口径含不含 SKIP 只在脚本里定义）。
- 动过视觉相关代码（`src/style.css`、`src/preview/**`、`tests/visual/scenes/**`）的批次，另跑 `bash scripts/gate.sh visual`（AGENTS.md「视觉门禁分层」）。
- cargo 构建位空闲（并行批次纪律见 AGENTS.md；0.7.0 打包前确认无并发 `cargo` / `rustc`）。

## 打包命令与产物

主仓 checkout 执行：

```
pnpm tauri build
```

- 产物由 `src-tauri/tauri.conf.json` 的 `bundle.targets = ["app", "dmg"]` 决定；`beforeBuildCommand` 会先跑 `pnpm build`（`tsc --noEmit && vite build`）。release 剖面带 `--features tauri/custom-protocol`，前端被打进二进制。
- 产物路径（0.7.0 实测）：
  - `src-tauri/target/release/bundle/dmg/Lumir_<version>_aarch64.dmg`——安装包（Apple Silicon；后缀随构建机架构）。
  - `src-tauri/target/release/bundle/macos/Lumir.app`——应用包。
- 时长参考：0.7.0 全流程 wall 83s（release 剖面编译约 59s，增量构建）。

### 已知坑：dmg bundling 偶发失败

`bundle_dmg.sh` 偶发失败：`hdiutil: create failed - Operation not permitted`（0.7.0 的 10-13 首次打包实证，日志 `.local/releases/release-0.7.0/dmg-retry.log`）。处理：**重试 dmg bundle，不必怀疑代码**——

```
pnpm tauri build --bundles dmg
```

（10-14 那次首跑即成功。）tauri 另会对 `identifier` 以 `.app` 结尾（`com.lumir.app`）打一条 warning，当前无害。

## 产物验证

对 `Lumir_<version>_aarch64.dmg`：

- `hdiutil verify <dmg>` → `checksum ... is VALID`。
- 挂载后核对 payload = `Lumir.app` + `Applications` 符号链接，核对完 `hdiutil detach`。
- `Info.plist` 的 `CFBundleShortVersionString` 与 `CFBundleVersion` = 目标版本；.app 与 DMG 内 payload 各验一次。
- `file <二进制>` → `Mach-O 64-bit executable arm64`，与文件名 `_aarch64` 一致。
- 版本三处一致：`src-tauri/tauri.conf.json`、`package.json`、`src-tauri/Cargo.toml`。

## 交付惯例

- 证据目录 `.local/releases/release-<version>/`（git 外；`.local/` 被 gitignore）。把 dmg 复制一份进该目录，同目录留本次打包的脚本与门禁 / 构建日志（0.7.0 样板：`build.sh`、`gate-quick.log`、`gate-visual.log`、`tauri-build.log`、`dmg-retry.log`）。
- 目录内另有 `smoke.mjs`（发布版启动冒烟脚本，启动 `.app` 里的二进制、用 KimiCU 读 AX 树判定「真渲染 + 版本号上屏 + 非白屏」）。**0.7.0 批次未执行它**——按纪律不启动安装版，以免写入用户真实 `~/.config/lumir`。
- **sha256 记录惯例**：对交付的 dmg 计算并记录，供 Alex 校验与归档（0.7.0 读数 `8ac0eebe…2976` 已记入交付报告与 HANDOFF）：

  ```
  shasum -a 256 .local/releases/release-<version>/Lumir_<version>_aarch64.dmg
  ```

- **给 Alex 的路径必须当下可开**（AGENTS.md 硬规则）：报 dmg 的**绝对路径** + 一条可整段运行的 `open` 命令（0.7.0 的交付即此形态）：

  ```
  open <主仓绝对路径>/.local/releases/release-<version>/Lumir_<version>_aarch64.dmg
  ```

## 评审节点（Alex）

- Alex 的介入点在**交付**这一步：装上使用（0.7.0 口令为「跑完前两件后打个包，我装上使用」）。
- 打包本身是机器判定（gate 全绿 + 产物验证读数），不设文档评审节点。
- 「是否打包 / 打哪一版」由 Alex 拍板（开工口令触发）；0.7.0 的下一版（0.7.1 patch）即按此等 Alex 口令。
