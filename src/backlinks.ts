// backlinks 只读面板（backlinks-panel capability）。
// 数据来自 link_graph_backlinks（link graph 是只读派生物，ADR 0003 §1）：
// 面板只读，不提供任何改写来源文件的入口；点击条目跳转来源文件对应行。
// 样式就地注入（src/style.css 不在本 change 改动面内；editor 装饰样式走
// CM theme 的先例见 src/preview/theme.ts）。

import type { BacklinkItem } from "./bindings/BacklinkItem";
import { errorMessage, linkGraphBacklinks } from "./ipc";

export interface BacklinksPanel {
  /** 切换当前文件（无文件或非 md 传 undefined）。 */
  setFile(path: string | undefined): void;
  /** 数据可能过期时重拉（watch 增量事件 / 一键创建后）。 */
  refresh(): void;
}

export interface BacklinksPanelOptions {
  /** 点击反链条目：跳转来源文件的对应行。 */
  onJump(source: string, line: number): void;
}

export function createBacklinksPanel(
  mount: HTMLElement,
  opts: BacklinksPanelOptions,
): BacklinksPanel {
  ensureStyles();

  const root = document.createElement("div");
  root.className = "bl-panel";
  const header = document.createElement("div");
  header.className = "bl-header";
  header.textContent = "反链";
  const body = document.createElement("div");
  body.className = "bl-body";
  root.append(header, body);
  mount.append(root);

  let current: string | undefined;
  let seq = 0; // 竞态守卫：旧响应丢弃

  function renderEmpty(text: string): void {
    const empty = document.createElement("div");
    empty.className = "bl-empty";
    empty.textContent = text;
    body.replaceChildren(empty);
  }

  function renderItems(items: BacklinkItem[]): void {
    if (items.length === 0) {
      renderEmpty("无反链");
      return;
    }
    const list = document.createElement("div");
    list.className = "bl-list";
    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bl-item";
      btn.title = `${item.source}:${item.line}`;

      const head = document.createElement("span");
      head.className = "bl-source";
      head.textContent = item.source;
      const line = document.createElement("span");
      line.className = "bl-line";
      line.textContent = `:${item.line}`;
      const context = document.createElement("span");
      context.className = "bl-context";
      context.textContent = item.context;

      btn.append(head, line, context);
      btn.addEventListener("click", () => opts.onJump(item.source, item.line));
      list.append(btn);
    }
    body.replaceChildren(list);
  }

  async function load(): Promise<void> {
    const my = ++seq;
    if (!current) {
      renderEmpty("打开文件后显示反链");
      return;
    }
    try {
      const items = await linkGraphBacklinks(current);
      if (my !== seq) return;
      renderItems(items);
    } catch (e) {
      if (my !== seq) return;
      renderEmpty(errorMessage(e));
    }
  }

  return {
    setFile(path: string | undefined) {
      current = path;
      void load();
    },
    refresh() {
      void load();
    },
  };
}

let stylesInjected = false;

function ensureStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
.bl-panel { font-family: -apple-system, "PingFang SC", sans-serif; white-space: normal; }
.bl-header { font-weight: 600; color: #333; padding: 4px 0 8px; font-size: 13px; }
.bl-item {
  display: block; width: 100%; border: none; background: none; text-align: left;
  padding: 4px 6px; margin: 0 0 2px; border-radius: 4px; cursor: pointer;
  font: inherit; font-size: 12px; color: #333;
}
.bl-item:hover { background: #e8e8e8; }
.bl-source { color: #1a5fb4; }
.bl-line { color: #999; margin-right: 4px; }
.bl-context {
  display: block; color: #555; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.bl-empty { color: #888; font-size: 12px; padding: 4px 0; white-space: pre-wrap; }
`;
  document.head.append(style);
}
