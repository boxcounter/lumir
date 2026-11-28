import { expect, test, type Locator, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";
import { expectScreenshot } from "./expect-screenshot";

// WCAG 2.x 相对亮度 / 对比度（独立评审 P2-1：只断言「颜色等于 token」发现不了 4.443:1
// 的不足；这里按实际计算样式算真实组合的比值）。
interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseCssColor(value: string): Rgba {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (match === null) throw new Error(`无法解析颜色：${value}`);
  const parts = match[1]!.split(",").map((part) => Number(part.trim()));
  return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 };
}

function relativeLuminance(color: Rgba): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// 留存健康的视觉结构层（change add-persistence-health-status-nov23，design §7 / §10.3）：
//
//   V1 健康态：harness 状态行与文档区横幅均 `hidden`；横幅 `hidden` 时零占位
//      （`.pane-editor` 的首行布局与无横幅时逐像素一致——像素层的零漂移由既有整页基线承担，
//      本文件只钉结构判据，不新建像素基线）。
//   V2 当前写失败态：composer 上方紧凑警示块可见、文案按 severity、`role="status"`；
//      浅警示底 + 左边条、正文色、完整换行；引用失败状态行仍是灰色单行省略。
//   V2b en 面：警示块文案取英文列。
//   V3 `state=ok` + gap 态：显示「此前部分对话记录未能保存…」且 MUST NOT 隐藏；
//      未落盘时的直白退出风险句按 `history_written` 消退。
//   V4 横幅三形态：写失败 / 枚举失败 / 两者同时；健康态撤下；V4d en 面；V4e
//      light / dark / eink 的实际 WCAG 对比度（文字 ≥4.5、按钮边界 ≥3）。
//   V9/V10 history sticky：Tab 到原生关闭钮、Enter / Escape 关闭；不抢焦点；关闭后
//      警示块与 gap 保留；新会话可再次提示（非静音）。
//
// 不新建像素基线：V2–V4 的 `degraded` / gap / 横幅形态按合同属「截图文档先交 Alex 过目再
// `--update`」的人肉裁决点（design §7 末条），本层只留结构断言，避免用未经裁决的基线把
// 形态冻结。健康态的零漂移由既有整页基线 + `scripts/gate.sh visual` 全量比对兜底。

const ROOT = "/tmp/lumir-visual-persistence-health-vault";
const DOC = "# 持久化健康\n\n第一段，给面板一个可读的上下文。\n";

const VAULT: VaultFixture & { root: string } = {
  root: ROOT,
  entries: [{ path: "health-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "health-note.md": DOC },
  links: {},
};

interface HarnessStubOptions {
  /** `harness_state` 的 persistence 键（缺省 = 健康态新后端形状）。 */
  persistence?: Record<string, unknown>;
  /** 初始快照的逻辑会话身份（后端 Session 的稳定 token；0 = 无会话）。 */
  sessionToken?: number;
  /** 恢复入口返回的新会话 token 与恢复后的完整持久化快照（地板）。 */
  resumeSessionToken?: number;
  resumePersistence?: Record<string, unknown>;
  /** 新会话成功后的完整持久化快照（地板）。 */
  afterNewSession?: { session_token: number; persistence?: Record<string, unknown> };
  /** `harness_list_sessions` 的合成行（触发恢复路径）。 */
  sessions?: Array<{ session_id: string; first_user_text: string; ts: number }>;
  /** `harness_resume_session` 挂起到页面调用 `__resolveResume()`。 */
  deferResume?: boolean;
  /** 新会话成功后的 `harness_state` 全部挂起，直到页面调用 `__resolveNewSessionStates()`；
   *  用于构造「空会话快照回包晚于新 token 事件」的现场（复审 P1）。 */
  deferNewSessionSnapshots?: boolean;
  /** deferred 快照的 token 与健康载荷；缺省为空健康。 */
  deferredSnapshot?: { session_token: number; persistence?: Record<string, unknown> };
  /** `recovery_backup` 是否失败（写失败子条件）。 */
  backupFails?: boolean;
  /** `recovery_list` 是否失败（枚举失败子条件）。 */
  listFails?: boolean;
}

/** harness_state + recovery_* 的合成桩：面板只读可观测面（快照 / 事件），恢复目录不进真实
 *  config。`__fireHarnessEvent` 与 m383 同机制（listen 回调 id 经 init script 收集）。 */
async function stubHealth(page: Page, options: HarnessStubOptions = {}): Promise<void> {
  await page.addInitScript((opts) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__harnessEventHandlerIds = [];
    w.__backupCalls = 0;
    w.__resumeStarted = false;
    w.__resolveResume = null;
    w.__afterResume = false;
    w.__afterNewSession = false;
    w.__deferNewSessionStates = false;
    w.__newSessionStateResolvers = [];
    w.__resolveNewSessionStates = () => {
      w.__deferNewSessionStates = false;
      const empty = JSON.stringify({
        vault: opts.root,
        session_token: opts.deferredSnapshot?.session_token ?? 0,
        messages: [],
        usage: { ctx_pct: 0, cache_pct_session: 0 },
        pending_approvals: [],
        warn_ctx_pct: 85,
        persistence: opts.deferredSnapshot?.persistence ?? {
          state: "ok",
          since_ts: 0,
          severity: null,
          detail: "",
          history_written: false,
          history_gap: { present: false, since_ts: 0, detail: "" },
        },
      });
      const resolvers = w.__newSessionStateResolvers as Array<(value: string) => void>;
      w.__newSessionStateResolvers = [];
      for (const resolve of resolvers) resolve(empty);
    };
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_state") {
        if (w.__deferNewSessionStates) {
          return new Promise((resolve: (value: string) => void) => {
            w.__newSessionStateResolvers.push(resolve);
          });
        }
        const persistence =
          (w.__afterResume && opts.resumePersistence) ||
          (w.__afterNewSession && opts.afterNewSession?.persistence) ||
          opts.persistence ||
          {
            state: "ok",
            since_ts: 0,
            severity: null,
            detail: "",
            history_written: false,
            history_gap: { present: false, since_ts: 0, detail: "" },
          };
        const sessionToken = w.__afterResume
          ? opts.resumeSessionToken ?? 0
          : w.__afterNewSession
            ? opts.afterNewSession?.session_token ?? 0
            : opts.sessionToken ?? 0;
        return JSON.stringify({
          vault: opts.root,
          session_token: sessionToken,
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approvals: [],
          warn_ctx_pct: 85,
          persistence,
        });
      }
      if (cmd === "harness_list_sessions") {
        return JSON.stringify(opts.sessions ?? []);
      }
      if (cmd === "harness_resume_session") {
        if (!opts.deferResume) {
          w.__afterResume = true;
          return {
            session_id: "s-resumed",
            restored_items: 0,
            messages: [],
            session_token: opts.resumeSessionToken ?? 0,
            switched: true,
          };
        }
        w.__resumeStarted = true;
        return new Promise((resolve: (value: unknown) => void) => {
          w.__resolveResume = () => {
            w.__afterResume = true;
            resolve({
              session_id: "s-resumed",
              restored_items: 0,
              messages: [],
              session_token: opts.resumeSessionToken ?? 0,
              switched: true,
            });
          };
        });
      }
      if (cmd === "harness_new_session") {
        w.__afterNewSession = true;
        if (opts.deferNewSessionSnapshots) w.__deferNewSessionStates = true;
        return null;
      }
      if (cmd === "harness_send" || cmd === "harness_abort") return null;
      if (cmd === "recovery_list") {
        if (opts.listFails) {
          throw { code: "recovery_list_failed", message: "无法枚举恢复目录：权限被拒", params: { reason: "权限被拒" } };
        }
        return [];
      }
      if (cmd === "recovery_backup") {
        w.__backupCalls += 1;
        if (opts.backupFails) {
          throw { code: "recovery_write_failed", message: "无法写入崩溃备份", params: {} };
        }
        return null;
      }
      if (cmd === "recovery_discard") return null;
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      return origInvoke(cmd, args);
    };
    w.__fireHarnessEvent = (payload: unknown) => {
      for (const id of w.__harnessEventHandlerIds) {
        internals.runCallback(id, { event: "harness:event", id, payload });
      }
    };
  }, { root: ROOT, ...options });
}

const fire = (page: Page, payload: unknown) =>
  page.evaluate(
    (p) => (window as unknown as { __fireHarnessEvent: (x: unknown) => void }).__fireHarnessEvent(p),
    payload,
  );

const persistenceEvent = (overrides: Record<string, unknown> = {}) => ({
  type: "persistence",
  vault: ROOT,
  state: "degraded",
  since_ts: 1795000000,
  severity: "history",
  detail: "llm_request:write",
  history_written: true,
  history_gap: { present: false, since_ts: 0, detail: "" },
  ...overrides,
});

async function openPanel(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator('.ft-row[title="health-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("持久化健康");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

/** 像素基线前的稳定等待：字体就绪 + 300ms（与候选采集同一口径）。 */
async function settleForPixels(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

/** 拍像素前收起首次 history sticky，并清掉关闭后归还的焦点态——整页基线只反映形态本身，
 *  不把「点击关闭/焦点回还」的瞬时态钉进基线（候选采集的同一口径）。 */
async function closeStickyForPixels(page: Page): Promise<void> {
  const sticky = page.locator(".lumir-toast[data-sticky-text]");
  if ((await sticky.count()) > 0) {
    await sticky.first().click();
    await expect(sticky).toHaveCount(0);
  }
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  await settleForPixels(page);
}

async function expectWarningBlockGeometry(note: Locator): Promise<void> {
  const geometry = await note.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      width: el.getBoundingClientRect().width,
      marginLeft: style.marginLeft,
      marginRight: style.marginRight,
      padding: style.padding,
    };
  });
  expect(Math.abs(geometry.width - 465)).toBeLessThanOrEqual(0.5);
  expect(geometry).toMatchObject({ marginLeft: "-8px", marginRight: "-8px", padding: "4px 6px" });
}

/** 从当前焦点开始按 Tab，直到焦点落到 sticky 的原生关闭钮上（最多 80 次）。
 *  不直接 `.focus()`：判据是「Tab 真的能到达」，不是「元素可被脚本聚焦」。 */
async function tabToToastClose(page: Page): Promise<boolean> {
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    const reached = await page.evaluate(
      () => document.activeElement?.classList.contains("toast-close") ?? false,
    );
    if (reached) return true;
  }
  return false;
}

/** 警示块形态读数（Alex 2026-11-23 裁决：浅警示底 + 左侧警示边条、正文色、完整换行）。
 *
 *  token 期望值不写死色值：用同页探针按当前主题解析 `--pending-tint` / `--pending` /
 *  `--text` / `--text-3` / `--danger-tint`，断言元素与 token 对得上。引用失败状态行取
 *  `.lumir-hp-quote-note:not([data-persistence-health])`——它的单行省略形态必须原样保留。 */
async function persistenceBlockMetrics(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;left:-9999px;top:0;background:var(--pending-tint);" +
      "color:var(--text);border-left:3px solid var(--pending)";
    const dangerProbe = document.createElement("div");
    dangerProbe.style.cssText =
      "position:absolute;left:-9999px;top:0;background:var(--danger-tint)";
    const mutedProbe = document.createElement("div");
    mutedProbe.style.cssText = "position:absolute;left:-9999px;top:0;color:var(--text-3)";
    document.body.append(probe, dangerProbe, mutedProbe);
    const probeStyle = getComputedStyle(probe);
    const tokens = {
      pendingTint: probeStyle.backgroundColor,
      pending: probeStyle.borderLeftColor,
      text: probeStyle.color,
      dangerTint: getComputedStyle(dangerProbe).backgroundColor,
      text3: getComputedStyle(mutedProbe).color,
    };
    probe.remove();
    dangerProbe.remove();
    mutedProbe.remove();

    const el = document.querySelector("[data-persistence-health]") as HTMLElement | null;
    const quote = document.querySelector(
      ".lumir-hp-quote-note:not([data-persistence-health])",
    ) as HTMLElement | null;
    const quoteStyle = quote === null ? null : getComputedStyle(quote);
    if (el === null) {
      return {
        tokens,
        el: null,
        quote:
          quoteStyle === null
            ? null
            : {
                whiteSpace: quoteStyle.whiteSpace,
                textOverflow: quoteStyle.textOverflow,
                overflow: quoteStyle.overflow,
                color: quoteStyle.color,
              },
      };
    }
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const lineTops = new Set(
      Array.from(range.getClientRects(), (r) => Math.round(r.top * 10) / 10),
    );
    const composer = document.querySelector(".lumir-hp-composer-box") as HTMLElement | null;
    return {
      tokens,
      el: {
        className: el.className,
        hidden: el.hidden,
        role: el.getAttribute("role"),
        text: el.textContent ?? "",
        display: style.display,
        backgroundColor: style.backgroundColor,
        color: style.color,
        borderLeftColor: style.borderLeftColor,
        borderLeftStyle: style.borderLeftStyle,
        borderLeftWidth: parseFloat(style.borderLeftWidth),
        whiteSpace: style.whiteSpace,
        textOverflow: style.textOverflow,
        overflow: style.overflow,
        overflowWrap: style.overflowWrap,
        fontSize: parseFloat(style.fontSize),
        width: rect.width,
        height: rect.height,
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        lines: lineTops.size,
        bottom: rect.bottom,
        composerTop: composer?.getBoundingClientRect().top ?? null,
      },
      quote:
        quoteStyle === null
          ? null
          : {
              whiteSpace: quoteStyle.whiteSpace,
              textOverflow: quoteStyle.textOverflow,
              overflow: quoteStyle.overflow,
              color: quoteStyle.color,
            },
    };
  });
}

/** 文档区横幅两段的几何（独立评审建议：V4c 补双条件两行几何判据）。 */
async function recoveryBannerGeometry(page: Page) {
  return page.evaluate(() => {
    const bannerEl = document.querySelector(".recovery-banner") as HTMLElement;
    const segments = Array.from(
      bannerEl.querySelectorAll<HTMLElement>(".recovery-banner-segment"),
    );
    const rects = segments.map((segment) => {
      const rect = segment.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        height: rect.height,
      };
    });
    const bannerRect = bannerEl.getBoundingClientRect();
    return {
      rects,
      banner: {
        top: bannerRect.top,
        bottom: bannerRect.bottom,
        left: bannerRect.left,
        right: bannerRect.right,
      },
      scrollWidth: bannerEl.scrollWidth,
      clientWidth: bannerEl.clientWidth,
      scrollHeight: bannerEl.scrollHeight,
      clientHeight: bannerEl.clientHeight,
    };
  });
}

/** 文档区横幅的实际前景 / 有效背景 / 按钮边界（独立评审 P2-1）。
 *
 *  dark 的 `--danger-tint` 是半透明，必须沿祖先链合成出真实承载色再算对比度；不能只拿
 *  `background-color` 原文。按钮背景透明，其有效背景 = 横幅的合成色。 */
async function recoveryBannerContrast(page: Page) {
  return page.evaluate(() => {
    const parse = (value: string) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (match === null) throw new Error(`无法解析颜色：${value}`);
      const parts = match[1]!.split(",").map((part) => Number(part.trim()));
      return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 };
    };
    const effectiveBackground = (el: HTMLElement): string => {
      const layers: Array<{ r: number; g: number; b: number; a: number }> = [];
      for (let node: HTMLElement | null = el; node !== null; node = node.parentElement) {
        const color = parse(getComputedStyle(node).backgroundColor);
        if (color.a > 0) layers.push(color);
        if (color.a >= 1) break;
      }
      let out = { r: 255, g: 255, b: 255 };
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i]!;
        out = {
          r: layer.r * layer.a + out.r * (1 - layer.a),
          g: layer.g * layer.a + out.g * (1 - layer.a),
          b: layer.b * layer.a + out.b * (1 - layer.a),
        };
      }
      return `rgb(${Math.round(out.r)}, ${Math.round(out.g)}, ${Math.round(out.b)})`;
    };
    const banner = document.querySelector(".recovery-banner") as HTMLElement;
    const button = banner.querySelector(".recovery-banner-action") as HTMLElement;
    const bannerStyle = getComputedStyle(banner);
    const buttonStyle = getComputedStyle(button);
    return {
      theme: document.documentElement.dataset.theme ?? null,
      bannerText: bannerStyle.color,
      bannerBackground: effectiveBackground(banner),
      buttonText: buttonStyle.color,
      buttonBackground: effectiveBackground(button),
      buttonBorder: buttonStyle.borderTopColor,
    };
  });
}

// ── V1：健康态不打扰 ──────────────────────────────────────────────────────

test("V1 健康态：状态行与横幅均隐藏、横幅零占位（不新建像素基线）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, {});
  await openPanel(page);

  const note = page.locator("[data-persistence-health]");
  await expect(note).toHaveCount(1);
  await expect(note).toBeHidden();
  await expect(note).toHaveAttribute("role", "status");
  await expect(note).toHaveText("");
  // 零像素：健康态是 `display:none`，不占布局、不画底色（警示块只在告警时出现）。
  const hiddenGeometry = await note.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { display: getComputedStyle(el).display, width: rect.width, height: rect.height };
  });
  expect(hiddenGeometry.display).toBe("none");
  expect(hiddenGeometry.width).toBe(0);
  expect(hiddenGeometry.height).toBe(0);

  const banner = page.locator(".recovery-banner");
  await expect(banner).toHaveCount(1);
  await expect(banner).toBeHidden();
  await expect(banner).toHaveAttribute("role", "status");
  // 结构：横幅是文档区顶部的常驻条；hidden 时不参与 flex 布局（`.pane-editor` 的首行仍是
  // pane）。判据取元素本身，像素层的零漂移由既有整页基线全量比对兜底。
  const bannerIsFirstChild = await page.evaluate(() => {
    const editor = document.querySelector(".pane-editor");
    return editor?.firstElementChild?.classList.contains("recovery-banner") ?? false;
  });
  expect(bannerIsFirstChild).toBe(true);
  const bannerDisplay = await banner.evaluate((el) => getComputedStyle(el).display);
  expect(bannerDisplay).toBe("none");
  // composer 在场且可见（面板没有被状态行挤掉）。
  await expect(page.locator(".lumir-hp-composer")).toBeVisible();
});

// ── V2 / V3：状态行两维分档 ───────────────────────────────────────────────

test("V2 当前写失败：composer 上方紧凑警示块（浅警示底 + 左边条 + 正文色 + 完整换行），引用状态行不受影响", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, {});
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");

  await fire(page, persistenceEvent({ severity: "history" }));
  await expect(note).toBeVisible();
  await expect(note).toHaveText("对话暂未保存。请检查磁盘空间或目录权限；恢复后会继续写入。");

  const block = await persistenceBlockMetrics(page);
  expect(block.el).not.toBeNull();
  expect(block.el!.className).toContain("lumir-hp-persist-warning");
  expect(block.el!.className).not.toContain("lumir-hp-quote-note");
  expect(block.el!.role).toBe("status");
  // 浅警示底取 pending 族，不是 danger 红；左侧警示边条同族。
  expect(block.el!.backgroundColor).toBe(block.tokens.pendingTint);
  expect(block.el!.backgroundColor).not.toBe(block.tokens.dangerTint);
  expect(block.el!.borderLeftStyle).toBe("solid");
  expect(block.el!.borderLeftWidth).toBeGreaterThanOrEqual(2);
  expect(block.el!.borderLeftColor).toBe(block.tokens.pending);
  // 正常正文色，不是灰色元信息小字。
  expect(block.el!.color).toBe(block.tokens.text);
  expect(block.el!.color).not.toBe(block.tokens.text3);
  // 完整换行、不截断。
  expect(block.el!.whiteSpace).toBe("normal");
  expect(block.el!.textOverflow).not.toBe("ellipsis");
  expect(block.el!.overflow).not.toBe("hidden");
  expect(block.el!.scrollWidth).toBeLessThanOrEqual(block.el!.clientWidth + 1);
  expect(block.el!.scrollHeight).toBeLessThanOrEqual(block.el!.clientHeight + 1);
  // 位置在 composer 上方，不覆盖输入区。
  expect(block.el!.width).toBeGreaterThan(0);
  expect(block.el!.bottom).toBeLessThanOrEqual(block.el!.composerTop! + 1);
  // 引用失败状态行仍是灰色小字、单行省略——警示块样式不得外溢到它。
  expect(block.quote).not.toBeNull();
  expect(block.quote!.whiteSpace).toBe("nowrap");
  expect(block.quote!.textOverflow).toBe("ellipsis");
  expect(block.quote!.overflow).toBe("hidden");
  expect(block.quote!.color).toBe(block.tokens.text3);

  // annotation 只换文案、仍是同一警示块。
  await fire(page, persistenceEvent({ severity: "annotation" }));
  await expect(note).toHaveText("部分对话记录写入失败，不影响继续对话");

  // 恢复：ok 且无缺口 ⇒ 隐藏（状态行不自动消隐，但健康态必须隐藏）。
  await fire(
    page,
    persistenceEvent({
      state: "ok",
      severity: null,
      detail: "",
      since_ts: 0,
      history_written: true,
      history_gap: { present: false, since_ts: 0, detail: "" },
    }),
  );
  await expect(note).toBeHidden();
  const hidden = await persistenceBlockMetrics(page);
  expect(hidden.el!.display).toBe("none");
  expect(hidden.el!.width).toBe(0);
  expect(hidden.el!.height).toBe(0);
});

test("V2b en：警示块文案取英文列，与 zh 同一形态", async ({ page }) => {
  await stubTauri(page, { ...VAULT, config: { language: "en" } });
  await stubHealth(page, {});
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");

  await fire(page, persistenceEvent({ severity: "history" }));
  await expect(note).toBeVisible();
  await expect(note).toHaveText(
    "This conversation isn't saved right now. Check disk space or folder permissions; writing will resume once it recovers.",
  );
  await fire(page, persistenceEvent({ severity: "annotation" }));
  await expect(note).toHaveText(
    "Some conversation records couldn't be written; you can keep chatting",
  );
  await fire(
    page,
    persistenceEvent({
      state: "ok",
      severity: null,
      detail: "",
      since_ts: 0,
      history_written: true,
      history_gap: { present: true, since_ts: 1795000000, detail: "llm_request:write" },
    }),
  );
  await expect(note).toHaveText(
    "Earlier messages couldn't be saved; new content is being written again.",
  );
  const block = await persistenceBlockMetrics(page);
  expect(block.el!.backgroundColor).toBe(block.tokens.pendingTint);
  expect(block.el!.color).toBe(block.tokens.text);
});

test("V3 state=ok + 缺口：显示「此前记录未能保存」，MUST NOT 回到健康态；未落盘提示按 history_written 消退", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, {});
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");

  // degraded + 缺口 + 尚未写入：当前失败与缺口同句，另加一句直白的退出风险。
  await fire(
    page,
    persistenceEvent({
      state: "degraded",
      severity: "history",
      history_written: false,
      history_gap: { present: true, since_ts: 1795000000, detail: "llm_request:write" },
    }),
  );
  await expect(note).toBeVisible();
  await expect(note).toHaveText(
    "对话暂未保存，此前部分记录也未能保存。请检查磁盘空间或目录权限；恢复后会继续写入。" +
      " 现在退出，这段对话将无法恢复。",
  );

  // 完整换行：长文案必须折行而不是省略号截断，容器随换行增长。
  const gapGeometry = await persistenceBlockMetrics(page);
  expect(gapGeometry.el!.whiteSpace).toBe("normal");
  expect(gapGeometry.el!.textOverflow).not.toBe("ellipsis");
  expect(gapGeometry.el!.overflow).not.toBe("hidden");
  expect(gapGeometry.el!.scrollWidth).toBeLessThanOrEqual(gapGeometry.el!.clientWidth + 1);
  expect(gapGeometry.el!.scrollHeight).toBeLessThanOrEqual(gapGeometry.el!.clientHeight + 1);
  expect(gapGeometry.el!.lines).toBeGreaterThanOrEqual(2);
  expect(gapGeometry.el!.height).toBeGreaterThanOrEqual(gapGeometry.el!.fontSize * 2.2);
  expect(gapGeometry.el!.text).toContain("此前部分记录也未能保存");
  expect(gapGeometry.el!.text).toContain("现在退出，这段对话将无法恢复");

  // history_written 转 true：退出风险句消退，当前失败 + 缺口文案仍在（MUST NOT 消失）。
  await fire(
    page,
    persistenceEvent({
      state: "degraded",
      severity: "history",
      history_written: true,
      history_gap: { present: true, since_ts: 1795000000, detail: "llm_request:write" },
    }),
  );
  await expect(note).toBeVisible();
  await expect(note).toHaveText(
    "对话暂未保存，此前部分记录也未能保存。请检查磁盘空间或目录权限；恢复后会继续写入。",
  );
  const gapWritten = await persistenceBlockMetrics(page);
  expect(gapWritten.el!.text).not.toContain("现在退出");

  // 写入恢复、缺口仍在：换成恢复态短句；比上面的长文案矮，且仍完整可见。
  await fire(
    page,
    persistenceEvent({
      state: "ok",
      severity: null,
      detail: "",
      since_ts: 0,
      history_written: true,
      history_gap: { present: true, since_ts: 1795000000, detail: "llm_request:write" },
    }),
  );
  await expect(note).toBeVisible();
  await expect(note).toHaveText("此前部分对话记录未能保存；新内容已恢复写入。");
  const recovered = await persistenceBlockMetrics(page);
  expect(recovered.el!.lines).toBe(1);
  expect(recovered.el!.height).toBeLessThan(gapGeometry.el!.height);
  expect(recovered.el!.scrollWidth).toBeLessThanOrEqual(recovered.el!.clientWidth + 1);
});

// ── V4：横幅三形态 ────────────────────────────────────────────────────────

test("V4 横幅：写失败 / 枚举失败 / 两者同时三种形态，健康态撤下", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, { backupFails: true, listFails: false });
  await openPanel(page);

  // 枚举失败先出现（vault 装载后的 checkRecovery）；写失败由 dirty 文档的备份 debounce 触发。
  const banner = page.locator(".recovery-banner");
  await expect(banner).toBeHidden();
  await page.locator(".editor-pane .cm-content").first().click();
  await page.keyboard.type("X");
  await expect(banner).toBeVisible({ timeout: 8000 });
  await expect(banner).toContainText("未保存的修改暂时没有备份，关闭应用可能丢失");
  await expect(banner).toContainText("health-note.md");
  await expect(banner).not.toContainText("崩溃备份");
  await expect(banner).not.toContainText("首个");
  await expect(banner.getByRole("button", { name: "全部保存" })).toBeVisible();
  // 红色强提醒保留：danger 底 + 本横幅的 scoped 深红前景（light 实测 5.017:1）。
  const colors = await recoveryBannerContrast(page);
  expect(colors.theme).toBe("light");
  expect(colors.bannerBackground).toBe("rgb(249, 236, 234)");
  expect(colors.bannerText).toBe("rgb(179, 61, 50)");
  expect(
    contrastRatio(parseCssColor(colors.bannerText), parseCssColor(colors.bannerBackground)),
  ).toBeGreaterThanOrEqual(4.5);
  // 写失败段不冒充保存失败：vault 内文档未被改写。
  await expect(page.locator(".cm-content").first()).toContainText("X");
});

test("V4b 横幅：枚举失败独立在场、带「重新检查」，与写失败段可同时出现", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, { backupFails: false, listFails: true });
  await openPanel(page);
  const banner = page.locator(".recovery-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("无法检查残留备份");
  await expect(banner.getByRole("button", { name: "重新检查" })).toBeVisible();
  await expect(banner).not.toContainText("未保存的修改暂时没有备份");
});

test("V4c 横幅：写失败与枚举失败同时在场（同一横幅两段、各自带动作）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, { backupFails: true, listFails: true });
  await openPanel(page);
  const banner = page.locator(".recovery-banner");
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(banner).toContainText("无法检查残留备份");
  await page.locator(".editor-pane .cm-content").first().click();
  await page.keyboard.type("Y");
  await expect(banner).toContainText("未保存的修改暂时没有备份，关闭应用可能丢失", { timeout: 8000 });
  await expect(banner).toContainText("无法检查残留备份");
  await expect(banner.getByRole("button", { name: "全部保存" })).toBeVisible();
  await expect(banner.getByRole("button", { name: "重新检查" })).toBeVisible();

  // 双条件几何（独立评审建议）：
  //   1200 宽：两段并排一行——不重叠、不出界、不溢出；
  //   900 宽：两段折成两行——第二段从第一段下缘之后开始，横幅不被内容撑破。
  // 这里不强制 1200 宽就换行（flex-wrap 的语义是「放不下才换」），但两行形态必须有
  // 可观测的几何判据，不能只查文案与按钮。
  const wide = await recoveryBannerGeometry(page);
  expect(wide.rects).toHaveLength(2);
  expect(Math.abs(wide.rects[0]!.top - wide.rects[1]!.top)).toBeLessThanOrEqual(0.5);
  expect(wide.rects[1]!.left).toBeGreaterThanOrEqual(wide.rects[0]!.right - 0.5);
  for (const rect of wide.rects) {
    expect(rect.bottom).toBeLessThanOrEqual(wide.banner.bottom + 0.5);
    expect(rect.left).toBeGreaterThanOrEqual(wide.banner.left - 0.5);
    expect(rect.right).toBeLessThanOrEqual(wide.banner.right + 0.5);
  }
  expect(wide.scrollWidth).toBeLessThanOrEqual(wide.clientWidth + 1);
  expect(wide.scrollHeight).toBeLessThanOrEqual(wide.clientHeight + 1);

  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(250);
  const narrow = await recoveryBannerGeometry(page);
  expect(narrow.rects).toHaveLength(2);
  expect(narrow.rects[1]!.top).toBeGreaterThanOrEqual(narrow.rects[0]!.bottom - 0.5);
  for (const rect of narrow.rects) {
    expect(rect.bottom).toBeLessThanOrEqual(narrow.banner.bottom + 0.5);
    expect(rect.left).toBeGreaterThanOrEqual(narrow.banner.left - 0.5);
    expect(rect.right).toBeLessThanOrEqual(narrow.banner.right + 0.5);
  }
  expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.clientWidth + 1);
  expect(narrow.scrollHeight).toBeLessThanOrEqual(narrow.clientHeight + 1);
});

test("V4d en：横幅主文案取英文列，仍保留数量 / 路径与「全部保存」", async ({ page }) => {
  await stubTauri(page, { ...VAULT, config: { language: "en" } });
  await stubHealth(page, { backupFails: true, listFails: false });
  await openPanel(page);
  const banner = page.locator(".recovery-banner");
  await expect(banner).toBeHidden();
  await page.locator(".editor-pane .cm-content").first().click();
  await page.keyboard.type("Z");
  await expect(banner).toBeVisible({ timeout: 8000 });
  await expect(banner).toContainText("Unsaved changes have no backup right now");
  await expect(banner).toContainText("quitting the app may lose them");
  await expect(banner).toContainText("health-note.md");
  await expect(banner).not.toContainText("crash backups");
  await expect(banner.getByRole("button", { name: "Save all" })).toBeVisible();
});

// ── P2-1：横幅实际 WCAG 对比度（light / dark / eink） ─────────────────────

async function assertBannerContrast(page: Page, theme: "light" | "dark" | "eink"): Promise<void> {
  await stubTauri(page, { ...VAULT, config: { theme } });
  await stubHealth(page, { backupFails: true, listFails: true });
  await openPanel(page);
  const banner = page.locator(".recovery-banner");
  await page.locator(".editor-pane .cm-content").first().click();
  await page.keyboard.type("C");
  await expect(banner).toBeVisible({ timeout: 8000 });
  await expect(banner).toContainText("未保存的修改暂时没有备份");
  await expect(banner.getByRole("button", { name: "全部保存" })).toBeVisible();

  const colors = await recoveryBannerContrast(page);
  expect(colors.theme).toBe(theme);
  const textRatio = contrastRatio(
    parseCssColor(colors.bannerText),
    parseCssColor(colors.bannerBackground),
  );
  const buttonTextRatio = contrastRatio(
    parseCssColor(colors.buttonText),
    parseCssColor(colors.buttonBackground),
  );
  const borderRatio = contrastRatio(
    parseCssColor(colors.buttonBorder),
    parseCssColor(colors.buttonBackground),
  );
  console.log(
    `[contrast] ${theme}: text=${textRatio.toFixed(3)} buttonText=${buttonTextRatio.toFixed(3)} ` +
      `border=${borderRatio.toFixed(3)} bg=${colors.bannerBackground} fg=${colors.bannerText}`,
  );
  expect(textRatio).toBeGreaterThanOrEqual(4.5);
  expect(buttonTextRatio).toBeGreaterThanOrEqual(4.5);
  expect(borderRatio).toBeGreaterThanOrEqual(3);
}

test("V4e-light 横幅对比度：正文与按钮文字 ≥4.5、按钮边界 ≥3", async ({ page }) => {
  await assertBannerContrast(page, "light");
});

test("V4e-dark 横幅对比度：半透明 danger-tint 合成后正文与按钮文字 ≥4.5、边界 ≥3", async ({
  page,
}) => {
  await assertBannerContrast(page, "dark");
});

test("V4e-eink 横幅对比度：黑字白底 ≥4.5、按钮边界 ≥3", async ({ page }) => {
  await assertBannerContrast(page, "eink");
});

// ── P2-5：横幅与空态表面同场几何（表面的包含块必须是 pane 行盒，不得盖住横幅） ─────

test("V5 横幅与空工作区同场：空工作区从横幅下缘开始，不得覆盖横幅", async ({ page }) => {
  const empty: VaultFixture & { root: string } = {
    root: `${ROOT}-empty`,
    entries: [],
    files: {},
    links: {},
  };
  await stubTauri(page, empty);
  await stubHealth(page, { listFails: true });
  await page.goto("/");
  const banner = page.locator(".recovery-banner");
  // change make-no-tab-empty-workspace-nov28：空 vault 的表面是空工作区（不再是 D107 的
  // `.editor-notice` 覆盖层）；几何合同不变——它只覆盖 pane 行盒，必须从横幅下缘开始。
  const surface = page.locator(".pane-empty-workspace");
  await expect(banner).toBeVisible();
  await expect(surface).toBeVisible();
  await expect(surface.locator(".pane-empty-title")).toHaveText("没有打开的文档");
  const boxes = await page.evaluate(() => {
    const bannerEl = document.querySelector(".recovery-banner") as HTMLElement;
    const surfaceEl = document.querySelector(".pane-empty-workspace") as HTMLElement;
    const b = bannerEl.getBoundingClientRect();
    const n = surfaceEl.getBoundingClientRect();
    return { bannerBottom: b.bottom, bannerTop: b.top, surfaceTop: n.top, surfaceBottom: n.bottom };
  });
  expect(boxes.surfaceTop).toBeGreaterThanOrEqual(boxes.bannerBottom - 0.5);
  expect(boxes.surfaceTop).toBeGreaterThan(boxes.bannerTop);
  // 反向判别：表面必须真的从横幅下方开始，不能只是「元素存在」；横幅自身仍在视口内。
  expect(boxes.surfaceBottom).toBeGreaterThan(boxes.surfaceTop);
});

// ── P1-3：逻辑会话归属（旧事件不得复活 / 恢复地板不得被 Promise 回执抹掉） ──────

const degradedGap = (token: number) => ({
  type: "persistence",
  vault: ROOT,
  session_token: token,
  state: "degraded",
  since_ts: 1795000000,
  severity: "history",
  detail: "llm_request:write",
  history_written: true,
  history_gap: { present: true, since_ts: 1795000000, detail: "llm_request:write" },
});

/** 同一缺口现场 + 尚无 history 写入：警示块会追加「现在退出…」短句。 */
const degradedGapUnwritten = (token: number) => ({
  ...degradedGap(token),
  history_written: false,
});

test("V6 恢复写失败事件先于 Promise 回执：完整快照为地板，告警不得被 reset 抹掉", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, {
    sessionToken: 41,
    deferResume: true,
    resumeSessionToken: 42,
    resumePersistence: degradedGap(42),
    sessions: [{ session_id: "s-old", first_user_text: "旧会话", ts: 1757000000000 }],
  });
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");
  await page.locator(".lumir-hp-session").click();
  await page.locator(".lumir-hp-sesspop-item").first().click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Record<string, any>).__resumeStarted))
    .toBe(true);

  // 恢复后端的写失败事件先于 Promise 回执到达。
  await fire(page, degradedGap(42));
  await expect(note).toBeVisible();
  await expect(note).toContainText("此前部分记录也未能保存");

  // 回执落地：完整快照（同一 token / 同一失败）是地板，告警必须仍在。
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__resolveResume();
  });
  await expect(note).toBeVisible({ timeout: 5000 });
  await expect(note).toContainText("此前部分记录也未能保存");
});

test("V7 新会话后旧会话的迟到事件不复活告警；新会话自己的事件仍可见", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, {
    sessionToken: 41,
    afterNewSession: { session_token: 0 },
  });
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");
  await page.locator(".lumir-hp-seg-new").click();
  await expect(page.locator(".lumir-hp-sname")).toHaveText("新会话");

  // 旧逻辑会话（token 41）的迟到失败事件：MUST NOT 复活状态行。
  await fire(page, degradedGap(41));
  await expect(note).toBeHidden();

  // 新会话自己的事件（token 43）照常显示。
  await fire(page, degradedGap(43));
  await expect(note).toBeVisible();
  await expect(note).toContainText("此前部分记录也未能保存");
});

test("V8 空会话快照晚于新 token 事件：旧快照不得清掉已接纳的新会话告警", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, {
    sessionToken: 41,
    deferNewSessionSnapshots: true,
  });
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");

  await page.locator(".lumir-hp-seg-new").click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as Record<string, any>).__newSessionStateResolvers.length,
      ),
    )
    .toBeGreaterThan(0);

  // 新会话自己的 token 43 写失败事件先到：状态行正确显示。
  await fire(page, degradedGap(43));
  await expect(note).toBeVisible();

  // 请求时后端还是空会话（token 0）的快照后到：MUST NOT 覆盖已接纳的 token 43。
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__resolveNewSessionStates();
  });
  await expect(note).toBeVisible({ timeout: 5000 });
  await expect(note).toContainText("此前部分记录也未能保存");
});

// ── P2-2：history sticky 的键盘关闭路径 ──────────────────────────────────

test("V9 history sticky：不抢焦点；Tab 到原生关闭钮、Enter 关闭；警示与 gap 保留；新会话可再次提示", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, { sessionToken: 41 });
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");
  const toast = page.locator(".lumir-toast[data-sticky-text]");
  const close = page.locator(".toast-close");

  // 焦点先放在 composer；sticky 出现时不得自动抢焦点（关闭钮只提供 Tab 路径）。
  await page.locator(".lumir-hp-composer").click();
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__focusBeforeSticky = document.activeElement;
  });
  const focusedBefore = await page.evaluate(() => document.activeElement?.className ?? "");
  await fire(page, degradedGapUnwritten(43));
  await expect(note).toBeVisible();
  await expect(toast).toBeVisible();
  await expect(close).toHaveCount(1);
  await expect(close).toHaveAttribute("aria-label", "关闭提示");
  const focusedAfter = await page.evaluate(() => document.activeElement?.className ?? "");
  expect(focusedAfter).toBe(focusedBefore);
  expect(focusedAfter).not.toContain("toast-close");

  expect(await tabToToastClose(page), "Tab 必须能到达 sticky 的关闭钮").toBe(true);
  await page.keyboard.press("Enter");
  await expect(toast).toHaveCount(0);
  const focusAfterEnter = await page.evaluate(() => ({
    same: document.activeElement ===
      (window as unknown as Record<string, unknown>).__focusBeforeSticky,
    isBody: document.activeElement === document.body,
  }));
  expect(focusAfterEnter.same, "Enter 关闭后焦点回到出现前的元素").toBe(true);
  expect(focusAfterEnter.isBody, "关闭后焦点不得落到 body").toBe(false);
  await expect(page.locator(".lumir-harness")).toBeVisible();
  // 关闭只移除本次提示：常驻警示块与 gap 文案仍在。
  await expect(note).toBeVisible();
  await expect(note).toContainText("此前部分记录也未能保存");
  await expect(note).toContainText("现在退出，这段对话将无法恢复");

  // 关闭不是静音：新逻辑会话的 history 失败仍会给一条新的 sticky。
  await page.locator(".lumir-hp-seg-new").click();
  await expect(page.locator(".lumir-hp-sname")).toHaveText("新会话");
  await fire(page, degradedGapUnwritten(44));
  await expect(note).toBeVisible();
  await expect(toast).toBeVisible();
  await expect(close).toHaveCount(1);
});

test("V10 history sticky：Escape 在关闭钮上关闭；不抢焦点；警示与 gap 保留", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, { sessionToken: 41 });
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");
  const toast = page.locator(".lumir-toast[data-sticky-text]");

  await page.locator(".lumir-hp-composer").click();
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__focusBeforeSticky = document.activeElement;
  });
  const focusedBefore = await page.evaluate(() => document.activeElement?.className ?? "");
  await fire(page, degradedGapUnwritten(43));
  await expect(toast).toBeVisible();
  const focusedAfter = await page.evaluate(() => document.activeElement?.className ?? "");
  expect(focusedAfter).toBe(focusedBefore);
  expect(focusedAfter).not.toContain("toast-close");

  expect(await tabToToastClose(page), "Tab 必须能到达 sticky 的关闭钮").toBe(true);
  await page.keyboard.press("Escape");
  await expect(toast).toHaveCount(0);
  const focusAfterEscape = await page.evaluate(() => ({
    same: document.activeElement ===
      (window as unknown as Record<string, unknown>).__focusBeforeSticky,
    isBody: document.activeElement === document.body,
  }));
  expect(focusAfterEscape.same, "Escape 关闭后焦点回到出现前的元素").toBe(true);
  expect(focusAfterEscape.isBody, "关闭后焦点不得落到 body").toBe(false);
  // 普通 Escape 只关 sticky；顶层 escapeRouter 因 defaultPrevented 让路，面板仍在。
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(note).toBeVisible();
  await expect(note).toContainText("此前部分记录也未能保存");
  await expect(note).toContainText("现在退出，这段对话将无法恢复");
});

test("V11 history sticky：鼠标点关闭钮关闭后焦点回到出现前的元素，不落 body", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, { sessionToken: 41 });
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");
  const toast = page.locator(".lumir-toast[data-sticky-text]");

  await page.locator(".lumir-hp-composer").click();
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__focusBeforeSticky = document.activeElement;
  });
  await fire(page, degradedGapUnwritten(43));
  await expect(toast).toBeVisible();
  await page.locator(".toast-close").click();
  await expect(toast).toHaveCount(0);
  const focus = await page.evaluate(() => ({
    same: document.activeElement ===
      (window as unknown as Record<string, unknown>).__focusBeforeSticky,
    isBody: document.activeElement === document.body,
  }));
  expect(focus.same, "鼠标关闭后焦点回到出现前的元素").toBe(true);
  expect(focus.isBody, "鼠标关闭后焦点不得落到 body").toBe(false);
  await expect(note).toBeVisible();
  await expect(note).toContainText("此前部分记录也未能保存");
});

test("V12 history sticky：出现前焦点已失效时，关闭后回落到 composer（不落 body）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, { sessionToken: 41 });
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");
  const toast = page.locator(".lumir-toast[data-sticky-text]");

  // 制造「出现前焦点已失效」：聚焦一个临时按钮后把它从 DOM 摘除，activeElement 回到 body。
  await page.evaluate(() => {
    const tmp = document.createElement("button");
    tmp.id = "tmp-focus-before-sticky";
    tmp.textContent = "tmp";
    document.body.append(tmp);
    tmp.focus();
    tmp.remove();
  });
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await fire(page, degradedGapUnwritten(43));
  await expect(toast).toBeVisible();
  await page.locator(".toast-close").click();
  await expect(toast).toHaveCount(0);
  const focus = await page.evaluate(() => ({
    isComposer: document.querySelector(".lumir-hp-composer")?.contains(document.activeElement) ?? false,
    isBody: document.activeElement === document.body,
  }));
  expect(focus.isComposer, "前一个焦点失效时回落到 composer 区域").toBe(true);
  expect(focus.isBody, "回落不得落到 body").toBe(false);
  await expect(note).toBeVisible();
});

test("V13 history sticky：Escape 准入复用 escapeDisposition（组合期 / keyCode229 不关不消费；四修饰键只消费不关）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, { sessionToken: 41 });
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");
  const toast = page.locator(".lumir-toast[data-sticky-text]");

  await fire(page, degradedGapUnwritten(43));
  await expect(toast).toBeVisible();

  const results = await page.evaluate(() => {
    const close = document.querySelector(".toast-close") as HTMLElement;
    close.focus();
    const dispatch = (init: KeyboardEventInit, variant?: "isComposing" | "keyCode229") => {
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
        ...init,
      });
      if (variant === "isComposing") {
        Object.defineProperty(event, "isComposing", { value: true });
      }
      if (variant === "keyCode229") {
        Object.defineProperty(event, "keyCode", { value: 229 });
      }
      close.dispatchEvent(event);
      const harness = document.querySelector(".lumir-harness") as HTMLElement | null;
      return {
        prevented: event.defaultPrevented,
        visible: document.querySelector(".lumir-toast[data-sticky-text]") !== null,
        panel: harness !== null && !harness.hidden,
      };
    };
    return {
      composing: dispatch({}, "isComposing"),
      keyCode229: dispatch({}, "keyCode229"),
      shift: dispatch({ shiftKey: true }),
      meta: dispatch({ metaKey: true }),
      ctrl: dispatch({ ctrlKey: true }),
      alt: dispatch({ altKey: true }),
    };
  });

  // 组合期 / keyCode 229：归输入法，不关闭、不消费（defaultPrevented 必须为 false）。
  expect(results.composing.prevented, "组合期 Escape 不得被消费").toBe(false);
  expect(results.composing.visible, "组合期 Escape 不得关闭 sticky").toBe(true);
  expect(results.keyCode229.prevented, "keyCode 229 Escape 不得被消费").toBe(false);
  expect(results.keyCode229.visible, "keyCode 229 Escape 不得关闭 sticky").toBe(true);
  // 四修饰键：只消费默认行为（preventDefault），不关闭。
  for (const key of ["shift", "meta", "ctrl", "alt"] as const) {
    expect(results[key].prevented, `${key}+Escape 应只消费默认行为`).toBe(true);
    expect(results[key].visible, `${key}+Escape 不得关闭 sticky`).toBe(true);
    expect(results[key].panel, `${key}+Escape 不得连带关闭面板`).toBe(true);
  }
  await expect(toast).toBeVisible();
  await expect(note).toBeVisible();
  await expect(page.locator(".lumir-harness")).toBeVisible();

  // 普通 Escape 仍只关 sticky：面板不连带关闭，常驻警示与 gap 保留。
  await page.keyboard.press("Escape");
  await expect(toast).toHaveCount(0);
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(note).toBeVisible();
  await expect(note).toContainText("此前部分记录也未能保存");
});

// ── 已批准形态的像素基线（Alex 2026-11-23 批准候选后转正式断言） ────────────

test("V2p 像素基线：Harness degraded（当前写失败）警示块", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, {});
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");
  await fire(page, persistenceEvent({ severity: "history" }));
  await expect(note).toBeVisible();
  await expect(note).toHaveText("对话暂未保存。请检查磁盘空间或目录权限；恢复后会继续写入。");
  await closeStickyForPixels(page);
  await expectWarningBlockGeometry(note);
  await expectScreenshot(page, "harness-degraded.png");
  await expectScreenshot(note, "harness-degraded-warning-block.png");
});

test("V3p 像素基线：state=ok + history gap（尚未写入）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, {});
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");
  await fire(
    page,
    persistenceEvent({
      state: "ok",
      severity: null,
      detail: "",
      since_ts: 0,
      history_written: false,
      history_gap: { present: true, since_ts: 1795000000, detail: "llm_request:write" },
    }),
  );
  await expect(note).toBeVisible();
  await expect(note).toContainText("此前部分对话记录未能保存；新内容已恢复写入。");
  await expect(note).toContainText("现在退出，这段对话将无法恢复。");
  await closeStickyForPixels(page);
  await expectWarningBlockGeometry(note);
  await expectScreenshot(page, "harness-history-gap.png");
  await expectScreenshot(note, "harness-history-gap-warning-block.png");
});

test("V3bp 像素基线：state=ok + history gap（已恢复写入；02b 同形补充）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, {});
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");
  await fire(
    page,
    persistenceEvent({
      state: "ok",
      severity: null,
      detail: "",
      since_ts: 0,
      history_written: false,
      history_gap: { present: true, since_ts: 1795000000, detail: "llm_request:write" },
    }),
  );
  await fire(
    page,
    persistenceEvent({
      state: "ok",
      severity: null,
      detail: "",
      since_ts: 0,
      history_written: true,
      history_gap: { present: true, since_ts: 1795000000, detail: "llm_request:write" },
    }),
  );
  await expect(note).toHaveText("此前部分对话记录未能保存；新内容已恢复写入。");
  await closeStickyForPixels(page);
  await expectWarningBlockGeometry(note);
  await expectScreenshot(page, "harness-history-gap-written.png");
  await expectScreenshot(note, "harness-history-gap-written-warning-block.png");
});

test("V4p 像素基线：文档备份失败横幅", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, { backupFails: true, listFails: false });
  await openPanel(page);
  const banner = page.locator(".recovery-banner");
  await page.locator(".editor-pane .cm-content").first().click();
  await page.keyboard.type("X");
  await expect(banner).toBeVisible({ timeout: 8000 });
  await expect(banner).toContainText("未保存的修改暂时没有备份，关闭应用可能丢失");
  await expect(banner.getByRole("button", { name: "全部保存" })).toBeVisible();
  await settleForPixels(page);
  await expectScreenshot(page, "recovery-banner.png");
  await expectScreenshot(banner, "recovery-banner-element.png");
});

test("迟到的旧 switched 回包不得取消新视图的 persistence 快照", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, {
    sessionToken: 41,
    resumeSessionToken: 42,
    resumePersistence: degradedGap(42),
    deferredSnapshot: { session_token: 42, persistence: degradedGap(42) },
    sessions: [
      { session_id: "s-old-a", first_user_text: "旧会话 A", ts: 1757000000000 },
      { session_id: "s-old-b", first_user_text: "旧会话 B", ts: 1757000000001 },
    ],
  });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const original = internals.invoke;
    let calls = 0;
    w.__resumeCalls = 0;
    w.__resumeResolvers = {};
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_resume_session") {
        const call = calls++;
        w.__resumeCalls = calls;
        return new Promise((resolve) => {
          w.__resumeResolvers[call] = (info: unknown) => {
            if (call === 1) w.__afterResume = true;
            resolve(info);
          };
        });
      }
      return original(cmd, args);
    };
    w.__resolveResumeCall = (call: number, info: unknown) => w.__resumeResolvers[call](info);
  });
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");

  await page.locator(".lumir-hp-session").click();
  await page.locator(".lumir-hp-sesspop-history").nth(0).click();
  await page.locator(".lumir-hp-session").click();
  await page.locator(".lumir-hp-sesspop-history").nth(1).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, any>).__resumeCalls)).toBe(2);

  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__deferNewSessionStates = true;
    w.__resolveResumeCall(1, {
      session_id: "s-new-b",
      restored_items: 0,
      messages: [],
      session_token: 42,
      switched: true,
    });
  });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Record<string, any>).__newSessionStateResolvers.length))
    .toBeGreaterThan(0);

  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__resolveResumeCall(0, {
      session_id: "s-new-a",
      restored_items: 0,
      messages: [],
      session_token: 43,
      switched: true,
    });
    w.__resolveNewSessionStates();
  });
  await expect(note).toBeVisible({ timeout: 5000 });
  await expect(note).toContainText("此前部分记录也未能保存");
});
