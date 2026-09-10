// Mermaid 图表渲染（foundation-markdown「Math 与 Mermaid」用户裁决，M105 选型
// mermaid 官方包）。与 math.ts 的同步 KaTeX 不同，mermaid 体积大且渲染异步：
// - 懒加载：mermaid 只经 dynamic import 引用，Vite 隔离为独立 chunk，首个
//   ```mermaid 围栏块出现时才开始加载，不进入主 bundle；
// - 异步范式与 wikilink pending → previewRefresh 一致：装饰构建时缓存未命中
//   先出占位 widget 并触发后台渲染，settle（成功 / 失败 / 降级）后经
//   onMermaidSettled 通知装饰层派发 previewRefresh 重建；任何路径都有限
//   settle，不无限 pending、不阻塞 F0；
// - 失败降级：parse() 预校验 + render catch，回落「提示 + 完整原文围栏块」，
//   不伪装已支持；装饰只改视图，文档文本不动，选择/复制输出原始 Markdown
// （与其他 replace 装饰同口径）；
// - 三主题：渲染时按 documentElement data-theme 选 mermaid 主题（light→
//   default、dark→dark、eink→黑白 base），缓存键含主题，主题切换经
//   previewRefresh 重建后按新主题重渲染。
// 本模块顶层不触 DOM、不静态 import mermaid，Node 端测试可直接 import。

import { Decoration, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { detectFrontmatter } from "./frontmatter";
import { enterReplacedSource } from "./math";

/** 渲染结果三态：pending 占位 / ok SVG / error 降级（消息取首行）。
 * error 带阶段：load = 渲染器（懒加载 chunk / initialize）失败，
 * render = parse/render 失败，降级文案据此区分（load 失败提示可刷新重试）。 */
export type MermaidRenderState =
  | { status: "pending" }
  | { status: "ok"; svg: string }
  | { status: "error"; message: string; stage: "load" | "render" };

/** mermaid 默认导出的最小结构面（测试可注入假实现，Node 端无需 DOM）。 */
export interface MermaidRenderer {
  initialize(config: unknown): void;
  parse(source: string): Promise<unknown>;
  render(id: string, source: string): Promise<{ svg: string }>;
}

type ThemeKey = "light" | "dark" | "eink";

/** 当前 shell 主题（data-theme）；非 DOM 环境（Node 测试）按 light。 */
export function currentMermaidTheme(): ThemeKey {
  if (typeof document === "undefined") return "light";
  const value = document.documentElement.dataset.theme;
  return value === "dark" || value === "eink" ? value : "light";
}

// ---------------------------------------------------------------------------
// 懒加载与渲染队列：dynamic import 隔离 chunk；initialize 与 render 必须成对
// 串行（initialize 是全局态），所有渲染经 queue 排队，主题变化时重新 initialize。
// ---------------------------------------------------------------------------

const defaultLoader = (): Promise<MermaidRenderer> =>
  import("mermaid").then((m) => m.default as unknown as MermaidRenderer);

let loadRenderer = defaultLoader;
let rendererPromise: Promise<MermaidRenderer> | null = null;
let initializedTheme: ThemeKey | null = null;
let queue: Promise<unknown> = Promise.resolve();
let renderSeq = 0;

/** 测试钩子：替换 mermaid 加载器（null 复位为 dynamic import）。 */
export function setMermaidLoaderForTests(loader: (() => Promise<MermaidRenderer>) | null): void {
  loadRenderer = loader ?? defaultLoader;
  rendererPromise = null;
  initializedTheme = null;
}

// 有界超时（M110）：懒加载 chunk 在异常网络/CSP/协议问题下可能永不 settle，
// 渲染串行队列里一个永不 settle 的任务会堵死其后所有图表。两级超时保证任何
// 路径都有限 settle：加载 20s、parse/render 各 30s（大型图允许慢，但不许挂死）。
const LOAD_TIMEOUT_MS = 20_000;
const RENDER_TIMEOUT_MS = 30_000;
let loadTimeoutMs = LOAD_TIMEOUT_MS;
let renderTimeoutMs = RENDER_TIMEOUT_MS;

/** 测试钩子：覆盖两级超时（null 复位默认值）。 */
export function setMermaidTimeoutsForTests(loadMs: number | null, renderMs: number | null): void {
  loadTimeoutMs = loadMs ?? LOAD_TIMEOUT_MS;
  renderTimeoutMs = renderMs ?? RENDER_TIMEOUT_MS;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function renderer(): Promise<MermaidRenderer> {
  // 加载失败不缓存拒绝态：瞬时失败（如 dev server 重优化期间的过期 chunk）
  // 复位 rendererPromise，下一次渲染重新尝试 import（M110：此前一次失败会
  // 永久毒化后续所有渲染）。
  rendererPromise ??= loadRenderer().then(
    (mermaid) => mermaid,
    (error) => {
      rendererPromise = null;
      throw error;
    },
  );
  return rendererPromise;
}

// eink 是纯黑白高对比主题：base + 全黑白 themeVariables（网格 / 边框 / 文字
// 全部纯黑，底透明落到编辑器 --bg 上）。light/dark 用 mermaid 内置主题，
// background 透明，避免 mermaid 自带底色与编辑器 --bg 打架。
function themeConfig(theme: ThemeKey): Record<string, unknown> {
  const base = { startOnLoad: false, securityLevel: "strict" };
  if (theme === "eink") {
    return {
      ...base,
      theme: "base",
      themeVariables: {
        background: "transparent",
        primaryColor: "#ffffff",
        primaryTextColor: "#000000",
        primaryBorderColor: "#000000",
        secondaryColor: "#ffffff",
        tertiaryColor: "#ffffff",
        mainBkg: "#ffffff",
        nodeBorder: "#000000",
        clusterBkg: "#ffffff",
        clusterBorder: "#000000",
        edgeLabelBackground: "#ffffff",
        lineColor: "#000000",
        textColor: "#000000",
        titleColor: "#000000",
      },
    };
  }
  return { ...base, theme: theme === "dark" ? "dark" : "default", themeVariables: { background: "transparent" } };
}

async function doRender(source: string, theme: ThemeKey): Promise<MermaidRenderState> {
  const id = `cm-lp-mermaid-${++renderSeq}`;
  let stage: "load" | "render" = "load";
  try {
    const mermaid = await withTimeout(renderer(), loadTimeoutMs, `渲染器加载超时（${Math.round(loadTimeoutMs / 1000)}s）`);
    if (initializedTheme !== theme) {
      mermaid.initialize(themeConfig(theme));
      initializedTheme = theme;
    }
    stage = "render";
    await withTimeout(mermaid.parse(source), renderTimeoutMs, `渲染超时（${Math.round(renderTimeoutMs / 1000)}s）`); // 预校验：语法错误在此抛出，不进 render
    const { svg } = await withTimeout(mermaid.render(id, source), renderTimeoutMs, `渲染超时（${Math.round(renderTimeoutMs / 1000)}s）`);
    return { status: "ok", svg };
  } catch (e) {
    // mermaid.render 失败时可能留下 id 为 d<id> 的临时节点，尽力清理。
    if (typeof document !== "undefined") document.getElementById(`d${id}`)?.remove();
    return { status: "error", message: e instanceof Error ? e.message.split("\n")[0] : String(e), stage };
  }
}

function renderQueued(source: string, theme: ThemeKey): Promise<MermaidRenderState> {
  const job = queue.then(() => doRender(source, theme));
  queue = job.catch(() => {});
  return job;
}

// ---------------------------------------------------------------------------
// 渲染缓存：按「主题 + 源码」键控（含失败结果，避免装饰重建时重复渲染）。
// 设上限，超限整批清空（重建成本是一次重新渲染），与 math.ts 同口径。
// ---------------------------------------------------------------------------

const RENDER_CACHE_LIMIT = 1000;

const renderCache = new Map<string, MermaidRenderState>();

const settleListeners = new Set<() => void>();

/** settle（成功 / 失败 / 降级）通知：装饰层据此派发 previewRefresh。 */
export function onMermaidSettled(listener: () => void): () => void {
  settleListeners.add(listener);
  return () => settleListeners.delete(listener);
}

/**
 * 取「主题 + 源码」的渲染状态：命中缓存直接返回；未命中登记 pending 并
 * 触发后台渲染，settle 后写入缓存并通知 onMermaidSettled。
 */
export function ensureMermaidRender(source: string, theme: ThemeKey): MermaidRenderState {
  const key = `${theme}\n${source}`;
  const hit = renderCache.get(key);
  if (hit) return hit;
  if (renderCache.size >= RENDER_CACHE_LIMIT) renderCache.clear();
  const pending: MermaidRenderState = { status: "pending" };
  renderCache.set(key, pending);
  void renderQueued(source, theme).then((result) => {
    renderCache.set(key, result);
    for (const listener of settleListeners) listener();
  });
  return pending;
}

/** 测试钩子：当前缓存条目数。 */
export function mermaidRenderCacheSize(): number {
  return renderCache.size;
}

/** 测试钩子：清空渲染缓存（不含 in-flight 任务，其 settle 仍写缓存）。 */
export function clearMermaidRenderCache(): void {
  renderCache.clear();
}

// ---------------------------------------------------------------------------
// 装饰：```mermaid 围栏块整块 replace（跨行 block，走 StateField，与
// frontmatter / 块级公式同约束）。选区进入块范围时跳过装饰显示原文
//（编辑/选择可见源码，与 mathBlockSet 的 selected 口径一致）。
// ---------------------------------------------------------------------------

/** 占位 / 成功 SVG / 失败降级三态 widget；state 对象身份参与 eq，settle 后重建。
 * 三态都挂 mousedown 进入源码编辑（M112，复用 M111 公式口径）：replace widget
 * 整体隐藏源码，CM 对 widget 内事件 ignoreEvent 不落光标；且 mermaid 渲染异步，
 * 布局位移期原生落点若滞留被替换的 widget 节点会被 CM 映射为 0（落点跳文档
 * 起点），preventDefault 一并掐断该路径。pending 态点击同样显露源码：后台渲染
 * settle 后选区仍重叠块范围，装饰保持显露、不回弹渲染态。 */
class MermaidBlockWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly raw: string,
    readonly state: MermaidRenderState,
  ) {
    super();
  }

  eq(other: MermaidBlockWidget): boolean {
    return other.source === this.source && other.state === this.state;
  }

  // 光标钳制区间（相对块起点）：开围栏行之后到闭围栏行之前，与公式 delimiter
  // 口径一致（落在边界会重新触发渲染态）。退化块（无换行 / 无正文）收缩为块内
  // 单点，仅保证严格落在块范围内以触发显露。
  private innerRange(): { from: number; to: number } {
    const openEnd = this.raw.indexOf("\n");
    const from = openEnd < 0 ? 1 : openEnd + 1;
    const closeStart = this.raw.lastIndexOf("\n");
    return { from, to: closeStart > openEnd ? closeStart : from };
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("div");
    box.className = "cm-lp-mermaid";
    let root = box;
    if (this.state.status === "ok") {
      // securityLevel strict 下 mermaid 产出的 SVG 不含脚本/外链（与 KaTeX
      // innerHTML 同口径：信任渲染器产出，样式走 SVG 内联，CSP 无需改动）。
      box.innerHTML = this.state.svg;
      box.title = this.raw;
    } else if (this.state.status === "pending") {
      box.classList.add("cm-lp-mermaid-pending");
      box.textContent = "Mermaid 图表渲染中…";
    } else {
      box.classList.add("cm-lp-mermaid-fallback");
      const err = document.createElement("div");
      err.className = "cm-lp-mermaid-error";
      err.textContent =
        this.state.stage === "load"
          ? `图表渲染器加载失败：${this.state.message}（可尝试刷新页面重试）`
          : `图表解析失败：${this.state.message}`;
      const raw = document.createElement("pre");
      raw.className = "cm-lp-mermaid-raw";
      raw.textContent = this.raw;
      box.append(err, raw);
      // 降级块的纵向间距由 -outer padding 承载（widget margin 不计入 CM 测量）。
      const outer = document.createElement("div");
      outer.className = "cm-lp-mermaid-fallback-outer";
      outer.append(box);
      root = outer;
    }
    root.addEventListener("mousedown", (event) => {
      const { from, to } = this.innerRange();
      enterReplacedSource(event, view, root, from, to);
    });
    return root;
  }
}

/**
 * 全文档 ```mermaid 围栏块装饰（StateField 侧）。廉价存在性检查先行
 *（tr.selection 每次光标移动都触发本函数，语法树遍历只在确有 mermaid
 * 字样时发生）。渲染在后台异步发生且有缓存，不阻塞 F0。
 */
export function mermaidBlockSet(state: EditorState): DecorationSet {
  const { doc } = state;
  let maybe = false;
  for (let n = 1; n <= doc.lines; n++) {
    if (doc.line(n).text.includes("mermaid")) {
      maybe = true;
      break;
    }
  }
  if (!maybe) return Decoration.none;
  const tree = syntaxTree(state);
  const fm = detectFrontmatter(doc);
  const theme = currentMermaidTheme();
  const decos: Range<Decoration>[] = [];
  tree.iterate({
    enter(ref) {
      if (ref.name !== "FencedCode") return;
      const info = ref.node.getChild("CodeInfo");
      if (!info || doc.sliceString(info.from, info.to).trim() !== "mermaid") return;
      if (fm !== null && ref.from >= fm.from && ref.to <= fm.to) return;
      if (state.selection.ranges.some((r) => r.from < ref.to && r.to > ref.from)) return;
      const codeText = ref.node.getChild("CodeText");
      const source = codeText ? doc.sliceString(codeText.from, codeText.to).trim() : "";
      const raw = doc.sliceString(ref.from, ref.to);
      decos.push(
        Decoration.replace({
          widget: new MermaidBlockWidget(source, raw, ensureMermaidRender(source, theme)),
          block: true,
        }).range(ref.from, ref.to),
      );
      return false;
    },
  });
  return Decoration.set(decos, true);
}
