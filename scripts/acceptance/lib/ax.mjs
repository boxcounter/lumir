// AX 树文本的解析与检索。
//
// KimiCU 的 get_app_state 把 AX 树渲染成缩进文本，每行形如：
//   - [11] AXButton (vault：fieldnotes-demo（点击查看全部 vault）) @191,54 37×21 actions=[AXPress]
//    - [8] AXStaticText = "fieldnotes-demo 无当前文件"
//     - [5] AXWebArea (Lumir)
// 套件的两类断言（找可点节点、找文本证据）都建立在这个解析上。

const LINE_RE = /^\s*-\s*\[(\d+)\]\s+(AX[A-Za-z]+|AXWebArea)\b(.*)$/;

/** `= "…"` 形态里起始引号之后的**闭合引号**判据（M379）。
 *
 * value 之后只会接这些结构字段，别处出现的引号都是正文自己的引号。**不要退回「引号奇偶」
 * 启发式**：正文含半角引号时它判不清边界（M180 finding，README 已知边界同条），随后
 * `= "…"` 的非贪婪正则在同一处截断——`editor.has` 假红、`editor.not` 假绿（负断言在截断
 * 文本上找不到目标串而「通过」）。
 *
 * `allowEol`（续行合并期置 false）：单行 value 的闭合引号就落在**行尾**，值本身也可能恰以
 * 引号收尾，两者从这一行上看不可分辨。合并期因此不认行尾，只认结构字段；行尾那一档留给
 * 合并结束后（此时「下一行不是节点行」已经确定，见 parseNodes 的合并循环）。 */
const VALUE_TAIL_RE = /^\s*(?:@-?\d+,-?\d+\s+\d+×\d+|actions=\[|help="|\(focused\)|\(disabled\))/;

/** 起始引号之后第一个「后面接结构字段（或行尾，allowEol 时）」的引号即闭合引号；找不到回 -1。 */
function findValueEnd(text, { allowEol = true } = {}) {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') continue;
    const tail = text.slice(i + 1);
    if (VALUE_TAIL_RE.test(tail)) return i;
    if (allowEol && /^\s*$/.test(tail)) return i;
  }
  return -1;
}

/** 起始引号之后的下标（value 字段的 `= "` 形态）；没有该形态回 -1。
 *
 * 这里**故意**沿用旧的宽松口径（`= "` 出现在 `help="…"` 里也算命中）：该命中在旧实现里就是
 * `value` 的来源（`/=\s*"([\s\S]*?)"/` 一样会吃到 help 文本），仓内 6631 份历史 dump 上两者
 * 逐节点相同；收紧成「只认 value 字段」会把约 48 万个 help 载体的 `value` 从「help 文本」改成
 * null，那是另一件事（`nodeName` 的 fallback 次序不受影响，因为 title 取同一段文本）。 */
function valueStart(rest) {
  const m = /=\s*"/.exec(rest);
  return m ? m.index + m[0].length : -1;
}

/** value 的续行候选：不是节点行，也不是 AX dump 的**收尾围栏**（正文里合法出现的 ``` 不算，
 *  只有全文最后那一行才按落点判定——它恒是 dump 的收尾，不是任何 value 的一部分）。 */
function isContinuation(line, index, tailFence) {
  return index !== tailFence && !LINE_RE.test(line);
}

export function parseNodes(axText) {
  const lines = axText.split("\n");
  const tailFence = /^\s*```\s*$/.test(lines[lines.length - 1] ?? "") ? lines.length - 1 : -1;
  const nodes = [];
  for (let i = 0; i < lines.length; i++) {
    const m = LINE_RE.exec(lines[i]);
    if (!m) continue;
    // AXTextArea 的 value 是多行文档文本，用真实换行展开在若干行里：把后续行并入本节点，
    // 否则 value 抓不全（编辑器内容断言全靠这个字段）。`= "…"` 形态用**结构判据**判闭合
    // （见 findValueEnd）；其余形态（`Value: …` / `help="…"` / 无引号字段）保持旧的「引号
    // 奇偶」口径——多行 help 就是这么抓的，换成结构判据会改掉既有行为。
    const firstLine = lines[i];
    let raw = firstLine;
    const quoted = valueStart(firstLine) >= 0;
    while (i + 1 < lines.length && isContinuation(lines[i + 1], i + 1, tailFence)) {
      if (quoted) {
        if (findValueEnd(raw.slice(valueStart(raw)), { allowEol: false }) >= 0) break;
      } else if ((raw.match(/"/g) ?? []).length % 2 === 0) break;
      i += 1;
      raw += `\n${lines[i]}`;
    }
    const [, idx, role] = m;
    // 字段一律从**合并后**的 raw 上取：AXTextArea 的多行 value 后半截在续行里，
    // 只 parse 首行的 rest 会把 value 抓成 null（曾导致「编辑器内容断言」全假绿）。
    const rest = raw.replace(/^\s*-\s*\[\d+\]\s+(?:AX[A-Za-z]+|AXWebArea)\b/, "");
    const bbox = /@(-?\d+),(-?\d+)\s+(\d+)×(\d+)/.exec(rest);
    const depth = (firstLine.length - firstLine.trimStart().length) / 2;
    // value 的两种渲染形态都要认（M199 实测）：编辑器与静态文本用 `= "…"`，而**有 AXValue 的非文本
    // 控件**（AXComboBox / AXRadioButton / AXPopUpButton…）用 `Value: …`（无引号，直到 `@x,y`、
    // `actions=` 或行尾）。只认前一种时 ARIA 组合框（`<input role="combobox">`）的文本读不到，
    // keys 动作的回读目标会退到它的 label 上——注入的落地与否永远判不出来（现场见 execute.mjs 的
    // TEXT_FIELD_ROLES 注释：实测值 "banbab" = 三次注入的残段累积）。
    // `= "…"` 形态走结构判据（valueStart + findValueEnd）：非贪婪正则 `= "([\s\S]*?)"` 遇
    // 正文里的半角引号即截断（M180 finding）——负断言在截断文本上反而「通过」。取不到闭合
    // 引号时判 null（不可读），不把半截文本当值。
    const start = valueStart(rest);
    const value =
      start >= 0
        ? (() => {
            const end = findValueEnd(rest.slice(start));
            return end >= 0 ? rest.slice(start, start + end) : null;
          })()
        : (/Value:\s*(.*?)(?=\s+@|\s+actions=|$)/.exec(rest)?.[1] ?? null);
    nodes.push({
      index: Number(idx),
      role,
      // 有 `= "…"` 值的节点：title 与 value 同源（渲染里紧随角色之后的那段引号文本就是它，
      // 今天也是这么取的，只是旧正则在含引号时同样截断）。其余形态保持「第一段引号文本」
      // 的旧口径，不动既有抓取行为。
      title: start >= 0 ? value : (/"([^"]*)"/.exec(rest)?.[1] ?? null),
      // label 允许**一层嵌套括号**（M184 finding）：图片节点的 AX label 是整条 Markdown 引用
      // 原文 `![alt](path)`，`/\(([^)]*)\)/` 会截在第一个 `)` 上，于是 `target.name` 照原文写
      // 永远匹配不上（按名定位图片节点必报「找不到带 bbox 的节点」）。
      label: /\(((?:[^()]|\([^()]*\))*)\)/.exec(rest)?.[1] ?? null,
      value,
      bbox: bbox ? { x: +bbox[1], y: +bbox[2], w: +bbox[3], h: +bbox[4] } : null,
      actions: /actions=\[([^\]]*)\]/.exec(rest)?.[1]?.split(",").map((s) => s.trim()) ?? [],
      help: /help="([^"]*)"/.exec(rest)?.[1] ?? null,
      // KimiCU 在 AX 文本末尾标 `(focused)`（多行 value 的**末行**上，故在合并后的 raw 里找）：
      // 键盘注入落点就是它——keys 动作的回读目标判定要靠这个标记（见 execute.mjs 的 keysTarget）。
      focused: /\(focused\)/.test(raw),
      depth,
      raw: raw.trim(),
    });
  }
  return nodes;
}

/** 人类可读名：title > label > value，供断言里的 name 匹配用。 */
export function nodeName(n) {
  return n.title ?? n.label ?? n.value ?? "";
}

/**
 * 按 role / name 正则 / 索引找节点。
 * name 依次匹配 title、label、value；任一命中即算。nth 用于取第 n 个（0 起）。
 */
export function findNode(nodes, { role, name, nth = 0 } = {}) {
  const re = name instanceof RegExp ? name : name ? new RegExp(String(name)) : null;
  const hits = nodes.filter((n) => {
    if (role && n.role !== role) return false;
    if (!re) return true;
    return re.test(n.title ?? "") || re.test(n.label ?? "") || re.test(n.value ?? "");
  });
  return hits[nth] ?? null;
}

export function findByIndex(nodes, index) {
  return nodes.find((n) => n.index === index) ?? null;
}

/** 断言用：AX dump 文本里是否有匹配某模式的节点行。 */
export function linesMatching(axText, pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return axText.split("\n").filter((l) => re.test(l)).map((l) => l.trim());
}

export function countMatching(axText, pattern) {
  return linesMatching(axText, pattern).length;
}

/** header 段 = 首个 ``` 围栏之前的那几行元数据（app / pid / element_count / 窗口矩形 / coords / windows）。
 *
 *  窗口矩形、坐标口径与多窗口目录**只在 header 段里认**：AX 正文里出现的同形文本不算数（文档正文
 *  恰好写着 `- window_bounds: x=…` 时，按裸全文匹配会把它当成真实窗口矩形，换算就按正文内容漂）。
 *  反例见 execute.test.mjs 的「正文里的同形行不得当成 header」条。 */
function headerSection(axText) {
  const fence = axText.indexOf("```");
  return fence < 0 ? axText : axText.slice(0, fence);
}

/** 窗口矩形（屏幕点）：**两种键名都认**，语义相同。
 *
 *  KimiCU 0.6.8（2026-10-27 起）把 **mode=full** 的那行改名成 `captured_bounds:`，而 **mode=ax** 仍是
 *  `window_bounds:`——两个键名同时存在于当前构建里，不是版本兼容层：只认一种就会让一半通道的几何
 *  读成 null（2026-10-27 core 批 53/64/159/224/233 五项：pixel / geom / 正文单击 / drag / doubleClick
 *  全退化成「算不出换算」）。窗口矩形与 bbox 的坐标空间（截图像素 / 窗口局部点）是两件事，见
 *  `coordsSpace`。 */
export function windowBounds(axText) {
  const m = /^-\s*(?:captured_bounds|window_bounds):\s*x=(-?\d+)\s+y=(-?\d+)\s+w=(\d+)\s+h=(\d+)/m.exec(headerSection(axText));
  return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
}

/** bbox / 坐标口径（header 的 `coords:` 行自述）：`"window-local"` | `"screenshot-pixels"` | `null`。
 *
 *  同一份快照的 bbox 只有一种空间：`mode=full`（带截图）是**截图像素**，`mode=ax`（不带图）是**窗口
 *  局部点**。两套坐标混用会让注入落到别处，因此「这次是哪种口径」必须是可判的读数，不是猜的。
 *
 *  判据取该行里 `are <口径>` 那一段（大小写不敏感），**不按字面量子串判**：上游 2026-10-27 把说明从
 *  `screenshot:` 行尾搬到独立的 `coords:` 行并改成全大写（`… are WINDOW-LOCAL POINTS …`），按小写
 *  `/window-local/` 匹配会把合格的 ax 快照拒成「口径不是它」（53/159 的现场）。也不能认「同一行里
 *  顺带提到的另一种口径」——ax 那行本身就有 `NOT screenshot pixels` 与 `those still resolve as
 *  screenshot pixels`。
 *
 *  没有 `coords:` 行 = 口径不可判定（旧构建的形态，当前无消费者）→ 返回 null，调用方必须如实报错，
 *  不得默认成任一种口径。 */
export function coordsSpace(axText) {
  const line = /^-\s*coords:\s*(.*)$/m.exec(headerSection(axText))?.[1];
  if (!line) return null;
  const m = /\bare\s+(WINDOW-LOCAL|screenshot pixels)\b/i.exec(line);
  if (!m) return null;
  return /^window-local/i.test(m[1]) ? "window-local" : "screenshot-pixels";
}

const WINDOW_DIR_HEADER_RE = /^-\s*windows:\s*(\d+)\b/m;
const WINDOW_DIR_ENTRY_RE =
  /^\s*-\s*\[(primary|main)\]\s+window_id=(\d+)\s+(AX[A-Za-z]+)(?:\s+"([^"]*)")?(?:\s+@(-?\d+),(-?\d+)\s+(\d+)×(\d+))?/;

/** 多窗口目录（`- windows: N (tree scoped to primary; others via window_id)` 与其下的
 *  `[primary]` / `[main]` 行）。没有这一节 = KimiCU 只看到一扇窗，树就是它。
 *
 *  行形态（2026-10-27 的真机 dump，112 的现场）：
 *    `- windows: 2 (tree scoped to primary; others via window_id)`
 *    `  - [primary] window_id=11687 AXDialog "Window" @14,46 66×20`
 *    `  - [main] window_id=11677 AXStandardWindow "Lumir" @8,40 1200×800` */
export function windowDirectory(axText) {
  const header = headerSection(axText);
  const head = WINDOW_DIR_HEADER_RE.exec(header);
  if (!head) return null;
  const entries = [];
  for (const line of header.split("\n")) {
    const m = WINDOW_DIR_ENTRY_RE.exec(line);
    if (!m) continue;
    entries.push({
      marker: m[1],
      windowId: +m[2],
      role: m[3],
      title: m[4] ?? null,
      bbox: m[5] === undefined ? null : { x: +m[5], y: +m[6], w: +m[7], h: +m[8] },
    });
  }
  return { count: +head[1], entries };
}

/** header 的 `window_title:`（钉窗后核对「读到的确实是那扇窗」用）；没有该行回 null。 */
export function windowTitle(axText) {
  return /^-\s*window_title:\s*(.*)$/m.exec(headerSection(axText))?.[1]?.trim() ?? null;
}

/**
 * 这次读数要不要「钉主窗口」（M761，112 的现场）：KimiCU 把树作用在 **primary** 窗口上，而屏幕上
 * 多出一扇 66×20 的 `AXDialog "Window"`（窗口共享会话控件）抢走 primary 之后，整棵树被截在它身上
 * ——18 个节点、没有主窗的按钮行，场景的节点断言因此判红，而产品当时完全正常。套件具备钉窗的接口
 * （`CuClient.state` 的 `windowId`），缺的是「选哪扇窗」这一步。
 *
 * 三态返回（调用方必须分开处理，不得把 error 当「没有多窗口」）：
 *   `{ pin: null }`   树已经作用在主窗上（或根本没有多窗口目录）——直接用这次读数；
 *   `{ pin: entry }`  树被作用在别的窗上——用该 entry 的 `windowId` 重读；
 *   `{ error: "…" }`  多窗口但主窗不可判定——调用方报**环境错误**，不得把辅助窗口的树当成「界面
 *                     就是这些」（REVIEW.md「读不到当成空」条：那是最像假绿的形态）。
 *
 * 选窗口径：只认 `AXStandardWindow`（Lumir 的主窗就是它，辅助窗是 `AXDialog`）。多扇标准窗时用
 * KimiCU 的 `[main]` 标记消歧，标记不唯一就报不可判定——**不按面积猜、不退回 primary**。
 */
export function mainWindowPlan(axText) {
  const dir = windowDirectory(axText);
  if (!dir) return { pin: null };
  const standards = dir.entries.filter((e) => e.role === "AXStandardWindow");
  const listing = dir.entries.map((e) => `[${e.marker}] ${e.role} ${JSON.stringify(e.title ?? "")}`).join(" / ");
  if (standards.length === 0) {
    return {
      error: `windows 目录（${dir.count} 扇）里没有 AXStandardWindow 主窗——条目：${listing || "（解析不到条目）"}`,
    };
  }
  let target;
  if (standards.length === 1) target = standards[0];
  else {
    const marked = standards.filter((e) => e.marker === "main");
    if (marked.length !== 1) {
      return {
        error: `有 ${standards.length} 扇 AXStandardWindow 而 [main] 标记不唯一（${marked.length} 条），主窗不可判定——条目：${listing}`,
      };
    }
    target = marked[0];
  }
  const primary = dir.entries.find((e) => e.marker === "primary");
  if (primary && primary.windowId === target.windowId) return { pin: null };
  return { pin: target };
}
