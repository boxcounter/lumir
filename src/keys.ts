// 统一键位层（M131）——全应用唯一的 key → command 分发表。
//
// 收敛前同一物理组合散在五条互不知情的旁路里（M129 survey）：
//   A keys.ts 的 window 级 trie（Mod-Enter）
//   B editor.ts 的 CM keymap（⌃N/P/F/B/E + ArrowUp/Down）
//   C editor.ts 的 domEventHandlers（⌘A 与 ⌃A 都当全选）
//   E main.ts 的裸 window 监听（⌘S 与 ⌃S 都当保存）
//   D livePreview.ts 的 widget 焦点作用域（表格滚动容器的滚动键）
// 合并 e.metaKey || e.ctrlKey 让 ⌘ 与 ⌃ 无法分离（D1 裁决要求拆开）；同一组合两处各
// 写一份，改一处就会漏另一处。现在只有 KEY_BINDINGS 一张表 + Keymap 一个分发器：
//   - scope "global"：任意焦点都生效（轨道 E 的 ⌘S 与轨道 A 的 ⌘Enter 原样迁入）。
//   - scope "editor"：事件目标落在编辑器内容区内才生效。判定用「目标在 contentDOM 内」
//     而非「焦点在编辑器上」——轨道 D 的 widget（表格滚动容器）就在 contentDOM 里，
//     焦点落在其中时 editor 作用域的命令照常委托到同一命令层，而 widget 自己的键
//     （Escape / Home / End / 左右方向键）由 livePreview 的手柄先消费：本层入口检查
//     event.defaultPrevented，被消费品的事件不改 chord 状态、直接让路。
//   - 命令实现留在各自模块（editor.* 在 editor.ts，文档/链接命令在 main.ts），经
//     attach 注入。CommandId 由 COMMAND_IDS 派生，Record<CommandId, CommandRunner> 把
//     「表里每条绑定都有归属命令」变成编译期合同；构造函数再对重复键抛错、attach 再对
//     缺实现抛错（运行期兜底）。
// chorded + 非 modal（ADR 0001 §4）不变：多段 chord 的 trie 与超时清空机制照搬，只是
// 建表来源从「各处 register 调用」换成 KEY_BINDINGS。当前表内没有多段 chord。

export type KeyScope = "global" | "editor";

/** 编辑器侧命令 id（实现落在 editor.ts 的 commands 记录）。 */
export const EDITOR_COMMAND_IDS = [
  "editor.cursor-up",
  "editor.cursor-down",
  "editor.cursor-forward",
  "editor.cursor-backward",
  "editor.line-start",
  "editor.line-end",
  "editor.select-all",
  "editor.undo",
  "editor.redo",
] as const;

/** 全局命令 id（实现落在装配层 main.ts）。 */
export const GLOBAL_COMMAND_IDS = ["document.save", "wikilink.follow"] as const;

/** 全部命令 id：类型与运行期清单同源，测试据此断言无孤儿命令、无越界绑定。 */
export const COMMAND_IDS = [...EDITOR_COMMAND_IDS, ...GLOBAL_COMMAND_IDS] as const;

export type EditorCommandId = (typeof EDITOR_COMMAND_IDS)[number];
export type CommandId = (typeof COMMAND_IDS)[number];

export interface KeyBinding {
  /** 绑定写法：空格分段表示多段 chord；段内是修饰前缀 + `KeyboardEvent.key` 键名。 */
  key: string;
  command: CommandId;
  scope: KeyScope;
  /** 这条绑定的归属与来由——表即文档，新绑定必须写清为什么是它。 */
  doc: string;
}

/**
 * 唯一分发表（D1/D2/D3 落点见各条 doc）。键位 token 的口径：
 *
 * - 修饰键逐个记录：Cmd（⌘）/ Ctrl（⌃）/ Alt（⌥）/ Shift，**不再合并成 Mod**——
 *   ⌘ 系全归 mac 惯例、⌃ 系全归 Emacs（D1），两者必须可判别。
 * - 键名取 `KeyboardEvent.key` 拼写，单字符一律大写；修饰前缀顺序无关（归一化）。
 * - US 布局上必须按 Shift 才能打出的符号（`_ + { } | : " < > ? ~ ! @ # $ % ^ & * ( )`）
 *   按「Shift 已隐含在字符里」处理：⌃_ 在 mac 键盘上物理是 ⌃⇧-，事件给的是
 *   key="_" + shiftKey=true，表里写 `Ctrl-_` 即可匹配，不必写成 `Ctrl-Shift-_`。
 * - **含 Alt 的组合写物理键名**（`KeyboardEvent.code`，如 `Minus`）：macOS 的 Alt 层会
 *   替换字符（⌥⇧- → "—"、⌥a → "å"），`e.key` 判别不了用户按的键。⌃⌥_ 这条 Emacs 别名
 *   物理是 ⌃⌥⇧-，表里因此写 `Ctrl-Alt-Minus`；Shift 不参与该判定（已隐含在字符里）。
 */
export const KEY_BINDINGS: readonly KeyBinding[] = [
  // ── 编辑器内：垂直移动（M103 硬化路径：逐视觉行 + 跨原子块钳制 + SelectionRange 揭示）
  { key: "ArrowDown", command: "editor.cursor-down", scope: "editor", doc: "全平台接管：原生 contenteditable 路径越出视口时整屏跳变（M103）" },
  { key: "ArrowUp", command: "editor.cursor-up", scope: "editor", doc: "同上（M103）" },
  { key: "Ctrl-n", command: "editor.cursor-down", scope: "editor", doc: "macOS 文本系统 Emacs 惯例 ⌃N；原生路径跨原子块落点错误（M110 同族）" },
  { key: "Ctrl-p", command: "editor.cursor-up", scope: "editor", doc: "macOS 文本系统 Emacs 惯例 ⌃P" },

  // ── 编辑器内：水平移动（M110/M111 硬化路径：原子块跨入钳制 + 退化测量回退）
  { key: "Ctrl-f", command: "editor.cursor-forward", scope: "editor", doc: "原生 caret 进不了 replace 公式 widget，边界回弹（M110/M111）" },
  { key: "Ctrl-b", command: "editor.cursor-backward", scope: "editor", doc: "同上（M110/M111）" },

  // ── 编辑器内：行首 / 行尾（对称的一对；⌃E 既有，⌃A 本 mission 新增）
  { key: "Ctrl-e", command: "editor.line-end", scope: "editor", doc: "行尾；落点藏进隐藏 replace 时回退到最后可停靠位（M118）" },
  { key: "Ctrl-a", command: "editor.line-start", scope: "editor", doc: "D2 裁决：⌃A = 行首（Emacs C-a），与 ⌃E 对称；全选改由 ⌘A 承担" },

  // ── 编辑器内：全选（⌘ 系归 mac 惯例）
  { key: "Cmd-a", command: "editor.select-all", scope: "editor", doc: "D1/D2：⌘A 保留全选，与 macOS 原生 Edit 菜单同键（菜单项不带 accelerator 时由本层兜底，见 lib.rs）" },

  // ── 编辑器内：撤销 / 重做（M131 新增能力，CM history 线性双栈，见 editor.ts）
  { key: "Cmd-z", command: "editor.undo", scope: "editor", doc: "mac 惯例撤销；原生 Edit 菜单的 Undo 项已让出该键（lib.rs）" },
  { key: "Cmd-Shift-z", command: "editor.redo", scope: "editor", doc: "mac 惯例重做；原生 Edit 菜单的 Redo 项已让出该键（lib.rs）" },
  { key: "Ctrl-/", command: "editor.undo", scope: "editor", doc: "Emacs 规范绑定 C-/" },
  { key: "Ctrl-_", command: "editor.undo", scope: "editor", doc: "Emacs 别名 C-_（mac 物理为 ⌃⇧-，token 口径见上）" },
  { key: "Ctrl-Alt-Minus", command: "editor.redo", scope: "editor", doc: "Emacs 系重做别名 ⌃⌥_（mac 键盘物理为 ⌃⌥⇧-；Alt 层把 - 换成 —，故按物理键 Minus 判定，见上）" },

  // ── 全局
  { key: "Cmd-s", command: "document.save", scope: "global", doc: "D3 裁决：⌘S 是唯一保存键；⌃S 解绑（预留给 isearch），不再触发保存" },
  { key: "Cmd-Enter", command: "wikilink.follow", scope: "global", doc: "轨道 A 原样迁入：迁移前挂在 window 上（任意焦点生效），作用域不变" },
];

/** 命令实现：命中即已消费——分发器统一吞掉默认行为，命令本身无事可做也不放行原生路径。 */
export type CommandRunner = () => void;

/** 命令实现表：缺任何一条 command id 都是编译错误。 */
export type CommandRuntime = Record<CommandId, CommandRunner>;

export interface KeymapContext {
  /** 事件目标是否落在编辑器内容区内（含其中的 widget，如表格滚动容器）。 */
  isEditorEvent(event: KeyboardEvent): boolean;
}

/** chord 进行中 buffer 的清空超时（ms）。 */
const CHORD_TIMEOUT_MS = 1500;

/** 单独按下不构成键位的修饰键（`KeyboardEvent.key` 口径）。 */
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

/** 修饰前缀写法 → 表内规范拼写（大小写与别名都收，避免表内写法漂移成静默不匹配）。 */
const MODIFIER_ALIASES = new Map<string, string>([
  ["cmd", "Cmd"],
  ["command", "Cmd"],
  ["meta", "Cmd"],
  ["ctrl", "Ctrl"],
  ["control", "Ctrl"],
  ["alt", "Alt"],
  ["option", "Alt"],
  ["shift", "Shift"],
]);

/** 表内修饰前缀的规范顺序。 */
const MODIFIER_ORDER = ["Cmd", "Ctrl", "Alt", "Shift"] as const;

/** US 布局需 Shift 才能打出的符号：Shift 已隐含在字符本身，token 里不再重复。 */
const SHIFT_IMPLIED_KEYS = new Set([..."_+{}|:\"<>?~!@#$%^&*()"]);

/**
 * 规范化一个键位 token：修饰前缀按 Cmd/Ctrl/Alt/Shift 定序、键名单字符大写。
 * 表内绑定与运行期事件共用本函数，保证两侧口径一致（否则静默不匹配）。
 */
export function normalizeKey(raw: string): string {
  const parts = raw.split("-");
  const mods = new Set<string>();
  let index = 0;
  for (; index < parts.length; index++) {
    const prefix = MODIFIER_ALIASES.get(parts[index].toLowerCase());
    if (prefix === undefined) break;
    mods.add(prefix);
  }
  const key = parts.slice(index).join("-");
  if (key === "") throw new Error(`键位 token 缺键名：${raw}`);
  const named = key.length === 1 ? key.toUpperCase() : key;
  if (SHIFT_IMPLIED_KEYS.has(named)) mods.delete("Shift");
  return [...MODIFIER_ORDER.filter((mod) => mods.has(mod)), named].join("-");
}

/** 事件里与键位判定相关的字段（纯结构，便于脱离 DOM 断言口径）。
 *  `code` 允许缺省（测试合成事件）：缺省时含 Alt 的组合回落 `e.key`。 */
export type KeyEventLike = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> & {
  code?: string;
};

/** 把一个 keydown 事件规范化为 token（如 "Cmd-Shift-Z"）；纯修饰键返回 null。 */
export function keyToken(event: KeyEventLike): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const mods: string[] = [];
  if (event.metaKey) mods.push("Cmd");
  if (event.ctrlKey) mods.push("Ctrl");
  if (event.altKey) mods.push("Alt");
  // 含 Alt 的组合按**物理键**判定（`KeyboardEvent.code`，与布局无关）：macOS 的 Alt 层
  // 会替换字符——⌥⇧- 给的是 "—"（em dash）、⌥a 给的是 "å"——e.key 里拿不到用户想按的
  // 那个字符，只有 code 能判别（⌃⌥_ 这条 Emacs 别名在真机上就这么活）。Shift 一并忽略：
  // 需要 Shift 才能打出的字符已经写在绑定本身里（表内写物理键名），重复要求只会让平台间
  // 与合成事件（Playwright 的 Control+Alt+_ 不带 shiftKey）互相失配。
  if (event.altKey && event.code !== undefined) {
    return normalizeKey([...mods, event.code].join("-"));
  }
  if (event.shiftKey) mods.push("Shift");
  return normalizeKey([...mods, event.key].join("-"));
}

/** 多段 chord 拆段（空格分段）。 */
function segmentsOf(sequence: string): string[] {
  return sequence.trim().split(/\s+/).map(normalizeKey);
}

interface TrieNode {
  children: Map<string, TrieNode>;
  binding?: KeyBinding;
}

export class Keymap {
  private readonly bindings: readonly KeyBinding[];
  private readonly root: TrieNode = { children: new Map() };
  private pending: TrieNode | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(bindings: readonly KeyBinding[] = KEY_BINDINGS) {
    this.bindings = bindings;
    for (const binding of bindings) {
      let node = this.root;
      for (const segment of segmentsOf(binding.key)) {
        let child = node.children.get(segment);
        if (!child) {
          child = { children: new Map() };
          node.children.set(segment, child);
        }
        node = child;
      }
      // 一条键位只能有一个归属：重复即是表写错了（旧实现是后注册者覆盖前者，静默）。
      if (node.binding) {
        throw new Error(`键位表重复绑定：${binding.key} 与 ${node.binding.key} 归一到同一序列`);
      }
      node.binding = binding;
    }
  }

  /** 挂到目标上开始分发；返回解绑函数。 */
  attach(target: Window, runtime: CommandRuntime, ctx: KeymapContext): () => void {
    for (const binding of this.bindings) {
      if (runtime[binding.command] === undefined) {
        throw new Error(`键位表绑定 ${binding.key} → ${binding.command} 没有命令实现`);
      }
    }
    const onKeydown = (event: KeyboardEvent) => this.handle(event, runtime, ctx);
    target.addEventListener("keydown", onKeydown);
    return () => target.removeEventListener("keydown", onKeydown);
  }

  private handle(event: KeyboardEvent, runtime: CommandRuntime, ctx: KeymapContext): void {
    // 更靠近事件目标的处理器（widget 焦点内的滚动键、双击选词等）已经消费：让路。
    if (event.defaultPrevented) {
      this.reset();
      return;
    }
    // IME 组合期不接管（原 CM keymap 由 ignoreDuringComposition 挡住同一批事件；
    // 229 是旧口径的「输入法正在处理」信号）。
    if (event.isComposing || event.keyCode === 229) return;

    const token = keyToken(event);
    if (token === null) return; // 纯修饰键不改变 chord 状态

    const from = this.pending ?? this.root;
    const next = from.children.get(token);
    if (!next) {
      // 不在任何 chord 路径上：清空 pending，按键照常透传。
      this.reset();
      return;
    }

    const binding = next.binding;
    if (binding) {
      this.reset();
      if (binding.scope === "editor" && !ctx.isEditorEvent(event)) return; // 作用域外：不消费
      event.preventDefault();
      runtime[binding.command]();
      return;
    }

    // 命中 chord 前缀：进入 pending（吞掉默认行为），超时清空。
    event.preventDefault();
    this.pending = next;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.reset(), CHORD_TIMEOUT_MS);
  }

  private reset(): void {
    this.pending = null;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
