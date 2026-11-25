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

export interface SkillMenuState {
  token: SkillToken;
  items: readonly SkillSummary[];
  highlighted: number | null;
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

export function openSkillMenu(
  text: string,
  caret: number,
  catalog: readonly SkillSummary[],
): SkillMenuState | null {
  const token = skillTokenAt(text, caret);
  if (token === null) return null;
  const items = filterSkillCatalog(catalog, token.prefix);
  return items.length === 0 ? null : { token, items, highlighted: null };
}

export function moveSkillHighlight(state: SkillMenuState, delta: number): SkillMenuState {
  if (state.items.length === 0) return state;
  if (state.highlighted === null) {
    return { ...state, highlighted: delta < 0 ? state.items.length - 1 : 0 };
  }
  return {
    ...state,
    highlighted: Math.max(0, Math.min(state.items.length - 1, state.highlighted + delta)),
  };
}

export interface SkillMenuNavigationKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
}

export function skillMenuNavigationDelta(event: SkillMenuNavigationKey): number | null {
  if (event.metaKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (event.ctrlKey) {
    if (event.shiftKey === true) return null;
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
  if (state.highlighted === null) return null;
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
