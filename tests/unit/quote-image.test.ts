// 图片摘录事务（change add-image-quote-to-chat design §3；M662 增失败读数与格式预检）：
// vault → harness 存储 → 卡片。
//
// 跑的是仓里那份真代码（`src/quote-image.ts` + 真 `src/ipc.ts`），只有 Tauri 机器那一侧是假的
//（`tests/unit/harness.ts` 的假后端）。这一层钉五条判据：
//   1. 写盘顺序：每次引用只有「读 vault → 写 harness」两条命令，次序固定；插块在本函数之外、
//      字节落盘之后（先落盘再插块 ⇒ 不留破图卡片）；
//   2. 零 vault 写入：全流程不出现 `fs_write_attachment` / `document_save` 这类写命令；
//   3. 部分失败不整体回滚：坏图只报该张原因，其余照常产出；**失败项随结果返回**（M662：
//      调用方据此留持久痕迹，不再只有 3 秒 toast）；
//   4. 内容寻址去重是后端契约：同字节两次写回同一名字 ⇒ 前端不复制第二份文件；
//   5. 格式预检：可引用格式（单一真源 = `src/preview/attachments.ts` 的表）之外的图**不走
//      IPC**，失败文案是引用语境的 D585（不是粘贴语境的 D436「剪贴板」——Alex 现场）。
//
// 真转码（png→WebP）/ 50MB 上限 / 格式拒绝的最后一道闸在 Rust 侧（`harness::attachments`
// 的单测），这里断言前端把 `source_mime` 原样交给既有写入口、错误信封按调用点渲染人话。

import assert from "node:assert/strict";
import { test } from "node:test";
import { quoteImagesFromVault, productionQuoteImagePorts } from "../../src/quote-image.ts";
import type { QuoteImageOutcome } from "../../src/quote-image.ts";
import { installBackend } from "./harness.ts";

/** 成功项（按输入序）的来源列表。 */
function quotedSources(outcomes: readonly QuoteImageOutcome[]): string[] {
  return outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.image.source);
}

/** 失败项的人话列表（按输入序）。 */
function failureTexts(outcomes: readonly QuoteImageOutcome[]): string[] {
  return outcomes
    .filter((outcome) => !outcome.ok)
    .map((outcome) => outcome.failure.text);
}

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
  const outcomes = await quoteImagesFromVault(
    [{ path: "assets/a.png", rawRef: "![a](assets/a.png)" }],
    productionQuoteImagePorts((text) => toasts.push(text)),
  );

  assert.deepEqual(backend.calls.map((call) => call.cmd), ["fs_read_attachment", "harness_write_image"]);
  assert.deepEqual(toasts, []);
  assert.deepEqual(outcomes, [
    {
      ok: true,
      image: {
        card: { name: "pasted-0123456789abcdef.webp", sourceMime: "image/png", width: 640, height: 360 },
        source: "assets/a.png",
      },
    },
  ]);
  // 零 vault 写入：没有第三条命令，尤其没有任何写 vault 的命令。
  assert.equal(backend.countOf("fs_write_attachment"), 0);
  assert.equal(backend.countOf("document_save"), 0);
});

test("部分失败不整体回滚：坏图只报该张原因，其余照常产出且保持输入顺序", async () => {
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
  const outcomes = await quoteImagesFromVault(
    [
      { path: "assets/a.png", rawRef: "![a](assets/a.png)" },
      { path: "assets/b.png", rawRef: "![b](assets/b.png)" },
      { path: "assets/c.webp", rawRef: "![c](assets/c.webp)" },
    ],
    productionQuoteImagePorts((text) => toasts.push(text)),
  );

  assert.deepEqual(
    outcomes.map((outcome) => (outcome.ok ? outcome.image.source : outcome.failure.source.path)),
    ["assets/a.png", "assets/b.png", "assets/c.webp"],
    "结果按输入顺序逐项产出（失败项留在原位，不被打断、不挪位）",
  );
  assert.deepEqual(quotedSources(outcomes), ["assets/a.png", "assets/c.webp"]);
  assert.equal(toasts.length, 1, "一张失败恰好一条原因 toast");
  // 走的是既有 CODE→文案 的渲染（带参数），不是原始 message 的裸串。
  assert.match(toasts[0]!, /80/);
  assert.ok(toasts[0] !== "图片过大", "toast 应是按 code 渲染的人话文案");
  // M662：失败读数随结果返回，调用方据此在卡片 / 输入区留持久痕迹（不是只有 toast）。
  assert.deepEqual(failureTexts(outcomes), toasts, "失败读数与 toast 是同一份渲染");
});

test("内容寻址去重：同字节两次引用只回同一个名字（前端不复制第二份文件）", async () => {
  const backend = installBackend();
  backend.handle("fs_read_attachment", () => "QUJD");
  backend.handle("harness_write_image", () => ({ name: "pasted-0123456789abcdef.webp", width: 2, height: 2 }));
  const outcomes = await quoteImagesFromVault(
    [
      { path: "assets/a.png", rawRef: "![a](assets/a.png)" },
      { path: "copy/a.png", rawRef: "![a](copy/a.png)" },
    ],
    productionQuoteImagePorts(() => {}),
  );

  assert.equal(outcomes.length, 2, "两个不同路径各产出一张卡片");
  assert.ok(outcomes[0]!.ok && outcomes[1]!.ok);
  assert.equal(outcomes[0].image.card.name, outcomes[1].image.card.name, "同字节 ⇒ 同一内容寻址名（后端去重契约）");
  assert.equal(backend.countOf("fs_write_attachment"), 0, "前端 MUST NOT 为去重自己走 vault 写路径");
});

test("不支持的格式（svg）：格式预检直接失败——零 IPC、引用语境文案（D585）、失败读数随结果返回", async () => {
  const backend = installBackend();
  const toasts: string[] = [];
  const outcomes = await quoteImagesFromVault(
    [{ path: "assets/logo.svg", rawRef: "![[logo.svg]]" }],
    productionQuoteImagePorts((text) => toasts.push(text)),
  );

  // 预检拦在 IPC 之前：预览层认 svg（可渲染），但它进不了 harness 存储——读 vault / 写 harness
  // 都是白费，后端写原语仍是最后一道闸（这里断言没有白跑的命令）。
  assert.deepEqual(backend.calls, [], "不可引用的格式不走 IPC");
  assert.equal(outcomes.length, 1);
  assert.ok(!outcomes[0]!.ok);
  assert.equal(outcomes[0].failure.source.path, "assets/logo.svg");
  assert.equal(toasts.length, 1);
  assert.match(toasts[0]!, /image\/svg\+xml/, "原因带 MIME（与后端信封的 type 参数同形）");
  assert.match(toasts[0]!, /暂不支持引用该格式/, "引用语境的人话（D585）");
  assert.ok(!toasts[0]!.includes("剪贴板"), "MUST NOT 用粘贴语境的 D436「剪贴板」措辞（Alex 现场）");
});

test("混合批次：可引用的一张照常走两条命令，svg 只留失败读数（顺序与输入一致）", async () => {
  const backend = installBackend();
  backend.handle("fs_read_attachment", (args) => {
    assert.equal(args.path, "assets/a.png");
    return "QUJD";
  });
  backend.handle("harness_write_image", () => ({
    name: "pasted-0123456789abcdef.webp",
    width: 10,
    height: 10,
  }));
  const toasts: string[] = [];
  const outcomes = await quoteImagesFromVault(
    [
      { path: "assets/a.png", rawRef: "![a](assets/a.png)" },
      { path: "assets/logo.svg", rawRef: "![[logo.svg]]" },
    ],
    productionQuoteImagePorts((text) => toasts.push(text)),
  );

  assert.deepEqual(backend.calls.map((call) => call.cmd), ["fs_read_attachment", "harness_write_image"]);
  assert.equal(outcomes.length, 2);
  assert.ok(outcomes[0]!.ok);
  assert.ok(!outcomes[1]!.ok);
  assert.deepEqual(quotedSources(outcomes), ["assets/a.png"]);
  assert.equal(toasts.length, 1, "只有失败那一张说话");
});

test("后端仍拒绝时的兜底：写入口的 attachment_type_unsupported 也按引用语境渲染（D585）", async () => {
  // 预检按扩展名判（png 可引用），但字节不是合法 png 或后端白名单更窄时，仍是后端的 code——
  // 兜底渲染必须与预检同一条人话，不能让同一个失败按两条路径说两种话。
  const backend = installBackend();
  backend.handle("fs_read_attachment", () => "PHN2Zy8+");
  backend.handle("harness_write_image", () => {
    throw {
      code: "attachment_type_unsupported",
      message: "不支持的剪贴板图片格式",
      params: { type: "image/svg+xml" },
    };
  });
  const toasts: string[] = [];
  const outcomes = await quoteImagesFromVault(
    [{ path: "assets/fake.png", rawRef: "![x](assets/fake.png)" }],
    productionQuoteImagePorts((text) => toasts.push(text)),
  );

  assert.ok(!outcomes[0]!.ok);
  assert.match(toasts[0]!, /暂不支持引用该格式/);
  assert.match(toasts[0]!, /image\/svg\+xml/, "type 取后端信封的 params.type（不让它退化成扩展名推测）");
  assert.ok(!toasts[0]!.includes("剪贴板"));
});

test("空输入：零命令、零 toast、空结果", async () => {
  const backend = installBackend();
  const outcomes = await quoteImagesFromVault([], productionQuoteImagePorts(() => {}));
  assert.deepEqual(outcomes, []);
  assert.deepEqual(backend.calls, []);
});
