// src/preview/attachments.ts 的图片终态纯逻辑单测（M178）：终态可见判据、尺寸兜底取点、
// 三条图片态文案（deck D111–D113）与 widget 相等性；M187 起另加「替换区尺寸的记忆与预留」
//（几何缓存 + 预留样式推导）。
//
// 不在这一层：真 <img> 的加载 / 解码 / 布局（需要 DOM 与渲染引擎）——那部分归
// tests/visual/scenes/markdown-combo.spec.ts、m182-image-first-open-width.spec.ts（宽度不变量）
// 与 scripts/acceptance 的 20-image-fallback / 23-image-first-open-width / 26-svg-scroll-stability
// 场景（分工见 tests/unit/README.md 与 tests/unit/harness.ts 的边界说明）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ImageWidget,
  forgetGeometry,
  imageFallbackText,
  imageFallbackWidth,
  imageLoadingText,
  imageReadErrorText,
  imageReserve,
  imageVisible,
  knownGeometry,
  rememberGeometry,
} from "../../src/preview/attachments.ts";

const deck = readFileSync(new URL("../../文案-Copy.md", import.meta.url), "utf8");

/** deck 表格行（`| 编号 | 位置 | 角色 | 中文 | English | 设计意图 |`）；编号不按序排，按 id 找。 */
function deckRow(id: string): { zh: string; en: string } {
  const line = deck.split("\n").find((l) => l.startsWith(`| ${id} | `));
  assert.ok(line, `文案-Copy.md 里缺少 ${id}`);
  const cells = line.split("|").map((cell) => cell.trim());
  return { zh: cells[4], en: cells[5] };
}

test("终态可见判据：两个维度都必须非零", () => {
  assert.equal(imageVisible({ width: 300, height: 100 }), true);
  // 小到不足 1px 也算可见（判据是「有没有画出来」，不是审美阈值）
  assert.equal(imageVisible({ width: 0.5, height: 0.5 }), true);
  assert.equal(imageVisible({ width: 0, height: 100 }), false);
  assert.equal(imageVisible({ width: 300, height: 0 }), false);
  assert.equal(imageVisible({ width: 0, height: 0 }), false);
});

test("尺寸兜底取点：布局尺寸为零且自然尺寸非零时按自然宽度，其余返回 null", () => {
  // 中招形状（`width="100%"` + 仅 viewBox）的实测读数：布局盒 0×0、自然尺寸 300×100。
  assert.equal(imageFallbackWidth({ width: 0, height: 0 }, { width: 300, height: 100 }), 300);
  // 只有一维为零同样按自然宽度兜底
  assert.equal(imageFallbackWidth({ width: 0, height: 100 }, { width: 300, height: 100 }), 300);
  // 已经可见：不碰尺寸（正常图片零行为变化的前提）
  assert.equal(imageFallbackWidth({ width: 240, height: 80 }, { width: 240, height: 80 }), null);
  // 自然尺寸也为零（如 `width="0"` 的 svg）：兜底取不到宽度 → 走占位
  assert.equal(imageFallbackWidth({ width: 0, height: 0 }, { width: 0, height: 0 }), null);
  assert.equal(imageFallbackWidth({ width: 0, height: 0 }, { width: 0, height: 100 }), null);
});

test("三条图片态文案与 deck D111–D113 逐字一致（deck 是模板的唯一真源）", () => {
  const ref = "![Hooks Overview](images/hooks-overview.en.svg)";
  assert.equal(imageLoadingText(ref), deckRow("D111").zh.replace("{引用}", ref));
  assert.equal(imageReadErrorText(ref, "文件不存在"), deckRow("D112").zh.replace("{引用}", ref).replace("{原因}", "文件不存在"));
  assert.equal(imageFallbackText(ref), deckRow("D113").zh.replace("{引用}", ref));

  // 位串本身（英文字段同样在 deck 里，防只改一边）
  assert.equal(imageLoadingText(ref), `加载中… ${ref}`);
  assert.equal(imageReadErrorText(ref, "文件不存在"), `图片读取失败：${ref}（文件不存在）`);
  assert.equal(imageFallbackText(ref), `图片无法显示：${ref}`);

  // 退场串不得复活：`img` 的 error 不携带原因，把多类成因一律说成解码失败是错误归因（design §5.1）。
  for (const text of [imageFallbackText(ref), imageReadErrorText(ref, "文件不存在")]) {
    assert.ok(!text.includes("解码失败"), `文案里仍出现已退场的「解码失败」：${text}`);
  }
});

test("占位文案保留原始引用文本（alt 与路径都在其中）", () => {
  const ref = "![Hooks Overview](images/hooks-overview.en.svg)";
  for (const text of [imageLoadingText(ref), imageReadErrorText(ref, "原因"), imageFallbackText(ref)]) {
    assert.ok(text.includes(ref), `占位文本丢了原始引用：${text}`);
    assert.ok(text.includes("Hooks Overview"), `占位文本丢了 alt：${text}`);
    assert.ok(text.includes("images/hooks-overview.en.svg"), `占位文本丢了路径：${text}`);
  }
});

test("widget 相等性：同一目标的两条引用原文不同时不得互认", () => {
  const load = () => Promise.resolve("data:image/svg+xml;base64,");
  const standard = new ImageWidget("assets/a.svg", load, "![alt](assets/a.svg)");
  const wiki = new ImageWidget("assets/a.svg", load, "![[a.svg]]");
  assert.equal(standard.eq(new ImageWidget("assets/a.svg", load, "![alt](assets/a.svg)")), true);
  // alt / 加载文案 / 占位文案都取自 rawRef：互认会让第二条引用显示第一条的引用文本。
  assert.equal(standard.eq(wiki), false);
  assert.equal(wiki.eq(standard), false);
  assert.equal(standard.eq(new ImageWidget("assets/b.svg", load, "![alt](assets/a.svg)")), false);
});

test("widget 的引用文本与加载函数按构造入参原样持有", () => {
  const load = () => Promise.resolve("data:image/png;base64,");
  const widget = new ImageWidget("assets/a.png", load, "![alt](assets/a.png)");
  assert.equal(widget.key, "assets/a.png");
  assert.equal(widget.rawRef, "![alt](assets/a.png)");
  assert.equal(widget.load, load);
});

// ---------------------------------------------------------------------------
// M187：替换区尺寸的记忆与预留
//
// 不变量（条款原文见 docs/specs/image-reading.md §5）：
//   已渲染过的引用，其替换区在下次重建时 SHALL 在字节到达前就占住与终态一致的高度——
//   否则重建瞬间的加载中状态（一行文本）比终态矮一整张图，CM 的高度图随之突变、滚动锚定
//   把正文推移。本层断言的是**推导本身**：预留样式解出的盒子必须逐项等于上次渲染出的盒子。
// ---------------------------------------------------------------------------

/** 预留样式按 CSS 规则解出的盒子：宽度 = min(上限或栏宽)，高度 = 宽度 / 比例。
 *  与运行时一致：占位元素是包装盒（`width: 100%` = 栏宽）里唯一的常规流子元素，它的盒子就是行高。 */
function reservedBox(reserve: { aspectRatio: number; maxWidth: number | null }, column: number) {
  const width = Math.min(reserve.maxWidth ?? column, column);
  return { width, height: width / reserve.aspectRatio };
}

test("预留样式：宽高比取自上次渲染，窄图钉住宽度、贴栏宽的图不钉", () => {
  // 贴满栏宽（含只声明 viewBox 的矢量图：引擎给的自然尺寸是默认对象尺寸，宽度不可用）
  assert.deepEqual(imageReserve({ box: { width: 735, height: 466 }, column: 735 }), {
    aspectRatio: 735 / 466,
    maxWidth: null,
  });
  // 窄于栏宽：图片按自身宽度渲染，预留要把它钉在同一档
  assert.deepEqual(imageReserve({ box: { width: 240, height: 80 }, column: 735 }), {
    aspectRatio: 3,
    maxWidth: 240,
  });
});

test("预留样式：几何不可用时返回 null（不预留）", () => {
  assert.equal(imageReserve({ box: { width: 0, height: 0 }, column: 735 }), null);
  assert.equal(imageReserve({ box: { width: 735, height: 0 }, column: 735 }), null);
  assert.equal(imageReserve({ box: { width: 0, height: 466 }, column: 735 }), null);
  // 栏宽量不到（脱离文档的桩）：不钉宽度，但比例仍可用
  assert.deepEqual(imageReserve({ box: { width: 240, height: 80 }, column: 0 }), {
    aspectRatio: 3,
    maxWidth: null,
  });
});

test("预留不变量：解出的盒子逐项等于上次渲染的盒子（宽度维度 × 栏宽维度）", () => {
  // 输入分布：固有宽度（窄 / 等于栏宽 / 超栏宽 × 比例各异）× 栏宽（窄窗 / 默认 / 宽窗）。
  const intrinsics = [
    { width: 120, height: 300 }, // 竖窄图
    { width: 240, height: 80 },
    { width: 820, height: 520 },
    { width: 2000, height: 600 }, // 超栏宽位图/定尺寸 svg
  ];
  for (const column of [420, 735, 1200]) {
    for (const intrinsic of intrinsics) {
      // 上次渲染出的盒子：宽度 = min(固有宽, 栏宽)，高度按固有比例（M182 §1 的两族合并写法）。
      const rendered = {
        width: Math.min(intrinsic.width, column),
        height: (Math.min(intrinsic.width, column) * intrinsic.height) / intrinsic.width,
      };
      const reserve = imageReserve({ box: rendered, column });
      assert.ok(reserve, `缺少预留：${JSON.stringify(intrinsic)} @ ${column}`);
      const again = reservedBox(reserve, column);
      assert.ok(
        Math.abs(again.width - rendered.width) < 0.01 && Math.abs(again.height - rendered.height) < 0.01,
        `预留解出的盒子与上次渲染不一致：${JSON.stringify({ intrinsic, column, rendered, again })}`,
      );
    }
  }
});

test("预留不变量：窗口变宽后解出的盒子仍等于该栏宽下的终态盒子", () => {
  // 贴满栏宽的引用（含只声明 viewBox 的矢量图）在更宽的栏宽下必须跟着变宽——钉死宽度会把
  // 显示宽度锁在旧值上（M182 的宽度不变量）。窄图则停在自身宽度档位。
  const wide = imageReserve({ box: { width: 735, height: 466 }, column: 735 });
  const narrow = imageReserve({ box: { width: 240, height: 80 }, column: 735 });
  assert.ok(wide && narrow);
  assert.ok(Math.abs(reservedBox(wide, 1200).width - 1200) < 0.01, "贴栏宽的引用没跟着变宽");
  assert.ok(Math.abs(reservedBox(narrow, 1200).width - 240) < 0.01, "窄图被拉伸了");
  // 窗口收窄到窄图固有宽度以下：两族都按栏宽
  assert.ok(Math.abs(reservedBox(narrow, 200).width - 200) < 0.01, "窗宽小于固有宽时没按栏宽收窄");
});

test("几何缓存：按引用键存取、可失效、超限淘汰最早的一条", () => {
  const geom = { box: { width: 735, height: 466 }, column: 735 };
  rememberGeometry("assets/a.svg", geom);
  assert.deepEqual(knownGeometry("assets/a.svg"), geom);
  assert.equal(knownGeometry("assets/b.svg"), undefined);
  // 同键覆盖（文件被换掉后重新测得新尺寸）
  rememberGeometry("assets/a.svg", { box: { width: 300, height: 150 }, column: 735 });
  assert.deepEqual(knownGeometry("assets/a.svg"), { box: { width: 300, height: 150 }, column: 735 });
  forgetGeometry("assets/a.svg");
  assert.equal(knownGeometry("assets/a.svg"), undefined);

  // 上限之后新写入的仍能命中：缓存不是「装满就拒写」，而是淘汰最旧的一条
  for (let i = 0; i < 300; i++) {
    rememberGeometry(`assets/${i}.svg`, { box: { width: 10, height: 10 }, column: 735 });
  }
  assert.notEqual(knownGeometry("assets/299.svg"), undefined, "超限后最新一条读不到");
  assert.equal(knownGeometry("assets/0.svg"), undefined, "超限时没有淘汰最早的一条");
  forgetGeometry("assets/299.svg");
  assert.equal(knownGeometry("assets/299.svg"), undefined, "forget 之后仍读到几何");
});
