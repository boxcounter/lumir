// M363 思考块 + 思考程度 chip（change add-harness-thinking-display-and-effort 的面板半边；
// 档位 / reasoning_chunk 事件 / thinking 快照字段的契约 = M362 的 core 半边）：
//   - agent 消息内渲染思考块：块在前正文在后、多块按块序号序、无思考不渲染块（零噪声）；
//   - 折叠为默认（含流式期间）：折叠态 chevron +「思考过程 · N 秒」（D388），展开态
//     左边线 + 次级灰正文（token 层现行值——像素面归视觉还原，本场景只守结构）；
//   - 思考 chip：控制行位置 = 模型 chip 后、ctx 读数前；浮层三裸档（Low/High/Max，zh/en
//     均英文原文）无释义、当前档位勾选；supported=false → 置灰禁用 + hover 说明（D390）；
//   - 复制消息不含思考内容（复制源 = 正文源文本）。
//
// 全部断言是**结构断言**（在场性 / 文案 / 状态 / 调用记录）——本场景不碰任何像素基线
//（M347 先例：控制行一族场景只守行为不变量；像素面随批次末基线统一重建）。事件经
// __fireHarnessEvent 从桩侧注入（与 m347 同机制）。

import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

const DOC = "# 思考笔记\n\n第一段，给上下文 chip 一个视口口径。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

/** M363 场景桩：在 m347 桩的基础上补 thinking 字段与 harness_set_thinking_effort 记录。
 *  thinking 缺省 { level: "high", supported: true }（空态快照同形——chip 空态照显）。 */
async function stubHarnessThinking(page: Page, thinking?: unknown): Promise<void> {
  await page.addInitScript((thinkingSnapshot) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__effortWrites = [];
    w.__sentMessages = [];
    w.__harnessEventHandlerIds = [];
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_set_thinking_effort") {
        w.__effortWrites.push({ effort: args.effort });
        return null;
      }
      if (cmd === "harness_send") {
        w.__sentMessages.push({ message: args.message });
        return null;
      }
      if (cmd === "harness_abort") {
        return null;
      }
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct: 0 },
          pending_approval: null,
          warn_ctx_pct: 85,
          thinking: thinkingSnapshot,
        });
      }
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      const result = await origInvoke(cmd, args);
      if (cmd === "config_get" && result?.config) {
        result.config.harness = {
          provider: "mock",
          providers: { mock: { fixture: "f.json" } },
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
    w.__copied = [];
    Object.assign(navigator.clipboard, {
      writeText: (text: string) => {
        w.__copied.push(text);
        return Promise.resolve();
      },
    });
  }, thinking ?? { level: "high", supported: true });
}

async function openPanel(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

const fire = (page: Page, payload: unknown) =>
  page.evaluate(
    (p) => (window as unknown as { __fireHarnessEvent: (x: unknown) => void }).__fireHarnessEvent(p),
    payload,
  );

test("思考 chip：控制行位置 / 三裸档浮层 + 当前勾选 / 档位写回 / 不支持置灰", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarnessThinking(page);
  await openPanel(page);

  // ── chip 在场与位置：模型 chip 后、ctx 读数前（快照带 thinking → 空态照显）──
  const ctlOrder = await page.locator(".lumir-hp-ctl > *").evaluateAll((els) =>
    els.map((el) => el.classList[0]),
  );
  expect(ctlOrder).toEqual([
    "lumir-hp-modelwrap",
    "lumir-hp-effwrap",
    "lumir-hp-ctxwrap",
    "lumir-hp-ctl-spacer",
    "lumir-hp-send",
  ]);
  const chip = page.locator(".lumir-hp-eff");
  await expect(chip).toBeVisible();
  // 面文本 = 「思考：High」（档位名 zh/en 均英文原文；上屏首字母大写）。
  await expect(chip.locator(".lumir-hp-eff-label")).toHaveText("思考：High");
  await expect(chip).toHaveAttribute("aria-haspopup", "menu");
  // 支持态悬停 / 读屏名（D389）。
  await expect(chip).toHaveAttribute("title", "思考程度：High（点击切换）");
  await expect(chip).toHaveAttribute("aria-label", "思考程度：High（点击切换）");

  // ── 浮层：三个裸档位、无释义、当前档位勾选（aria-checked + is-current + check 图形）──
  await chip.click();
  const pop = page.locator(".lumir-hp-effpop");
  await expect(pop).toBeVisible();
  await expect(pop).toHaveAttribute("role", "menu");
  await expect(pop).toHaveAttribute("aria-label", "思考程度"); // D392 读屏名
  const items = pop.locator(".lumir-hp-effpop-item");
  await expect(items).toHaveCount(3);
  await expect(items).toHaveText(["Low", "High", "Max"]); // 裸档：无「当前」之类附加词
  // menuitemradio 语义逐项（严格模式：多元素 locator 的 toHaveAttribute 会撞歧义）。
  const roles = await items.evaluateAll((els) => els.map((el) => el.getAttribute("role")));
  expect(roles).toEqual(["menuitemradio", "menuitemradio", "menuitemradio"]);
  // 当前项唯一、勾选在场（High = 快照档位）。
  const current = pop.locator(".lumir-hp-effpop-item.is-current");
  await expect(current).toHaveCount(1);
  await expect(current).toContainText("High");
  await expect(current).toHaveAttribute("aria-checked", "true");
  await expect(pop.locator('.lumir-hp-effpop-item[aria-checked="false"]')).toHaveCount(2);
  await expect(current.locator(".lumir-hp-effpop-check svg")).toBeVisible();

  // ── 选择 Max：chip 读数先更新、写回 harness_set_thinking_effort（参数逐字判据）──
  await items.nth(2).click();
  await expect(pop).toBeHidden();
  await expect(chip.locator(".lumir-hp-eff-label")).toHaveText("思考：Max");
  await expect(chip).toHaveAttribute("title", "思考程度：Max（点击切换）");
  const writes = await page.evaluate(
    () => (window as unknown as { __effortWrites: unknown[] }).__effortWrites,
  );
  expect(writes).toEqual([{ effort: "max" }]);
  // 重开浮层：勾选跟随新档位。
  await chip.click();
  await expect(pop.locator(".lumir-hp-effpop-item.is-current")).toContainText("Max");
  // 浮层外交互收起。
  await page.locator(".lumir-hp-transcript").click();
  await expect(pop).toBeHidden();
});

test("思考 chip 不支持态：置灰禁用 + hover 说明，点击不展开浮层", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarnessThinking(page, { level: "high", supported: false });
  await openPanel(page);

  const chip = page.locator(".lumir-hp-eff");
  await expect(chip).toBeVisible();
  await expect(chip).toBeDisabled();
  await expect(chip).toHaveClass(/is-disabled/);
  // hover 说明 = Alex 裁决点 2 原句（D390），同时是读屏名。
  await expect(chip).toHaveAttribute("title", "当前模型不支持思考程度调节");
  await expect(chip).toHaveAttribute("aria-label", "当前模型不支持思考程度调节");
  // 禁用件不响应点击（force 也不发 click）——浮层不展开。
  await chip.click({ force: true });
  await expect(page.locator(".lumir-hp-effpop")).toBeHidden();
});

test("思考块：折叠默认（含流式）/ 块在前正文在后 / 多块按序号 / 复制不含思考内容", async ({
  page,
}) => {
  await stubTauri(page, VAULT);
  await stubHarnessThinking(page);
  await openPanel(page);

  // 发一条消息开一轮（事件序：reasoning_chunk 先于 text_chunk，M362 保证）。
  await page.locator(".lumir-hp-composer").fill("想清楚再答");
  await page.locator(".lumir-hp-send").click();

  // 零噪声：首个事件到达前没有思考块元素（transcript 里此刻只有用户消息）。
  await expect(page.locator(".lumir-hp-think")).toHaveCount(0);

  // 思考分片流入：折叠态单行（chevron + 「思考过程 · N 秒」，D388），正文不上屏。
  await fire(page, { type: "reasoning_chunk", text: "先看文档结构。", index: 0 });
  const think = page.locator(".lumir-hp-think");
  await expect(think).toHaveCount(1);
  await expect(page.locator(".lumir-hp-msg-assistant")).toBeVisible();
  const head = think.locator(".lumir-hp-think-head");
  await expect(head).toHaveAttribute("aria-expanded", "false"); // 折叠 = 默认（流式期间同）
  await expect(head).toContainText("思考过程 ·"); // 时长读数在场（秒数依注入间隔，不钉死）
  await expect(think.locator(".lumir-hp-think-body")).toBeHidden();
  // 折叠行 chevron 图形在场（i18n-exempt glyph）。
  await expect(head.locator("svg")).toBeVisible();

  // 同块第二分片 + 正文分片：内容实时流入折叠块（不展开也能累积）。
  await fire(page, { type: "reasoning_chunk", text: "再分三段。", index: 0 });
  await fire(page, { type: "text_chunk", text: "正文回答" });
  await expect(think.locator(".lumir-hp-think-body")).toContainText("先看文档结构。再分三段。");

  // 多块按序号序：第二轮思考（index 1）排第二轮正文之前、块 0 之后。
  await fire(page, { type: "reasoning_chunk", text: "第二轮的思考。", index: 1 });
  await fire(page, { type: "text_chunk", text: "第二轮正文" });
  await expect(page.locator(".lumir-hp-think")).toHaveCount(2);
  const msgKids = await page
    .locator(".lumir-hp-msg-assistant")
    .evaluate((el) => [...el.children].map((k) => k.className));
  // 结构序：who 行 → 思考块 ×2（块 0 前块 1 后）→ body → 工具清单（无）。
  expect(msgKids[0]).toContain("lumir-hp-who");
  expect(msgKids[1]).toContain("lumir-hp-think");
  expect(msgKids[2]).toContain("lumir-hp-think");
  expect(msgKids[3]).toContain("lumir-hp-body");
  expect(
    await think.nth(0).locator(".lumir-hp-think-body").textContent(),
  ).toContain("先看文档结构。");
  await expect(think.nth(1).locator(".lumir-hp-think-body")).toContainText("第二轮的思考。");

  // 展开态：点击头 → aria-expanded + 正文显形（想看的人点开即直播——流式期间同一条路）。
  await think.nth(0).locator(".lumir-hp-think-head").click();
  await expect(think.nth(0)).toHaveClass(/is-open/);
  await expect(think.nth(0).locator(".lumir-hp-think-head")).toHaveAttribute("aria-expanded", "true");
  await expect(think.nth(0).locator(".lumir-hp-think-body")).toBeVisible();

  // 轮次结束：块与正文定稿；复制源 = 正文源文本，不含思考内容。
  await fire(page, { type: "done" });
  await expect(page.locator(".lumir-hp-think")).toHaveCount(2); // 定格留存（不随终态消失）
  await page.locator(".lumir-hp-msg-assistant").hover();
  await page.locator(".lumir-hp-msg-assistant .lumir-hp-copy").click();
  const copied = await page.evaluate(
    () => (window as unknown as { __copied: string[] }).__copied,
  );
  expect(copied).toHaveLength(1);
  expect(copied[0]).toContain("正文回答");
  expect(copied[0]).not.toContain("先看文档结构"); // 复制消息不含思考内容
  expect(copied[0]).not.toContain("第二轮的思考");
});

test("无思考的一轮：零噪声——消息只有正文，不渲染思考块", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarnessThinking(page);
  await openPanel(page);

  await page.locator(".lumir-hp-composer").fill("直接回答");
  await page.locator(".lumir-hp-send").click();
  await fire(page, { type: "text_chunk", text: "没有思考的答复" });
  await fire(page, { type: "done" });

  await expect(page.locator(".lumir-hp-msg-assistant")).toContainText("没有思考的答复");
  await expect(page.locator(".lumir-hp-think")).toHaveCount(0);
});
