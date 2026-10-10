// 合成 PNG（M416，change paste-clipboard-image 的真机验收 fixture）。
//
// 为什么在套件里**生成**而不是放 `fixtures/`：合成截图的分辨率是场景参数（S5 要 2560×1920
// 的 Retina 类截图，其余场景只要小图），而 PNG 是二进制——按仓库信息卫生纪律，能参数化的
// 东西不落二进制、fixture 一律合成。这里用 `node:zlib` 手写最小 PNG 编码器
//（IHDR / IDAT / IEND + CRC32），零新增依赖，与套件其余部分的取向一致。
//
// 形态取 **RGB8 真彩色（color type 2）**：AppleScript 的 `«class PNGf»` 置剪贴板后再由
// WebKit 归一化出来的就是这一类（无 alpha 通道），与真实系统截图的 web 通道形态一致。

import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 一个 PNG chunk：长度 + 类型 + 数据 + 覆盖「类型 + 数据」的 CRC32。 */
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGB8 字节（`width * height * 3`，逐行 RGB）→ PNG 字节。 */
export function encodePng(width, height, rgb) {
  if (rgb.length !== width * height * 3) {
    throw new Error(`像素缓冲长度不符：期望 ${width * height * 3}，实际 ${rgb.length}`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type：真彩色（无 alpha）
  ihdr[10] = 0; // compression：deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace：none
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // 每行的 filter type 0（None）
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * 确定性的「类截图」像素（白底 + 深色文字行 + 几个彩色块）。
 *
 * 确定性是刻意的：`seed` 相同 ⇒ 字节相同 ⇒ 内容寻址命名相同，S2 的「同图跨笔记去重」才有
 * 一个可复现的输入（同一 seed 合成两次即同一张图）。图片内容主体是文字行而非纯色，是为了让
 * **PNG 与 WebP 无损都按真实截图的压缩特征表现**（纯色图两种编码都趋近于零，比值没有意义）。
 */
export function syntheticScreenshot(width, height, seed = 1) {
  const rgb = Buffer.alloc(width * height * 3);
  let state = (seed >>> 0) || 1;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const fill = (x0, y0, w, h, color) => {
    for (let y = Math.max(0, y0); y < Math.min(height, y0 + h); y += 1) {
      for (let x = Math.max(0, x0); x < Math.min(width, x0 + w); x += 1) {
        const at = (y * width + x) * 3;
        rgb[at] = color[0];
        rgb[at + 1] = color[1];
        rgb[at + 2] = color[2];
      }
    }
  };
  fill(0, 0, width, height, [250, 250, 249]);
  // 行距随宽度缩放：小图也有几行文字，2560×1920 的行密度接近真实截图。
  const lineHeight = Math.max(16, Math.round((width / 2560) * 34));
  const margin = Math.round(width * 0.06);
  const barHeight = Math.max(5, Math.round(lineHeight * 0.34));
  for (let y = margin; y + barHeight < height - margin; y += lineHeight) {
    let x = margin;
    const words = 5 + Math.floor(rand() * 8);
    for (let w = 0; w < words; w += 1) {
      const wordWidth = 18 + Math.floor(rand() * lineHeight * 2.2);
      if (x + wordWidth > width - margin) break;
      const tone = 40 + Math.floor(rand() * 60);
      fill(x, y, wordWidth, barHeight, [tone, tone + 4, tone + 14]);
      x += wordWidth + Math.round(lineHeight * 0.5);
    }
  }
  // 几个色块（模拟界面里的按钮 / 高亮），让压缩比不至于退化成「大片纯白」。
  const palette = [
    [59, 130, 246],
    [249, 115, 22],
    [16, 185, 129],
    [139, 92, 246],
  ];
  for (let i = 0; i < 4; i += 1) {
    const w = Math.round(width * (0.08 + rand() * 0.12));
    const h = Math.max(6, Math.round(lineHeight * (0.8 + rand())));
    fill(Math.round(rand() * (width - w)), Math.round(rand() * (height - h)), w, h, palette[i]);
  }
  return rgb;
}
