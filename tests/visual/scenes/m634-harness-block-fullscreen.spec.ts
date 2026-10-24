import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M634（change add-harness-block-fullscreen）的**渲染面**断言：harness 面板里的代码块与表格
// 各有全屏入口，遮罩复用 content pane 的那两条（同一壳、同一关闭路径、同一呈现口径）。
//
// 判据分四组：
//   1. **入口结构**：两类块各包一层 `.lumir-hp-block-slot` + 一个悬停钮（共享形态类
//      `.lumir-block-trigger` + 面板位置类），读屏名取既有词条（D156 / D124），静止态零足迹
//      （visibility: hidden，hover 才浮现）。
//   2. **表格遮罩**：克隆的 cell 文本与面板逐字相同、快照里没有钮副本、只显示点开的那一张；
//      读屏名按**消息内序号**（`Markdown 表格 1` / `2`）——这条钉 D5 的派生读数。
//   3. **代码块遮罩**：内容 = 整块源码（围栏行是头部条、内容行逐字），且**主题 scope 镜像成立**
//      —— `.cm-line.cm-lp-codeblock-line` 的 `white-space: pre` 只在镜像到 CM 生成类的前提下
//      才命中（镜像丢了就退回 normal，这条必红）。
//   4. **关闭与焦点**：`Esc` 退场、焦点回到发起钮（不是编辑器）。
//   5. **流式口径（D4）**：尾块里的缩进块随增量生长时，已打开的遮罩不跟着变、也不清空；关闭再开
//      取最新内容；未闭合围栏没有入口、闭合那一帧起出现。
//
// 本场景只做结构断言，不碰任何像素基线（同 m347 / m460：harness 面板的场景守行为与计算样式，
// 整页像素归既有基线；本 change 的钮静止态 visibility: hidden，因此基线零更新）。
//
// 不在本层：真机 WKWebView 下的 AX 通道与 hover 注入（归验收场景 223）；遮罩观感归 Alex 手感裁决。

/** 编辑器里的文档：一段正文 + 一个围栏块（末尾那条 P2-1 回归用例要用编辑器入口开它）。 */
const DOC = [
  "# 块全屏笔记",
  "",
  "第一段，给上下文 chip 一个视口口径。",
  "",
  "```bash",
  "echo WRAP-PROBE-01",
  "echo WRAP-PROBE-02",
  "```",
  "",
].join("\n");

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

/** 长代码块（围栏闭合）：内容行两两不互为子串，断言因此有区分度。 */
const CODE_LINES = ["echo CB-LINE-01", "echo CB-LINE-02", "echo CB-LINE-03", "echo CB-LINE-04"];

/** 宽表格（三列，cell 文本唯一）：同一消息里两张，用来判消息内序号。 */
const TABLE_A = ["| 名称 | 说明 | 备注 |", "| --- | --- | --- |", "| 甲格 | CELL-甲 | 备注甲 |"].join("\n");
const TABLE_B = ["| 名称 | 说明 | 备注 |", "| --- | --- | --- |", "| 乙格 | CELL-乙 | 备注乙 |"].join("\n");

const BODY = ["前文一段。", "", "```bash", ...CODE_LINES, "```", "", TABLE_A, "", "中间一段。", "", TABLE_B].join("\n");

const STATE = {
  messages: [{ role: "assistant", text: BODY, ts: Math.floor(Date.now() / 1000) - 30 }],
  usage: { ctx_pct: 0, cache_pct_session: 0 },
  pending_approval: null,
  warn_ctx_pct: 85,
};

async function stubHarness(page: Page, snapshot: unknown): Promise<void> {
  await page.addInitScript(
    ([snap]) => {
      const w = window as unknown as Record<string, any>;
      const internals = w.__TAURI_INTERNALS__;
      const invoke = internals.invoke as (cmd: string, args: unknown) => unknown;
      w.__harnessEventHandlerIds = [] as number[];
      internals.invoke = async (cmd: string, args: any) => {
        if (cmd === "harness_state") return JSON.stringify(snap);
        if (cmd === "harness_list_sessions") return [];
        if (cmd === "plugin:event|listen" && args.event === "harness:event") {
          w.__harnessEventHandlerIds.push(args.handler ?? 0);
        }
        return invoke(cmd, args);
      };
      // 流式事件注入（与 m347 同一机制：桩的 listen 闭包不可达，经 runCallback + 记录的 id 送达）。
      w.__fireHarnessEvent = (payload: unknown) => {
        for (const id of w.__harnessEventHandlerIds) {
          internals.runCallback(id, { event: "harness:event", id, payload });
        }
      };
    },
    [snapshot] as const,
  );
}

async function openPanel(
  page: Page,
  snapshot: unknown = STATE,
  config?: VaultFixture["config"],
): Promise<void> {
  await stubTauri(page, config === undefined ? VAULT : { ...VAULT, config });
  await stubHarness(page, snapshot);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

test("块级全屏入口：代码块与表格各有 hover 钮，表格读屏名按消息内序号编号", async ({ page }) => {
  await openPanel(page);

  const slots = page.locator(".lumir-hp-block-slot");
  await expect(slots).toHaveCount(3, { timeout: 5000 }); // 1 代码块 + 2 表格
  await expect(page.locator('.lumir-hp-block-slot[data-hp-block="code"]')).toHaveCount(1);
  await expect(page.locator('.lumir-hp-block-slot[data-hp-block="table"]')).toHaveCount(2);

  const codeSlot = page.locator('.lumir-hp-block-slot[data-hp-block="code"]').first();
  const codeButton = codeSlot.locator(".lumir-hp-block-fs-trigger");
  await expect(codeButton).toHaveAttribute("aria-label", "放大查看代码块");
  await expect(codeButton).toHaveClass(/lumir-block-trigger/);
  // 静止态零足迹：不出现、不占位（整页基线因此零更新）。
  await expect(codeButton).toBeHidden();
  await codeSlot.hover();
  await expect(codeButton).toBeVisible();

  const tableButtons = page.locator('.lumir-hp-block-slot[data-hp-block="table"] .lumir-hp-block-fs-trigger');
  await expect(tableButtons).toHaveCount(2);
  await expect(tableButtons.first()).toHaveAttribute("aria-label", "放大查看表格");
});

test("表格全屏钮锚在表格自身右缘：slot 贴合表宽，不再悬在面板右缘（M660 #4）", async ({ page }) => {
  // Alex 2026-10-24 反馈原话：「harness pane 里的 table 的全屏查看按钮距离 table 太远了，
  // 不容易看到。」根因是面板里的 slot 是块级满宽容器，而 `<table>` 按内容自然宽收紧——
  // 钮钉在 slot 的 `right: 6px`，窄表因此与钮之间隔着一整段空白。修法 = 让表格的 slot 贴合
  // 表格自身宽度（`width: max-content; max-width: 100%`），钮的 right 仍落在表格右缘内侧 6px。
  // 代码块不走这条：它的底色是整行形态，slot 继续吃满面板宽（下一段的正观测）。
  await openPanel(page);

  const geometry = await page.evaluate(() => {
    const slot = document.querySelector<HTMLElement>('.lumir-hp-block-slot[data-hp-block="table"]')!;
    const table = slot.querySelector<HTMLElement>(".lumir-hp-table")!;
    const body = slot.closest<HTMLElement>(".lumir-hp-body")!;
    const codeSlot = document.querySelector<HTMLElement>('.lumir-hp-block-slot[data-hp-block="code"]')!;
    const button = slot.querySelector<HTMLElement>(".lumir-hp-block-fs-trigger")!;
    const rect = (el: Element) => el.getBoundingClientRect();
    return {
      slot: rect(slot),
      table: rect(table),
      body: rect(body),
      codeSlot: rect(codeSlot),
      code: rect(codeSlot.querySelector<HTMLElement>(".lumir-hp-codeblock")!),
      buttonGap: rect(slot).right - rect(button).right,
    };
  });

  // 区分度前提：这张表明显窄于面板（否则「贴合表宽」与「悬在面板右缘」读数无差别）。
  expect(geometry.body.width - geometry.table.width).toBeGreaterThan(80);
  expect(Math.abs(geometry.slot.right - geometry.table.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.slot.width - geometry.table.width)).toBeLessThanOrEqual(1);
  // 位置公式不变：钮仍贴 slot（= 表格）右缘内侧 6px。
  expect(geometry.buttonGap).toBeCloseTo(6, 0);
  // 代码块的 slot 不受影响：仍与面板正文同宽，块底色维持整行形态。
  expect(Math.abs(geometry.codeSlot.width - geometry.body.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.code.width - geometry.body.width)).toBeLessThanOrEqual(1);
});

test("表格全屏：快照逐 cell 相同、无钮副本、读屏名 1/2、Esc 关闭且焦点回触发钮", async ({ page }) => {
  await openPanel(page);

  const overlay = page.locator(".lumir-table-fs-overlay");
  await expect(overlay).toBeHidden();

  const firstSlot = page.locator('.lumir-hp-block-slot[data-hp-block="table"]').first();
  await firstSlot.hover();
  const trigger = firstSlot.locator(".lumir-hp-block-fs-trigger");
  await trigger.click();

  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute("aria-label", "Markdown 表格 1");
  const snapshot = overlay.locator(".lumir-table-fs-snapshot");
  await expect(snapshot.locator("td", { hasText: "CELL-甲" })).toHaveCount(1);
  await expect(snapshot).toContainText("备注甲");
  // 只显示点开的那一张表。
  await expect(snapshot).not.toContainText("CELL-乙");
  // 克隆卫生：快照里不出现任何按钮副本。
  await expect(snapshot.locator("button")).toHaveCount(0);
  // 结构随元素走：面板表格的边框 / 内边距挂在 `.lumir-hp-table` 类上，克隆脱离 .lumir-hp-body
  // 之后仍然成立（否则遮罩里是一张无框表）。
  await expect(snapshot.locator("table.lumir-hp-table")).toHaveCount(1);
  const cellBorder = await snapshot.locator("td").first().evaluate((el) => getComputedStyle(el).borderTopWidth);
  expect(cellBorder).toBe("1px");

  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  await expect(trigger).toBeFocused();

  // 第二张表：序号按消息内同类块递增（D5）。
  const secondSlot = page.locator('.lumir-hp-block-slot[data-hp-block="table"]').nth(1);
  await secondSlot.hover();
  await secondSlot.locator(".lumir-hp-block-fs-trigger").click();
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute("aria-label", "Markdown 表格 2");
  await expect(overlay.locator(".lumir-table-fs-snapshot")).toContainText("CELL-乙");
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
});

test("代码块全屏：整块源码逐行呈现、主题 scope 镜像成立、Esc 关闭且焦点回触发钮", async ({ page }) => {
  await openPanel(page);

  const overlay = page.locator(".lumir-codeblock-fs-overlay");
  const slot = page.locator('.lumir-hp-block-slot[data-hp-block="code"]').first();
  await slot.hover();
  const trigger = slot.locator(".lumir-hp-block-fs-trigger");
  await trigger.click();

  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute("aria-label", "Markdown 代码块 1");

  const content = overlay.locator(".lumir-codeblock-fs-content");
  const lineTexts = await content.locator(".cm-line").allInnerTexts();
  expect(lineTexts).toEqual(["```bash", ...CODE_LINES, "```"]);
  // 首行（围栏）是头部条；缩进块没有头部条这条判据在单测里。
  await expect(content.locator(".cm-line").first()).toHaveClass(/cm-lp-codeblock-head/);

  // 主题 scope 镜像：`white-space: pre` 只由 theme.ts 那条 `.ͼN … .cm-line.cm-lp-codeblock-line`
  // 规则给出（折行档 class 由面板的 scope 宿主解析而来）；镜像丢了这里会退回 normal。
  const whiteSpace = await content
    .locator(".cm-line.cm-lp-codeblock-line")
    .nth(1)
    .evaluate((el) => getComputedStyle(el).whiteSpace);
  expect(whiteSpace).toBe("pre");
  // 快照里不出现面板的悬停钮（内容是重建的，不是克隆）。
  await expect(content.locator(".lumir-block-trigger")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  await expect(trigger).toBeFocused();
  // 关闭不改消息：面板里的块文本原样还在。
  await expect(page.locator(".lumir-hp-msg-assistant .lumir-hp-body")).toContainText("CELL-甲");
});

/** 向面板注入一条流式事件（`auto_turn_started` 先开轮次闸门，否则分片会被当迟到产出丢弃）。 */
async function fireEvent(page: Page, payload: unknown): Promise<void> {
  await page.evaluate((event) => {
    (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent(event);
  }, payload);
}

test("流式口径（D4）：打开即快照——后续增量不回灌遮罩，关闭再开为最新内容；未闭合围栏没有入口", async ({
  page,
}) => {
  await openPanel(page, {
    messages: [],
    usage: { ctx_pct: 0, cache_pct_session: 0 },
    pending_approval: null,
    warn_ctx_pct: 85,
  });

  // 首片：一个缩进代码块（缩进块恒有入口，且在流式尾块里会随增量生长——D4 的判别场景）。
  // 用缩进块而不是围栏块：围栏块要闭合才有入口，闭合之后内容就不再变了。
  await fireEvent(page, { type: "auto_turn_started" });
  await fireEvent(page, { type: "text_chunk", text: "    IND-01" });
  await expect(page.locator(".lumir-hp-codeblock")).toContainText("IND-01");

  const slot = page.locator('.lumir-hp-block-slot[data-hp-block="code"]').first();
  await slot.hover();
  await slot.locator(".lumir-hp-block-fs-trigger").click();
  const overlay = page.locator(".lumir-codeblock-fs-overlay");
  const content = overlay.locator(".lumir-codeblock-fs-content");
  await expect(overlay).toBeVisible();
  await expect(content).toContainText("IND-01");
  await expect(content).not.toContainText("IND-02");

  // 后续增量：尾块重渲、面板里的块长出第二行——遮罩**不跟着变**（快照语义，MUST NOT 一半新一半旧）。
  await fireEvent(page, { type: "text_chunk", text: "\n    IND-02" });
  await expect(page.locator(".lumir-hp-codeblock")).toContainText("IND-02");
  await expect(content).not.toContainText("IND-02");
  await expect(content).toContainText("IND-01"); // 也没有被清空

  // 关闭再开 = 那时最新的内容（尾块已重渲，触发钮是新的一份）。
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  const slot2 = page.locator('.lumir-hp-block-slot[data-hp-block="code"]').first();
  await slot2.hover();
  await slot2.locator(".lumir-hp-block-fs-trigger").click();
  await expect(overlay).toBeVisible();
  await expect(content).toContainText("IND-02");
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();

  // 未闭合围栏：照常按代码块上屏，但**没有**全屏入口；闭合那一帧起钮出现。
  await fireEvent(page, { type: "text_chunk", text: "\n\n```bash\nUNCLOSED-LINE" });
  await expect(page.locator(".lumir-hp-msg-assistant .lumir-hp-body")).toContainText("UNCLOSED-LINE");
  // 缩进块已随空行定稿（1 个入口）；未闭合围栏没有入口。
  await expect(page.locator('.lumir-hp-block-slot[data-hp-block="code"]')).toHaveCount(1);
  await fireEvent(page, { type: "text_chunk", text: "\n```" });
  await expect(page.locator('.lumir-hp-block-slot[data-hp-block="code"]')).toHaveCount(2);
});

/** 把编辑器 caret 落到文档里 `needle` 之后的 `offset` 处并聚焦（与 m277 场景同一手法：
 *  CodeMirror 在 `.cm-content` 上挂着 `cmTile.root.view` 这个自用手柄）。 */
async function caretInEditor(page: Page, needle: string, offset = 0): Promise<void> {
  const pos = await page.evaluate(
    ({ needle, offset }) => {
      const el = document.querySelector(".cm-content") as unknown as {
        cmTile: { root: { view: { state: { doc: { toString(): string } }; dispatch(spec: unknown): void; focus(): void } } };
      };
      const view = el.cmTile.root.view;
      const at = view.state.doc.toString().indexOf(needle);
      if (at < 0) throw new Error(`文档里找不到 ${needle}`);
      return at + offset;
    },
    { needle, offset },
  );
  await page.evaluate((p) => {
    const el = document.querySelector(".cm-content") as unknown as {
      cmTile: { root: { view: { dispatch(spec: unknown): void; focus(): void } } };
    };
    const view = el.cmTile.root.view;
    view.dispatch({ selection: { anchor: p } });
    view.focus();
  }, pos);
}

test("P2-1 回归：从面板开过全屏后，编辑器命令入口仍按编辑器来源取主题 scope（折行档不被面板污染）", async ({
  page,
}) => {
  // 编辑器开代码块折行；⌘J 绑定到命令入口。面板的块**不折行**（面板没有 .cm-content），
  // 因此两条入口的折行档读数天然互斥——这正是判别面板宿主有没有漏进编辑器路径的判据。
  await openPanel(page, STATE, {
    keys: { "Cmd-j": "code-block.toggle-fullscreen" },
    code_block_wrap: true,
  });

  const overlay = page.locator(".lumir-codeblock-fs-overlay");

  // ① 先走面板入口：nowrap 档（与编辑器的 code_block_wrap=true 无关）。
  const slot = page.locator('.lumir-hp-block-slot[data-hp-block="code"]').first();
  await slot.hover();
  await slot.locator(".lumir-hp-block-fs-trigger").click();
  await expect(overlay).toBeVisible();
  const harnessContent = overlay.locator(".lumir-codeblock-fs-content");
  await expect(harnessContent).toHaveAttribute("class", /cm-lp-codeblock-nowrap/);
  const harnessWhiteSpace = await harnessContent
    .locator(".cm-line.cm-lp-codeblock-line")
    .nth(1)
    .evaluate((el) => getComputedStyle(el).whiteSpace);
  expect(harnessWhiteSpace).toBe("pre");
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();

  // ② 再从编辑器命令入口开：折行档必须跟编辑器配置（break-spaces）。修前这里会拿到陈旧的
  //    面板宿主 ⇒ 找不到 .cm-content ⇒ 退回 nowrap（"pre"），折行设置被面板污染。
  await caretInEditor(page, "WRAP-PROBE-01", 1);
  await page.keyboard.press("Meta+j");
  await expect(overlay).toBeVisible();
  const editorContent = overlay.locator(".lumir-codeblock-fs-content");
  await expect(editorContent).toHaveAttribute("class", /cm-lp-codeblock-wrap/);
  const editorWhiteSpace = await editorContent
    .locator(".cm-line.cm-lp-codeblock-line")
    .nth(1)
    .evaluate((el) => getComputedStyle(el).whiteSpace);
  expect(editorWhiteSpace).toBe("break-spaces");
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
});
