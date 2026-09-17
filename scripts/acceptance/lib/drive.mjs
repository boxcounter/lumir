// 驱动层：把 KimiCU 的原始工具封装成验收可用的确定性动作。
//
// 三条经验（都是实测踩出来的，改这些封装前先确认仍成立）：
//   1. AX 树里 AXTextArea 的 value 就是整个文档文本（含未渲染的源码）——内容断言的主要来源；
//      它的 value 是多行字符串，解析时必须按引号是否闭合来吞行（见 lib/ax.mjs）。
//   2. LUMIR_READY 只说明进程起来了，前端的文件树/编辑器可能还没就绪；一切动作前先 settle。
//   3. KimiCU 的 type_text 传 index 时会先在后台做一次真实点击建立渲染层焦点——编辑器失焦时
//      直接注入会落到陈旧选区，所以输入一律带 index。
import { execFileSync } from "node:child_process";
import { findNode, parseNodes } from "./ax.mjs";
import { sleep } from "./util.mjs";

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

/** 读一次 AX。mode=full 附带截图（证据用），ax 更省。 */
export async function readAx(cu, pid, { mode = "ax" } = {}) {
  const { text, image } = await cu.state(pid, { mode });
  const nodes = parseNodes(text);
  const textarea = nodes.find((n) => n.role === "AXTextArea") ?? null;
  return { text, image, nodes, textarea, editor: textarea?.value ?? null };
}

/** 等界面稳定：连续两次 AX 文本一致，且编辑器节点已就位。 */
export async function settle(cu, pid, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let prev = null;
  while (Date.now() < deadline) {
    const ax = await readAx(cu, pid);
    if (prev && prev.text === ax.text && ax.textarea) return ax;
    prev = ax;
    await sleep(700);
  }
  throw new StepError(`界面在 ${timeoutMs}ms 内未稳定`);
}

/**
 * 前端就绪门：等左栏文件树 + 编辑器节点就位。
 * 不用「整棵 AX 文本两次一致」——编辑器有光标/渲染时序，树会持续微抖，会假超时。
 *
 * `requireVault: false`（M159 起，只给「本步期待未打开空态」的场景用）：启动恢复移出主线程
 * 后，`last_vault` 失效 / 无 `last_vault` 时前端**合法地**停在未打开空态（树 pane 里没有
 * `.ft-row`，只有空态的「打开 vault」入口），严格门那条「树里有 .md 行」永远不成立。放宽后
 * 判据是「树 pane 呈现了任一种形态 + 编辑器节点在位」，终态仍由场景自己的断言证明
 * ——不得作为默认口径（默认仍是严格门，见 run.mjs 的 ctx.restartApp）。
 */
export async function waitAppReady(cu, pid, { timeoutMs = 30_000, requireVault = true } = {}) {
  let seen = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ax = await readAx(cu, pid);
    const hasHeader = findNode(ax.nodes, { role: "AXButton", name: /切换 vault/ }) !== null;
    const hasFiles = ax.nodes.some((n) => n.role === "AXButton" && /\.md$/.test(n.title ?? ""));
    // 未打开空态在 AX 里的稳定标志：空态说明行 + 「打开 vault」入口（D5/D6 的文案）。
    const hasEmptyState = /打开一个目录作为 vault/.test(ax.text) && /打开 vault/.test(ax.text);
    const treeReady = hasHeader && hasFiles ? true : !requireVault && hasEmptyState;
    if (treeReady && ax.textarea) seen += 1;
    else seen = 0;
    if (seen >= 2) {
      await sleep(600);
      return readAx(cu, pid);
    }
    await sleep(700);
  }
  throw new StepError(
    `前端在 ${timeoutMs}ms 内未就绪（左栏文件树/编辑器节点未出现${requireVault ? "" : "；本步已放宽为允许未打开空态"}）`,
  );
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

/**
 * tower 纪律（2026-09-16，M134 实证）：KimiCU 对 WKWebView 内 CodeMirror 的键盘注入在窗口被遮挡时
 * 可能不落地（返回 occluded:true），activate 后也未必恢复。键盘驱动场景应先让目标窗口成为前台。
 *
 * 实测补充（M135 r2）：当用户正在用别的 app 时，`AXRaise` **无法**把后台 app 抢到前台
 * （前台 pid 仍是别的进程），且强行抢焦点会打断用户——KimiCU 的 press_key/type_text 默认走
 * **后台注入**路径，正是为这种场景设计的。因此这里做成**尽力而为 + 如实记录**：
 * 拿到前台记 true，拿不到记 false 并留在证据里，由场景自己的行为断言证明注入是否真的落地
 * （注入没落地时那些断言必然 FAIL——不存在「没验到也算过」的路径）。
 * 纪律里禁止的两件事仍然禁止：静默跳过、改用 set_value 伪造键盘语义。
 */
export async function tryForeground(cu, pid, { retries = 2 } = {}) {
  for (let i = 0; i < retries; i++) {
    const front = frontmostPid();
    if (front === pid) return { frontmost: true, frontPid: pid, raised: i > 0 };
    const ax = await readAx(cu, pid).catch(() => null);
    const win = ax?.nodes.find((n) => n.role === "AXWindow");
    if (win) {
      try {
        await cu.performSecondaryAction(pid, win.index, "AXRaise");
      } catch {
        /* 无 AXRaise 权限/动作时忽略：后台注入路径仍可用 */
      }
    }
    await sleep(700);
  }
  return { frontmost: frontmostPid() === pid, frontPid: frontmostPid(), raised: true };
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
