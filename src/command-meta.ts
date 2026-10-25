// 命令元数据（change improve-keybindings-lookup-oct24，design §2.1）：人类标签 / 搜索别名 /
// 作用域文案的**唯一**来源。
//
// 分工（REVIEW.md「同一语义两处真源」条）：
//   - 命令清单仍只有 `COMMAND_IDS` 一份（`src/keys.ts`）；本模块以它为键，不是第二份清单。
//   - 标签文本住文案表（`文案-Copy.md` + `src/copy-data.ts`），经 `t()` 取值——71 条命令的
//     中英双列是本 change 最大的文案面；类型 `Record<CommandId, CommandMeta>` 让「漏写标签」
//     在编译期就红，运行期再由 `tests/unit/command-meta.test.ts` 对账一次。
//   - 别名只进查询语料、不上屏（MUST NOT 在面板里渲染），允许含空格的自然短语
//     （`select all` / `quick open`）——用户按自己说命令的方式查。别名是搜索数据，不是界面
//     文案，因此留在本文件；中文别名会触发 `src/**` 的 CJK 字面量门禁，统一不写中文别名
//     （中文列标签本身已在语料里）。
//   - 面板 MUST NOT 逐条硬编码命令文本；它只读本模块与 `t()`。

import type { CommandId, KeyScope } from "./keys";
import type { CopyKey } from "./copy-data";

export interface CommandMeta {
  /** 人类标签：住文案表，中英两列必填。 */
  labelKey: CopyKey;
  /** 标签模板的插值参数（只有 `tab.goto-N` 这类带序号的命令用）。 */
  labelParams?: Record<string, string | number>;
  /** 搜索专用别名；不上屏、不要求中英成对、可选。 */
  aliases?: readonly string[];
}

/** 一条命令恰有一条元数据：缺任何 `CommandId` 都是编译错误。 */
export const COMMAND_META: Record<CommandId, CommandMeta> = {
  // ── 编辑器：移动与选择 ───────────────────────────────────────────────────
  "editor.cursor-up": { labelKey: "D593", aliases: ["up", "previous line"] },
  "editor.cursor-down": { labelKey: "D594", aliases: ["down", "next line"] },
  "editor.cursor-forward": { labelKey: "D595", aliases: ["forward", "right"] },
  "editor.cursor-backward": { labelKey: "D596", aliases: ["backward", "left"] },
  "editor.line-start": { labelKey: "D597", aliases: ["beginning of line", "bol"] },
  "editor.line-end": { labelKey: "D598", aliases: ["end of line", "eol"] },
  "editor.select-all": { labelKey: "D599", aliases: ["select all"] },
  "editor.keyboard-quit": { labelKey: "D609", aliases: ["cancel", "cancel selection"] },

  // ── 编辑器：扩选 ─────────────────────────────────────────────────────────
  "editor.extend-char-forward": { labelKey: "D614", aliases: ["extend", "select forward"] },
  "editor.extend-char-backward": { labelKey: "D615", aliases: ["extend back", "select backward"] },
  "editor.extend-line-down": { labelKey: "D616", aliases: ["extend down"] },
  "editor.extend-line-up": { labelKey: "D617", aliases: ["extend up"] },
  "editor.extend-line-start": { labelKey: "D618", aliases: ["extend to start"] },
  "editor.extend-line-end": { labelKey: "D619", aliases: ["extend to end"] },
  "editor.extend-word-forward": { labelKey: "D620", aliases: ["extend word"] },
  "editor.extend-word-backward": { labelKey: "D621", aliases: ["extend word back"] },

  // ── 编辑器：删除 / kill-yank ─────────────────────────────────────────────
  "editor.delete-char-forward": { labelKey: "D602", aliases: ["delete forward"] },
  "editor.delete-char-backward": { labelKey: "D603", aliases: ["backspace", "delete backward"] },
  "editor.transpose-chars": { labelKey: "D604", aliases: ["transpose"] },
  "editor.delete-word-forward": { labelKey: "D605", aliases: ["kill word"] },
  "editor.delete-word-backward": { labelKey: "D606", aliases: ["kill word back"] },
  "editor.kill-line": { labelKey: "D607", aliases: ["cut line", "kill"] },
  "editor.yank": { labelKey: "D608", aliases: ["paste", "yank"] },

  // ── 编辑器：翻屏 / 撤销 / 块 / 列表缩进 ──────────────────────────────────
  "editor.scroll-page-down": { labelKey: "D610", aliases: ["page down"] },
  "editor.scroll-page-up": { labelKey: "D611", aliases: ["page up"] },
  "editor.recenter": { labelKey: "D612", aliases: ["center", "recenter"] },
  "editor.goto-line": { labelKey: "D613", aliases: ["goto", "line number"] },
  "editor.undo": { labelKey: "D600" },
  "editor.redo": { labelKey: "D601" },
  "editor.list-indent": { labelKey: "D622", aliases: ["indent", "tab"] },
  "editor.list-outdent": { labelKey: "D623", aliases: ["outdent", "shift tab"] },
  "block.copy": { labelKey: "D624", aliases: ["copy block", "copy table", "copy code block"] },
  "editor.focus-block-scroll": { labelKey: "D625", aliases: ["scroll container", "focus scroll"] },

  // ── 编辑器：块级横滚容器（带 `when`）─────────────────────────────────────
  "editor.widget-scroll-left": { labelKey: "D626", aliases: ["scroll left"] },
  "editor.widget-scroll-right": { labelKey: "D627", aliases: ["scroll right"] },
  "editor.widget-scroll-home": { labelKey: "D628", aliases: ["scroll home", "scroll start"] },
  "editor.widget-scroll-end": { labelKey: "D629", aliases: ["scroll end"] },
  "editor.widget-escape": { labelKey: "D630", aliases: ["leave scroll", "exit scroll"] },

  // ── 全局（非标签）────────────────────────────────────────────────────────
  "document.save": { labelKey: "D631", aliases: ["save"] },
  "link.follow": { labelKey: "D632", aliases: ["follow link", "open link"] },
  "app.describe-bindings": {
    labelKey: "D633",
    aliases: ["keybindings", "keyboard shortcuts", "shortcuts", "bindings", "help keys"],
  },
  "app.search-open": { labelKey: "D634", aliases: ["search", "find", "find in file"] },
  "app.quick-open": { labelKey: "D635", aliases: ["quick open", "open file", "goto file"] },
  "toc.toggle": { labelKey: "D636", aliases: ["outline", "toc", "table of contents"] },
  "vault.switcher": { labelKey: "D637", aliases: ["switch vault", "vaults"] },
  "app.settings-open": { labelKey: "D864", aliases: ["settings", "preferences", "providers"] },
  "table.toggle-fullscreen": { labelKey: "D638", aliases: ["fullscreen table", "table fullscreen"] },
  "code-block.toggle-fullscreen": {
    labelKey: "D639",
    aliases: ["fullscreen code block", "code fullscreen"],
  },
  "view.toggle-line-wrap": { labelKey: "D640", aliases: ["wrap", "line wrap"] },
  "view.toggle-code-block-wrap": { labelKey: "D641", aliases: ["code wrap", "code block wrap"] },
  "view.text-scale-up": { labelKey: "D642", aliases: ["zoom in", "bigger text", "increase font"] },
  "view.text-scale-down": { labelKey: "D643", aliases: ["zoom out", "smaller text", "decrease font"] },
  "view.text-scale-reset": { labelKey: "D644", aliases: ["reset zoom", "reset font"] },
  "view.theme-cycle": { labelKey: "D645", aliases: ["theme", "dark mode", "light mode"] },
  "view.language-cycle": { labelKey: "D646", aliases: ["language", "english", "chinese"] },
  "view.toggle-sidebar": { labelKey: "D647", aliases: ["sidebar", "file tree", "hide sidebar"] },
  "harness.toggle": { labelKey: "D648", aliases: ["chat", "agent", "harness"] },
  "pane.split": { labelKey: "D649", aliases: ["split"] },
  "pane.other": { labelKey: "D650", aliases: ["other pane", "switch pane"] },
  "pane.close": { labelKey: "D651", aliases: ["close pane"] },

  // ── 标签 ─────────────────────────────────────────────────────────────────
  "tab.close": { labelKey: "D652", aliases: ["close tab"] },
  "tab.next": { labelKey: "D653", aliases: ["next tab"] },
  "tab.prev": { labelKey: "D654", aliases: ["previous tab"] },
  "tab.goto-1": { labelKey: "D655", labelParams: { n: 1 }, aliases: ["goto tab"] },
  "tab.goto-2": { labelKey: "D655", labelParams: { n: 2 }, aliases: ["goto tab"] },
  "tab.goto-3": { labelKey: "D655", labelParams: { n: 3 }, aliases: ["goto tab"] },
  "tab.goto-4": { labelKey: "D655", labelParams: { n: 4 }, aliases: ["goto tab"] },
  "tab.goto-5": { labelKey: "D655", labelParams: { n: 5 }, aliases: ["goto tab"] },
  "tab.goto-6": { labelKey: "D655", labelParams: { n: 6 }, aliases: ["goto tab"] },
  "tab.goto-7": { labelKey: "D655", labelParams: { n: 7 }, aliases: ["goto tab"] },
  "tab.goto-8": { labelKey: "D655", labelParams: { n: 8 }, aliases: ["goto tab"] },
  "tab.goto-9": { labelKey: "D655", labelParams: { n: 9 }, aliases: ["goto tab"] },
};

/** 作用域档位的上屏名（面板行内徽标与筛选组共用）。 */
export const SCOPE_LABEL_KEYS: Record<KeyScope, CopyKey> = {
  global: "D669",
  editor: "D670",
  text: "D671",
};

/** 作用域档位在详情里的一句解释。 */
export const SCOPE_DESCRIPTION_KEYS: Record<KeyScope, CopyKey> = {
  global: "D672",
  editor: "D673",
  text: "D674",
};
