// 图片摘录事务（change add-image-quote-to-chat design §3）：vault → harness 存储 → 卡片。
//
// 跑的是仓里那份真代码（`src/quote-image.ts` + 真 `src/ipc.ts`），只有 Tauri 机器那一侧是假的
// （`tests/unit/harness.ts` 的假后端）。这一层钉四条判据：
//   1. 写盘顺序：每次引用只有「读 vault → 写 harness」两条命令，次序固定；插块在本函数之外、
//      字节落盘之后（先落盘再插块 ⇒ 不留破图卡片）；
//   2. 零 vault 写入：全流程不出现 `fs_write_attachment` / `document_save` 这类写命令；
//   3. 部分失败不整体回滚：坏图只 toast 该张原因，其余照常产出；
//   4. 内容寻址去重是后端契约：同字节两次写回同一名字 ⇒ 前端不复制第二份文件。
//
// 真转码（png→WebP）/ 50MB 上限 / 格式拒绝在 Rust 侧（`harness::attachments` 的单测），这里只
// 断言前端把 `source_mime` 原样交给既有写入口、错误信封原样走既有 toast 文案。

import assert from "node:assert/strict";
import { test } from "node:test";
import { quoteImagesFromVault, productionQuoteImagePorts } from "../../src/quote-image.ts";
import { installBackend } from "./harness.ts";

test("单张引用：读 vault → 写 harness 两条命令、次序固定、零 vault 写入", async () => {
  const backend = installBackend();
  backend.handle("fs_read_attachment", (args) => {
    assert.equal(args.path, "assets/a.png");
    return "QUJD"; // 任意 base64 载荷——转码在 Rust 侧，前端只搬运
  });
  backend.handle("harness_write_image", (args) => {
    assert.equal(args.source_mime, "image/png");
    assert.equal(args.data_base64, "QUJD");
    return { name: "pasted-0123456789abcdef.webp", width: 640, height: 360 };
  });
  const toasts: string[] = [];
  const quoted = await quoteImagesFromVault(
    [{ path: "assets/a.png", rawRef: "![a](assets/a.png)" }],
    productionQuoteImagePorts((text) => toasts.push(text)),
  );

  assert.deepEqual(backend.calls.map((call) => call.cmd), ["fs_read_attachment", "harness_write_image"]);
  assert.deepEqual(toasts, []);
  assert.deepEqual(quoted, [
    {
      card: { name: "pasted-0123456789abcdef.webp", sourceMime: "image/png", width: 640, height: 360 },
      source: "assets/a.png",
    },
  ]);
  // 零 vault 写入：没有第三条命令，尤其没有任何写 vault 的命令。
  assert.equal(backend.countOf("fs_write_attachment"), 0);
  assert.equal(backend.countOf("document_save"), 0);
});

test("部分失败不整体回滚：坏图只 toast 原因，其余照常产出且保持输入顺序", async () => {
  const backend = installBackend();
  backend.handle("fs_read_attachment", (args) => {
    if (args.path === "assets/b.png") {
      throw { code: "attachment_too_large", message: "图片过大", params: { mb: 80, limit: 50 } };
    }
    return "QUJD";
  });
  backend.handle("harness_write_image", (args) => ({
    name: args.data_base64 === "QUJD" ? `pasted-${String(args.source_mime).replace(/\W/g, "")}.webp` : "x",
    width: 1,
    height: 1,
  }));
  const toasts: string[] = [];
  const quoted = await quoteImagesFromVault(
    [
      { path: "assets/a.png", rawRef: "![a](assets/a.png)" },
      { path: "assets/b.png", rawRef: "![b](assets/b.png)" },
      { path: "assets/c.webp", rawRef: "![c](assets/c.webp)" },
    ],
    productionQuoteImagePorts((text) => toasts.push(text)),
  );

  assert.deepEqual(
    quoted.map((image) => image.source),
    ["assets/a.png", "assets/c.webp"],
    "成功的那几张按输入顺序产出，不被坏图打断",
  );
  assert.equal(toasts.length, 1, "一张失败恰好一条原因 toast");
  // 走的是既有 CODE→文案 的渲染（带参数），不是原始 message 的裸串。
  assert.match(toasts[0]!, /80/);
  assert.ok(toasts[0] !== "图片过大", "toast 应是按 code 渲染的人话文案");
});

test("内容寻址去重：同字节两次引用只回同一个名字（前端不复制第二份文件）", async () => {
  const backend = installBackend();
  backend.handle("fs_read_attachment", () => "QUJD");
  backend.handle("harness_write_image", () => ({ name: "pasted-0123456789abcdef.webp", width: 2, height: 2 }));
  const quoted = await quoteImagesFromVault(
    [
      { path: "assets/a.png", rawRef: "![a](assets/a.png)" },
      { path: "copy/a.png", rawRef: "![a](copy/a.png)" },
    ],
    productionQuoteImagePorts(() => {}),
  );

  assert.equal(quoted.length, 2, "两个不同路径各产出一张卡片");
  assert.equal(quoted[0]!.card.name, quoted[1]!.card.name, "同字节 ⇒ 同一内容寻址名（后端去重契约）");
  assert.equal(backend.countOf("fs_write_attachment"), 0, "前端 MUST NOT 为去重自己走 vault 写路径");
});

test("不支持的格式：写入口拒绝 → 不产卡片、只一条人话 toast", async () => {
  const backend = installBackend();
  backend.handle("fs_read_attachment", () => "PHN2Zy8+");
  backend.handle("harness_write_image", () => {
    throw { code: "attachment_type_unsupported", message: "不支持的剪贴板图片格式", params: { type: "image/svg+xml" } };
  });
  const toasts: string[] = [];
  const quoted = await quoteImagesFromVault(
    [{ path: "assets/logo.svg", rawRef: "![[logo.svg]]" }],
    productionQuoteImagePorts((text) => toasts.push(text)),
  );

  assert.deepEqual(quoted, []);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0]!, /image\/svg\+xml/, "原因取后端信封的 type 参数（既有错误文案）");
});

test("空输入：零命令、零 toast", async () => {
  const backend = installBackend();
  const quoted = await quoteImagesFromVault([], productionQuoteImagePorts(() => {}));
  assert.deepEqual(quoted, []);
  assert.deepEqual(backend.calls, []);
});
