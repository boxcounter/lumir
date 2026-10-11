import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M455 回归：harness composer **发送被能力闸拒绝**时，回滚必须把输入区连同光标一起还原。
//
// 验收场景 138（真机）暴露的缺陷：拒发回滚只还原块、不落光标（`renderComposer(blocks, null)`），
// 被 `replaceChildren` 打散的 DOM 选区停在边界位 / 失效节点 ⇒ 紧随的 `markDraft()` 按错误的
// caret 判「内容变了」，防抖窗口到点把盘上草稿重写一遍（只有 caret 字段变，sha 由 `85da8511` 变
// `d6a41e72`），违反 change `composer-draft-persistence` design §9⑤「被拒后草稿文件内容不变」。
//
// 判据走 `harness_draft_put` 的**调用次数**（引擎无关）：拒发回滚不得排期第二次写盘。WKWebView
// 与 Chromium 的选区塌陷形态不同，但「不还原光标」这条路径在两者都会让序列化出的 caret 偏离已
// 落盘那份，从而触发重写——同一条缺陷。内容保留另有结构断言。

const DOC = "# 草稿拒发回归\n\n给上下文 chip 一个视口口径。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

const EMPTY_STATE = {
  messages: [],
  usage: { ctx_pct: 0, cache_pct_session: 0 },
  pending_approval: null,
  warn_ctx_pct: 85,
};

/** 场景桩：harness_send 回能力闸拒绝信封（`rejectGate`）；草稿读回 null、写盘按次记录。 */
async function stubDraftReject(page: Page): Promise<void> {
  await page.addInitScript((snapshot) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__draftPuts = [];
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send") {
        throw {
          code: "harness_image_unsupported",
          message: "当前模型不支持图片输入（桩）",
          params: { model: "probe-model" },
        };
      }
      if (cmd === "harness_abort") return null;
      if (cmd === "harness_draft_get") return null;
      if (cmd === "harness_draft_put") {
        w.__draftPuts.push(args.draft_json);
        return null;
      }
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
  }, EMPTY_STATE);
}

test("拒发回滚把光标连同块还原，不重写草稿（design §9⑤）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubDraftReject(page);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("草稿拒发回归");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();

  const composer = page.locator(".lumir-hp-composer");
  await composer.click();
  await page.keyboard.type("draftgate");
  await expect(composer).toContainText("draftgate");

  const puts = () =>
    page.evaluate(() => (window as unknown as { __draftPuts: string[] }).__draftPuts.length);
  // 键入经 input 监听排期草稿；等防抖窗口把这份内容落盘一次。
  await expect.poll(puts, { timeout: 5000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1200); // 走完整窗口，确保没有在途写
  const baseline = await puts();
  expect(baseline).toBeGreaterThan(0);

  // 发送 → 能力闸拒绝（桩）→ 回滚：内容原样保留。
  await page.keyboard.press("Enter");
  await expect(composer).toContainText("draftgate");
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(0); // 会话不推进

  // 拒发回滚不得排期第二次写盘——等一个完整防抖窗口后写盘次数必须不变。
  await page.waitForTimeout(1500);
  expect(await puts()).toBe(baseline);
});
