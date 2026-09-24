// AX 树文本的解析与检索。
//
// KimiCU 的 get_app_state 把 AX 树渲染成缩进文本，每行形如：
//   - [11] AXButton (vault：slax-reader-demo（点击查看全部 vault）) @191,54 37×21 actions=[AXPress]
//    - [8] AXStaticText = "slax-reader-demo 无当前文件"
//     - [5] AXWebArea (Lumir)
// 套件的两类断言（找可点节点、找文本证据）都建立在这个解析上。

const LINE_RE = /^\s*-\s*\[(\d+)\]\s+(AX[A-Za-z]+|AXWebArea)\b(.*)$/;

export function parseNodes(axText) {
  const lines = axText.split("\n");
  const nodes = [];
  for (let i = 0; i < lines.length; i++) {
    const m = LINE_RE.exec(lines[i]);
    if (!m) continue;
    // AXTextArea 的 value 是多行文档文本，用真实换行展开在若干行里：引号未闭合时把后续行
    // 并入本节点，否则 value 抓不全（编辑器内容断言全靠这个字段）。
    const firstLine = lines[i];
    let raw = firstLine;
    while (i + 1 < lines.length && (raw.match(/"/g) ?? []).length % 2 === 1) {
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
    const value =
      /=\s*"([\s\S]*?)"/.exec(rest)?.[1] ??
      /Value:\s*(.*?)(?=\s+@|\s+actions=|$)/.exec(rest)?.[1] ??
      null;
    nodes.push({
      index: Number(idx),
      role,
      title: /"([^"]*)"/.exec(rest)?.[1] ?? null,
      label: /\(([^)]*)\)/.exec(rest)?.[1] ?? null,
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
