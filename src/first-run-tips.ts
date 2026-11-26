// 首启工作区的功能 / 默认键位 tips（change add-first-run-onboarding-nov25）。
//
// 落点由装配层决定：挂 root doc pane 的 `shell.editorPane`，不是 `shell.editorRow` 的
// `.editor-notice`——后者覆盖整条 pane 行，会把默认展开的 harness pane 一起盖住。
// 本模块只产 DOM，不读全局状态、不注册事件；语言切换由装配层重跑 `createFirstRunTips()`。
//
// 键位不手抄：1–6 行从 `KEY_BINDINGS` 按 command id 取默认绑定，再用 `glyphOfToken`
// 转成可见字形。默认表改了 tips 跟着表走；单测对账「每条 key 行都能在默认表里找到命令」。

import "./first-run-tips.css";
import type { CopyKey } from "./copy";
import { t } from "./copy";
import { glyphOfToken } from "./key-glyphs";
import { KEY_BINDINGS } from "./keys";
import type { CommandId } from "./keys";

interface KeyRow {
  kind: "key";
  command: CommandId;
  label: CopyKey;
}

interface TokenRow {
  kind: "token" | "gesture";
  token: CopyKey | string;
  label: CopyKey;
}

type TipRow = KeyRow | TokenRow;

/** 三组只靠间距区分，不画分组标题——少三条可见文案，也不引入第二套字层级。 */
const GROUPS: readonly (readonly TipRow[])[] = [
  [
    { kind: "key", command: "app.quick-open", label: "D1036" },
    { kind: "key", command: "app.search-open", label: "D1037" },
    { kind: "key", command: "toc.toggle", label: "D1038" },
    { kind: "key", command: "vault.switcher", label: "D1039" },
    { kind: "key", command: "app.settings-open", label: "D1041" },
  ],
  [
    { kind: "key", command: "harness.toggle", label: "D1040" },
    { kind: "token", token: "[[", label: "D1042" },
    { kind: "gesture", token: "D1046", label: "D1043" },
  ],
  [
    { kind: "gesture", token: "D1047", label: "D882" },
  ],
];

function keyGlyph(command: CommandId): string {
  const binding = KEY_BINDINGS.find((entry) => entry.command === command);
  return binding === undefined ? "" : glyphOfToken(binding.key);
}

function tokenText(row: TokenRow): string {
  return row.kind === "gesture" ? `${t(row.token as CopyKey)} →` : String(row.token);
}

/** 建一块首启 tips。调用方负责挂载 / 替换 / 移除；本函数不碰 DOM 之外的状态。 */
export function createFirstRunTips(): HTMLElement {
  const root = document.createElement("section");
  root.className = "first-run-tips";
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", t("D1045"));

  const title = document.createElement("h2");
  title.className = "first-run-tips-title";
  title.textContent = t("D1035");
  root.append(title);

  for (const group of GROUPS) {
    const list = document.createElement("div");
    list.className = "first-run-tips-group";
    for (const row of group) {
      const line = document.createElement("div");
      line.className = "first-run-tips-row";
      const glyph = document.createElement("span");
      glyph.className =
        row.kind === "key"
          ? "first-run-tips-key"
          : row.kind === "token"
            ? "first-run-tips-token"
            : "first-run-tips-gesture";
      glyph.textContent = row.kind === "key" ? keyGlyph(row.command) : tokenText(row);
      const label = document.createElement("span");
      label.className = "first-run-tips-label";
      label.textContent = t(row.label);
      line.append(glyph, label);
      list.append(line);
    }
    root.append(list);
  }

  const note = document.createElement("p");
  note.className = "first-run-tips-note";
  note.textContent = t("D1044");
  root.append(note);
  return root;
}
