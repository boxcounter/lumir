// 真实 app 的起停与运行环境准备。
//
// 三件事在这里被钉死（验收可复现的前提）：
//   1. 配置隔离：app 进程带 XDG_CONFIG_HOME=<results>/env 启动，套件自带 config.json。
//      Rust 侧 config_dir() 优先读 XDG_CONFIG_HOME（src-tauri/src/config.rs），
//      因此用户的 ~/.config/lumir 全程不被读写——[keys] 重绑场景可以随便改。
//   2. vault 重置：验收 vault 是合成 vault，每次运行重置为 fixtures 的精确副本。
//      用户真实 vault（真实路径按信息卫生纪律不落库）永不写入。
//   3. 端口隔离：dev server 走独立端口，绝不与 Alex 手头的 `pnpm tauri dev` 抢 1420。
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { cp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CuError } from "./cu.mjs";
import { envHome, exists, InfraError, log, mkdirp, readText, repoRoot, secondVaultDir, sleep, stripAnsi, vaultDir } from "./util.mjs";

/**
 * 验收副本的 bundle id（M622，Alex 2026-10-21 裁决的 B 方案）：构建期用 `tauri build --config`
 * 把 identifier 覆盖成这个值，`src-tauri/tauri.conf.json` 本体一字不动。独立 id 是通知点击落点的
 * 根治——usernoted / LaunchServices 按 **bundle id** 解析点击目标，与产品同 id 的验收副本点通知时
 * 会被解析到安装版 `/Applications/Lumir.app`（M619 真机实证，见 README「实例 flavour」）。
 *
 * 运行时**不拿这个常量当身份**：身份取自构建产物 `Contents/Info.plist` 的 `CFBundleIdentifier`
 * （`acceptanceBundleId()`）。常量只是**期望值**，由 `assertAcceptanceBundleIdentity()` 把两者
 * 对齐——构建时漏了 `--config`（产物仍是产品 id）或换了别的 id，都在起跑预检里判红，不让一次
 * 「点击仍落到安装版」的假绿跑完。
 */
export const ACCEPTANCE_BUNDLE_ID = "com.lumir.app.acceptance";

/** LaunchServices 注册表工具（M619）：打包实例经 `open` 启动会登记进 LS 数据库，收尾时按本副本
 *  路径撤销这条记录——只撤销指定路径，同 bundle id 的其他副本不受影响（实测两副本同 bundle id
 *  时 `-u B` 后 A 的记录仍在）。不撤销的话，worktree 里的副本会以验收 id 的身份留在 LS 数据库里，
 *  指向一个随后被清理的路径。 */
const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

/** 产品自己的 bundle id：从 `src-tauri/tauri.conf.json` 现场读（产品身份的真源，不在套件里抄字面量）。 */
export function productBundleId() {
  const conf = JSON.parse(readFileSync(path.join(repoRoot(), "src-tauri", "tauri.conf.json"), "utf8"));
  if (!conf.identifier) {
    throw new Error("src-tauri/tauri.conf.json 缺 identifier：无法核对验收副本的身份隔离");
  }
  return conf.identifier;
}

/**
 * 从 `.app` 的 `Contents/Info.plist` 读 `CFBundleIdentifier`——**构建产物是 bundle 身份的真源**。
 * 读不到即抛 `InfraError`，不回落任何字面量：回落就是回到「套件里的 id 与产物里的 id 各写一份」，
 * 而这条差异正是 M619 的点击落点问题（README「实例 flavour」）。
 * `exec` 可注入（自测用），签名同 `spawnSyncText(cmd, args)`。
 */
export function readBundleId(appPath, exec = spawnSyncText) {
  const plist = path.join(appPath, "Contents", "Info.plist");
  let raw;
  try {
    raw = exec("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", plist]);
  } catch (e) {
    const stderr = e?.stderr ? String(e.stderr).trim() : "";
    throw new InfraError(
      `读不到打包实例的 CFBundleIdentifier（${plist}）：${stderr || e.message}——重新构建验收副本` +
        "（node scripts/acceptance/build-bundle.mjs）",
    );
  }
  const id = String(raw).trim();
  if (!id) {
    throw new InfraError(`打包实例的 CFBundleIdentifier 为空（${plist}）：Info.plist 不完整，重新构建验收副本`);
  }
  return id;
}

/** 构建产物里的验收 bundle id；dev flavour（没有 .app）返回 null。按 `.app` 路径缓存，一次跑批只读一次盘。 */
const bundleIdCache = new Map();
export function acceptanceBundleId() {
  const appPath = bundleAppPath();
  if (!appPath) return null;
  if (!bundleIdCache.has(appPath)) bundleIdCache.set(appPath, readBundleId(appPath));
  return bundleIdCache.get(appPath);
}

/**
 * 起跑预检的身份门（M622）：验收副本的 bundle id 必须等于 `ACCEPTANCE_BUNDLE_ID`。
 *
 * 三类输入、两种红法：
 *   - 等于期望值 → 返回 `{ appPath, bundleId, productBundleId }`；
 *   - 等于**产品 id**（最常见：构建时漏了 `--config`）→ 点通知会被 LS 解析到安装版，本次读数
 *     不算数，直接判红并给出重建命令；
 *   - 其他任何 id → 通知授权按 bundle id 记账，换 id 会让首次授权作废、点击链路不可复现，同样判红。
 * dev flavour 返回 null（没有 .app 身份可核）。
 *
 * `bundleId` / `productId` 可注入（自测用），不注入时从构建产物与 tauri.conf.json 现读。
 */
export function assertAcceptanceBundleIdentity({
  appPath = bundleAppPath(),
  bundleId,
  productId = productBundleId(),
} = {}) {
  if (!appPath) return null;
  const actual = bundleId ?? readBundleId(appPath);
  if (actual === productId) {
    throw new InfraError(
      `打包实例的 bundle id 仍是产品 id（${productId}）：构建时没加 --config 覆盖 identifier。` +
        "通知点击会按这个 id 被 LaunchServices 解析到安装版（M619 的根因），本次读数不算数——" +
        `用 node scripts/acceptance/build-bundle.mjs 重建（产物 id 应为 ${ACCEPTANCE_BUNDLE_ID}）。`,
    );
  }
  if (actual !== ACCEPTANCE_BUNDLE_ID) {
    throw new InfraError(
      `打包实例的 bundle id 是 ${actual}，与验收 id ${ACCEPTANCE_BUNDLE_ID} 不一致：通知授权按 bundle id ` +
        "记账，换 id 会让首次授权作废、点击链路也不可复现——用 node scripts/acceptance/build-bundle.mjs 重建。",
    );
  }
  return { appPath, bundleId: actual, productBundleId: productId };
}

export function acceptPort() {
  return Number(process.env.LUMIR_ACCEPTANCE_PORT ?? 1430);
}

/**
 * **打包实例模式**（M605）：`LUMIR_ACCEPTANCE_BUNDLE=<…>/Lumir.app/Contents/MacOS/lumir` 时，
 * 套件不再起 `pnpm tauri dev`，而是启动打包实例。
 *
 * 为什么需要这条通道（dev flavour 的通知点击路由，2026-10-19 实证）：插件在 `tauri::is_dev()`
 * 时把通知归属写成 `com.apple.Terminal`（`tauri-plugin-notification` 的 dev 行为）。横幅能投递、
 * 也能点，但 usernoted 记录 `Received response … app:"com.apple.Terminal" … foreground: true`
 * ——系统把点击响应路由给 **Terminal** 的 bundle 身份，本进程的 `on_action` 回调永远收不到
 * ⇒ `cron_click` 不产生。这是 dev flavour 的通道边界，不是产品缺陷；打包实例的 bundle id 是
 * 验收 id（`ACCEPTANCE_BUNDLE_ID`，构建期覆盖，运行时从 Info.plist 现读），响应回到自己的进程
 * （change add-cron-runtime-daemon §4.7 的兜底口径）。
 *
 * **启动方式（M619）**：打包实例经 LaunchServices（`open`）启动，**不是**直接 exec 二进制——
 * 直接 exec 的 GUI app 也会向 LS check in，但它不是 LS 的 **launch 实例**（无 launch time /
 * coalition，`parentASN` 指向终端）；`open` 启动后本副本才是 LS launch 实例（2026-10-21 探针；
 * 170/171 真机窗口里 `lsappinfo` 也确认了这一点）。M619 当时点击仍拉起安装版，因为 LS 按
 * **bundle id** 解析落点、两个副本同 id；M622 起验收副本构建期改用独立 id（见
 * `ACCEPTANCE_BUNDLE_ID`），点击应回到本副本。M619 的游离实例识别与清退保留作纵深防御
 * （`quiesceStrayBundleInstances`），归属判据按 pid 认。详见 `launchApp` 的 bundle 分支与
 * README「实例 flavour」节。
 *
 * 返回 null 表示走原来的 `pnpm tauri dev`（缺省，所有既有场景行为不变）。
 */
export function bundleBinary() {
  const bin = process.env.LUMIR_ACCEPTANCE_BUNDLE;
  return bin ? path.resolve(bin) : null;
}

/**
 * 打包实例的 `.app` 根（M619）：`open` 只接受 `.app` 路径，而 README / 历史用法给的
 * `LUMIR_ACCEPTANCE_BUNDLE` 是 `.app` 内的二进制。两种写法都收：`…/Lumir.app` 原样返回，
 * `…/Lumir.app/Contents/MacOS/lumir` 按最后一段 `Contents/MacOS/` 截出 `.app`。
 *
 * 解析不出 `.app` 即抛 `InfraError`——不回落「按路径起二进制」的旧通道，那正是把安装版
 * 拉起来的成因（静默降级回来就是同一个坑）。
 */
export function bundleAppPath() {
  const bin = bundleBinary();
  if (!bin) return null;
  if (bin.endsWith(".app")) return bin;
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const idx = bin.lastIndexOf(marker);
  if (idx > 0) {
    const app = bin.slice(0, idx);
    if (app.endsWith(".app")) return app;
  }
  throw new InfraError(
    `LUMIR_ACCEPTANCE_BUNDLE 必须是 …/Lumir.app 或 …/Lumir.app/Contents/MacOS/lumir（打包实例模式经 ` +
      `LaunchServices 启动 .app，不再直接 exec 二进制——见 app.mjs 的 bundleBinary 注释）：${bin}`,
  );
}

export function fixturesDir() {
  return path.join(repoRoot(), "scripts/acceptance/fixtures");
}

/** 场景 front-matter `config:` 允许的键（M284）——**单点真源**：run.mjs 的折算（在起 app 之前
 *  写进隔离 config.json）与 execute.mjs 的静态校验（`--check`）共用这一份，免得两处漂移
 *  （REVIEW.md 「同一语义两处真源」条）。键名即 `writeConfig()` 的同名参数，**传了才写**、缺省走应用出厂口径。 */
export const SCENARIO_CONFIG_KEYS = [
  "lineWrap",
  "codeBlockWrap",
  "autoIndent",
  "fontFamily",
  "monoFontFamily",
  "fontSize",
  "theme",
  "contentWidth",
  "language",
  "keys",
  "harness",
  // 会话自动命名（change add-session-auto-naming，task 5.2b）：`sessionNaming: { enabled, provider,
  // model }` 整表直落配置文件的 `[harness].session_naming`，三键都可省——缺省不写 = 出厂行为
  // （自动命名开、命名 provider = 会话 provider、模型 = 该 provider 生效模型）。
  // 2026-10-18 配置面重塑（M579）废除的旧顶层键 `autoTitle` / `titleProvider` / `titleModel`
  // 不在此保留别名：execute.mjs 的 REMOVED_CONFIG_KEYS 对它们出现即报错（静默丢弃正是 finding
  // 20261018-worker-m579 报告的现场）。
  "sessionNaming",
  // `[editor]` 表整表透传（M379，backlog「验收套件表达力缺口」条的「`config` 通道只透传 `keys`」项）：snake_case 键写进 `editor` 表（`writeConfig`
  // 的同名参数），给「新增的 editor 配置项」构造**启动口径**用——不必每加一个键就回来改套件。
  // 形状校验见 execute.mjs 的 checkScenario（非表即报，避免静默丢半张表）。
  "editor",
  // `[cron]` 表（change add-cron-runtime-daemon §7）：`{ tasks: [...] }` 整表直落配置文件的
  // `cron` 节（与配置文件同形）。任务的 `at` 可写 `$nextMinute` / `$nowMinute` / `$pastMinute`
  // ——到点类场景按「下一次分钟边界 / 今日已过」构造，不把时刻写死进场景。
  "cron",
];

/** 写隔离 config.json。`keys` 不传时整体不写该字段（默认无覆盖）。
 *  M180（change line-wrap-options）起支持 `lineWrap` / `codeBlockWrap`：**传了才写进 editor 表**
 *  ——两项缺失时应用走 Rust 侧 `Default`（line_wrap = true、code_block_wrap = false），
 *  这正是「默认口径」场景要的形态；显式写 false / true 才构造出另外三条组合。
 *  M195（change typography-and-zoom）起同样支持 `fontFamily` / `monoFontFamily` / `fontSize`：
 *  三个都**传了才写**，缺省即出厂口径（字体族沿用底线、字号 15）——与折行两项同一形态。
 *  M210（change restyle-ui-tokens-v1）起支持 `theme`：同样**传了才写**，且落在 `[ui]` 表上
 *  ——缺省时**整个 ui 表不写**，应用走 Rust 侧 `Default`（theme = light），这正是「未配置
 *  即 light」场景要的形态。 */
export async function writeConfig({
  lastVault = vaultDir(),
  mode = "md",
  lineWrap = undefined,
  codeBlockWrap = undefined,
  autoIndent = undefined,
  fontFamily = undefined,
  monoFontFamily = undefined,
  fontSize = undefined,
  theme = undefined,
  contentWidth = undefined,
  // 界面语言（M282，change ui-language-i18n）：与 theme / contentWidth 同形，缺省沿用当前值。
  language = undefined,
  keys = undefined,
  // `[editor]` 表**整表透传**（M379，backlog「验收套件表达力缺口」条的「`config` 通道只透传 `keys`」项）：snake_case 键原样并入 `editor` 表，写在具名
  // 参数**之前**——具名参数（mode / line_wrap / …）仍然优先，显式值不会被这张表吃掉。
  // 用途：场景 front-matter 的 `config: { editor: {…} }` 与 `configWrite` 动作的 `editor:` 都走它，
  // 于是「M180 这类新增的 editor 配置项」不必回来改套件就能构造启动口径。
  editor = undefined,
  // [harness] 节（M304，change add-harness-probe §11）：传了才写。形状：
  // { provider, fixture, permissions: { allow, deny }, permission_mode, loopMax, warnCtxPct,
  //   autoCompact, kimiModel, kimiModels }——
  // fixture 路径在场景加载期已被 token 替换为绝对路径（mock 脚本用 $fixtures 只读引用套件
  // fixtures 目录，不拷进 vault——拷进 vault 会留下非 .md 残留，串红场景 28/65 的
  // 「vault 里无 json/tmp 产物」断言）；$vault / $vault2 精确记号仍可经 resolveSeedPath 解析。
  harness = undefined,
  // 会话自动命名（change add-session-auto-naming，task 5.2b）：**顶层** `sessionNaming:
  // { enabled, provider, model }` 整表直落 `[harness].session_naming`（与配置文件同形，子键
  // 省略即缺省）。传了才写；整表不写 = 出厂口径（自动命名开、provider 跟随会话、模型跟随该
  // provider 的生效模型）。
  sessionNaming = undefined,
  // `[cron]` 表（change add-cron-runtime-daemon §7）：`{ tasks: [...] }` 整表直落 `cron` 节。
  // 任务的 `vault` 支持 `$vault` / `$vault2` 记号；`at` 支持 `$nextMinute` / `$nowMinute` /
  // `$pastMinute`（按写入时刻算），到点类场景因此不必写死时刻。
  cron = undefined,
} = {}) {
  const dir = path.join(envHome(), "lumir");
  await mkdirp(dir);
  const editorTable = { ...(editor ?? {}), mode };
  if (lineWrap !== undefined) editorTable.line_wrap = lineWrap;
  if (codeBlockWrap !== undefined) editorTable.code_block_wrap = codeBlockWrap;
  // Enter 自动缩进（M272，change enter-auto-indent）：与折行三键同一条装配链的配置面。
  if (autoIndent !== undefined) editorTable.auto_indent = autoIndent;
  if (fontFamily !== undefined) editorTable.font_family = fontFamily;
  if (monoFontFamily !== undefined) editorTable.mono_font_family = monoFontFamily;
  if (fontSize !== undefined) editorTable.font_size = fontSize;
  const cfg = { version: 1, last_vault: lastVault, editor: editorTable };
  const ui = {};
  if (theme !== undefined) ui.theme = theme;
  if (contentWidth !== undefined) ui.content_width = contentWidth;
  if (language !== undefined) ui.language = language;
  if (Object.keys(ui).length > 0) cfg.ui = ui;
  if (keys !== undefined) cfg.keys = keys;
  const h = {};
  const now = Date.now();
  if (harness !== undefined) {
    if (harness.provider !== undefined) h.provider = harness.provider;
    // mock fixture 里的时刻记号（M616）：`$nextMinute` / `$nowMinute` / `$pastMinute` 与
    // `[cron]` 表同一份换算（同一个 `now`），脚本里因此可以写「注册时未到点 / 今日已过点」——
    // 对话式注册的 `at` 由**模型给出的工具参数**决定，仓库里的 fixture 是静态 JSON，写死时刻
    // 会让场景随当天时段漂到另一种语义。无记号的 fixture 原样引用（既有场景逐字节不变）。
    if (harness.fixture !== undefined)
      h.providers = { mock: { fixture: await materializeMockFixture(resolveSeedPath(harness.fixture), now) } };
    // M372（场景 99）：kimiModel 写了就构造 kimi provider 节（model + 占位 api_key）——
    // k3-256k 等自定义模型的能力判定（思考 chip 置灰判据）按 config 现算，不发消息就验得到；
    // 发消息的场景不会配这个键（真 api_key 不进验收环境）。
    if (harness.kimiModel !== undefined) h.providers = { kimi: { model: harness.kimiModel, api_key: "acceptance-dummy" } };
    // M373（场景 102；M381 起 config-only）：schema 的 model 维度——逐项 { id, effort, window }
    // 清单写进 providers.kimi.models（不写 = 空清单 + 应用侧 warning + 浮层 D402 提示态——
    // 内置 preset 已彻底删除；写了即声明清单，能力/窗口按声明现算）。
    if (harness.kimiModels !== undefined) {
      h.providers = h.providers ?? {};
      h.providers.kimi = { ...(h.providers.kimi ?? {}), models: harness.kimiModels };
    }
    if (harness.permissions !== undefined) h.permissions = harness.permissions;
    // 权限模式（M481，change add-harness-permission-modes）：三档闭集合 `read_only` / `vault_write`
    // / `full_access`，缺省 `vault_write`（应用出厂口径，缺省即不写该字段）。键名与配置文件
    // `[harness].permission_mode` 同形。**为什么场景要显式写**：默认档 `vault_write` 下
    // `vault_patch` / `vault_create` / `vault_move` 自动放行、无批准闸，而「一切写逐个问」那批
    // 场景（72/73/74）在 2026-10-09 三档权限落地后从未回扫——显式钉 `read_only` 才能让闸复活。
    if (harness.permission_mode !== undefined) h.permission_mode = harness.permission_mode;
    if (harness.loopMax !== undefined) h.loop_max = harness.loopMax;
    if (harness.warnCtxPct !== undefined) h.warn_ctx_pct = harness.warnCtxPct;
    if (harness.autoCompact !== undefined) h.auto_compact = harness.autoCompact;
    // 子代理运行（change add-harness-subagents design §14，M590 验收批）：`subagents:
    // { enabled, max_turns, max_tokens, timeout_secs, max_subruns_per_turn, max_concurrent }`
    // **整表直落** `[harness].subagents`（键名与配置文件同形，子键省略即出厂缺省）。
    // 场景需要构造的开关 / 闸值（8.12 的 enabled=false、max_subruns_per_turn=1、
    // max_concurrent=1）只有启动口径能表达——运行期没有配置界面。
    if (harness.subagents !== undefined) h.subagents = harness.subagents;
    // 图片语义命名（change add-semantic-image-naming，2026-10-18 配置面重塑）：三键
    // `{ enabled, provider, model }` 原样落 `harness.attachment_naming`（与会话自动命名的
    // `session_naming` 同一资源域）。传了才写——缺省即出厂（开、provider 跟随会话、
    // 模型跟随该 provider 的生效模型）。
    if (harness.attachment_naming !== undefined) h.attachment_naming = harness.attachment_naming;
  }
  // 会话自动命名（顶层 `sessionNaming`）：整表原样落 `[harness].session_naming`——不在这里再
  // 拆键映射（旧形态的 `title_model` 落 provider 条目那种拼法已随 M579 废除，见 app.mjs 头部
  // SCENARIO_CONFIG_KEYS 的注释）。
  if (sessionNaming !== undefined) h.session_naming = sessionNaming;
  if (Object.keys(h).length > 0) cfg.harness = h;
  if (cron !== undefined) cfg.cron = resolveCronConfig(cron, now);
  await writeFile(path.join(dir, "config.json"), `${JSON.stringify(cfg, null, 2)}\n`);
  return path.join(dir, "config.json");
}

/**
 * `at` 的时刻记号 → `HH:MM`（change add-cron-runtime-daemon §7）：`$nextMinute` = 至少 60s
 * 之后的下一个分钟边界（给起 app 留裕量）、`$nowMinute` = 当前分钟（今日已过、立即到点）、
 * `$pastMinute` = 前一分钟。`[cron]` 表与 mock fixture 共用这一个换算点（M616）——两处各算一份
 * 会让同一次运行里的「对照组」与「注册任务」落在不同的分钟上（REVIEW.md「同一语义两处真源」条）。
 */
function cronAtTokens(now) {
  const format = (ms) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const minute = 60_000;
  return {
    $nextMinute: format(Math.ceil((now + minute) / minute) * minute),
    $nowMinute: format(now),
    $pastMinute: format(now - minute),
  };
}

/**
 * mock fixture 的时刻记号展开（M616）：读 fixture 原文，把 `$nextMinute` / `$nowMinute` /
 * `$pastMinute` 换成按**写入配置时刻**算出的 `HH:MM`，落一份副本到隔离配置目录，config 指向它。
 *
 * 为什么必须存在：对话式注册场景的 `at` 在**模型的工具参数**里（fixture 是仓库里的静态
 * JSON），而「注册时未到点 / 今日已过点」必须按运行时刻算。无记号的 fixture 返回原路径
 * （既有场景的引用路径逐字节不变）；副本写在隔离配置目录（git 外），仓库里的 fixture 不被改写。
 */
async function materializeMockFixture(source, now) {
  const text = await readText(source);
  const tokens = cronAtTokens(now);
  let out = text;
  for (const [token, value] of Object.entries(tokens)) out = out.split(token).join(value);
  if (out === text) return source;
  const target = path.join(envHome(), "lumir", `mock-fixture-${path.basename(source)}`);
  await writeFile(target, out);
  return target;
}

/**
 * `[cron]` 表的场景归一（change add-cron-runtime-daemon §7）：两件事只在这里做——
 * ① 任务 `vault` 的 `$vault` / `$vault2` 记号按套件的合成 vault 解析（不写死 /tmp 路径）；
 * ② `at` 的时刻记号按**写入时刻**换算（记号表见 [`cronAtTokens`]）。
 * 到点类场景因此不把时刻写死，跨天重跑也成立。
 */
function resolveCronConfig(cron, now) {
  const at = cronAtTokens(now);
  const tasks = Array.isArray(cron?.tasks)
    ? cron.tasks.map((task) => ({
        ...task,
        vault: typeof task.vault === "string" ? resolveSeedPath(task.vault) : task.vault,
        at: typeof task.at === "string" && Object.hasOwn(at, task.at) ? at[task.at] : task.at,
      }))
    : cron?.tasks;
  return { ...cron, tasks };
}

export async function readConfig() {
  const file = path.join(envHome(), "lumir", "config.json");
  return JSON.parse(await readText(file));
}

/**
 * 清空崩溃备份目录。
 * 为什么必须做：备份目录在**隔离配置目录**下，不在验收 vault 里——只重置 vault 会让上一场景/上一轮的
 * 备份残留到本场景，使「启动发现残留备份」类场景读到别人的备份（实证：08c 恢复了 keys.md 的内容，
 * 而本场景用的是 plain.md），glob 断言也会因此假绿。每场景开始前必须清干净。
 */
export async function resetRecovery() {
  const dir = path.join(envHome(), "lumir", "recovery");
  await rm(dir, { recursive: true, force: true });
  return dir;
}

/**
 * 清空 harness（对话面板）的会话 wire 留存目录（`env/lumir/harness/`，含 `sessions/`）。
 * 为什么必须做：与 recovery 同因——留存文件在**隔离配置目录**下，只重置 vault 会让上一场景的
 * `session_open` / `llm_request` / `llm_response` 记录残留到本场景，file 断言（`env:harness/sessions/<vault 稳定 id>/*.jsonl`——
 * 中间一层是 per-vault 的目录）会读到别人的记录而假绿/假红。
 * 实证：M304 首轮 8 场景连跑，50 条记录全部串在一个文件里。
 */
export async function resetHarness() {
  const dir = path.join(envHome(), "lumir", "harness");
  await rm(dir, { recursive: true, force: true });
  return dir;
}

/**
 * 用户级子代理定义目录（change add-harness-subagents design §4.1）：`<隔离配置>/lumir/agents/`。
 * 与 harness 留存同因——不清会让上一场景写下的用户级定义串进下一场景的清单与覆盖规则
 * （M590 现场：187 期望「5 个自定义 + explore = 6」，读到 185 留下的用户级 research 后变 7，
 * 清单计数断言与 `catalog_large` 的 definition_count 一起判红）。
 */
export async function resetAgentDefinitions() {
  const dir = path.join(envHome(), "lumir", "agents");
  await rm(dir, { recursive: true, force: true });
  return dir;
}

/** 把 vault 重置为 fixtures 的 `.md` 副本：清 vault 根下的**全部**条目（文件与目录），再拷回
 *  fixtures 的 `.md`。
 *
 *  **为什么连非 `.md` 产物一起清（M296 缺口，M489 收口）**：此前只清 `.md` 与目录，根下的
 *  非 `.md` 残留会跨场景留到后面的 run——`fixtures:` 带进来的 `.gitignore` / `.gitattributes` /
 *  `x.jsonc` / `notes.txt` / `huge.log`（实测一轮全量批之后 `/tmp/lumir-m102-acceptance` 里
 *  有 40+ 个），以及**贴图落进根级笔记编辑器时留下的 `pasted-*.webp`**。实证：148 的注入泄漏往
 *  共享 vault 根丢了一个 `pasted-<hash>.webp`，经此缺口污染了随后 127 的「vault 零新增」断言
 *  （根下多一份同名贴图 ⇒ `glob … exact: 0` 假红）。清干净不改变任何场景的起点：依赖非 `.md`
 *  fixture 的场景各自在自己的 front-matter 里声明 `fixtures:`，由 `run.mjs` 在本函数之后、
 *  **起 app 之前**逐条 `copyFixture` 重拷（M516 挪的位置——此前那句在 `execute.mjs` 的
 *  `runScenario` 里、起 app 之后，与这里写的口径漂了，见 run.mjs 该处注释）。
 *  新场景仍 MUST NOT 依赖这类残留——要判「某文件在场」得声明 `fixtures:` 或用 `vaultWrite` 造。
 *
 *  只动**合成验收 vault**（`vaultDir()`），不碰真实 vault 与用户的 `~/.config/lumir`。 */
export async function resetVault() {
  const vault = vaultDir();
  await mkdirp(vault);
  for (const name of await readdir(vault)) {
    await rm(path.join(vault, name), { recursive: true, force: true });
  }
  for (const name of await readdir(fixturesDir())) {
    if (!name.endsWith(".md")) continue;
    await cp(path.join(fixturesDir(), name), path.join(vault, name));
  }
  return vault;
}

/** 第二个合成 vault 的重置：内容取自 `fixtures/second-vault/`（与验收 vault 的文件名不重叠，
 *  切换前后的正文断言因此能互相区分）。同样只清根下的 .md。 */
export async function resetSecondVault() {
  const vault = secondVaultDir();
  const src = path.join(fixturesDir(), "second-vault");
  await mkdirp(vault);
  for (const name of await readdir(vault)) {
    if (name.endsWith(".md")) await rm(path.join(vault, name), { force: true });
  }
  for (const name of await readdir(src)) {
    if (!name.endsWith(".md")) continue;
    await cp(path.join(src, name), path.join(vault, name));
  }
  return vault;
}

/** `lazy` 档探针的正文（这些条目惰性可见；条目数才是形状的一部分）。 */
const IGNORED_PROBE_MD = "# 构建产物探针\n\n这一条命中的是默认 lazy 档：出惰性行、不进索引。\n";

/** 用户规则命中族探针的正文：**marker 是场景的判据**（`editor.has` 到它就证明惰性文件真的能读）。
 *  改这一句要同步场景 67 的 marker 断言。 */
const LAZY_PROBE_MD = "# 本地教程\n\n本地教程正文：这一篇被用户规则挡住，但行在树里、展开可见、打开可读。\n";

/** 生成「复刻真实形状」的批量 vault 内容（M283，change vault-switch-restore-perf 的 1.3）。
 *
 *  形状口径（M265 §一 在真实 vault 上实测的 scan-visible 规模）：**2142 文件 / 426 目录 /
 *  1341 个 md / 7.01MB md**、行长正常（~78 字符/行，含标题与 wikilink）、含一个
 *  `node_modules` 用于验证默认 `lazy` 档（自身出惰性行、子孙不进枚举）。收益：验收与读数都跑在**与 Alex 真实 vault
 *  同形状**的合成 vault 上——M252 的稀疏单行放大器（48ms/MB）已被 M265 判为测量假象，
 *  **MUST NOT** 再拿它当规模口径。
 *
 *  为什么生成而不是入库：7MB × 2500 个文件进仓库是不可接受的体积；生成是确定性的（固定种子），
 *  跑一次约 1–3s，产物在 /tmp（套件按场景重置）。与 Rust 侧的读数 harness
 *  （`src-tauri/tests/vault_open_readings.rs`，同形状参数、独立实现）互为旁证：**两边是同一份
 *  fixture 规格的两个实现**，改形状时一起改（那条是 release 直调生产函数的读数工具，这条给真机
 *  场景用）。
 *
 *  `spec` 可覆盖任一档（缺省即真实形状）：markdown / files / dirs / mdBytes / maxMdBytes / ignoredMd。
 *
 *  另有**两类忽略探针**（M296 / change vault-open-ignore-set §9.3，都是可选的，缺省不生成）：
 *
 *  - `ignoredDirs: { <根下目录名>: <该目录里的 md 条数> }` —— 构建产物族探针（默认 `lazy` 档）。
 *    落在 vault **根**下（树的默认态就能判「这一行在不在」，不必先展开）；change
 *    ignore-tiers-config 起命中 `lazy` 档 ⇒ 这一行出惰性条目、子树不进枚举，展开时按需取一层。
 *  - `lazyDirs: { gitignore: [...], gitignoreNegations: [...], exclude: [...] }` —— 用户规则的探针。
 *    `gitignore` / `exclude` 是写在根 `.gitignore` / 根 `.git/info/exclude` 里的目录名（各带一个
 *    `tutorial.md`）；`gitignoreNegations` 是追加到根 `.gitignore` 的取反行，用来在真机上也留一条
 *    「用户规则的取反不能推翻 `hidden` / `lazy` 两档」的判据（两档先判且命中即定格）。
 *
 *  **探针参数只在 JS 侧**：Rust 侧读数 harness（`src-tauri/tests/vault_open_readings.rs`）只复刻
 *  「真实形状」那几档，不生成忽略探针——探针只服务可见性判据，不参与任何读数口径。 */
export async function generateBulkVault(spec = {}) {
  const mdCount = spec.markdown ?? 1341;
  const otherCount = spec.files ?? 2142 - mdCount;
  const dirCount = spec.dirs ?? 425; // 含根共 426
  const mdBytes = spec.mdBytes ?? 7_010_000;
  const maxMd = spec.maxMdBytes ?? 239_000;
  const ignoredMd = spec.ignoredMd ?? 40;
  const vault = vaultDir();
  await mkdirp(vault);

  // 确定性伪随机（xorshift64）：同一档参数每次生成逐字节一致，读数可复现。
  let seed = 0x283n;
  const rnd = (n) => {
    seed ^= seed << 13n;
    seed ^= seed >> 7n;
    seed ^= seed << 17n;
    seed &= 0xffffffffffffffffn;
    return Number(seed % BigInt(Math.max(1, n)));
  };
  const words = ["vault", "index", "notes", "graph", "render", "preview", "buffer", "session",
    "restore", "measure", "committed", "frozen", "reader", "window", "scroll", "target"];
  const body = (size) => {
    const chunks = ["# 合成读数样本\n\n", "> 复刻真实 vault 的文件形状：行长正常、md 正文、含 wikilink。\n\n"];
    let len = chunks[0].length + chunks[1].length;
    let line = 0;
    while (len < size) {
      let piece;
      switch (line % 9) {
        case 0: piece = `## 小节 ${line}\n`; break;
        case 1: case 2: case 3: {
          const ws = [];
          for (let i = 0; i < 13; i += 1) ws.push(words[rnd(words.length)]);
          piece = `${ws.join(" ")}\n`;
          break;
        }
        case 4: piece = `- 条目 ${line}：[[notes-${rnd(400)}]]\n`; break;
        case 5: piece = `  - 子条目 ${line}\n`; break;
        case 6: piece = `| 列 A | 列 B ${line} |\n| --- | --- |\n| 1 | 2 |\n`; break;
        case 7: piece = `\`\`\`text\ncode line ${line}\n\`\`\`\n`; break;
        default: piece = `\n段落分隔 ${line}\n\n`;
      }
      chunks.push(piece);
      len += piece.length;
      line += 1;
    }
    return chunks.join("");
  };

  // 目录树：24 个一级目录 + 401 个子目录（真实 vault 根级 24 项、目录合计 426）。
  const dirs = [];
  const topCount = Math.min(24, dirCount);
  for (let i = 0; i < topCount; i += 1) {
    const dir = path.join(vault, `area-${String(i).padStart(2, "0")}`);
    await mkdirp(dir);
    dirs.push(dir);
  }
  let made = topCount;
  while (made < dirCount) {
    const parent = dirs[rnd(topCount)];
    const dir = path.join(parent, `sub-${String(made).padStart(3, "0")}`);
    await mkdirp(dir);
    dirs.push(dir);
    made += 1;
  }

  // md 文件：按 mdBytes 反推主体档的平均值，再叠 20 个数十 KB 与一个 239KB 的极值
  //（真实分布的形状）。mdBytes 因此是真参数（改它读数规模跟着变）。
  const bulk = mdCount - 21;
  const bulkAvg = Math.max(1_000, Math.floor((mdBytes - 20 * 35_000 - maxMd) / bulk));
  for (let i = 0; i < mdCount; i += 1) {
    const size = i + 1 === mdCount
      ? maxMd
      : i < bulk ? bulkAvg - 500 + rnd(1_000) : 35_000;
    await writeFile(path.join(dirs[i % dirs.length], `note-${String(i).padStart(4, "0")}.md`), body(size));
  }
  // 其余文件（真实 vault 的另外 801 个：图片 / 配置 / 代码）。
  for (let i = 0; i < otherCount; i += 1) {
    const dir = dirs[(i * 7) % dirs.length];
    const kind = i % 4;
    const name = kind === 0 ? `asset-${i}.txt` : kind === 1 ? `data-${i}.json` : kind === 2 ? `img-${i}.svg` : `script-${i}.js`;
    const content = kind === 0 ? "纯文本附件\n" : kind === 1 ? '{"v":1}\n' : kind === 2 ? "<svg/>\n" : "export const v = 1;\n";
    await writeFile(path.join(dir, name), content);
  }
  // 惰性档探针：`node_modules` 自身出惰性行，其下的 md MUST NOT 进枚举（默认 lazy 档）。
  const nm = path.join(vault, "node_modules", "left-pad");
  await mkdirp(nm);
  for (let i = 0; i < ignoredMd; i += 1) {
    await writeFile(path.join(nm, `ignored-${String(i).padStart(2, "0")}.md`), body(2_000));
  }
  // ── 两类忽略探针（可选，见函数头的说明）─────────────────────────────────────────────
  // `lazy` 档命中族：根下的构建产物目录，每个目录里放 N 个 md。**条数给的是量级，不是判据**：
  // 判据只有「这一行在不在树里」（`target` / `dist` / `.cache` 是内置表里的名字）。
  const ignoredDirs = spec.ignoredDirs ?? {};
  for (const [name, count] of Object.entries(ignoredDirs)) {
    const dir = path.join(vault, name);
    await mkdirp(dir);
    for (let i = 0; i < count; i += 1) {
      await writeFile(path.join(dir, `artifact-${String(i).padStart(4, "0")}.md`), IGNORED_PROBE_MD);
    }
  }
  // 用户规则命中族：两份规则文件 + 各一个「可见、可展开、可打开」的 md（内容含固定 marker，
  // 场景按 marker 断言正文就位——见 LAZY_PROBE_MD）。
  const lazy = spec.lazyDirs ?? null;
  if (lazy) {
    const ignoreLines = [];
    const lazyNames = [];
    for (const name of lazy.gitignore ?? []) {
      ignoreLines.push(`${name}/`);
      lazyNames.push(name);
    }
    // 取反行追加在忽略行之后（gitignore 的口径：后行者胜）——真机上要证的正是「它对 hidden / lazy 两档无效」。
    for (const neg of lazy.gitignoreNegations ?? []) ignoreLines.push(`!${neg}`);
    if (ignoreLines.length) {
      await writeFile(path.join(vault, ".gitignore"), `# 真机验收场景 67 的用户规则探针（套件生成）\n${ignoreLines.join("\n")}\n`);
    }
    const excludeNames = lazy.exclude ?? [];
    if (excludeNames.length) {
      await mkdirp(path.join(vault, ".git", "info"));
      await writeFile(
        path.join(vault, ".git", "info", "exclude"),
        `# 真机验收场景 67 的用户规则探针（套件生成）\n${excludeNames.map((n) => `${n}/`).join("\n")}\n`,
      );
      lazyNames.push(...excludeNames);
    }
    for (const name of lazyNames) {
      await mkdirp(path.join(vault, name));
      await writeFile(path.join(vault, name, "tutorial.md"), LAZY_PROBE_MD);
    }
  }
  // 实测字节数交给调用方核（生成是分档近似：mdBytes 是目标，不是逐字节保证）。
  return { vault, markdown: mdCount, mdBytes, files: mdCount + otherCount, dirs: made, ignoredMd };
}
/** 注册表目录名（Rust 侧 `vault_registry` 的 `REGISTRY_DIR_NAME` 同源字面量）。 */
export const REGISTRY_DIR = "vault-registry";

/** 注册表目录的旧名（M248 更名前）：只作迁移场景 48 的预置源，app 启动时会被搬走。 */
export const LEGACY_REGISTRY_DIR = "workspaces";

/**
 * 清空 vault 注册表（隔离配置目录下的 `vault-registry/`）。
 * 为什么必须做：注册表决定列表浮层里有哪些行、以及「按路径命中的 id」。多 vault 场景会预置
 * 注册项，残留到下一场景会让「单 vault」的预期看到两行（跨场景串场，与 recovery 同因）。
 *
 * 旧名目录一并清（M248）：场景 48 会把注册项预置进旧的 `workspaces/`，要等 app 启动才被搬走
 * ——只清新名的话，上一轮的旧目录会残留到下一场景，并在那次启动里被迁移进新名。
 */
export async function resetRegistry() {
  const dir = path.join(envHome(), "lumir", REGISTRY_DIR);
  await rm(dir, { recursive: true, force: true });
  await rm(path.join(envHome(), "lumir", LEGACY_REGISTRY_DIR), { recursive: true, force: true });
  return dir;
}

/** 会话状态目录（隔离配置目录下的 `vault-sessions/`）：vault 标签布局与 **pane 几何**
 *  （`pane_split_ratio` / `harness_pane`）的盘上落点，见 `src-tauri/src/vault_session.rs`。
 *  路径口径与 recovery / reading-positions / vault-registry 同族：都在隔离 `XDG_CONFIG_HOME`
 *  下，用户的 `~/.config/lumir` 与真实 vault 全程不碰。 */
export function vaultSessionsDir() {
  return path.join(envHome(), "lumir", "vault-sessions");
}

/** 本场景 seed 预置的会话内容（`id → 盘上全文`）：启动前那次清场（见 `applySessionReset`）
 *  用它把 seed 的形状原样铺回。只有 seed 通道（`writeSession`）进这份账。 */
const seededSessions = new Map();

/** 复位声明的「启动前清场」是否已武装（见 `resetSessions` 与 `applySessionReset`）。 */
let sessionPurgeArmed = false;

/**
 * 清空按 vault 的标签会话（隔离配置目录下的 `vault-sessions/`）。
 * 为什么必须做：会话决定「装载完 vault 后恢复哪些标签」，残留会让本场景的启动恢复出上一场景
 * 的标签（08c 曾因 recovery 残留恢复出 keys.md 的内容——同族）。
 *
 * **为什么清完还不够（M494，收 agent-m490 的 finding）**：会话文件同时记 pane 几何
 * （`pane_split_ratio` / `harness_pane`），而本函数跑在**上一场景的实例还活着的时候**——
 * run.mjs 的复位段在前、`stopApp` 在后。于是「此刻清干净」不是最后一句：上一实例在这段窗口
 * 里任何一次会话落盘（防抖的最后一拍 / 退出前的 flush）都落在复位之后；它写的 id 若与本场景
 * 要开的 vault 同号（seed 复用 id 的场景就是），本场景便从**别人的** pane 宽度起步——窗口
 * 尺寸定得住、pane 宽度定不住（M490 记的 121/122 坐标落点漂即这一族）。因此复位只做「清」
 * 不够，还要**武装**一次启动前清场（`applySessionReset` 在 `launchApp` 里兑现）：把「会话
 * 起点」钉在本场景实例启动前那一刻，与写者时序无关。
 *
 * **调用顺序有约束**：必须在 `prepareSeed` **之前**（run.mjs 复位段即是此序）。seed 记进
 *  `seededSessions` 的那份账随本次复位清空，启动前清场照 seed 铺回；顺序颠倒会把本场景的
 *  seed 也当成残留。
 */
export async function resetSessions() {
  const dir = vaultSessionsDir();
  await rm(dir, { recursive: true, force: true });
  seededSessions.clear();
  sessionPurgeArmed = true;
  return dir;
}

/**
 * 启动前把会话状态钉到**本场景的起点**：清空目录 → 只把本场景 seed 的会话铺回去（没有 seed
 * 就是空目录 ⇒ 产品按无历史走默认 pane 比 1/2）。
 *
 * 由 `launchApp` 在**每次启动**时调用，但只在 `resetSessions` 武装过的那一次生效——
 * 场景内的 `do: restart`（`ctx.restartApp`）复用同一个 `launchApp`，那一次正是「会话恢复」
 * 场景（28 / 80 / 91 / 96 / 135 …）要的：重启前的布局必须留在盘上。武装标记在第一次启动时
 * 用掉，因此同一场景内的后续重启不再清场。
 *
 * 只动**隔离配置目录**（`vaultSessionsDir()`，`assertSafeTargets` 另对 XDG 根兜底），
 * 不碰真实 vault 与用户的 `~/.config/lumir`。
 */
export async function applySessionReset() {
  if (!sessionPurgeArmed) return;
  sessionPurgeArmed = false;
  const seeds = new Map(seededSessions);
  seededSessions.clear();
  const dir = vaultSessionsDir();
  await rm(dir, { recursive: true, force: true });
  if (seeds.size === 0) return;
  await mkdirp(dir);
  for (const [id, content] of seeds) {
    await writeFile(path.join(dir, `${id}.json`), content);
  }
}

/** 清掉按 vault 的阅读位置（M194，change remember-reading-position）。与 recovery / vault-registry /
 *  vault-sessions 同因：它也在隔离配置目录下，残留会让下一个场景（或明天重跑本场景时）一打开文件
 *  就恢复上一轮留下的位置，而「本轮之前不存在」「mtime 已推进」这类断言正是靠这份空目录区分
 *  「本轮写的」与「上轮残留的」。 */
export async function resetPositions() {
  const dir = path.join(envHome(), "lumir", "reading-positions");
  await rm(dir, { recursive: true, force: true });
  return dir;
}

/** 清掉窗口尺寸存档（`<env>/lumir/window-state.json`，M437，change startup-window-pane-defaults）。
 *  为什么必须做：M434 起首启尺寸 = 工作区 90%、其后按存档恢复；存档在**隔离配置目录根下**、
 *  是应用级单份状态，残留会让本场景的「首启」根本不是首启（读到上一场景的窗口尺寸），而窗口
 *  几何断言正对着这个量判——与 recovery / vault-sessions 同因的跨场景串场。
 *  对合并 M434 之前的 master 是空操作（那时产品没有这个文件），因此不影响既有场景。 */
export async function resetWindowState() {
  const file = path.join(envHome(), "lumir", "window-state.json");
  await rm(file, { force: true });
  return file;
}

/** 清掉诊断日志目录（`<env>/lumir/logs/`，change add-cron-runtime-daemon §7）。
 *  为什么必须做：日志文件在隔离配置目录下、跨场景累积，而 cron 场景用「日志里有 / 没有某事件」
 *  作为判据——上一场景的 `cron_run_started` 会让本场景的负向断言（「未点击不花 token」）假绿。
 *  每个场景从空日志开始，「本场景产生了什么」才可判。 */
export async function resetLogs() {
  const dir = path.join(envHome(), "lumir", "logs");
  await rm(dir, { recursive: true, force: true });
  return dir;
}

/** 清掉 cron 去重状态（`<env>/lumir/cron-state.json`，change add-cron-runtime-daemon §8）。
 *  为什么必须做：`last_fired` 决定「当日是否已触发」，残留会让本场景的「首启即到点」读到上一
 *  场景的日期而静默不触发——与 window-state / recovery 同因的跨场景串场。 */
export async function resetCronState() {
  const file = path.join(envHome(), "lumir", "cron-state.json");
  await rm(file, { force: true });
  return file;
}

/** 构造窗口尺寸存档的现场（M437）。三种形态（与 `do: restart` 的 `windowState:` 参数同源）：
 *   - `{ clear: true }`：删掉存档（等价 resetWindowState 的单次调用）；
 *   - `{ width, height }`：写一份合法存档（`version` 由套件补——产品当前 schema 版本），
 *     用来构造「换到更小的屏之后启动」这类只有磁盘状态能表达的现场；
 *   - `{ raw: "…" }`：原样落盘（截断 JSON / 版本不符 / 字段类型非法这类**读侧降级**现场）。
 *  schema 真源是 `src-tauri/src/window_state.rs` 的 `WindowState{version,width,height}`（尺寸是
 *  逻辑点、无位置字段）；写错字段名会被产品当「无存档」静默回落首启规则，所以断言要对准那个
 *  后果，而不是对准字段本身。返回落点与内容，供动作写进证据。 */
export async function writeWindowState(spec) {
  const file = path.join(envHome(), "lumir", "window-state.json");
  if (spec?.clear) {
    await rm(file, { force: true });
    return { file, content: null };
  }
  const content =
    spec?.raw !== undefined
      ? String(spec.raw)
      : `${JSON.stringify({ version: 1, width: spec.width, height: spec.height }, null, 2)}\n`;
  await mkdirp(path.dirname(file));
  await writeFile(file, content);
  return { file, content };
}

/** 注册项 id 的合法字符（与 Rust 侧 `vault_registry::valid_id` 同源：id 同时是文件名，
 *  因此这是路径逃逸防护）。套件里显式校验，让写错 id 在动作处就报错而不是落一个读不回的盘。 */
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** 预置一条 vault 注册项（`<env>/lumir/<dirName>/<id>.json`）——「这个目录已经是我的 vault」
 *  这一状态只能由注册表表达，而真机上走到它的唯一通道是系统目录选择器（套件不驱动原生
 *  对话框，见 README「已知边界」），因此多 vault 场景从预置注册表起步。
 *
 *  路径先 realpath：注册表存的是 canonicalize 后的路径（`reconcile_vault`），而 macOS 的
 *  `/tmp` 是 `/private/tmp` 的软链接——不归一的话 app 打开同一目录时会 `find_by_path` 落空、
 *  另生成一个 id，预置的会话（按 id 存放）就对不上了。
 *
 *  `dirName` 由下面两个薄包装给：现名与旧名。旧名那个只服务迁移场景（48）——它要构造的是
 *  「更名落地之前那台机器」的现场（注册项在 `workspaces/` 里） */
async function writeRegistryEntryInto(dirName, { id, path: vaultPath, lastOpenedAt, missingSince, archivedAt }) {
  if (!ID_RE.test(id ?? "")) throw new CuError(`注册项 id 非法：${JSON.stringify(id)}（只允许字母数字与 -_）`);
  const dir = await mkdirp(path.join(envHome(), "lumir", dirName));
  let real = vaultPath;
  try {
    real = realpathSync(vaultPath);
  } catch {
    /* 目录还不存在（如故意预置失效路径）：按原样落盘，可用性判定交给 app */
  }
  const entry = { id, path: real };
  if (lastOpenedAt !== undefined) entry.last_opened_at = lastOpenedAt;
  if (missingSince !== undefined) entry.missing_since = missingSince;
  if (archivedAt !== undefined) entry.archived_at = archivedAt;
  await writeFile(path.join(dir, `${id}.json`), `${JSON.stringify(entry, null, 2)}\n`);
  return entry;
}

/** 现名目录（`vault-registry/`）下的一条注册项。 */
export async function writeRegistryEntry(entry) {
  return writeRegistryEntryInto(REGISTRY_DIR, entry);
}

/** 旧名目录（`workspaces/`）下的一条注册项——迁移场景（48）的「升级前现场」。 */
export async function writeLegacyRegistryEntry(entry) {
  return writeRegistryEntryInto(LEGACY_REGISTRY_DIR, entry);
}

/** 预置一个 vault 的标签会话（`<env>/lumir/vault-sessions/<id>.json`）。
 *  两种形状（与 Rust 侧 `vault_session` 的 SESSION_VERSION / LEGACY_SESSION_VERSION 同源，
 *  读取侧按 `version` 分流）：
 *   - **v2**（`panes` 给了）：`panes` 是 `[{ tabs, active }]` 的横向有序列表、`ratio` 是分隔条
 *     比例——用于预置**分栏**会场的现场（M321）；
 *   - **v1**（缺省）：`tabs` 是 vault 相对路径的有序列表、`active` 是激活项（单 pane 形态，
 *     与 M318 之前一致）。
 *  非法 `active` 一律按「退化到第一个可打开标签」处理（`vault_session::sanitize` 同口径）。
 *
 *  写下的内容同时记进 `seededSessions`：这是「本场景的会话起点」的账，启动前清场
 *  （`applySessionReset`）据此把 seed 形状铺回（见 `resetSessions`）。 */
export async function writeSession({ id, tabs, active = null, panes = null, ratio = null, harnessPane = false }) {
  if (!ID_RE.test(id ?? "")) throw new CuError(`会话 id 非法：${JSON.stringify(id)}（只允许字母数字与 -_）`);
  const dir = await mkdirp(vaultSessionsDir());
  // `harness_pane`（M349）：v2 会话里记「harness 面板在场」的持久位（ADR 0008 Decision 6 的
  // Phase 2 消费位）。恢复时它决定旁侧 pane 是否重新装配成 harness（会话内容不持久化，恢复出
  // 空会话）。旧版 v2 文件无此字段时 Rust 读取侧按 false——这里缺省同为 false。
  const payload = panes
    ? { version: 2, panes, harness_pane: Boolean(harnessPane), pane_split_ratio: ratio ?? 0.5, updated_at: Date.now() }
    : { version: 1, tabs, active, updated_at: Date.now() };
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(path.join(dir, `${id}.json`), content);
  seededSessions.set(id, content);
  return payload;
}

/** `seed` 块里的路径记号：`$vault` / `$vault2` 指套件的两个合成 vault（不写死 /tmp 路径，
 *  这样 `LUMIR_ACCEPTANCE_VAULT` 覆写时场景跟着走）；其余按绝对路径原样用。 */
function resolveSeedPath(p) {
  if (p === "$vault") return vaultDir();
  if (p === "$vault2") return secondVaultDir();
  return p;
}

/** 应用场景 frontmatter 的 `seed` 块（注册表 + 旧名注册表 + 会话预置）。
 *
 *  **必须在起 app 之前跑**（run.mjs 在每个场景的 launchApp 之前调用）：app 打开一个未注册
 *  目录时会立刻给它分配一个自动 id 并落盘，事后再预置同路径的注册项会让列表里出现两行指向
 *  同一目录（一行自动 id、一行预置 id），`find_by_path` 命中哪一行还不确定。
 *
 *  `legacyRegistry`（M248）写进**旧名**目录 `workspaces/`，供迁移场景 48 构造「升级前现场」，
 *  与其他块同一时点、同一纪律。 */
export async function prepareSeed(seed) {
  const written = { registry: [], legacyRegistry: [], sessions: [], harnessFlat: [], harnessSessions: [], bulkVault: null };
  if (!seed) return written;
  // 复刻真实形状的批量内容（M283）：先重置（调用方已做）再生成，之后才是注册表 / 会话
  // ——会话里的路径必须指向真实存在的文件，否则恢复时会按「不在 vault 内」跳过。
  if (seed.bulkVault) {
    written.bulkVault = await generateBulkVault(seed.bulkVault === true ? {} : seed.bulkVault);
  }
  for (const e of seed.registry ?? []) {
    written.registry.push(
      await writeRegistryEntry({
        id: e.id,
        path: resolveSeedPath(e.path),
        lastOpenedAt: e.lastOpenedAt,
        missingSince: e.missingSince,
        archivedAt: e.archivedAt,
      }),
    );
  }
  for (const e of seed.legacyRegistry ?? []) {
    written.legacyRegistry.push(
      await writeLegacyRegistryEntry({
        id: e.id,
        path: resolveSeedPath(e.path),
        lastOpenedAt: e.lastOpenedAt,
        missingSince: e.missingSince,
        archivedAt: e.archivedAt,
      }),
    );
  }
  for (const [id, s] of Object.entries(seed.sessions ?? {})) {
    written.sessions.push(
      await writeSession({
        id,
        tabs: s?.tabs ?? [],
        active: s?.active ?? null,
        panes: s?.panes ?? null,
        ratio: s?.ratio ?? null,
        harnessPane: s?.harnessPane ?? false,
      }),
    );
  }
  for (const e of seed.harnessFlatSessions ?? []) {
    written.harnessFlat.push(await writeHarnessFlatSession(e));
  }
  for (const e of seed.harnessSessions ?? []) {
    written.harnessSessions.push(await writeHarnessSession(e));
  }
  return written;
}

/**
 * 写一份**旧布局**的平铺会话留存（`<env>/lumir/harness/sessions/<name>.jsonl`）——M433 的
 * 一次性归位脚本场景（125）的预置：这些文件是「升级前遗留」，产品运行时只按新布局读写
 * （`sessions/<vault 稳定 id>/`），根下平铺的 `*.jsonl` 不参与列举 / 恢复 / 删除；归位由
 * 场景动作 `migrateHarnessSessions` 跑一次脚本完成。
 *
 * `vaultRoot` 走 `resolveSeedPath`（`$vault` / `$vault2` 记号），**刻意不做 realpath**：验收 vault
 * 在 macOS 上位于 `/tmp/...`（注册表里存的是 realpath 后的 `/private/tmp/...`），两者字符串不等
 * ——脚本的规范化一步因此是**承重的**，真机跑出来的正是那个现场。
 * `raw` 给了就原样落盘（畸形首行的现场）。
 */
export async function writeHarnessFlatSession({ name, vaultRoot, raw }) {
  if (typeof name !== "string" || !name.endsWith(".jsonl")) {
    throw new CuError(`平铺会话文件名非法：${JSON.stringify(name)}（需要 *.jsonl）`);
  }
  const dir = await mkdirp(path.join(envHome(), "lumir", "harness", "sessions"));
  const content =
    raw ??
    `${JSON.stringify({
      ts: 1759912000,
      payload: {
        kind: "session_open",
        session_id: name.replace(/\.jsonl$/, ""),
        vault_root: resolveSeedPath(vaultRoot),
        opened_from: "new",
        provider: "mock",
        model: "mock-model",
        thinking: "high",
        system: "S",
        assembly: [],
      },
    })}\n`;
  await writeFile(path.join(dir, name), content);
  return path.join(dir, name);
}

export async function copyFixture(name) {
  await cp(path.join(fixturesDir(), name), path.join(vaultDir(), name));
  return path.join(vaultDir(), name);
}

/**
 * 预置一份**新布局**的会话留存
 * （`<env>/lumir/harness/sessions/<vault 稳定 id>/<name>.jsonl`）。
 *
 * 为什么需要（change add-session-auto-naming 场景 165）：要构造「本 change 之前的旧会话文件」
 * ——无 `session_title` 记录的现场，而产品的自动命名一旦跑过就会写记录，只能由磁盘状态表达。
 * `vaultId` 必须是场景 `seed.registry` 里预置的 id（产品自生成的 `vault-<pid>-<n>` 场景侧无从
 * 预知；场景 124 同一做法）。`raw` 给了就原样落盘（畸形现场），否则合成一份最小可恢复会话
 * （`session_open` + 一条 `llm_request` + 对应 `llm_response`，**没有标题记录**）。
 * `vaultRoot` 走 `resolveSeedPath` 且**刻意不做 realpath**：`session_open.vault_root` 的归属判据
 * 是逐字比较，验收 vault 在 /tmp 下、注册表存的是 /private/tmp——这正是产品要面对的现场。
 */
export async function writeHarnessSession({ vaultId, name, vaultRoot = "$vault", raw, firstUserText = "旧会话提问" }) {
  if (!ID_RE.test(vaultId ?? "")) {
    throw new CuError(`harness 会话目录 id 非法：${JSON.stringify(vaultId)}（须与 seed.registry 的 id 同形）`);
  }
  if (typeof name !== "string" || !name.endsWith(".jsonl")) {
    throw new CuError(`harness 会话文件名非法：${JSON.stringify(name)}（需要 *.jsonl）`);
  }
  const sessionId = name.replace(/\.jsonl$/, "");
  const dir = await mkdirp(path.join(envHome(), "lumir", "harness", "sessions", vaultId));
  const content =
    raw ??
    [
      {
        ts: 1759913000,
        payload: {
          kind: "session_open",
          session_id: sessionId,
          vault_root: resolveSeedPath(vaultRoot),
          opened_from: "new",
          provider: "mock",
          model: "mock-model",
          thinking: "high",
          system: "S",
          assembly: [],
        },
      },
      {
        ts: 1759913005,
        payload: {
          kind: "llm_request",
          request: {
            provider: "mock",
            model: "mock-model",
            system: "S",
            messages: [{ role: "user", content: [{ type: "input_text", text: firstUserText }] }],
            params: { thinking: "high" },
          },
        },
      },
      { ts: 1759913006, payload: { kind: "llm_response", text: "旧会话回答。" } },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n") + "\n";
  const file = path.join(dir, name);
  await writeFile(file, content);
  return file;
}

/**
 * 找本 worktree 构建出的 app 进程。
 * Tauri CLI 以相对路径 `target/debug/lumir` 起进程（cwd = src-tauri/），命令行里没有 worktree
 * 路径，因此不能按路径区分。改用**进程组**：launchApp 以 detached 起 `pnpm tauri dev`，子进程
 * 自成进程组（pgid == child.pid），vite / cargo / app 全在同一组内；Alex 手头那份实例在别的组，
 * 结构上不可能被误抓、误杀。
 */
export function findAppPid(pgid) {
  const rows = spawnSyncText("/bin/ps", ["-axo", "pid=,pgid=,command="]).split("\n");
  const hits = rows
    .map((l) => l.trim().split(/\s+/, 3))
    .filter(([, g, cmd]) => cmd && cmd.endsWith("target/debug/lumir"))
    .filter(([, g]) => pgid === undefined || Number(g) === Number(pgid));
  if (hits.length === 0) return null;
  return Math.max(...hits.map(([pid]) => Number(pid)));
}

function spawnSyncText(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" });
}

/**
 * 起 `pnpm tauri dev`。端口与**窗口位置**经 --config 覆写（不落盘、不改仓库 tauri.conf.json）。
 * 解析条件：stdout 出现 `LUMIR_READY`（src-tauri/src/ready.rs）或队列就绪兜底。
 *
 * 为什么要覆写窗口位置（M164 实测）：无人值守的批次里，macOS 会把新窗口放到主屏之外的
 * 区域（实测 `window_bounds x=193 y=1076`，而内置屏只有 ~982pt 高），窗口一旦落在屏幕外，
 * WKWebView 就**拿不到键盘焦点**——`type_text` 直接报
 * 「target WebArea did not acquire stable keyboard focus; no keys were sent」，整步的注入
 * 全部不落地，表现为一堆与产品无关的 FAIL（同一场景、同一提交，窗口在屏内时全 PASS）。
 *
 * **窗口对象必须从仓库 tauri.conf.json 读原件再叠位置**（M236，窗口配置只有一份真源，见 REVIEW.md 「同一语义两处真源」条）：tauri 的
 * `--config` 是深合并，但**数组按下标整体替换**——`app.windows[0]` 会被这里传的对象整根替掉。
 * 早先的写法是在这里手抄 title/width/height（+注释提醒「改那边要同步这里」），结果
 * `titleBarStyle: "Overlay"` 与 `hiddenTitle: true` 被**静默**吃掉：套件实例长出原生标题栏
 * （窗口多一行、webview 让出 32pt），而这个丢配置一点报错都没有——任何「真机验证窗口级配置」
 * 的断言在套件里都验不到（M213 实测对照见 `.local/missions/m213/titlebar/readings.md` §4）。
 * 现在改成从 `src-tauri/tauri.conf.json` 读 `app.windows[0]` 再 spread：窗口配置只有一份真源
 * （REVIEW.md 「同一语义两处真源」条），新增窗口级键不会再漏。读不到就抛错，**不回落手抄一份**（静默降级回来
 * 就是同一个坑）。运行期自检见 `drive.mjs` 的 assertOverlayChrome（waitAppReady 内）。
 */
export async function launchApp({ port = acceptPort(), timeoutMs = 300_000, logFile } = {}) {
  const root = repoRoot();
  const bundle = bundleBinary();
  const conf = JSON.parse(await readText(path.join(root, "src-tauri", "tauri.conf.json")));
  const baseWindow = conf.app?.windows?.[0];
  if (!baseWindow) {
    throw new Error(
      "launchApp：src-tauri/tauri.conf.json 里没有 app.windows[0]，无法构造 --config 覆写" +
        "（拒绝在这里手抄一份窗口配置——那正是窗口配置两份真源的成因，见 REVIEW.md 「同一语义两处真源」条）。",
    );
  }
  const config = {
    build: {
      devUrl: `http://127.0.0.1:${port}`,
      beforeDevCommand: `pnpm exec vite --port ${port} --strictPort`,
    },
    app: {
      // 先铺原件（titleBarStyle / hiddenTitle / title / width / height …），再只叠本轮要改的
      // 位置与焦点。spread 顺序即优先级：右边覆盖左边。
      //
      // 位置从 (120, 80) 挪到 (8, 40)（M236 实测）：窗口宽 1200（显式覆写，见下），而 x=120 时
      // 120 + 1200 = 1320 超出 1280 逻辑宽的屏幕，**窗口管理器会把它钳到 1160**——于是任何
      // 「先把窗口调到 1200」的真机断言（场景 39 的拉伸恢复档）在 1280 宽的机器上必然 FAIL，
      // 而失败信号看起来像产品侧问题。x=8 / y=40 仍在屏内（菜单栏下方、屏右缘之内）：
      // 8 + 1200 = 1208 ≤ 1280。窗口宽度本身仍由 `src-tauri/tauri.conf.json` 决定（1200），
      // 这里只改摆放 —— 比「把窗口挪一下再设尺寸」的重试逻辑简单，且对所有场景一致。
      // 已知边界：屏幕逻辑宽 < 1208 的机器上 1200 宽的窗口放不下，会如实被钳（这类机器上
      // 场景 39 的 `window.width` 断言会 FAIL —— 那是环境信号，不是产品缺陷）。
      windows: [{ ...baseWindow, x: 8, y: 40, focus: true }],
    },
  };
  // 场景复位武装过的启动前清场（M494 / M490 finding）：会话状态（pane 几何在内）只许是
  // 本场景 seed 的形状，上一实例在复位之后、退出之前写回的一律覆盖掉。场景内的 `do: restart`
  // 复用本函数，但那时武装标记已用掉，不动会话——重启要的正是盘上的布局。
  await applySessionReset();
  // 打包实例模式（M605 / M619 / M622）：经 LaunchServices 启动 .app（`open`），**不是**直接 exec
  // 二进制。直接 exec 的 GUI app 会 check in 但不是 LS 的 launch 实例（无 launch time / coalition，
  // parentASN 指向终端——2026-10-21 探针）；`open` 启动后本副本才是 LS launch 实例（真机
  // lsappinfo 已确认）。M619 实测（2026-10-21 11:44/11:46）点击通知仍拉起安装版，因为 LS 按
  // **bundle id** 解析落点、两个副本同 id；M622 起验收副本在构建期用独立 id（起跑预检断言产物
  // Info.plist 就是那个 id），点击应回到本副本；M619 的游离实例清退保留作纵深防御
  // （execute.mjs 的 clickNotification）。
  // `-W` 让 open 等 app 退出，仍有一个可观察的子进程；stdout / stderr 经 `--stdout/--stderr`
  // 落到文件，由下面的 pump 原样喂回 chunks（`LUMIR_READY` 就绪门不变）。
  // 窗口位置退回 tauri.conf 的构建值（本模式不写 `--config` 覆写）；首启的 `apply_startup_size`
  // 仍会让窗口落在屏内，`pinWindowSize` 照常钉尺寸。frontend 由 custom-protocol 从编译期嵌入的
  // dist 提供。配置隔离经 `--env XDG_CONFIG_HOME=…` 传递（launchd 启动的进程不继承本进程 env）。
  const appPath = bundle ? bundleAppPath() : null;
  let child;
  let launchLog = null;
  if (bundle) {
    if (!(await exists(appPath))) {
      throw new InfraError(
        `打包实例不存在：${appPath}——先 \`node scripts/acceptance/build-bundle.mjs\`（或改用 dev flavour：不设 LUMIR_ACCEPTANCE_BUNDLE）`,
      );
    }
    // 每次起实例都核一遍身份（M622）：预检已经拦过一次，这里保证「实际被拉起的这份 .app」就是
    // 带验收 id 的那份——不留「预检过了、但环境变量中途指向别的产物」的缝。
    assertAcceptanceBundleIdentity({ appPath });
    const launchDir = path.join(envHome(), "bundle-launch");
    await rm(launchDir, { recursive: true, force: true });
    await mkdirp(launchDir);
    const stamp = `${Date.now()}-${process.pid}`;
    const stdoutFile = path.join(launchDir, `${stamp}.out`);
    const stderrFile = path.join(launchDir, `${stamp}.err`);
    await rm(stdoutFile, { force: true });
    await rm(stderrFile, { force: true });
    launchLog = { stdoutFile, stderrFile, seen: new Map([[stdoutFile, 0], [stderrFile, 0]]) };
    child = spawn(
      "/usr/bin/open",
      [
        "-n",
        "-W",
        "--stdout",
        stdoutFile,
        "--stderr",
        stderrFile,
        "--env",
        `XDG_CONFIG_HOME=${envHome()}`,
        appPath,
      ],
      {
        cwd: root,
        detached: true, // open 自成进程组；app 由 launchd 拉起、另有自己的进程组（stopApp 按路径收）
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } else {
    child = spawn(
      "pnpm",
      ["tauri", "dev", "--config", JSON.stringify(config)],
      {
        cwd: root,
        detached: true, // 自成进程组：vite/cargo/app 一并收尸
        env: { ...process.env, XDG_CONFIG_HOME: envHome() },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  }

  let out = "";
  const chunks = [];
  const onChunk = (d) => {
    const s = stripAnsi(d.toString());
    chunks.push(s);
    out += s;
    if (logFile) {
      mkdirSync(path.dirname(logFile), { recursive: true });
      appendFileSync(logFile, s);
    }
  };
  child.stdout.on("data", onChunk);
  child.stderr.on("data", onChunk);

  // bundle 模式：把 app 的 stdout / stderr（open 重定向到文件）增量喂回同一套 chunks / logFile，
  // 就绪门与 app.log 的口径与 dev 模式一致。文件不存在（open 尚未创建）时跳过。
  let stopPump = false;
  if (launchLog) {
    const pump = async () => {
      for (const file of [launchLog.stdoutFile, launchLog.stderrFile]) {
        let text = "";
        try {
          text = await readText(file);
        } catch {
          continue;
        }
        const seen = launchLog.seen.get(file) ?? 0;
        if (text.length > seen) {
          onChunk(text.slice(seen));
          launchLog.seen.set(file, text.length);
        }
      }
    };
    void (async () => {
      while (!stopPump) {
        await pump();
        if (child.exitCode !== null) {
          await pump();
          break;
        }
        await sleep(400);
      }
    })();
  }

  const ready = (async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (/^LUMIR_READY /m.test(out)) return true;
      if (child.exitCode !== null)
        throw new InfraError(
          `${bundle ? "打包实例" : "pnpm tauri dev"} 提前退出（code=${child.exitCode}）：\n${out.slice(-2000)}`,
        );
      await sleep(500);
    }
    throw new InfraError(`等待 LUMIR_READY 超时（${timeoutMs}ms）：\n${out.slice(-2000)}`);
  })();

  let pid;
  try {
    await ready;
    // 打包模式：app 由 launchd 拉起（不是 open 的子进程），按**本次跑批自己的二进制路径**精确定位；
    // dev 模式的进程组里还有 pnpm/vite/cargo，需要等到组内出现 `target/debug/lumir`。
    pid = bundle ? await waitForBundlePid(bundle, 30_000) : await waitForPid(child.pid, 30_000);
    // 记下本次跑批自己的打包实例 pid（M622）：游离实例的归属按 pid 认，路径不足以区分同路径的第二份副本。
    if (bundle) ownBundlePid = pid;
  } catch (e) {
    // 启动失败也要把这一轮自己拉起的东西收干净：open / tauri 的进程组 + 精确匹配本 bundle 路径的
    // app 进程（不按 `.app` 通配，碰不到用户实例）。
    stopPump = true;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* 组已不在 */
    }
    if (bundle) {
      const strayPid = findBundleAppPid(bundle);
      if (strayPid !== null) {
        try {
          process.kill(strayPid, "SIGTERM");
        } catch {
          /* 已退出 */
        }
      }
    }
    throw e;
  }
  return {
    child,
    pid,
    flavour: bundle ? "bundle" : "dev",
    appPath,
    binary: bundle,
    launchLog,
    stopLogPump: () => {
      stopPump = true;
    },
    output: () => chunks.join(""),
  };
}

async function waitForPid(pgid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = findAppPid(pgid);
    if (pid) return pid;
    await sleep(300);
  }
  throw new InfraError("app 进程未找到（本进程组内的 target/debug/lumir）");
}

/** `etime`（`[[dd-]hh:]mm:ss`）→ 秒；解析不出返回 null（M619：游离实例的启动时刻判据）。 */
export function parseElapsedSeconds(text) {
  if (typeof text !== "string" || text === "") return null;
  let rest = text;
  let days = 0;
  const dayMatch = /^(\d+)-(.+)$/.exec(rest);
  if (dayMatch) {
    days = Number(dayMatch[1]);
    rest = dayMatch[2];
  }
  const parts = rest.split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isInteger(n) || n < 0)) return null;
  if (parts.length === 2) return days * 86_400 + parts[0] * 60 + parts[1];
  if (parts.length === 3) return days * 86_400 + parts[0] * 3_600 + parts[1] * 60 + parts[2];
  return null;
}

/**
 * 同机 Lumir 实例清单（M619：M478 起跑自检与游离实例清退的**单一实现**——此前扫描逻辑只在
 * run.mjs 的 `assertNoForeignLumir` 里，清退要用同一判据时不复制一份，见 REVIEW.md
 * 「同一语义两处真源」条）。
 *
 * 两类目标都按「这个进程自己就是要跑的那个二进制」判定，不做宽松子串匹配：
 *   - `bundle`：命令行以 `<某个>.app/Contents/MacOS/lumir` 结尾（安装版 / 套件自己的打包实例）；
 *   - `dev`：命令行以 `target/debug/lumir` 结尾（残留的开发实例）。
 * 再叠一条「可执行文件名必须是 `lumir`」（`ps -o comm=` 的 basename）——命令行里**提到**这个
 * 路径的进程不算实例（watchdog shell / `pkill -f …` 这类）。
 *
 * `startedAt` 由 `etime` 反推（毫秒；秒级精度），供清退时判「是不是本次点击拉起的」。
 * `exec` 可注入（自测用）：签名同 `spawnSyncText(cmd, args)`，返回 stdout 文本。
 */
export function listLumirInstances(exec = spawnSyncText) {
  const rows = exec("/bin/ps", ["-axo", "pid=,etime=,command="]).split("\n");
  const now = Date.now();
  const out = [];
  for (const row of rows) {
    const m = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(row);
    if (!m) continue;
    const pid = Number(m[1]);
    const cmd = m[3].trim();
    const isBundle = /\.app\/Contents\/MacOS\/lumir$/.test(cmd);
    const isDev = /(?:^|[\s/])target\/debug\/lumir$/.test(cmd);
    if (!isBundle && !isDev) continue;
    let comm = "";
    try {
      comm = exec("/bin/ps", ["-o", "comm=", "-p", String(pid)]).trim();
    } catch {
      continue; // 进程在这一瞬退出了
    }
    if (comm.split("/").pop() !== "lumir") continue;
    const elapsed = parseElapsedSeconds(m[2]);
    out.push({
      pid,
      cmd,
      kind: isBundle ? "bundle" : "dev",
      startedAt: elapsed === null ? null : now - elapsed * 1000,
    });
  }
  return out;
}

/** `binPath` 的两种字面（原样 / realpath）——`open` 经 launchd 启动时 `ps` 里可能是
 *  canonicalize 后的路径（macOS 的 `/tmp` → `/private/tmp`）。 */
function binaryPaths(binPath) {
  const set = new Set();
  if (!binPath) return set;
  set.add(path.resolve(binPath));
  try {
    set.add(realpathSync(binPath));
  } catch {
    /* 路径已不在：按字面匹配 */
  }
  return set;
}

/** 按**精确二进制路径**找本次跑批的打包实例 pid；找不到返回 null。 */
export function findBundleAppPid(binPath) {
  const wanted = binaryPaths(binPath);
  const hits = listLumirInstances().filter((i) => i.kind === "bundle" && wanted.has(i.cmd));
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.pid - a.pid);
  return hits[0].pid;
}

/**
 * 本次跑批自己的打包实例 pid（M622，游离实例归属的判据）：路径不足以区分同一个 `.app` 的第二份
 * 副本（LaunchServices / `open -n` 语义下会拉起同路径的另一个进程），pid 可以。`launchApp`
 * 成功拿到 pid 后置入、`stopApp` 收尾时清空；为空时退回「按本次二进制路径排除」（宁可不杀）。
 */
let ownBundlePid = null;

export function ownBundleInstancePid() {
  return ownBundlePid;
}

/** 这条 `.app` 实例是不是本次跑批自己的：优先按 pid 认，没有 pid 时按本副本的二进制路径排除。 */
export function isOwnBundleInstance(instance, { ownPid = ownBundlePid, ownBinary = bundleBinary() } = {}) {
  if (ownPid !== null && ownPid !== undefined) return instance.pid === ownPid;
  return binaryPaths(ownBinary).has(instance.cmd);
}

/** 场上**不属于本次跑批**的 `.app` 实例（M619：点击前的归因前置检查——点击前就在场的实例
 *  可能是用户自己打开的，之后新起的就不再能一律判给本次点击）。归属口径见 `isOwnBundleInstance`。 */
export function listOtherBundleInstances({ ownBinary = bundleBinary(), ownPid = ownBundlePid } = {}) {
  return listLumirInstances().filter(
    (i) => i.kind === "bundle" && !isOwnBundleInstance(i, { ownBinary, ownPid }),
  );
}

/**
 * 纯判据（M619 / M622，自测覆盖）：从实例清单里挑出「**本次点击窗口内新起、且不是本次跑批自己**」
 * 的 `.app` 实例。四条同时成立才返回：
 *   1. `kind === "bundle"`；2. 不是本次跑批自己的实例（pid 优先，见 `isOwnBundleInstance`）；
 *   3. 启动时刻可读；4. `startedAt >= sinceMs`（`sinceMs` 缺省时不按时刻过滤，只保留 1–3）。
 * 调用方在点击前已确认场上没有其他 bundle 实例，因此这里挑出来的只会是这次点击拉起的；启动
 * 时刻读不出的进程永远不动（无法归因）。
 */
export function straysInClickWindow(
  instances,
  { sinceMs, ownBinary = bundleBinary(), ownPid = ownBundlePid } = {},
) {
  return instances.filter(
    (i) =>
      i.kind === "bundle" &&
      !isOwnBundleInstance(i, { ownBinary, ownPid }) &&
      i.startedAt !== null &&
      (sinceMs === undefined || i.startedAt >= sinceMs),
  );
}

async function waitForBundlePid(binPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = findBundleAppPid(binPath);
    if (pid) return pid;
    await sleep(300);
  }
  throw new InfraError(
    `打包实例进程未找到（LaunchServices 已启动 .app 但 ps 里没有 ${binPath}；` +
      "检查是否被 gatekeeper / 签名问题挡住）",
  );
}

/**
 * 通知点击后的游离实例识别与清退（M619 引入；M622 独立 bundle id 落地后保留作**纵深防御**）。
 *
 * 判据（三条同时成立才动）：
 *   1. 是 `.app/Contents/MacOS/lumir` 实例；
 *   2. **不是**本次跑批自己的**实例**（`ownPid` 优先；pid 未知时按 `ownBinary` 路径排除）——独立
 *      id 下点击应激活本副本，但同一个 `.app` 若被拉起第二份副本，路径分不出它与被测实例，pid 能；
 *   3. `etime` 反推的启动时刻不早于 `sinceMs`（调用方传「点击开始前」的时刻）——跑批开始时
 *      M478 起跑自检已确认场上零实例，因此点击窗口内新起的 `.app` 实例只可能是这次点击拉起的。
 *
 * 对命中的实例先 SIGTERM、等 1s 仍在则 SIGKILL，并把 pid / 路径 / 启动时刻写进证据。**只动
 * 命中的这些 pid**，不按 `.app` 通配 kill——用户手头的安装版若在跑（跑批开始时已存在）不在窗口内，
 * 结构上不会被这条碰到；硬约束「不得干扰用户正在运行的实例」由此守住。
 */
export async function quiesceStrayBundleInstances({
  sinceMs,
  ownBinary = bundleBinary(),
  ownPid = ownBundlePid,
  evidence,
  action = "clickNotification",
  settleMs = 3_000,
} = {}) {
  const findStrays = () => straysInClickWindow(listLumirInstances(), { sinceMs, ownBinary, ownPid });
  // 点击拉起是异步的（M617 现场：AXPress 记录 21:55:25.89 → launchservicesd CHECKIN 21:55:25.99，
  // 相差约 100ms），立刻扫会漏；在 settleMs 内轮询，命中即停。
  const deadline = Date.now() + settleMs;
  let strays = findStrays();
  while (strays.length === 0 && Date.now() < deadline) {
    await sleep(250);
    strays = findStrays();
  }
  if (strays.length === 0) {
    evidence?.record({
      kind: "note",
      text: `${action} 后游离实例扫描：无（本次跑批自己的实例 pid ${ownPid ?? "未知"} 不计）`,
    });
    return [];
  }
  const cleaned = [];
  for (const p of strays) {
    const started = p.startedAt === null ? "启动时刻未知" : new Date(p.startedAt).toISOString();
    evidence?.record({
      kind: "note",
      text:
        `${action} 后检出点击窗口内新起的 bundle 实例：pid ${p.pid}（${p.cmd}，起于 ${started}）——` +
        "判定为本次跑批自己拉起的游离实例，清退（SIGTERM，1s 后仍在则 SIGKILL）",
    });
    let termSent = false;
    try {
      process.kill(p.pid, "SIGTERM");
      termSent = true;
    } catch {
      /* 已退出 */
    }
    await sleep(1_000);
    let alive = listLumirInstances().some((i) => i.pid === p.pid);
    if (alive) {
      try {
        process.kill(p.pid, "SIGKILL");
      } catch {
        /* 已退出 */
      }
      await sleep(500);
      alive = listLumirInstances().some((i) => i.pid === p.pid);
    }
    cleaned.push({ pid: p.pid, cmd: p.cmd, startedAt: p.startedAt, termSent, stillAlive: alive });
    evidence?.record({
      kind: "note",
      text: `游离实例清退${alive ? "失败（仍在场）" : "完成"}：pid ${p.pid}`,
    });
  }
  return cleaned;
}

/**
 * 停 app。
 * - dev：先整组 SIGTERM，再兜底 SIGKILL 残留（只在本次运行的进程组内）。
 * - bundle（M619）：app 由 launchd 启动、**不在本进程组里**，按本次跑批自己的二进制路径精确定位
 *   后再收；`open -W` 等待者单独收（它收到 SIGTERM 不会波及 app）。绝不按 `.app` 通配 kill
 *   ——安装版路径不同，结构上碰不到用户实例。
 */
export async function stopApp(handle) {
  if (!handle) return;
  handle.stopLogPump?.();
  if (handle.flavour === "bundle") {
    const killOwn = (signal) => {
      const pid = findBundleAppPid(handle.binary);
      if (pid === null) return false;
      try {
        process.kill(pid, signal);
        return true;
      } catch {
        return false;
      }
    };
    killOwn("SIGTERM");
    try {
      process.kill(-handle.child.pid, "SIGTERM");
    } catch {
      /* open 已退出 */
    }
    await sleep(2000);
    killOwn("SIGKILL");
    await sleep(500);
    // 撤销本次跑批经 `open` 写进 LaunchServices 的本副本记录（M619）：只按本 .app 路径撤销，
    // 同 id 的其他副本不受影响；不撤的话 worktree 副本会以验收 id 的身份留在 LS 数据库里，
    // 指向一个随后被清理的路径。
    if (handle.appPath) {
      try {
        spawnSyncText(LSREGISTER, ["-u", handle.appPath]);
      } catch {
        /* 未注册 / 系统已清理：无副作用 */
      }
    }
    // 本次实例已收（或已尽力收）：清掉 pid 归属，后续扫描不再把它当「自己」。
    ownBundlePid = null;
    return;
  }
  const pgid = handle?.child?.pid;
  if (pgid) {
    try {
      process.kill(-pgid, "SIGTERM");
    } catch {
      /* 组已不在 */
    }
  }
  await sleep(2000);
  const pid = findAppPid(pgid);
  if (pid) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* 已退出 */
    }
  }
  await sleep(500);
}

/** KimiCU 的 app 清单里确认 `pid` 就是本次跑批的验收副本（bundle id 从构建产物现读，M622）。
 *  dev flavour 没有 .app 身份可核，返回 false。 */
export async function cuSeesApp(cu, pid, { retries = 20, bundleId = acceptanceBundleId() } = {}) {
  if (!bundleId) return false;
  for (let i = 0; i < retries; i++) {
    const apps = await cu.listApps();
    if (apps.some((a) => a.pid === pid && a.bundle_id === bundleId)) return true;
    await sleep(500);
  }
  return false;
}

/** 护栏：验收 vault（含第二个）与配置目录都不得指向用户真实资产。 */
export function assertSafeTargets() {
  const v = vaultDir();
  if (v.startsWith("/Users/")) {
    throw new CuError(`拒绝：验收 vault 指向用户目录（${v}）；只允许 /tmp 下的合成 vault`);
  }
  const v2 = secondVaultDir();
  if (v2.startsWith("/Users/")) {
    throw new CuError(`拒绝：第二个验收 vault 指向用户目录（${v2}）；只允许 /tmp 下的合成 vault`);
  }
  const home = envHome();
  if (!home.includes(".local/acceptance/")) {
    throw new CuError(`拒绝：隔离配置目录不在 .local/acceptance 下（${home}）`);
  }
  return { vault: v, secondVault: v2, envHome: home };
}

/**
 * 回收端口：上一次运行崩溃留下的 vite/app 会占住 dev 端口，使本次启动直接失败。
 * 只回收**本 worktree** 的残留（命令行含 worktree 路径）；他人的服务一律报错不碰。
 */
export async function reclaimPort(port) {
  let pids = [];
  try {
    pids = spawnSyncText("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])
      .split("\n")
      .map((s) => Number(s.trim()))
      .filter(Boolean);
  } catch {
    return []; // lsof 无匹配时退出码非 0
  }
  const root = repoRoot();
  const killed = [];
  for (const pid of pids) {
    // 命令行可能是相对路径（vite/cargo 常这样起），按**工作目录**判定归属更可靠。
    let cwd = "";
    try {
      cwd = spawnSyncText("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).trim();
    } catch {
      /* 进程可能已退出 */
    }
    if (!cwd.includes(root)) {
      const row = spawnSyncText("/bin/ps", ["-o", "pgid=,command=", "-p", String(pid)]).trim();
      throw new CuError(
        `端口 ${port} 被非本 worktree 的进程占用（pid ${pid}，cwd=${cwd.replace(/^n/, "") || "未知"}）：${row}\n` +
          "请用 LUMIR_ACCEPTANCE_PORT 指定别的端口，或自行处理该进程。",
      );
    }
    const pgid = Number(spawnSyncText("/bin/ps", ["-o", "pgid=", "-p", String(pid)]).trim().split("\n")[0]);
    try {
      process.kill(-pgid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* 已退出 */
      }
    }
    killed.push(pid);
  }
  if (killed.length) await sleep(2000);
  return killed;
}
