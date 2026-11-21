// 粘贴 URL 自动取标题的 **DOM 无关判据**（change add-url-paste-title-nov21）。
//
// 与 `src/paste-image.ts` 同一拆法：`editor.ts` 的 import 链带参数属性、跑不了
// `tests/unit`，因此「什么样的粘贴算单个 http(s) URL」「标题怎么变成纯文本链接标签」
// 「异步返回后什么情况下才允许改写」都住在这里；DOM paste 事件与事务派发留在
// `src/editor.ts`。
//
// 失败即保留原文：本模块不产生「兜底标题」，也不把 URL 本身当标题。任何一步拿不到可用
// 文本（网络失败 / 超时 / 非 2xx / 非 HTML / 无 `<title>` / 标题为空或过长）都返回
// null，调用方不做任何改写。

import { StateEffect, StateField } from "@codemirror/state";
import type { ChangeSpec, EditorState, Text } from "@codemirror/state";

/** 取网页标题的端口（装配层注入；未注入时整条能力不启用）。 */
export interface PasteUrlTitlePort {
  /** 成功 = 可用的纯文本标题；`null` = 没有可用标题（不是异常路径）。 */
  fetchTitle(url: string): Promise<string | null>;
}

/** 标题长度上限（Unicode 码点）：超长标题拒收，保留原始 URL，而不是把整页标题塞进文档。 */
export const MAX_URL_TITLE_LENGTH = 500;

/**
 * 整段粘贴文本恰好是一个 http / https URL 时返回原文，否则 null。
 *
 * 只认 `new URL` 能解析、协议为 http(s) 且 host 非空的串；前后空白、内部空白 / 控制字符
 * 一律拒绝（那种粘贴不是「只贴了一个 URL」，交给默认粘贴逐字节处理）。URL 原文原样返回
 * ——不把 `new URL().href` 的规范化结果写进文档。
 */
export function pastedHttpUrl(text: string): string | null {
  if (text === "" || text !== text.trim()) return null;
  if (/[\s\u0000-\u001f\u007f]/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "") return null;
  return text;
}

/**
 * 标题 → Markdown 链接标签的**纯文本**形式。
 *
 * 先抹掉控制字符、折叠空白（标题里的换行不能把链接拆成两行），再对可能在行内制造结构的
 * ASCII 标点做 CommonMark 反斜杠转义：转义后语法树只看到 `Escape` 节点，标题里的
 * `[` / `]` / `<b>` / `*` / `&amp;` / `|` / `$` 都保持字面文本，不会变成链接、HTML、
 * 强调、实体、表格 cell 或公式。空标题 / 超长标题返回 null（失败路径保留 URL）。
 */
export function markdownLinkLabel(title: string | null): string | null {
  if (title === null) return null;
  const plain = title
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain === "") return null;
  if (Array.from(plain).length > MAX_URL_TITLE_LENGTH) return null;
  // `\\` 必须一起进字符类：它先被换成 `\\`，后续替换不会再碰新加的反斜杠。
  return plain.replace(/[\\`*_[\]<>~^$|&:]/g, "\\$&");
}

/** 链接目标里的反斜杠 / 括号 / 尖括号：转义后标准链接的目标仍是 URL 原文（解码由 links.ts 负责）。 */
function escapeDestination(url: string): string {
  return url.replace(/[\\()<>]/g, "\\$&");
}

/** `[转义后的标题](转义后的 URL)`；标题不可用时 null。 */
export function markdownLinkFor(url: string, title: string | null): string | null {
  const label = markdownLinkLabel(title);
  if (label === null) return null;
  return `[${label}](${escapeDestination(url)})`;
}

/** 一次尚未返回的标题请求：`from`/`to` 是 URL 在文档里的位置，随事务映射。 */
export interface PendingUrlTitle {
  id: number;
  from: number;
  to: number;
  url: string;
}

export const addPendingUrlTitle = StateEffect.define<PendingUrlTitle>();
export const removePendingUrlTitle = StateEffect.define<number>();

/**
 * 待返回标题的 URL 区间。位置随每个事务映射：用户在等待期间在前面键入 / 删除，旧区间仍
 * 指向同一段 URL；在区间内编辑则切片对不上，改写被放弃（见 urlTitleReplacement）。
 *
 * 映射方向是「把边界外的新文本排除在区间外」：`from` 用 assoc 1（在起点插入的文本算在
 * URL 之前），`to` 用 assoc -1（在终点插入的文本算在 URL 之后）。
 */
export const pendingUrlTitleField = StateField.define<readonly PendingUrlTitle[]>({
  create: () => [],
  update(value, tr) {
    let next = value;
    if (tr.docChanged) {
      next = next.map((pending) => ({
        ...pending,
        from: tr.changes.mapPos(pending.from, 1),
        to: tr.changes.mapPos(pending.to, -1),
      }));
    }
    for (const effect of tr.effects) {
      if (effect.is(addPendingUrlTitle)) next = [...next, effect.value];
      else if (effect.is(removePendingUrlTitle)) next = next.filter((pending) => pending.id !== effect.value);
    }
    return next;
  },
});

/**
 * 异步标题返回时的改写形状；不允许改写时 null。三道闸：
 * 1. 标题可用（markdownLinkFor 的纯文本规则）；
 * 2. 区间里的文本仍是当初粘贴的 URL（用户在区间内编辑过就不碰）；
 * 3. 区间由 StateField 映射到当前文档（调用方取 pending 时已保证）。
 */
export function urlTitleReplacement(
  doc: Text,
  pending: PendingUrlTitle,
  title: string | null,
): ChangeSpec | null {
  if (doc.sliceString(pending.from, pending.to) !== pending.url) return null;
  const insert = markdownLinkFor(pending.url, title);
  if (insert === null) return null;
  return { from: pending.from, to: pending.to, insert };
}

/** 进程内自增 id：同一文档里多次粘贴互不覆盖（模块级，跨编辑器实例唯一）。 */
let nextPendingUrlTitleId = 1;

export function newPendingUrlTitle(from: number, to: number, url: string): PendingUrlTitle {
  return { id: nextPendingUrlTitleId++, from, to, url };
}

/** 当前 state 里待返回的请求（测试与调用方共用同一读取口径）。 */
export function pendingUrlTitles(state: EditorState): readonly PendingUrlTitle[] {
  return state.field(pendingUrlTitleField);
}

/**
 * 撤清当前 state 里全部 pending 的 effects（「切走即取消」/ 整篇重载用）。
 *
 * 调用方把它并进自己的事务：前台会话经 `view.dispatch`、后台会话经
 * `session.state.update({ effects })`——两侧都不碰对方的 view。
 */
export function clearPendingUrlTitleEffects(state: EditorState): StateEffect<unknown>[] {
  return pendingUrlTitles(state).map((pending) => removePendingUrlTitle.of(pending.id));
}
