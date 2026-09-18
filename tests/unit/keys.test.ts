// src/keys.ts 的纯逻辑单测：token 归一化、keyToken 的事件口径、表的不变量、分发器行为。
// 这些判定此前只由 228 个浏览器场景间接兜底（打错一个 token 的表现是「某个键静默不动」），
// 本层把它们拉成可复现的断言（M153）。

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import {
  BLOCK_SCROLL_CLASS,
  COMMAND_IDS,
  EDITOR_COMMAND_IDS,
  KEYLESS_COMMAND_IDS,
  KEY_BINDINGS,
  Keymap,
  TABLE_SCROLL_CLASS,
  TAB_GOTO_IDS,
  WIDGET_COMMAND_IDS,
  applyKeyOverrides,
  keyToken,
  normalizeKey,
} from "../../src/keys.ts";
import type { CommandRuntime, KeyBinding } from "../../src/keys.ts";

// ---------------------------------------------------------------------------
// token 归一化
// ---------------------------------------------------------------------------

test("normalizeKey：修饰别名归一、定序固定、键名单字符大写", () => {
  assert.equal(normalizeKey("cmd-s"), "Cmd-S");
  assert.equal(normalizeKey("Meta-S"), "Cmd-S");
  assert.equal(normalizeKey("Command-Shift-z"), "Cmd-Shift-Z");
  // 修饰前缀顺序无关，输出恒按 Cmd/Ctrl/Alt/Shift 定序
  assert.equal(normalizeKey("shift-meta-a"), "Cmd-Shift-A");
  assert.equal(normalizeKey("shift-ctrl-alt-p"), "Ctrl-Alt-Shift-P");
  // 多字符键名（物理键 / 命名键）保持原样
  assert.equal(normalizeKey("Ctrl-Alt-Minus"), "Ctrl-Alt-Minus");
  assert.equal(normalizeKey("ArrowDown"), "ArrowDown");
  // 物理键名带连字符的情形（KeyboardEvent.code 可能出现）不被拆坏
  assert.equal(normalizeKey("Alt-_-d"), "Alt-_-d");
});

test("normalizeKey：Shift 隐含在需要它的符号里（表与事件同一口径）", () => {
  assert.equal(normalizeKey("Ctrl-Shift-_"), "Ctrl-_");
  assert.equal(normalizeKey("Ctrl-_"), "Ctrl-_");
  assert.equal(normalizeKey("Ctrl-Shift-/"), "Ctrl-Shift-/"); // / 不在隐含集合里，Shift 保留
});

test("normalizeKey：缺键名直接抛错（不静默产出错 token）", () => {
  assert.throws(() => normalizeKey(""));
  assert.throws(() => normalizeKey("Cmd-"));
  assert.throws(() => normalizeKey("Shift-"));
});

// ---------------------------------------------------------------------------
// keyToken：事件 → token
// ---------------------------------------------------------------------------

const base = { key: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

test("keyToken：修饰键映射与纯修饰键忽略", () => {
  assert.equal(keyToken({ ...base, key: "s", metaKey: true }), "Cmd-S");
  assert.equal(keyToken({ ...base, key: "S", metaKey: true, shiftKey: true }), "Cmd-Shift-S");
  assert.equal(keyToken({ ...base, key: "n", ctrlKey: true }), "Ctrl-N");
  assert.equal(keyToken({ ...base, key: "Meta", metaKey: true }), null);
  assert.equal(keyToken({ ...base, key: "Shift", shiftKey: true }), null);
  assert.equal(keyToken({ ...base, key: "Alt", altKey: true }), null);
  assert.equal(keyToken({ ...base, key: "Control", ctrlKey: true }), null);
});

test("keyToken：含 Alt 的组合按物理键 code 判定，无 code 时回落 e.key", () => {
  // 真机 ⌃⌥⇧-：macOS 的 Alt 层把 - 换成 —，e.key 认不出用户按的是哪个键，只有 code 能判
  const realAlt = keyToken({
    ...base,
    key: "—",
    code: "Minus",
    ctrlKey: true,
    altKey: true,
    shiftKey: true,
  });
  assert.equal(realAlt, "Ctrl-Alt-Minus");
  // 合成事件（Playwright 的 Control+Alt+_ 不带 shiftKey / 无 code）：回落 e.key
  assert.equal(keyToken({ ...base, key: "v", altKey: true }), "Alt-V");
  assert.equal(keyToken({ ...base, key: "_", ctrlKey: true, altKey: true, shiftKey: true }), "Ctrl-Alt-_");
});

// ---------------------------------------------------------------------------
// 表的不变量（表即真源，这里守它的自洽）
// ---------------------------------------------------------------------------

const commandIds = COMMAND_IDS as readonly string[];
const editorCommandIds = EDITOR_COMMAND_IDS as readonly string[];

test("KEY_BINDINGS：token 唯一、命令都在 COMMAND_IDS 里、作用域与命令组一致", () => {
  const tokens = KEY_BINDINGS.map((binding) => binding.key.split(/\s+/).map(normalizeKey).join(" "));
  assert.equal(new Set(tokens).size, tokens.length, "表内存在归一到同一序列的绑定");
  assert.equal(KEY_BINDINGS.length, tokens.length);
  for (const binding of KEY_BINDINGS) {
    assert.ok(commandIds.includes(binding.command), `${binding.key} → ${binding.command} 不在 COMMAND_IDS`);
    // scope 由命令归属决定：editor 组命令只能绑 editor，其余只能绑 global（配置重绑同口径）
    assert.equal(
      binding.scope,
      editorCommandIds.includes(binding.command) ? "editor" : "global",
      `${binding.key} 的作用域与 ${binding.command} 的命令组不一致`,
    );
    assert.ok(binding.doc.length > 0, `${binding.key} 缺少来由说明（表即文档）`);
  }
  // 构造期再兜一次：表本身能建成（不抛重复键）
  assert.doesNotThrow(() => new Keymap());
});

test("KEY_BINDINGS：⌘1–9 与 TAB_GOTO_IDS 按序号逐一对应，标签族绑定齐全", () => {
  TAB_GOTO_IDS.forEach((command, index) => {
    const binding = KEY_BINDINGS.find((item) => item.command === command);
    assert.ok(binding !== undefined, `缺少 ${command} 的绑定`);
    assert.equal(binding.key, `Cmd-${index + 1}`);
    assert.equal(binding.scope, "global");
  });
  assert.equal(KEY_BINDINGS.find((item) => item.key === "Cmd-w")?.command, "tab.close");
  assert.equal(KEY_BINDINGS.find((item) => item.key === "Ctrl-Tab")?.command, "tab.next");
  assert.equal(KEY_BINDINGS.find((item) => item.key === "Ctrl-Shift-Tab")?.command, "tab.prev");
  // widget 焦点键都在表里，且都带 when 条件（否则会吞掉文本编辑里的同名键）
  for (const command of WIDGET_COMMAND_IDS) {
    const binding = KEY_BINDINGS.find((item) => item.command === command);
    assert.ok(binding !== undefined, `缺少 ${command} 的绑定`);
    assert.equal(binding.scope, "editor");
    assert.ok(binding.when !== undefined, `${command} 缺少 when 命中条件`);
  }
});

test("Keymap：同一序列绑两次是表写错了，构造即抛错", () => {
  const duplicate: KeyBinding[] = [
    { key: "Cmd-s", command: "document.save", scope: "global", doc: "" },
    { key: "cmd-S", command: "document.save", scope: "global", doc: "" },
  ];
  assert.throws(() => new Keymap(duplicate), /重复绑定/);
});

// ---------------------------------------------------------------------------
// 分发器
// ---------------------------------------------------------------------------

interface FakeKeyEvent {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
  defaultPrevented: boolean;
  target: unknown;
  preventDefault(): void;
}

function keyEvent(init: Partial<FakeKeyEvent> = {}): FakeKeyEvent {
  const event: FakeKeyEvent = {
    key: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    keyCode: 0,
    defaultPrevented: false,
    target: undefined,
    preventDefault() {
      event.defaultPrevented = true;
    },
    ...init,
  };
  return event;
}

/** window 的最小替身：只要 add/removeEventListener 与一个手动派发口。 */
function fakeWindow() {
  const listeners = new Set<(event: unknown) => void>();
  const target = {
    addEventListener: (_type: string, fn: (event: unknown) => void) => void listeners.add(fn),
    removeEventListener: (_type: string, fn: (event: unknown) => void) => void listeners.delete(fn),
  } as unknown as Window;
  return {
    target,
    fire(event: FakeKeyEvent) {
      for (const listener of listeners) listener(event);
    },
    listenerCount: () => listeners.size,
  };
}

/** 命令实现表替身：任何 command id 都记录一条调用（attach 的缺实现检查因此通过）。 */
function recordingRuntime() {
  const runs: string[] = [];
  const runtime = new Proxy(
    {},
    {
      get: (_target, prop) => () => void runs.push(String(prop)),
    },
  ) as unknown as CommandRuntime;
  return { runtime, runs };
}

/** 块级横滚容器替身：`closest` 命中（事件目标在容器内）与「容器自身持有焦点」共同决定 when
 *  条件真假——M180 起判据是两者的**与**（只按前者会把光标落在块内文本时的方向键吞掉）。
 *  写成显式字段而非 TS 参数属性：类型剥离不认参数属性（可擦除语法限制）。 */
class FakeElement {
  readonly inContainer: boolean;
  readonly containerFocused: boolean;
  constructor(inContainer: boolean, containerFocused = inContainer) {
    this.inContainer = inContainer;
    this.containerFocused = containerFocused;
  }
  closest(): FakeElement | null {
    return this.inContainer ? this : null;
  }
  get ownerDocument(): { activeElement: FakeElement | null } {
    return { activeElement: this.containerFocused ? this : null };
  }
}

test("Keymap：editor 作用域只在编辑器事件内消费，作用域外不 preventDefault", () => {
  const host = fakeWindow();
  const { runtime, runs } = recordingRuntime();
  let inEditor = true;
  const keymap = new Keymap();
  keymap.attach(host.target, runtime, { isEditorEvent: () => inEditor });

  host.fire(keyEvent({ key: "ArrowDown" }));
  assert.deepEqual(runs, ["editor.cursor-down"]);

  inEditor = false;
  const outside = keyEvent({ key: "ArrowDown" });
  host.fire(outside);
  assert.equal(outside.defaultPrevented, false, "作用域外不消费，事件要留给原生路径");
  assert.deepEqual(runs, ["editor.cursor-down"]);

  // 全局绑定任意焦点都生效
  host.fire(keyEvent({ key: "s", metaKey: true }));
  assert.deepEqual(runs, ["editor.cursor-down", "document.save"]);
});

test("Keymap：when 条件不满足时不消费（widget 键不吞文本编辑里的同名键）", () => {
  globalThis.Element = FakeElement as unknown as typeof Element;
  const host = fakeWindow();
  const { runtime, runs } = recordingRuntime();
  new Keymap().attach(host.target, runtime, { isEditorEvent: () => true });

  // 焦点在编辑器文本里：事件目标根本不在容器内
  const inText = keyEvent({ key: "ArrowLeft", target: new FakeElement(false) });
  host.fire(inText);
  assert.equal(inText.defaultPrevented, false);
  assert.deepEqual(runs, []);

  // M180 收紧的那一格：光标落在块内文本（事件目标在容器内，但活动元素是编辑器内容区）
  const insideContainerText = keyEvent({ key: "ArrowLeft", target: new FakeElement(true, false) });
  host.fire(insideContainerText);
  assert.equal(insideContainerText.defaultPrevented, false, "容器没持有焦点时不消费，方向键归 caret");
  assert.deepEqual(runs, []);

  // 容器自身持有焦点：命中
  const inWidget = keyEvent({ key: "ArrowLeft", target: new FakeElement(true) });
  host.fire(inWidget);
  assert.equal(inWidget.defaultPrevented, true);
  assert.deepEqual(runs, ["editor.widget-scroll-left"]);

  assert.equal(BLOCK_SCROLL_CLASS, "cm-lp-block-scroll");
  assert.equal(TABLE_SCROLL_CLASS, "cm-lp-table-scroll", "表格容器保留原 class（既有选择器与断言按它定位）");
});

test("Keymap：已消费事件让路、IME 组合期与 229 不接管、无关键不动 pending", () => {
  const host = fakeWindow();
  const { runtime, runs } = recordingRuntime();
  new Keymap().attach(host.target, runtime, { isEditorEvent: () => true });

  host.fire(keyEvent({ key: "ArrowDown", defaultPrevented: true }));
  host.fire(keyEvent({ key: "ArrowDown", isComposing: true }));
  host.fire(keyEvent({ key: "ArrowDown", keyCode: 229 }));
  assert.deepEqual(runs, [], "三种情形都不该命中命令");

  const unknown = keyEvent({ key: "F5" });
  host.fire(unknown);
  assert.equal(unknown.defaultPrevented, false);
  assert.deepEqual(runs, []);
});

test("Keymap：多段 chord 要先吞下第一段，超时后 pending 清空", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const host = fakeWindow();
    const { runtime, runs } = recordingRuntime();
    const chorded: KeyBinding[] = [
      { key: "Ctrl-x Ctrl-s", command: "document.save", scope: "global", doc: "两段 chord" },
    ];
    new Keymap(chorded).attach(host.target, runtime, { isEditorEvent: () => true });

    const first = keyEvent({ key: "x", ctrlKey: true });
    host.fire(first);
    assert.equal(first.defaultPrevented, true, "chord 前缀要吞掉默认行为");
    assert.deepEqual(runs, []);

    host.fire(keyEvent({ key: "s", ctrlKey: true }));
    assert.deepEqual(runs, ["document.save"]);

    // 超时后 pending 清空：再按第二段不再命中
    host.fire(keyEvent({ key: "x", ctrlKey: true }));
    mock.timers.tick(1500);
    host.fire(keyEvent({ key: "s", ctrlKey: true }));
    assert.deepEqual(runs, ["document.save"], "超时后再按第二段不该命中");
  } finally {
    mock.timers.reset();
  }
});

test("Keymap.attach：表里有绑定而命令实现缺失时立即抛错；解绑后处理器可拆下", () => {
  const host = fakeWindow();
  assert.throws(() => new Keymap().attach(host.target, {} as CommandRuntime, { isEditorEvent: () => true }));

  const { runtime } = recordingRuntime();
  const detach = new Keymap().attach(host.target, runtime, { isEditorEvent: () => true });
  assert.equal(host.listenerCount(), 1);
  detach();
  assert.equal(host.listenerCount(), 0);
});

// ---------------------------------------------------------------------------
// [keys] 配置覆盖
// ---------------------------------------------------------------------------

test("applyKeyOverrides：只换「键 → 命令」的对应，作用域由命令归属决定", () => {
  const { bindings, warnings } = applyKeyOverrides({
    "Ctrl-S": "document.save",
    "Ctrl-Alt-Minus": "editor.undo",
  });
  assert.deepEqual(warnings, []);
  const saved = bindings.find((binding) => normalizeKey(binding.key) === "Ctrl-S");
  assert.equal(saved?.command, "document.save");
  assert.equal(saved?.scope, "global", "全局命令重绑后仍是 global");
  const undo = bindings.find((binding) => normalizeKey(binding.key) === "Ctrl-Alt-Minus");
  assert.equal(undo?.command, "editor.undo", "覆盖表里的键接管既有 token");
  assert.equal(undo?.scope, "editor", "editor 命令重绑后仍是 editor");
});

test("applyKeyOverrides：解绑删除绑定，未知命令 / 空键位 / 无默认绑定的解绑各出一条 warning", () => {
  const before = KEY_BINDINGS.length;
  const { bindings, warnings } = applyKeyOverrides({
    "Cmd-s": null,
    "Ctrl-Shift-F9": "no.such.command",
    " ": "document.save",
    "Cmd-F19": null,
  });
  assert.equal(warnings.length, 3, `warning 条数不对：${warnings.join(" | ")}`);
  assert.ok(warnings.some((line) => line.includes("没有默认绑定")));
  assert.ok(warnings.some((line) => line.includes("未知")));
  assert.ok(warnings.some((line) => line.includes("非法")));
  assert.equal(bindings.length, before - 1, "只有 ⌘S 的解绑生效");
  assert.equal(bindings.filter((binding) => normalizeKey(binding.key) === "Cmd-S").length, 0);
});

// ---------------------------------------------------------------------------
// M180：默认不绑键清单（KEYLESS_COMMAND_IDS）与折行命令
// ---------------------------------------------------------------------------

test("三项对账：每条命令有绑定或在默认不绑键清单里；清单无幻影 id、与绑定表无交集", () => {
  const bound = new Set<string>(KEY_BINDINGS.map((binding) => binding.command));
  const keyless = new Set(KEYLESS_COMMAND_IDS);
  for (const command of COMMAND_IDS) {
    assert.ok(
      bound.has(command) || keyless.has(command),
      `命令 ${command} 既没有任何绑定、也不在 KEYLESS_COMMAND_IDS 里（孤儿命令）`,
    );
  }
  for (const command of KEYLESS_COMMAND_IDS) {
    assert.ok(commandIds.includes(command), `默认不绑键清单里的 ${command} 不在 COMMAND_IDS（幻影 id）`);
    assert.ok(!bound.has(command), `${command} 既登记为默认不绑键、又带着默认绑定——清单在说谎`);
  }
});

test("折行命令：不在 editor 组（作用域派生成 global）、默认不绑键、[keys] 绑上即生效", () => {
  for (const command of ["view.toggle-line-wrap", "view.toggle-code-block-wrap"]) {
    assert.ok(commandIds.includes(command), `${command} 不在 COMMAND_IDS`);
    assert.ok(
      !editorCommandIds.includes(command),
      `${command} 若落在 editor 组，作用域会被派生成 editor（应为 global）`,
    );
    assert.equal(
      KEY_BINDINGS.find((binding) => binding.command === command),
      undefined,
      `${command} MUST NOT 出现在默认绑定表里（本版不为折行占任何物理键位）`,
    );
    assert.ok(KEYLESS_COMMAND_IDS.includes(command), `${command} 应登记在默认不绑键清单里`);
  }
  // ⌃J 是默认表里的空位：绑上即得一条 global 绑定——作用域由命令清单派生，不随配置漂移
  const { bindings, warnings } = applyKeyOverrides({ "Ctrl-j": "view.toggle-line-wrap" });
  assert.deepEqual(warnings, []);
  const bound = bindings.find((binding) => normalizeKey(binding.key) === "Ctrl-J");
  assert.equal(bound?.command, "view.toggle-line-wrap");
  assert.equal(bound?.scope, "global", "绑定后作用域仍由命令清单派生");
});
