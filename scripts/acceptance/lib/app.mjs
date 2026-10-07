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
import { appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { cp, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CuError } from "./cu.mjs";
import { envHome, exists, InfraError, log, mkdirp, readText, repoRoot, secondVaultDir, sleep, stripAnsi, vaultDir } from "./util.mjs";

export const BUNDLE_ID = "com.lumir.app";

export function acceptPort() {
  return Number(process.env.LUMIR_ACCEPTANCE_PORT ?? 1430);
}

export function fixturesDir() {
  return path.join(repoRoot(), "scripts/acceptance/fixtures");
}

/** 场景 front-matter `config:` 允许的键（M284）——**单点真源**：run.mjs 的折算（在起 app 之前
 *  写进隔离 config.json）与 execute.mjs 的静态校验（`--check`）共用这一份，免得两处漂移
 *  （REVIEW.md 第 8 条）。键名即 `writeConfig()` 的同名参数，**传了才写**、缺省走应用出厂口径。 */
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
  // `[editor]` 表整表透传（M379，backlog:1905）：snake_case 键写进 `editor` 表（`writeConfig`
  // 的同名参数），给「新增的 editor 配置项」构造**启动口径**用——不必每加一个键就回来改套件。
  // 形状校验见 execute.mjs 的 checkScenario（非表即报，避免静默丢半张表）。
  "editor",
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
  // `[editor]` 表**整表透传**（M379，backlog:1905）：snake_case 键原样并入 `editor` 表，写在具名
  // 参数**之前**——具名参数（mode / line_wrap / …）仍然优先，显式值不会被这张表吃掉。
  // 用途：场景 front-matter 的 `config: { editor: {…} }` 与 `configWrite` 动作的 `editor:` 都走它，
  // 于是「M180 这类新增的 editor 配置项」不必回来改套件就能构造启动口径。
  editor = undefined,
  // [harness] 节（M304，change add-harness-probe §11）：传了才写。形状：
  // { provider, fixture, permissions: { allow, deny }, loopMax, warnCtxPct, autoCompact,
  //   kimiModel, kimiModels }——
  // fixture 路径在场景加载期已被 token 替换为绝对路径（mock 脚本用 $fixtures 只读引用套件
  // fixtures 目录，不拷进 vault——拷进 vault 会留下非 .md 残留，串红场景 28/65 的
  // 「vault 里无 json/tmp 产物」断言）；$vault / $vault2 精确记号仍可经 resolveSeedPath 解析。
  harness = undefined,
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
  if (harness !== undefined) {
    const h = {};
    if (harness.provider !== undefined) h.provider = harness.provider;
    if (harness.fixture !== undefined) h.providers = { mock: { fixture: resolveSeedPath(harness.fixture) } };
    // M372（场景 99）：kimiModel 写了就构造 kimi provider 节（model + 占位 api_key）——
    // k3-256k 等自定义模型的能力判定（思考 chip 置灰判据）按 config 现算，不发消息就验得到；
    // 发消息的场景不会配这个键（真 api_key 不进验收环境）。
    if (harness.kimiModel !== undefined) h.providers = { kimi: { model: harness.kimiModel, api_key: "acceptance-dummy" } };
    // M373（场景 102）：schema 的 model 维度——逐项 { id, effort, window } 清单写进
    // providers.kimi.models（应用侧缺省 = 内置 preset；写了即整体覆盖，能力/窗口按声明现算）。
    if (harness.kimiModels !== undefined) {
      h.providers = h.providers ?? {};
      h.providers.kimi = { ...(h.providers.kimi ?? {}), models: harness.kimiModels };
    }
    if (harness.permissions !== undefined) h.permissions = harness.permissions;
    if (harness.loopMax !== undefined) h.loop_max = harness.loopMax;
    if (harness.warnCtxPct !== undefined) h.warn_ctx_pct = harness.warnCtxPct;
    if (harness.autoCompact !== undefined) h.auto_compact = harness.autoCompact;
    cfg.harness = h;
  }
  await writeFile(path.join(dir, "config.json"), `${JSON.stringify(cfg, null, 2)}\n`);
  return path.join(dir, "config.json");
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
 * 清空 harness（对话面板）的 JSONL 留存目录。
 * 为什么必须做：与 recovery 同因——JSONL 在**隔离配置目录**下（`env/lumir/harness/`），
 * 只重置 vault 会让上一场景的 tool_call / user_message 记录残留到本场景，file 断言
 * （尤其「decision=allow 在场」这类正观测）会读到别人的记录而假绿/假红。
 * 实证：M304 首轮 8 场景连跑，50 条记录全部串在一个文件里。
 */
export async function resetHarness() {
  const dir = path.join(envHome(), "lumir", "harness");
  await rm(dir, { recursive: true, force: true });
  return dir;
}

/** 把 vault 重置为 fixtures 的 `.md` 副本：清 vault 根下的 `.md` 与**目录**（合成 vault 的既有
 *  内容形态 + M221 起场景可经 vaultWrite 建嵌套路径——目录不跨场景残留）。
 *
 *  **已知缺口（canonical 居所，M296 登记）**：根下的**非 `.md` 产物**不被这次重置覆盖——场景
 *  `fixtures:` 带进来的 `.gitignore` / `.gitattributes` / `x.jsonc` / `notes.txt` / `huge.log`
 *  等等会留到后面的场景（实测：跑完一轮全量批之后 `/tmp/lumir-m102-acceptance` 里有 40+ 个这类
 *  文件）。它们在本套件里都**是惰性的**（依赖它们的场景各自用 `fixtures:` 重新拷一份），但新场景
 *  MUST NOT 依赖或假设这类残留存在；要判「某文件在场」就得自己声明 `fixtures:` 或用 `vaultWrite`
 *  造。清干净它不在本 mission 的改动面内（会牵动全部 69 个场景），已记进 `docs/backlog.md`。 */
export async function resetVault() {
  const vault = vaultDir();
  await mkdirp(vault);
  for (const name of await readdir(vault)) {
    if (name.endsWith(".md")) await rm(path.join(vault, name), { force: true });
    else if ((await stat(path.join(vault, name))).isDirectory()) await rm(path.join(vault, name), { recursive: true, force: true });
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

/** 内置规则命中族探针的正文（内容不重要——它 MUST NOT 被读到；条目数才是形状的一部分）。 */
const IGNORED_PROBE_MD = "# 构建产物探针\n\n这一条命中的是内置规则：不进枚举、不进树。\n";

/** 用户规则命中族探针的正文：**marker 是场景的判据**（`editor.has` 到它就证明惰性文件真的能读）。
 *  改这一句要同步场景 67 的 marker 断言。 */
const LAZY_PROBE_MD = "# 本地教程\n\n本地教程正文：这一篇被用户规则挡住，但行在树里、展开可见、打开可读。\n";

/** 生成「复刻真实形状」的批量 vault 内容（M283，change vault-switch-restore-perf 的 1.3）。
 *
 *  形状口径（M265 §一 在真实 vault 上实测的 scan-visible 规模）：**2142 文件 / 426 目录 /
 *  1341 个 md / 7.01MB md**、行长正常（~78 字符/行，含标题与 wikilink）、含一个
 *  `node_modules` 用于验证 `IGNORED_NAMES` 生效。收益：验收与读数都跑在**与 Alex 真实 vault
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
 *  - `ignoredDirs: { <根下目录名>: <该目录里的 md 条数> }` —— 内置规则的构建产物族探针。
 *    落在 vault **根**下（树的默认态就能判「这一行在不在」，不必先展开）；命中内置规则 ⇒
 *    这一行与它的子树都不进枚举、不进树。
 *  - `lazyDirs: { gitignore: [...], gitignoreNegations: [...], exclude: [...] }` —— 用户规则的探针。
 *    `gitignore` / `exclude` 是写在根 `.gitignore` / 根 `.git/info/exclude` 里的目录名（各带一个
 *    `tutorial.md`）；`gitignoreNegations` 是追加到根 `.gitignore` 的取反行，用来在真机上也留一条
 *    「用户规则的取反不能推翻内置规则」的判据（§2.6：内置先判且命中即定格）。
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
  // 忽略生效的探针：`node_modules` 下的 md MUST NOT 进枚举（Rust 侧 IGNORED_NAMES）。
  const nm = path.join(vault, "node_modules", "left-pad");
  await mkdirp(nm);
  for (let i = 0; i < ignoredMd; i += 1) {
    await writeFile(path.join(nm, `ignored-${String(i).padStart(2, "0")}.md`), body(2_000));
  }
  // ── 两类忽略探针（可选，见函数头的说明）─────────────────────────────────────────────
  // 内置规则命中族：根下的构建产物目录，每个目录里放 N 个 md。**条数给的是量级，不是判据**：
  // 判据只有「这一行在不在树里」（`target` / `dist` / `test-results` 是内置表里的名字）。
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
    // 取反行追加在忽略行之后（gitignore 的口径：后行者胜）——真机上要证的正是「它对内置规则无效」。
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

/**
 * 清空按 vault 的标签会话（隔离配置目录下的 `vault-sessions/`）。
 * 为什么必须做：会话决定「装载完 vault 后恢复哪些标签」，残留会让本场景的启动恢复出上一场景
 * 的标签（08c 曾因 recovery 残留恢复出 keys.md 的内容——同族）。
 */
export async function resetSessions() {
  const dir = path.join(envHome(), "lumir", "vault-sessions");
  await rm(dir, { recursive: true, force: true });
  return dir;
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
 *  非法 `active` 一律按「退化到第一个可打开标签」处理（`vault_session::sanitize` 同口径）。 */
export async function writeSession({ id, tabs, active = null, panes = null, ratio = null, harnessPane = false }) {
  if (!ID_RE.test(id ?? "")) throw new CuError(`会话 id 非法：${JSON.stringify(id)}（只允许字母数字与 -_）`);
  const dir = await mkdirp(path.join(envHome(), "lumir", "vault-sessions"));
  // `harness_pane`（M349）：v2 会话里记「harness 面板在场」的持久位（ADR 0008 Decision 6 的
  // Phase 2 消费位）。恢复时它决定旁侧 pane 是否重新装配成 harness（会话内容不持久化，恢复出
  // 空会话）。旧版 v2 文件无此字段时 Rust 读取侧按 false——这里缺省同为 false。
  const payload = panes
    ? { version: 2, panes, harness_pane: Boolean(harnessPane), pane_split_ratio: ratio ?? 0.5, updated_at: Date.now() }
    : { version: 1, tabs, active, updated_at: Date.now() };
  await writeFile(path.join(dir, `${id}.json`), `${JSON.stringify(payload, null, 2)}\n`);
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
  const written = { registry: [], legacyRegistry: [], sessions: [], bulkVault: null };
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
  return written;
}

export async function copyFixture(name) {
  await cp(path.join(fixturesDir(), name), path.join(vaultDir(), name));
  return path.join(vaultDir(), name);
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
 * **窗口对象必须从仓库 tauri.conf.json 读原件再叠位置**（M236 修 backlog:366）：tauri 的
 * `--config` 是深合并，但**数组按下标整体替换**——`app.windows[0]` 会被这里传的对象整根替掉。
 * 早先的写法是在这里手抄 title/width/height（+注释提醒「改那边要同步这里」），结果
 * `titleBarStyle: "Overlay"` 与 `hiddenTitle: true` 被**静默**吃掉：套件实例长出原生标题栏
 * （窗口多一行、webview 让出 32pt），而这个丢配置一点报错都没有——任何「真机验证窗口级配置」
 * 的断言在套件里都验不到（M213 实测对照见 `test-results/m213/titlebar/readings.md` §4）。
 * 现在改成从 `src-tauri/tauri.conf.json` 读 `app.windows[0]` 再 spread：窗口配置只有一份真源
 * （REVIEW.md 第 8 条），新增窗口级键不会再漏。读不到就抛错，**不回落手抄一份**（静默降级回来
 * 就是同一个坑）。运行期自检见 `drive.mjs` 的 assertOverlayChrome（waitAppReady 内）。
 */
export async function launchApp({ port = acceptPort(), timeoutMs = 300_000, logFile } = {}) {
  const root = repoRoot();
  const conf = JSON.parse(await readText(path.join(root, "src-tauri", "tauri.conf.json")));
  const baseWindow = conf.app?.windows?.[0];
  if (!baseWindow) {
    throw new Error(
      "launchApp：src-tauri/tauri.conf.json 里没有 app.windows[0]，无法构造 --config 覆写" +
        "（拒绝在这里手抄一份窗口配置——那正是 backlog:366 的成因）。",
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
  const child = spawn(
    "pnpm",
    ["tauri", "dev", "--config", JSON.stringify(config)],
    {
      cwd: root,
      detached: true, // 自成进程组：vite/cargo/app 一并收尸
      env: { ...process.env, XDG_CONFIG_HOME: envHome() },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

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

  const ready = (async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (/^LUMIR_READY /m.test(out)) return true;
      if (child.exitCode !== null)
        throw new InfraError(`pnpm tauri dev 提前退出（code=${child.exitCode}）：\n${out.slice(-2000)}`);
      await sleep(500);
    }
    throw new InfraError(`等待 LUMIR_READY 超时（${timeoutMs}ms）：\n${out.slice(-2000)}`);
  })();

  await ready;
  const pid = await waitForPid(child.pid, 30_000);
  return { child, pid, output: () => chunks.join("") };
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

/** 停 app：先整组 SIGTERM，再兜底 SIGKILL 残留（只在本次运行的进程组内）。 */
export async function stopApp(handle) {
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

export async function cuSeesApp(cu, pid, { retries = 20 } = {}) {
  for (let i = 0; i < retries; i++) {
    const apps = await cu.listApps();
    if (apps.some((a) => a.pid === pid && a.bundle_id === BUNDLE_ID)) return true;
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
  if (!home.includes("test-results/acceptance/")) {
    throw new CuError(`拒绝：隔离配置目录不在 test-results/acceptance 下（${home}）`);
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
