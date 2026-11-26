import { expect, test, type Page } from "@playwright/test";
import { fireMenuCommand, fsMutations, stubTauri, type VaultFixture } from "./tauri-stub";

// 文本输入面的 ⌘A 全选（change fix-text-input-select-all-nov26，Alex 2026-11-26：
// 「Quick Open 等输入框同类问题反复出现，这不是个案而是模式」）。
//
// 缺陷根因不在「重命名漏了一行」，而在「⌘A 的落面只声明了两处 CM 文本面」：M627 把 Edit 菜单
// 的预置 Select All 让出加速键后，原生输入框的 webview 兜底也没了；于是 quick-open / toc /
// vault 各自就地 `input.select()`，文件树的内联重命名漏写，⌘A 静默落空。本场景守的是**统一
// 分派**之后的合同（docs/specs/text-input-faces.md）：
//   T1 任意可编辑文本宿主内 ⌘A 全选该宿主内容，且由应用显式接管（defaultPrevented 为真）；
//   T2 ⌘A 只落在当前聚焦的面：输入框持焦时 MUST NOT 选中编辑器正文（菜单路径同理）；
//   T3 组合期归输入法 / 原生路径：MUST NOT 消费、MUST NOT 建立全选；
//   T4 焦点不在文本面时不消费（「全局 Select All 不抢错焦点」）。
//
// 判据为什么必须有 `defaultPrevented` 一列：chromium 的原生 select-all 本来就工作，只看选区
// 分不出「应用接管了」与「引擎顺手做了」——后者在 WKWebView 上不成立（用户实测的缺陷正是这条
// 差异，同 selector-aria-ime-nov25 的口径）。真机 WKWebView 的终审在验收场景
// `scripts/acceptance/scenarios/881-text-input-select-all-nov26.md`。
//
// 本场景不覆盖：各浮层的候选筛选 / 关闭 / 焦点交还（quick-open、toc、vault 各自的场景与验收
// 场景 13 / 17 / 230 已覆盖）；设置面板的全部输入（行为与其它原生 input 同一条分派，静态
// 清单见 tests/unit/text-input-faces.test.ts）。

const PLAN_DOC = "# 计划\n\nPLAN-MARKER-全部选中后的正文。\n";
const OTHER_DOC = "# 其它\n\nOTHER-MARKER。\n";
const LONG_DOC = "# 长文\n\n第一行。\n第二行。\n第三行。\n第四行。\n";

const VAULT: VaultFixture = {
  root: "/v",
  entries: [
    { path: "notes", kind: "dir", size: 0, mtime_ms: 0 },
    { path: "plan.md", kind: "file", size: PLAN_DOC.length, mtime_ms: 0 },
    { path: "other.md", kind: "file", size: OTHER_DOC.length, mtime_ms: 0 },
    { path: "long.md", kind: "file", size: LONG_DOC.length, mtime_ms: 0 },
  ],
  files: { "plan.md": PLAN_DOC, "other.md": OTHER_DOC, "long.md": LONG_DOC },
  links: {},
};

async function openDoc(page: Page, file = "plan.md", contains = "MARKER"): Promise<void> {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator(`.ft-row[title="${file}"]`).click();
  await expect(page.locator(".cm-content")).toContainText(contains);
}

/** 记录窗口冒泡末端的 ⌘A 消费读数（判「应用有没有显式接管」；见文件头）。 */
async function installKeyLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __cmdA: Array<{ prevented: boolean }>; __cmdAInstalled?: boolean };
    w.__cmdA = [];
    // 同一用例里多次安装只登记一次监听（否则一次按键会被多条监听各记一条，矩阵用例的断言即失真）。
    if (w.__cmdAInstalled === true) return;
    w.__cmdAInstalled = true;
    window.addEventListener("keydown", (event) => {
      if (event.key === "a" && event.metaKey) w.__cmdA.push({ prevented: event.defaultPrevented });
    });
  });
}

async function keyLog(page: Page): Promise<Array<{ prevented: boolean }>> {
  return page.evaluate(() => (window as unknown as { __cmdA: Array<{ prevented: boolean }> }).__cmdA);
}

/** 原生输入框的选区读数（全选的判据是 selectionStart/End，不是「值没变」）。 */
async function inputState(
  page: Page,
  selector: string,
): Promise<{ start: number | null; end: number | null; value: string }> {
  return page.locator(selector).evaluate((el) => {
    const input = el as HTMLInputElement;
    return { start: input.selectionStart, end: input.selectionEnd, value: input.value };
  });
}

/** 编辑器（CodeMirror）的选区读数：判 ⌘A 没有绕到 `editor.select-all`（那会整篇选中）。 */
async function editorSelection(page: Page): Promise<{ anchor: number; head: number }> {
  return page.evaluate(() => {
    const el = document.querySelector(".cm-content") as unknown as {
      cmTile: {
        root: { view: { state: { selection: { main: { anchor: number; head: number } } } } };
      };
    };
    const main = el.cmTile.root.view.state.selection.main;
    return { anchor: main.anchor, head: main.head };
  });
}

interface EditorViewHandle {
  state: {
    doc: { lineAt: (pos: number) => { number: number } };
    selection: { main: { head: number } };
  };
}

async function editorLine(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector(".cm-content") as unknown as {
      cmTile: { root: { view: EditorViewHandle } };
    };
    const view = el.cmTile.root.view;
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  });
}

/** 组合期按键：真实引擎在 composition 期间派发的 keydown 带 `isComposing`。 */
async function composingKey(
  page: Page,
  selector: string,
  key: { key: string; metaKey?: boolean },
): Promise<{ prevented: boolean; start: number | null; end: number | null }> {
  return page.locator(selector).evaluate((el, spec) => {
    const input = el as HTMLInputElement;
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const event = new KeyboardEvent("keydown", {
      key: spec.key,
      bubbles: true,
      cancelable: true,
      isComposing: true,
      metaKey: spec.metaKey === true,
    });
    input.dispatchEvent(event);
    const result = {
      prevented: event.defaultPrevented,
      start: input.selectionStart,
      end: input.selectionEnd,
    };
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    return result;
  }, key);
}

async function beginRename(page: Page, file = "plan.md"): Promise<void> {
  await page.locator(`.ft-row[title="${file}"]`).click({ button: "right" });
  await expect(page.locator(".ft-menu")).toBeVisible();
  await page.locator(".ft-menu .ft-menu-item", { hasText: "重命名…" }).click();
  await expect(page.locator(".ft-row.is-editing .ft-edit")).toBeFocused();
}

// ---------------------------------------------------------------------------
// 文件树内联编辑——缺陷现场（重命名）
// ---------------------------------------------------------------------------

test("重命名：⌘A 由统一分派接管，全选输入串；键入替换整串、Enter 仍提交", async ({ page }) => {
  await openDoc(page);
  const before = await editorSelection(page);
  await beginRename(page);
  const input = page.locator(".ft-row.is-editing .ft-edit");
  // 原名打开即全选；把光标推到末尾，制造「⌘A 之前不是全选」的现场（否则选区断言恒真）。
  await page.keyboard.press("End");
  expect(await inputState(page, ".ft-row.is-editing .ft-edit")).toEqual({
    start: "plan.md".length,
    end: "plan.md".length,
    value: "plan.md",
  });

  await installKeyLog(page);
  await page.keyboard.press("Meta+a");
  expect(await keyLog(page), "输入框里的 ⌘A 必须由统一分派显式消费").toEqual([{ prevented: true }]);
  expect(await inputState(page, ".ft-row.is-editing .ft-edit")).toEqual({
    start: 0,
    end: "plan.md".length,
    value: "plan.md",
  });
  expect(await editorSelection(page), "⌘A 不得选中编辑器正文").toEqual(before);

  // 全选的判据：键入替换整串（追加形态会得到 `plan.mdrenamed.md`）。
  await page.keyboard.type("renamed.md");
  expect(await inputState(page, ".ft-row.is-editing .ft-edit")).toEqual({
    start: "renamed.md".length,
    end: "renamed.md".length,
    value: "renamed.md",
  });
  await page.keyboard.press("Enter");
  // 新名由 watcher 回响收敛，桩里没有回响通道——判据落在「提交进了既有改名链路」。
  const mutations = await fsMutations(page);
  expect(mutations.filter((row) => row.cmd === "fs_rename_entry")).toEqual([
    { cmd: "fs_rename_entry", rel: "plan.md", new_name: "renamed.md", to: "renamed.md" },
  ]);
});

test("新建文件：⌘A 重新全选预填默认名（预选之外的第二条路径）", async ({ page }) => {
  await openDoc(page);
  await page.locator('.ft-row[title="notes"]').click({ button: "right" });
  await expect(page.locator(".ft-menu")).toBeVisible();
  await page.locator(".ft-menu .ft-menu-item", { hasText: "新建文件…" }).click();
  const input = page.locator(".ft-item.is-new .ft-edit");
  await expect(input).toBeFocused();
  const prefill = await inputState(page, ".ft-item.is-new .ft-edit");
  expect(prefill.value.length).toBeGreaterThan(0);
  // 把选区收成光标（End），再按 ⌘A——走的是统一分派，不是 beginCreate 的预选。
  await page.keyboard.press("End");
  await installKeyLog(page);
  await page.keyboard.press("Meta+a");
  expect(await keyLog(page)).toEqual([{ prevented: true }]);
  expect(await inputState(page, ".ft-item.is-new .ft-edit")).toEqual({
    start: 0,
    end: prefill.value.length,
    value: prefill.value,
  });
  await page.keyboard.press("Escape");
  await expect(page.locator(".ft-item.is-new")).toHaveCount(0);
});

test("重命名：组合期 ⌘A 不被接管、不建立全选（归输入法 / 原生路径）", async ({ page }) => {
  await openDoc(page);
  await beginRename(page);
  await page.keyboard.press("End");
  const state = await composingKey(page, ".ft-row.is-editing .ft-edit", { key: "a", metaKey: true });
  expect(state.prevented, "组合期 MUST NOT 消费 ⌘A").toBe(false);
  expect(state.start, "组合期 MUST NOT 建立全选").toBe(state.end);
  // 编辑态仍在、输入串不变（组合期那一拍没有误关编辑）。
  await expect(page.locator(".ft-row.is-editing .ft-edit")).toHaveValue("plan.md");
});

test("菜单 Select All：焦点在重命名框时选输入串，不抢正文", async ({ page }) => {
  await openDoc(page);
  const before = await editorSelection(page);
  await beginRename(page);
  await page.keyboard.press("End");

  await fireMenuCommand(page, "selectAll");
  expect(await inputState(page, ".ft-row.is-editing .ft-edit")).toEqual({
    start: 0,
    end: "plan.md".length,
    value: "plan.md",
  });
  expect(await editorSelection(page), "菜单全选 MUST NOT 落到编辑器正文").toEqual(before);
  await expect(page.locator(".ft-row.is-editing .ft-edit")).toBeFocused();
});

// ---------------------------------------------------------------------------
// 其它原生输入面——同一条分派的抽查（设置 / harness 的输入由静态清单与统一行为覆盖）
// ---------------------------------------------------------------------------

test("文件内搜索：⌘A 只选查询框；正文与查询过滤不受影响", async ({ page }) => {
  await openDoc(page);
  const before = await editorSelection(page);
  await page.keyboard.press("Meta+f");
  const input = page.locator(".lumir-search-input");
  await input.fill("PLAN");
  await page.keyboard.press("End");
  await installKeyLog(page);
  await page.keyboard.press("Meta+a");
  expect(await keyLog(page)).toEqual([{ prevented: true }]);
  expect(await inputState(page, ".lumir-search-input")).toEqual({ start: 0, end: 4, value: "PLAN" });
  expect(await editorSelection(page), "⌘A 不得选中编辑器正文").toEqual(before);
  // 全选后键入替换查询串（追加形态会得到 `PLANx`）。
  await page.keyboard.type("OTHER");
  expect(await inputState(page, ".lumir-search-input")).toEqual({
    start: 5,
    end: 5,
    value: "OTHER",
  });
});

test("跳转到行：⌘A 全选行号，键入替换后 Enter 跳到该行", async ({ page }) => {
  await openDoc(page, "long.md", "第一行");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Alt+g");
  const input = page.locator(".lumir-goto-input");
  await expect(input).toBeFocused();
  await input.fill("1");
  await page.keyboard.press("End");
  await installKeyLog(page);
  await page.keyboard.press("Meta+a");
  expect(await keyLog(page)).toEqual([{ prevented: true }]);
  expect(await inputState(page, ".lumir-goto-input")).toEqual({ start: 0, end: 1, value: "1" });
  await page.keyboard.type("4");
  expect(await inputState(page, ".lumir-goto-input")).toEqual({ start: 1, end: 1, value: "4" });
  await page.keyboard.press("Enter");
  expect(await editorLine(page)).toBe(4);
});

test("键位面板：查询框里的 ⌘A 全选查询串", async ({ page }) => {
  await openDoc(page);
  await page.keyboard.press("Meta+/");
  const input = page.locator(".lumir-bindings-input");
  await expect(input).toBeFocused();
  await input.fill("abc");
  await page.keyboard.press("End");
  await installKeyLog(page);
  await page.keyboard.press("Meta+a");
  expect(await keyLog(page)).toEqual([{ prevented: true }]);
  expect(await inputState(page, ".lumir-bindings-input")).toEqual({ start: 0, end: 3, value: "abc" });
  await page.keyboard.press("Escape");
});

// ---------------------------------------------------------------------------
// 合同的两条边界：不抢错焦点、contenteditable 也归「可编辑文本宿主」
// ---------------------------------------------------------------------------

test("焦点不在文本面：⌘A 不被消费、正文选区不变", async ({ page }) => {
  await openDoc(page);
  const before = await editorSelection(page);
  await page.locator('.ft-row[title="other.md"]').focus();
  expect(
    await page.evaluate(() => document.activeElement?.tagName ?? "none"),
    "前置：焦点在文件树行（button）上，不在任何文本面",
  ).toBe("BUTTON");
  await installKeyLog(page);
  await page.keyboard.press("Meta+a");
  expect(await keyLog(page), "非文本面上的 ⌘A MUST NOT 被全选分支消费").toEqual([{ prevented: false }]);
  expect(await editorSelection(page), "正文选区不变（没有抢错焦点）").toEqual(before);
});

test("编辑器内的 ⌘A 不回归：仍选整篇文档", async ({ page }) => {
  await openDoc(page);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  const selection = await page.evaluate(() => {
    const el = document.querySelector(".cm-content") as unknown as {
      cmTile: { root: { view: { state: { selection: { main: { from: number; to: number } }; doc: { length: number } } } } };
    };
    const view = el.cmTile.root.view;
    return { from: view.state.selection.main.from, to: view.state.selection.main.to, length: view.state.doc.length };
  });
  expect(selection).toEqual({ from: 0, to: selection.length, length: selection.length });
});

test("原生 input 类型矩阵（真实浏览器）：number / email 整值全选；date / time 不被吞", async ({ page }) => {
  await openDoc(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // 合成熟宿主进页面：它们不是产品面，是「原生输入类型」这条判据的类型矩阵探针（与下面的
  // contenteditable 探针同口径）。为什么必须有这一条：isTextEntryHost 的清单只能靠真实引擎定，
  // 注释与直觉都会错——Chromium 151 实测 date / time 的 `.select()` 静默无效（之后键入仍按段
  // 编辑），把它们当输入面就会吞掉 ⌘A 什么都不做。
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "input-type-probes";
    host.innerHTML = [
      '<input id="probe-number" type="number" value="123">',
      '<input id="probe-email" type="email" value="abc@x.com">',
      '<input id="probe-date" type="date" value="2026-11-26">',
      '<input id="probe-time" type="time" value="12:34">',
    ].join("");
    document.body.append(host);
  });

  // ① number：selectionStart 恒为 null，不能拿它判；判据是「⌘A 后键入整段替换」。
  await page.locator("#probe-number").focus();
  await installKeyLog(page);
  await page.keyboard.press("Meta+a");
  expect(await keyLog(page), "number 支持整值选中，⌘A 必须由本层接管").toEqual([{ prevented: true }]);
  expect(await page.locator("#probe-number").inputValue()).toBe("123");
  await page.keyboard.type("9");
  expect(
    await page.locator("#probe-number").inputValue(),
    "整段替换 = select() 真的生效（未选中时键入会得到 9123）",
  ).toBe("9");

  // ② email：与 number 同族（selectionStart 为 null、setSelectionRange 抛错，但 select() 生效）。
  await page.locator("#probe-email").focus();
  await installKeyLog(page);
  await page.keyboard.press("Meta+a");
  expect(await keyLog(page)).toEqual([{ prevented: true }]);
  await page.keyboard.type("9");
  expect(await page.locator("#probe-email").inputValue()).toBe("9");

  // ③ date / time：平台不支持整值选中——本层 MUST NOT 消费 ⌘A（落回平台，不能吞了什么都不做）。
  for (const [selector, value] of [
    ["#probe-date", "2026-11-26"],
    ["#probe-time", "12:34"],
  ] as const) {
    await page.locator(selector).focus();
    await installKeyLog(page);
    await page.keyboard.press("Meta+a");
    expect(await keyLog(page), `${selector} 不是整值可选的输入面，⌘A MUST NOT 被消费`).toEqual([
      { prevented: false },
    ]);
    expect(await page.locator(selector).inputValue(), "⌘A 不改变日期 / 时间控件的值").toBe(value);
  }

  expect(errors, "整条路径 MUST NOT 抛异常（select() 对任何 type 都不抛）").toEqual([]);
  await page.evaluate(() => document.getElementById("input-type-probes")?.remove());
});

test("合成 contenteditable：⌘A 选中该宿主内容（合同探针，不是产品面）", async ({ page }) => {
  await openDoc(page);
  // 产品当前的 contenteditable 只有编辑器与 composer 两处 CM 面（各自走 CM 选区）；这条探针
  // 证明合同的第四条分支（任意 contenteditable 宿主）真的可达——将来新增这类输入面不必再改分派。
  await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.id = "text-face-probe";
    probe.setAttribute("contenteditable", "true");
    probe.textContent = "PROBE-CONTENT";
    document.body.append(probe);
    probe.focus();
  });
  await installKeyLog(page);
  await page.keyboard.press("Meta+a");
  expect(await keyLog(page), "contenteditable 宿主上的 ⌘A 由统一分派接管").toEqual([{ prevented: true }]);
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  expect(selected).toBe("PROBE-CONTENT");
  await page.evaluate(() => document.getElementById("text-face-probe")?.remove());
});
