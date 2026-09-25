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

/** `vault_list` 的一行（契约见 src/bindings/VaultListEntry.ts）。列在桩里只被**渲染**，
 *  排序由后端给定（前端不重排），因此这里的书写顺序就是浮层里的行序。 */
export interface VaultListRow {
  id: string;
  path: string;
  name: string;
  available: boolean;
  last_opened_at: number | null;
  tab_count: number;
}

/** 一个 vault 的标签会话（契约见 src/bindings/VaultSession.ts）。`version` / `updated_at`
 *  可省：桩按当前 schema 版本补齐，场景只关心 tabs / active 这两条会被断言的字段。 */
export interface VaultSessionRow {
  tabs: string[];
  active: string | null;
  version?: number;
  updated_at?: number;
}

export interface VaultFixture {
  entries: unknown[];
  files?: Record<string, string>;
  notice?: string | null;
  root?: string;
  vault_id?: string;
  failures?: Record<string, { code: string; message: string }>;
  /** `vault_list` 桩：注册表内容（缺省按当前 fixture 派生**一条**「当前 vault」行——
   *  单 vault 下浮层仍要出现，见 change task 3.1）。 */
  vaults?: VaultListRow[];
  /** `vault_session_get` 的初值，键是 vault 稳定 id。缺省一律无历史（空会话）。
   *  与真后端同构：会话按 id 存在桩层，跨 vault 切换存活（切走再切回要能读回同一份）。 */
  sessions?: Record<string, VaultSessionRow>;
  /**
   * `reading_position_get` 的初值（M194）：键是 vault 稳定 id，值是该 vault 的
   * `entries`（键 = vault 相对路径 → `{pos, y, x, at}`）。缺省一律无历史——这就是
   * 「上次已经存了一条位置」的模拟入口：桩不真实重启，位置靠初值上桌。**不在这里模拟
   * Rust 侧的键校验 / 上限 / 版本治理**（那些归 cargo test 与 tests/unit，桩里复制一份必然漂移）。
   */
  positions?: Record<string, Record<string, { pos: number; y: number; x: number; at: number }>>;
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
  /** config_get 桩（M132）：模式 / 折行口径（M180）/ 排版口径（M195）/ 界面主题（M213）/
   *  [keys] 覆盖表 / 配置 warning。缺省 md + 出厂折行（`line_wrap: true` /
   *  `code_block_wrap: false`，与 `src/preview/theme.ts` 的 DEFAULT_* 同值）+ 出厂排版
   *  （`font_family` / `mono_font_family` 为 `null` = 沿用基线、`font_size: 15`，与 Rust
   *  `EditorConfig::default()` 同值）+ 出厂主题（`light`，与 Rust `UiConfig::default()` 同值）+
   *  空覆盖 + 无 warning。 */
  config?: {
    mode?: "md" | "code";
    line_wrap?: boolean;
    code_block_wrap?: boolean;
    /** 正文族（M195）：`null` = 沿用基线观感（与 Rust 侧 `Option<String>` 的 None 同义）。 */
    font_family?: string | null;
    /** 等宽族（M195）：口径同 `font_family`（**与列表标记渲染/测量同源的那个 token**）。 */
    mono_font_family?: string | null;
    /** 编辑器内容字号 px（M195）：合法区间 [12, 32]，区间外由 Rust 侧回落 `DEFAULT_FONT_SIZE`
     *  并附 warning——桩不复制那条校验（那归 cargo test），它只负责把配置**送达**前端。 */
    font_size?: number;
    /** 界面主题（M213）：`light` / `dark` / `eink`（与 Rust `UiTheme` 同一闭集合）。
     *  缺省 `light` = 出厂口径——不传的场景天然跑浅色主题，不会因为桩扩了形状而换主题。
     *  它对应启动装配层「把 `ui.theme` 写进 `documentElement.dataset.theme`」那一步
     *  （`src/main.ts`），因此三主题场景截到的是**真实配置通道**下的主题，而不是场景
     *  自己贴的 `data-theme` 属性（后者只证明 CSS 有第三套取值，验不到配置接线）。 */
    theme?: "light" | "dark" | "eink";
    /** 阅读栏宽 px（M228，content-width-drag）：缺省 680 = 出厂口径（与 Rust
     *  `DEFAULT_CONTENT_WIDTH` 同值，D1 落槌）——不传的场景天然跑默认栏宽，不会因为
     *  桩扩了形状而变宽。越界值的回落 + warning 归 Rust 侧（cargo test），桩只负责送达。 */
    content_width?: number;
    keys?: Record<string, string | null>;
    warnings?: string[];
  };
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

    type Args = { path?: string; from?: string; link?: string; target?: string; id?: string; title?: string; vault_id?: string; expected_revision?: string; content?: string; dirty?: boolean; force_new?: boolean; event?: string; fields?: Record<string, string>; url?: string; tabs?: string[]; active?: string | null; entries?: Record<string, { pos: number; y: number; x: number; at: number }>; key?: string; value?: unknown };
    const checkVault = (args: Args) => {
      if (args.vault_id !== (current?.vault_id ?? "fixture-vault")) throw { code: "fixture_contract", message: "vault_id mismatch" };
    };
    // 会话真源（M163）：按 vault 稳定 id 存放，跨 vault 切换存活——「切走再切回读回同一份
    // 标签列表」这条链路要能被视觉场景端到端看见。初值来自 fixture 的 sessions。
    const sessions = new Map<string, VaultSessionRow>(
      Object.entries(v?.sessions ?? {}).map(([id, row]) => [
        id,
        { ...row, version: row.version ?? 1, updated_at: row.updated_at ?? 0 },
      ]),
    );
    /** 路径的目录名（vault_list 的 name 口径与 /_vaults 的缺省行共用）。 */
    const baseName = (p: string) => p.split("/").filter((s) => s !== "").pop() ?? p;
    // 退出守卫桩：document_set_dirty 的上报记录（场景断言 dirty 已镜像给后端）。
    w.__dirtyReports = [] as boolean[];
    // config_get 的调用计数（M132 场景用它等「配置已加载 → 键位覆盖已挂上」）。
    w.__configGets = 0;
    // 全部 invoke 的命令名，按调用顺序（M195）。「按 ⌘= 后 config.json 逐字节不变」这条判据
    // 在 chromium 里没有文件面（真机场景 29 用文件哈希 + mtime 断言），这里退化为等价判据：
    // **没有第二处写类 command 被调用**。桩只记录，不解释语义。
    w.__invokes = [] as string[];
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
    // vault_session_put 的调用记录（M163）：落盘内容按调用顺序，场景据此断言「会话按 vault
    // 记在稳定 id 上、内容是有序的固定标签 + 激活项」。
    w.__sessionPuts = [] as Array<{ vault_id?: string; tabs?: string[]; active?: string | null }>;
    // 阅读位置真源（M194）：按 vault 稳定 id 存放，初值来自 fixture 的 positions——这就是
    // 「盘上已经有一条位置」的模拟入口（桩不真实重启，初值即「上次会话留下的」）。
    const positions = new Map<string, Record<string, { pos: number; y: number; x: number; at: number }>>(
      Object.entries(v?.positions ?? {}),
    );
    // reading_position_get 的调用记录（M194）：按 vault 稳定 id，场景据此断言「装载 vault 时
    // 只读一次、此后每次打开文档只查内存镜像」。
    w.__readingPositionGets = [] as string[];
    // reading_position_put 的调用记录（M194）：写入侧的判据落在这里（防抖后只写一次、
    // 载荷里的位置与当前视口一致、越界键不进载荷）。命名避让 `__saveCalls`（计数）与
    // `__sessionPuts`（会话），理由同上面那条 documentWrites 的注释。
    w.__readingPositionPuts = [] as Array<{
      vault_id?: string;
      entries?: Record<string, { pos: number; y: number; x: number; at: number }>;
    }>;
    // document_save 的调用记录（M164）：只记「真的发生了保存」这个事实与内容——
    // 「放弃修改后不写盘」这类**负向**判据需要一个能看到写动作的观测点，否则只能读文件表，
    // 而切换 vault 之后原 vault 的文件表已经不在 `current` 里，断言会空转（REVIEW.md 第 2 条）。
    // **命名避开 `__saveCalls`**：那是 `save-hardening-autosave.spec.ts` 自己的**计数**（它用
    // 第二个 addInitScript 往 `window.__saveCalls` 上挂 +1 的包装），同名会让两边的类型互相踩
    // （实测：那边得到数组、`+= 1` 变成字符串拼接，`document_save` 随之报错）。
    w.__documentWrites = [] as Array<{ path: string; content: string }>;
    const handlers: Record<string, (args: Args) => unknown> = {
      // vault_list 桩（M163）：缺省派生**一条**「当前 fixture 那一行」——列表浮层在单 vault
      // 下同样要出现（change task 3.1），因此不能让它缺省返回空数组（空数组会被读成
      // 「一个 vault 都没有」）。排序由后端给，桩按书写顺序返回、不重排。
      vault_list: () => {
        if (current?.vaults) return current.vaults;
        if (!current) return [];
        const root = current.root ?? "/Users/alex/demo-vault";
        return [
          {
            id: current.vault_id ?? "fixture-vault",
            path: root,
            name: baseName(root),
            available: true,
            last_opened_at: null,
            tab_count: 0,
          },
        ];
      },
      // 会话读（M163）：无记录等价于「没有标签历史」（与 vault_session::load_from 的五种
      // None 同义），前端据此走空 vault 首入态。
      vault_session_get: (args) => sessions.get(args.vault_id ?? "") ?? null,
      // 会话写（M163）：写失败在真后端只降级（warning 语义），桩按成功应答并把内容存进
      // 会话真源——「切走 → 切回 → 标签恢复」这条链路要能真的读回写入的内容。
      vault_session_put: (args) => {
        (w.__sessionPuts as Array<{ vault_id?: string; tabs?: string[]; active?: string | null }>).push({
          vault_id: args.vault_id,
          tabs: args.tabs,
          active: args.active,
        });
        sessions.set(args.vault_id ?? "", {
          version: 1,
          updated_at: Date.now(),
          tabs: args.tabs ?? [],
          active: args.active ?? null,
        });
        return null;
      },
      // 阅读位置读（M194）：无记录等价于「没有阅读位置历史」（与 Rust 侧的五种 None 同义），
      // 前端据此从篇首开始、不给任何提示。调用记录留档：场景据此断言「装载 vault 时只读一次」
      // 这条纪律（每次打开文档只查内存镜像，不再读盘）。
      reading_position_get: (args) => {
        (w.__readingPositionGets as string[]).push(args.vault_id ?? "");
        const entries = positions.get(args.vault_id ?? "");
        // 契约形状与真后端一致：无历史回 null；有历史回 { version, entries }（fixture 只给
        // entries，version 由桩按当前 schema 补齐——同 sessions 的处理）。
        return entries === undefined ? null : { version: 1, entries };
      },
      // 阅读位置写（M194）：真后端在写失败时降级为 warning 并照常 resolve，桩按成功应答并把
      // 载荷存进真源——「这次真的写了什么」是写入侧唯一的判据面。桩不实现 Rust 的键校验与
      // 上限治理（那归 cargo test），因此一条越界键会**原样**进载荷：场景据此断言前端那一道
      // 「按本次枚举清理」的收口确实生效。
      reading_position_put: (args) => {
        (w.__readingPositionPuts as Array<{
          vault_id?: string;
          entries?: Record<string, { pos: number; y: number; x: number; at: number }>;
        }>).push({ vault_id: args.vault_id, entries: args.entries });
        positions.set(args.vault_id ?? "", args.entries ?? {});
        return null;
      },
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
            editor: {
              mode: current?.config?.mode ?? "md",
              // M180 的折行口径（桩缺省与出厂默认同值）：场景要「折行关闭 + 横向平移」时
              // 从这里给。缺省值取自 src/preview/theme.ts 的 DEFAULT_LINE_WRAP /
              // DEFAULT_CODE_BLOCK_WRAP，两处不同值会让场景按错的折行口径跑。
              line_wrap: current?.config?.line_wrap ?? true,
              code_block_wrap: current?.config?.code_block_wrap ?? false,
              // M195 的排版口径：缺省与 Rust `EditorConfig::default()` 逐项同值（null = 基线族、
              // 15 = 出厂字号——D1 裁决后 Rust 侧 DEFAULT_FONT_SIZE 与 src/style.css 的
              // `--editor-font-size` 都是 15），因此**不传这三个字段的既有场景天然跑出厂默认
              // 口径**，不会因为桩扩了形状而带上非默认字号（design §6.5）。
              font_family: current?.config?.font_family ?? null,
              mono_font_family: current?.config?.mono_font_family ?? null,
              font_size: current?.config?.font_size ?? 15,
            },
            // 界面主题（M213）：形状与 Rust `AppConfig` 的 `ui` 表逐项同值，缺省 `light`。
            // `ui` 不是 Option（Rust 侧序列化必带），因此这里**总是**给出整表——桩落后于契约
            // 会让启动装配层在 `snapshot.config.ui.theme` 上抛，那一块的失败面已被刻意收窄
            // 到「主题没施加」（见 src/main.ts 的注释），但不该由场景来踩。
            ui: {
              theme: current?.config?.theme ?? "light",
              // 阅读栏宽（M228）：缺省 680 = Rust `UiConfig::default()` 同值。
              content_width: current?.config?.content_width ?? 680,
            },
            keys: current?.config?.keys ?? {},
          },
          warnings: current?.config?.warnings ?? [],
          path: "/mock/config.json",
        };
      },
      // `[ui]` 单键合并写（M228，content-width-drag）：桩只**记录**写入序列（真后端的
      // 读-改-写与原子替换归 cargo test / 真机验收），场景用 __uiValueWrites 断言
      //「松手写一次、拖拽过程不写」。失败注入走通用 failures 通道。
      config_set_ui_value: (args) => {
        w.__uiValueWrites = [
          ...((w.__uiValueWrites as Array<{ key: string; value: unknown }>) ?? []),
          { key: String(args.key), value: args.value },
        ];
        return null;
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
      // 单文件 mtime（M218 A1 doc-meta「修改于」的数据源）：真后端读盘（取不到为 null 不报错），
      // 桩从 entries 表的 mtime_ms 应答（fixture 的唯一时间真源）；路径不在表里按「取不到」回
      // { mtime_ms: null }——前端据此省略「修改于」段，不报错、不阻断渲染。
      fs_file_mtime: (args) => {
        const entry = current?.entries?.find(
          (e) => (e as { path?: string }).path === (args.path ?? ""),
        ) as { mtime_ms?: number } | undefined;
        return { mtime_ms: entry?.mtime_ms ?? null };
      },
      document_save: (args) => {
        const path = args.path ?? "";
        const currentText = current?.files?.[path];
        if (currentText === undefined) throw { code: "fs_not_found", message: `文件不存在：${path}` };
        const revision = `fixture-revision-${currentText}`;
        if (args.expected_revision !== revision) throw { code: "document_conflict", message: "文件已被外部修改，请先协调冲突" };
        if (current?.failures?.document_save) throw current.failures.document_save;
        (w.__documentWrites as Array<{ path: string; content: string }>).push({
          path,
          content: args.content ?? "",
        });
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
        (w.__invokes as string[]).push(cmd);
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

/** 全部 invoke 的命令名（按调用顺序）——「筛选 MUST NOT 触发第二次拉取」这类次数判据读它。 */
export async function invokes(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __invokes: string[] }).__invokes);
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

/** 经树头部入口发起一次「新增 vault」（= 目录选择器链路，与空态按钮同一条）。
 *
 *  M163 形态 A 起树头部只有一个入口（`button.ft-vault`，名称 + caret），点它开的是列表浮层
 *  而不是系统选择器；「新增」是浮层底部的行。原先直接点「切换」按钮的写法已不存在，这个
 *  封装是**唯一**的选择器落点（REVIEW.md 第 8 条：同一语义不做两处真源）。 */
export async function requestAddVault(page: Page): Promise<void> {
  await page.locator(".ft-vault").click();
  await page.locator(".vault-add").click();
}

/** 经树头部入口打开列表浮层（不选任何行）。 */
export async function openVaultSwitcher(page: Page): Promise<void> {
  await page.locator(".ft-vault").click();
  await page.locator(".vault-list").waitFor({ state: "visible" });
}

/** vault_session_put 的调用记录（会话落盘内容，按调用顺序）。 */
export async function sessionPuts(
  page: Page,
): Promise<Array<{ vault_id?: string; tabs?: string[]; active?: string | null }>> {
  return page.evaluate(
    () =>
      (window as unknown as {
        __sessionPuts: Array<{ vault_id?: string; tabs?: string[]; active?: string | null }>;
      }).__sessionPuts,
  );
}

/** reading_position_put 的调用记录（M194：阅读位置落盘内容，按调用顺序）。
 *  写入侧的判据都在这里：防抖后只写一次、载荷里的位置与当前视口一致、越界键不进载荷。 */
export async function readingPositionPuts(
  page: Page,
): Promise<
  Array<{ vault_id?: string; entries?: Record<string, { pos: number; y: number; x: number; at: number }> }>
> {
  return page.evaluate(
    () =>
      (window as unknown as {
        __readingPositionPuts: Array<{
          vault_id?: string;
          entries?: Record<string, { pos: number; y: number; x: number; at: number }>;
        }>;
      }).__readingPositionPuts,
  );
}

/** reading_position_get 的调用记录（M194：按 vault 稳定 id，按调用顺序）。 */
export async function readingPositionGets(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __readingPositionGets: string[] }).__readingPositionGets,
  );
}

/** document_save 的调用记录（真的发生的保存：路径 + 写入内容，按调用顺序）。
 *  与 `save-hardening-autosave.spec.ts` 的 `__saveCalls`（计数）分开命名，见 stub 里那行注释。 */
export async function documentWrites(page: Page): Promise<Array<{ path: string; content: string }>> {
  return page.evaluate(
    () =>
      (window as unknown as { __documentWrites: Array<{ path: string; content: string }> })
        .__documentWrites,
  );
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
