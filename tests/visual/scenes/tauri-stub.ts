import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { ConfigSnapshot } from "../../../src/bindings/ConfigSnapshot";
import { setLanguageRoot } from "../../../src/copy";

// 场景**在 Node 侧**解析文案时的语言档（M282，change ui-language-i18n）：locale 的决定权在
// 浏览器里（`<html lang>` 由被测应用按 `ui.language` 写），而场景对纯函数 / 常量的断言发生在
// Node——把这一侧的读取口钉在 `zh`（与桩的 `ui.language = "zh"` 同一档），否则「Node 侧取到 en、
// 页面渲染 zh」会让断言以不相干的理由变红（实测：相对时间 / 降级归因句 / 键位来由三类）。
setLanguageRoot(() => ({ lang: "zh-Hans" }));

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

/** 场景的会话初值（**单 pane 简写**，M318 起契约见 src/bindings/VaultSession.ts 的 v2 形状）。
 *  场景直接写 `tabs` / `active`，桩把它补成一份单 pane 的 `VaultSession`（补 version /
 *  harness_pane / ratio）——桩在**线上**返回的始终是 v2 形状（与真后端同构），简写只是
 *  预置数据的便利。`ratio` 为分隔比例（缺省 0.5）。 */
export interface VaultSessionSeed {
  tabs: string[];
  active: string | null;
  ratio?: number;
  version?: number;
  updated_at?: number;
}

/** 桩内部存的会话（= 真后端 `vault_session_get` 的返回形状）。 */
interface StoredSession {
  version: number;
  panes: Array<{ tabs: string[]; active: string | null }>;
  harness_pane: boolean;
  pane_split_ratio: number;
  updated_at: number;
}

/**
 * 合成 1×1 PNG（8-bit RGB，单像素 `#2f6f8f`）的 base64，69 字节。
 *
 * 为什么用合成像素（M629 的信息卫生纪律）：图片 fixture 的**内容以像素形式存在**，真实截图
 * 无法用 grep 清扫；一条纯合成的 1×1 常量既够验「解码成功、自然尺寸 = 1×1」，又不携带任何
 * vault 内容。生成方式与校验：zlib 压缩单像素扫描行 → PNG 三段 chunk，`file` 报
 * `PNG image data, 1 x 1, 8-bit/color RGB`；字节数 69 与 `dataUrlByteLength` 的折算一致。
 */
export const SYNTHETIC_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mPQz+8HAAH+AS4inemcAAAAAElFTkSuQmCC";

/**
 * 把合成 PNG 随 fixture 一起过桥进 init script（M629 的实证）：init script 的函数体是
 * **序列化**后注入页面的，模块作用域常量在页面里不存在——直接引用会得到
 * `ReferenceError: SYNTHETIC_PNG_BASE64 is not defined`，被查看面渲染成「读取失败」占位。
 * 因此常量挂在 fixture 的一个内部字段上（`syntheticPng`，场景不写）。
 */
function withSyntheticPng(vault: VaultFixture | null): VaultFixture | null {
  return vault === null ? null : { ...vault, syntheticPng: SYNTHETIC_PNG_BASE64 };
}

export interface VaultFixture {
  entries: unknown[];
  files?: Record<string, string>;
  /**
   * `fs_read_attachment` 桩的字节表（M629，change add-image-file-preview 的 5.1）。
   * 键 = vault 相对路径，值 = **base64**（与真后端的应答形状一致，不带 `data:` 前缀）。
   * 未收录的路径按 `SYNTHETIC_PNG_BASE64`（1×1 合成 PNG）应答——只要它在 `files` 里存在；
   * 两者都没有 ⇒ 抛 `fs_not_found`（与真后端「文件不存在」同形）。
   *
   * 造「字节读成但解码不出像素」的现场就靠它：给一条合法 base64 但非图片内容的串。
   * 读取失败（权限 / 超限）走通用 `failures` 通道，不在这里造。
   */
  attachments?: Record<string, string>;
  /**
   * `fs_read_external` 桩的文本表（M655，change quick-open-file-oct23 的 5.1）：键 = **绝对
   * 路径**，值 = 文件全文。未收录的路径抛 `fs_not_found`（与真后端「文件不存在」同形）——
   * 「vault 外路径不存在 ⇒ 按找不到处置」的现场靠它造。目录 / 超限 / 非法编码的判定在 Rust
   * 侧（桩不复制形状校验），那几类用通用 `failures` 通道注入。
   */
  externalFiles?: Record<string, string>;
  /** **内部字段，场景 MUST NOT 写**：`stubTauri` 把 {@link SYNTHETIC_PNG_BASE64} 挂在这里
   *  过桥进 init script（函数体序列化，模块常量在页面里不可见）。 */
  syntheticPng?: string;
  notice?: string | null;
  root?: string;
  vault_id?: string;
  failures?: Record<string, { code: string; message: string }>;
  /** `vault_list` 桩：注册表内容（缺省按当前 fixture 派生**一条**「当前 vault」行——
   *  单 vault 下浮层仍要出现，见 change task 3.1）。 */
  vaults?: VaultListRow[];
  /** `vault_session_get` 的初值，键是 vault 稳定 id。缺省一律无历史（空会话）。
   *  与真后端同构：会话按 id 存在桩层，跨 vault 切换存活（切走再切回要能读回同一份）。 */
  sessions?: Record<string, VaultSessionSeed>;
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
  /**
   * `harness_write_image` 的按来源 MIME 失败注入（change add-image-quote-to-chat 的 5.1）：
   * 键 = `source_mime` 的 MIME 段（如 `image/svg+xml`），命中即按该信封 reject——造「不支持的
   * 格式」现场用（真后端在 Rust 侧按同一张转码面拒绝）。未命中的写入一律成功。
   */
  harnessImageFailures?: Record<string, { code: string; message: string; params?: Record<string, unknown> }>;
  /** 应用元信息桩（M236，product-version-display）：`plugin:app|name` / `plugin:app|version`
   *  两条内置 invoke 路由的应答。缺省 = 固定 fixture 值（"Lumir" / "9.9.9"），**刻意不跟随
   *  src-tauri/tauri.conf.json 的真版本**：跟随会让每次版本 bump 都推动标题栏像素基线
   *  （纯数字差异，无判别价值，2026-10-02 Alex 裁决钉死）。「真机上屏的是真实当前版本」
   *  由真机验收场景 39 用 $appVersion 占位符逐字节比对负责。显式给
   *  `false` = 两条路由不存在（模拟 ACL 拒绝 / 无后端，验标识块的失败降级路径）。 */
  appMeta?: { name: string; version: string } | false;
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
    /** code 模式正文行的折行（M247，change code-mode-line-wrap）：缺省 `false` = 出厂分叉
     *  「md 折 / code 不折」（与 Rust `EditorConfig::default()` 的 `code_mode_line_wrap`
     *  同值）。它**不跟随** `line_wrap`——桩也不替它跟随，否则场景会按错的口径跑。 */
    code_mode_line_wrap?: boolean;
    /** `Enter` 自动缩进（M272，change enter-auto-indent）：缺省 `true` = 出厂值（与 Rust
     *  `EditorConfig::default()` 的 `auto_indent` 同值）。场景要验「关掉配置后回退」时从这里
     *  给 `false`——它走的是 `src/main.ts` 的真实配置消费点（`editor.setAutoIndent`）。 */
    auto_indent?: boolean;
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
    /** 阅读栏宽 px（M228，content-width-drag）：缺省 760 = 出厂口径（与 Rust
     *  `DEFAULT_CONTENT_WIDTH` 同值，D1 落槌值 2026-09-26 修订）——不传的场景天然跑默认栏宽，
     *  不会因为桩扩了形状而变宽。越界值的回落 + warning 归 Rust 侧（cargo test），桩只负责送达。 */
    content_width?: number;
    /** 左栏宽度 px（M631，change add-sidebar-resize-hide-and-root-create）：缺省 236 = 出厂
     *  口径（与 Rust `DEFAULT_SIDEBAR_WIDTH` 同值）——不传的场景天然跑默认宽度，不会因为桩
     *  扩了形状而变宽。静态区间的越界回落 + warning 归 Rust 侧（cargo test），桩只负责送达。 */
    sidebar_width?: number;
    /** md 行号 gutter 档位（M281 的 D4 二次改判）：`on-demand` / `always` / `off`（与 Rust
     *  `MarkdownLineNumbers` 同一闭集合）。缺省 `on-demand` = 出厂口径（与 Rust
     *  `UiConfig::default()` 同值）——不传的场景天然跑「md 默认无行号、输入条在场时出现」，
     *  不会因为桩扩了形状而变形态。越界值的回落 + warning 归 Rust 侧（cargo test）。 */
    markdown_line_numbers?: "on-demand" | "always" | "off";
    /** 界面语言（M282，change ui-language-i18n）：桩缺省 `zh`（**与产品的出厂默认 `en` 不同**，
     *  理由见 mockConfig 处的注释——既有整页基线是 zh 形态，钉住它才让基线继续作「结构与外观」
     *  的回归面）。场景要验 en 面时从这里给 `"en"`。 */
    language?: "en" | "zh";
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

    type Args = { path?: string; from?: string; rel?: string; new_name?: string; parent_rel?: string; name?: string; link?: string; target?: string; id?: string; title?: string; vault_id?: string; expected_revision?: string; content?: string; dirty?: boolean; force_new?: boolean; event?: string; fields?: Record<string, string>; url?: string; tabs?: string[]; active?: string | null; panes?: Array<{ tabs: string[]; active: string | null }>; pane_split_ratio?: number; entries?: Record<string, { pos: number; y: number; x: number; at: number }>; key?: string; value?: unknown; r?: number; g?: number; b?: number; data_base64?: string; source_mime?: string; entry?: { id: string; path: string; last_opened_at: number | null; missing_since: number | null; archived_at: number | null } };
    const checkVault = (args: Args) => {
      if (args.vault_id !== (current?.vault_id ?? "fixture-vault")) throw { code: "fixture_contract", message: "vault_id mismatch" };
    };
    // 会话真源（M163）：按 vault 稳定 id 存放，跨 vault 切换存活——「切走再切回读回同一份
    // 标签列表」这条链路要能被视觉场景端到端看见。初值来自 fixture 的 sessions。
    const sessions = new Map<string, StoredSession>(
      Object.entries(v?.sessions ?? {}).map(([id, row]) => [
        id,
        {
          version: row.version ?? 2,
          panes: [{ tabs: row.tabs, active: row.active }],
          harness_pane: false,
          pane_split_ratio: row.ratio ?? 0.5,
          updated_at: row.updated_at ?? 0,
        },
      ]),
    );
    /** 路径的目录名（vault_list 的 name 口径与 /_vaults 的缺省行共用）。 */
    const baseName = (p: string) => p.split("/").filter((s) => s !== "").pop() ?? p;
    /** 被移除注册项的原下标（M668 视觉回归：撤销按原位置放回，与真后端的「视为从未移除」同形）。 */
    const removedAt = new Map<string, number>();
    // 退出守卫桩：document_set_dirty 的上报记录（场景断言 dirty 已镜像给后端）。
    w.__dirtyReports = [] as boolean[];
    // window_set_background_color 的调用记录（M525，app-window「窗口底色跟随主题」）：
    // 场景据此断言 applyTheme 把 CSS token 解析值同步给了后端。桩只记录不解释。
    w.__windowBgCalls = [] as Array<{ r?: number; g?: number; b?: number }>;
    // `fs_read_attachment` 的**按路径**读取记录（M629）：D3 的「切回重读一次」判据要数
    // 某一张图读了几次——全局计数会被启动期 SAMPLE 演示文档里的相对路径图片引用污染。
    w.__attachmentReads = [] as string[];
    // `fs_read_external` 的**按路径**读取记录（M655）：vault 外只读会话的「打开一次 = 读一次」
    // 与「⌘S 无落点」这类次数判据要数它。
    w.__externalReads = [] as string[];
    // `harness_write_image` 的调用记录（change add-image-quote-to-chat 的 5.1）：图片摘录
    // 事务的「先落盘再插块」与 source_mime 透传在这一层可见（载荷只记 MIME 与字节串）。
    w.__harnessImageWrites = [] as Array<{ data_base64?: string; source_mime?: string }>;
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
    w.__sessionPuts = [] as Array<{
      vault_id?: string;
      panes?: Array<{ tabs: string[]; active: string | null }>;
      pane_split_ratio?: number;
    }>;
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
    // 而切换 vault 之后原 vault 的文件表已经不在 `current` 里，断言会空转（REVIEW.md 「读不到当成空」条）。
    // **命名避开 `__saveCalls`**：那是 `save-hardening-autosave.spec.ts` 自己的**计数**（它用
    // 第二个 addInitScript 往 `window.__saveCalls` 上挂 +1 的包装），同名会让两边的类型互相踩
    // （实测：那边得到数组、`+= 1` 变成字符串拼接，`document_save` 随之报错）。
    w.__documentWrites = [] as Array<{ path: string; content: string }>;
    // 文件级操作的「让世界前进」辅助（M244）：路径移动 / 删除 / 新增只改 fixture 的
    // entries + files 两张表——语义对齐到「场景断言够用」这一层，路径判定（逃逸 / 忽略集 /
    // 撞名）不在这里复制（那是 Rust 侧的真实边界，归 cargo test）。
    const joinRel = (parent: string, name: string): string => (parent === "" ? name : `${parent}/${name}`);
    const movePath = (vault: VaultFixture | null, from: string, to: string): void => {
      if (!vault || from === to) return;
      vault.entries = (vault.entries as Array<{ path: string }>).map((entry) => {
        if (entry.path === from) return { ...entry, path: to };
        if (entry.path.startsWith(`${from}/`)) return { ...entry, path: to + entry.path.slice(from.length) };
        return entry;
      });
      const files = vault.files;
      if (!files) return;
      for (const key of Object.keys(files)) {
        if (key === from) {
          files[to] = files[key];
          delete files[key];
        } else if (key.startsWith(`${from}/`)) {
          files[to + key.slice(from.length)] = files[key];
          delete files[key];
        }
      }
    };
    const dropPath = (vault: VaultFixture | null, rel: string): void => {
      if (!vault) return;
      vault.entries = (vault.entries as Array<{ path: string }>).filter(
        (entry) => entry.path !== rel && !entry.path.startsWith(`${rel}/`),
      );
      const files = vault.files;
      if (!files) return;
      for (const key of Object.keys(files)) {
        if (key === rel || key.startsWith(`${rel}/`)) delete files[key];
      }
    };
    const addEntry = (vault: VaultFixture | null, path: string, kind: "file" | "dir"): void => {
      if (!vault) return;
      (vault.entries as Array<Record<string, unknown>>).push({
        path,
        kind,
        size: 0,
        mtime_ms: 1757000003000,
      });
      if (kind === "file" && vault.files) vault.files[path] = "";
    };

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
      // vault_remove / vault_restore（M668 视觉回归）：注册表在桩里就是 `current.vaults` 那份
      // 数组——移除摘掉、撤销按原下标放回（真后端只删注册表项文件，桩没有文件面）。当前项
      // 按后端契约拒绝（浮层本来就不给它移除入口，这条只是让越界请求如实失败）。
      vault_remove: (args) => {
        const rows = current?.vaults;
        if (!rows) return null;
        const index = rows.findIndex((row) => row.id === args.id);
        if (index < 0) return null;
        if (args.id === (current?.vault_id ?? "fixture-vault")) {
          throw { code: "vault_remove_current", message: "current vault cannot be removed" };
        }
        const [row] = rows.splice(index, 1);
        removedAt.set(row!.id, index);
        return {
          id: row!.id,
          path: row!.path,
          last_opened_at: row!.last_opened_at ?? null,
          missing_since: row!.available ? null : 1757000000000,
          archived_at: null,
        };
      },
      vault_restore: (args) => {
        const entry = args.entry;
        const rows = current?.vaults;
        if (!entry || !rows) return;
        if (rows.some((row) => row.id === entry.id)) return; // 已存在不覆盖（幂等成功）
        const at = Math.min(removedAt.get(entry.id) ?? rows.length, rows.length);
        rows.splice(at, 0, {
          id: entry.id,
          path: entry.path,
          name: baseName(entry.path),
          available: entry.missing_since === null,
          last_opened_at: entry.last_opened_at,
          tab_count: 0,
        });
        removedAt.delete(entry.id);
      },
      // 会话写（M163）：写失败在真后端只降级（warning 语义），桩按成功应答并把内容存进
      // 会话真源——「切走 → 切回 → 标签恢复」这条链路要能真的读回写入的内容。
      vault_session_put: (args) => {
        (
          w.__sessionPuts as Array<{
            vault_id?: string;
            panes?: Array<{ tabs: string[]; active: string | null }>;
            pane_split_ratio?: number;
          }>
        ).push({
          vault_id: args.vault_id,
          panes: args.panes ?? [],
          pane_split_ratio: args.pane_split_ratio ?? 0.5,
        });
        sessions.set(args.vault_id ?? "", {
          version: 2,
          panes: args.panes ?? [],
          harness_pane: false,
          pane_split_ratio: args.pane_split_ratio ?? 0.5,
          updated_at: Date.now(),
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
      // 窗口底色同步（M525）：记录前端经 applyTheme 送来的 RGB，场景据此断言
      // 「窗口底色跟随主题」合同（openspec/specs/app-window）。桩按成功应答。
      window_set_background_color: (args) => {
        (w.__windowBgCalls as Array<{ r?: number; g?: number; b?: number }>).push({
          r: args.r,
          g: args.g,
          b: args.b,
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
        // 形状按 Rust 的 `ConfigSnapshot` **全量**给出（M597）：`AppConfig` 的每张表都不是
        // Option，真后端序列化必带；桩少给一张表，启动装配链就会在首个非可选解引用处抛
        // TypeError，而 `src/main.ts` 末尾的 `.catch(() => {})` 会把整条链静默吞掉——主题、
        // 语言、折行、排版全都不施加，症状是一大片场景以「读到浅色 token / 英文文案」的
        // 理由超时（M577 把 `attachments?.semantic_naming` 改成
        // `harness.attachment_naming` 后，桩缺 `harness` 表即触发；桩当年没跟上契约）。
        // 这里的 `ConfigSnapshot` 注解是防线：Rust 侧新增必填表时，`tsc --noEmit` 直接报错，
        // 而不是等运行期静默断链（REVIEW.md「同一语义两处真源」条的同族）。
        const snapshot: ConfigSnapshot = {
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
              // M247 的第三轴：缺省 false = 出厂分叉「code 不折」（与 Rust 侧同值）。
              code_mode_line_wrap: current?.config?.code_mode_line_wrap ?? false,
              // M272 的 Enter 自动缩进：缺省 `true` = 出厂值（与 Rust `EditorConfig::default()`
              // 的 `auto_indent` 同值）。**必须给默认值**：`undefined` 传到
              // `editor.setAutoIndent` 会被当成假值，桩漏一个字段就会让全部场景静默关掉这个能力。
              auto_indent: current?.config?.auto_indent ?? true,
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
              // 阅读栏宽（M228）：缺省 760 = Rust `UiConfig::default()` 同值（2026-09-26 修订）。
              content_width: current?.config?.content_width ?? 760,
              // 左栏宽度（M631，change add-sidebar-resize-hide-and-root-create）：缺省 236 =
              // Rust `UiConfig::default()` 同值。桩必须带上这个键——启动装配层的读取顺序在
              // `ui.content_width` 之后，缺键会让 `setSidebarWidth(undefined)` 落回默认值
              //（clampSidebarWidth 对非有限值回落 236），场景便读不到「配置值生效」这一档。
              sidebar_width: current?.config?.sidebar_width ?? 236,
              // md 行号 gutter 档位（M281 的 D4 二次改判）：缺省 `on-demand` = Rust
              // `UiConfig::default()` 同值。桩必须带上这个键——启动装配层的读取顺序在
              // `ui.content_width` 之后，缺键会得到 undefined 而让 md 的 gutter 静默不装。
              markdown_line_numbers: current?.config?.markdown_line_numbers ?? "on-demand",
              // 界面语言（M282，change ui-language-i18n）：桩缺省的 **`zh`** 与产品的出厂默认
              // （`en`，Rust `UiConfig::default()`）**不同**，这是有意的——既有整页基线全是
              // `zh` 形态，桩把界面语言钉在 `zh` 才能让这套基线继续作「结构与外观」的回归面
              //（`en` 面由 tests/visual/scenes/m282-ui-language.spec.ts 单独覆盖）。
              // 桩必须带上这个键：缺键会让 `applyLanguage` 读到 undefined，`<html lang>` 落回
              // 默认档 `en`，于是每一条基线都因为「桩没跟上契约」而变红。
              language: current?.config?.language ?? "zh",
            },
            keys: current?.config?.keys ?? {},
            // `[log]` / `[vault]` / `[harness]` / `[cron]` 四张表当前都没有被视觉场景的断言
            // 直接消费，但都是 `AppConfig` 的必填项（Rust 侧非 Option）：给出与 Rust `Default`
            // 同值的整表，保持「桩 = 真后端契约形状」这条前提。`harness` 在场还有一个可见后果：
            // 面板控制行的权限 chip 按「`harness` 段是否在场」决定显隐（harness-panel.ts 的
            // `permissionConfigured`），真后端恒在场——m303 的整页基线里没有该 chip（旧桩缺表
            // 时代截的），但它与基线的像素差低于容差，故不触发基线更新（另行记入 finding）。
            log: { level: "info" },
            vault: {
              rule_files: [".gitignore", ".git/info/exclude"],
              ignore: {
                ".git": "hidden",
                ".DS_Store": "hidden",
                "node_modules": "lazy",
                ".venv": "lazy",
                venv: "lazy",
                __pycache__: "lazy",
                ".next": "lazy",
                ".nuxt": "lazy",
                ".cache": "lazy",
                ".pnpm-store": "lazy",
                ".tox": "lazy",
                ".gradle": "lazy",
                target: "lazy",
                dist: "lazy",
              },
            },
            harness: {
              provider: "kimi",
              providers: {
                kimi: { api_key: "", model: "", base_url: null, models: [], wire_api: "responses" },
                deepseek: { api_key: "", model: "", base_url: null, models: [], wire_api: "responses" },
                mock: { fixture: null },
              },
              permissions: { allow: [], deny: [] },
              permission_mode: "vault_write",
              loop_max: 50,
              warn_ctx_pct: 85,
              auto_compact: true,
              session_naming: { enabled: true, provider: null, model: null },
              // M577 起 `src/main.ts` 的启动装配链**非可选**读取本表（`harness.attachment_naming`）；
              // 它就是 M597 的断链点，值取 Rust `Default`（enabled = true）。
              attachment_naming: { enabled: true, provider: null, model: null },
              subagents: {
                enabled: true,
                max_turns: 20,
                max_tokens: 200_000n,
                timeout_secs: 300n,
                max_subruns_per_turn: 8,
                max_concurrent: 4,
              },
            },
            cron: { tasks: [] },
          },
          warnings: current?.config?.warnings ?? [],
          path: "/mock/config.json",
        };
        return snapshot;
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
      // vault 外只读读取（M655，change quick-open-file-oct23 的 5.1）：真后端的形状校验 /
      // 常规文件 / 50MB / UTF-8 全在 Rust 侧（归 cargo test），桩只回答「这份绝对路径的内容是
      // 什么」——未收录即 `fs_not_found`（与真后端同形）。调用逐次落账，供「⌘S 在外部会话上
      // 无 invoke」这类负向断言。
      fs_read_external: (args) => {
        const path = String(args.path ?? "");
        (w.__externalReads as string[]).push(path);
        const content = current?.externalFiles?.[path];
        if (content === undefined) {
          throw { code: "fs_not_found", message: `文件不存在：${path}`, params: { rel: path } };
        }
        return { content };
      },
      // 二进制附件读取（M629，change add-image-file-preview 的 5.1）：真后端的契约是
      // 「vault 相对路径 → base64 字符串」，50MB 上限与路径校验归 Rust（桩不复制）。
      // 未收录在 `attachments` 的路径给合成 1×1 PNG（前提是它在 files 里存在——不存在就抛
      // fs_not_found，与真后端同形）；这样「打开一张图」的默认现场零配置即可跑。
      fs_read_attachment: (args) => {
        const path = args.path ?? "";
        (w.__attachmentReads as string[]).push(path);
        const override = current?.attachments?.[path];
        if (override !== undefined) return override;
        if (current?.files?.[path] === undefined) {
          throw { code: "fs_not_found", message: `文件不存在：${path}` };
        }
        if (current?.syntheticPng === undefined) {
          throw { code: "fixture_contract", message: "fixture 缺少合成 PNG（应由 stubTauri 注入）" };
        }
        return current.syntheticPng;
      },
      // harness 侧图片落盘（change add-image-quote-to-chat 的 5.1）：真后端的转码 / 内容寻址 /
      // 去重都在 Rust 侧（那归 cargo test），桩只回答「写成功了，名字与像素尺寸是这个」——
      // 名字固定可断言，字节不产生第二个真源。失败注入按 source_mime 走 fixture 的
      // `harnessImageFailures`（造「不支持格式」现场）；`failures` 通道照旧优先。
      harness_write_image: (args) => {
        const sourceMime = String(args.source_mime ?? "");
        (w.__harnessImageWrites as Array<{ data_base64?: string; source_mime?: string }>).push({
          data_base64: args.data_base64,
          source_mime: sourceMime,
        });
        const failure = current?.harnessImageFailures?.[sourceMime.split(";")[0]!.trim()];
        if (failure !== undefined) throw failure;
        if (typeof args.data_base64 !== "string" || args.data_base64 === "") {
          throw { code: "attachment_decode_failed", message: "图片字节为空（桩）", params: { reason: "empty" } };
        }
        return { name: "pasted-633ab12cd34ef567.webp", width: 1, height: 1 };
      },
      // 缩略图读回（change harness-image-quote-to-chat 的 5.1 连带面）：图片卡片渲染时会按
      // 落盘名读回字节；不路由会让卡片落 is-broken（m440 之前的既有桩缺这条的现场）。
      harness_read_image: (args) => {
        if (!/^pasted-[0-9a-f]{16}\.(webp|jpg)$/.test(args.name ?? "")) {
          throw { code: "harness_image_read_failed", message: "非法附件名（桩）", params: { name: args.name, reason: "invalid" } };
        }
        if (current?.syntheticPng === undefined) {
          throw { code: "fixture_contract", message: "fixture 缺少合成 PNG（应由 stubTauri 注入）" };
        }
        return current.syntheticPng;
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
      // 文件级操作（M244，change file-tree-context-menu）：桩做「记录调用 + 让世界前进」
      // 的最小模拟——entries / files 跟着改，前端在场景显式 fireFsEvent 之前就有一个自洽的
      // 世界；**事件仍由场景自己 fire**（与 __externalWrite / __externalDelete 同口径：
      // 把「动作」与「watch 回响」两条时序解耦，断言更确定——回响抑制正是要在这个缝隙里验）。
      // 路径判定（逃逸 / 忽略集 / 撞名）不在这里复制：那是 Rust 侧的真实边界，归 cargo test。
      fs_rename_entry: (args) => {
        const from = args.rel ?? "";
        const name = args.new_name ?? "";
        const to = from.includes("/") ? `${from.slice(0, from.lastIndexOf("/"))}/${name}` : name;
        (w.__fsMutations as Array<Record<string, unknown>>).push({
          cmd: "fs_rename_entry",
          rel: from,
          new_name: name,
          to,
        });
        movePath(current, from, to);
        return to;
      },
      fs_trash_entry: (args) => {
        const rel = args.rel ?? "";
        (w.__fsMutations as Array<Record<string, unknown>>).push({ cmd: "fs_trash_entry", rel });
        dropPath(current, rel);
        return null;
      },
      fs_create_file: (args) => {
        const path = joinRel(args.parent_rel ?? "", args.name ?? "");
        (w.__fsMutations as Array<Record<string, unknown>>).push({ cmd: "fs_create_file", path });
        addEntry(current, path, "file");
        return path;
      },
      fs_create_dir: (args) => {
        const path = joinRel(args.parent_rel ?? "", args.name ?? "");
        (w.__fsMutations as Array<Record<string, unknown>>).push({ cmd: "fs_create_dir", path });
        addEntry(current, path, "dir");
        return path;
      },
      fs_reveal_in_finder: (args) => {
        (w.__fsMutations as Array<Record<string, unknown>>).push({
          cmd: "fs_reveal_in_finder",
          rel: args.rel ?? "",
        });
        return null;
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
      // composer 草稿（M452 引入 harness_draft_get / harness_draft_put；M454 补桩）：不处理时
      // 会落到下面的 `unknown_command` 抛错，草稿写失败经 `deps.warn` 弹一条 toast 覆盖在
      // 发送钮上——真机/后续 click 的 mouseup 落到 toast 上，`send()` 永不触发（M454 复现：
      // 点发送的 mousedown 打中按钮、mouseup 打中 `.lumir-toast`）。桩按「无草稿 / 落盘成功」
      // 应答：读回 null（无从盘上恢复的草稿）、写入收下（不报错）。
      harness_draft_get: () => null,
      harness_draft_put: () => null,
    };

    // 文件级操作的调用记录（场景断言参数用；M244）。
    w.__fsMutations = [];

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
        // 内置 app 模块（M236）：getName()/getVersion() 走 plugin:app|name / version。
        // fixture.appMeta === false 时故意不路由（落到下面的 unknown_command），
        // 模拟 ACL 拒绝 / 无后端——标识块的失败降级路径由 titlebar-identity 场景断言。
        if (cmd === "plugin:app|name" || cmd === "plugin:app|version") {
          const meta = current?.appMeta;
          if (meta !== false) {
            const value = meta ?? { name: "Lumir", version: "9.9.9" };
            return cmd === "plugin:app|name" ? value.name : value.version;
          }
        }
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
      // 换后端 vault 时保留过桥的合成 PNG（场景传进来的对象没有这个内部字段，M629）。
      current = v === null ? null : { ...v, syntheticPng: current?.syntheticPng };
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
  }, withSyntheticPng(vault));
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

/**
 * 等「配置已施加到界面」（M645，change app-splash-screen）：`.modeline-language` 初始 hidden，
 * 只有 `applyLanguage` 去 hidden（`src/main.ts` 的唯一施加点），而它是配置装配块的最后一步——
 * 它可见即 `applyTheme` / `[keys]` 覆盖 / 折行 / 排版 / 栏宽全部落地。
 *
 * 为什么不再用「`config_get` 调用计数 > 0」当判据：M645 起这次读取由**启动层**发起（主模块装载
 * 之前），计数器在配置施加之前就会 >0，继续拿它当就绪信号会让按键 / 主题类场景抢在键位覆盖之前
 * 动手（实测 m293 的 ⌘⇧T 循环在 dark / eink 两档丢键）。旧计数器与 helper 已删除——「调用过」
 * 与「已施加」不再是同一件事，留一个没有消费者的代理只会让下一个人再踩一次（REVIEW.md
 * 「值或开关声明了却没有消费者」条）。
 */
export async function configApplied(page: Page): Promise<void> {
  await expect(page.locator(".modeline-language"), "配置已施加（applyLanguage 落地）").toBeVisible({
    timeout: 15_000,
  });
}

/**
 * 文件级操作（M244）的调用记录：每条是 `{cmd, …参数}`。场景据此断言「前端到底把哪个路径
 * 交给了后端」——界面观测不到的那一半（重命名的 old→new、新建的父目录）在这一层可见。
 */
export async function fsMutations(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(
    () => (window as unknown as { __fsMutations: Array<Record<string, unknown>> }).__fsMutations,
  );
}

/** 全部 invoke 的命令名（按调用顺序）——「筛选 MUST NOT 触发第二次拉取」这类次数判据读它。 */
export async function invokes(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __invokes: string[] }).__invokes);
}

/** `fs_read_attachment` 的**按路径**读取记录（M629，按调用顺序）。 */
export async function attachmentReads(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __attachmentReads: string[] }).__attachmentReads);
}

/** `fs_read_external` 的**按路径**读取记录（M655，按调用顺序）。 */
export async function externalReads(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __externalReads: string[] }).__externalReads);
}

/** `harness_write_image` 的调用记录（change add-image-quote-to-chat 的 5.1，按调用顺序）：
 *  「先落盘再插块」与 `source_mime` 透传在这一层可断言。 */
export async function harnessImageWrites(
  page: Page,
): Promise<Array<{ data_base64?: string; source_mime?: string }>> {
  return page.evaluate(
    () =>
      (window as unknown as {
        __harnessImageWrites: Array<{ data_base64?: string; source_mime?: string }>;
      }).__harnessImageWrites,
  );
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

/** window_set_background_color 的调用记录（M525：applyTheme 同步给后端的窗口底色 RGB，按顺序）。 */
export async function windowBgCalls(
  page: Page,
): Promise<Array<{ r?: number; g?: number; b?: number }>> {
  return page.evaluate(
    () => (window as unknown as { __windowBgCalls: Array<{ r?: number; g?: number; b?: number }> }).__windowBgCalls,
  );
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
 *  封装是**唯一**的选择器落点（REVIEW.md 「同一语义两处真源」条：同一语义不做两处真源）。 */
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
): Promise<
  Array<{
    vault_id?: string;
    panes?: Array<{ tabs: string[]; active: string | null }>;
    pane_split_ratio?: number;
  }>
> {
  return page.evaluate(
    () =>
      (window as unknown as {
        __sessionPuts: Array<{
          vault_id?: string;
          panes?: Array<{ tabs: string[]; active: string | null }>;
          pane_split_ratio?: number;
        }>;
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
