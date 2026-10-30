import { inflateSync } from "node:zlib";

export interface PixelImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function decodePng(buffer: Buffer): PixelImage {
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString("ascii", pos + 4, pos + 8);
    const body = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
    } else if (type === "IDAT") {
      idat.push(Buffer.from(body));
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + length;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported png: depth=${bitDepth} color=${colorType}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 0xff;
      else if (filter === 2) line[x] = (line[x] + b) & 0xff;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      } else if (filter !== 0) {
        throw new Error(`bad png filter ${filter}`);
      }
    }
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      out[target] = line[source];
      out[target + 1] = line[source + 1];
      out[target + 2] = line[source + 2];
      out[target + 3] = channels === 4 ? line[source + 3] : 255;
    }
    previous = line;
  }
  return { width, height, data: out };
}

function pixelDelta(a: PixelImage, b: PixelImage, index: number): number {
  return Math.max(
    Math.abs(a.data[index] - b.data[index]),
    Math.abs(a.data[index + 1] - b.data[index + 1]),
    Math.abs(a.data[index + 2] - b.data[index + 2]),
  );
}

export function changedPixels(
  before: PixelImage,
  after: PixelImage,
  rect?: PixelRect,
  outside?: PixelRect,
): number {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error("screenshot dimensions changed");
  }
  const left = Math.max(0, Math.floor(rect?.x ?? 0));
  const top = Math.max(0, Math.floor(rect?.y ?? 0));
  const right = Math.min(before.width, Math.ceil(rect === undefined ? before.width : rect.x + rect.width));
  const bottom = Math.min(before.height, Math.ceil(rect === undefined ? before.height : rect.y + rect.height));
  let changed = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (
        outside !== undefined &&
        x >= outside.x &&
        x < outside.x + outside.width &&
        y >= outside.y &&
        y < outside.y + outside.height
      ) {
        continue;
      }
      if (pixelDelta(before, after, (y * before.width + x) * 4) > 8) changed += 1;
    }
  }
  return changed;
}
