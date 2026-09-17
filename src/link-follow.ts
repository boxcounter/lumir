// wikilink 与 Markdown 链接：解析缓存、跟随、一键创建（语义全部经 invoke 取 Rust link_graph 结果）。
//
// M151 从 main.ts 抽出（M127 的拆分判据「main.ts 收敛为装配层」的续作）。模块边界：
//   - 解析缓存的四个状态（resolveCache / pendingResolve / failedResolve / resolveEpoch）是本模块
//     私有状态，装配侧不持有副本，只能经 invalidate()（from 变了 / watch 增量 / 创建后）与
//     resetForVault()（换 vault）让它整批失效；
//   - 链接判定与五条跟随链路（wikilink / 外链 / 相对路径 md / vault 内资产 / 纯锚点）都在这里，
//     键盘路径（followAt）与鼠标路径（⌘-Click，构造时就地挂监听）共用同一份判定与跟随；
//   - 装配侧只注入三样它才知道的事实：编辑器句柄（活读前台会话 + 重建装饰）、打开文档的落点
//     （main 的 openFile：含模式裁决、保存链路登记与标签意图）、人话提示出口。

import { logEvent } from "./diagnostics";
import type { EditorHandle } from "./editor";
import {
  errorMessage,
  isCommandError,
  linkGraphResolve,
  linkOpenPath,
  linkResolveNote,
  openExternalUrl,
  wikilinkCreate,
} from "./ipc";
import { standardLinkAt } from "./preview/links";
import { findWikilinkSpans } from "./preview/wikilinks";
import type { WikilinkResolver } from "./preview/livePreview";
import { openKind } from "./tree";
import type { OpenKind } from "./tree";
import type { LinkResolveResult } from "./bindings/LinkResolveResult";

export interface LinkFollowDeps {
  editor: EditorHandle;
  /** 打开文档（main 的 openFile：模式裁决、保存链路登记与标签落点都在那边）。
   *  **不传 intent**：链接跟随一律就地替换前台标签（"current" 是 openFile 的默认值）。 */
  openFile: (path: string, kind: OpenKind) => Promise<void>;
  /** 人话提示出口（装配层注入）。 */
  toast: (text: string, actions?: Array<{ label: string; run(): void }>) => void;
}

export interface LinkFollowHandle {
  /** editor.setWikilinkResolver 要的那份解析器（vault 打开后由装配侧注入）。 */
  resolver: WikilinkResolver;
  /** 解析状态整批失效（from 变更 / watch 增量 / 一键创建后共用）。 */
  invalidate(): void;
  /** vault 换代：世代号自增（在途 resolve 回调据此丢弃旧 vault 的迟到响应）+ 整批失效。 */
  resetForVault(): void;
  /** 跟随给定位置（光标 / 选区 head / 点击坐标换算的位置）上的链接；不在链接上无操作。 */
  followAt(pos: number): void;
}

export function createLinkFollow(deps: LinkFollowDeps): LinkFollowHandle {
  const { editor, openFile, toast } = deps;

  /**
   * wikilink resolve 的 from 基准：**活读前台会话**，不另存一份副本。
   *
   * 为什么不是模块级变量（M149 排查出的一处真 bug）：那份副本与会话里的路径是同语义的
   * 两处真源，装载时序上只要晚半步就会整批出错——装饰层在**装载事务的 dispatch 里**就问
   * resolver，此时 `from` 若还是 undefined，`resolve()` 连在途解析都不发起（见下面 resolve
   * 的第一个分支），这一批 wikilink 会全部停在 pending 且永不自动重来（视觉场景
   * `wikilink.spec.ts` 的 `.cm-lp-wikilink-resolved` 找不到就是这个原因）。
   * 会话的 path 在装载之前就已就位（reloadSession 的第一件事），活读它没有这个时间窗。
   */
  function resolveBase(): string | undefined {
    const session = editor.activeSession();
    return session.mode === "md" ? session.path : undefined;
  }
  /** 解析结果缓存：键 = `${from}\n${raw}`。watch 增量 / 切文件 / 创建后整批失效。 */
  const resolveCache = new Map<string, LinkResolveResult>();
  const pendingResolve = new Set<string>();
  /** 业务错误降级集合：resolve 失败的键（与 resolveCache 同生命周期，随其整批失效）。 */
  const failedResolve = new Set<string>();
  /** vault 世代号：resetForVault 自增，在途 resolve 回调据此丢弃旧 vault 的迟到响应。 */
  let resolveEpoch = 0;

  /** 解析失败分类：仅命令缺失 / 无后端（非 CommandError 信封）才整体降级。 */
  function handleResolveFailure(key: string, epoch: number, e: unknown): void {
    if (epoch !== resolveEpoch) return; // 旧 vault 的迟到响应，直接丢弃
    if (isCommandError(e)) {
      // 业务错误（路径逃逸 / 目标不存在 / vault_not_open 等）：只降级该链接——
      // 保持中性 pending 视觉，不拖垮其余链接的语义渲染；显式点击走
      // followWikilink 的 catch 弹人话提示，此处被动渲染不打扰。
      failedResolve.add(key);
      editor.refreshPreview();
    } else {
      // invoke 层失败（命令未注册 / 无 Tauri 后端，如纯浏览器预览桩）：整体降级
      editor.setWikilinkResolver(null);
    }
  }

  const wikilinkResolver: WikilinkResolver = {
    resolve(raw: string): LinkResolveResult | undefined {
      const from = resolveBase();
      if (from === undefined) return undefined;
      const key = `${from}\n${raw}`;
      const hit = resolveCache.get(key);
      if (hit) return hit;
      if (failedResolve.has(key)) return undefined; // 该链接已知失败，保持中性渲染
      if (!pendingResolve.has(key)) {
        pendingResolve.add(key);
        const epoch = resolveEpoch;
        linkGraphResolve(from, raw).then(
          (r) => {
            if (epoch !== resolveEpoch) return;
            resolveCache.set(key, r);
            editor.refreshPreview();
          },
          (e) => handleResolveFailure(key, epoch, e),
        ).finally(() => pendingResolve.delete(key));
      }
      return undefined;
    },
  };

  /** 解析状态整批失效（from 变更 / watch 增量 / 一键创建后共用）。 */
  function invalidate(): void {
    resolveCache.clear();
    failedResolve.clear();
    // 在途标记一并清：被 epoch 丢弃的迟到响应不会重触发解析，不清会让同 key
    // 链接卡在中性渲染；在途 promise 的 finally delete 对已清集合是 no-op。
    pendingResolve.clear();
  }

  /** vault 换代（原 main 里成对的两句 `resolveEpoch += 1; invalidateResolve()`）：
   *  世代号与整批失效必须同时发生——只清缓存不换世代，旧 vault 的迟到响应会把结果写进
   *  新 vault 的缓存（世代号就是为这条丢的）。 */
  function resetForVault(): void {
    resolveEpoch += 1;
    invalidate();
  }

  /** 激活链接（Mod-Click / ⌘Enter）：按解析结果跳转、提示或给出一键创建入口。 */
  async function followWikilink(raw: string): Promise<void> {
    const from = resolveBase();
    if (from === undefined) return;
    let result = resolveCache.get(`${from}\n${raw}`);
    if (!result) {
      try {
        result = await linkGraphResolve(from, raw);
        resolveCache.set(`${from}\n${raw}`, result);
      } catch (e) {
        toast(errorMessage(e));
        return;
      }
    }
    switch (result.status) {
      case "resolved":
      case "ambiguous": {
        const path = result.path;
        if (path === null) return;
        await openFile(path, openKind(path));
        // spec §4.2：锚点找到定位标题行；缺失时打开文件并提示，不静默停在顶部
        if (result.anchor.status === "found" && result.anchor.line !== null) {
          editor.revealLine(result.anchor.line);
        } else if (result.anchor.status === "missing") {
          toast(`标题未找到：${result.anchor.heading ?? ""}`);
        }
        break;
      }
      case "unresolved":
        // spec §4.3：unresolved 不是错误；§4.4：提供一键创建入口
        toast(`未创建的链接：${raw}`, [{
          label: "创建并打开",
          run: () => void createForWikilink(from, raw),
        }]);
        break;
      case "unsupported":
        toast(`块引用不支持：${raw}`);
        break;
    }
  }

  async function createForWikilink(from: string, raw: string): Promise<void> {
    try {
      const { created } = await wikilinkCreate(from, raw);
      invalidate();
      editor.refreshPreview(); // 创建成功后链接转为正常态（spec §4.4）
      await openFile(created, "md");
      toast(`已创建：${created}`);
    } catch (e) {
      // 目标已存在 = 索引过期（spec §4.4）：清缓存重解析而非覆盖
      invalidate();
      editor.refreshPreview();
      toast(errorMessage(e));
    }
  }

  /** 光标/点击处的非 embed wikilink span（span 定位是前端唯一持有的词法逻辑）。 */
  function wikilinkAt(pos: number): string | null {
    const text = editor.view.state.doc.toString();
    for (const span of findWikilinkSpans(text)) {
      if (!span.embed && pos >= span.from && pos < span.to) {
        return text.slice(span.from, span.to);
      }
    }
    return null;
  }

  /**
   * 光标/点击处的链接（M144 起外链，M145 扩到全形态）：wikilink 或标准 Markdown 链接。
   *
   * wikilink 优先且路径逐字未动：`[[x]]` 在语法树里也是一个没有 URL 子节点的 `Link`
   * 节点，标准链接判定天然不命中它，两者不会互相抢；顺序写死仍是有意的——wikilink 的
   * 语义只有 Rust link_graph 一份，先问它。
   *
   * vault 上下文（打开中的 md 文件）是 vault 内跳转类链接的前提：`[x](note.md)` 与
   * `[x](./doc.pdf)` 的解析基准就是当前文件，没有它就不算可激活的链接。外链与纯锚点
   * 不受此限（前者不需要 vault，后者就在这份文档里）。
   *
   * 键盘路径（选区 head）与鼠标路径（点击坐标）共用本判定，跟随逻辑只有一份。
   */
  type LinkTarget =
    | { kind: "wikilink"; raw: string }
    | { kind: "external"; url: string }
    | { kind: "note"; target: string }
    | { kind: "asset"; target: string }
    | { kind: "anchor" };

  function linkTargetAt(pos: number): LinkTarget | null {
    const raw = wikilinkAt(pos);
    if (raw !== null) {
      return resolveBase() === undefined ? null : { kind: "wikilink", raw };
    }
    const link = standardLinkAt(editor.view.state, pos);
    if (link === null) return null;
    switch (link.form.kind) {
      case "external":
        return { kind: "external", url: link.form.url };
      case "internal":
        return resolveBase() === undefined ? null : { kind: "note", target: link.form.target };
      case "asset":
        return resolveBase() === undefined ? null : { kind: "asset", target: link.form.target };
      case "anchor":
        return { kind: "anchor" };
      case "blocked":
        // 白名单外 scheme 不装饰也不激活（渲染层同样保持原文）。这里显式记一条诊断：
        // 「按了 ⌘⏎ 没反应」是 dogfood 里最难归因的一类反馈，日志要能回答它是被拒的。
        logEvent("link_open", { category: "blocked-scheme", outcome: "rejected" });
        return null;
    }
  }

  /** 跟随链接：应用内跳转（wikilink / 相对路径 md）与交系统默认应用（外链 / vault 内资产）
   *  各走各的链路，纯锚点只给提示（M145：不做文档内滚动跳转）。 */
  function followLink(target: LinkTarget): void {
    switch (target.kind) {
      case "wikilink":
        void followWikilink(target.raw);
        break;
      case "external":
        void openExternalLink(target.url);
        break;
      case "note":
        void followNoteLink(target.target);
        break;
      case "asset":
        void openVaultAsset(target.target);
        break;
      case "anchor":
        logEvent("link_open", { category: "anchor", outcome: "unsupported" });
        toast("暂不支持锚点跳转");
        break;
    }
  }

  /** 外链交给系统默认应用打开（Rust 侧校验 scheme）；失败给人话提示。 */
  async function openExternalLink(url: string): Promise<void> {
    try {
      await openExternalUrl(url);
    } catch (e) {
      toast(errorMessage(e));
    }
  }

  /**
   * 跟随相对路径 md 链接 `[x](note.md)`（M145）：解析交 Rust（`link_resolve_note`——
   * 相对当前文件所在目录的路径语义，与 wikilink 的名称匹配不同源），命中的文件走
   * 与 wikilink 同一条 `openFile` 打开链路，因此应用内只存在一套「打开一篇笔记」。
   *
   * 解析不到只提示、不创建文件：一键创建是 wikilink 的显式动作（spec §4.4），
   * 相对路径链接不继承它——作者写错路径时，凭空多出一个文件和只给一句提示相比，
   * 后者才是他要的。
   */
  async function followNoteLink(target: string): Promise<void> {
    const from = resolveBase();
    if (from === undefined) return;
    try {
      const path = await linkResolveNote(from, target);
      if (path === null) {
        logEvent("link_open", { category: "internal-md", outcome: "unresolved" });
        toast(`链接目标不存在：${target}`);
        return;
      }
      logEvent("link_open", { category: "internal-md", outcome: "opened" });
      await openFile(path, openKind(path));
    } catch (e) {
      toast(errorMessage(e));
    }
  }

  /** 打开 vault 内的非 md 文件 / 目录 `[x](./doc.pdf)`：交系统默认应用。目标必须落在
   *  vault 内（Rust 侧前缀校验），落不进去 / 不存在时透传它的人话错误。 */
  async function openVaultAsset(target: string): Promise<void> {
    const from = resolveBase();
    if (from === undefined) return;
    try {
      await linkOpenPath(from, target);
    } catch (e) {
      toast(errorMessage(e));
    }
  }

  /** 键位路径（⌘⏎ / link.follow）：判定 + 跟随，不在链接上无操作（不假装有反馈）。 */
  function followAt(pos: number): void {
    const target = linkTargetAt(pos);
    if (target !== null) followLink(target);
  }

  // 点击跳转（spec §4.2）：⌘-Click 命中链接时阻止选区落点，直接跟随链接；
  // 裸点击不拦截，保持链接文本可正常落点编辑。
  // M132 收窄：鼠标路径与 D1 的 ⌘/⌃ 拆分对齐——只有 ⌘-Click 跟随链接；⌃-Click 让位给
  // macOS 的系统级次级点击（右键等价手势），不再被当作链接激活。键位表只管键盘，鼠标
  // 路径就地判定（收窄前是 e.metaKey || e.ctrlKey，与拆分前的键盘口径同源）。
  // M144：鼠标路径同样覆盖外链——外链不需要 vault 上下文，故不再以 currentPath 提前返回。
  // M145：同一条路径覆盖全部可激活形态（应用内跳转类仍要求 vault 上下文，判定在 linkTargetAt）。
  editor.view.dom.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (!e.metaKey) return;
    const pos = editor.view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos === null) return;
    const target = linkTargetAt(pos);
    if (target === null) return; // 不在链接上：不拦截，选区正常落点
    e.preventDefault();
    followLink(target);
  });

  return { resolver: wikilinkResolver, invalidate, resetForVault, followAt };
}
