# 发布（打包）流程与版本口径

Lumir 正式版本的版本口径与打包、交付步骤。口径来自 Alex 裁决（修复批 = patch、特性批 = minor），步骤来自已实操的完整发布——0.7.0 打包（M512，2026-10-14，证据 `.local/releases/release-0.7.0/`）给出基线与交付惯例，0.9.0 / 0.9.1 两次打包补齐打包入口与打包位置（见下段）；并按 0.7.0 实操与 git 历史（bump 提交 `6579b64`）逐条溯源。**本文只写实际验证过的步骤，不引入未验证流程**；下次实操长出新步骤时再加进来。

2026-10-19 起打包入口改为 `scripts/pack-release.sh`（版本闸；闸的两个方向已实测）。闸之外仍是 0.7.0 验证过的 `pnpm tauri build` 原路径；包装层本身已由 0.9.0（主仓 checkout）与 0.9.1（worktree）两次打包实测，均 `PACK RESULT: PASS`（证据 `.local/releases/release-0.9.0/`、`release-0.9.1/`）。

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

先定打包位置：默认主仓 checkout；本批改动（含 bump）还在 mission 分支上没合并时走 worktree（路径 B）。两条都合法，命令与产物验证完全相同。

**路径 A：本批改动已全部合并进 master → 主仓 checkout 打包（常规）**

- 主仓 checkout 在 master、tracked 干净，`src-tauri/tauri.conf.json` 的 `version` 已是目标版本。
- 主仓 checkout 全仓共享：带别的 mission 的未提交 tracked 改动即说明它正被使用——别在里面打包；本批改动还在 mission 分支上就走路径 B，否则等它收尾。

**路径 B：本批改动还在 mission 分支上 → 在 worktree 打包（bump 与打包同一 mission 是主要形态）**

- 条件：分支相对当前 master 的差异面就是本批的交付内容（bump+打包同 mission = 一条 bump 提交；带功能改动 = 已过评审、待合并的那批提交），且 worktree tracked 干净（没有不会进 master 的未提交改动）。bump+打包同 mission 的形态可机检：`git log --oneline master..HEAD` 只有一条 bump 提交，`git diff --stat master..HEAD` 只列版本号四文件、每文件 1 删 1 增（读数 `2 +-`）；master 在分支点之后前进过会破坏这个读数，先 `git rebase master` 再核。满足时 worktree 的 tracked 代码 = 合并后的 master，产物与主仓打包等价。
- 先例：0.9.1（M618）在 worktree `wt-618` 内跑 `gate quick` 与 `pack-release.sh`（`PACK RESULT: PASS`，证据 `.local/releases/release-0.9.1/`）；0.8.0（M596）的依赖对齐分支更早也是 rebase 到 master 后在 worktree 内构建，该 tip 随后原样合并。
- 注意点：
  - worktree 不带 `.gitignore` 忽略的 `node_modules` 与 `src-tauri/target`：先装依赖（或从主仓复制 `node_modules`）；构建目录可 `CARGO_TARGET_DIR=<主仓>/src-tauri/target` 复用增量（0.9.1 因本机磁盘余量如此），代价是共享 target——按 `docs/backlog.md`「工具链与环境」第 9 条核对本轮确实重编译了 lumir 测试二进制，并独占 cargo 构建位。
  - 版本闸照常生效：它经 `git rev-parse --git-common-dir` 查主仓 `.local`，worktree 缺 `.local` 不会假放行（`scripts/pack-release.sh` 头注释）。
  - 产物与证据仍落主仓 checkout：dmg 复制进主仓 `.local/releases/release-<version>/`，`index.md` 记明「worktree 打包 + 相对 master 的差异面」与源 commit——worktree 合并即清，留在里面的路径会失效；报给 Alex 的 `open` 路径也必须是主仓绝对路径（AGENTS.md「给 Alex 的路径必须当下可开」）。
  - 打包后 `git status --short` 应为空。`tauri build` 会按当前依赖重写 `src-tauri/gen/schemas/*.json`——改过依赖的批次（M596 现场）这里会多出三份改动，按 gate 的 schemas-drift 口径处置（依赖面变化才提交，否则 `git checkout --` 还原），不要混进 bump 提交。

以下前置两条路径都适用：

- 版本号已按上节 bump 并提交。**bump 由机器闸强制**：`scripts/pack-release.sh` 构建前读 `src-tauri/tauri.conf.json` 的 `version`，已有同名证据目录 `.local/releases/release-<version>/` 即拒绝打包并提示先 bump。闸只管「同一版本号不重复交付」；本批该 MINOR 还是 PATCH 仍由 tower 按上节批次性质口径裁决。动机：0.8.0 打包漏 bump（M596，2026-10-19），交付的 dmg 实际含本批新能力却仍标 0.8.0。
- `bash scripts/gate.sh quick` 全绿，在**打包所在的那个 checkout** 里跑（路径 B 就在 worktree 里跑——门禁要判的正是被装进 dmg 的那棵树）。报告时**照抄 `GATE RESULT` 原文行并附退出码**，不用「X/Y PASS」复述（REVIEW.md「门禁报告口径」条：分母口径含不含 SKIP 只在脚本里定义）。
- 动过视觉相关代码（`src/style.css`、`src/preview/**`、`tests/visual/scenes/**`）的批次，另跑 `bash scripts/gate.sh visual`（AGENTS.md「视觉门禁分层」）。
- cargo 构建位空闲（并行批次纪律见 AGENTS.md；0.7.0 打包前确认无并发 `cargo` / `rustc`）。

## 打包命令与产物

在选定的 checkout 根目录执行（路径 A = 主仓 checkout，路径 B = mission worktree）：

```
bash scripts/pack-release.sh
```

- 脚本先跑版本闸，通过后原样执行 `pnpm tauri build`（其余参数透传）。闸拒绝时输出 `PACK FAIL version-gate …` 并以 1 退出——按上文 bump 后再跑。只想查闸、不构建：`bash scripts/pack-release.sh --check-only`（通过时 `PACK RESULT: PASS`，拒绝时 `PACK RESULT: FAIL`）。
- 产物由 `src-tauri/tauri.conf.json` 的 `bundle.targets = ["app", "dmg"]` 决定；`beforeBuildCommand` 会先跑 `pnpm build`（`tsc --noEmit && vite build`）。release 剖面带 `--features tauri/custom-protocol`，前端被打进二进制。
- 产物路径（0.7.0 实测；相对构建用的 target 目录——路径 B 指了 `CARGO_TARGET_DIR` 时落在主仓那个 `target` 下）：
  - `src-tauri/target/release/bundle/dmg/Lumir_<version>_aarch64.dmg`——安装包（Apple Silicon；后缀随构建机架构）。
  - `src-tauri/target/release/bundle/macos/Lumir.app`——应用包。
- 时长参考：0.7.0 全流程 wall 83s（release 剖面编译约 59s，增量构建）；0.9.1 为 107s（共享主仓 target 的增量构建）。

### 已知坑：dmg bundling 偶发失败

`bundle_dmg.sh` 偶发失败：`hdiutil: create failed - Operation not permitted`（0.7.0 的 10-13 首次打包实证，日志 `.local/releases/release-0.7.0/dmg-retry.log`）。处理：**重试 dmg bundle，不必怀疑代码**——

```
bash scripts/pack-release.sh --bundles dmg
```

（10-14 那次首跑即成功。重试时闸会重跑一遍；证据目录在交付步骤才创建，重试阶段通常还不存在，闸照常放行。）tauri 另会对 `identifier` 以 `.app` 结尾（`com.lumir.app`）打一条 warning，当前无害。

## 产物验证

对 `Lumir_<version>_aarch64.dmg`：

- `hdiutil verify <dmg>` → `checksum ... is VALID`。
- 挂载后核对 payload = `Lumir.app` + `Applications` 符号链接，核对完 `hdiutil detach`。
- `Info.plist` 的 `CFBundleShortVersionString` 与 `CFBundleVersion` = 目标版本；.app 与 DMG 内 payload 各验一次。
- `file <二进制>` → `Mach-O 64-bit executable arm64`，与文件名 `_aarch64` 一致。
- 版本三处一致：`src-tauri/tauri.conf.json`、`package.json`、`src-tauri/Cargo.toml`。

## 交付惯例

- 证据目录 = **主仓 checkout** 的 `.local/releases/release-<version>/`（git 外；`.local/` 被 gitignore；worktree 里没有 `.local`，也不该在那里建）。把 dmg 复制一份进该目录，同目录留本次打包的脚本与门禁 / 构建日志（0.7.0 样板：`build.sh`、`gate-quick.log`、`gate-visual.log`、`tauri-build.log`、`dmg-retry.log`）；路径 B 另按「打包前置」在 `index.md` 记明 worktree 打包与相对 master 的差异面。
- 目录内另有 `smoke.mjs`（发布版启动冒烟脚本，启动 `.app` 里的二进制、用 KimiCU 读 AX 树判定「真渲染 + 版本号上屏 + 非白屏」）。**0.7.0 批次未执行它**——按纪律不启动安装版，以免写入用户真实 `~/.config/lumir`。
- **sha256 记录惯例**：对交付的 dmg 计算并记录，供 Alex 校验与归档（0.7.0 读数 `8ac0eebe…2976` 已记入交付报告与 HANDOFF）：

  ```
  cd <主仓 checkout> && shasum -a 256 .local/releases/release-<version>/Lumir_<version>_aarch64.dmg
  ```

- **给 Alex 的路径必须当下可开**（AGENTS.md 硬规则）：报 dmg 的**绝对路径** + 一条可整段运行的 `open` 命令（0.7.0 的交付即此形态）：

  ```
  open <主仓绝对路径>/.local/releases/release-<version>/Lumir_<version>_aarch64.dmg
  ```

## 评审节点（Alex）

- Alex 的介入点在**交付**这一步：装上使用（0.7.0 口令为「跑完前两件后打个包，我装上使用」）。
- 打包本身是机器判定（gate 全绿 + 产物验证读数），不设文档评审节点。
- 「是否打包 / 打哪一版」由 Alex 拍板（开工口令触发）；0.7.0 的下一版（0.7.1 patch）即按此等 Alex 口令。
