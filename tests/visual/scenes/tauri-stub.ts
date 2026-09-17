import type { Page } from "@playwright/test";

// 无 Tauri 后端的 chromium 里跑真实前端：按 @tauri-apps/api 的
// __TAURI_INTERNALS__ 形状打桩（参考 node_modules/@tauri-apps/api/mocks.js），
// invoke 走 fixture 路由；listen 经 transformCallback/plugin:event|listen 注册，
// 场景里用 window.__fireFsEvent 模拟后端 emit fs:entry_changed。
//
// log_event（前端诊断埋点出口，见 src/diagnostics.ts）也在此路由：桩只**记录**
// 调用参数，不校验白名单——事件名 / 字段名的白名单唯一来源是 Rust 侧
//（src-tauri/src/logging.rs），在桩里复制一份必然漂移。场景据此断言「正确时机
// 发出正确事件」，落盘语义与拒绝语义由 Rust 单测覆盖。

/** 前端经 log_event 转发的一条诊断事件（原名 + 字段，未校验白名单）。 */
export interface LogEventRecord {
  event: string;
  fields: Record<string, string>;
}

export interface VaultFixture {
  entries: unknown[];
  files?: Record<string, string>;
  notice?: string | null;
  root?: string;
  vault_id?: string;
  failures?: Record<string, { code: string; message: string }>;
  /** link_graph_resolve 桩：链接原文 → LinkResolveResult。未命中按 unresolved 应答。 */
  links?: Record<string, unknown>;
  /**
   * link_resolve_note 桩（M145）：`${from}\n${target}` → 解析到的 vault 相对路径，
   * `null` = 解析不到。未收录的键按 null 应答（同 link_graph_resolve 的「未收录即
   * 未解析」口径）——相对路径的归一语义在 Rust，桩不复制。
   */
  noteLinks?: Record<string, string | null>;
  /** wikilink_create 桩：链接原文 → 创建后的 vault 相对路径（同时写入 files）。 */
  creates?: Record<string, string>;
  /** vault_open 桩：选择器"选中"的目标 vault（root + 完整 fixture）；缺省按用户取消应答 null。 */
  switchTo?: VaultFixture & { root: string };
  /** vault_open 重映射候选桩：目标路径未注册且存在失效注册时，非 force_new 打开按契约返回空 entries + candidates。 */
  remapCandidates?: Array<{ id: string; path: string }>;
  /** config_get 桩（M132）：模式 / [keys] 覆盖表 / 配置 warning。缺省 md + 空覆盖 + 无 warning。 */
  config?: { mode?: "md" | "code"; keys?: Record<string, string | null>; warnings?: string[] };
  /**
   * 启动恢复进行态桩（M159）：`true` 时 `vault_current` 按后端契约回「vault 为 null +
   * restore_pending: true」（进行中 = 尚未提交，两者不可同时成立），前端应呈现恢复中提示。
   */
  restorePending?: boolean;
}

export async function stubTauri(page: Page, vault: VaultFixture | null): Promise<void> {
  await page.addInitScript((v: VaultFixture | null) => {
    const w = window as unknown as Record<string, unknown>;
    const callbacks = new Map<number, (data: unknown) => void>();
    const listeners = new Map<string, number[]>();
    let nextId = 1;

    // 当前生效 vault：vault_open 切换后整体替换，后续 invoke 读新 vault 的数据
    //（与真后端 open_vault 的替换语义对齐）。
    let current = v;

    type Args = { path?: string; from?: string; link?: string; target?: string; id?: string; title?: string; vault_id?: string; expected_revision?: string; content?: string; dirty?: boolean; force_new?: boolean; event?: string; fields?: Record<string, string>; url?: string };
    const checkVault = (args: Args) => {
      if (args.vault_id !== (current?.vault_id ?? "fixture-vault")) throw { code: "fixture_contract", message: "vault_id mismatch" };
    };
    // 退出守卫桩：document_set_dirty 的上报记录（场景断言 dirty 已镜像给后端）。
    w.__dirtyReports = [] as boolean[];
    // config_get 的调用计数（M132 场景用它等「配置已加载 → 键位覆盖已挂上」）。
    w.__configGets = 0;
    // vault_remap 的调用记录（场景断言前端把用户确认的映射传给后端）。
    w.__remapCalls = [] as Array<{ id?: string; path?: string }>;
    // log_event 的转发记录（M136）：前端埋点发出的每条诊断事件，按发出顺序。
    w.__logEvents = [] as LogEventRecord[];
    // open_external_url 的调用记录（M144）：外链打开请求的实际目标，按调用顺序。
    // 桩只记录不打开——场景据此断言「⌘⏎ / ⌘-Click 走的是外链路径、URL 取自正文」，
    // 而不真的唤起浏览器（真机上这条由 Rust 侧 open_external_url 落 link_open 日志）。
    w.__openedUrls = [] as string[];
    // link_open_path 的调用记录（M145）：vault 内非 md 文件 / 目录交给系统默认应用的
    // 请求，按调用顺序（同样只记录不打开）。
    w.__openedPaths = [] as Array<{ from: string; target: string }>;
    // link_resolve_note 的调用记录（M145）：相对路径 md 的解析请求。
    w.__noteResolves = [] as Array<{ from: string; target: string }>;
    const handlers: Record<string, (args: Args) => unknown> = {
      log_event: (args) => {
        (w.__logEvents as LogEventRecord[]).push({
          event: args.event ?? "",
          fields: args.fields ?? {},
        });
        return null;
      },
      open_external_url: (args) => {
        (w.__openedUrls as string[]).push(args.url ?? "");
        return null;
      },
      // 相对路径 md 的解析（M145）：语义在 Rust link_graph，桩只查表不计算；
      // 未收录的键按「解析不到」应答（同 link_graph_resolve 的未命中口径）。
      link_resolve_note: (args) => {
        (w.__noteResolves as Array<{ from: string; target: string }>).push({
          from: args.from ?? "",
          target: args.target ?? "",
        });
        return current?.noteLinks?.[`${args.from}\n${args.target}`] ?? null;
      },
      // vault 内非 md / 目录交系统默认应用（M145）：桩只记录请求，不真的交给系统。
      link_open_path: (args) => {
        (w.__openedPaths as Array<{ from: string; target: string }>).push({
          from: args.from ?? "",
          target: args.target ?? "",
        });
        return null;
      },
      document_set_dirty: (args) => {
        (w.__dirtyReports as boolean[]).push(args.dirty ?? false);
        return null;
      },
      config_get: () => {
        w.__configGets = (w.__configGets as number) + 1;
        return {
          config: {
            version: 1,
            last_vault: null,
            editor: { mode: current?.config?.mode ?? "md" },
            keys: current?.config?.keys ?? {},
          },
          warnings: current?.config?.warnings ?? [],
          path: "/mock/config.json",
        };
      },
      vault_current: () => {
        // 恢复进行态（M159）：进行中就没有已提交的 vault——`vault: null` 与
        // `restore_pending: true` 必须同时成立，否则前端会把进行态当终态（design §3.1）。
        const pending = current?.restorePending === true;
        if (!current || pending) {
          return { vault: null, notice: current?.notice ?? null, restore_pending: pending };
        }
        return {
          vault: { root: current.root ?? "/Users/alex/demo-vault", entries: current.entries, vault_id: current.vault_id ?? "fixture-vault", remap_candidates: [] },
          notice: current.notice ?? null,
          restore_pending: false,
        };
      },
      vault_open: (args) => {
        const target = current?.switchTo;
        if (!target) return null;
        // 重映射候选契约（commands.rs open_vault）：未注册路径 + 失效注册时，
        // 非 force_new 打开返回空 entries + candidates，等前端显式确认。
        if (!args.force_new && target.remapCandidates?.length) {
          return { root: target.root, entries: [], vault_id: target.remapCandidates[0].id, remap_candidates: target.remapCandidates };
        }
        current = target;
        return { root: target.root, entries: target.entries, vault_id: target.vault_id ?? "fixture-vault", remap_candidates: [] };
      },
      // 确认后直开（无选择器）：path 即用户刚选中的 root，语义同 force_new 打开。
      vault_open_path: (args) => {
        const target = current?.switchTo;
        if (!target || args.path !== target.root) throw { code: "fs_not_found", message: `目录不存在：${args.path}` };
        current = target;
        return { root: target.root, entries: target.entries, vault_id: target.vault_id ?? "fixture-vault", remap_candidates: [] };
      },
      vault_remap: (args) => {
        (w.__remapCalls as Array<{ id?: string; path?: string }>).push({ id: args.id, path: args.path });
        return { id: args.id, path: args.path };
      },
      fs_read_snapshot: (args) => {
        const text = current?.files?.[args.path ?? ""];
        if (text === undefined) throw { code: "fs_not_found", message: `文件不存在：${args.path}` };
        return { content: text, revision: `fixture-revision-${text}` };
      },
      document_save: (args) => {
        const path = args.path ?? "";
        const currentText = current?.files?.[path];
        if (currentText === undefined) throw { code: "fs_not_found", message: `文件不存在：${path}` };
        const revision = `fixture-revision-${currentText}`;
        if (args.expected_revision !== revision) throw { code: "document_conflict", message: "文件已被外部修改，请先协调冲突" };
        if (current?.failures?.document_save) throw current.failures.document_save;
        current!.files![path] = args.content ?? "";
        return `fixture-revision-${args.content ?? ""}`;
      },
      // link graph 桩：语义由场景 fixture 注入（前端不复制解析语义，
      // 桩也只查表不计算）；未收录的链接按 unresolved 应答。
      link_graph_resolve: (args) => {
        const hit = current?.links?.[args.link ?? ""];
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
        const created = current?.creates?.[args.link ?? ""];
        if (!created) {
          throw { code: "wikilink_invalid", message: `未配置创建桩：${args.link}` };
        }
        if (current?.files) current.files[created] = "";
        return { created };
      },
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
        // failures 为持续性注入：同一 command 的每次调用都抛（markdown-combo 的
        // 多附件读取失败用例依赖此语义）。恢复动作的端到端走通改用 __externalWrite
        // / __externalDelete 自然路径（见 save-recovery.spec）。
        if (current?.failures?.[cmd]) throw current.failures[cmd];
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
    // 测试钩子：模拟后端 emit app:quit_blocked（退出守卫拦截后的通知）
    w.__fireQuitBlocked = () => {
      for (const id of listeners.get("app:quit_blocked") ?? []) {
        callbacks.get(id)?.({ event: "app:quit_blocked", id, payload: null });
      }
    };
    // 测试钩子：模拟后端 emit app:menu_command（原生 Edit 菜单的撤销/重做项点击后交回
    // 前端同一命令层；M131 引入通道，M132 收进 ipc.ts 的 onMenuCommand）。
    w.__fireMenuCommand = (command: string) => {
      for (const id of listeners.get("app:menu_command") ?? []) {
        callbacks.get(id)?.({ event: "app:menu_command", id, payload: command });
      }
    };
    // 测试钩子：模拟后端 emit vault:restore_finished（M159 的启动恢复完成信号，无载荷）。
    // 它只是唤醒信号——场景改完后端状态（__setBackendVault）再 fire，才能验到「事件 → 再拉一次
    // vault_current」这条链路；不 fire 则验不到（前端不会自己轮询，design §7 A5）。
    w.__fireVaultRestoreFinished = () => {
      for (const id of listeners.get("vault:restore_finished") ?? []) {
        callbacks.get(id)?.({ event: "vault:restore_finished", id, payload: null });
      }
    };
    // 测试钩子：替换后端当前 vault（模拟恢复线程稍后提交 / 用户打开成功）——此后
    // vault_current 按新 fixture 应答。前端不持副本，只能经权威拉取看到它。
    w.__setBackendVault = (v: VaultFixture | null) => {
      current = v;
    };
    // 测试钩子：模拟外部程序改/删文件（Lumir ↔ Obsidian 来回场景）。
    // 不触发 watch 事件——事件由场景显式 fireFsEvent 送达，与真后端
    // 「fs 变更 → debounce → emit」的时序解耦，断言更确定。
    w.__externalWrite = (path: string, text: string) => {
      if (current?.files) current.files[path] = text;
    };
    w.__externalDelete = (path: string) => {
      if (current?.files) delete current.files[path];
    };
    // 磁盘内容探针：恢复动作（强制覆盖 / 另存为）是否真正落盘的证据。
    w.__fileText = (path: string) => current?.files?.[path];
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

/** 模拟后端 dirty 守卫拦截退出（app:quit_blocked 事件送达前端）。 */
export async function fireQuitBlocked(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __fireQuitBlocked: () => void }).__fireQuitBlocked());
}

/** 模拟原生菜单项点击（app:menu_command 事件送达前端；payload = undo / redo）。 */
export async function fireMenuCommand(page: Page, command: string): Promise<void> {
  await page.evaluate(
    (c) => (window as unknown as { __fireMenuCommand: (command: string) => void }).__fireMenuCommand(c),
    command,
  );
}

/** 模拟后端 emit vault:restore_finished（M159 启动恢复完成信号，无载荷）。 */
export async function fireVaultRestoreFinished(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __fireVaultRestoreFinished: () => void }).__fireVaultRestoreFinished(),
  );
}

/** 替换后端当前 vault（模拟恢复线程稍后提交 / 用户打开成功；vault_current 随之应答新值）。 */
export async function setBackendVault(page: Page, vault: VaultFixture | null): Promise<void> {
  await page.evaluate(
    (v) => (window as unknown as { __setBackendVault: (v: VaultFixture | null) => void }).__setBackendVault(v),
    vault,
  );
}

/** config_get 的调用计数（等「配置已加载」用；M132 的 [keys] 覆盖在配置到位后生效）。 */
export async function configGets(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __configGets: number }).__configGets);
}

/** 前端已转发的诊断事件（按发出顺序）；`event` 选传，只看某一类事件。 */
export async function logEvents(page: Page, event?: string): Promise<LogEventRecord[]> {
  const all = await page.evaluate(
    () => (window as unknown as { __logEvents: LogEventRecord[] }).__logEvents,
  );
  return event === undefined ? all : all.filter((e) => e.event === event);
}

/** document_set_dirty 的上报记录（前端 dirty 镜像给后端的证据）。 */
export async function dirtyReports(page: Page): Promise<boolean[]> {
  return page.evaluate(() => (window as unknown as { __dirtyReports: boolean[] }).__dirtyReports);
}

/** open_external_url 的调用记录（外链打开请求的实际目标，按调用顺序）。 */
export async function openedUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __openedUrls: string[] }).__openedUrls);
}

/** link_open_path 的调用记录（vault 内非 md / 目录交系统默认应用的请求，按调用顺序）。 */
export async function openedPaths(page: Page): Promise<Array<{ from: string; target: string }>> {
  return page.evaluate(
    () => (window as unknown as { __openedPaths: Array<{ from: string; target: string }> }).__openedPaths,
  );
}

/** link_resolve_note 的调用记录（相对路径 md 的解析请求，按调用顺序）。 */
export async function noteResolves(page: Page): Promise<Array<{ from: string; target: string }>> {
  return page.evaluate(
    () => (window as unknown as { __noteResolves: Array<{ from: string; target: string }> }).__noteResolves,
  );
}

/** vault_remap 的调用记录（前端把用户确认的映射传给后端的证据）。 */
export async function remapCalls(page: Page): Promise<Array<{ id?: string; path?: string }>> {
  return page.evaluate(() => (window as unknown as { __remapCalls: Array<{ id?: string; path?: string }> }).__remapCalls);
}

/** 模拟外部程序写入文件（Obsidian 侧保存；不自带 watch 事件）。 */
export async function externalWrite(page: Page, path: string, text: string): Promise<void> {
  await page.evaluate(
    ([p, t]) => (window as unknown as { __externalWrite(p: string, t: string): void }).__externalWrite(p, t),
    [path, text],
  );
}

/** 模拟外部程序删除文件。 */
export async function externalDelete(page: Page, path: string): Promise<void> {
  await page.evaluate(
    (p) => (window as unknown as { __externalDelete(p: string): void }).__externalDelete(p),
    path,
  );
}

/** 磁盘当前内容探针（恢复动作落盘的证据）。 */
export async function fileText(page: Page, path: string): Promise<string | undefined> {
  return page.evaluate(
    (p) => (window as unknown as { __fileText(p: string): string | undefined }).__fileText(p),
    path,
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
    // M130：非 md 的既有条目也给出可读内容——非 md 打开的回归场景（只读 code /
    // 无扩展名的保存兜底）要能点到真实文本，而不是 fs_read_snapshot 的 fs_not_found
    // 提示。条目集合不变（不影响既有截图基线）。
    "docs/notes.txt": "# 不是标题\n\n纯文本原文（非 Markdown 渲染对象）。\n",
    LICENSE: "MIT License\n\nPermission is hereby granted, free of charge.\n",
  },
};
