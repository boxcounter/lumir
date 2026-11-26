import type { TransactionSpec } from "@codemirror/state";
import type { SkillSummary } from "./bindings/SkillSummary";

export const SKILL_NAME_PATTERN = "^[A-Za-z0-9][A-Za-z0-9_-]*$";
const SKILL_NAME_RE = new RegExp(SKILL_NAME_PATTERN);
const TOKEN_CHAR_RE = /[A-Za-z0-9_-]/;

export interface ComposerSkillRef {
  name: string;
  from: number;
}

export interface SkillToken {
  from: number;
  to: number;
  prefix: string;
}

/**
 * 候选状态（合同：docs/specs/selector-contract.md C1 / C4）。
 *
 * - `highlighted`：唯一游标，打开即有（首项 / 按名字保留 / 全名项）；query 变化可自动改它。
 * - `armed`：Enter / Tab 是否接受。只有显式选择（方向键 / ⌃N·⌃P / 指针）或 token 前缀
 *   逐字等于某项全名时为真；异步 catalog 回包绝不把 false 改成 true。
 *
 * 两个状态分开的原因：视觉高亮可以自动（降低「看不见高亮」的困惑），但「Enter 会做什么」
 * 必须仍由用户的显式动作承诺——否则 `/tmp` 这类路径前缀会把被动态 Enter 变成一次 Skill 调用。
 */
export interface SkillMenuState {
  token: SkillToken;
  items: readonly SkillSummary[];
  highlighted: number;
  armed: boolean;
}

export function isSkillName(name: string): boolean {
  return SKILL_NAME_RE.test(name);
}

export function skillTokenAt(text: string, caret: number): SkillToken | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > text.length) return null;
  let from = caret;
  while (from > 0 && TOKEN_CHAR_RE.test(text[from - 1])) from -= 1;
  if (from === 0 || text[from - 1] !== "/") return null;
  from -= 1;
  if (from > 0 && !/\s/.test(text[from - 1])) return null;
  return { from, to: caret, prefix: text.slice(from + 1, caret) };
}

export function filterSkillCatalog(
  catalog: readonly SkillSummary[],
  prefix: string,
): SkillSummary[] {
  return catalog.filter((item) =>
    item.invocation_valid && item.user_invocable && item.name.startsWith(prefix));
}

/**
 * 候选状态转移（query 变化、选区同步与异步 catalog 回包共用同一入口）。
 *
 * - 游标：全名项 > 按名字保留的上一项 > 首项。
 * - 武装：全名恒成立；否则只在**同一个 token**（位置与前缀都没变）上继承——query 变了
 *   就回到未武装，异步回包也就无法把被动态 Enter 变成接受。
 *
 * 返回 null = 候选不显示（无 token / 零命中）。
 */
export function syncSkillMenuState(
  previous: SkillMenuState | null,
  text: string,
  caret: number,
  catalog: readonly SkillSummary[],
): SkillMenuState | null {
  const token = skillTokenAt(text, caret);
  if (token === null) return null;
  const items = filterSkillCatalog(catalog, token.prefix);
  if (items.length === 0) return null;
  const fullName = items.findIndex((item) => item.name === token.prefix);
  const previousName = previous === null ? null : previous.items[previous.highlighted]?.name ?? null;
  const kept = previousName === null ? -1 : items.findIndex((item) => item.name === previousName);
  const highlighted = fullName >= 0 ? fullName : kept >= 0 ? kept : 0;
  const sameToken = previous !== null &&
    previous.token.from === token.from && previous.token.prefix === token.prefix;
  const armed = fullName >= 0 || (sameToken && previous.armed && kept >= 0);
  return { token, items, highlighted, armed };
}

export function openSkillMenu(
  text: string,
  caret: number,
  catalog: readonly SkillSummary[],
): SkillMenuState | null {
  return syncSkillMenuState(null, text, caret, catalog);
}

/**
 * 两次同步是否得到同一份候选状态（token / 游标 / 武装一致，items 逐项按引用比较）。
 *
 * IME settle、catalog 回包与文档回调可能对同一份最终文档各算一次；状态相同就不该重建 DOM
 * （重建会让候选闪一下，也让「compositionend 只重算一次」无法用次数断言）。
 */
export function sameSkillMenuState(
  a: SkillMenuState | null,
  b: SkillMenuState | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.token.from !== b.token.from || a.token.to !== b.token.to ||
      a.token.prefix !== b.token.prefix) return false;
  if (a.highlighted !== b.highlighted || a.armed !== b.armed ||
      a.items.length !== b.items.length) return false;
  return a.items.every((item, index) => item === b.items[index]);
}

export function moveSkillHighlight(state: SkillMenuState, delta: number): SkillMenuState {
  if (state.items.length === 0) return state;
  const highlighted = Math.max(0, Math.min(state.items.length - 1, state.highlighted + delta));
  // 导航键本身就是显式选择：即使已在端点、索引没变，也武装 Enter。
  return { ...state, highlighted, armed: true };
}

export function hoverSkillHighlight(state: SkillMenuState, index: number): SkillMenuState {
  if (index < 0 || index >= state.items.length) return state;
  if (state.highlighted === index && state.armed) return state;
  return { ...state, highlighted: index, armed: true };
}

export interface SkillMenuNavigationKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
}

export function skillMenuNavigationDelta(event: SkillMenuNavigationKey): number | null {
  if (event.metaKey || event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  if (event.ctrlKey) {
    if (key === "n") return 1;
    if (key === "p") return -1;
    return null;
  }
  if (event.key === "ArrowDown") return 1;
  if (event.key === "ArrowUp") return -1;
  return null;
}

export interface SkillSelectionSpec extends TransactionSpec {
  skill: ComposerSkillRef;
}

export function skillSelectionSpec(text: string, state: SkillMenuState): SkillSelectionSpec | null {
  if (!state.armed) return null;
  const item = state.items[state.highlighted];
  if (item === undefined) return null;
  const to = state.token.to + (text[state.token.to] === " " ? 1 : 0);
  const insert = `/${item.name} `;
  return {
    changes: { from: state.token.from, to, insert },
    selection: { anchor: state.token.from + insert.length },
    userEvent: "input.skill",
    skill: { name: item.name, from: state.token.from },
  };
}
