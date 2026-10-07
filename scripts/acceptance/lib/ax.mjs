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

export function windowBounds(axText) {
  const m = /window_bounds:\s*x=(-?\d+)\s+y=(-?\d+)\s+w=(\d+)\s+h=(\d+)/.exec(axText);
  return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
}

/** 一次 get_app_state 的结果摘要（写进证据目录的 header）。 */
export function summarizeState({ text, image }) {
  const nodes = parseNodes(text);
  const bbox = windowBounds(text);
  return {
    elementCount: nodes.length,
    windowBounds: bbox,
    truncated: /truncated:\s*(true|false)/.exec(text)?.[1] ?? null,
    hasScreenshot: Boolean(image),
  };
}
