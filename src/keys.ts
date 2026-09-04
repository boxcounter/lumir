// 键位框架接缝 —— M1 只建注册/分发骨架，不绑定任何具体功能（架构复查 P2-7）。
//
// 设计约束（ADR 0001 §4）：chorded + 非 modal。
// - chorded：命令可绑定多段按键序列（如 "Mod-K Mod-T"），像 VS Code。
// - 非 modal：没有 Vim 式 mode 状态机。框架唯一的状态是 chord 进行中的
//   pending buffer，超时自动清空；中文输入法切换不会与之构成双重状态机。
//
// chord 语法：空格分段，每段为 "Mod-Shift-K" 形式；Mod = macOS Cmd / 其他平台 Ctrl。

export type CommandId = string;
export type KeyDispatch = (command: CommandId, event: KeyboardEvent) => void;

/** chord 进行中 buffer 的清空超时（ms）。 */
const CHORD_TIMEOUT_MS = 1500;

interface TrieNode {
  children: Map<string, TrieNode>;
  command?: CommandId;
}

/** 把一个 keydown 事件规范化为 token（如 "Mod-Shift-K"）；纯修饰键返回 null。 */
function tokenOf(e: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  const mods: string[] = [];
  if (e.metaKey || e.ctrlKey) mods.push("Mod");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [...mods, key].join("-");
}

export class Keymap {
  private root: TrieNode = { children: new Map() };
  private pending: TrieNode | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** 注册 chord 序列到命令。重复注册同一序列后者覆盖前者。 */
  register(sequence: string, command: CommandId): void {
    let node = this.root;
    for (const token of sequence.trim().split(/\s+/)) {
      let child = node.children.get(token);
      if (!child) {
        child = { children: new Map() };
        node.children.set(token, child);
      }
      node = child;
    }
    node.command = command;
  }

  /** 挂到目标上开始分发；返回解绑函数。 */
  attach(target: Window, dispatch: KeyDispatch): () => void {
    const onKeydown = (e: KeyboardEvent) => this.handle(e, dispatch);
    target.addEventListener("keydown", onKeydown);
    return () => target.removeEventListener("keydown", onKeydown);
  }

  private handle(e: KeyboardEvent, dispatch: KeyDispatch): void {
    const token = tokenOf(e);
    if (token === null) return; // 纯修饰键不改变 chord 状态

    const from = this.pending ?? this.root;
    const next = from.children.get(token);

    if (!next) {
      // 不在任何 chord 路径上：清空 pending，按键照常透传。
      this.reset();
      return;
    }

    e.preventDefault();
    if (next.command !== undefined) {
      this.reset();
      dispatch(next.command, e);
      return;
    }

    // 命中 chord 前缀：进入 pending，超时清空。
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
