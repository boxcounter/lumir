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
import { t } from "./copy";
import { onRelabel } from "./copy";
import type { CopyKey } from "./copy-data";

/** 面板的功能分组：只列命令 id，键位与作用域一律从生效表读。
 *  9 个分组覆盖全部命令（不做文本改写的选择类命令——⌘A 全选、⌃G 撤下选择——归
 *  「移动与选择」，与光标族同属「不动文档的定位/选区命令」）；未列入任何分组的
 *  命令自动落到末尾「其他」——将来新增命令忘记归组时不会从面板里消失。
 *
 *  **导出给单测**：`tests/unit/bindings-panel.test.ts` 用它做三条对账（每条 `COMMAND_IDS`
 *  都有组 ⇒ 零兜底组 / 组里无幻影 id / 分组互斥）。兜底组的存在意味着「漏归组」本身不会
 *  报错，只有别人场景里的分组标题断言会红（M239 实证：红在 m133 的视觉场景上，跨了 mission
 *  才发现）；对账放进 unit 层，漏归组在引入它的那次改动里就红。 */
export const BINDING_GROUPS: ReadonlyArray<{ titleKey: CopyKey; commands: readonly CommandId[] }> = [
  { titleKey: "D64.1", commands: ["editor.cursor-up", "editor.cursor-down", "editor.cursor-forward", "editor.cursor-backward", "editor.line-start", "editor.line-end", "editor.select-all", "editor.keyboard-quit"] },
  { titleKey: "D64.2", commands: ["editor.extend-char-forward", "editor.extend-char-backward", "editor.extend-line-down", "editor.extend-line-up", "editor.extend-line-start", "editor.extend-line-end", "editor.extend-word-forward", "editor.extend-word-backward"] },
  { titleKey: "D64.3", commands: ["editor.delete-char-forward", "editor.delete-char-backward", "editor.transpose-chars", "editor.delete-word-forward", "editor.delete-word-backward"] },
  { titleKey: "D64.4", commands: ["editor.kill-line", "editor.yank"] },
  // M281：跳转到行（change goto-line-command）与 ⌃L 的 recenter 同属「重定位」——它改的是
  // 光标位置与滚动（落点复用 revealLine），与「移动与选择」的逐字符/逐行移动不是一族。
  { titleKey: "D64.5", commands: ["editor.scroll-page-down", "editor.scroll-page-up", "editor.recenter", "editor.goto-line"] },
  { titleKey: "D64.6", commands: ["editor.undo", "editor.redo"] },
  // M239 的两条列表结构命令（Tab / ⇧Tab）单列一组：它们改写的是**列表项的嵌套层级**
  // （连同续行与子树整体平移），与「移动与选择」（只动光标 / 选区）和「删除」都不是一族。
  // 归组去重是面板的硬约束：漏登记的命令会落进末尾的兜底「其他」组，那条兜底是 M133 的
  // 有意设计（新命令不从面板消失），但代价是漏归组只表现为「别处场景红」——M239 就这么
  // 漏过一次（master 视觉门禁红，M240 顺手收）。现在由 tests/unit/bindings-panel.test.ts
  // 的「零兜底组」对账守住。
  { titleKey: "D64.7", commands: ["editor.list-indent", "editor.list-outdent"] },
  // M277：块级复制（change block-copy-affordance）单列一组——它作用的对象是**文档里的一个块**
  // （表格 / 代码块），与光标族、列表族都不是一族。同批的代码块全屏命令（作用域 global）留在
  // 「全局」组：那一组的成员定义就是 NON_TAB_GLOBAL_COMMAND_IDS，挪出来会与它重复渲染
  // （分组互斥是硬约束，见文件头）。
  { titleKey: "D64.8", commands: ["block.copy"] },
  { titleKey: "D64.9", commands: WIDGET_COMMAND_IDS },
  // M149：标签单列一组（而不是并进「全局」）——⌘W 的语义变化与 ⌘1–9 的九条直达是
  // dogfood 期最需要一眼核对的两件事，混在全局组里不容易看全。两组必须**互斥**：
  // 「全局」组用 keys.ts 的 NON_TAB_GLOBAL_COMMAND_IDS，否则同一命令会被两个分组
  // 各渲染一行（面板行数翻倍，「每条命令一行」的口径被破坏）。
  { titleKey: "D64.10", commands: TAB_COMMAND_IDS },
  { titleKey: "D64.11", commands: NON_TAB_GLOBAL_COMMAND_IDS },
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

  const title = document.createElement("h2");
  title.className = "lumir-bindings-title";
  const body = document.createElement("div");
  body.className = "lumir-bindings-body";
  const hint = document.createElement("p");
  hint.className = "lumir-bindings-hint";
  panel.append(title, body, hint);
  overlay.append(panel);
  options.mount.append(overlay);

  /** 面板的静态文案（标题 / 关闭提示 / 读屏名 / 「未绑定」与两种成因说明）。三处都是
   *  **长驻 DOM**（面板在启动时建好、只是 hidden），所以语言切换后必须重写——`relabel()`
   *  由装配层的 `applyLanguage` 按注册顺序调用（design §5.2 的不变量）。 */
  function relabel(): void {
    const heading = t("D63");
    panel.setAttribute("aria-label", heading);
    title.textContent = heading;
    hint.textContent = t("D67");
    unboundLabel = t("D65");
    unboundNotices = [t("D66.1"), t("D66.2")];
    if (!overlay.hidden) render();
  }

  let unboundLabel = "";
  let unboundNotices: [string, string] = ["", ""];

  /** 未绑定行的说明（M180，文案 D66）：两种成因**分开**说，并各自指出下一步。此前是一句
   *  通用的「配置解绑或尚未绑定」，把「有意不占键位」读成过渡态——新命令（折行开关）默认就
   *  不占键位，读不出成因会让人以为它坏了。成因判定用 keys.ts 的默认不绑键清单，不另立一份。 */
  function unboundNotice(command: CommandId): string {
    return KEYLESS_COMMAND_IDS.includes(command) ? unboundNotices[0] : unboundNotices[1];
  }

  /** 一行：一条绑定，或一条「未绑定」命令（binding 为 null）。 */
  function makeRow(command: CommandId, binding: KeyBinding | null): HTMLElement {
    const row = document.createElement("div");
    row.className = binding === null ? "lumir-bindings-row is-unbound" : "lumir-bindings-row";
    row.dataset.command = command;
    const key = document.createElement("span");
    key.className = "lumir-bindings-key";
    key.textContent = binding?.key ?? unboundLabel;
    const id = document.createElement("span");
    id.className = "lumir-bindings-command";
    id.textContent = command;
    const doc = document.createElement("span");
    doc.className = "lumir-bindings-doc";
    doc.textContent = binding === null ? unboundNotice(command) : t(binding.docKey, binding.docParams);
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
      return { title: t(group.titleKey), commands: [...group.commands] as CommandId[] };
    });
    const rest = COMMAND_IDS.filter((command) => !assigned.has(command));
    if (rest.length > 0) groups.push({ title: t("D64.12"), commands: rest });

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

  relabel();
  onRelabel(relabel);

  return { toggle };
}
