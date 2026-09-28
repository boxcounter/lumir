// 截图取色（M285）：把「屏幕上某一处是什么颜色」变成可断言的读数。
//
// 为什么需要这条通道：渲染类缺陷（选区底色、装饰重绘、选中区里的字色）在真机的既有通道里**全不可见**——
// AX 读不到选区（README「已知边界」的「光标/选区不可断言」）、文件与剪贴板只看文档内容。
// M273 的 survey 因此把这类缺陷的判据落到「逐字符底色」上，而那一层此前只有 chromium 的像素基线
// 没有真机通道；真机缺陷（WKWebView 在装饰重建那一拍丢掉选中层绘制）恰恰只在这一层看得见。
//
// 通道与边界：
//   - 取图复用 KimiCU `mode=full` 快照自带的窗口截图（base64 JPEG）——不引入 `screencapture`：
//     那条通道要屏幕录制权限、且拍到的是整屏（含别的窗口）而不是被测窗口，坐标还要另算一套。
//   - 解码用 macOS 自带的 `sips` 转 BMP（24bpp 无压缩）后逐字节读。零新依赖：JPEG 解码器不进
//     仓库，BMP 的解析只有几十行（见 parseBmp）。
//   - 采样点写**窗口局部点**（与 `click` / `drag` 的 `{x,y}` 同一坐标空间），这里按
//     「截图宽 ÷ 窗口宽」换算成截图像素。KimiCU 的截图是整个窗口的等比缩放（实测 1200×800 的
//     窗口给 1152×768 的图），两个读数都能从 AX 快照的 header 拿到，因此比例是**算出来的**、
//     不是硬编码的常数。
//   - 判定用采样方块里的**主色**（见 dominantColor）：文字笔画是少数派，底色是多数派；这比
//     取中心单像素稳（中心点可能正落在笔画上或抗锯齿边缘）。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** 采样方块的边长（截图像素）**直径**：奇数、够跨几个笔画又不出字符行。 */
export const DEFAULT_PATCH = 7;
/** 「同色」的每通道容差（0-255）：JPEG 压缩 + 抗锯齿的抖动都在这个量级内。 */
export const DEFAULT_TOL = 8;
/** 「异色」的最小通道差：比容差大一截，避免「同/异」两条判据在灰区互相打架。 */
export const DEFAULT_MIN_DIFF = 16;

/** 把一张 base64 截图解成可逐点取色的位图。调用方负责 close()（临时目录在它下面）。 */
export function decodeScreenshot(base64) {
  const dir = mkdtempSync(path.join(tmpdir(), "lumir-pixel-"));
  const jpeg = path.join(dir, "shot.jpg");
  const bmp = path.join(dir, "shot.bmp");
  writeFileSync(jpeg, Buffer.from(base64, "base64"));
  try {
    execFileSync("/usr/bin/sips", ["-s", "format", "bmp", jpeg, "--out", bmp], { stdio: "pipe" });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`截图取色：sips 转换失败（${e.message}）——这条通道要 macOS 自带的 /usr/bin/sips`);
  }
  const img = parseBmp(readFileSync(bmp));
  return {
    ...img,
    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 解析 sips 产出的 BMP（BITMAPINFOHEADER、24bpp 无压缩、行按 4 字节对齐；
 *  高度为负 = 自顶向下，sips 走的就是这条）。 */
export function parseBmp(buf) {
  if (buf.length < 54 || buf.toString("latin1", 0, 2) !== "BM") {
    throw new Error("截图取色：拿到的不是 BMP（sips 的输出格式变了？）");
  }
  const dataOffset = buf.readUInt32LE(10);
  const headerSize = buf.readUInt32LE(14);
  if (headerSize !== 40) throw new Error(`截图取色：BMP 头不是 BITMAPINFOHEADER（${headerSize} 字节）`);
  const width = buf.readInt32LE(18);
  const rawHeight = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  if (compression !== 0) throw new Error(`截图取色：BMP 带压缩（${compression}），本解析器只认无压缩`);
  if (bpp !== 24 && bpp !== 32) throw new Error(`截图取色：BMP 位深 ${bpp}，本解析器只认 24 / 32`);
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  const bytesPerPixel = bpp / 8;
  const rowSize = Math.ceil((width * bytesPerPixel) / 4) * 4;
  if (dataOffset + rowSize * height > buf.length) {
    throw new Error("截图取色：BMP 数据区截断（文件比头里声明的短）");
  }
  return {
    width,
    height,
    /** 逐点取色；越界返回 null（调用方按「采样点出图」报错，不静默取边缘像素）。 */
    pixel(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      const row = topDown ? y : height - 1 - y;
      const off = dataOffset + row * rowSize + x * bytesPerPixel;
      return { r: buf[off + 2], g: buf[off + 1], b: buf[off] };
    },
  };
}

/** 采样方块的主色读数。
 *
 *  两步都是为了让读数落在**底色**上而不是笔画上：
 *  ① 每通道量化到 8 级（32 一档）做直方图，取像素最多的那一档——文字笔画是少数派、底色是多数派，
 *     这一档就是底色（含 JPEG 在平坦区引入的 ±2 抖动与抗锯齿边缘）；
 *  ② 对这一档里的像素逐通道取**中位数**（不是均值）：中位数不被同一档里的边缘像素拉偏。
 */
export function dominantColor(img, cx, cy, patch = DEFAULT_PATCH) {
  const half = Math.floor(patch / 2);
  const buckets = new Map();
  let total = 0;
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const px = img.pixel(cx + dx, cy + dy);
      if (!px) continue;
      total++;
      const key = `${px.r >> 5},${px.g >> 5},${px.b >> 5}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(px);
      buckets.set(key, bucket);
    }
  }
  if (total === 0) return null;
  let best = null;
  for (const bucket of buckets.values()) if (best === null || bucket.length > best.length) best = bucket;
  const median = (pick) => {
    const values = best.map(pick).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  return { r: median((p) => p.r), g: median((p) => p.g), b: median((p) => p.b) };
}

/** 采样方块的亮度跨度（最大 luma − 最小 luma，0-255）。
 *
 *  用途：判「这一块里真的画得清字」——底色读数是**多数派颜色**，字色变没变它看不出来；选中态里
 *  字色与底色撞上时（黑底黑字、白字压浅底），底色读数照旧是底色、只有这条跨度会塌到 0。
 *  这是「换绘制通道 / 换 token 时把字色丢了」这类回归的唯一可判读数。 */
export function lumaSpread(img, cx, cy, patch = DEFAULT_PATCH) {
  const half = Math.floor(patch / 2);
  let min = null;
  let max = null;
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const px = img.pixel(cx + dx, cy + dy);
      if (!px) continue;
      const luma = 0.299 * px.r + 0.587 * px.g + 0.114 * px.b;
      min = min === null ? luma : Math.min(min, luma);
      max = max === null ? luma : Math.max(max, luma);
    }
  }
  return min === null ? null : { min: Math.round(min), max: Math.round(max), spread: Math.round(max - min) };
}

/** 两个颜色的最大通道差（「同 / 异」两条判据共用一把尺）。 */
export function colorDiff(a, b) {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

export function formatColor(c) {
  const hex = (v) => v.toString(16).padStart(2, "0");
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}
