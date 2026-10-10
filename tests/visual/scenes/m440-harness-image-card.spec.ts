import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M440（change harness-composer-image-paste）：harness composer 图片卡片的结构 / 计算属性
// 断言与新表面基线。
//
//   1. **composer 态**：粘贴（合成 ClipboardEvent + DataTransfer）→ 图片卡片——复用
//      .lumir-hp-qcard 整族样式、**不画引号竖条**（无 .lumir-hp-qc-bar），元信息行
//      **从文件名开始、无 `image ·` 前缀**（Alex 2026-10-10 裁决），缩略图经
//      harness_read_image 字节可见，× 移除钮在场。
//   2. **transcript 态**：快照里带 `<image …/>` 占位行的用户消息按原交错还原——无 ×、
//      role=img 读屏名（D447）、缩略图可见。
//   3. **错误态**：发送被能力闸挡下（harness_image_unsupported）→ 卡片 is-error、
//      composer 内容原样保留、transcript 不推进。
//   4. **加载失败态**：读回失败 → 可见占位（.is-broken，零高度空白不接受）。
//   5. **投递投影**：发送的 parts_json 按块序 text/image 交错，image part 只带附件名。
//
// 行为层（真 WKWebView 剪贴板）归验收套件；这里钉结构、计算属性与四态渲染。
//
// 基线纪律（tasks 4.6）：四张新表面基线经 Alex 过目后才算数——本场景首跑写入基线后，
// 截图另存一份给 Alex 过目（test-results/alex-review-2026-10-10/m440/），未触碰任何
// 既有基线。

const DOC = "# 图片卡片基线\n\n第一段，给上下文 chip 一个视口口径。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

// 合成 1×1 png fixture（内容寻址名的字节来源是桩，fixture 全合成、无真实 vault 内容）。
// 注意：addInitScript 的函数被序列化进页面，闭包常量够不到——base64 在桩内联字面量。
const WRITTEN = { name: "pasted-0f9a8b7c6d5e4f.webp", width: 640, height: 360 };
const TS_USER = 1759000000; // UNIX 秒（面板 messageTs 乘 1000）

/** 会话初值：一条带图用户消息（面板文本含 <image …/> 占位行）+ 一条 assistant 回复。 */
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
  usage: { ctx_pct: 0, cache_pct: 0 },
  pending_approval: null,
  warn_ctx_pct: 85,
};

/** 空会话初值（错误态 / 投递投影用：transcript 从零开始，用户消息条数可判）。 */
const EMPTY_STATE = {
  messages: [],
  usage: { ctx_pct: 0, cache_pct: 0 },
  pending_approval: null,
  warn_ctx_pct: 85,
};

/** M440 场景桩：harness_write_image / harness_read_image 合成应答；harness_send 记录
 *  parts_json（rejectGate 时回 harness_image_unsupported 信封）。 */
async function stubHarness(
  page: Page,
  opts: { rejectGate?: boolean; snapshot?: unknown } = {},
): Promise<void> {
  await page.addInitScript(
    ({ snapshot, rejectGate, written }) => {
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
          if (rejectGate) {
            throw {
              code: "harness_image_unsupported",
              message: "当前模型 probe-model 不支持图片输入（桩）",
              params: { model: "probe-model" },
            };
          }
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
    { snapshot: opts.snapshot ?? STATE, rejectGate: opts.rejectGate ?? false, written: WRITTEN },
  );
}

async function openPanel(page: Page, opts: { rejectGate?: boolean; empty?: boolean } = {}): Promise<void> {
  await stubTauri(page, VAULT);
  await stubHarness(page, { rejectGate: opts.rejectGate, snapshot: opts.empty === true ? EMPTY_STATE : STATE });
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

/** 合成剪贴板图片粘贴（DataTransfer 只在 Chromium 构造器路径可靠——视觉场景层口径）。 */
async function pasteImage(page: Page): Promise<void> {
  await page.locator(".lumir-hp-composer").evaluate((el) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], "paste.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
  });
}

test("composer 态：粘贴图片 → 图片卡片（文件名起的元信息行、无竖条、缩略图、× 钮）", async ({
  page,
}) => {
  await openPanel(page);
  await pasteImage(page);

  const card = page.locator(".lumir-hp-composer > .lumir-hp-imgcard");
  await expect(card).toHaveCount(1);
  // 复用 .lumir-hp-qcard 整族；不画引号竖条（显式视觉决定，design §8）。
  await expect(card).toHaveClass(/lumir-hp-qcard/);
  await expect(card.locator(".lumir-hp-qc-bar")).toHaveCount(0);
  // 元信息行：从文件名开始、无 `image ·` 前缀、尺寸排在后面（落盘命令回传值）。
  await expect(card.locator(".lumir-hp-qc-src")).toHaveText(`${WRITTEN.name} · ${WRITTEN.width}×${WRITTEN.height}`);
  // 缩略图经读回命令渲染为 blob <img>（可见像素）。
  const img = card.locator(".lumir-hp-qc-img");
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute("src", /^blob:/);
  // × 移除钮在场（composer 态）。
  await expect(card.locator(".lumir-hp-qc-x")).toHaveCount(1);

  // 元素级基线（新表面；基线经 Alex 过目后随分支提交，截图另存 Alex 过目目录）。
  await expectScreenshot(card, "m440-image-card-composer.png");
});

test("transcript 态：快照带图消息按原交错还原（无 ×、读屏名、缩略图）", async ({ page }) => {
  await openPanel(page);
  const card = page.locator(".lumir-hp-msg-user .lumir-hp-imgcard");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".lumir-hp-qc-x")).toHaveCount(0);
  await expect(card).toHaveAttribute("role", "img");
  await expect(card).toHaveAttribute("aria-label", `图片 ${WRITTEN.name}`);
  await expect(card.locator(".lumir-hp-qc-src")).toHaveText(`${WRITTEN.name} · ${WRITTEN.width}×${WRITTEN.height}`);
  await expect(card.locator(".lumir-hp-qc-img")).toBeVisible();
  // 交错顺序：图片卡片在问题段落之间。
  const body = page.locator(".lumir-hp-msg-user .lumir-hp-body");
  await expect(body.locator(".lumir-hp-qtext").first()).toHaveText("先看这张图");
  await expect(body.locator(".lumir-hp-qtext").last()).toHaveText("这里哪里不对？");

  await expectScreenshot(card, "m440-image-card-transcript.png");
});

test("错误态：能力闸拒绝 → 卡片 is-error、composer 内容保留、transcript 不推进", async ({
  page,
}) => {
  await openPanel(page, { rejectGate: true, empty: true });
  await pasteImage(page);
  await page.keyboard.type("这图哪里不对？");
  await page.locator(".lumir-hp-send").click();

  // 会话不推进：transcript 里没有用户消息沉淀（渲染面撤下）。
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(0);
  // composer 内容原样保留（图片卡 + 问题段落）。
  const card = page.locator(".lumir-hp-composer > .lumir-hp-imgcard");
  await expect(card).toHaveCount(1);
  await expect(card).toHaveClass(/is-error/);
  await expect(page.locator(".lumir-hp-composer")).toContainText("这图哪里不对？");

  await expectScreenshot(card, "m440-image-card-error.png");

  // 移除错误态卡片后同一消息可正常再发（composer 只剩文本）——spec「不支持时挡住并标出」。
  await card.locator(".lumir-hp-qc-x").click();
  await expect(page.locator(".lumir-hp-composer > .lumir-hp-imgcard")).toHaveCount(0);
});

test("加载失败态：读回失败 → 可见占位（.is-broken，无零高度空白）", async ({ page }) => {
  // 读回只认 WRITTEN.name——把写盘的返回名换成另一个，读回即失败。
  await stubTauri(page, VAULT);
  await page.addInitScript((snapshot) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_write_image") {
        return { name: "pasted-aaaaaaaaaaaaaaaa.webp", width: 8, height: 8 };
      }
      if (cmd === "harness_read_image") {
        throw { code: "harness_image_read_failed", message: "无法读取图片附件（桩）", params: { name: args.name, reason: "not found" } };
      }
      if (cmd === "harness_send" || cmd === "harness_abort") return null;
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
  }, STATE);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();

  await pasteImage(page);
  const card = page.locator(".lumir-hp-composer > .lumir-hp-imgcard");
  await expect(card).toHaveCount(1);
  const thumb = card.locator(".lumir-hp-qc-thumb");
  await expect(thumb).toHaveClass(/is-broken/);
  await expect(thumb).toBeVisible();
  // 无尺寸（桩回 8×8 有尺寸……此桩给了 8×8）——元信息行仍从文件名开始。
  await expect(card.locator(".lumir-hp-qc-src")).toContainText("pasted-aaaaaaaaaaaaaaaa.webp");

  await expectScreenshot(card, "m440-image-card-broken.png");
});

test("投递投影：发送含图消息 → parts_json 按块序 text/image 交错", async ({ page }) => {
  await openPanel(page, { empty: true });
  // 先键入前段问题 → 贴图 → 再键入后段问题：composer = [段落, 图片卡, 段落]。
  await page.locator(".lumir-hp-composer").click();
  await page.keyboard.type("先看这张图");
  await pasteImage(page);
  await page.keyboard.type("这里哪里不对？");
  await page.locator(".lumir-hp-send").click();

  const sent = await page.evaluate(
    () => (window as unknown as { __sentMessages: { parts_json: string }[] }).__sentMessages,
  );
  expect(sent).toHaveLength(1);
  const parts = JSON.parse(sent[0].parts_json) as Array<{ kind: string; text?: string; name?: string }>;
  expect(parts.map((p) => p.kind)).toEqual(["text", "image", "text"]);
  expect(parts[0].text).toBe("先看这张图");
  expect(parts[2].text).toBe("这里哪里不对？");
  expect(parts[1].name).toBe(WRITTEN.name);
  expect(parts[1].text).toBeUndefined();
});
