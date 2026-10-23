// 图片摘录事务（change add-image-quote-to-chat design §3）：vault 图 → composer 图片块。
//
// 三步、零新后端命令：
//   1. 读 vault 字节：`fs_read_attachment`（既有；只读，50MB 上限在 Rust 侧）；
//   2. 写 harness 侧存储：`harness_write_image`（既有；png→WebP 无损 / jpeg / webp 原样 /
//      其余子类型拒绝；内容寻址 + 去重——同一张图引用两次不会产生两份文件）；
//   3. 交调用方在**一次**结构编辑步里插块（本模块只做 I/O 与卡片装配，不碰 composer）。
//
// 两条硬约束（design §3）：
//   - **先落盘再插块**：本函数只在字节已进 harness 存储后才产出卡片，调用方拿到的卡片必然
//     可读回缩略图（不出现「卡片在场、缩略图读不回」的破图态）。
//   - **部分失败不整体回滚**：一张失败（格式不支持 / 超限 / 读写失败）只 toast 该张的原因，
//     其余照常返回；n 张里坏了 m 张时调用方拿到 n-m 张卡片、人侧看到 m 条原因 toast。
//
// 本模块是纯 I/O 编排（零 DOM）：tests/unit 用假 Tauri 后端直接跑真 ipc + 真转码面契约
//（`tests/unit/quote-image.test.ts`）。

import { errorText } from "./copy";
import { fsReadAttachment, harnessWriteImage } from "./ipc";
import { extensionOf, mimeTypeOf } from "./preview/attachments";
import type { HarnessWrittenImage } from "./bindings/HarnessWrittenImage";
import type { ImageCard } from "./quote-card";

/** 一个待引用的来源：`path` 是解析后的 vault 相对路径，`rawRef` 是引用原文（人侧 / 错误提示用）。 */
export interface QuoteImageSource {
  path: string;
  rawRef: string;
}

/** 一张引用进 composer 的图片：卡片数据 + 人侧来源。
 *  `source` 是 vault 相对路径，**不进**卡片数据模型 / 序列化 / 投递 / 草稿（design §4.2：
 *  图片块只有一种形态；来源只落缩略图的 hover title）。 */
export interface QuotedImage {
  card: ImageCard;
  source: string;
}

/** 事务的三个出口（装配层注入；单测直接喂替身）。 */
export interface QuoteImagePorts {
  /** 读 vault 内图片，返回 base64（`fs_read_attachment` 契约）。 */
  readVaultBase64(path: string): Promise<string>;
  /** 写 harness 侧内容寻址存储（`harness_write_image` 契约）。 */
  writeHarnessImage(dataBase64: string, sourceMime: string): Promise<HarnessWrittenImage>;
  /** 人话提示出口（既有错误文案按 code 渲染，见 `errorText`）。 */
  toast(text: string): void;
}

/** 生产装配：两个后端命令取 ipc 的既有封装，toast 由装配层给（归属 harness pane）。 */
export function productionQuoteImagePorts(toast: (text: string) => void): QuoteImagePorts {
  return {
    readVaultBase64: fsReadAttachment,
    writeHarnessImage: harnessWriteImage,
    toast,
  };
}

/**
 * 按文档序把若干 vault 图搬进 harness 存储，返回可插入的图片卡片；单张失败只 toast、
 * 不阻断其余（见文件头）。
 */
export async function quoteImagesFromVault(
  sources: readonly QuoteImageSource[],
  ports: QuoteImagePorts,
): Promise<QuotedImage[]> {
  const quoted: QuotedImage[] = [];
  for (const source of sources) {
    try {
      // sourceMime 取既有扩展名注册表（单一真源），不新写 MIME 表。
      const sourceMime = mimeTypeOf(extensionOf(source.path)) ?? "application/octet-stream";
      const dataBase64 = await ports.readVaultBase64(source.path);
      const written = await ports.writeHarnessImage(dataBase64, sourceMime);
      quoted.push({
        card: {
          name: written.name,
          sourceMime,
          width: written.width,
          height: written.height,
        },
        source: source.path,
      });
    } catch (e) {
      ports.toast(errorText(e));
    }
  }
  return quoted;
}
