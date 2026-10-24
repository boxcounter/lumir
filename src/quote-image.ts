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
//   - **部分失败不整体回滚**：一张失败（格式不支持 / 超限 / 读写失败）只报该张的原因，
//     其余照常返回；n 张里坏了 m 张时调用方拿到 n-m 张卡片、m 条失败读数。
//
// M662（change quote-pipeline-consistency-oct24，Alex 2026-10-24 反馈 #3）：
//   - **失败留痕**：结果数组里失败的条目不再是「只 toast 就消失」——失败读数（已渲染好的人话）
//     随结果返回，调用方在引用卡片上 / 输入区留下持久状态（D586）。数组形态保持不变（装配层
//     的判空与直传契约不动）。
//   - **按调用点分码**：`attachment_type_unsupported` 在引用语境读 D585（「暂不支持引用该格式」）
//     而不是粘贴语境的 D436（「不支持的剪贴板图片格式」）——引用不是粘贴，见 quoteImageErrorText。
//   - **格式预检**：可引用格式的单一真源在 `src/preview/attachments.ts`（与 Rust 写入口对账），
//     不可引用的格式不走 IPC（读 vault + 写 harness 都是白费）；后端写原语仍是最后一道闸。
//
// 本模块是纯 I/O 编排（零 DOM）：tests/unit 用假 Tauri 后端直接跑真 ipc + 真转码面契约
//（`tests/unit/quote-image.test.ts`）。

import { errorText, t } from "./copy";
import { fsReadAttachment, harnessWriteImage } from "./ipc";
import { extensionOf, isQuotableImageName, mimeTypeOf } from "./preview/attachments";
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

/** 一张引用失败的读数（M662）：`source` 是没进来的那张图，`text` 是已按引用语境渲染好的人话
 *  （调用方直接上屏 / 上留痕；本模块之外不再二次映射 code）。 */
export interface QuoteImageFailure {
  source: QuoteImageSource;
  text: string;
}

/** 一次引用的结果项：成功 = 卡片，失败 = 留痕读数（顺序与输入源一致）。
 *
 *  保持**数组**形态是契约的一部分：装配层（`src/main.ts`）只做 `length === 0` 判空与直传，
 *  失败条目与成功条目同数组，装配层因此不需要改一行（M662 的改动面不碰装配层）。 */
export type QuoteImageOutcome =
  | { readonly ok: true; readonly image: QuotedImage }
  | { readonly ok: false; readonly failure: QuoteImageFailure };

/** 事务的三个出口（装配层注入；单测直接喂替身）。 */
export interface QuoteImagePorts {
  /** 读 vault 内图片，返回 base64（`fs_read_attachment` 契约）。 */
  readVaultBase64(path: string): Promise<string>;
  /** 写 harness 侧内容寻址存储（`harness_write_image` 契约）。 */
  writeHarnessImage(dataBase64: string, sourceMime: string): Promise<HarnessWrittenImage>;
  /** 人话提示出口（按附件失败 code 渲染，见 `quoteImageErrorText`）。 */
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
 * 引用路径的失败人话（M662 的按调用点分码）：写原语与粘贴路径共用，但**措辞随语境走**——
 *   - `attachment_type_unsupported` → D585（引用语境；粘贴语境仍读 D436 的「剪贴板」措辞）。
 *     这是 survey §4.3 记的现场：Alex 点图片「引用」看到「不支持的剪贴板图片格式」。
 *   - 其余 code 与粘贴路径同一张 `ERROR_COPY` 表（尺寸 / 解码 / 写失败与语境无关）。
 *
 *  `fallbackMime` 只在后端信封缺 `type` 参数时兜底（预检路径直接给 MIME，不经信封）。
 */
export function quoteImageErrorText(error: unknown, fallbackMime: string): string {
  const envelope = error as { code?: unknown; params?: { type?: unknown } | null } | null;
  if (typeof envelope === "object" && envelope !== null && envelope.code === "attachment_type_unsupported") {
    const type = envelope.params?.type;
    return t("D585", { type: typeof type === "string" ? type : fallbackMime });
  }
  return errorText(error);
}

/**
 * 按文档序把若干 vault 图搬进 harness 存储，返回逐张结果（成功项可插入、失败项留痕）；
 * 单张失败只报该张、不阻断其余（见文件头）。
 */
export async function quoteImagesFromVault(
  sources: readonly QuoteImageSource[],
  ports: QuoteImagePorts,
): Promise<QuoteImageOutcome[]> {
  const outcomes: QuoteImageOutcome[] = [];
  for (const source of sources) {
    // sourceMime 取既有扩展名注册表（单一真源），不新写 MIME 表。
    const sourceMime = mimeTypeOf(extensionOf(source.path)) ?? "application/octet-stream";
    // 格式预检（M662）：可引用格式的判定面只有一处（preview/attachments.ts 的
    // QUOTABLE_IMAGE_EXTENSIONS，与 Rust 写入口的表对账）——预览层认、写入口不收的格式在这里
    // 就以引用语境的人话失败，不白跑两条 IPC。后端写原语仍会自证（它是最后一道闸）。
    if (!isQuotableImageName(source.path)) {
      const failure: QuoteImageFailure = { source, text: t("D585", { type: sourceMime }) };
      ports.toast(failure.text);
      outcomes.push({ ok: false, failure });
      continue;
    }
    try {
      const dataBase64 = await ports.readVaultBase64(source.path);
      const written = await ports.writeHarnessImage(dataBase64, sourceMime);
      outcomes.push({
        ok: true,
        image: {
          card: {
            name: written.name,
            sourceMime,
            width: written.width,
            height: written.height,
          },
          source: source.path,
        },
      });
    } catch (e) {
      const failure: QuoteImageFailure = { source, text: quoteImageErrorText(e, sourceMime) };
      ports.toast(failure.text);
      outcomes.push({ ok: false, failure });
    }
  }
  return outcomes;
}
