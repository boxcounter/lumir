// 键位字形（change improve-keybindings-lookup-oct24，design §2.3）：token → 人类字形的**唯一**实现。
//
// 面板只渲染这里产出的字形，MUST NOT 把原始 token（`Ctrl-Alt-KeyS` / `Cmd-}`）直接写给人看——
// 用户按的是物理键，`}` / `<` / `_` / `+` 这类字符在 US 布局上必须按住 Shift 才打得出。
//
// 规则：
//   1. 修饰键顺序取 Apple HIG 的 ⌃⌥⇧⌘（Control / Option / Shift / Command），如 `⇧⌘O`；
//   2. 需要 Shift 才能打出的字符反解成物理键并补 `⇧`（`Cmd-}` → `⇧⌘]`、`Cmd-<` → `⇧⌘,`）；
//      `SHIFT_IMPLIED_KEYS` 与 `src/keys.ts` 同源（MUST NOT 另抄一份集合）；
//   3. 具名键映射（方向键 / Tab / Esc / Backspace / Delete / PageUp / PageDown / Space），
//      `KeyboardEvent.code` 形态（Alt 组合的 token）也映射到同一个字面；
//   4. 单字符键大写；`KeyS` / `Digit1` 去前缀；
//   5. 未知键名原样显示；含空白的多段 chord 本版不支持（`[keys]` 也拒绝），不造伪字形。
//
// 归一化复用 `normalizeKey`：字形与分发层认的是同一个 token，两处口径不许漂。

import { SHIFT_IMPLIED_KEYS, normalizeKey } from "./keys";

/** 修饰键字形，顺序即 Apple HIG 的书写顺序。 */
const MODIFIER_GLYPHS: ReadonlyArray<readonly [string, string]> = [
  ["Ctrl", "⌃"],
  ["Alt", "⌥"],
  ["Shift", "⇧"],
  ["Cmd", "⌘"],
];

const MODIFIER_NAMES = new Set(MODIFIER_GLYPHS.map(([name]) => name));

/** US 布局上 Shift 形态 → 物理键：反解后补 `⇧`，不把字符本身写给人看。 */
const SHIFTED_TO_PHYSICAL: Readonly<Record<string, string>> = {
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  _: "-",
  "+": "=",
  "{": "[",
  "}": "]",
  "|": "\\",
  ":": ";",
  '"': "'",
  "<": ",",
  ">": ".",
  "?": "/",
  "~": "`",
};

const NAMED_KEY_GLYPHS: Readonly<Record<string, string>> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Tab: "⇥",
  Escape: "Esc",
  Backspace: "⌫",
  Delete: "⌦",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Space: "Space",
};

/** 含 Alt 的组合按 `KeyboardEvent.code` 判定（见 keys.ts 的 keyToken），这里给同一族码位一个可读字形。 */
const CODE_GLYPHS: Readonly<Record<string, string>> = {
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Backquote: "`",
};

/** 单个键名（已剥掉修饰前缀）→ 字形。 */
function keyGlyph(key: string): string {
  const named = NAMED_KEY_GLYPHS[key];
  if (named !== undefined) return named;
  const code = CODE_GLYPHS[key];
  if (code !== undefined) return code;
  const letter = /^Key([A-Z])$/.exec(key);
  if (letter !== null) return letter[1] as string;
  const digit = /^Digit([0-9])$/.exec(key);
  if (digit !== null) return digit[1] as string;
  return key.length === 1 ? key.toUpperCase() : key;
}

/** token → 人类字形（如 `Shift-Cmd-o` → `⇧⌘O`）。无法解析的 token 原样返回，不抛错。 */
export function glyphOfToken(token: string): string {
  let normalized: string;
  try {
    normalized = normalizeKey(token);
  } catch {
    return token;
  }
  const parts = normalized.split("-");
  const mods = new Set<string>();
  let index = 0;
  for (; index < parts.length; index += 1) {
    const part = parts[index] as string;
    if (!MODIFIER_NAMES.has(part)) break;
    mods.add(part);
  }
  const key = parts.slice(index).join("-");
  if (key === "") return normalized;

  let glyph = keyGlyph(key);
  const physical = SHIFTED_TO_PHYSICAL[key];
  if (physical !== undefined) {
    glyph = keyGlyph(physical);
    mods.add("Shift");
  } else if (SHIFT_IMPLIED_KEYS.has(key)) {
    mods.add("Shift");
  }
  const prefix = MODIFIER_GLYPHS.filter(([name]) => mods.has(name))
    .map(([, symbol]) => symbol)
    .join("");
  return `${prefix}${glyph}`;
}
