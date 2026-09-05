import type { Page } from "@playwright/test";

// 无 Tauri 后端的 chromium 里跑真实前端：按 @tauri-apps/api 的
// __TAURI_INTERNALS__ 形状打桩（参考 node_modules/@tauri-apps/api/mocks.js），
// invoke 走 fixture 路由；listen 经 transformCallback/plugin:event|listen 注册，
// 场景里用 window.__fireFsEvent 模拟后端 emit fs:entry_changed。

export interface VaultFixture {
  entries: unknown[];
  files?: Record<string, string>;
  notice?: string | null;
  /** link_graph_resolve 桩：链接原文 → LinkResolveResult。未命中按 unresolved 应答。 */
  links?: Record<string, unknown>;
  /** wikilink_create 桩：链接原文 → 创建后的 vault 相对路径（同时写入 files）。 */
  creates?: Record<string, string>;
  /** link_graph_backlinks 桩：文件路径 → BacklinkItem[]。 */
  backlinks?: Record<string, unknown[]>;
}

export async function stubTauri(page: Page, vault: VaultFixture | null): Promise<void> {
  await page.addInitScript((v: VaultFixture | null) => {
    const w = window as unknown as Record<string, unknown>;
    const callbacks = new Map<number, (data: unknown) => void>();
    const listeners = new Map<string, number[]>();
    let nextId = 1;

    const handlers: Record<string, (args: { path?: string; from?: string; link?: string }) => unknown> = {
      config_get: () => ({
        config: { version: 1, last_vault: null, editor: { mode: "md" } },
        warnings: [],
        path: "/mock/config.json",
      }),
      vault_current: () =>
        v
          ? { vault: { root: "/Users/alex/demo-vault", entries: v.entries }, notice: null }
          : { vault: null, notice: null },
      fs_read_file: (args) => {
        const text = v?.files?.[args.path ?? ""];
        if (text === undefined) {
          throw { code: "fs_not_found", message: `文件不存在：${args.path}` };
        }
        return text;
      },
      // link graph 桩：语义由场景 fixture 注入（前端不复制解析语义，
      // 桩也只查表不计算）；未收录的链接按 unresolved 应答。
      link_graph_resolve: (args) => {
        const hit = v?.links?.[args.link ?? ""];
        return (
          hit ?? {
            status: "unresolved",
            path: null,
            candidates: [],
            embed_target: null,
            anchor: { status: "none", heading: null, line: null },
          }
        );
      },
      wikilink_create: (args) => {
        const created = v?.creates?.[args.link ?? ""];
        if (!created) {
          throw { code: "wikilink_invalid", message: `未配置创建桩：${args.link}` };
        }
        if (v?.files) v.files[created] = "";
        return { created };
      },
      link_graph_backlinks: (args) => v?.backlinks?.[args.path ?? ""] ?? [],
    };

    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event: string, id: number) => callbacks.delete(id),
    };
    w.__TAURI_INTERNALS__ = {
      invoke: async (
        cmd: string,
        args: { event?: string; handler?: number; path?: string; from?: string; link?: string },
      ) => {
        if (cmd === "plugin:event|listen") {
          const ids = listeners.get(args.event ?? "") ?? [];
          ids.push(args.handler ?? 0);
          listeners.set(args.event ?? "", ids);
          return args.handler;
        }
        if (cmd === "plugin:event|unlisten") return null;
        const handler = handlers[cmd];
        if (!handler) throw { code: "unknown_command", message: `未知命令：${cmd}` };
        return handler(args);
      },
      transformCallback: (cb: (data: unknown) => void) => {
        const id = nextId++;
        callbacks.set(id, cb);
        return id;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      runCallback: (id: number, data: unknown) => callbacks.get(id)?.(data),
      callbacks,
    };
    // 测试钩子：模拟后端 emit fs:entry_changed
    w.__fireFsEvent = (changes: unknown) => {
      for (const id of listeners.get("fs:entry_changed") ?? []) {
        callbacks.get(id)?.({ event: "fs:entry_changed", id, payload: { changes } });
      }
    };
  }, vault);
}

/** 模拟一次外部变更事件（经 listen 注册的回调送达前端）。 */
export async function fireFsEvent(page: Page, changes: unknown[]): Promise<void> {
  await page.evaluate(
    (c) =>
      (window as unknown as { __fireFsEvent: (changes: unknown) => void }).__fireFsEvent(c),
    changes,
  );
}

/** 混合类型 vault fixture：md / 代码 / 图片 / PDF / 无扩展名文本 / 嵌套目录。 */
export const DEMO_VAULT: VaultFixture = {
  entries: [
    { path: "README.md", kind: "file", size: 128, mtime_ms: 1757000000000 },
    { path: "docs", kind: "dir", size: 0, mtime_ms: 1757000000000 },
    { path: "docs/guide.md", kind: "file", size: 1024, mtime_ms: 1757000000000 },
    { path: "docs/notes.txt", kind: "file", size: 256, mtime_ms: 1757000000000 },
    { path: "src", kind: "dir", size: 0, mtime_ms: 1757000000000 },
    { path: "src/main.ts", kind: "file", size: 2048, mtime_ms: 1757000000000 },
    { path: "src/util.ts", kind: "file", size: 512, mtime_ms: 1757000000000 },
    { path: "assets", kind: "dir", size: 0, mtime_ms: 1757000000000 },
    { path: "assets/logo.png", kind: "file", size: 8192, mtime_ms: 1757000000000 },
    { path: "archive.pdf", kind: "file", size: 65536, mtime_ms: 1757000000000 },
    { path: "LICENSE", kind: "file", size: 1080, mtime_ms: 1757000000000 },
  ],
  files: {
    "README.md": "# Demo Vault\n\n这是 **示例** vault 的 README。\n\n- 全类型文件树\n- watch 增量刷新\n",
    "docs/guide.md": "# Guide\n\n指南内容。",
  },
};
