// 图片查看面的状态机与文案单测（M629，change add-image-file-preview 的 3.6）。
//
// 分层口径与 `tests/unit/lightbox.test.ts` 同源：状态机（`createImageViewerState`）是纯逻辑、
// DOM 只经 `ImageViewerSurface` 进出，因此本层**不造 DOM 替身**。真 `<img>` 的加载 / 解码 /
// 布局与「双击打开既有遮罩」的接线归 tests/visual 的场景（M629 的 5.2）与真机验收场景。
//
// 覆盖什么：
//   - 装载 → 终态的读数（宽高 + 字节数），终态 src 与 surface 收到的 src **逐字相同**
//     （双击放大取同一份图像源，不重读字节）；
//   - 读取失败 / 解码不可见两类失败，文案与文档内图片**同一份来源**（D111–D113，对 deck 逐字）；
//   - D3 的释放与切回重读（release 后同一路径会重新读一次）；
//   - 同一路径在途去重、迟到的旧装载不覆盖新图、失败是终态（不反复重读）。
// 不覆盖什么：像素与解码本身（需要渲染引擎）、双击事件的 DOM 接线。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createImageViewerState,
  dataUrlByteLength,
  imageModelineText,
  imageSizeText,
} from "../../src/image-viewer.ts";
import type { ImageViewerSurface } from "../../src/image-viewer.ts";
import { imageFallbackText, imageLoadingText, imageReadErrorText } from "../../src/preview/attachments.ts";

const deck = readFileSync(new URL("../../文案-Copy.md", import.meta.url), "utf8");

/** deck 表格行（`| 编号 | 位置 | 角色 | 中文 | English | 设计意图 |`）。 */
function deckRow(id: string): { zh: string; en: string } {
  const line = deck.split("\n").find((entry) => entry.startsWith(`| ${id} | `));
  assert.ok(line, `文案-Copy.md 里缺少 ${id}`);
  const cells = line.split("|").map((cell) => cell.trim());
  return { zh: cells[4], en: cells[5] };
}

/** data: URL 的合成载荷：`AAAA` 解出 3 字节（无填充），`AA==` 解出 1 字节。 */
const DATA_URL = "data:image/png;base64,AAAA";

interface SurfaceRig {
  surface: ImageViewerSurface;
  log: {
    loading: string[];
    images: Array<{ src: string; alt: string }>;
    fails: string[];
    clears: number;
  };
  /** 驱动 `<img>` 的解码终态（surface.image 收到的回调）。 */
  settle: (result: { visible: boolean; natural: { width: number; height: number } }) => void;
  hasPendingImage: () => boolean;
}

function createSurface(): SurfaceRig {
  const log: SurfaceRig["log"] = { loading: [], images: [], fails: [], clears: 0 };
  let pending: ((result: { visible: boolean; natural: { width: number; height: number } }) => void) | null = null;
  const surface: ImageViewerSurface = {
    loading: (text) => void log.loading.push(text),
    image: (src, alt, onSettled) => {
      log.images.push({ src, alt });
      pending = onSettled;
    },
    fail: (text) => void log.fails.push(text),
    clear: () => {
      log.clears += 1;
      pending = null;
    },
  };
  return {
    surface,
    log,
    settle: (result) => {
      assert.ok(pending !== null, "surface.image 还没收到回调（装载尚未走到终态）");
      const run = pending;
      pending = null;
      run(result);
    },
    hasPendingImage: () => pending !== null,
  };
}

/** 让 await 链推进到「surface.image 已收到、等待解码终态」这一格。 */
const tick = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

test("字节数反推：base64 载荷长度 → 解码后字节（含填充），空载荷 / 无逗号为 0", () => {
  assert.equal(dataUrlByteLength("data:image/png;base64,AAAA"), 3);
  assert.equal(dataUrlByteLength("data:image/png;base64,AA=="), 1);
  assert.equal(dataUrlByteLength("data:image/png;base64,AAA="), 2);
  assert.equal(dataUrlByteLength("data:image/png;base64,"), 0);
  assert.equal(dataUrlByteLength("no-comma"), 0);
});

test("读数格式化：B / KB / MB 三档（单位是 ASCII，与 D437 的 MB 用法同源）", () => {
  assert.equal(imageSizeText(68), "68 B");
  assert.equal(imageSizeText(2048), "2.0 KB");
  assert.equal(imageSizeText(10 * 1024), "10 KB");
  assert.equal(imageSizeText(1536 * 1024), "1.5 MB");
});

test("modeline 读数：装载中只有标签（D546），完成后是「图片 · 宽×高 · 文件大小」（D547）", () => {
  const label = deckRow("D546").zh; // 图片
  const template = deckRow("D547").zh; // {width}×{height} · {size}
  assert.equal(imageModelineText(null), label);
  const text = imageModelineText({ width: 96, height: 32, bytes: 3072 });
  assert.equal(
    text,
    `${label} · ${template.replace("{width}", "96").replace("{height}", "32").replace("{size}", "3.0 KB")}`,
  );
});

test("装载 → 终态：读数取自然尺寸与字节数；终态 src 与 surface 收到的 src 逐字相同", async () => {
  const rig = createSurface();
  const state = createImageViewerState(rig.surface);
  const loading = state.show("assets/pic.png", async () => DATA_URL);

  assert.deepEqual(rig.log.loading, [imageLoadingText("assets/pic.png")]);
  assert.equal(state.currentPath(), "assets/pic.png");
  assert.equal(state.info(), null, "装载中没有读数（MUST NOT 冒充 0×0）");

  await tick();
  assert.deepEqual(rig.log.images, [{ src: DATA_URL, alt: "assets/pic.png" }]);
  rig.settle({ visible: true, natural: { width: 96, height: 32 } });
  await loading;

  assert.deepEqual(state.info(), { width: 96, height: 32, bytes: 3 });
  // 双击放大取的是同一份图像源：surface（= 真 <img>）与状态机记录的 src 是同一个串。
  assert.equal(state.shownSrc(), DATA_URL);
  assert.equal(rig.log.images[0].src, state.shownSrc());
});

test("读取失败：占位文案与文档内图片同一份（D112，含路径与原因），无终态 src", async () => {
  const rig = createSurface();
  const state = createImageViewerState(rig.surface);
  const error = { code: "fs_not_found", message: "文件不存在：assets/missing.png" };
  await state.show("assets/missing.png", async () => {
    throw error;
  });

  const expected = deckRow("D112").zh
    .replace("{引用}", "assets/missing.png")
    .replace("{原因}", "文件不存在：assets/missing.png");
  assert.deepEqual(rig.log.fails, [expected]);
  assert.equal(rig.log.fails[0], imageReadErrorText("assets/missing.png", error.message));
  assert.equal(state.info(), null);
  assert.equal(state.shownSrc(), null);
  assert.equal(state.currentPath(), "assets/missing.png", "失败仍占着这个路径（标签在、占位在）");
});

test("解码不可见（零尺寸）：落 D113 占位，不产出读数", async () => {
  const rig = createSurface();
  const state = createImageViewerState(rig.surface);
  const loading = state.show("assets/broken.svg", async () => DATA_URL);
  await tick();
  rig.settle({ visible: false, natural: { width: 0, height: 0 } });
  await loading;

  const expected = deckRow("D113").zh.replace("{引用}", "assets/broken.svg");
  assert.deepEqual(rig.log.fails, [expected]);
  assert.equal(rig.log.fails[0], imageFallbackText("assets/broken.svg"));
  assert.equal(state.info(), null);
  assert.equal(state.shownSrc(), null);
});

test("D3：释放即清空，切回同一路径会重读一次", async () => {
  const rig = createSurface();
  const state = createImageViewerState(rig.surface);
  let loads = 0;
  const load = async (): Promise<string> => {
    loads += 1;
    return DATA_URL;
  };

  const first = state.show("assets/pic.png", load);
  await tick();
  rig.settle({ visible: true, natural: { width: 10, height: 10 } });
  await first;
  assert.equal(loads, 1);

  assert.equal(state.release(), "assets/pic.png");
  assert.equal(rig.log.clears, 1, "释放必须撤下 DOM（surface.clear）");
  assert.equal(state.currentPath(), undefined);
  assert.equal(state.info(), null);
  assert.equal(state.shownSrc(), null);

  const second = state.show("assets/pic.png", load);
  await tick();
  rig.settle({ visible: true, natural: { width: 10, height: 10 } });
  await second;
  assert.equal(loads, 2, "切回重读一次（D3：只保留激活图片的字节）");
});

test("同一路径在途去重：并发 show 复用同一次装载，不重复读字节", async () => {
  const rig = createSurface();
  const state = createImageViewerState(rig.surface);
  let loads = 0;
  const pending: { resolve?: (value: string) => void } = {};
  const load = (): Promise<string> => {
    loads += 1;
    return new Promise((resolve) => {
      pending.resolve = resolve;
    });
  };

  const a = state.show("assets/pic.png", load);
  const b = state.show("assets/pic.png", load);
  await tick();
  assert.equal(loads, 1, "第二次 show 命中了在途装载");
  assert.ok(pending.resolve !== undefined);
  pending.resolve(DATA_URL);
  await tick();
  rig.settle({ visible: true, natural: { width: 4, height: 4 } });
  await Promise.all([a, b]);
  assert.equal(loads, 1);
});

test("迟到的旧装载不覆盖新图（切图 / 释放后的在途字节作废）", async () => {
  const rig = createSurface();
  const state = createImageViewerState(rig.surface);
  const pendingA: { resolve?: (value: string) => void } = {};
  const a = state.show("assets/a.png", () =>
    new Promise((resolve) => {
      pendingA.resolve = resolve;
    }),
  );
  await tick();

  const b = state.show("assets/b.png", async () => DATA_URL);
  await tick();
  rig.settle({ visible: true, natural: { width: 8, height: 8 } });
  await b;
  assert.equal(state.currentPath(), "assets/b.png");

  assert.ok(pendingA.resolve !== undefined);
  pendingA.resolve("data:image/png;base64,AA==");
  await a;
  assert.equal(state.currentPath(), "assets/b.png", "旧装载的迟到终态不改当前图");
  assert.equal(state.shownSrc(), DATA_URL);
  assert.equal(rig.log.images.at(-1)?.src, DATA_URL);
});

test("失败是终态：同一路径再 show 不重读（重试路径是重新打开这个标签）", async () => {
  const rig = createSurface();
  const state = createImageViewerState(rig.surface);
  let loads = 0;
  const failing = async (): Promise<string> => {
    loads += 1;
    throw { code: "attachment_too_large", message: "文件过大" };
  };
  await state.show("assets/huge.png", failing);
  assert.equal(loads, 1);
  await state.show("assets/huge.png", failing);
  assert.equal(loads, 1, "失败终态下同步点不再重读一遍（50MB 上限的边界）");
});
