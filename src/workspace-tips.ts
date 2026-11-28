// 无 Tab 空工作区与首启共用的产品特有 tips（Alex 2026-11-28 重设计）。
//
// 本模块只产 DOM，不读全局状态、不注册事件。首启与普通 / 双 pane 空态由装配层选择挂载点，
// 但内容、顺序与语义只能来自这里。静态 region 用 tabindex=-1 承接程序焦点，不进入 Tab 序；
// 可见 h2 同时是它的读屏名，h3 让四项进入读屏标题导航。

import "./workspace-tips.css";
import type { CopyKey } from "./copy";
import { t } from "./copy";
import { glyphOfToken } from "./key-glyphs";
import { KEY_BINDINGS } from "./keys";
import type { CommandId } from "./keys";

interface TipFeature {
  id: "outline" | "quote" | "wikilink" | "harness";
  title: CopyKey;
  description: CopyKey;
  token:
    | { kind: "key"; command: CommandId }
    | { kind: "token"; text: string }
    | { kind: "gesture"; token: CopyKey };
}

const FEATURES: readonly TipFeature[] = [
  {
    id: "outline",
    title: "D1038",
    description: "D1092",
    token: { kind: "key", command: "toc.toggle" },
  },
  {
    id: "quote",
    title: "D1043",
    description: "D1093",
    token: { kind: "gesture", token: "D1046" },
  },
  {
    id: "wikilink",
    title: "D1042",
    description: "D1094",
    token: { kind: "token", text: "[[" },
  },
  {
    id: "harness",
    title: "D1040",
    description: "D1095",
    token: { kind: "key", command: "harness.toggle" },
  },
];

function keyGlyph(command: CommandId): string {
  const binding = KEY_BINDINGS.find((entry) => entry.command === command);
  return binding === undefined ? "" : glyphOfToken(binding.key);
}

/** 建一块共享空态 tips。id 由调用方按 pane 提供，保证可见标题与 region 的引用唯一。 */
export function createWorkspaceTips(id: string): HTMLElement {
  const root = document.createElement("section");
  root.className = "workspace-tips";
  root.tabIndex = -1;
  root.setAttribute("role", "region");
  root.setAttribute("aria-labelledby", `${id}-title`);

  const body = document.createElement("div");
  body.className = "workspace-tips-body";
  const title = document.createElement("h2");
  title.id = `${id}-title`;
  title.className = "workspace-tips-title";
  title.textContent = t("D1035");
  body.append(title);

  const list = document.createElement("ol");
  list.className = "workspace-tips-list";
  // Safari 在 list-style:none + grid 下会移除原生列表语义，显式恢复（modern-web-guidance）。
  list.setAttribute("role", "list");
  FEATURES.forEach((feature, index) => {
    const item = document.createElement("li");
    item.className = "workspace-tips-item";
    item.dataset.tip = feature.id;

    const marker = document.createElement("span");
    marker.className = "workspace-tips-index";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = String(index + 1).padStart(2, "0");

    const copy = document.createElement("div");
    copy.className = "workspace-tips-copy";
    const label = document.createElement("h3");
    label.className = "workspace-tips-label";
    label.textContent = t(feature.title);
    const description = document.createElement("p");
    description.className = "workspace-tips-description";
    description.textContent = t(feature.description);
    copy.append(label, description);

    const token = document.createElement(feature.token.kind === "gesture" ? "span" : "kbd");
    token.className = `workspace-tips-token workspace-tips-${feature.token.kind}`;
    token.textContent =
      feature.token.kind === "key"
        ? keyGlyph(feature.token.command)
        : feature.token.kind === "gesture"
          ? `${t(feature.token.token)} →`
          : feature.token.text;
    item.append(marker, copy, token);
    list.append(item);
  });

  body.append(list);
  root.append(body);
  return root;
}
