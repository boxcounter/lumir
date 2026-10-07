import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M351（change harness-pane-visual-fidelity）：harness pane 视觉保真还原的结构断言与
// 元素级基线。原型 = 已退役的 design/prototypes/phase2-harness-chat（提取细节见 change
// design §2 视觉保真节）。四面：
//
//   1. **消息区**：who/when meta 行（角色 + 相对时间，live 上屏打戳）；用户气泡挂 body
//      （content-bg 底 + border-soft 边 + r6 + 正文 text-2——计算样式探针对照）；快照
//      恢复消费后端 ts（M353）显示真实相对时间，无 ts 的旧快照只有角色（不伪造读数）。
//   2. **composer**：圆角卡片容器（content-bg + border + r8，focus-within 出 accent 框）；
//      发送钮 26×26 图标形态。
//   3. **工具调用清单**（Alex 2026-10-06 裁决还原原型屏 4）：started = running 脉冲行、
//      done 翻 ✓ 行；单行轮次保持展开，≥2 行轮次结束折叠为摘要钮、点击展开回看。
//   4. **元素级基线**：消息区与 composer 区两张 crop——整页容差吞不掉的观感面
//     （m303/m345 的整页基线失效面随批重建，归 tower 的三联图纪律）。
//
// 行为不变量（chip 写回 / ctx 读数 / 两态相位 / 复制源）在 m347 场景，这里不重复。

const DOC = "# 视觉还原笔记\n\n第一段，给上下文 chip 一个视口口径。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

/** M351 场景桩（m347 同构）：config_get 补 [harness] 段；harness_send 只记录不回复
 *  （回复经 __fireHarnessEvent 注入）；harness_abort 吞掉不发终态。 */
async function stubHarness(page: Page, state: unknown): Promise<void> {
  await page.addInitScript((snapshot) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__harnessEventHandlerIds = [];
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send" || cmd === "harness_abort") return null;
      if (cmd === "harness_state") return JSON.stringify(snapshot);
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
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
    w.__fireHarnessEvent = (payload: unknown) => {
      for (const id of w.__harnessEventHandlerIds) {
        internals.runCallback(id, { event: "harness:event", id, payload });
      }
    };
  }, state);
}

const EMPTY_STATE = {
  messages: [],
  usage: { ctx_pct: 0, cache_pct: 0 },
  pending_approval: null,
  warn_ctx_pct: 85,
};

async function openPanel(page: Page, state: unknown = EMPTY_STATE): Promise<void> {
  await stubTauri(page, VAULT);
  await stubHarness(page, state);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

function fire(page: Page, payload: unknown): Promise<void> {
  return page.evaluate(
    (p) => (window as unknown as { __fireHarnessEvent: (x: unknown) => void }).__fireHarnessEvent(p),
    payload,
  );
}

/** token 探针：把 var() 取值解析成计算样式后与目标比对（主题无关——不硬编 rgb）。 */
async function probeColor(page: Page, prop: "color" | "background-color", token: string): Promise<string> {
  return page.evaluate(
    ([p, t]) => {
      const probe = document.createElement("div");
      probe.style.setProperty(p as string, `var(${t})`);
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(p as string);
      probe.remove();
      return value;
    },
    [prop, token] as const,
  );
}

test("消息区：who/when meta 行 + 用户气泡计算样式 + agent 平铺", async ({ page }) => {
  await openPanel(page);

  // ── 发送一条 → 用户消息：who 行（你 + 相对时间）+ body 气泡 ──
  await page.locator(".lumir-hp-composer").fill("这段怎么用？");
  await page.locator(".lumir-hp-send").click();
  const userMsg = page.locator(".lumir-hp-msg-user");
  await expect(userMsg).toHaveCount(1);
  const userWho = userMsg.locator(".lumir-hp-who");
  await expect(userWho).toHaveCount(1);
  await expect(userWho.locator(".lumir-hp-role")).toHaveText("你");
  const userWhen = userWho.locator(".lumir-hp-when");
  await expect(userWhen).toHaveCount(1);
  await expect(userWhen).toHaveText(/· (刚刚|\d+秒前)/);
  await expect(userWhen).toHaveAttribute("data-ts", /^\d+$/);
  // 气泡挂 body（不挂消息元素）：content-bg 底 / border-soft 边 / r6 / 正文 text-2（探针对照）。
  const userBody = userMsg.locator(".lumir-hp-body");
  await expect(userBody).toHaveCount(1);
  const bubble = await userBody.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      backgroundColor: s.backgroundColor,
      color: s.color,
      borderRadius: s.borderRadius,
      borderTopWidth: s.borderTopWidth,
      padding: s.padding,
    };
  });
  expect(bubble.backgroundColor).toBe(await probeColor(page, "background-color", "--content-bg"));
  expect(bubble.color).toBe(await probeColor(page, "color", "--text-2"));
  expect(bubble.borderRadius).toBe("6px");
  expect(bubble.borderTopWidth).toBe("1px");
  expect(bubble.padding).toBe("6px 8px"); // sp-3 sp-4（原型 .msg.user .body）
  // 消息元素自身不再带气泡底色（样式已移挂 body）。
  const msgBg = await userMsg.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(msgBg).toBe("rgba(0, 0, 0, 0)");

  // ── agent 回答：who 行（Agent + when）+ body 平铺（无气泡，正文 text 色）──
  await fire(page, { type: "text_chunk", text: "这是回答。" });
  await fire(page, { type: "done" });
  const agentMsg = page.locator(".lumir-hp-msg-assistant");
  await expect(agentMsg).toHaveCount(1);
  const agentWho = agentMsg.locator(".lumir-hp-who");
  await expect(agentWho.locator(".lumir-hp-role")).toHaveText("Agent");
  await expect(agentWho.locator(".lumir-hp-when")).toHaveAttribute("data-ts", /^\d+$/);
  const agentBody = agentMsg.locator(".lumir-hp-body");
  await expect(agentBody).toContainText("这是回答。");
  const flat = await agentBody.evaluate((el) => {
    const s = getComputedStyle(el);
    return { backgroundColor: s.backgroundColor, borderTopWidth: s.borderTopWidth, color: s.color };
  });
  expect(flat.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(flat.borderTopWidth).toBe("0px");
  expect(flat.color).toBe(await probeColor(page, "color", "--text"));

  // who 行自身的降档形态：micro 字号 / semibold / 宽字距 / 三级色。
  const whoStyle = await agentWho.evaluate((el) => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, fontWeight: s.fontWeight, letterSpacing: s.letterSpacing, color: s.color };
  });
  expect(whoStyle.fontSize).toBe("10.5px");
  expect(whoStyle.fontWeight).toBe("600");
  expect(whoStyle.letterSpacing).toBe("0.525px"); // 0.05em × 10.5px
  expect(whoStyle.color).toBe(await probeColor(page, "color", "--text-3"));

  // 元素级基线：消息区（who/when + 气泡 + 平铺的观感面）。
  await expectScreenshot(page.locator(".lumir-hp-transcript"), "m351-harness-messages.png");
});

test("快照恢复：按后端 ts 显示相对时间；无 ts 的旧快照只有角色（不伪造）", async ({ page }) => {
  const NOW_S = Math.floor(Date.now() / 1000);
  await openPanel(page, {
    messages: [
      { role: "user", text: "恢复的问题", ts: NOW_S - 95 }, // 带后端 ts（M353）→ 显示相对时间
      { role: "assistant", text: "恢复的回答" }, // 缺 ts 的旧快照 → 只显示角色
      { role: "tool", name: "vault_read", summary: "成功", ts: NOW_S - 90 },
    ],
    usage: { ctx_pct: 42, cache_pct: 0 },
    pending_approval: null,
    warn_ctx_pct: 85,
  });

  const userWho = page.locator(".lumir-hp-msg-user .lumir-hp-who");
  await expect(userWho.locator(".lumir-hp-role")).toHaveText("你");
  await expect(userWho.locator(".lumir-hp-when")).toHaveText(/· 1分钟前/);
  const agentMsg = page.locator(".lumir-hp-msg-assistant");
  const agentWho = agentMsg.locator(".lumir-hp-who");
  await expect(agentWho.locator(".lumir-hp-role")).toHaveText("Agent");
  await expect(agentWho.locator(".lumir-hp-when")).toHaveCount(0); // 无 ts 不伪造
  // 恢复的工具记录：挂进最近一条 assistant 消息的清单块，done 行（单行保持展开）。
  const tools = agentMsg.locator(".lumir-hp-tools");
  await expect(tools).toHaveCount(1);
  const rows = tools.locator(".lumir-hp-tool-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveClass(/is-done/);
  await expect(rows.first()).toContainText("工具完成：vault_read — 成功");
  await expect(tools.locator(".lumir-hp-tool-summary")).toHaveCount(0);
});

test("composer：圆角卡片容器 + focus-within 强调框 + 图标发送钮", async ({ page }) => {
  await openPanel(page);

  const box = page.locator(".lumir-hp-composer-box");
  const boxStyle = await box.evaluate((el) => {
    const s = getComputedStyle(el);
    return { backgroundColor: s.backgroundColor, borderRadius: s.borderRadius, borderTopWidth: s.borderTopWidth };
  });
  expect(boxStyle.backgroundColor).toBe(await probeColor(page, "background-color", "--content-bg"));
  expect(boxStyle.borderRadius).toBe("8px");
  expect(boxStyle.borderTopWidth).toBe("1px");
  // 输入区自身无边框无底色（容器承担）；padding 对齐原型 sp-3 sp-4 sp-1。
  const composerStyle = await page.locator(".lumir-hp-composer").evaluate((el) => {
    const s = getComputedStyle(el);
    return { borderTopWidth: s.borderTopWidth, backgroundColor: s.backgroundColor, padding: s.padding };
  });
  expect(composerStyle.borderTopWidth).toBe("0px");
  expect(composerStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(composerStyle.padding).toBe("6px 8px 2px");
  // focus-within：输入区获焦 → 容器出 accent 框； blur 后回结构档。
  await page.locator(".lumir-hp-composer").click();
  await expect
    .poll(async () => box.evaluate((el) => getComputedStyle(el).borderTopColor))
    .toBe(await probeColor(page, "color", "--accent"));
  await page.locator(".lumir-hp-transcript").click();
  await expect
    .poll(async () => box.evaluate((el) => getComputedStyle(el).borderTopColor))
    .not.toBe(await probeColor(page, "color", "--accent"));

  // 发送钮：26×26 图标形态（glyph 两态与 aria-label 的行为断言在 m347）。
  const sendStyle = await page.locator(".lumir-hp-send").evaluate((el) => {
    const s = getComputedStyle(el);
    return { width: s.width, height: s.height, borderRadius: s.borderRadius, backgroundColor: s.backgroundColor };
  });
  expect(sendStyle.width).toBe("26px");
  expect(sendStyle.height).toBe("26px");
  expect(sendStyle.borderRadius).toBe("6px");
  expect(sendStyle.backgroundColor).toBe(await probeColor(page, "background-color", "--accent-fill"));

  // 元素级基线：composer 区（卡片容器 + 控制行的观感面）。
  await expectScreenshot(page.locator(".lumir-hp-composer-area"), "m351-harness-composer.png");
});

test("工具清单：running/done 行 + ≥2 行折叠摘要可回看", async ({ page }) => {
  await openPanel(page);

  // ── 轮次一（单工具）：started = running 脉冲行 → done 翻 ✓ 行；终态后单行保持展开 ──
  await page.locator(".lumir-hp-composer").fill("读一下笔记");
  await page.locator(".lumir-hp-send").click();
  await fire(page, { type: "tool_call", name: "vault_read", status: "started" });
  const tools = page.locator(".lumir-hp-msg-assistant .lumir-hp-tools");
  await expect(tools).toHaveCount(1);
  const row = tools.locator(".lumir-hp-tool-row");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveClass(/is-running/);
  await expect(row).toContainText("调用工具：vault_read");
  await expect(row.locator(".lumir-hp-tool-pulse")).toHaveCount(1);
  await fire(page, { type: "tool_call", name: "vault_read", status: "done", summary: "成功" });
  await expect(row).toHaveClass(/is-done/);
  await expect(row).toContainText("工具完成：vault_read — 成功");
  await expect(row.locator(".lumir-hp-tool-ic svg")).toHaveCount(1); // ✓
  await fire(page, { type: "done" });
  await expect(tools.locator(".lumir-hp-tool-summary")).toHaveCount(0); // 单行不折叠
  await expect(row).toBeVisible();

  // ── 轮次二（两个工具）：终态折叠为摘要钮；点击展开回看、再点收回 ──
  await page.locator(".lumir-hp-composer").fill("再搜一遍");
  await page.locator(".lumir-hp-send").click();
  await fire(page, { type: "tool_call", name: "vault_search", status: "started" });
  await fire(page, { type: "tool_call", name: "vault_search", status: "done", summary: "命中 5 篇" });
  await fire(page, { type: "tool_call", name: "vault_read", status: "started" });
  await fire(page, { type: "tool_call", name: "vault_read", status: "done", summary: "成功" });
  await fire(page, { type: "text_chunk", text: "搜完了。" });
  await fire(page, { type: "done" });

  const tools2 = page.locator(".lumir-hp-msg-assistant").nth(1).locator(".lumir-hp-tools");
  await expect(tools2).toHaveCount(1);
  const summary = tools2.locator(".lumir-hp-tool-summary");
  await expect(summary).toHaveCount(1);
  await expect(summary).toContainText("2 个工具调用 · 全部完成");
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  const rows2 = tools2.locator(".lumir-hp-tool-row");
  await expect(rows2).toHaveCount(2);
  await expect(rows2.nth(0)).toBeHidden();
  await expect(rows2.nth(1)).toBeHidden();
  await summary.click();
  await expect(summary).toHaveAttribute("aria-expanded", "true");
  await expect(rows2.nth(0)).toBeVisible();
  await expect(rows2.nth(0)).toContainText("工具完成：vault_search — 命中 5 篇");
  await expect(rows2.nth(1)).toBeVisible();
  await summary.click();
  await expect(rows2.nth(0)).toBeHidden();
});
