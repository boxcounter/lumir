import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M627：⌘A 全选的**按键链路**（Alex 2026-10-23「harness composer 里 CMD + A 没有选中
// composer 中的全文」）。
//
// 根因（两层）：① ⌘A 此前根本到不了统一键位层——Edit 菜单的预置 SelectAll 自带 ⌘A 加速键，
// 菜单键等价在 NSApplication 分发阶段就被截获（M131 的 ⌘Z / M149 的 ⌘W 同一机制）；
// ② `editor.select-all` 的作用域是 `editor`，composer 内不命中。修法：lib.rs 的
// `swap_select_all_item` 让出加速键 + 把全选收进 `text` 作用域（编辑器与 composer 同一条
// 绑定、装配层按事件目标分派）。
//
// 为什么判据落在这里而不是真机：真机通道的 ⌘A 注入是**键码级丢弃**（M536 五跑实测；
// `scripts/acceptance/README.md` 的「键盘注入通道的两类不可达」同族），验不到按键链路。
// chromium 的 `keyboard.press("Meta+a")` 走的是同一条 window keydown 分发器（也让出了原生
// 菜单），产出的正是让位后的硬件形态事件。菜单点击那条路（原生 NSMenuItem）由 Rust 单测
// `menu_command_only_covers_our_menu_items`（id → 载荷）与真机场景 214（点击后行为）覆盖。

const DOC = [
  "# 全选基线",
  "",
  "第一段用于摘录：先读结论再读论证。",
  "第二段用于摘录：把可执行动作捞出来过一遍。",
  "",
].join("\n");

const QUOTED = "第一段用于摘录：先读结论再读论证。";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-select.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-select.md": DOC },
  links: {},
};

/** `harness_state` 的零态桩（m303 / m345 同款）：不补这条，transcript 停在未初始化空壳。 */
async function stubHarnessState(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => {
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approval: null,
          warn_ctx_pct: 85,
        });
      }
      return invoke(cmd, args);
    };
  });
}

async function openDoc(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await stubHarnessState(page);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-select.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段用于摘录");
}

/** 当前 DOM 选区的读数：文本 + 两端形态 + 是否覆盖 composer 的全部子节点。
 *  端点「落在 composer 元素上」= 全选的块级边界档（`selectNodeContents` 的形态）。 */
async function composerSelection(page: Page): Promise<{
  text: string;
  anchorIsComposer: boolean;
  focusIsComposer: boolean;
  childCount: number;
  focusOffset: number;
  coversAllChildren: boolean;
}> {
  return page.evaluate(() => {
    const composer = document.querySelector(".lumir-hp-composer") as HTMLElement;
    const selection = window.getSelection();
    const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    let coversAllChildren = false;
    if (range !== null) {
      coversAllChildren = [...composer.children].every((child) => range.intersectsNode(child));
    }
    return {
      // `Selection.toString()` 在「选区含 contenteditable=false 卡片」时给空串（Chromium 的
      // 选区文本口径），因此文本读数取 `cloneContents()`——它是**实际选中的内容**，卡片
      // （原子块）的文本也在里面。选区形态本身由 anchor/focus 与 coversAllChildren 判。
      text:
        range === null
          ? ""
          : (range.cloneContents().textContent ?? ""),
      anchorIsComposer: selection?.anchorNode === composer,
      focusIsComposer: selection?.focusNode === composer,
      childCount: composer.children.length,
      focusOffset: selection?.focusOffset ?? -1,
      coversAllChildren,
    };
  });
}

async function openComposer(page: Page): Promise<void> {
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await page.locator(".lumir-hp-composer").click();
}

test("⌘A 在 composer 内全选：选区覆盖全部段落（块级边界档）", async ({ page }) => {
  await openDoc(page);
  await openComposer(page);

  // 两段文字（软断行分出第二行），光标默认在段内某处。
  await page.keyboard.type("alpha 第一段");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("beta 第二段");
  const composer = page.locator(".lumir-hp-composer");
  await expect(composer).toContainText("beta 第二段");

  await page.keyboard.press("Meta+a");
  // 选中态的正观测：两端都落在 composer 元素上（`selectNodeContents` 的形态），且覆盖全部
  // 子节点；文本含两段内容。只断言「有选区」会在一个未覆盖全文的选区上假绿。
  await expect
    .poll(async () => {
      const info = await composerSelection(page);
      return info.anchorIsComposer && info.focusIsComposer && info.coversAllChildren;
    })
    .toBe(true);
  const info = await composerSelection(page);
  expect(info.text).toContain("alpha 第一段");
  expect(info.text).toContain("beta 第二段");
  // 焦点端在末尾之后（块级边界 = 子节点数）。
  expect(info.focusOffset).toBe(info.childCount);
});

test("⌘A 后键入：替换整个 composer 内容（全选真的生效，不只是选区好看）", async ({ page }) => {
  await openDoc(page);
  await openComposer(page);

  await page.keyboard.type("first-part");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("second-part");
  const composer = page.locator(".lumir-hp-composer");
  await expect(composer).toContainText("second-part");

  await page.keyboard.press("Meta+a");
  await page.keyboard.type("X");

  // 全选成立的**端到端**判据：键入把整段替换掉，只留一个字符。若 ⌘A 没选中全文，
  // 这里会是「现有文本 + X」（或局部替换），断言当场红。
  await expect
    .poll(async () => (await composer.evaluate((el) => el.textContent ?? "")).trim())
    .toBe("X");
});

test("composer 里有摘录卡片时 ⌘A 仍覆盖全文（含原子卡片）", async ({ page }) => {
  await openDoc(page);
  // 程序化选区（m285 / m345 同手法）→ 浮动钮 → 卡片入 composer。
  await page.evaluate((quoted) => {
    const view = (document.querySelector(".cm-content") as unknown as {
      cmTile: { root: { view: any } };
    }).cmTile.root.view;
    const start = view.state.doc.toString().indexOf(quoted);
    view.focus();
    view.dispatch({ selection: { anchor: start, head: start + quoted.length } });
  }, QUOTED);
  await page.locator(".quote-gesture-btn").click();
  const composer = page.locator(".lumir-hp-composer");
  const card = composer.locator(":scope > .lumir-hp-qcard");
  await expect(card).toHaveCount(1);
  // 卡片后的一行问题段落：键入素材，让「全选覆盖卡片 + 段落」有可判的文本。
  // MUST 点段落而不是点 composer 中心：卡片点击是「跳回原文」手势（M344），焦点会回到编辑器。
  const para = composer.locator(":scope > .lumir-hp-qpara").last();
  await expect(para).toHaveCount(1);
  await para.click();
  await page.keyboard.type("card-question");
  await expect(composer).toContainText("card-question");
  await expect(card).toHaveCount(1);

  await page.keyboard.press("Meta+a");
  await expect
    .poll(async () => (await composerSelection(page)).coversAllChildren)
    .toBe(true);
  const info = await composerSelection(page);
  // 卡片是 contenteditable=false 的原子块：它必须被选区**覆盖**（intersectsNode 已断言），
  // 文本读数里也带着摘录原文——这正是原生 selectAll 缺失的那部分。
  expect(info.text).toContain(QUOTED);
  expect(info.text).toContain("card-question");
});

test("编辑器内 ⌘A 仍是整篇全选（text 作用域的另一面不受影响）", async ({ page }) => {
  await openDoc(page);
  const editorMain = () =>
    page.evaluate(() => {
      const view = (document.querySelector(".cm-content") as unknown as {
        cmTile: { root: { view: any } };
      }).cmTile.root.view;
      const main = view.state.selection.main;
      return { from: main.from, to: main.to, length: view.state.doc.length };
    });

  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await expect.poll(async () => (await editorMain()).from).toBe(0);
  const sel = await editorMain();
  expect(sel.to).toBe(sel.length);
});
