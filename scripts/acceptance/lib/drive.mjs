// 驱动层：把 KimiCU 的原始工具封装成验收可用的确定性动作。
//
// 三条经验（都是实测踩出来的，改这些封装前先确认仍成立）：
//   1. AX 树里 AXTextArea 的 value 就是整个文档文本（含未渲染的源码）——内容断言的主要来源；
//      它的 value 是多行字符串，解析时必须按引号是否闭合来吞行（见 lib/ax.mjs）。
//   2. LUMIR_READY 只说明进程起来了，前端的文件树/编辑器可能还没就绪；一切动作前先 settle。
//   3. KimiCU 的 type_text 传 index 时会先在后台做一次真实点击建立渲染层焦点——编辑器失焦时
//      直接注入会落到陈旧选区，所以输入一律带 index。
import { execFileSync } from "node:child_process";
import { findNode, mainWindowPlan, parseNodes, windowDirectory, windowTitle } from "./ax.mjs";
import { InfraError, sleep } from "./util.mjs";

export class StepError extends Error {}

export async function waitUntil(fn, { timeoutMs = 15_000, everyMs = 400, label = "条件" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(everyMs);
  }
  throw new StepError(`等待「${label}」超时（${timeoutMs}ms）`);
}

/** 读一次 AX。mode=full 附带截图（证据用），ax 更省。
 *
 *  **多窗口时钉主窗**（M761，112 的现场）：KimiCU 把树作用在 primary 窗口上；屏幕上多出一扇辅助窗
 *  （112 现场是 66×20 的 `AXDialog "Window"`= 窗口共享会话控件）抢走 primary 之后，整棵树被截在它
 *  身上（18 个节点、没有主窗的按钮行），场景的节点断言因此判红，而产品当时完全正常。`mainWindowPlan`
 *  判出「树不在主窗上」时，这里用 `window_id` 重读主窗，并核对重读的结果**真的是那扇窗**：
 *    - 重读后 `[primary]` 仍是别的窗 ⇒ KimiCU 没按 window_id 取树；
 *    - `window_title` 与目录里那扇窗的标题不符 ⇒ 钉窗未生效 / 两次读取之间换了窗。
 *  两种都抛 `InfraError`（环境项，整场 INVALID），**不返回辅助窗口的树**。主窗不可判定（多窗口但
 *  没有唯一的 `AXStandardWindow`）同样抛 `InfraError`：此时「读到的节点」≠「界面就是这些」，拿它
 *  判红 / 判绿都是假读数（REVIEW.md「读不到当成空」条）。 */
export async function readAx(cu, pid, { mode = "ax" } = {}) {
  let snap = await cu.state(pid, { mode });
  const plan = mainWindowPlan(snap.text);
  if (plan.error) {
    throw new InfraError(`读取 AX 时无法判定主窗口（不退回 KimiCU 的 primary 选择）：${plan.error}`);
  }
  if (plan.pin) snap = await pinMainWindow(cu, pid, mode, plan.pin);
  const nodes = parseNodes(snap.text);
  const textarea = nodes.find((n) => n.role === "AXTextArea") ?? null;
  return { text: snap.text, image: snap.image ?? null, nodes, textarea, editor: textarea?.value ?? null };
}

/** 按 `window_id` 重读主窗并核对重读结果（判据见 `readAx` 的注释）。 */
async function pinMainWindow(cu, pid, mode, target) {
  const pinned = await cu.state(pid, { mode, windowId: target.windowId });
  const primary = windowDirectory(pinned.text)?.entries.find((e) => e.marker === "primary");
  if (primary && primary.windowId !== target.windowId) {
    throw new InfraError(
      `转发 window_id=${target.windowId} 后 AX 树仍作用在窗口 ${primary.windowId}（${primary.role}）上：` +
        "KimiCU 没按 window_id 取树，读到的主窗树不可信",
    );
  }
  const title = windowTitle(pinned.text);
  if (title !== null && target.title !== null && title !== target.title) {
    throw new InfraError(
      `转发 window_id=${target.windowId} 后读到的 window_title 是 ${JSON.stringify(title)}，` +
        `而 windows 目录里该窗的标题是 ${JSON.stringify(target.title)}：钉窗未生效，或两次读取之间换了窗`,
    );
  }
  return pinned;
}

/**
 * 快照**正文**：剥掉 KimiCU 快照的**产物 id** 两行，其余逐字节保留（M759 的单一真源）。
 *
 * 为什么必须剥（2026-10-27 调查 `.local/reports/settle-stability-oct27/README.md`）：M751 让
 * `CuClient.state` 每次请求都带 `disable_diff: true`（取全树，防空 diff 假绿），副作用是 KimiCU
 * **每次调用都新建快照**——首行的 `AX snapshot_id=<UUID>` 每次读都换（mode=full 另有末行
 * `Screenshot: … screenshot_id=…`）。`settle()` 原先比较整份原文，于是「连续两次一致」永远不
 * 成立：post-M751 观察到的 25 次 settle 执行全部 15s 超时（全仓 129 个 settle 步骤，最坏白等约
 * 32 分钟），连 47b 的静态启动屏（无文档、无异步在途）都超时——这不是界面还在变。
 *
 * 剥掉的是**本次抓取的句柄**（UUID），不承载任何界面状态；节点行、`[N]` 索引、bbox、
 * `(focused)`、`element_count`、`truncated`、窗口矩形（`captured_bounds` / `window_bounds`）等正文
 * 仍逐字节比较——断言没有放宽，只是不再把「换了个句柄」当成界面变化。确定性证据：全仓 3001 份
 * dump 里存在整份逐字节相同的对（含 id 行），且剥 id 后 post-M751 的正文相同对大量出现（调查报告 §1/§2）。
 *
 * 只剥**行首**这两类元数据行：正文 / 节点 value 里出现的同名子串（例如文档恰好写了这串）不受
 * 影响。`settle*` 返回的仍是**原始** `ax`——证据 dump 与 `ax.has` 断言继续看原文。
 */
export function snapshotBody(text) {
  return text
    .split("\n")
    .filter((line) => !/^AX snapshot_id=/.test(line) && !/^Screenshot: .*screenshot_id=/.test(line))
    .join("\n");
}

/** 等界面稳定：连续两次 AX **快照正文**一致（产物 id 行除外，见 `snapshotBody`），且编辑器节点已就位。 */
export async function settle(cu, pid, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let prev = null;
  while (Date.now() < deadline) {
    const ax = await readAx(cu, pid);
    if (prev && snapshotBody(prev.text) === snapshotBody(ax.text) && ax.textarea) return ax;
    prev = ax;
    await sleep(700);
  }
  throw new StepError(`界面在 ${timeoutMs}ms 内未稳定`);
}

/**
 * 前端就绪门：等左栏文件树 + 编辑器节点就位。
 * 不用「整棵 AX 文本两次一致」——编辑器有光标/渲染时序，树会持续微抖，会假超时。
 *
 * 三种合法终态（M164 补第三种）：
 *   1. 已装载 vault 且有文件行 + 编辑器可读（严格门的默认形态）；
 *   2. 已装载 vault 但一个标签都没恢复 → D107 的空 vault 引导盖住正文，编辑器从 AX 消失。
 *      这是**启动常态**（该 vault 还没有会话历史），不是异常——判据是「树头部入口在 + 引导
 *      文案在」，两者都是正观测；
 *   3. 未打开 vault 的空态（D5/D6）——只有 `requireVault: false` 才认（见下）。
 *
 * `requireVault: false`（M159 起，只给「本步期待未打开空态」的场景用）：启动恢复移出主线程
 * 后，`last_vault` 失效 / 无 `last_vault` 时前端**合法地**停在未打开空态（树 pane 里没有
 * `.ft-row`，只有空态的「打开 vault」入口），严格门那条「树里有 .md 行」永远不成立。放宽后
 * 判据是「树 pane 呈现了任一种形态 + 编辑器节点在位」，终态仍由场景自己的断言证明
 * ——不得作为默认口径（默认仍是严格门，见 run.mjs 的 ctx.restartApp）。
 */
/**
 * **语言无关的就绪判据**（M282，change ui-language-i18n）：产品默认语言已裁为 `en`，而这里的
 * 判据原来是写死的中文措辞（D96 / D5 / D6 / D107）——语言一变，套件在**启动就超时**（实测：
 * 场景 55 在默认 en 下 30s 未就绪）。因此四组措辞各接受两档：判据的意图是「那个入口在场」，
 * 不是「它是中文的」；语言的判定归场景自己的断言（`ax: { has: ... }` 按文案表取值）。
 * 措辞逐字取自 `src/copy-data.ts` 的 zh / en 列（同一份真源，改文案时这里会一起红）。
 * 界面语言由套件钉住（run.mjs 的 `SUITE_LANGUAGE`，M284），见 README 的「语言面」节——
 * 这里的判据接受两档是**为了就绪门与语言面解耦**：门判「那个入口在场」，语言面的判定归场景断言。
 */
const LANG_PATTERNS = {
  header: /点击查看全部 vault|click to see all vaults/,
  emptyHint: /打开一个目录作为 vault|Open a folder as a vault/,
  openVault: /打开 vault|Open vault/,
  emptyVault: /这个 vault 还没有打开的文件|No files opened in this vault yet/,
};

export async function waitAppReady(cu, pid, { timeoutMs = 30_000, requireVault = true } = {}) {
  let seen = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ax = await readAx(cu, pid);
    // 树头部入口（形态 A，M163）：入口是 vault 名称本身，读屏名取 D96 的
    // 「vault：{名称}（点击查看全部 vault）」——旧的「切换 vault」按钮已随形态 A 退场。
    // **角色不写死**：入口带 `aria-haspopup="listbox"`，WKWebView 因此把它映射成
    // `AXPopUpButton` 而不是 `AXButton`（2026-09-17 实测：写死 role 会让整个套件在启动就
    // 超时——判据里真正有区分度的是那句读屏名，它只可能来自入口）。
    const hasHeader = findNode(ax.nodes, { name: LANG_PATTERNS.header }) !== null;
    const hasFiles = ax.nodes.some((n) => n.role === "AXButton" && /\.md$/.test(n.title ?? ""));
    // 未打开空态在 AX 里的稳定标志：空态说明行 + 「打开 vault」入口（D5/D6 的文案）。
    const hasEmptyState = LANG_PATTERNS.emptyHint.test(ax.text) && LANG_PATTERNS.openVault.test(ax.text);
    // **已装载 vault 但一个标签都没恢复**（M163 的「空 vault 首入态」）：树头部入口与文件行
    // 都在，但 D107 的引导层盖住正文、编辑器随之从 AX 里消失。这是启动的**常态**（该 vault
    // 还没有会话历史），严格门必须认它——否则每个场景都会在这一步超时。
    const hasEmptyVaultNotice = LANG_PATTERNS.emptyVault.test(ax.text);
    const treeReady = hasHeader && (hasFiles || hasEmptyVaultNotice)
      ? true
      : !requireVault && hasEmptyState;
    // 编辑器就位 = AXTextArea 可读，**或**上面那条空态引导正在覆盖它。后者是**正**判据
    // （引导文案必须真的在 AX 里），不是「读不到就当就绪」——REVIEW.md 「读不到当成空」条禁的是后者。
    const editorReady = ax.textarea !== null || hasEmptyVaultNotice;
    if (treeReady && editorReady) seen += 1;
    else seen = 0;
    if (seen >= 2) {
      await sleep(600);
      const final = await readAx(cu, pid);
      // 窗口形态自检（M236，窗口配置只有一份真源，见 REVIEW.md 「同一语义两处真源」条）：每次启动（含 restartApp 重启）都反查一次
      // 「webview 铺满整窗 = overlay 标题栏」，不让套件静默跑在非 overlay 形态上。
      assertOverlayChrome(final);
      return final;
    }
    await sleep(700);
  }
  throw new InfraError(
    `前端在 ${timeoutMs}ms 内未就绪（左栏文件树/编辑器节点未出现${requireVault ? "" : "；本步已放宽为允许未打开空态"}）`,
  );
}

/**
 * 套件实例的窗口形态自检（M236，窗口配置只有一份真源，见 REVIEW.md 「同一语义两处真源」条）：断言 webview **铺满整窗** = 真·overlay 标题栏。
 *
 * 为什么需要它：套件走 `--config` 覆写窗口对象，而 tauri 的深合并对数组是**按下标整体替换**。
 * 早先覆写对象漏抄 `titleBarStyle: "Overlay"` / `hiddenTitle: true`，套件实例因此长出原生
 * 标题栏（窗口多一行、webview 让出 32pt、屏幕上出现窗口标题「Lumir」），**且全程无报错**——
 * 任何「真机验证窗口级配置」的断言在套件里都验不到（M213 实测对照：
 * `.local/missions/m213/titlebar/readings.md` §4）。配置侧的修法在 app.mjs 的 launchApp
 * （从 tauri.conf.json 读原件再 spread）；这里补的是**运行期反查**：万一将来又漏，本自检报红，
 * 不留给「断言静默验到非 overlay 形态」这条路。
 *
 * 判据（用同一份 AX 文本里的两个节点，都带 bbox，单位一致）：
 *   - overlay：`AXScrollArea @0,0 1200×800`，与 `AXWindow @0,0 1200×800` 重合；
 *   - 原生标题栏：`AXScrollArea @0,31 1200×768`（顶边下移、高度少一截）。
 * 取**面积最大**的 AXScrollArea（树 pane / 浮层里可能还有别的滚动区，第一个不一定是我们这层），
 * 判据是「顶边对齐且高度不短」——容差 4px，吸收亚像素与窗口装饰的舍入。
 *
 * 读不到节点 / 没有 bbox 一律报错，不静默通过（REVIEW.md 「读不到当成空」条：不可读 ≠ 没问题）。
 */
function assertOverlayChrome(ax) {
  const win = ax.nodes.find((n) => n.role === "AXWindow" && n.bbox);
  const areas = ax.nodes.filter((n) => n.role === "AXScrollArea" && n.bbox);
  if (!win) throw new InfraError("窗口形态自检：AX 里读不到带 bbox 的 AXWindow（AX 快照退化）");
  if (areas.length === 0) throw new InfraError("窗口形态自检：AX 里读不到带 bbox 的 AXScrollArea（webview 容器缺失）");
  const area = areas.reduce((a, b) => (a.bbox.w * a.bbox.h >= b.bbox.w * b.bbox.h ? a : b));
  const topGap = area.bbox.y - win.bbox.y;
  const heightGap = win.bbox.h - area.bbox.h;
  if (topGap > 4 || heightGap > 4) {
    throw new InfraError(
      `窗口形态自检（窗口配置只有一份真源，见 REVIEW.md 「同一语义两处真源」条）：webview 没有铺满窗口——AXWindow ${win.bbox.w}×${win.bbox.h} @${win.bbox.y}` +
        `，最大 AXScrollArea ${area.bbox.w}×${area.bbox.h} @${area.bbox.y}（顶边差 ${topGap}、高度差 ${heightGap}）。` +
        `这是「原生标题栏回来了」的信号：套件的 --config 覆写把 app.windows[0] 整根替换、` +
        `titleBarStyle/hiddenTitle 被静默吃掉。修法见 lib/app.mjs 的 launchApp（从 tauri.conf.json 读原件再 spread）。` +
        `本自检存在的意义就是不让它静默——断言在非 overlay 形态下验不到真东西。`,
    );
  }
}

/** 标签条里已建壳的标签数（M516）：把每个 `AXTabGroup` 子树里的 `AXRadioButton` 数加起来。
 *
 *  用结构判据而不是场景断言的读屏名「关闭 <名>」：那串文案随语言面漂（与 `waitAppReady` 的
 *  LANG_PATTERNS 同因），而「标签 = AXTabGroup 下的 AXRadioButton」是 dump 上复核过的结构事实
 *  ——M511 的 49 号证据（`.local/acceptance/2026-10-14-m511/`）里，43 个标签的那份 dump
 *  恰 43 个 AXRadioButton，空 vault（B 侧）的 dump 里 0 个；本仓库里 AXRadioButton 的 label
 *  也全是标签名（2026-10-14-full 全量 dump 复核）。
 *
 *  **逐组求和**而不是只看第一组：分栏场景两个 pane 各有一条标签条（场景 80 实测两组
 *  `AXTabGroup (打开的文档)`），只看第一组会把读数报小——`> 0` 的判据不受影响，但证据行里的
 *  数字会与场景自己的标签数断言对不上。子树边界按 `depth` 取。
 *
 *  读不到 `AXTabGroup` 返回 0（与「0 个标签」同形）——唯一的调用方 `waitStartupRestore` 判的
 *  是「> 0」，两种情形在它的判据里等价（都表示「恢复段还没落地」）。 */
export function restoredTabCount(nodes) {
  let count = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i].role !== "AXTabGroup") continue;
    const depth = nodes[i].depth;
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (nodes[j].depth <= depth) break;
      if (nodes[j].role === "AXRadioButton") count += 1;
    }
  }
  return count;
}

/** 等**启动会话恢复**跑完：标签条出现标签且读数不变（M516）。
 *
 *  **它挡的是什么**：套件在就绪门之后要经 AXSize **写**窗口尺寸（M491 的钉尺寸），而产品在
 *  就绪门那一刻的启动还没走完——`applyVault`（`src/main.ts:2769-2840`）先
 *  `emitReadiness("vault-ready")`（`:2792`）与 `tree.setVault`（`:2813`）**再**起
 *  `void switcher.onVaultLoaded(...)`（`:2836`）的会话恢复段，恢复段的批量存在探测
 *  （`vault-switcher.ts:592-598` 的 `fs_paths_exist`）与建壳都在这一段里。窗口写落进别人
 *  的启动段里是实打实的排序隐患，本门把它排开：恢复段跑完再碰窗口。
 *
 *  **门的位置不能前移到 `vault-ready` / vault 入口节点**：那两个信号都在恢复段**之前**出现
 *  （同上一段），按它们放行等于没等。本门等的是恢复段自己的终态——壳是**同一帧**批量建出来
 *  的（`vault-switcher.ts` 的 `plans` 之后同步建壳，M283 起「所有标签一次回来」就是这条
 *  契约），标签数是 0 → N 的跳变、没有中间态；读到 `> 0` 再确认一次不变，即证明恢复段已越过
 *  那次探测。超时**不抛错**（返回 `settled: false` + 最后读数）：恢复为空或产品真丢了标签时，
 *  判定权在场景自己的断言，不在这里发明失败类别。
 *
 *  **边界（M516 实测，写进证据以免后人重走）**：本门**不是** 场景 49「3 个非 md 标签丢失」
 *  的修复——那次丢标签的真因是套件把场景 fixture 拷进 vault 的时机晚于 app 启动（见 run.mjs
 *  起 app 之前那一句），与 AX 活动无关：M516 的对照实验（启动后 10s 内**零** AX 活动）同一
 *  vault 同样丢成 43/46。这里的排序门照留——钉窗是写、恢复段是别人的启动流程，顺序本来就该
 *  是这样，顺带把「恢复出多少标签」记进证据行。 */
export async function waitStartupRestore(cu, pid, { timeoutMs = 15_000, everyMs = 400 } = {}) {
  const started = Date.now();
  const deadline = started + timeoutMs;
  let prev = -1;
  for (;;) {
    const ax = await readAx(cu, pid);
    const tabs = restoredTabCount(ax.nodes);
    if (tabs > 0 && tabs === prev) return { tabs, settled: true, ms: Date.now() - started };
    prev = tabs;
    if (Date.now() >= deadline) return { tabs, settled: false, ms: Date.now() - started };
    await sleep(everyMs);
  }
}

export async function clickNode(cu, pid, { role, name, nth = 0, needNode = true }) {
  const ax = await readAx(cu, pid);
  const node = findNode(ax.nodes, { role, name, nth });
  if (!node) {
    if (!needNode) return null;
    throw new StepError(`AX 中找不到节点 role=${role} name=${name}（第 ${nth} 个）`);
  }
  const { json } = await cu.click(pid, { index: node.index });
  return { node, result: json };
}

export async function clickAt(cu, pid, { x, y }) {
  const { json } = await cu.click(pid, { x, y });
  return json;
}

/**
 * 打开 vault 里的文件：点左栏文件名按钮 → 等编辑器出现该文件的期望内容。
 * expect 默认取文件名去掉扩展名不可靠，故调用方显式给 marker（通常取文件首行标题）。
 */
export async function openFile(cu, pid, name, { marker, timeoutMs = 60_000 } = {}) {
  const button = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  await waitUntil(async () => findNode((await readAx(cu, pid)).nodes, { role: "AXButton", name: button }), {
    timeoutMs,
    label: `左栏出现 ${name}`,
  });
  await clickNode(cu, pid, { role: "AXButton", name: button });
  if (!marker) return;
  await sleep(2000); // 点完立刻连读容易拿到打开前的快照，先让界面落定
  const needleRe = marker instanceof RegExp ? marker : new RegExp(marker);
  await waitUntil(
    async () => {
      const ax = await readAx(cu, pid);
      return ax.editor && needleRe.test(ax.editor);
    },
    { timeoutMs, label: `${name} 内容进入编辑器`, everyMs: 800 },
  );
}

/** 当前前台 app 的 pid（lsappinfo）；取不到返回 null。 */
export function frontmostPid() {
  try {
    const asn = execFileSync("/usr/bin/lsappinfo", ["front"], { encoding: "utf8" }).trim();
    const out = execFileSync("/usr/bin/lsappinfo", ["info", "-only", "pid", asn], { encoding: "utf8" });
    const m = /"pid"=(\d+)/.exec(out);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** 前台 pid 的可读化（`85818（Safari）`）——M478：诊断「前台被谁占着」时人要的是这个名字，
 *  只留一个 pid 数字的证据几乎不可读。进程已退出 / 读不到时退回纯 pid。 */
export function frontmostLabel(pid = frontmostPid()) {
  if (pid === null || pid === undefined) return "未知";
  try {
    const comm = execFileSync("/bin/ps", ["-o", "comm=", "-p", String(pid)], { encoding: "utf8" }).trim();
    const name = comm.split("/").filter(Boolean).pop();
    if (name) return `${pid}（${name}）`;
  } catch {
    /* 进程可能刚退出：退回纯 pid */
  }
  return String(pid);
}

/** 激活手段 → 证据里的措辞（同一张表，`foregroundNote` 与各动作的错误消息共用）。 */
const METHOD_LABEL = {
  "already-frontmost": "启动即在前台（无需激活）",
  AXRaise: "AXRaise",
  "SystemEvents.frontmost": "System Events set frontmost",
};

/**
 * System Events `set frontmost`（按 unix id）——M478 加的第二条抢前台通道。
 *
 * 为什么必须有它：套件此前唯一的手段是 `AXRaise`，而它**本就抢不动**（M135 r2 实测：用户在用
 * 别的 app 时 AXRaise 之后前台 pid 仍是别人的进程）。历史批次全绿靠的是「app 启动时 macOS
 * 自动置前」这个外部条件，而 `1184a17` 把窗口改成 `visible: false` 创建、在 `apply_startup_size`
 * 里延迟 `show()`（`src-tauri/src/lib.rs:160,245-247,295`）之后，`show()` 不激活 app；dev 实例
 * 又是 cargo 直接 exec（不走 LaunchServices，没有启动激活）⇒ **启动零激活**。于是无人在场的
 * 跑批整轮前台归属都在别的 app 手里（2026-10-13 复跑实证：全程 frontmost = Safari pid 85818，
 * 每条 FAIL 都挂着「需先排除 frontmost-required」的警示）。
 *
 * 与 AXPress 类动作不同，这条通道是**真的把 app 提到前台**——会打断用户当前的操作。套件跑批
 * 期间本就会把 Lumir 提到前台（README「键盘场景的前台纪律」已写明这条副作用），故代价可接受。
 *
 * 返回值是尝试记录 `{ method, ok, ms, detail }`：失败时 `detail` 带上 osascript 的 **stderr**
 * ——2026-10-13 那次外挂看门狗把 osascript 的输出吞进了 /dev/null，事后只剩「激活始终未生效」
 * 这一句无从归因的观察。结论无论如何都要落进证据，不许再吞。
 */
export function activateViaSystemEvents(pid) {
  const startedAt = Date.now();
  const script = `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`;
  try {
    const out = execFileSync("/usr/bin/osascript", ["-e", script], { encoding: "utf8", timeout: 10_000 }).trim();
    return { method: "SystemEvents.frontmost", ok: true, ms: Date.now() - startedAt, detail: out || "osascript 退出码 0" };
  } catch (e) {
    // execFileSync 把子进程 stderr 收在 e.stderr（本文件的用法不重定向 stdio），这正是要留的东西。
    const stderr = String(e.stderr ?? "").trim().replace(/\s+/g, " ");
    return {
      method: "SystemEvents.frontmost",
      ok: false,
      ms: Date.now() - startedAt,
      detail: `osascript 退出码 ${e.status ?? "?"}${stderr ? `：${stderr}` : `：${e.message}`}`,
    };
  }
}

/** 激活尝试（成功与失败都算）的可读摘要——`foregroundNote` 与动作的错误消息共用一份措辞。 */
export function foregroundWhy(fg) {
  return (fg?.attempts ?? [])
    .filter((a) => a.method !== "already-frontmost")
    .map(
      (a) =>
        `${METHOD_LABEL[a.method] ?? a.method} ${a.ok ? "已投递但前台未改变" : "失败"}` +
        `${a.detail ? `（${a.detail}）` : ""}`,
    )
    .join("；");
}

/** 抢前台的尝试记录 → 证据里的那一行（steps.md 的「前台焦点」行）。
 *
 *  M478 的动因：此前只有成功那一句「已取得」，失败也只写「未取得」+ 前台 pid——用了哪种手段、
 *  为什么失败一概不留，复盘时无法归因（2026-10-13 的看门狗把 osascript 的 stderr 吞了，整轮
 *  只能看出「激活没生效」）。现在两条路径都把手段与失败原因写进证据。
 *  **格式约束（下游按子串匹配，改文案要一起改）**：成功行含 `前台焦点：已取得`，失败行含
 *  `未取得`——`execute.mjs` 的收尾警示（frontmost-required 提醒）与 README 的解读口径都按这两个
 *  子串走。 */
export function foregroundNote(fg, { prefix = "前台焦点" } = {}) {
  const tries = (fg?.attempts ?? []).filter((a) => a.method !== "already-frontmost");
  if (fg?.frontmost) {
    const failed = tries.filter((a) => !a.ok).length;
    const by = METHOD_LABEL[fg.method] ?? fg.method ?? "未知手段";
    return `${prefix}：已取得（手段：${by}${failed ? `；此前 ${failed} 次尝试未生效` : ""}）`;
  }
  const why = foregroundWhy(fg);
  return (
    `${prefix}：未取得（当前前台 pid=${frontmostLabel(fg?.frontPid)}）` +
    (why ? `——${why}` : "") +
    "；键盘走 KimiCU 后台注入路径（键位类断言 FAIL 时先按 tower 纪律排除 frontmost-required 因素）"
  );
}

/**
 * tower 纪律（2026-09-16，M134 实证）：KimiCU 对 WKWebView 内 CodeMirror 的键盘注入在窗口被遮挡时
 * 可能不落地（返回 occluded:true），activate 后也未必恢复。键盘驱动场景应先让目标窗口成为前台。
 *
 * 两条通道，按代价递增（M478）：
 *   1. `AXRaise`（自 M134 起）——**尽力而为**：不动前台归属、不打断用户，但对后台 app 无效
 *      （M135 r2 实测）；
 *   2. System Events `set frontmost`（M478 加）——AXRaise 之后仍不在前台时兜底，**真的抢前台**
 *      （见 activateViaSystemEvents 的来由：启动零激活的实例全靠它）。
 *
 * 返回值仍**如实**报前台归属：拿到记 true，拿不到记 false 并带完整的尝试记录（手段 / 成败 /
 * 失败原因），由场景自己的行为断言证明注入是否真的落地（注入没落地时那些断言必然 FAIL——
 * 不存在「没验到也算过」的路径）。纪律里禁止的两件事仍然禁止：静默跳过、改用 set_value 伪造
 * 键盘语义。 */
export async function tryForeground(cu, pid, { retries = 2, systemEventsRetries = 2 } = {}) {
  const attempts = [];
  const outcome = (frontmost, method) => ({
    frontmost,
    frontPid: frontmost ? pid : frontmostPid(),
    method,
    attempts,
  });
  if (frontmostPid() === pid) return outcome(true, "already-frontmost");
  for (let i = 0; i < retries; i++) {
    const ax = await readAx(cu, pid).catch(() => null);
    const win = ax?.nodes.find((n) => n.role === "AXWindow");
    if (!win) {
      attempts.push({ method: "AXRaise", ok: false, detail: "AX 快照里读不到 AXWindow（快照退化 / 窗口未就绪）" });
    } else {
      try {
        await cu.performSecondaryAction(pid, win.index, "AXRaise");
        attempts.push({ method: "AXRaise", ok: true, detail: `AXRaise 已投递（第 ${i + 1} 轮）` });
      } catch (e) {
        attempts.push({ method: "AXRaise", ok: false, detail: `AXRaise 失败：${e.message}` });
      }
    }
    await sleep(700);
    if (frontmostPid() === pid) return outcome(true, attempts.at(-1)?.method ?? "AXRaise");
  }
  for (let i = 0; i < systemEventsRetries; i++) {
    attempts.push(activateViaSystemEvents(pid));
    await sleep(800); // 激活是异步的：投递之后前台归属要过一拍才切过来
    if (frontmostPid() === pid) return outcome(true, "SystemEvents.frontmost");
  }
  return outcome(false, attempts.at(-1)?.method ?? null);
}

/** 编辑器当前文档文本（AXTextArea.value）。 */
export async function editorText(cu, pid) {
  const ax = await readAx(cu, pid);
  return ax.editor ?? "";
}

/** 把焦点交给编辑器并输入。文本注入必须带 index（见模块头注释）。 */
export async function typeInEditor(cu, pid, text, { clear = false } = {}) {
  const ax = await readAx(cu, pid);
  const ta = ax.textarea ?? parseNodes(ax.text)[0];
  if (!ta) throw new StepError("AX 中找不到编辑器节点，无法聚焦输入");
  const res = await cu.typeText(pid, text, { index: ta.index, clear });
  return res.json;
}

/**
 * composer 素材注入原语（M498，替代 composer 上的 `do: keys` 逐键注入）。
 *
 * 通道：**KimiCU `type_text` 不带 index（当前焦点注入，整串一次）**。这是 M498 七个真机探针
 * 把候选通道逐个毙掉后剩的唯一可靠通道：
 *   1. `press_key` 逐键注入对 composer 丢键（字母 'e' 本机确定性丢失 4/4 + 随机连续丢键段，
 *      M497 归因）——`do: keys` 在此通道上无解，必须换通道；
 *   2. `press_key("cmd+v")`（剪贴板粘贴 chord）本机 8/9 确定性不落地（P4/P5/P6 探针）——
 *      chord 族里 cmd+shift+a 能落地、cmd+v 不能，又一个键码级丢弃；
 *   3. `type_text` 带 index 会点节点 bbox 中心再键入：不保留 caret，长单行下落在正文中段
 *      （P3 探针：60 字符单行注入 Z 落第 31 位），还会污染后续依赖 caret 的步骤；
 *   4. `type_text` **不带 index** 落在当前焦点元素、整串追加到内容末尾（P7 探针 4/4 落地）——
 *      无点击、无键码合成，是四条候选里唯一既可靠又不引入额外副作用的；
 *   5. 但 ④在**原生菜单 Paste 之后**不落地（148 note- 步真机 3/3 未落地：M456 的 window 级
 *      键盘焦点丢失杀的是焦点投递路径）；带 index 的 ③在 post-menu 照落（探针 1 stage 7）。
 *      因此本原语**第 1 次不带 index，重试起带当次重解析的节点 index**（代价 = 一次 bbox 中心
 *      点击，语义本就是追加，可接受）。
 *
 * 因此本原语的语义 = **「把 text 追加到 composer 末尾」**，不是「在 caret 处键入」。
 * 迁移适用面：注入时 composer 的 caret 本就在内容末尾的场景（空 composer 首问、发送后复问、
 * ⇧Enter 新行、卡片/贴图后的承接段落）——与旧 `do: keys` 逐字等价。**caret 由键盘导航定位、
 * 落点即判据**的步骤（141 的 ⌃B 后落字、154 的 ⌃B/⌃A 往返）不能用本原语（会改变被测行为），
 * 那些步骤留在 `do: keys`（M498 探针结论：该形态没有可靠通道，finding 已报）。
 *
 * 前置条件：注入时 composer 必须持有 DOM 焦点（场景沿用各自的 clickInNode / 发送后焦点
 *  retained 步骤建立）。焦点在别处时注入会落到焦点元素——与旧 `do: keys` 同一信任模型
 * （keysTarget = focused 节点），回读 + 场景侧 `editor.unchangedSince` 守卫双保险。
 *
 * attempt-1 焦点守卫（M501，M500 归因的落地）：AXPress 插卡等动作之后，AX 的 `(focused)`
 *  标记可能与 type_text 无 index 走的「当前焦点」投递背离（82/83/85 三场景实证：插卡后
 *  标记在 composer、盲注却落进编辑器，编辑器转「未保存」）。因此第 1 次注入前校验目标节点的
 *  `(focused)` 标记——**无标记先点目标（AX 索引点击，与 clickInNode 同一信任模型）再注**。
 *  焦点已在目标时零开销零行为变化（只读标记，不多点一下）；守卫只在「本就要失败」的路径上
 *  多加一次点击。点击会移动 caret（KimiCU AXPress 落在节点中心）——typeInNode 语义是
 *  「追加到末尾」，注入落点不随 caret 走；后续依赖 caret 的步骤由场景自己重建。
 *
 * 重试口径（M143，与 `keys` / `type` 同一判据）：注入前记目标串在目标节点 value 里出现 N 次，
 * 落地要求恰为 N+1；**目标字节完全未变才重注（≤3 次）**；值变了但次数不是 N+1（partial /
 * duplicated）直接判败，由调用方给诊断——绝不在残段后重注整串（M140 假绿路径）。
 *
 * 目标解析由调用方（execute.mjs）以 `resolve(ax) → node` 注入：与 `clickInNode` 同一套
 * `{role,name|any,nth}` 选择子（**裸正则源码、不带 `/…/` 包裹**——findNode 口径），但解析
 * 发生在**每一次回读**（AX index 是快照域的，不能跨快照复用）。场景写 target.name 时要同时
 * 匹配注入前（composer 空 = 占位读屏名「问点什么…」）与注入后（可访问名 = 内容）两种形态，
 * 如 `问点什么|qrefmark`。
 *
 * AXTextField / AXComboBox 用 CGEvent Unicode 键盘输入，composer 保持 type_text 通道。
 * 返回判定报告（不直接抛业务错）：{ attempts, verdict, baselineValue, lastValue, focused, focusClicked }。
 * verdict ∈ landed | unchanged | partial | duplicated | target-lost（结构错误抛 StepError）。
 */
export function injectTextCGEvent(text) {
  const script = new URL("./cgevent-key.swift", import.meta.url).pathname;
  try {
    return execFileSync("/usr/bin/swift", [script, text], { encoding: "utf8" }).trim();
  } catch (e) {
    throw new StepError(`CGEvent Unicode 注入失败（${e.message}）`);
  }
}

export async function typeInNode(cu, pid, { resolve, text, retries = 3, label = "" } = {}) {
  if (typeof resolve !== "function") throw new StepError("typeInNode：缺少 resolve(ax) 目标解析函数");
  const countOf = (v) => (text ? v.split(text).length - 1 : 0);

  const first = await readAx(cu, pid);
  const node = resolve(first);
  if (!node) throw new StepError(`typeInNode：AX 中找不到目标节点 ${label}（解析口径与 clickInNode 相同）`);
  const baselineValue = node.value ?? "";
  const baseline = countOf(baselineValue);
  const focused = Boolean(node.focused);

  const max = Math.min(retries, 3);
  let used = 0;
  let lastValue = baselineValue;
  let verdict = "unchanged";
  let focusClicked = false;
  for (let attempt = 1; attempt <= max; attempt++) {
    used = attempt;
    const axPre = attempt === 1 ? first : await readAx(cu, pid);
    const targetNow = resolve(axPre);
    if (attempt === 1 && targetNow && !targetNow.focused) {
      focusClicked = true;
      await cu.click(pid, { index: targetNow.index });
      await sleep(500);
    }
    const nativeInput = targetNow && (targetNow.role === "AXTextField" || targetNow.role === "AXComboBox");
    if (nativeInput) {
      injectTextCGEvent(text);
    } else if (attempt === 1 || !targetNow) {
      await cu.typeText(pid, text);
    } else {
      await cu.typeText(pid, text, { index: targetNow.index });
    }
    await sleep(800);
    const ax = await readAx(cu, pid);
    const again = resolve(ax);
    if (!again) {
      verdict = "target-lost";
      break;
    }
    lastValue = again.value ?? "";
    const c = countOf(lastValue);
    verdict = c === baseline + 1 ? "landed" : c > baseline + 1 ? "duplicated" : lastValue === baselineValue ? "unchanged" : "partial";
    if (verdict === "landed") break;
    // 再等一拍复读：DOM 落地与 AX 快照之间有时序，不能拿一次过早的读当结论。
    await sleep(700);
    const ax2 = await readAx(cu, pid);
    const again2 = resolve(ax2);
    if (!again2) {
      verdict = "target-lost";
      break;
    }
    lastValue = again2.value ?? "";
    const c2 = countOf(lastValue);
    verdict = c2 === baseline + 1 ? "landed" : c2 > baseline + 1 ? "duplicated" : lastValue === baselineValue ? "unchanged" : "partial";
    if (verdict !== "unchanged") break;
  }
  return { attempts: used, verdict, baselineValue, lastValue, focused, baseline, focusClicked };
}

export async function pressKey(cu, pid, keys) {
  const { json } = await cu.pressKey(pid, keys);
  return json;
}

export async function pressKeys(cu, pid, keys, { gapMs = 250 } = {}) {
  for (const k of keys) {
    await pressKey(cu, pid, k);
    await sleep(gapMs);
  }
}

/** 等 GUI 稳定后截图（mode=full 才带图；kimi-cu 只在 full 下附截图）。 */
export async function screenshot(cu, pid) {
  const ax = await readAx(cu, pid, { mode: "full" });
  return { image: ax.image, ax };
}

/** swift + CGEvent 投递带 clickState 的点击（套件唯一能造出 DOM `dblclick` 的通道，M209）。
 *
 *  为什么不经 KimiCU：它的注入通道造不出 WKWebView 的 `dblclick`（坐标 `count: 2`、AXPress ×2、
 *  两次独立 click、`drag_paths` 都不行，见 README「已知边界」）；`CGEvent` 显式设
 *  `kCGMouseEventClickState` 可以。
 *
 *  `point` 是 **Quartz 全局屏幕坐标**（原点 = 主屏左上角，pt）——不是 KimiCU 的两种空间
 *  （mode=ax 是窗口局部点、mode=full 是截图像素），换算由调用方（execute.mjs 的 doubleClick）做。
 *  会移动真实光标，所以调用方应先 `focusWindow`；`mode` 默认 2（60ms 间隔的单击 + 双击）。 */
export async function injectClickWithClickState(pid, point, { mode = 2 } = {}) {
  const script = new URL("./cgevent-click.swift", import.meta.url).pathname;
  const args = ["/usr/bin/swift", script, String(Math.round(point.x)), String(Math.round(point.y)), String(mode)];
  if (mode === 4) args.push(String(pid));
  try {
    return execFileSync(args[0], args.slice(1), { encoding: "utf8" }).trim();
  } catch (e) {
    throw new StepError(
      `swift + CGEvent 注入失败（${e.message}）。这条通道要 /usr/bin/swift（Xcode Command Line Tools）` +
        `且进程要有辅助功能权限；README「已知边界」的 dblclick 条有说明。`,
    );
  }
}

/** 修饰键点击（M379）：与 injectClickWithClickState 同一条 swift 通道（mode 6），差别只在
 *  鼠标事件带修饰键 flags——DOM 侧拿到 `metaKey/ctrlKey/…` 为真的点击。
 *
 *  为什么必须有它：KimiCU 的 `click` 没有修饰键参数（工具 schema 实测只有
 *  button/mouse_button/count/hold_ms），⌘-Click 这类路径（跟随链接）在真机上因此无法触发
 * （M144 现场；早期 backlog「`click` 不支持修饰键」条，原文见 git 历史；现行能力见 README 的
 * `click.modifiers`：该路径在套件内可直接验，chromium 层不再是唯一判据）。
 *
 *  `point` 是 **Quartz 全局屏幕坐标**（与 injectClickWithClickState 同口径，换算由调用方做）；
 *  会移动真实光标、要求目标窗口在前台。`modifiers` 是别名集合（meta/cmd/control/ctrl/shift/
 *  alt/option），swift 侧统一翻译成 CGEventFlags。 */
export async function injectClickWithModifiers(pid, point, { modifiers = [], count = 1 } = {}) {
  const script = new URL("./cgevent-click.swift", import.meta.url).pathname;
  const args = [
    "/usr/bin/swift", script,
    String(Math.round(point.x)), String(Math.round(point.y)), "6",
    modifiers.join(","), String(count),
  ];
  try {
    return execFileSync(args[0], args.slice(1), { encoding: "utf8" }).trim();
  } catch (e) {
    throw new StepError(
      `swift + CGEvent 修饰键点击注入失败（${e.message}）。这条通道要 /usr/bin/swift（Xcode Command Line Tools）` +
        `且进程要有辅助功能权限；README「已知边界」的 dblclick / 修饰键点击条有说明。`,
    );
  }
}

/** 鼠标悬停（M443）：只投 `mouseMoved`（不按任何鼠标键），DOM 侧因此收到 mouseover / mouseenter，
 *  可在真机上驱动 hover 类 UI（如 ctx 读数的含义气泡）。
 *
 *  为什么加它：套件此前没有 hover 动词，hover 类判据在真机层只能写负向（「文案默认不在 AX 树里」），
 *  显隐的正观测整个落在 chromium 层（README「已知边界」原条目）。M443 的气泡新增行（本回合命中 /
 *  缓存写入）需要真机正观测，故复用 doubleClick / drag 同一条已验证的 swift + CGEvent 通道。
 *
 *  `point` 是 **Quartz 全局屏幕坐标**（与 injectClickWithClickState 同口径，换算由调用方做）；
 *  代价与那条通道一致：要 /usr/bin/swift + 辅助功能权限、**会移动真实光标**、要求目标窗口在前台
 *  且未被遮挡（后台跑批时拿不到前台 ⇒ `do: hover` 按环境项报 INVALID，见 README 与 execute.mjs）。
 *  光标**恰好已在目标上**时单次 mouseMoved 不产生 mouseenter（hover 目标没变化），调用方
 *  （execute.mjs 的 hover 动作）因此先 park 到别处再移到目标。 */
export async function injectHover(pid, point) {
  const script = new URL("./cgevent-click.swift", import.meta.url).pathname;
  const args = ["/usr/bin/swift", script, String(Math.round(point.x)), String(Math.round(point.y)), "0"];
  try {
    return execFileSync(args[0], args.slice(1), { encoding: "utf8" }).trim();
  } catch (e) {
    throw new StepError(
      `swift + CGEvent 悬停注入失败（${e.message}）。这条通道要 /usr/bin/swift（Xcode Command Line Tools）` +
        `且进程要有辅助功能权限；README「已知边界」的 hover 条有说明。`,
    );
  }
}

/** CGEvent 滚轮注入（M644，mode 8）：把光标移到 `point` 后按拍投 `scrollWheel`（单位 = 行）。
 *  **dy / dx 的正负指向已真机标定（M669，M667 的同点位 A/B）**：**正数 = 上滚**——`dy: 20`
 *  让视口离开底部、「回到底部」浮钮浮现，`dy: -20` 不产生任何位移（两张截图 sha256 相同）。
 *  与 KimiCU legacy `dy` 的约定同向，调用方因此不取反。
 *
 *  为什么需要它：KimiCU 的 `scroll` 在本 app 上从未产出过位移（M252 / M379 的通道边界，
 *  见 README「已知边界」的滚动条）——`do: scroll` 因此在真机上层长期是死通道。滚轮注入走
 *  doubleClick / drag / hover 同一条已验证的 swift + CGEvent 通路，是唯一可能真正滚起来的
 *  通道；`execute.mjs` 的 `scroll` 动作在 KimiCU 自报无位移时退化到这条。
 *
 *  `point` 是 **Quartz 全局屏幕坐标**（与 injectClickWithClickState 同口径，换算由调用方做）；
 *  代价与那条通道一致：要 /usr/bin/swift + 辅助功能权限、**会移动真实光标**、要求目标窗口
 *  在前台且未被遮挡（`focusWindow click: true` 作前置，M669）。 */
export async function injectWheel(point, { dy = 0, dx = 0 } = {}) {
  const script = new URL("./cgevent-click.swift", import.meta.url).pathname;
  const args = [
    "/usr/bin/swift", script,
    String(Math.round(point.x)), String(Math.round(point.y)), "8",
    String(Math.round(dy)), String(Math.round(dx)),
  ];
  try {
    return execFileSync(args[0], args.slice(1), { encoding: "utf8" }).trim();
  } catch (e) {
    throw new StepError(
      `swift + CGEvent 滚轮注入失败（${e.message}）。这条通道要 /usr/bin/swift（Xcode Command Line Tools）` +
        `且进程要有辅助功能权限；README「已知边界」的滚动条有说明。`,
    );
  }
}

/** CGEvent 拖拽（M228，mode 5）：leftMouseDown → 插值 dragged 序列 → leftMouseUp。
 *  KimiCU 的 drag 工具在 WKWebView 里不产生 DOM 拖拽（连文本选择都造不出来，M228 实测），
 *  与 dblclick 同一类注入边界，因此走同一条 swift 通道。坐标是 Quartz 全局屏幕点（与
 *  injectClickWithClickState 同口径）。 */
export async function injectDrag(from, to) {
  const script = new URL("./cgevent-click.swift", import.meta.url).pathname;
  const args = [
    "/usr/bin/swift", script,
    String(Math.round(from.x)), String(Math.round(from.y)), "5",
    String(Math.round(to.x)), String(Math.round(to.y)),
  ];
  try {
    return execFileSync(args[0], args.slice(1), { encoding: "utf8" }).trim();
  } catch (e) {
    throw new StepError(
      `swift + CGEvent 拖拽注入失败（${e.message}）。这条通道要 /usr/bin/swift（Xcode Command Line Tools）` +
        `且进程要有辅助功能权限；README「已知边界」的 dblclick 条有说明。`,
    );
  }
}

/** AXSize 写通道的有界重试口径（M764）：至多 3 次尝试、尝试间隔 400ms。
 *
 *  为什么重试：`AXUIElementSetAttributeValue(AXSize)` 会**间歇性**报 `kAXErrorFailure`（-25200）
 *  ——2026-10-28 的 117 连跑 4 次全部倒在第 1 步 `resizeWindow`，同一 pid、同一脚本的预检
 *  `pinWindowSize` 却成功，run 结束后在同一实例上按 300ms 间隔手工调用 8/8 成功；2026-10-27 的
 *  117 / 39 / 126 同族（finding
 *  `.tower/comms/findings/20261028-worker-rmachine-multiline-ax-v-bug-resizewindow-axsize-25200-117-39-126-m763.md`）。
 *  失败状态只存在于调用时刻，**不是产品缺陷**。修法是有界重试，不是加长固定 sleep（每次 resize
 *  都付代价，且不解决瞬时性），也不是无限重试。400ms 的下限由 README 合同给出（≥300ms），
 *  `drive.test.mjs` 钉住。 */
const RESIZE_ATTEMPTS = 3;
const RESIZE_RETRY_DELAY_MS = 400;

/** 单次 `ax-window.swift` 调用，纯数据返回（`run` 可注入——测试用假 swift 覆盖重试分支）。 */
function runAxWindowOnce(pid, width, height) {
  const script = new URL("./ax-window.swift", import.meta.url).pathname;
  const args = ["/usr/bin/swift", script, String(pid), String(Math.round(width)), String(Math.round(height))];
  try {
    return { ok: true, stdout: execFileSync(args[0], args.slice(1), { encoding: "utf8" }).trim(), error: null };
  } catch (e) {
    return { ok: false, stdout: "", error: String(e.message ?? e) };
  }
}

/** `size=<w>x<h>` 回读行的解析（M764）：`resizeWindowAX` 的成功判据与 `pinWindowSize` 的生效值
 *  共用这一份——两处各写一遍正则就是「同一语义两处真源」（REVIEW.md 同名条）。 */
export function parseWindowSizeLine(out) {
  const m = /size=(\d+)x(\d+)/.exec(out);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

function oneLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

/** 逐次尝试的证据串（写进错误与步骤证据）：err 与回读尺寸逐次留痕，归因不必回真机加探针。 */
function formatResizeAttempts(history) {
  return history
    .map((a) => {
      const readback = a.readback ? `回读 ${a.readback.w}×${a.readback.h}` : "回读 无";
      return a.ok ? `#${a.attempt} 已写入（${readback}）` : `#${a.attempt} 失败（${oneLine(a.error)}）${readback}`;
    })
    .join("；");
}

/** 写窗口尺寸的核心（M764）：有界重试 + 成功判据只有一条——**回读等于请求值**。
 *
 *  每次尝试都记下 err 与回读尺寸（`history`）；三种结局：
 *    1. 某次回读 == 请求值 → `{ pinned: true }`（**只有这一条算成功**）；
 *    2. 写入被接受但回读始终 ≠ 请求值 → `{ pinned: false }`（窗口管理器钳制 / 写入未生效）；
 *    3. 一次都没写进去（swift 非零退出 / 输出没有 `size=` 回读行）→ `InfraError`（通道/环境项，
 *       runner 把整场标 INVALID、退出码 2，**不是场景断言 FAIL**）。
 *
 *  为什么第 2 类返回而不是抛错：钳制是**已登记的环境边界**（README「窗口几何的确定性」①：生效值
 *  ≠ 请求值标 ⚠、坐标场景按生效值漂、几何断言对生效值判），把它升级成错误会让「屏幕放不下
 *  1200×800」的机器整轮 INVALID，而它今天只是一条 ⚠ 证据。第 3 类没有可用的生效值，才按通道
 *  失败归类——与本文件 `hover` 拿不到前台、`readAx` 主窗不可判定同一档（InfraError）。 */
async function writeWindowSize(pid, width, height, { run = runAxWindowOnce, sleepFn = sleep } = {}) {
  const want = { w: Math.round(width), h: Math.round(height) };
  const history = [];
  let lastAccepted = null;
  for (let attempt = 1; attempt <= RESIZE_ATTEMPTS; attempt++) {
    const raw = run(pid, want.w, want.h);
    const readback = raw.ok ? parseWindowSizeLine(raw.stdout) : null;
    const ok = raw.ok && readback !== null;
    const error = !raw.ok ? raw.error : readback ? null : `回读行无法解析：${JSON.stringify(raw.stdout)}`;
    const entry = { attempt, ok, error, readback, stdout: raw.stdout };
    history.push(entry);
    if (ok && readback.w === want.w && readback.h === want.h) {
      return { pinned: true, want, readback, history, stdout: raw.stdout };
    }
    if (ok) lastAccepted = entry;
    if (attempt < RESIZE_ATTEMPTS) await sleepFn(RESIZE_RETRY_DELAY_MS);
  }
  if (!lastAccepted) {
    const last = history[history.length - 1];
    throw new InfraError(
      `AXSize 写通道失败（请求 ${want.w}×${want.h}，${RESIZE_ATTEMPTS} 次尝试全部没写进去、间隔 ` +
        `${RESIZE_RETRY_DELAY_MS}ms）：这是通道 / 环境项（窗口 AX 写的瞬时 -25200 族，见 README` +
        `「AXSize 写通道的瞬时 -25200」），不是场景断言失败。逐次：${formatResizeAttempts(history)}。` +
        `最后一次原始错误：${last.error}`,
    );
  }
  return { pinned: false, want, readback: lastAccepted.readback, history, stdout: lastAccepted.stdout };
}

/** AX 直接设窗口尺寸（M236，窄窗退让的真机验证）：确定值通道，不拖窗口边缘（命中区与
 *  落点都不稳）。返回 swift 的回读行（`size=<w>x<h>`，窗口管理器钳制后的生效值）。
 *
 *  **成功只认回读等于请求值**（M764）：通道间歇性报 -25200 时按 `writeWindowSize` 重试（≤3 次、
 *  间隔 400ms）；某次回读等于请求值就返回那一行，重试过的把逐次 err / 回读写进返回证据。写入被
 *  接受但回读始终不同 = 钳制，返回行**明确标 ⚠ 并写出请求值与生效值**，不冒充成功；一次都没
 *  写进去则抛 `InfraError`（通道/环境项）。首次即成功的返回行与旧格式一字不差（证据不膨胀）。 */
export async function resizeWindowAX(pid, width, height, options = {}) {
  const r = await writeWindowSize(pid, width, height, options);
  if (r.pinned) {
    if (r.history.length === 1) return r.stdout;
    return (
      `${r.stdout}（AXSize 写了 ${r.history.length} 次才回读到请求值 ${r.want.w}×${r.want.h}：` +
      `${formatResizeAttempts(r.history)}）`
    );
  }
  return (
    `${r.stdout}（⚠ 请求 ${r.want.w}×${r.want.h}，${r.history.length} 次尝试后回读仍 ≠ 请求：写入被接受但` +
    `尺寸没变过来——窗口管理器钳制（屏幕放不下该尺寸）或写入未生效；${formatResizeAttempts(r.history)}。` +
    `回读生效值以窗口管理器为准，几何断言对生效值判，本行不得当成「已钉住」，见 README「AXSize 写通道的瞬时 -25200」）`
  );
}

/** key window 读数（M678；主窗判据 M762）：与 `resizeWindowAX` 同一条 AX 通道，读 app 的
 *  **AXFocusedWindow** 并核对它就是本套件操作的**主窗**——主窗按 `AXSubrole == AXStandardWindow`
 *  选（多扇标准窗时按 `AXMain` 消歧，选不出来报 `unknown` + 窗口清单），**不再**用 `AXWindows[0]`
 *  这个索引假设：多出一扇辅助 `AXDialog` 之后索引会反过来，把「焦点本来就在主窗」读成 false
 *  （2026-10-28 的 224 两轮 INVALID 即此）。
 *
 *  为什么需要它：`focusWindow click: true` 的合同里有「窗口成为 key window」，而编辑器焦点证明不了
 *  窗口是 key。**但窗口自己的 `AXFocused` 属性在本 app 上恒 false**——M678 真机实测：编辑器有焦点、
 *  滚轮与键盘都可用时仍报 `focused=false main=true`，拿它当判据会把正常跑批判成 INVALID（首轮
 *  224/228 的现场）。`AXFocusedWindow` 是 AX 侧的 key window 读数：同一次探针在可用现场读到
 *  `focusedWindowErr=0 … isFirstWindow=true`（`isFirstWindow` 是 M762 之前旧判据的读数，留作历史现场）。
 *
 *  返回 `{ focused: true|false|null, raw }`；**`null` = unknown**（AXFocusedWindow 属性读取失败 /
 *  输出无法解析 / swift 失败），与 `false`（确定读到了聚焦窗口、但不是主窗口）分开记——判定方要求
 *  严格 `true` 才通过（r1 评审 P1-1：unknown 不得当成通过，否则 key-window 通道失效时退化成单判据）。
 */
export function readKeyWindowState(pid) {
  const script = new URL("./ax-key-window.swift", import.meta.url).pathname;
  try {
    const raw = execFileSync("/usr/bin/swift", [script, String(pid)], { encoding: "utf8" }).trim();
    return { focused: parseKeyWindowState(raw), raw };
  } catch (e) {
    return { focused: null, raw: `读取失败：${e.message}` };
  }
}

/** `ax-key-window.swift` 输出的纯解析（M678 r1）：`focusedWindow=true|false|unknown` →
 *  `true` / `false` / `null`。`unknown`（属性读取失败）与无法解析都归 `null`，**不归一成 false**：
 *  「读不到」和「确定不是主窗口」是两种归因（前者是环境，后者是状态），混在一起会把环境问题
 *  报成确定状态。判定方（`establishEditorFocus`）对 `null` 判未建立。 */
export function parseKeyWindowState(raw) {
  const m = /focusedWindow=(true|false|unknown)/.exec(raw);
  if (!m || m[1] === "unknown") return null;
  return m[1] === "true";
}

/** 启动后把窗口钉到固定尺寸（M491）：产品侧 `apply_startup_size`（src-tauri/src/lib.rs:242-322）
 *  把首启尺寸设为工作区 90%、静默盖过 tauri.conf 的 1200×800 占位（且该行为本身是场景 126 的
 *  判据本体），坐标/像素敏感场景（53、122 等）因此拿到不确定几何。本函数在就绪门之后把窗口经
 *  AXSize 直写钉回构建配置的占位尺寸，恢复确定性；通道是 `writeWindowSize`（M236 的
 *  `resizeWindowAX` 通道，M764 起带 -25200 的有界重试），不在套件里新增第二条 resize 通道。
 *
 *  返回**证据行**（实际宽高取回读的生效值，不取请求值——窗口管理器可能钳制）；`prefix` 让重启
 *  路径写成「重启窗口钉尺寸：…」与首启区分。重试过的把逐次 err / 回读写进证据行（M764）。
 *  钉不上抛 `InfraError`（swift 缺失 / 无辅助功能权限 / 3 次尝试一次都没写进去）——由调用方
 *  （run.mjs 的启动段）判基建 INVALID，不静默放行：钉不住尺寸的跑批与没钉一样，坐标场景照旧漂移。
 *  钳制（写入被接受、回读 ≠ 请求值）照旧只标 ⚠、不抛错（README「窗口几何的确定性」①）。
 *
 *  `run` / `sleepFn` 透传给 `writeWindowSize`：`drive.test.mjs` 用假 swift 与假窗口状态覆盖重试
 *  与归类分支，生产调用点不传。 */
export async function pinWindowSize(cu, pid, { width, height }, { prefix = "", ...resizeOptions } = {}) {
  const startMs = Date.now();
  const r = await writeWindowSize(pid, width, height, resizeOptions);
  const actualW = r.readback.w;
  const actualH = r.readback.h;
  const clamped = actualW !== r.want.w || actualH !== r.want.h;
  const retryNote =
    r.history.length > 1 ? `；AXSize 共写 ${r.history.length} 次（${formatResizeAttempts(r.history)}）` : "";
  // 等 webview 跟随新尺寸重排：AXSize 写入后 webview 有一拍过渡（M491 探针实测钉后 +0ms 出现
  // 「webview 比窗口高 64px」的过渡态、+2s 内收敛成铺满）。轮询「铺满差 ≤4px」（判据与
  // assertOverlayChrome 同源）最多 6s；等不到不判死——残余差如实写进证据行，几何/像素断言
  // 自己会对着真实画面判，不在这一步发明新的失败类别。
  let topGap = null;
  let heightGap = null;
  const deadline = Date.now() + 6000;
  do {
    const ax = await readAx(cu, pid).catch(() => null);
    const win = ax?.nodes.find((n) => n.role === "AXWindow" && n.bbox);
    const areas = ax?.nodes.filter((n) => n.role === "AXScrollArea" && n.bbox) ?? [];
    if (win && areas.length) {
      const area = areas.reduce((a, b) => (a.bbox.w * a.bbox.h >= b.bbox.w * b.bbox.h ? a : b));
      topGap = area.bbox.y - win.bbox.y;
      heightGap = win.bbox.h - area.bbox.h;
      if (topGap <= 4 && heightGap <= 4) {
        return (
          `${prefix}窗口钉尺寸：请求 ${r.want.w}×${r.want.h}，回读生效 ${actualW}×${actualH}（AXSize 直写` +
          `${retryNote}；webview 重排 settle ${Date.now() - startMs}ms）` +
          (clamped ? "；⚠ 生效值 ≠ 请求值——窗口管理器钳制（屏幕放不下该尺寸的已知环境边界），坐标场景按生效值漂" : "")
        );
      }
    }
    await sleep(400);
  } while (Date.now() < deadline);
  return (
    `${prefix}窗口钉尺寸：请求 ${r.want.w}×${r.want.h}，回读生效 ${actualW}×${actualH}（AXSize 直写${retryNote}）；` +
    `⚠ webview 未在 6s 内铺满新尺寸（残余：顶边差 ${topGap}px / 高度差 ${heightGap}px）` +
    (clamped ? "；⚠ 生效值 ≠ 请求值——窗口管理器钳制" : "")
  );
}

/** 工作区尺寸缓存（M437）：屏尺寸在一次跑批里不变，读一次就够——swift 是解释执行，每条断言都
 *  起一次进程会白付一秒级的代价（相对判据因此只在这一层读一次）。 */
let workAreaCache = null;

/** 主显示器的工作区尺寸（逻辑点，M437）——`lib/ax-screen.swift` 读 `NSScreen.visibleFrame`。
 *
 *  用途：窗口尺寸的**相对判据**（首启 = 工作区 90%、越界存档钳到工作区）。产品侧的同一量取自
 *  `Monitor::work_area()`（`src-tauri/src/lib.rs` 的 `work_area_size`，macOS 上即 visibleFrame），
 *  因此两侧同源；逻辑点与 AX 的 `window_bounds` 也是同一空间，算出来的期望值可直接对读数。
 *
 *  读不到（swift 缺失 / 无显示器）抛 `InfraError`——那是**本机环境**问题，本次读数整体不可用，
 *  按套件的分档交 runner 把整场标 INVALID（与「窗口尺寸读不到」的处置分开：后者亮在断言里）。 */
export function screenWorkArea() {
  if (workAreaCache) return workAreaCache;
  const script = new URL("./ax-screen.swift", import.meta.url).pathname;
  let out = "";
  try {
    out = execFileSync("/usr/bin/swift", [script], { encoding: "utf8" }).trim();
  } catch (e) {
    throw new InfraError(
      `读主显示器工作区失败（${e.message}）。这条通道要 /usr/bin/swift（Xcode Command Line Tools）：` +
        "窗口尺寸的相对判据（工作区 ×比例）依赖它。",
    );
  }
  const m = /visible=(\d+)x(\d+)\s+scale=([\d.]+)/.exec(out);
  if (!m) throw new InfraError(`工作区读数无法解析：${JSON.stringify(out)}（期望 visible=<w>x<h> scale=<s>）`);
  workAreaCache = { w: Number(m[1]), h: Number(m[2]), scale: Number(m[3]), raw: out };
  return workAreaCache;
}
