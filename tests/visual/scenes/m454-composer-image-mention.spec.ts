import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M454（change composer-image-mention）：harness 图片卡片的编号徽标、`@` 插入引用钮与
// transcript 可访问名（含编号）的结构 / 计算属性断言与新增表面基线。
//
//   1. **composer 态**：贴图 → 缩略图角上的编号徽标（`.lumir-hp-qc-ord`，裸编号 `1`）、
//      动作区（`.lumir-hp-qc-actions`）收 `@`（`.lumir-hp-qc-at`，读屏名 D457）与既有 `×`
//      （`.lumir-hp-qc-x`，行为不变）。
//   2. **两张图**：编号徽标按位序 `1` / `2`（只数图片块）。
//   3. **`@` 插入引用**：点 `@` → 光标处插入 `Image 1`。
//   4. **移除重编**：移除第一张 → 余图编号变 `1`（无空号）。
//   5. **transcript 态**：卡片可访问名含编号（D447 改形 `图片 {n}：{name}`），徽标在场。
//
// 行为层（真 WKWebView 剪贴板 / 光标落点）归验收套件（场景 148 / 149）；这里钉结构、计算属性
// 与渲染。
//
// 基线纪律：本场景首跑写入的新表面基线属待裁决项——`expectScreenshot` 的基线经 **Alex 过目**
// 后才算数（未过目前 `gate.sh visual` 会因缺基线判红；本 mission 不动任何既有基线）。

const DOC = "# 图片编号与引用基线\n\n第一段，给上下文 chip 一个视口口径。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

// 合成 fixture（内容寻址名的字节来源是桩，fixture 全合成、无真实 vault 内容）。
const WRITTEN = { name: "pasted-0f9a8b7c6d5e4f.webp", width: 640, height: 360 };
const TS_USER = 1759000000;

const STATE = {
  messages: [
    {
      role: "user",
      text:
        "先看这张图\n" +
        `<image ref="${WRITTEN.name}" type="image/png" width="${WRITTEN.width}" height="${WRITTEN.height}"/>\n` +
        "这里哪里不对？",
      ts: TS_USER,
    },
    { role: "assistant", text: "图里第二行的数字算错了。", ts: TS_USER + 5 },
  ],
  usage: { ctx_pct: 0, cache_pct_session: 0 },
  pending_approval: null,
  warn_ctx_pct: 85,
};

const EMPTY_STATE = {
  messages: [],
  usage: { ctx_pct: 0, cache_pct_session: 0 },
  pending_approval: null,
  warn_ctx_pct: 85,
};

async function stubHarness(page: Page, opts: { snapshot?: unknown } = {}): Promise<void> {
  await page.addInitScript(
    ({ snapshot, written }) => {
      const w = window as unknown as Record<string, any>;
      const internals = w.__TAURI_INTERNALS__;
      const origInvoke = internals.invoke;
      w.__sentMessages = [];
      internals.invoke = async (cmd: string, args: any) => {
        if (cmd === "harness_write_image") {
          if (args.data_base64 === undefined) throw new Error("stub: data_base64 missing");
          return written;
        }
        if (cmd === "harness_read_image") {
          if (args.name !== written.name) {
            throw { code: "harness_image_read_failed", message: "无法读取图片附件（桩）", params: { name: args.name, reason: "not found" } };
          }
          return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        }
        if (cmd === "harness_send") {
          w.__sentMessages.push({ parts_json: args.parts_json, context_json: args.context_json });
          return null;
        }
        if (cmd === "harness_abort") return null;
        if (cmd === "harness_state") return JSON.stringify(snapshot);
        const result = await origInvoke(cmd, args);
        if (cmd === "config_get" && result?.config) {
          result.config.harness = {
            provider: "mock",
            providers: { kimi: { model: "k2" }, deepseek: { model: "d" }, mock: { fixture: "f.json" } },
            permissions: { allow: [], deny: [] },
            loop_max: 8,
            warn_ctx_pct: 85,
            auto_compact: true,
          };
        }
        return result;
      };
    },
    { snapshot: opts.snapshot ?? STATE, written: WRITTEN },
  );
}

async function openPanel(page: Page, opts: { empty?: boolean } = {}): Promise<void> {
  await stubTauri(page, VAULT);
  await stubHarness(page, { snapshot: opts.empty === true ? EMPTY_STATE : STATE });
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

/** 合成剪贴板图片粘贴（DataTransfer 只在 Chromium 构造器路径可靠——视觉场景层口径）。 */
async function pasteImage(page: Page, bytes: number[] = [137, 80, 78, 71]): Promise<void> {
  await page.locator(".lumir-hp-composer").evaluate((el, data) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(data)], "paste.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
  }, bytes);
}

test("composer 态：图片卡片带编号徽标 1、@ 插入引用钮、既有 × 钮（动作区同容器）", async ({ page }) => {
  await openPanel(page, { empty: true });
  await pasteImage(page);

  const card = page.locator(".lumir-hp-composer > .lumir-hp-imgcard");
  await expect(card).toHaveCount(1);
  // 编号徽标：缩略图角上的裸编号（design §8）。
  const badge = card.locator(".lumir-hp-qc-ord");
  await expect(badge).toHaveCount(1);
  await expect(badge).toHaveText("1");
  // 动作区收 `@` 与既有 `×` 两钮（两钮恒显，裁决点 5 的 A）。
  const actions = card.locator(".lumir-hp-qc-actions");
  await expect(actions.locator(".lumir-hp-qc-at")).toHaveCount(1);
  await expect(actions.locator(".lumir-hp-qc-at")).toHaveAttribute("aria-label", "插入图片引用");
  await expect(actions.locator(".lumir-hp-qc-x")).toHaveCount(1);
  // 既有 × 的读屏名未变（D371）。
  await expect(actions.locator(".lumir-hp-qc-x")).toHaveAttribute("aria-label", "移除摘录");
  // 元信息行保持 M440 口径（从文件名开始、无 image · 前缀）。
  await expect(card.locator(".lumir-hp-qc-src")).toHaveText(`${WRITTEN.name} · ${WRITTEN.width}×${WRITTEN.height}`);

  await expectScreenshot(card, "m454-image-card-composer-numbered.png");
});

test("两张图：编号徽标按位序 1 / 2（只数图片块）", async ({ page }) => {
  await openPanel(page, { empty: true });
  await pasteImage(page);
  await pasteImage(page, [137, 80, 78, 72]);

  const cards = page.locator(".lumir-hp-composer > .lumir-hp-imgcard");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).locator(".lumir-hp-qc-ord")).toHaveText("1");
  await expect(cards.nth(1).locator(".lumir-hp-qc-ord")).toHaveText("2");
});

test("@ 插入引用：点击在光标处插入 Image N（N = 该卡编号）", async ({ page }) => {
  await openPanel(page, { empty: true });
  await page.locator(".lumir-hp-composer").click();
  await pasteImage(page);

  const card = page.locator(".lumir-hp-composer > .lumir-hp-imgcard");
  await expect(card).toHaveCount(1);
  await card.locator(".lumir-hp-qc-at").click();
  // 段落里出现引用文本 `Image 1`（N 与该卡编号一致）。
  await expect(page.locator(".lumir-hp-composer")).toContainText("Image 1");
});

test("移除后位序重编：移除第一张，余图徽标变 1（无空号）", async ({ page }) => {
  await openPanel(page, { empty: true });
  await pasteImage(page);
  await pasteImage(page, [137, 80, 78, 72]);

  const cards = page.locator(".lumir-hp-composer > .lumir-hp-imgcard");
  await expect(cards).toHaveCount(2);
  await cards.nth(0).locator(".lumir-hp-qc-x").click();
  await expect(page.locator(".lumir-hp-composer > .lumir-hp-imgcard")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-composer > .lumir-hp-imgcard .lumir-hp-qc-ord")).toHaveText("1");
});

test("transcript 态：图片卡片可访问名含编号（D447 改形）+ 徽标在场", async ({ page }) => {
  await openPanel(page);
  const card = page.locator(".lumir-hp-msg-user .lumir-hp-imgcard");
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute("role", "img");
  await expect(card).toHaveAttribute("aria-label", `图片 1：${WRITTEN.name}`);
  await expect(card.locator(".lumir-hp-qc-ord")).toHaveText("1");
  // transcript 态无动作钮。
  await expect(card.locator(".lumir-hp-qc-at")).toHaveCount(0);
  await expect(card.locator(".lumir-hp-qc-x")).toHaveCount(0);

  await expectScreenshot(card, "m454-image-card-transcript-numbered.png");
});
