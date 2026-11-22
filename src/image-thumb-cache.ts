/**
 * 缩略图 blob URL 的有界缓存（内部资源治理，2026-11-23）。
 *
 * 背景：面板每次整面重渲（逐键击）都按 `data-thumb-name` 取缩略图，读回命令必须只发一次；
 * 但 blob URL 的字节在 `Map<string, string|null>` 里只增不减——卡片移除、切会话、切 vault
 * 都不释放，长会话累计的图片字节无界。本模块把缓存收成一个可单测的账本：
 *
 * - 条目 = `{ url: string | null, bytes }`：成功项按 `byteLength` 记账，失败项（null）占条目
 *   不占字节；`get` 命中刷新 LRU（Map 的 delete + set 即提序）。
 * - 预算 = `maxBytes` + `maxEntries`：`put` 之后立即 `prune`，只淘汰**非活跃**项并
 *   `revokeObjectURL`；活跃项即使超预算也不动（活跃总字节可超上限——正在显示的 50MB 图
 *   不能被误删）。
 * - `clear` 全量 revoke（切 vault 的唯一入口）。
 *
 * 活跃名单由调用方注入（面板从当前 DOM 的 `[data-thumb-name]` 派生）——缓存本身不认 DOM，
 * 纯逻辑因此可在零 DOM 单测里逐条驱动。
 */

interface Entry {
  readonly url: string | null;
  readonly bytes: number;
}

export interface ImageThumbCacheLimits {
  /** 全部条目（含活跃）的字节预算；活跃项不参与淘汰，因此实际可暂时超限。 */
  readonly maxBytes: number;
  /** 条目数上限（失败 null 条目也计数）；活跃项不参与淘汰。 */
  readonly maxEntries: number;
}

export interface ImageThumbCacheOptions extends ImageThumbCacheLimits {
  /** 当前活跃（正在显示 / 刚插入面板 DOM）的图片名；每次 prune 现取。 */
  readonly activeNames: () => ReadonlySet<string>;
  /** blob URL 工厂（默认 `URL.createObjectURL(new Blob(...))`；单测注入计数桩）。 */
  readonly createUrl?: (bytes: Uint8Array<ArrayBuffer>, mime: string) => string;
  /** blob URL 释放（默认 `URL.revokeObjectURL`；单测注入计数桩）。 */
  readonly revokeUrl?: (url: string) => void;
}

function defaultCreateUrl(bytes: Uint8Array<ArrayBuffer>, mime: string): string {
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

function defaultRevokeUrl(url: string): void {
  URL.revokeObjectURL(url);
}

export class ImageThumbCache {
  private readonly entries = new Map<string, Entry>();
  private readonly maxBytes: number;
  private readonly maxEntries: number;
  private readonly activeNames: () => ReadonlySet<string>;
  private readonly createUrl: (bytes: Uint8Array<ArrayBuffer>, mime: string) => string;
  private readonly revokeUrl: (url: string) => void;
  private bytes = 0;

  constructor(options: ImageThumbCacheOptions) {
    this.maxBytes = options.maxBytes;
    this.maxEntries = options.maxEntries;
    this.activeNames = options.activeNames;
    this.createUrl = options.createUrl ?? defaultCreateUrl;
    this.revokeUrl = options.revokeUrl ?? defaultRevokeUrl;
  }

  /** 条目数（含 null 条目与活跃条目）。 */
  get size(): number {
    return this.entries.size;
  }

  /** 已记账字节（只含成功项；活跃项可使其暂时超预算）。 */
  get totalBytes(): number {
    return this.bytes;
  }

  /**
   * 读缓存并刷新 LRU：命中返回 URL 或 null（失败占位），未命中返回 undefined。
   * null 与 undefined 必须区分——前者是「已确认读不回来」（不再重读、不再 toast），
   * 后者是「没有缓存」（走读回命令）。
   */
  get(name: string): string | null | undefined {
    const entry = this.entries.get(name);
    if (entry === undefined) return undefined;
    this.entries.delete(name);
    this.entries.set(name, entry);
    return entry.url;
  }

  /**
   * 写入成功项并立即 prune。条目被淘汰（非活跃且超预算）时 URL 当场 revoke——调用方
   * 应在写入前确认该图在场（活跃），否则新条目可能写入即淘汰；面板的路径是「先插卡、
   * 读回异步落地」，落地时卡片已在 DOM 里。
   */
  put(name: string, bytes: Uint8Array<ArrayBuffer>, mime: string): void {
    const url = this.createUrl(bytes, mime);
    this.replace(name, { url, bytes: bytes.byteLength });
    this.prune();
  }

  /** 写入失败项（null，不占字节）并立即 prune。失败项同样占条目数，条目上限因此有界。 */
  putFailure(name: string): void {
    this.replace(name, { url: null, bytes: 0 });
    this.prune();
  }

  /** 淘汰非活跃项直到回到预算内；活跃项永远保留（预算 / 条目上限都可被活跃项超出）。 */
  prune(active: ReadonlySet<string> = this.activeNames()): void {
    if (this.entries.size <= this.maxEntries && this.bytes <= this.maxBytes) return;
    for (const [name, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries && this.bytes <= this.maxBytes) break;
      if (active.has(name)) continue;
      this.entries.delete(name);
      this.bytes -= entry.bytes;
      if (entry.url !== null) this.revokeUrl(entry.url);
    }
  }

  /** 全量释放（切 vault）：每个 URL 恰好 revoke 一次。 */
  clear(): void {
    for (const entry of this.entries.values()) {
      if (entry.url !== null) this.revokeUrl(entry.url);
    }
    this.entries.clear();
    this.bytes = 0;
  }

  private replace(name: string, next: Entry): void {
    const previous = this.entries.get(name);
    if (previous !== undefined) {
      this.entries.delete(name);
      this.bytes -= previous.bytes;
      // 同一个 URL 被复用（测试桩 / 未来可能的别名）时不 revoke：revoke 的语义是释放。
      if (previous.url !== null && previous.url !== next.url) this.revokeUrl(previous.url);
    }
    this.entries.set(name, next);
    this.bytes += next.bytes;
  }
}
