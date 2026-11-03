# 发布（打包）流程与版本口径

Lumir 正式版本的版本口径与打包、交付步骤。口径来自 Alex 裁决（修复批 = patch、特性批 = minor），步骤来自已实操的完整发布——0.7.0 打包（M512，2026-10-14，证据 `.local/releases/release-0.7.0/`）给出基线与交付惯例，0.9.0 / 0.9.1 两次打包补齐打包入口与打包位置（见下段），0.12.0（2026-11-03，证据 `.local/releases/release-0.12.0/`）按旧流程完成、不追溯；并按 0.7.0 实操与 git 历史（bump 提交 `6579b64`）逐条溯源。**本文只写实际验证过的步骤，不引入未验证流程**；下次实操长出新步骤时再加进来。

2026-10-19 起打包入口改为 `scripts/pack-release.sh`（版本闸；闸的两个方向已实测）。闸之外仍是 0.7.0 验证过的 `pnpm tauri build` 原路径；包装层本身已由 0.9.0（主仓 checkout）与 0.9.1（worktree）两次打包实测，均 `PACK RESULT: PASS`（证据 `.local/releases/release-0.9.0/`、`release-0.9.1/`）。

## 简单打包（2026-11-03 起）

**裁决**（Alex，2026-11-03）：从现在起，正式版本的打包只做简单打包——打包只验证「已经验收过的代码」成为「正确、可安装的产物」；视觉回归归功能验收，不在打包环节做。0.12.0 已按旧流程完成，不追溯；此后所有正式版本的打包按本节执行。

**两条职责边界**：

- **功能验收**（打包之前，在功能批里完成）：`bash scripts/gate.sh quick` 全绿；动过视觉相关代码（`src/style.css`、`src/preview/**`、`tests/visual/scenes/**`）的批次按 AGENTS.md「视觉门禁分层」跑 `bash scripts/gate.sh visual`；真机行为项按验收套件（`node scripts/acceptance/run.mjs`）与批次性质执行。这些判据回答「功能对不对 / 有没有回归」，证据留在功能批自己的目录与 CI 记录里。
- **产物校验**（打包环节）：只回答「这份 dmg 是不是由那个已验收 commit 构建的、能不能装、版本与签名对不对」。判据固定为——版本闸（`scripts/pack-release.sh`）、构建成功、签名闸、DMG 完整性（`hdiutil verify`、payload 结构、版本字段、架构）、sha256 记录；步骤见「打包命令与产物」「产物验证」「交付惯例」。

`scripts/pack-release.sh` 的职责面正是后者：版本闸 → `pnpm tauri build` → 签名闸，功能验收从来不在它的职责内。旧文档把 `gate quick` / `gate visual` 写成打包前置，是把两份职责叠在了打包树上，2026-11-03 起从打包前置中删除（门禁本身不变，仍在功能批里跑）。

**打包树不再重复 quick / visual**：不在打包所在的 checkout 重跑 `bash scripts/gate.sh quick` / `bash scripts/gate.sh visual`，也不把门禁日志作为打包交付物。理由：打包树就是功能验收通过的那份代码，重复执行不增加判定力，只增加等待与证据冗余。

**适用前提（不得绕过功能验收）**：

- 被装进 dmg 的代码已经过功能验收（上条），证据可指认——拿不出已绿的 `GATE RESULT` 行或验收场景 PASS 记录，不得打包。
- 被装进 dmg 的 commit 的 CI 已全绿：已合并进 master 的看 master push 的 CI，仍在分支上的看该分支 PR 的 CI。CI 红或未跑完，不得打包。
- 简单打包只减少打包环节的重复执行，不降低上述任何一条；它不构成「先打包、后验收」的通道。

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

- 条件：分支相对当前 master 的差异面就是本批的交付内容（bump+打包同 mission = 一条 bump 提交；带功能改动 = 已过评审、待合并的那批提交），且 worktree tracked 干净（没有不会进 master 的未提交改动）。
- bump+打包同 mission 的形态可机检：`git log --oneline master..HEAD` 只有一条 bump 提交，`git diff --stat master..HEAD` 只列版本号四文件、每文件 1 删 1 增（读数 `2 +-`）；master 在分支点之后前进过会破坏这个读数，先 `git rebase master` 再核。满足时 worktree 的 tracked 代码 = 合并后的 master，产物与主仓打包等价。
- 先例：0.9.1（M618）在 worktree `wt-618` 内完成 `pack-release.sh` 打包（`PACK RESULT: PASS`，证据 `.local/releases/release-0.9.1/`；该次按旧流程还在打包树跑了 `gate quick`，2026-11-03 起不再重复）；0.8.0（M596）的依赖对齐分支更早也是 rebase 到 master 后在 worktree 内构建，该 tip 随后原样合并。
- 注意点：
  - worktree 不带 `.gitignore` 忽略的 `node_modules` 与 `src-tauri/target`：先装依赖（或从主仓复制 `node_modules`）；构建目录可 `CARGO_TARGET_DIR=<主仓>/src-tauri/target` 复用增量（0.9.1 因本机磁盘余量如此），代价是共享 target——按 `scripts/acceptance/README.md`「起实例前的环境纪律」的 target 纪律核对本轮确实重编译了 lumir 测试二进制，并独占 cargo 构建位。
  - 版本闸照常生效：它经 `git rev-parse --git-common-dir` 查主仓 `.local`，worktree 缺 `.local` 不会假放行（`scripts/pack-release.sh` 头注释）。
  - 产物与证据仍落主仓 checkout：dmg 复制进主仓 `.local/releases/release-<version>/`，`index.md` 记明「worktree 打包 + 相对 master 的差异面」与源 commit——worktree 合并即清，留在里面的路径会失效；报给 Alex 的 `open` 路径也必须是主仓绝对路径（AGENTS.md「给 Alex 的路径必须当下可开」）。
  - 打包后 `git status --short` 应为空。`tauri build` 会按当前依赖重写 `src-tauri/gen/schemas/*.json`——改过依赖的批次（M596 现场）这里会多出三份改动，按 gate 的 schemas-drift 口径处置（依赖面变化才提交，否则 `git checkout --` 还原），不要混进 bump 提交。

以下前置两条路径都适用：

- 版本号已按上节 bump 并提交。**bump 由机器闸强制**：`scripts/pack-release.sh` 构建前读 `src-tauri/tauri.conf.json` 的 `version`，已有同名证据目录 `.local/releases/release-<version>/` 即拒绝打包并提示先 bump。闸只管「同一版本号不重复交付」；本批该 MINOR 还是 PATCH 仍由 tower 按上节批次性质口径裁决。动机：0.8.0 打包漏 bump（M596，2026-10-19），交付的 dmg 实际含本批新能力却仍标 0.8.0。
- 「简单打包」节的适用前提成立：功能验收已全绿、被交付 commit 的 CI 已全绿。打包树不重跑 `gate quick` / `gate visual`，门禁日志也不进打包交付证据。
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

以下判据只回答产物的正确性（由指定已验收 commit 构建、可安装、版本与签名一致），不回答功能是否正确——后者归功能验收，见「简单打包」节。

### 签名（M637，发布门禁强制）

`src-tauri/tauri.conf.json` 的 `bundle.macOS.signingIdentity: "-"`（Tauri v2 官方的 ad-hoc 伪身份写法，[Tauri macOS 代码签名文档](https://v2.tauri.app/distribute/sign/macos/)）让 bundler 在 app→dmg 之间做一次 **bundle 级签名**。`scripts/pack-release.sh` 构建成功后跑签名闸，任一条不成立即 `PACK FAIL signature`，退出码 1，不产出可交付结论：

- `codesign --verify --deep --strict <app>` 通过。
- `codesign -dv --verbose=4 <app>` 的 `Identifier` == 产物 `Info.plist` 的 `CFBundleIdentifier`（== `tauri.conf.json` 的 `identifier`，当前 `com.lumir.app`）。linker 塞进去的签名打的是 `Identifier=lumir-<hash>`，这条判红。
- `Info.plist entries=N` 在场（linker 签名是 `Info.plist=not bound`）。
- `Sealed Resources version=N` 在场（linker 签名是 `Sealed Resources=none`）。

为什么是机器闸而不是人工核对：未签名的 app 打包命令照样退出 0——0.9.2 就是这样交付的，而 macOS 的通知守护进程按**代码签名身份**判定调用方资格，未签名实例的 `requestAuthorization` 与 `addNotificationRequest` 全被拒（M636 定论，证据 `.tower/comms/inbox/20261023-worker-notify-survey-oct23-tower-survey-summary.md`）。闸挡的正是「构建退出 0 但产物没签」这一形态。

ad-hoc 签名只够本机：DR（designated requirement）就是 cdhash，换版即换身份，TCC 授权可能重问一次；对外分发需要 Developer ID + 公证（$99/年），属另行裁决。

`bash scripts/pack-release.sh --bundles dmg` 重打后 tauri 会清掉 `bundle/macos/Lumir.app`（只留 dmg）——此时闸只读挂载 dmg、对 payload 里的同名 app 跑同一组判据（`PACK INFO signature … 改验 dmg payload`），判据不降级。人工复核同理：先把 dmg 挂上（`hdiutil attach -readonly <dmg>`），对 `<挂载点>/Lumir.app` 跑上面的命令。

人工复核命令（与闸同口径，打包机上手跑一次可复核闸的判定）：

```
app=src-tauri/target/release/bundle/macos/Lumir.app
codesign --verify --deep --strict "$app" && echo SIGN-VERIFY-OK
codesign -dv --verbose=4 "$app" 2>&1 | grep -E '^(Identifier|Info.plist entries|Sealed Resources)'
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist"
```

期望：`SIGN-VERIFY-OK`、`Identifier=com.lumir.app`、`Info.plist entries=<N>`、`Sealed Resources version=<N>`、`CFBundleIdentifier=com.lumir.app`。

### dmg

对 `Lumir_<version>_aarch64.dmg`：

- `hdiutil verify <dmg>` → `checksum ... is VALID`。
- 挂载后核对 payload = `Lumir.app` + `Applications` 符号链接，核对完 `hdiutil detach`。
- `Info.plist` 的 `CFBundleShortVersionString` 与 `CFBundleVersion` = 目标版本；.app 与 DMG 内 payload 各验一次。
- `file <二进制>` → `Mach-O 64-bit executable arm64`，与文件名 `_aarch64` 一致。
- 版本三处一致：`src-tauri/tauri.conf.json`、`package.json`、`src-tauri/Cargo.toml`。

## 交付惯例

- 证据目录 = **主仓 checkout** 的 `.local/releases/release-<version>/`（git 外；`.local/` 被 gitignore；worktree 里没有 `.local`，也不该在那里建）。把 dmg 复制一份进该目录，同目录留本次打包的脚本与产物校验日志（样板：`build.sh`、`tauri-build.log`、`verify.log`；重试过 dmg 时加 `dmg-retry.log`）。**打包树的门禁日志不是必备产物**（2026-11-03 起）：`gate-quick.log` / `gate-visual.log` / `visual-regression.log` 属功能批的验收证据，留在该批自己的证据目录或 CI 记录里；0.12.0 及以前目录中已有的这批日志按旧流程原样存档，不追溯。
- `index.md` 至少记明：源 commit（版本 bump 后的那个 commit）、打包位置（路径 A / B；路径 B 另记相对 master 的差异面）、版本闸 / 构建 / 签名闸读数、DMG 完整性读数、sha256，以及**功能验收证据的指针**——功能批的 `GATE RESULT` 原文行、对应的 PR / master CI run 链接。打包证据只证明「产物来自这份已验收代码且完整可装」，不复制验收日志。
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
- 打包本身是机器判定（版本闸 + 构建 + 签名闸 + DMG 完整性 + sha256），不设文档评审节点；视觉回归不在打包环节做，归功能验收（「简单打包」节）。
- 「是否打包 / 打哪一版」由 Alex 拍板（开工口令触发）；0.7.0 的下一版（0.7.1 patch）即按此等 Alex 口令。
