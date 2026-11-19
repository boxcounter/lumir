// tests/visual/scenes/text-clipboard-adversarial.spec.ts —— 真浏览器下的 Unicode / 选区 /
// 剪贴板对抗场景（M843）。
//
// 合同与 Node 层（tests/unit/text-unicode-adversarial.test.ts）同源：
//   - 字素删除：正文命令（⌃H / ⌃D）对 9 类簇整簇删除；原生 Backspace 的粒度是**引擎行为**
//     （下表按引擎分档钉住），任何路径都不得越界删到相邻文本或留下孤立代理项；
//   - 选区替换：粘贴替换源码区间恰好一次、caret 落在 from+insert.length，反向 / 跨行 /
//     跨 widget 选区同权，一次粘贴一个撤销步；
//   - 剪贴板优先级：正文 image 文件项 > text/plain（其次 uri-list；不解析 HTML），composer
//     image 文件项 > text/plain（其余一律不消费）；文件类不抢文本；
//   - 组合中粘贴：组合文本恰好提交一次、粘贴恰好追加一次，二者各自可撤销；
//   - 渲染不污染源码：选区跨过 live preview 的 replace 装饰后，替换结果必须是源码区间替换。
//
// 剪贴板一律用合成 DataTransfer + ClipboardEvent（不读、不写系统剪贴板）；图片字节是合成
// 1×1 PNG 魔数，不携带任何 vault 内容。
//
// 期望值来自 ../../unit/editing-oracle-model（独立模型，不 import 生产期望）。IME 用例走
// CDP `Input.imeSetComposition`（真引擎事件序），WebKit 项目内 skip——合成事件不能冒充原生 IME。
//
// 已登记的产品边界（finding 见 tests/visual/README.md 的「Unicode 字素边界」节）：
//   1. composer 的 ⌃H（`editor.delete-char-backward`）对肤色 / 职业 ZWJ / 组合标记 / RTL 附标
//      只退一个 CM 簇后缀，正文命令则整簇；
//   2. 原生 Backspace 对组合标记 / RTL 附标按码点退（Chromium 比 WebKit 更碎）；
//   3. 正文在 HTML-only 剪贴板（无 text/plain）且有选区时会删掉选区（CM doPaste("") 的降级）。
//   前两条用「第一拍基线 + 重复到整簇」钉住；第三条只在折叠 caret 上断言空操作，不把数据丢失
//   写成合同。

import { expect, test as baseTest, type Page } from "@playwright/test";

type BrowserName = "chromium" | "firefox" | "webkit";
import {
  guardPageChannel,
  harnessImageWrites,
  stubTauri,
  type VaultFixture,
} from "./tauri-stub";
import { standardProviders } from "./provider-config";
import {
  BodyOracle,
  ComposerOracle,
  formatOracleFailure,
  makeRng,
  pickOne,
  rngInt,
} from "../../unit/editing-oracle-model";

const pageTest = (name: string, body: (page: Page, browserName: BrowserName) => Promise<void>): void => {
  baseTest(name, async ({ page, browserName }, testInfo) => {
    await guardPageChannel(page, (target) => body(target, browserName), { testInfo });
  });
};

function vaultWith(path: string, text: string): VaultFixture {
  return {
    entries: [{ path, kind: "file", size: text.length, mtime_ms: 0 }],
    files: { [path]: text },
    links: {},
  };
}

interface EditorReading {
  doc: string;
  anchor: number;
  head: number;
}

async function openBody(page: Page, path: string, doc: string): Promise<void> {
  await stubTauri(page, vaultWith(path, doc));
  await page.goto("/");
  await page.locator(`.ft-row[title="${path}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(path);
}

/** 正文 + 图片落盘桩：init script 必须排在 stubTauri 之后（后注册的包装器包住它的 invoke）。 */
async function openBodyWithWrites(page: Page, path: string, doc: string): Promise<void> {
  await stubTauri(page, vaultWith(path, doc));
  await stubPasteWrites(page);
  await page.goto("/");
  await page.locator(`.ft-row[title="${path}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(path);
}

async function bodyState(page: Page): Promise<EditorReading> {
  return page.locator(".cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const main = view.state.selection.main;
    return { doc: view.state.doc.toString(), anchor: main.anchor, head: main.head };
  });
}

async function setBodySelection(page: Page, anchor: number, head = anchor): Promise<void> {
  await page.locator(".cm-content").evaluate((el, range) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.focus();
    view.dispatch({ selection: { anchor: range.anchor, head: range.head } });
  }, { anchor, head });
}

interface ClipPayload {
  text?: string;
  /** Markdown 源码的显式 MIME（`text/markdown`）；与 `text`（`text/plain`）互斥设置。 */
  markdown?: string;
  html?: string;
  uri?: string;
  image?: { type: string; bytes: number[] };
  file?: { name: string; type: string; text: string };
}

/** 合成 paste 事件（不碰系统剪贴板）；返回事件是否被消费（defaultPrevented）。 */
async function dispatchPaste(page: Page, selector: string, payload: ClipPayload): Promise<boolean> {
  return page.locator(selector).evaluate((el, p) => {
    const dt = new DataTransfer();
    if (p.text !== undefined) dt.setData("text/plain", p.text);
    if (p.markdown !== undefined) dt.setData("text/markdown", p.markdown);
    if (p.html !== undefined) dt.setData("text/html", p.html);
    if (p.uri !== undefined) dt.setData("text/uri-list", p.uri);
    if (p.image !== undefined) {
      dt.items.add(new File([new Uint8Array(p.image.bytes)], "clip.png", { type: p.image.type }));
    }
    if (p.file !== undefined) {
      dt.items.add(new File([p.file.text], p.file.name, { type: p.file.type }));
    }
    const event = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  }, payload);
}

interface DropPayload {
  pos: number;
  text?: string;
  /** Markdown 源码的显式 MIME；与 `text` 互斥设置。 */
  markdown?: string;
  html?: string;
  file?: { name: string; type: string; text: string };
}

/** 合成 drop 事件：落点由 `coordsAtPos(pos)` 给出（与 README「指针选中端点由文本几何给出」同口径）。
 *  返回事件是否被产品消费（defaultPrevented）。注意合成事件只走产品 JS 处理器，不触发浏览器
 *  原生 drag-drop 默认动作——HTML-only 的「原生默认」边界在 README 里单列。 */
async function dispatchDrop(page: Page, selector: string, payload: DropPayload): Promise<boolean> {
  return page.locator(selector).evaluate((el, p) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const coords = view.coordsAtPos(p.pos);
    const dt = new DataTransfer();
    if (p.text !== undefined) dt.setData("text/plain", p.text);
    if (p.markdown !== undefined) dt.setData("text/markdown", p.markdown);
    if (p.html !== undefined) dt.setData("text/html", p.html);
    if (p.file !== undefined) dt.items.add(new File([p.file.text], p.file.name, { type: p.file.type }));
    const event = new DragEvent("drop", {
      dataTransfer: dt,
      bubbles: true,
      cancelable: true,
      clientX: coords.left + 1,
      clientY: (coords.top + coords.bottom) / 2,
    });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  }, payload);
}

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function stubPasteWrites(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    w.__pastedImageWrites = [];
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: any) => any;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (cmd === "fs_write_attachment") {
        w.__pastedImageWrites.push(args);
        return { path: `${args.dir_rel}/pasted-0123456789abcdef.webp`, name: "pasted-0123456789abcdef.webp", fresh: true };
      }
      if (cmd === "attachment_semantic_name") {
        return { status: "skipped", path: args?.path ?? "", new_name: null, undo_token: null, renamed_refs: [] };
      }
      return invoke(cmd, args);
    };
  });
}

interface PastedImageWrite {
  dir_rel?: string;
  data_base64?: string;
  source_mime?: string;
}

async function pastedImageWrites(page: Page): Promise<PastedImageWrite[]> {
  return page.evaluate(
    () => (window as unknown as { __pastedImageWrites?: PastedImageWrite[] }).__pastedImageWrites ?? [],
  );
}

const QUOTE_CARD = {
  kind: "quote" as const,
  card: { file: "synthetic.md", heading: "合成", headingPath: "合成", lines: "1-1", text: "引用原文" },
};

async function openComposer(
  page: Page,
  text: string,
  caret: number,
  cards: unknown[] = [],
): Promise<void> {
  await stubTauri(page, vaultWith("oracle.md", "composer fixture\n"));
  await page.addInitScript(
    (payload) => {
      const w = window as unknown as Record<string, any>;
      w.__sentMessages = [];
      const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
      w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => {
        if (cmd === "harness_send") {
          w.__sentMessages.push((args as { parts_json: string }).parts_json);
          return null;
        }
        if (cmd === "harness_draft_get") return JSON.stringify(payload.draft);
        if (cmd === "harness_draft_put") return null;
        if (cmd === "harness_state") {
          return JSON.stringify({ messages: [], usage: { ctx_pct: 0, cache_pct_session: 0 }, pending_approval: null, warn_ctx_pct: 85 });
        }
        if (cmd === "config_get") {
          const result: any = await invoke(cmd, args);
          if (result?.config) {
            result.config.harness = {
              provider: "mock",
              providers: (payload as { providers: unknown }).providers,
              permissions: { allow: [], deny: [] },
              loop_max: 8,
              warn_ctx_pct: 85,
              auto_compact: true,
            };
          }
          return result;
        }
        return invoke(cmd, args);
      };
    },
    { draft: { version: 2, text, caret, cards }, providers: standardProviders() },
  );
  await page.goto("/");
  await page.locator('.ft-row[title="oracle.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect.poll(async () => (await composerState(page)).doc).toBe(text);
  await expect(page.locator(".lumir-hp-composer-tray > .lumir-hp-qcard")).toHaveCount(cards.length);
}

async function composerState(page: Page): Promise<EditorReading> {
  return page.locator(".lumir-hp-composer .cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const main = view.state.selection.main;
    return { doc: view.state.doc.toString(), anchor: main.anchor, head: main.head };
  });
}

async function setComposerSelection(page: Page, anchor: number, head = anchor): Promise<void> {
  await page.locator(".lumir-hp-composer .cm-content").evaluate((el, range) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.focus();
    view.dispatch({ selection: { anchor: range.anchor, head: range.head } });
  }, { anchor, head });
}

const composerTray = (page: Page) => page.locator(".lumir-hp-composer-tray > .lumir-hp-qcard");
const bodySelector = ".cm-content";
const composerSelector = ".lumir-hp-composer .cm-content";

function fail(step: number, op: string, before: unknown, expected: unknown, actual: unknown): never {
  throw new Error(
    formatOracleFailure({
      seed: 0,
      step,
      op,
      before: JSON.stringify(before),
      expected: JSON.stringify(expected),
      actual: JSON.stringify(actual),
    }),
  );
}

function assertNoLoneSurrogates(text: string, label: string): void {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      expect(next, `${label}: 孤立高代理项 @${index}`).toBeGreaterThanOrEqual(0xdc00);
      expect(next, `${label}: 孤立高代理项 @${index}`).toBeLessThanOrEqual(0xdfff);
      index += 1;
    } else {
      expect(code >= 0xdc00 && code <= 0xdfff, `${label}: 孤立低代理项 @${index}`).toBe(false);
    }
  }
}

// ---------------------------------------------------------------------------
// 字素簇语料（与 Node 层同一张表；加类时两处同步）
// ---------------------------------------------------------------------------

interface ClusterCase {
  name: string;
  prefix: string;
  cluster: string;
  suffix: string;
}

const CLUSTERS: ClusterCase[] = [
  { name: "ZWJ 家庭", prefix: "a", cluster: "👨‍👩‍👧‍👦", suffix: "b" },
  { name: "国旗", prefix: "x", cluster: "🇯🇵", suffix: "y" },
  { name: "肤色修饰", prefix: "x", cluster: "👍🏽", suffix: "y" },
  { name: "职业 ZWJ + 肤色", prefix: "x", cluster: "👩🏽‍🚀", suffix: "y" },
  { name: "组合重音", prefix: "x", cluster: "e\u0301\u0323", suffix: "y" },
  { name: "变体选择符", prefix: "x", cluster: "❤\uFE0F", suffix: "y" },
  { name: "代理对", prefix: "引", cluster: "𠀀", suffix: "言" },
  { name: "阿拉伯文附标", prefix: "A ", cluster: "مَ", suffix: " B" },
  { name: "希伯来文附标", prefix: "A ", cluster: "שָׁ", suffix: " B" },
];

const clusterDoc = (c: ClusterCase) => c.prefix + c.cluster + c.suffix;
const clusterEnd = (c: ClusterCase) => c.prefix.length + c.cluster.length;
const removed = (c: ClusterCase) => c.prefix + c.suffix;

/** composer 的 ⌃H 第一拍剩余（CM `deleteCharBackward` 的当前边界；与 Node 层
 * `COMPOSER_BACKWARD_REMAINING` 同表，改动需两处同步）。finding 修复后全表应变空。 */
const COMPOSER_BACKWARD_REMAINING: Record<string, string> = {
  "ZWJ 家庭": "",
  "国旗": "",
  "肤色修饰": "👍",
  "职业 ZWJ + 肤色": "👩",
  "组合重音": "e\u0301",
  "变体选择符": "",
  "代理对": "",
  "阿拉伯文附标": "م",
  "希伯来文附标": "שָ",
};

// ---------------------------------------------------------------------------
// 一、原生 Backspace 的引擎基线（组合标记 / RTL 附标按码点退）
// ---------------------------------------------------------------------------

/** 首次按压后是否整簇删除（2026-11-19 双引擎实测；引擎升级会让本表变红，按实测更新）。 */
const NATIVE_FIRST_STEP: Record<"chromium" | "webkit", Record<string, "full" | "partial">> = {
  chromium: { 肤色修饰: "full", 组合重音: "partial", 阿拉伯文附标: "partial", 希伯来文附标: "partial", "ZWJ 家庭": "full" },
  webkit: { 肤色修饰: "full", 组合重音: "full", 阿拉伯文附标: "partial", 希伯来文附标: "partial", "ZWJ 家庭": "full" },
};

const NATIVE_CASES = CLUSTERS.filter((c) => c.name in NATIVE_FIRST_STEP.chromium);

pageTest("原生 Backspace：引擎基线（正文 + composer）+ 重复到整簇 + 撤销", async (page, browserName) => {
  const engine = browserName === "webkit" ? "webkit" : "chromium";
  const table = NATIVE_FIRST_STEP[engine];
  for (const c of NATIVE_CASES) {
    const doc = clusterDoc(c);
    const expectedFull = removed(c);
    const firstStep = table[c.name]!;
    for (const surface of ["body", "composer"] as const) {
      const open = surface === "body" ? () => openBody(page, "probe.md", doc) : () => openComposer(page, doc, clusterEnd(c));
      const state = surface === "body" ? () => bodyState(page) : () => composerState(page);
      const selector = surface === "body" ? bodySelector : composerSelector;

      await open();
      if (surface === "composer") await page.locator(selector).click();
      await (surface === "body" ? setBodySelection(page, clusterEnd(c)) : setComposerSelection(page, clusterEnd(c)));
      await page.keyboard.press("Backspace");
      await expect.poll(async () => (await state()).doc, { message: `${engine}/${surface}/${c.name}: 第一拍未落地` }).not.toBe(doc);
      const afterFirst = await state();

      if (firstStep === "full") {
        expect(afterFirst.doc, `${engine}/${surface}/${c.name}: 引擎基线（整簇）`).toBe(expectedFull);
      } else {
        const partial = c.prefix + [...c.cluster].slice(0, -1).join("") + c.suffix;
        expect(afterFirst.doc, `${engine}/${surface}/${c.name}: 引擎基线（一个码点）`).toBe(partial);
        expect(afterFirst.doc, `${engine}/${surface}/${c.name}: 部分删除必须与整簇可分`).not.toBe(expectedFull);
      }
      assertNoLoneSurrogates(afterFirst.doc, `${engine}/${surface}/${c.name}: 第一拍`);

      // 反复按压：每一步只能吞掉簇的一个真后缀，最终恰好等于 prefix+suffix，不得越界。
      const firstRest = afterFirst.doc.slice(c.prefix.length, afterFirst.doc.length - c.suffix.length);
      expect(c.cluster.startsWith(firstRest), `${engine}/${surface}/${c.name}: 第一拍不是簇的前缀删除`).toBe(true);
      let previousLength = [...c.cluster].length;
      let guard = 0;
      while ((await state()).doc !== expectedFull) {
        guard += 1;
        expect(guard, `${engine}/${surface}/${c.name}: 重复 Backspace 未收敛`).toBeLessThan(16);
        const current = (await state()).doc;
        expect(current.startsWith(c.prefix) && current.endsWith(c.suffix), `${engine}/${surface}/${c.name}: 删到簇外 ${JSON.stringify(current)}`).toBe(true);
        const rest = current.slice(c.prefix.length, current.length - c.suffix.length);
        expect(c.cluster.startsWith(rest), `${engine}/${surface}/${c.name}: 中间态必须是簇的前缀（${JSON.stringify(rest)}）`).toBe(true);
        const restLength = [...rest].length;
        expect(restLength, `${engine}/${surface}/${c.name}: 每一拍必须严格缩短剩余簇`).toBeLessThan(previousLength);
        expect(restLength, `${engine}/${surface}/${c.name}: 簇已删尽但未到期望`).toBeGreaterThan(0);
        previousLength = restLength;
        await page.keyboard.press("Backspace");
      }
      expect((await state()).doc).toBe(expectedFull);

      // 撤销直到原文：中间不可停在与原文不同的状态（历史不得丢步）。
      let undoGuard = 0;
      while ((await state()).doc !== doc) {
        undoGuard += 1;
        expect(undoGuard, `${engine}/${surface}/${c.name}: 撤销未回到原文`).toBeLessThan(16);
        await page.waitForTimeout(20);
        await page.keyboard.press("Meta+z");
      }
      expect((await state()).doc).toBe(doc);
      await page.keyboard.press("Meta+z");
      expect((await state()).doc, `${engine}/${surface}/${c.name}: 多撤一拍不得改变已到顶的文档`).toBe(doc);
    }
  }
});

// ---------------------------------------------------------------------------
// 二、正文命令（⌃H / ⌃D）：9 类簇整簇删除（双引擎）
// ---------------------------------------------------------------------------

pageTest("正文 ⌃H：9 类簇整簇删除 + caret 落删除起点 + 撤销", async (page) => {
  for (const c of CLUSTERS) {
    await openBody(page, "probe.md", clusterDoc(c));
    await setBodySelection(page, clusterEnd(c));
    await page.keyboard.press("Control+h");
    await expect.poll(async () => (await bodyState(page)).doc, { message: `${c.name}: ⌃H` }).toBe(removed(c));
    expect((await bodyState(page)).head, `${c.name}: caret 落删除起点`).toBe(c.prefix.length);
    await page.keyboard.press("Meta+z");
    await expect.poll(async () => (await bodyState(page)).doc, { message: `${c.name}: ⌃H undo` }).toBe(clusterDoc(c));
  }
});

pageTest("正文 ⌃D：9 类簇整簇前删 + 撤销", async (page) => {
  for (const c of CLUSTERS) {
    await openBody(page, "probe.md", clusterDoc(c));
    await setBodySelection(page, c.prefix.length);
    await page.keyboard.press("Control+d");
    await expect.poll(async () => (await bodyState(page)).doc, { message: `${c.name}: ⌃D` }).toBe(removed(c));
    expect((await bodyState(page)).head, `${c.name}: caret 停在删除起点`).toBe(c.prefix.length);
    await page.keyboard.press("Meta+z");
    await expect.poll(async () => (await bodyState(page)).doc, { message: `${c.name}: ⌃D undo` }).toBe(clusterDoc(c));
  }
});

// ---------------------------------------------------------------------------
// 三、composer 命令：⌃D 整簇；⌃H 的当前边界（finding 钉住）+ 重复到整簇 + 附件
// ---------------------------------------------------------------------------

pageTest("composer ⌃D：9 类簇整簇前删 + 撤销 + 附件不动", async (page) => {
  for (const c of CLUSTERS) {
    await openComposer(page, clusterDoc(c), c.prefix.length, [QUOTE_CARD]);
    await page.locator(composerSelector).click();
    await setComposerSelection(page, c.prefix.length);
    await page.keyboard.press("Control+d");
    await expect.poll(async () => (await composerState(page)).doc, { message: `${c.name}: ⌃D` }).toBe(removed(c));
    await expect(composerTray(page)).toHaveCount(1);
    await page.keyboard.press("Meta+z");
    await expect.poll(async () => (await composerState(page)).doc, { message: `${c.name}: ⌃D undo` }).toBe(clusterDoc(c));
  }
});

pageTest("composer ⌃H：5 类部分退（finding）+ 重复到整簇 + 撤销回原文 + 附件不动", async (page) => {
  for (const c of CLUSTERS) {
    const remaining = COMPOSER_BACKWARD_REMAINING[c.name]!;
    expect(remaining.length, `${c.name}: 表项必须是簇的真前缀`).toBeLessThan(c.cluster.length);
    await openComposer(page, clusterDoc(c), clusterEnd(c), [QUOTE_CARD]);
    await page.locator(composerSelector).click();
    await setComposerSelection(page, clusterEnd(c));
    await page.keyboard.press("Control+h");
    const expectedFirst = c.prefix + remaining + c.suffix;
    await expect.poll(async () => (await composerState(page)).doc, { message: `${c.name}: ⌃H 第一拍` }).toBe(expectedFirst);
    if (remaining !== "") {
      expect(expectedFirst, `${c.name}: 部分删除必须与整簇删除可分`).not.toBe(removed(c));
    }
    await expect(composerTray(page)).toHaveCount(1);

    let guard = 0;
    while ((await composerState(page)).doc !== removed(c)) {
      guard += 1;
      expect(guard, `${c.name}: 重复 ⌃H 未收敛`).toBeLessThan(16);
      const current = (await composerState(page)).doc;
      expect(current.startsWith(c.prefix) && current.endsWith(c.suffix), `${c.name}: 删到簇外 ${JSON.stringify(current)}`).toBe(true);
      expect(c.cluster.includes(current.slice(c.prefix.length, current.length - c.suffix.length)), `${c.name}: 中间态必须是簇的前缀`).toBe(true);
      await page.keyboard.press("Control+h");
    }
    await expect(composerTray(page)).toHaveCount(1, { timeout: 2000 });

    let undoGuard = 0;
    while ((await composerState(page)).doc !== clusterDoc(c)) {
      undoGuard += 1;
      expect(undoGuard, `${c.name}: 撤销未回到原文`).toBeLessThan(16);
      await page.waitForTimeout(20);
      await page.keyboard.press("Meta+z");
    }
    expect((await composerState(page)).doc).toBe(clusterDoc(c));
    await expect(composerTray(page)).toHaveCount(1);
  }
});

// ---------------------------------------------------------------------------
// 四、选区替换：反向 / 跨行 / 跨 widget（正文）与 composer
// ---------------------------------------------------------------------------

const WIDGET_DOC = "alpha\n- item [[note]]\n$x$\n**bold**\n";

pageTest("正文跨 widget 选区粘贴：源码区间精确替换，渲染字形不入源码", async (page) => {
  const cases = [
    { name: "跨 list marker 与 wikilink（反向）", anchor: WIDGET_DOC.indexOf("**bold**") + 2, head: 3, text: "P" },
    { name: "跨行多行粘贴", anchor: WIDGET_DOC.indexOf("item"), head: WIDGET_DOC.indexOf("$x$") + 2, text: "月\n火" },
    { name: "整段选区", anchor: WIDGET_DOC.length, head: 0, text: "" },
  ];
  for (const c of cases) {
    await openBody(page, "probe.md", WIDGET_DOC);
    // 正观测：这一格必须真的渲染了 replace 装饰，否则测不到「渲染不污染源码」。
    for (const selector of [".cm-lp-list-marker", ".cm-lp-wikilink", ".cm-lp-math-inline", ".cm-lp-strong"]) {
      await expect.poll(async () => page.locator(selector).count(), { message: `${c.name}: ${selector} 未渲染` }).toBeGreaterThan(0);
    }
    const model = new BodyOracle(WIDGET_DOC);
    model.setSelection(c.anchor, c.head);
    model.insert(c.text);
    const expected = { doc: model.doc, anchor: model.anchor, head: model.head };

    await setBodySelection(page, c.anchor, c.head);
    await dispatchPaste(page, bodySelector, { text: c.text });
    await expect.poll(async () => (await bodyState(page)).doc, { message: `${c.name}: 粘贴结果` }).toBe(expected.doc);
    const actual = await bodyState(page);
    if (actual.head !== expected.head) fail(0, c.name, WIDGET_DOC, expected, actual);
    // 渲染字形（列表的 –/•、wikilink label 等）不得以任何形式进入源码。
    expect(actual.doc.includes("\u2022") || actual.doc.includes("\u2013"), `${c.name}: 渲染字形入源码`).toBe(false);

    await page.waitForTimeout(620);
    await page.keyboard.press("Meta+z");
    await expect.poll(async () => (await bodyState(page)).doc, { message: `${c.name}: undo` }).toBe(WIDGET_DOC);
    for (const selector of [".cm-lp-list-marker", ".cm-lp-wikilink"]) {
      await expect.poll(async () => page.locator(selector).count()).toBeGreaterThan(0);
    }
  }
});

pageTest("正文反向选区粘贴：caret 落在 from+insert.length，一次撤销步", async (page) => {
  const doc = "alpha beta";
  await openBody(page, "probe.md", doc);
  const anchor = 10;
  const head = 4;
  await setBodySelection(page, anchor, head);
  const model = new BodyOracle(doc);
  model.setSelection(anchor, head);
  model.insert("Ω");
  await dispatchPaste(page, bodySelector, { text: "Ω" });
  await expect.poll(async () => (await bodyState(page)).doc).toBe(model.doc);
  const actual = await bodyState(page);
  expect({ anchor: actual.anchor, head: actual.head }).toEqual({ anchor: model.anchor, head: model.head });
  await page.waitForTimeout(620);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await bodyState(page)).doc).toBe(doc);
  expect((await bodyState(page)).anchor).toBe(anchor);
  expect((await bodyState(page)).head).toBe(head);
});

pageTest("composer 反向选区粘贴：附件不动、一次撤销恢复文本与方向", async (page) => {
  const doc = "甲乙丙丁";
  await openComposer(page, doc, 0, [QUOTE_CARD]);
  await page.locator(composerSelector).click();
  await setComposerSelection(page, 3, 1);
  const model = new ComposerOracle({ text: doc, caret: 0 });
  model.setSelection(3, 1);
  model.insert("🙂");
  await dispatchPaste(page, composerSelector, { text: "🙂" });
  await expect.poll(async () => (await composerState(page)).doc).toBe(model.text);
  expect((await composerState(page)).head).toBe(model.head);
  await expect(composerTray(page)).toHaveCount(1);

  await page.waitForTimeout(1100);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await composerState(page)).doc).toBe(doc);
  expect({ anchor: (await composerState(page)).anchor, head: (await composerState(page)).head }).toEqual({ anchor: 3, head: 1 });
  await expect(composerTray(page)).toHaveCount(1);
  // 再撤一拍：初始化不在 history 里，附件与文本都不得被撤掉。
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await composerState(page)).doc).toBe(doc);
  await expect(composerTray(page)).toHaveCount(1);
});

// ---------------------------------------------------------------------------
// 五、粘贴优先级：正文（图 > 文本；plain > HTML；uri-list 降级；文件不抢）
// ---------------------------------------------------------------------------

pageTest("正文粘贴优先级：plain 压过 HTML、uri-list 降级、非图片文件不抢文本", async (page) => {
  // text/plain 压过 text/html（CM 只读 text/plain；HTML 不参与）。
  await openBodyWithWrites(page, "probe.md", "alpha\nbeta\n");
  await setBodySelection(page, 3);
  await dispatchPaste(page, bodySelector, { text: "PLAIN", html: "<b>HTML</b>" });
  await expect.poll(async () => (await bodyState(page)).doc).toBe("alpPLAINha\nbeta\n");
  expect((await bodyState(page)).head).toBe(8);
  await page.waitForTimeout(620);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await bodyState(page)).doc).toBe("alpha\nbeta\n");

  // 无 text/plain 时 CM 退 text/uri-list（产品现状；composer 不读 uri-list，见下一条）。
  await openBody(page, "probe.md", "alpha\n");
  await setBodySelection(page, 3);
  await dispatchPaste(page, bodySelector, { uri: "https://example.invalid/x" });
  await expect.poll(async () => (await bodyState(page)).doc).toBe("alphttps://example.invalid/xha\n");

  // 非图片文件项不抢文本粘贴。
  await openBodyWithWrites(page, "probe.md", "alpha\n");
  await setBodySelection(page, 3);
  await dispatchPaste(page, bodySelector, { text: "PLAIN", file: { name: "a.pdf", type: "application/pdf", text: "PDF" } });
  await expect.poll(async () => (await bodyState(page)).doc).toBe("alpPLAINha\n");
  expect(await pastedImageWrites(page)).toEqual([]);

  // 只有文件 / 只有 HTML：折叠 caret 上都是空操作（不得改文档；HTML 有选区的删除另见 README 的边界）。
  await openBody(page, "probe.md", "alpha\n");
  await setBodySelection(page, 3);
  await dispatchPaste(page, bodySelector, { file: { name: "a.pdf", type: "application/pdf", text: "PDF" } });
  await page.waitForTimeout(60);
  expect((await bodyState(page)).doc).toBe("alpha\n");
  await setBodySelection(page, 3);
  await dispatchPaste(page, bodySelector, { html: "<b>ONLYHTML</b>" });
  await page.waitForTimeout(60);
  expect((await bodyState(page)).doc).toBe("alpha\n");
});

pageTest("正文图片粘贴：图优先、恰好一次落盘、引用替换选区、文本不入", async (page) => {
  const name = "pasted-0123456789abcdef.webp";

  // caret：引用被顶成独立一行。
  await openBodyWithWrites(page, "probe.md", "alpha\nbeta\n");
  await setBodySelection(page, 2);
  await dispatchPaste(page, bodySelector, { text: "TEXTSHOULDNOT", image: { type: "image/png", bytes: PNG_BYTES } });
  await expect.poll(async () => (await bodyState(page)).doc).toBe(`al\n![[${name}]]\npha\nbeta\n`);
  const writes = await pastedImageWrites(page);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ dir_rel: "", source_mime: "image/png" });
  expect((await bodyState(page)).doc.includes("TEXTSHOULDNOT")).toBe(false);
  expect((await bodyState(page)).head).toBe(2 + `\n![[${name}]]\n`.length);
  await page.waitForTimeout(620);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await bodyState(page)).doc).toBe("alpha\nbeta\n");

  // 有选区：引用替换选区，两端仍独立成行。
  await openBodyWithWrites(page, "probe.md", "alpha\nbeta\n");
  await setBodySelection(page, 2, 8);
  await dispatchPaste(page, bodySelector, { text: "TEXTSHOULDNOT", image: { type: "image/png", bytes: PNG_BYTES } });
  await expect.poll(async () => (await bodyState(page)).doc).toBe(`al\n![[${name}]]\nta\n`);
  expect((await pastedImageWrites(page)).length).toBe(1);
});

// ---------------------------------------------------------------------------
// 六、粘贴优先级：composer（图 > 文本；只读 text/plain；其余不消费）
// ---------------------------------------------------------------------------

pageTest("composer 粘贴优先级：plain 压过 HTML，uri-list/HTML-only/文件项都不消费", async (page) => {
  await openComposer(page, "alpha", 2, [QUOTE_CARD]);
  await page.locator(composerSelector).click();
  await setComposerSelection(page, 2);
  const preventedText = await dispatchPaste(page, composerSelector, { text: "PLAIN", html: "<b>HTML</b>" });
  expect(preventedText).toBe(true);
  await expect.poll(async () => (await composerState(page)).doc).toBe("alPLAINpha");
  await expect(composerTray(page)).toHaveCount(1);

  await openComposer(page, "alpha", 2, [QUOTE_CARD]);
  await page.locator(composerSelector).click();
  await setComposerSelection(page, 2);
  const preventedUri = await dispatchPaste(page, composerSelector, { uri: "https://example.invalid/x" });
  expect(preventedUri).toBe(true);
  await page.waitForTimeout(40);
  expect((await composerState(page)).doc).toBe("alpha");

  await openComposer(page, "alpha", 2, [QUOTE_CARD]);
  await page.locator(composerSelector).click();
  await setComposerSelection(page, 2);
  const preventedHtml = await dispatchPaste(page, composerSelector, { html: "<b>ONLYHTML</b>" });
  expect(preventedHtml).toBe(true);
  await page.waitForTimeout(40);
  expect((await composerState(page)).doc).toBe("alpha");

  await openComposer(page, "alpha", 2, [QUOTE_CARD]);
  await page.locator(composerSelector).click();
  await setComposerSelection(page, 2);
  const preventedFile = await dispatchPaste(page, composerSelector, { file: { name: "a.pdf", type: "application/pdf", text: "PDF" } });
  expect(preventedFile).toBe(true);
  await page.waitForTimeout(40);
  expect((await composerState(page)).doc).toBe("alpha");
  expect(await harnessImageWrites(page)).toEqual([]);
});

pageTest("composer 图片粘贴：进 tray、一次落盘、文本不入、可撤销", async (page) => {
  await openComposer(page, "alpha", 2, [QUOTE_CARD]);
  await page.locator(composerSelector).click();
  await setComposerSelection(page, 2);
  const prevented = await dispatchPaste(page, composerSelector, { text: "TEXTSHOULDNOT", image: { type: "image/png", bytes: PNG_BYTES } });
  expect(prevented).toBe(true);
  await expect(composerTray(page)).toHaveCount(2);
  const writes = await harnessImageWrites(page);
  expect(writes).toHaveLength(1);
  expect(writes[0]?.source_mime).toBe("image/png");
  expect((await composerState(page)).doc).toBe("alpha");
  expect((await composerState(page)).doc.includes("TEXTSHOULDNOT")).toBe(false);

  await page.waitForTimeout(1100);
  await page.keyboard.press("Meta+z");
  await expect(composerTray(page)).toHaveCount(1);
  expect((await composerState(page)).doc).toBe("alpha");
});

// ---------------------------------------------------------------------------
// 七、拖放：正文支持文本与文本文件、图片文件被过滤；composer 只取 text/plain
// ---------------------------------------------------------------------------

pageTest("正文 drop：文本 / 文本文件插入一次且选中插入段；图片文件不产生垃圾", async (page) => {
  const doc = "alpha\nbeta\n";
  const text = " DROP ";
  await openBody(page, "probe.md", doc);
  await dispatchDrop(page, bodySelector, { pos: 3, text });
  await expect.poll(async () => (await bodyState(page)).doc).not.toBe(doc);
  const afterText = await bodyState(page);
  const at = afterText.anchor;
  expect(afterText.doc).toBe(doc.slice(0, at) + text + doc.slice(at));
  expect({ anchor: afterText.anchor, head: afterText.head }).toEqual({ anchor: at, head: at + text.length });
  expect(at <= doc.indexOf("\n")).toBe(true);
  await page.waitForTimeout(620);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await bodyState(page)).doc).toBe(doc);

  // 文本文件 drop：CM 用 FileReader 读文本（异步），插入一次。
  await openBody(page, "probe.md", doc);
  await dispatchDrop(page, bodySelector, { pos: 3, file: { name: "a.txt", type: "text/plain", text: "FILETEXT" } });
  await expect.poll(async () => (await bodyState(page)).doc).toBe("alpFILETEXTha\nbeta\n");

  // 图片文件 drop：二进制控制字符被 CM 过滤，源码不得出现垃圾；正面观测量用上面的文本文件。
  await openBodyWithWrites(page, "probe.md", doc);
  await dispatchDrop(page, bodySelector, { pos: 3, file: { name: "a.png", type: "image/png", text: "\u0000\u0001PNG\u0002" } });
  await page.waitForTimeout(300);
  expect((await bodyState(page)).doc).toBe(doc);
  expect(await pastedImageWrites(page)).toEqual([]);
});

pageTest("composer drop：文本按落点插入、文件/图片不消费", async (page) => {
  const doc = "alphabeta";
  await openComposer(page, doc, 5, [QUOTE_CARD]);
  await page.locator(composerSelector).click();
  await setComposerSelection(page, 5);
  await dispatchDrop(page, composerSelector, { pos: 2, text: " DROP " });
  const afterDrop = await composerState(page);
  const at = afterDrop.head - " DROP ".length;
  expect(afterDrop.doc).toBe(doc.slice(0, at) + " DROP " + doc.slice(at));
  expect(afterDrop.head).toBe(at + " DROP ".length);
  await expect(composerTray(page)).toHaveCount(1);
  await page.waitForTimeout(1100);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await composerState(page)).doc).toBe(doc);

  // 文件（含图片）drop：composer 处理器只读 text/plain ⇒ 不消费、不落盘、不加卡片。
  for (const payload of [
    { name: "a.txt", type: "text/plain", text: "FILETEXT" },
    { name: "a.png", type: "image/png", text: "\u0000\u0001PNG\u0002" },
  ]) {
    await openComposer(page, doc, 5, [QUOTE_CARD]);
    await page.locator(composerSelector).click();
    await setComposerSelection(page, 5);
    await dispatchDrop(page, composerSelector, { pos: 2, file: payload });
    await page.waitForTimeout(60);
    expect((await composerState(page)).doc).toBe(doc);
    await expect(composerTray(page)).toHaveCount(1);
  }
  expect(await harnessImageWrites(page)).toEqual([]);
});

// ---------------------------------------------------------------------------
// 八、IME 组合中粘贴（CDP 真引擎；WebKit skip）
// ---------------------------------------------------------------------------

pageTest("IME 组合中粘贴：组合文本提交一次、粘贴追加一次、两拍各自可撤销", async (page, browserName) => {
  baseTest.skip(browserName !== "chromium", "CDP 只存在于 Chromium；WebKit 合成事件不能冒充原生 IME");

  // 正文
  await openBody(page, "probe.md", "我\n");
  await page.locator(bodySelector).click();
  await setBodySelection(page, 1);
  const bodyCdp = await page.context().newCDPSession(page);
  await bodyCdp.send("Input.imeSetComposition", { text: "shi", selectionStart: 3, selectionEnd: 3, replacementStart: 1, replacementEnd: 1 });
  await expect.poll(async () => (await bodyState(page)).doc).toBe("我shi\n");
  await dispatchPaste(page, bodySelector, { text: "PASTE" });
  await expect.poll(async () => (await bodyState(page)).doc).toBe("我shiPASTE\n");
  expect((await bodyState(page)).head).toBe(9);
  await page.waitForTimeout(620);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await bodyState(page)).doc).toBe("我shi\n");
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await bodyState(page)).doc).toBe("我\n");

  // composer
  await openComposer(page, "我", 1, [QUOTE_CARD]);
  await page.locator(composerSelector).click();
  await setComposerSelection(page, 1);
  const composerCdp = await page.context().newCDPSession(page);
  await composerCdp.send("Input.imeSetComposition", { text: "shi", selectionStart: 3, selectionEnd: 3, replacementStart: 1, replacementEnd: 1 });
  await expect.poll(async () => (await composerState(page)).doc).toBe("我shi");
  await dispatchPaste(page, composerSelector, { text: "PASTE" });
  await expect.poll(async () => (await composerState(page)).doc).toBe("我shiPASTE");
  expect((await composerState(page)).head).toBe(9);
  await expect(composerTray(page)).toHaveCount(1);
  await page.waitForTimeout(1100);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await composerState(page)).doc).toBe("我shi");
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await composerState(page)).doc).toBe("我");
  expect(await page.evaluate(() => (window as unknown as { __sentMessages: string[] }).__sentMessages)).toEqual([]);
});

// ---------------------------------------------------------------------------
// 九、固定 seed 随机序列：Unicode 粘贴 / 反向 & 跨行选区 / 快速 undo-redo
// ---------------------------------------------------------------------------

// 只用「原生 Backspace / Delete 双引擎都整簇」的类：部分删除的 5 类由第三、四节的有向表钉住，
// 随机序列混入它们会让模型（完整字素）与引擎边界互相污染。
// 不含空格：行首缩进会让 CM 的 deleteCharBackward 走 indentUnit 分支，与「单字素」模型不同口径。
const SAFE_ALPHABET = ["a", "问", "👨‍👩‍👧‍👦", "🇯🇵", "𠀀", "\n"] as const;

type BrowserOp =
  | { kind: "paste"; text: string }
  | { kind: "setSelection"; anchor: number; head: number }
  | { kind: "deleteBackward" }
  | { kind: "deleteForward" }
  | { kind: "undo" }
  | { kind: "redo" };

type OpCategory = BrowserOp["kind"];

function graphemePositions(text: string): number[] {
  const positions = new Set<number>([0, text.length]);
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  for (const piece of segmenter.segment(text)) positions.add(piece.index + piece.segment.length);
  return [...positions].sort((a, b) => a - b);
}

function randomText(rng: ReturnType<typeof makeRng>, maxPieces: number): string {
  const count = 1 + rngInt(rng, maxPieces);
  let text = "";
  for (let index = 0; index < count; index += 1) text += pickOne(rng, SAFE_ALPHABET);
  return text;
}

function randomOp(rng: ReturnType<typeof makeRng>, text: string): BrowserOp {
  const roll = rng.next();
  if (roll < 0.42) return { kind: "paste", text: randomText(rng, 2) };
  if (roll < 0.62) {
    const boundaries = graphemePositions(text);
    const anchor = pickOne(rng, boundaries);
    const head = rng.next() < 0.55 ? anchor : pickOne(rng, boundaries);
    return { kind: "setSelection", anchor, head };
  }
  if (roll < 0.74) return { kind: "deleteBackward" };
  if (roll < 0.84) return { kind: "deleteForward" };
  if (roll < 0.94) return { kind: "undo" };
  return { kind: "redo" };
}

function writesSelection(op: BrowserOp): boolean {
  return op.kind === "paste" || op.kind === "setSelection" || op.kind === "deleteBackward" || op.kind === "deleteForward";
}

interface Histogram {
  counts: Map<OpCategory, number>;
  docChangingPastes: number;
  docChangingUndos: number;
}

function bump(histogram: Histogram, op: BrowserOp, changed: boolean): void {
  histogram.counts.set(op.kind, (histogram.counts.get(op.kind) ?? 0) + 1);
  if (op.kind === "paste" && changed) histogram.docChangingPastes += 1;
  if (op.kind === "undo" && changed) histogram.docChangingUndos += 1;
}

function assertHistogramUsable(histogram: Histogram, label: string): void {
  for (const category of ["paste", "setSelection", "deleteBackward", "deleteForward", "undo", "redo"] as const) {
    expect(histogram.counts.get(category) ?? 0, `${label}: 随机序列空转——${category} 为 0（${JSON.stringify([...histogram.counts])}）`).toBeGreaterThan(0);
  }
  expect(histogram.docChangingPastes, `${label}: 没有一次粘贴真的改了文档`).toBeGreaterThan(0);
  expect(histogram.docChangingUndos, `${label}: 没有一次 undo 真的改了文档`).toBeGreaterThan(0);
}

async function applyBrowserOp(
  page: Page,
  selector: string,
  op: BrowserOp,
  helpers: { setSelection(anchor: number, head: number): Promise<void> },
): Promise<void> {
  switch (op.kind) {
    case "paste":
      await dispatchPaste(page, selector, { text: op.text });
      return;
    case "setSelection":
      await helpers.setSelection(op.anchor, op.head);
      return;
    case "deleteBackward":
      await page.keyboard.press("Backspace");
      return;
    case "deleteForward":
      await page.keyboard.press("Delete");
      return;
    case "undo":
      await page.keyboard.press("Meta+z");
      return;
    case "redo":
      await page.keyboard.press("Meta+Shift+z");
      return;
  }
}

pageTest("正文随机对拍 seed=61,67：Unicode 粘贴 / 选区 / 快速 undo-redo（真浏览器）", async (page) => {
  const histogram: Histogram = { counts: new Map(), docChangingPastes: 0, docChangingUndos: 0 };
  const runStep = async (step: number, op: BrowserOp, model: BodyOracle): Promise<void> => {
    const before = await bodyState(page);
    await page.waitForTimeout(620);
    await applyBrowserOp(page, bodySelector, op, { setSelection: (a, h) => setBodySelection(page, a, h) });
    switch (op.kind) {
      case "paste":
        model.insert(op.text);
        break;
      case "setSelection":
        model.setSelection(op.anchor, op.head);
        break;
      case "deleteBackward":
        model.deleteBackward();
        break;
      case "deleteForward":
        model.deleteForward();
        break;
      case "undo":
        model.undo();
        break;
      case "redo":
        model.redo();
        break;
    }
    if (op.kind === "undo" || op.kind === "redo") {
      // CM 的 undo/redo 回填选区与模型快照可以不同：两侧都归一成折叠 caret，下一步才对得上。
      model.setSelection(model.head);
      await setBodySelection(page, model.head);
    }
    const actual = await bodyState(page);
    if (actual.doc !== model.doc || (writesSelection(op) && (actual.anchor !== model.anchor || actual.head !== model.head))) {
      fail(step, JSON.stringify(op), before, { doc: model.doc, anchor: model.anchor, head: model.head }, actual);
    }
    assertNoLoneSurrogates(actual.doc, `step=${step}`);
    bump(histogram, op, actual.doc !== before.doc);
  };

  for (const seed of [61, 67]) {
    const start = "种子🙂\n正文\n";
    await openBody(page, "probe.md", start);
    await setBodySelection(page, 0);
    const model = new BodyOracle(start, 0);
    const rng = makeRng((seed >>> 0) ^ 0x51ed270b);
    // 固定前缀：保证每个操作类别至少被真实执行一次（直方图不得靠随机碰运气）。
    const prefix: BrowserOp[] = [
      { kind: "paste", text: "甲" },
      { kind: "setSelection", anchor: 0, head: 1 },
      { kind: "deleteBackward" },
      { kind: "deleteForward" },
      { kind: "undo" },
      { kind: "redo" },
    ];
    let step = 0;
    for (const op of prefix) {
      await runStep(step, op, model);
      step += 1;
    }
    for (let index = 0; index < 10; index += 1) {
      await runStep(step, randomOp(rng, model.doc), model);
      step += 1;
    }
  }
  assertHistogramUsable(histogram, "正文随机对拍");
});

pageTest("composer 随机对拍 seed=71,73：Unicode 粘贴 / 选区 / 历史 / 附件不动", async (page) => {
  const histogram: Histogram = { counts: new Map(), docChangingPastes: 0, docChangingUndos: 0 };
  const runStep = async (step: number, op: BrowserOp, model: ComposerOracle): Promise<void> => {
    const before = await composerState(page);
    // 620ms > CM history 的 500ms 聚簇窗口：每拍一个独立撤销步，模型与生产同步。
    await page.waitForTimeout(620);
    await applyBrowserOp(page, composerSelector, op, { setSelection: (a, h) => setComposerSelection(page, a, h) });
    switch (op.kind) {
      case "paste":
        model.insert(op.text);
        break;
      case "setSelection":
        model.setSelection(op.anchor, op.head);
        break;
      case "deleteBackward":
        model.deleteBackward();
        break;
      case "deleteForward":
        model.deleteForward();
        break;
      case "undo":
        model.undo();
        break;
      case "redo":
        model.redo();
        break;
    }
    if (op.kind === "undo" || op.kind === "redo") {
      model.setSelection(model.head);
      await setComposerSelection(page, model.head);
    }
    const actual = await composerState(page);
    if (actual.doc !== model.text || (writesSelection(op) && (actual.anchor !== model.anchor || actual.head !== model.head))) {
      fail(step, JSON.stringify(op), before, { text: model.text, anchor: model.anchor, head: model.head }, actual);
    }
    await expect(composerTray(page)).toHaveCount(1);
    bump(histogram, op, actual.doc !== before.doc);
  };

  for (const seed of [71, 73]) {
    const start = "种子🙂";
    await openComposer(page, start, 2, [QUOTE_CARD]);
    await page.locator(composerSelector).click();
    await setComposerSelection(page, 2);
    const model = new ComposerOracle({ text: start, caret: 2, cards: ["quote"] });
    const rng = makeRng((seed >>> 0) ^ 0x7a3d19e5);
    const prefix: BrowserOp[] = [
      { kind: "paste", text: "甲" },
      { kind: "setSelection", anchor: 2, head: 3 },
      { kind: "deleteBackward" },
      { kind: "deleteForward" },
      { kind: "undo" },
      { kind: "redo" },
    ];
    let step = 0;
    for (const op of prefix) {
      await runStep(step, op, model);
      step += 1;
    }
    for (let index = 0; index < 6; index += 1) {
      await runStep(step, randomOp(rng, model.text), model);
      step += 1;
    }
  }
  assertHistogramUsable(histogram, "composer 随机对拍");
});

// ---------------------------------------------------------------------------
// 十、快速无屏障序列（P1-1）：真实键入 / 删除 / undo / redo，不插 ≥500ms 屏障
//
// 与第九节的分工：第九节用 620ms 屏障把每拍隔成独立历史步，便于逐拍对拍；本节刻意**不设**
// 时间屏障，直接验证「快速操作下历史仍不丢步、不复活、不越界」。两个子段：
//   A. 每次编辑的变更区间与上一拍**不相邻**（中间用程序化选区跳开），因此无论两拍间隔多短，
//      历史都不会聚簇——每拍都是确定的一步，可逐步给出精确 doc/caret 期望（含 undo/redo）。
//   B. 相邻的快速键入 + 删除（会按 500ms/相邻规则聚簇），用独立模型的「可达状态集合」判定
//      undo/redo 不会落到集合外，并断言撤到底 / 重做到顶的精确终态。
// 两段都不含 waitForTimeout(≥500ms)；expect.poll 只等 DOM observer 的微任务落地，不改变
// 两次按键之间的时序条件。
// ---------------------------------------------------------------------------

const FAST_DOC = "alpha\nbravo\ncharlie\n";

type FastStep =
  | { kind: "select"; pos: number; doc: string; head: number }
  | { kind: "type"; text: string; doc: string; head: number }
  | { kind: "key"; key: string; doc: string; head: number };

/** 有向精确期望：由操作语义推导，并在 chromium + webkit-realua 实测一致。编辑拍两两不相邻，
 *  history 不聚簇，因此期望与两拍间隔无关。undo 的 caret = 被撤销事件的起始选区；redo 的
 *  caret = 该起始选区经逆变换映射后的落点（本表三例均为删除/插入的起点侧）。 */
const FAST_STEPS: FastStep[] = [
  { kind: "select", pos: 0, doc: FAST_DOC, head: 0 },
  { kind: "type", text: "X", doc: "Xalpha\nbravo\ncharlie\n", head: 1 },
  { kind: "select", pos: 7, doc: "Xalpha\nbravo\ncharlie\n", head: 7 },
  { kind: "type", text: "Y", doc: "Xalpha\nYbravo\ncharlie\n", head: 8 },
  { kind: "select", pos: 14, doc: "Xalpha\nYbravo\ncharlie\n", head: 14 },
  { kind: "type", text: "Z", doc: "Xalpha\nYbravo\nZcharlie\n", head: 15 },
  { kind: "select", pos: 4, doc: "Xalpha\nYbravo\nZcharlie\n", head: 4 },
  { kind: "key", key: "Backspace", doc: "Xalha\nYbravo\nZcharlie\n", head: 3 },
  { kind: "select", pos: 10, doc: "Xalha\nYbravo\nZcharlie\n", head: 10 },
  { kind: "key", key: "Delete", doc: "Xalha\nYbrao\nZcharlie\n", head: 10 },
  { kind: "key", key: "Meta+z", doc: "Xalha\nYbravo\nZcharlie\n", head: 10 },
  { kind: "key", key: "Meta+z", doc: "Xalpha\nYbravo\nZcharlie\n", head: 4 },
  { kind: "key", key: "Meta+Shift+z", doc: "Xalha\nYbravo\nZcharlie\n", head: 3 },
  { kind: "key", key: "Meta+Shift+z", doc: "Xalha\nYbrao\nZcharlie\n", head: 10 },
  { kind: "select", pos: 18, doc: "Xalha\nYbrao\nZcharlie\n", head: 18 },
  { kind: "type", text: "!", doc: "Xalha\nYbrao\nZcharl!ie\n", head: 19 },
  { kind: "key", key: "Meta+z", doc: "Xalha\nYbrao\nZcharlie\n", head: 18 },
  { kind: "key", key: "Meta+Shift+z", doc: "Xalha\nYbrao\nZcharl!ie\n", head: 19 },
];

pageTest("快速无屏障：真实键入/删除/undo/redo 固定序列（逐步精确 doc + caret）", async (page) => {
  await openBody(page, "probe.md", FAST_DOC);
  await page.locator(bodySelector).click();
  let edits = 0;
  let undos = 0;
  let redos = 0;
  for (const [index, step] of FAST_STEPS.entries()) {
    if (step.kind === "select") {
      await setBodySelection(page, step.pos);
    } else if (step.kind === "type") {
      await page.keyboard.type(step.text);
      edits += 1;
    } else {
      await page.keyboard.press(step.key);
      if (step.key === "Meta+z") undos += 1;
      else if (step.key === "Meta+Shift+z") redos += 1;
      else edits += 1;
    }
    await expect.poll(async () => (await bodyState(page)).doc, { message: `step ${index} ${JSON.stringify(step)}` }).toBe(step.doc);
    await expect.poll(async () => (await bodyState(page)).head, { message: `step ${index} caret ${JSON.stringify(step)}` }).toBe(step.head);
  }
  // 正观测：三类操作都真实发生，且终态与表尾一致。
  expect(edits, "键入/删除拍数").toBeGreaterThan(0);
  expect(undos, "undo 拍数").toBeGreaterThan(0);
  expect(redos, "redo 拍数").toBeGreaterThan(0);
  const final = await bodyState(page);
  const last = FAST_STEPS[FAST_STEPS.length - 1]!;
  expect(final.doc).toBe(last.doc);
  expect(final.head).toBe(last.head);
});

pageTest("快速无屏障：相邻键入+删除后 undo/redo 只落在模型可达状态集（终态与历史）", async (page) => {
  const start = "seed\n";
  await openBody(page, "probe.md", start);
  await page.locator(bodySelector).click();
  await setBodySelection(page, 5);

  // 独立模型枚举每个按键后的可达状态（不假设 history 聚簇粒度）。
  const model = new BodyOracle(start, 5);
  const reachable: Array<{ doc: string; head: number }> = [{ doc: model.doc, head: model.head }];
  for (const ch of "abc") {
    model.insert(ch);
    reachable.push({ doc: model.doc, head: model.head });
  }
  model.deleteBackward();
  reachable.push({ doc: model.doc, head: model.head });
  model.deleteBackward();
  reachable.push({ doc: model.doc, head: model.head });
  const final = reachable[reachable.length - 1]!;
  const keyOf = (r: { doc: string; head: number }) => `${r.doc}\u0000${r.head}`;
  const allowed = new Set(reachable.map(keyOf));

  // 相邻 + 无任何 ≥500ms 屏障：三拍键入 + 两拍删除。
  await page.keyboard.type("abc");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect.poll(async () => (await bodyState(page)).doc).toBe(final.doc);
  expect((await bodyState(page)).head).toBe(final.head);
  expect(allowed.has(keyOf({ doc: (await bodyState(page)).doc, head: (await bodyState(page)).head }))).toBe(true);

  const seen = new Set<string>();
  let undoPresses = 0;
  while (!((await bodyState(page)).doc === start && (await bodyState(page)).head === 5)) {
    expect(undoPresses, "undo 未撤到底").toBeLessThan(10);
    await page.keyboard.press("Meta+z");
    undoPresses += 1;
    const after = await bodyState(page);
    expect(allowed.has(keyOf(after)), `undo 落在模型状态集外：${JSON.stringify(after)}`).toBe(true);
    seen.add(keyOf(after));
  }
  expect(undoPresses, "undo 拍数").toBeGreaterThan(0);

  let redoPresses = 0;
  while (!((await bodyState(page)).doc === final.doc && (await bodyState(page)).head === final.head)) {
    expect(redoPresses, "redo 未重做到顶").toBeLessThan(10);
    await page.keyboard.press("Meta+Shift+z");
    redoPresses += 1;
    const after = await bodyState(page);
    expect(allowed.has(keyOf(after)), `redo 落在模型状态集外：${JSON.stringify(after)}`).toBe(true);
    seen.add(keyOf(after));
  }
  expect(redoPresses, "redo 拍数").toBeGreaterThan(0);
  expect(seen.size, "历史全程未经过任何可观测状态").toBeGreaterThan(1);
  const settled = await bodyState(page);
  expect({ doc: settled.doc, anchor: settled.anchor, head: settled.head }).toEqual({
    doc: final.doc,
    anchor: final.head,
    head: final.head,
  });
});

// ---------------------------------------------------------------------------
// 十一、Markdown / HTML 的 paste 与 drop（P1-2）
//
// 合同：
//   - Markdown 源码以 `text/plain` 粘贴 / 拖放 = **按纯文本逐字节消费**（正文与 composer 同权），
//     替换选区 / 落在拖放点；不解析 Markdown、不吞选区。
//   - `text/markdown` 显式 MIME（无 text/plain）：正文 caret、composer、两面的 drop 都是安全
//     no-op；正文**非空选区**的现状是 CM `doPaste("")` 删除选区（finding，见下方 expected
//     failure）——不把数据丢失写成期望。
//   - `text/html`（无 text/plain）drop：产品 JS 处理器不消费、不改文档、不动选区。合成 DragEvent
//     到不了浏览器原生 drag-drop 默认动作，该边界在 README 单列；paste 侧 HTML-only 的删除
//     仍是既有 finding。
// ---------------------------------------------------------------------------

const MD_SOURCE = "## 标题\n- 项 **粗** [[link]]\n";

pageTest("Markdown 源码（text/plain）正文粘贴：caret / 非空选区都按纯文本消费", async (page) => {
  const doc = "alpha\nbeta\n";
  // caret
  await openBody(page, "probe.md", doc);
  await page.locator(bodySelector).click();
  await setBodySelection(page, 3);
  const prevented = await dispatchPaste(page, bodySelector, { text: MD_SOURCE, html: "<b>HTML</b>" });
  expect(prevented).toBe(true);
  await expect.poll(async () => (await bodyState(page)).doc).toBe(`alp${MD_SOURCE}ha\nbeta\n`);
  expect((await bodyState(page)).head).toBe(3 + MD_SOURCE.length);
  await page.waitForTimeout(620);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await bodyState(page)).doc).toBe(doc);

  // 非空选区：精确替换源码区间，不静默删除。
  await openBody(page, "probe.md", doc);
  await page.locator(bodySelector).click();
  await setBodySelection(page, 2, 8);
  await dispatchPaste(page, bodySelector, { text: MD_SOURCE });
  await expect.poll(async () => (await bodyState(page)).doc).toBe(`al${MD_SOURCE}ta\n`);
  expect((await bodyState(page)).head).toBe(2 + MD_SOURCE.length);
  await page.waitForTimeout(620);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await bodyState(page)).doc).toBe(doc);
  expect({ anchor: (await bodyState(page)).anchor, head: (await bodyState(page)).head }).toEqual({ anchor: 2, head: 8 });
});

pageTest("Markdown 源码（text/plain）正文 drop：插入一次、原有字节不丢、不吞选区", async (page) => {
  const doc = "alpha\nbeta\n";
  await openBody(page, "probe.md", doc);
  await page.locator(bodySelector).click();
  await setBodySelection(page, 2, 8);
  const prevented = await dispatchDrop(page, bodySelector, { pos: 3, text: MD_SOURCE });
  expect(prevented).toBe(true);
  const after = await bodyState(page);
  const at = after.anchor;
  expect(after.doc).toBe(doc.slice(0, at) + MD_SOURCE + doc.slice(at));
  expect(after.head).toBe(at + MD_SOURCE.length);
  expect(after.doc.slice(0, at) + after.doc.slice(at + MD_SOURCE.length), "drop 不得删除原有字节").toBe(doc);
  expect(at <= doc.indexOf("\n")).toBe(true);
});

pageTest("Markdown 源码（text/plain）composer 粘贴与 drop：按纯文本消费、附件不动", async (page) => {
  const doc = "alpha";
  await openComposer(page, doc, 2, [QUOTE_CARD]);
  await page.locator(composerSelector).click();
  await setComposerSelection(page, 2, 4);
  const preventedPaste = await dispatchPaste(page, composerSelector, { text: MD_SOURCE });
  expect(preventedPaste).toBe(true);
  await expect.poll(async () => (await composerState(page)).doc).toBe(`al${MD_SOURCE}a`);
  expect((await composerState(page)).head).toBe(2 + MD_SOURCE.length);
  await expect(composerTray(page)).toHaveCount(1);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await composerState(page)).doc).toBe(doc);

  await openComposer(page, doc, 2, [QUOTE_CARD]);
  await page.locator(composerSelector).click();
  await setComposerSelection(page, 1, 4);
  const preventedDrop = await dispatchDrop(page, composerSelector, { pos: 2, text: MD_SOURCE });
  expect(preventedDrop).toBe(true);
  const after = await composerState(page);
  const at = after.head - MD_SOURCE.length;
  expect(after.doc).toBe(doc.slice(0, at) + MD_SOURCE + doc.slice(at));
  expect(after.doc.slice(0, at) + after.doc.slice(at + MD_SOURCE.length), "drop 不得删除原有字节").toBe(doc);
  await expect(composerTray(page)).toHaveCount(1);
});

pageTest("text/markdown-only：caret 与 drop 安全 no-op；正文有选区为已知缺陷（expected failure）", async (page) => {
  const doc = "alpha\nbeta\n";
  // 正文 caret：安全 no-op。
  await openBody(page, "probe.md", doc);
  await page.locator(bodySelector).click();
  await setBodySelection(page, 3);
  const caretPrevented = await dispatchPaste(page, bodySelector, { markdown: MD_SOURCE });
  expect(caretPrevented).toBe(true);
  await page.waitForTimeout(60);
  expect(await bodyState(page)).toEqual({ doc, anchor: 3, head: 3 });

  // 正文 drop：只带 text/markdown 时产品处理器不消费、选区原样保留。
  await openBody(page, "probe.md", doc);
  await page.locator(bodySelector).click();
  await setBodySelection(page, 2, 8);
  const dropPrevented = await dispatchDrop(page, bodySelector, { pos: 3, markdown: MD_SOURCE });
  expect(dropPrevented).toBe(false);
  expect(await bodyState(page)).toEqual({ doc, anchor: 2, head: 8 });

  // composer 粘贴 / drop：只读 text/plain ⇒ 安全 no-op，选区与附件不动。
  await openComposer(page, "alpha", 2, [QUOTE_CARD]);
  await page.locator(composerSelector).click();
  await setComposerSelection(page, 1, 4);
  const composerPaste = await dispatchPaste(page, composerSelector, { markdown: MD_SOURCE });
  expect(composerPaste).toBe(true);
  await page.waitForTimeout(60);
  expect(await composerState(page)).toEqual({ doc: "alpha", anchor: 1, head: 4 });
  await expect(composerTray(page)).toHaveCount(1);

  await openComposer(page, "alpha", 2, [QUOTE_CARD]);
  await page.locator(composerSelector).click();
  await setComposerSelection(page, 1, 4);
  const composerDrop = await dispatchDrop(page, composerSelector, { pos: 2, markdown: MD_SOURCE });
  expect(composerDrop).toBe(true);
  expect(await composerState(page)).toEqual({ doc: "alpha", anchor: 1, head: 4 });
  await expect(composerTray(page)).toHaveCount(1);
});

pageTest("正文 text/markdown-only + 非空选区：不得静默删除（已知缺陷，expected failure）", async (page) => {
  baseTest.fail(true, "已知缺陷：正文 text/markdown-only + 选区时 CM doPaste(\"\") 删除选区；finding 已登记");
  const doc = "alpha\nbeta\n";
  await openBody(page, "probe.md", doc);
  await page.locator(bodySelector).click();
  await setBodySelection(page, 2, 8);
  const prevented = await dispatchPaste(page, bodySelector, { markdown: MD_SOURCE });
  expect(prevented).toBe(true);
  await page.waitForTimeout(60);
  const after = await bodyState(page);
  const consumed = doc.slice(0, 2) + MD_SOURCE + doc.slice(8);
  // 安全合同二选一：按 Markdown 源码消费（替换选区）或完全不动（文档与选区都不变）；
  // 当前实现两者都不是（选区被删），因此本用例是 expected failure。
  expect(
    after.doc === consumed || (after.doc === doc && after.anchor === 2 && after.head === 8),
    `不得静默删除选区：${JSON.stringify(after)}`,
  ).toBe(true);
});

pageTest("HTML drop：合成事件下双面安全 no-op，plain 优先", async (page) => {
  const doc = "alpha\nbeta\n";
  // 正文 HTML-only：产品处理器不消费；选区原样。
  await openBody(page, "probe.md", doc);
  await page.locator(bodySelector).click();
  await setBodySelection(page, 2, 8);
  const bodyHtmlOnly = await dispatchDrop(page, bodySelector, { pos: 3, html: "<b>HTML</b>" });
  expect(bodyHtmlOnly).toBe(false);
  expect(await bodyState(page)).toEqual({ doc, anchor: 2, head: 8 });

  // 正文 HTML + plain：plain 优先，插入一次，原有字节不丢。
  await openBody(page, "probe.md", doc);
  await page.locator(bodySelector).click();
  await setBodySelection(page, 2, 8);
  const bodyMixed = await dispatchDrop(page, bodySelector, { pos: 3, text: "PLAIN", html: "<b>HTML</b>" });
  expect(bodyMixed).toBe(true);
  const afterMixed = await bodyState(page);
  const at = afterMixed.anchor;
  expect(afterMixed.doc).toBe(doc.slice(0, at) + "PLAIN" + doc.slice(at));
  expect(afterMixed.doc.includes("HTML")).toBe(false);

  // composer HTML-only / HTML + plain。
  await openComposer(page, "alpha", 2, [QUOTE_CARD]);
  await page.locator(composerSelector).click();
  await setComposerSelection(page, 1, 4);
  const composerHtmlOnly = await dispatchDrop(page, composerSelector, { pos: 2, html: "<b>HTML</b>" });
  expect(composerHtmlOnly).toBe(true);
  expect(await composerState(page)).toEqual({ doc: "alpha", anchor: 1, head: 4 });
  await expect(composerTray(page)).toHaveCount(1);

  await openComposer(page, "alpha", 2, [QUOTE_CARD]);
  await page.locator(composerSelector).click();
  await setComposerSelection(page, 1, 4);
  const composerMixed = await dispatchDrop(page, composerSelector, { pos: 2, text: "PLAIN", html: "<b>HTML</b>" });
  expect(composerMixed).toBe(true);
  await expect.poll(async () => (await composerState(page)).doc).toBe("alPLAINpha");
  expect((await composerState(page)).doc.includes("HTML")).toBe(false);
  await expect(composerTray(page)).toHaveCount(1);
});
