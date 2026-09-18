// 键位查看面板（M133，app.describe-bindings）：dogfood 期的自用查看器，刻意简单——
// 不是 UX 重设计的一部分，只回答一个问题「某个键现在归谁」。
//
// M151 从 main.ts 抽出（M127 的拆分判据「main.ts 收敛为装配层」的续作）：面板本体在这个
// 模块，装配侧只注入三样它才知道的东西——挂点、生效表的读取口、关闭后把焦点交还编辑器。
//
// 数据源是分发器真正在用的那份表（装配层 applyKeyConfig 里 applyKeyOverrides 的产物），
// 不是 keys.ts 的默认表——配置过 [keys] 之后两者不同（重绑 / 解绑），面板要显示前者。
// 有实现但当前没有键位指向的命令（被解绑的）同样列出并标注「未绑定」，否则解绑之后
// 该命令就从视野里消失了。分组只表达功能族，不改变作用域语义（scope 仍由 keys.ts 定）。
//
// 关闭键（Escape / ⌃G）由面板自己消费，不进 KEY_BINDINGS：统一表是「一个 token 一条
// 绑定」（装配期重复即抛），而这两个 token 已被占用——Escape 归 editor.widget-escape
// （带 when 条件）、⌃G 归 editor.keyboard-quit。面板打开时焦点在遮罩上，那两条绑定因
// 作用域与 when 条件都不会命中，故这里不存在「同一物理键两处各写一份」的漂移；监听只
// 挂在遮罩元素上（隐藏时收不到事件），关闭动作仍回到同一条命令实现（打开态再按即关）。

import {
  COMMAND_IDS,
  KEYLESS_COMMAND_IDS,
  keyToken,
  NON_TAB_GLOBAL_COMMAND_IDS,
  TAB_COMMAND_IDS,
  WIDGET_COMMAND_IDS,
} from "./keys";
import type { CommandId, KeyBinding } from "./keys";

/** 面板的功能分组：只列命令 id，键位与作用域一律从生效表读。
 *  9 个分组覆盖全部命令（不做文本改写的选择类命令——⌘A 全选、⌃G 撤下选择——归
 *  「移动与选择」，与光标族同属「不动文档的定位/选区命令」）；未列入任何分组的
 *  命令自动落到末尾「其他」——将来新增命令忘记归组时不会从面板里消失。 */
const BINDING_GROUPS: ReadonlyArray<{ title: string; commands: readonly CommandId[] }> = [
  { title: "移动与选择", commands: ["editor.cursor-up", "editor.cursor-down", "editor.cursor-forward", "editor.cursor-backward", "editor.line-start", "editor.line-end", "editor.select-all", "editor.keyboard-quit"] },
  { title: "扩选", commands: ["editor.extend-char-forward", "editor.extend-char-backward", "editor.extend-line-down", "editor.extend-line-up", "editor.extend-line-start", "editor.extend-line-end", "editor.extend-word-forward", "editor.extend-word-backward"] },
  { title: "删除", commands: ["editor.delete-char-forward", "editor.delete-char-backward", "editor.transpose-chars", "editor.delete-word-forward", "editor.delete-word-backward"] },
  { title: "kill-yank", commands: ["editor.kill-line", "editor.yank"] },
  { title: "翻屏", commands: ["editor.scroll-page-down", "editor.scroll-page-up", "editor.recenter"] },
  { title: "撤销", commands: ["editor.undo", "editor.redo"] },
  { title: "widget", commands: WIDGET_COMMAND_IDS },
  // M149：标签单列一组（而不是并进「全局」）——⌘W 的语义变化与 ⌘1–9 的九条直达是
  // dogfood 期最需要一眼核对的两件事，混在全局组里不容易看全。两组必须**互斥**：
  // 「全局」组用 keys.ts 的 NON_TAB_GLOBAL_COMMAND_IDS，否则同一命令会被两个分组
  // 各渲染一行（面板行数翻倍，「每条命令一行」的口径被破坏）。
  { title: "标签", commands: TAB_COMMAND_IDS },
  { title: "全局", commands: NON_TAB_GLOBAL_COMMAND_IDS },
];

/** 面板自己的关闭键（token 口径与表内绑定同源，见下面 keydown 监听）。 */
const PANEL_CLOSE_TOKENS = new Set(["Escape", "Ctrl-G"]);

export interface BindingsPanelOptions {
  mount: HTMLElement;
  /** 分发器当前在用的那张表（装配层持有；配置重挂后打开面板要读到新表）。 */
  bindings(): readonly KeyBinding[];
  /** 关闭后把焦点交还编辑器：焦点一直在遮罩上，不交还就「关掉也走不了」。 */
  restoreFocus(): void;
}

export interface BindingsPanel {
  /** 打开态再调用即关闭（命令与关闭键共用同一入口）。 */
  toggle(): void;
}

export function createBindingsPanel(options: BindingsPanelOptions): BindingsPanel {
  const overlay = document.createElement("div");
  overlay.className = "lumir-bindings-overlay";
  overlay.hidden = true;

  const panel = document.createElement("div");
  panel.className = "lumir-bindings-panel";
  panel.tabIndex = -1;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "键位（生效中）");

  const title = document.createElement("h2");
  title.className = "lumir-bindings-title";
  title.textContent = "键位（生效中）";
  const body = document.createElement("div");
  body.className = "lumir-bindings-body";
  const hint = document.createElement("p");
  hint.className = "lumir-bindings-hint";
  hint.textContent = "Esc / ⌃G 或点击遮罩关闭";
  panel.append(title, body, hint);
  overlay.append(panel);
  options.mount.append(overlay);

  /** 未绑定行的说明（M180，文案 D66）：两种成因**分开**说，并各自指出下一步。此前是一句
   *  通用的「配置解绑或尚未绑定」，把「有意不占键位」读成过渡态——新命令（折行开关）默认就
   *  不占键位，读不出成因会让人以为它坏了。成因判定用 keys.ts 的默认不绑键清单，不另立一份。 */
  function unboundNotice(command: CommandId): string {
    return KEYLESS_COMMAND_IDS.includes(command)
      ? "默认不占键位（有意如此）——可在 [keys] 里绑定"
      : "已被配置解绑——可在 [keys] 里重新绑定";
  }

  /** 一行：一条绑定，或一条「未绑定」命令（binding 为 null）。 */
  function makeRow(command: CommandId, binding: KeyBinding | null): HTMLElement {
    const row = document.createElement("div");
    row.className = binding === null ? "lumir-bindings-row is-unbound" : "lumir-bindings-row";
    row.dataset.command = command;
    const key = document.createElement("span");
    key.className = "lumir-bindings-key";
    key.textContent = binding?.key ?? "未绑定";
    const id = document.createElement("span");
    id.className = "lumir-bindings-command";
    id.textContent = command;
    const doc = document.createElement("span");
    doc.className = "lumir-bindings-doc";
    doc.textContent = binding?.doc ?? unboundNotice(command);
    row.append(key, id, doc);
    return row;
  }

  function render(): void {
    // 生效表按命令归桶：一条命令多个键（如撤销的三个键）就是多行。
    const byCommand = new Map<string, KeyBinding[]>();
    for (const binding of options.bindings()) {
      const list = byCommand.get(binding.command) ?? [];
      list.push(binding);
      byCommand.set(binding.command, list);
    }
    const assigned = new Set<string>();
    const groups = BINDING_GROUPS.map((group) => {
      for (const command of group.commands) assigned.add(command);
      return { title: group.title, commands: [...group.commands] as CommandId[] };
    });
    const rest = COMMAND_IDS.filter((command) => !assigned.has(command));
    if (rest.length > 0) groups.push({ title: "其他", commands: rest });

    body.replaceChildren();
    for (const group of groups) {
      const section = document.createElement("section");
      section.className = "lumir-bindings-group";
      const heading = document.createElement("h3");
      heading.className = "lumir-bindings-group-title";
      heading.textContent = group.title;
      section.append(heading);
      for (const command of group.commands) {
        const keys = byCommand.get(command) ?? [];
        if (keys.length === 0) section.append(makeRow(command, null));
        else for (const binding of keys) section.append(makeRow(command, binding));
      }
      body.append(section);
    }
  }

  function toggle(): void {
    if (!overlay.hidden) {
      overlay.hidden = true;
      options.restoreFocus();
      return;
    }
    render(); // 每次打开重读生效表（配置重挂后不留旧表）
    overlay.hidden = false;
    panel.focus();
  }

  // 点击遮罩关闭；点在面板本身上不关（面板内要能选中文本）。
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) toggle();
  });

  // 关闭键复用 keys.ts 的 token 归一化，不另写一套匹配口径（否则两处会漂移）。
  overlay.addEventListener("keydown", (event) => {
    const token = keyToken(event);
    if (token === null) return;
    // Tab 必须挡在面板内（aria-modal 的语义）：面板没有可聚焦子元素，放行 Tab 会让焦点
    // 落到编辑器内容区——面板还开着，后续按键就又能穿透到文档了（本监听只有这一条职责
    // 之外的守卫，不构成第二条键位路径）。
    if (token === "Tab" || token === "Shift-Tab") {
      event.preventDefault();
      return;
    }
    if (!PANEL_CLOSE_TOKENS.has(token)) return;
    // 先于 window 上的分发器消费：分发器对已消费事件让路（defaultPrevented）。
    event.preventDefault();
    toggle();
  });

  return { toggle };
}
