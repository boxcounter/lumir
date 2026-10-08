// M383 思考块 / 工具块 / 正文段的**到达序合同**（Alex 2026-10-08 dogfood 截图实证缺陷的
// 合同先行修复，docs/process/rendering-defect-contract-first.md）：
//   不变量：同一条 assistant 消息内，思考块（.lumir-hp-think）、工具块（.lumir-hp-tools）、
//   正文段（.lumir-hp-body）MUST 严格按事件到达序排列——DOM 子节点序 = 事件序。
//   旧合同「思考块一律排在正文之前」（ensureThinkingView 锚定首个 .lumir-hp-body）在
//   「首个正文段已建、思考后到」时把思考块跳到在途工具块前面（截图现场：呈现序
//   Thinking#0 → Thinking#1 → Tool，真实序 Thinking#0 → Tool → Thinking#1）。
//   本场景用事件序列矩阵钉死新不变量，覆盖 mission 列出的全部交错组合：
//     think→tool→think（含/不含正文）、think→think→tool、tool→think→tool、
//     text↔think 交错（段在思考处切分）、相邻工具不被思考之外的 anything 拆块（M374 守卫）。
//   全部断言是**结构断言**（DOM 子节点 class 序 + 折叠态 + 块内容），零像素基线——
//   与 m363 场景同口径。事件经 __fireHarnessEvent 从桩侧注入，事件间逐条 await（每条
//   各自过 rAF 合帧），序列级判定不依赖同帧合并路径。
//
// 反向验证（REVIEW.md 第 1 条）：本矩阵在旧实现上必红——case 1/4/5/6 的期望序与
//   旧锚定插入的实序不同（旧实现把后到的思考块插到首个正文段之前）。修前实测记录见
//   mission M383 notes 与 test-results/visual/ 的首轮失败日志。

import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

const DOC = "# 顺序笔记\n\n第一段，给面板一个视口口径。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

/** 与 m363 同机制的桩：harness_state 空态 + harness_send 只记录 + 事件注入通道。 */
async function stubHarness(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__harnessEventHandlerIds = [];
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send" || cmd === "harness_abort") return null;
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct: 0 },
          pending_approval: null,
          warn_ctx_pct: 85,
          thinking: { level: "high", supported: true },
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
  });
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

// ── 事件词汇（全部合成标记，两两互不为子串） ──
const THINK_A = { type: "reasoning_chunk", text: "思考甲片。", index: 0 };
const THINK_B = { type: "reasoning_chunk", text: "思考乙片。", index: 1 };
const TEXT_1 = { type: "text_chunk", text: "正文一。" };
const TEXT_2 = { type: "text_chunk", text: "正文二。" };
const tool = (status: "started" | "done") => ({
  type: "tool_call",
  name: "vault_read",
  status,
  summary: '{"path":"harness-note.md"}',
});
const DONE = { type: "done" };

/** 消息子节点的符号化 class 序（who 行 / 思考块 / 工具块 / 正文段）。 */
function msgChildClasses(page: Page): Promise<string[]> {
  return page
    .locator(".lumir-hp-msg-assistant")
    .evaluate((el) => [...el.children].map((k) => k.className));
}

async function sendAndFire(page: Page, events: unknown[]): Promise<void> {
  await page.locator(".lumir-hp-composer").fill("顺序探针");
  await page.locator(".lumir-hp-send").click();
  for (const ev of events) {
    await fire(page, ev);
    // 每条事件后等一拍 rAF 合帧：结构落位完成再注下一条，序列判定确定化。
    await page.waitForTimeout(50);
  }
}

/** 折叠默认（M363 合同不破坏）：全部思考块头 aria-expanded=false。 */
async function expectAllFolded(page: Page): Promise<void> {
  const heads = page.locator(".lumir-hp-think-head");
  for (let i = 0; i < (await heads.count()); i++) {
    await expect(heads.nth(i)).toHaveAttribute("aria-expanded", "false");
  }
}

// ── 到达序矩阵：事件序列 → 期望的 DOM 子节点 class 序 ──
// 期望序写成完整 class 数组（含首位的 who 行），一次性相等比较——非子串口径（REVIEW.md #1）。

const CASES: Array<{
  name: string;
  events: unknown[];
  expectClasses: string[];
  /** 按 DOM 序期望的思考块正文（区分块 0 / 块 1 的到达位次）。 */
  expectThinkBodies?: string[];
  /** 定稿（done）后再断言一次子节点序（定稿重渲不得挪动交错位置）。 */
  assertAfterDone?: boolean;
}> = [
  {
    // Alex 现场全序列：think0 → 正文 → 工具 → think1 → 正文。
    // 旧实现：think1 锚到首个 .lumir-hp-body 之前 → [think,think,body,tools,body] 必红。
    name: "think→text→tool→think→text：后到的思考排在工具与后段正文之间",
    events: [THINK_A, TEXT_1, tool("started"), tool("done"), THINK_B, TEXT_2],
    expectClasses: [
      "lumir-hp-who",
      "lumir-hp-think",
      "lumir-hp-body",
      "lumir-hp-tools",
      "lumir-hp-think",
      "lumir-hp-body",
    ],
    expectThinkBodies: ["思考甲片。", "思考乙片。"],
    assertAfterDone: true,
  },
  {
    // 纯思考 + 工具、无正文：旧实现无锚点可插恰好不翻车——守卫用例（修后不得翻）。
    name: "think→tool→think：无正文时思考块保持在工具块两侧",
    events: [THINK_A, tool("started"), tool("done"), THINK_B],
    expectClasses: ["lumir-hp-who", "lumir-hp-think", "lumir-hp-tools", "lumir-hp-think"],
    expectThinkBodies: ["思考甲片。", "思考乙片。"],
  },
  {
    // 两块思考相邻到达后接工具：到达序 = 块序号序（后端按序发），守卫 M363「多块按序号」。
    name: "think→think→tool：相邻思考块按到达（= 块序号）序排在工具前",
    events: [THINK_A, THINK_B, tool("started"), tool("done")],
    expectClasses: ["lumir-hp-who", "lumir-hp-think", "lumir-hp-think", "lumir-hp-tools"],
    expectThinkBodies: ["思考甲片。", "思考乙片。"],
  },
  {
    // 工具 → 思考 → 工具（工具轮可以零正文，真实可达）：思考落位必须封板在途工具块，
    // 第二个工具开新块。旧实现把第二行追加进同一块 → [who,tools,think] 必红。
    name: "tool→think→tool：思考落位封板在途工具块，前后工具各成一块",
    events: [tool("started"), tool("done"), THINK_A, tool("started"), tool("done")],
    expectClasses: ["lumir-hp-who", "lumir-hp-tools", "lumir-hp-think", "lumir-hp-tools"],
    expectThinkBodies: ["思考甲片。"],
  },
  {
    // 正文 → 思考 → 正文：思考把段切开（前两行正文在前段、后到的正文进新段）。
    // 旧实现：思考跳到段前、后段正文继续并入前段 → [who,think,body] 必红。
    name: "text→think→text：思考插在两段正文之间（段在思考处切分）",
    events: [TEXT_1, THINK_A, TEXT_2],
    expectClasses: ["lumir-hp-who", "lumir-hp-body", "lumir-hp-think", "lumir-hp-body"],
    expectThinkBodies: ["思考甲片。"],
  },
  {
    // m363 场景的同交错序列：旧合同「块在前正文在后」在交错时失效——新合同按到达序。
    name: "think→text→think：第二块思考排在前段正文之后（替换旧的「块在前正文在后」）",
    events: [THINK_A, TEXT_1, THINK_B],
    expectClasses: ["lumir-hp-who", "lumir-hp-think", "lumir-hp-body", "lumir-hp-think"],
    expectThinkBodies: ["思考甲片。", "思考乙片。"],
  },
  {
    // M374 守卫：相邻工具行（中间无思考/正文）仍属同一块，不被拆开。
    name: "tool→tool：相邻工具行保持同一块（M374 封板语义不被思考路径误伤）",
    events: [tool("started"), tool("done"), tool("started"), tool("done")],
    expectClasses: ["lumir-hp-who", "lumir-hp-tools"],
    expectThinkBodies: [],
  },
];

for (const c of CASES) {
  test(`到达序：${c.name}`, async ({ page }) => {
    await stubTauri(page, VAULT);
    await stubHarness(page);
    await openPanel(page);
    await sendAndFire(page, c.events);

    await expect
      .poll(() => msgChildClasses(page), { message: "消息子节点序收敛到期望序" })
      .toEqual(c.expectClasses);
    await expectAllFolded(page);
    if (c.expectThinkBodies !== undefined) {
      const bodies = page.locator(".lumir-hp-think-body");
      await expect(bodies).toHaveCount(c.expectThinkBodies.length);
      for (let i = 0; i < c.expectThinkBodies.length; i++) {
        await expect(bodies.nth(i)).toHaveText(c.expectThinkBodies[i]);
      }
    }

    if (c.assertAfterDone) {
      await fire(page, DONE);
      // 定稿挂复制钮（消息子节点末尾），交错位置不动 = 期望序 + 复制钮。
      await expect
        .poll(() => msgChildClasses(page), { message: "定稿后交错位置不动" })
        .toEqual([...c.expectClasses, "lumir-hp-copy"]);
      // 复制源 = 正文拼接，顺序与内容不受思考块/分段影响（M363 边界不破）。
      await page.locator(".lumir-hp-msg-assistant").hover();
      await page.locator(".lumir-hp-msg-assistant .lumir-hp-copy").click();
      const copied = (await page.evaluate(
        () => (window as unknown as { __copied: string[] }).__copied,
      )) as string[];
      expect(copied).toHaveLength(1);
      expect(copied[0]).toContain("正文一。");
      expect(copied[0]).toContain("正文二。");
      expect(copied[0].indexOf("正文一。")).toBeLessThan(copied[0].indexOf("正文二。"));
      expect(copied[0]).not.toContain("思考甲片");
      expect(copied[0]).not.toContain("思考乙片");
    }
  });
}
