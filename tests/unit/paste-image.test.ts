// 剪贴板图片粘贴的前端判据（M416，change paste-clipboard-image）。
//
// 被测面是 `src/paste-image.ts` 的 **DOM 无关纯判据**：拦截判定（md + 可编辑 + 含 image/* 文件项）、
// 落盘目录推导、引用插入的块级形态、以及落盘段对端口的调用与失败透传。真正的 `EditorView` /
// paste 事件需要 DOM 与 WKWebView，归 `scripts/acceptance` 的场景；本层只钉「照着这个形状接，
// 行为就是这个」。
//
// 判据面的一处硬约束（M415 真机探针，design §2 随批修订）：**检测面是 `clipboardData.items`，
// 不是 `types`**——本仓 WKWebView 的 types 从不出现 `image/*`（文件项一律叫 `"Files"`），
// 因此用例直接喂 items 形状，而不是喂 types。

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachmentDirOf,
  imagePasteItemIndex,
  pastedImageInsertion,
  writePastedImage,
} from "../../src/paste-image.ts";

const IMAGE_PNG = { kind: "file", type: "image/png" };
const IMAGE_JPEG = { kind: "file", type: "image/jpeg" };
const TEXT = { kind: "string", type: "text/plain" };
const PDF = { kind: "file", type: "application/pdf" };
const EDITABLE_MD = { mode: "md", editable: true } as const;

test("拦截判定：md + 可编辑且含 image/* 文件项才拦", () => {
  assert.equal(imagePasteItemIndex(EDITABLE_MD, [IMAGE_PNG]), 0, "单图剪贴板");
  // 图文同板取**首个 image file 项**（已定「图优先」，design §1）——string 项不算。
  assert.equal(imagePasteItemIndex(EDITABLE_MD, [TEXT, IMAGE_PNG, IMAGE_JPEG]), 1);
  // 只取第一张：多图剪贴板不排队（proposal 非目标）。
  assert.equal(imagePasteItemIndex(EDITABLE_MD, [IMAGE_JPEG, IMAGE_PNG]), 0);
});

test("拦截判定：非图片 / 非 md 模式 / 只读一律不消费", () => {
  // 降级条款：纯文本剪贴板走默认粘贴，拦截层 MUST NOT 消费事件。
  assert.equal(imagePasteItemIndex(EDITABLE_MD, [TEXT]), null);
  assert.equal(imagePasteItemIndex(EDITABLE_MD, []), null);
  // 非 image 的文件项（pdf 附件）同样不拦。
  assert.equal(imagePasteItemIndex(EDITABLE_MD, [PDF]), null);
  // code / text 模式编辑器不触发。
  assert.equal(imagePasteItemIndex({ mode: "code", editable: true }, [IMAGE_PNG]), null);
  // 只读文档（结构性只读，见 EditorHandle.setSessionEditable）不触发——包括剪贴板有图片时。
  assert.equal(imagePasteItemIndex({ mode: "md", editable: false }, [IMAGE_PNG]), null);
});

test("落盘目录推导：当前文件同目录，无路径退 vault 根", () => {
  assert.equal(attachmentDirOf("notes/x.md"), "notes");
  assert.equal(attachmentDirOf("notes/sub/deep/y.md"), "notes/sub/deep");
  assert.equal(attachmentDirOf("x.md"), "", "vault 根下的笔记 → 根");
  assert.equal(attachmentDirOf(undefined), "", "未保存新文档 → vault 根");
});

test("插入事务形态：![[name]] 块级独占一行", () => {
  const doc = "abc";
  // 行中光标：前后各补一个换行，引用被顶成独立一行。
  assert.deepEqual(pastedImageInsertion(doc, 1, 1, "pasted-1.webp"), {
    from: 1,
    to: 1,
    insert: "\n![[pasted-1.webp]]\n",
  });
  // 已在空行：不补（Obsidian 同款）。
  assert.deepEqual(pastedImageInsertion("a\n\nb", 2, 2, "x.webp"), {
    from: 2,
    to: 2,
    insert: "![[x.webp]]",
  });
  // 文档首 / 文档尾：只补缺的那一侧。
  assert.deepEqual(pastedImageInsertion(doc, 0, 0, "x.webp"), {
    from: 0,
    to: 0,
    insert: "![[x.webp]]\n",
  });
  assert.deepEqual(pastedImageInsertion(doc, 3, 3, "x.webp"), {
    from: 3,
    to: 3,
    insert: "\n![[x.webp]]",
  });
  // 有选区：替换选区（与键入同权），两端都在文档首尾时不补换行。
  assert.deepEqual(pastedImageInsertion(doc, 0, 3, "x.webp"), {
    from: 0,
    to: 3,
    insert: "![[x.webp]]",
  });
});

test("落盘段：Blob → base64 → 端口写；失败原样抛出给调用方 toast", async () => {
  // PNG 魔数（8 字节）——base64 是公开的固定值，断言不被实现细节污染。
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const blob = new Blob([signature], { type: "image/png" });
  const calls: Array<{ dirRel: string; dataBase64: string; sourceMime: string }> = [];
  const port = {
    write: async (dirRel: string, dataBase64: string, sourceMime: string) => {
      calls.push({ dirRel, dataBase64, sourceMime });
      return { path: `${dirRel}/pasted-abc.webp`, name: "pasted-abc.webp" };
    },
  };
  const written = await writePastedImage(port, "notes", blob);
  assert.equal(written.name, "pasted-abc.webp");
  assert.equal(calls.length, 1, "一次粘贴恰好一次落盘调用");
  assert.deepEqual(calls[0], {
    dirRel: "notes",
    dataBase64: "iVBORw0KGgo=",
    sourceMime: "image/png",
  });

  // 失败路径：后端错误信封**原样**抛出（调用方 `port.toast(error)` 按 code 渲染；
  // 若这里被吞掉或包一层，前端就再也拿不到 code，只剩一句兜底人话）。
  const failure = { code: "attachment_too_large", message: "图片过大：80MB，超过 50MB 上限" };
  const failingPort = {
    write: async () => {
      throw failure;
    },
  };
  let caught: unknown;
  try {
    await writePastedImage(failingPort, "", blob);
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, failure, "端口错误必须原样传出");
});
