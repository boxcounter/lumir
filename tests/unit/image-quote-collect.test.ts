// 选区图片枚举（change add-image-quote-to-chat design §2）：`collectImageRefs` 的判据逐条对账。
//
// 这一层钉的是「枚举与渲染层同判据」这一条本身——两种语法各命中、代码块内不命中、笔记嵌入跳过、
// 解析不到跳过、表格内不命中（渲染层只放行行内 code / 强调系 / Link / URL）、远程引用跳过、
// 同路径去重、文档序、选区边界。每条判据都配一条**必须让它落空**的反向输入，避免「看着有覆盖、
// 实际不判任何东西」（REVIEW.md「断言等价于子串」条）。
//
// 真 <img> 的加载 / 占位在此造不出来：占位不可引用的结构面归视觉场景
//（tests/visual/scenes/m633-image-quote.spec.ts）与验收场景 161。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { collectImageRefs } from "../../src/preview/attachments.ts";
import type { AttachmentProvider, ImageRefContext } from "../../src/preview/attachments.ts";
import type { LinkResolveResult } from "../../src/bindings/LinkResolveResult.ts";
import { completeTree } from "./syntax-tree.ts";

const MD = [markdown({ base: markdownLanguage, extensions: [GFM] })];

function stateOf(doc: string): EditorState {
  return completeTree(EditorState.create({ doc, extensions: MD }));
}

/** 生产 provider 的替身：只实现枚举用到的 resolveByName（readDataUrl 不在本层）。 */
function providerOf(names: Record<string, string>): AttachmentProvider {
  return {
    resolveByName: (name) => names[name] ?? null,
    readDataUrl: async () => "data:,",
  };
}

function ctxOf(options: {
  names?: Record<string, string>;
  file?: string;
  resolver?: ImageRefContext["wikilinkResolver"];
  noProvider?: boolean;
}): ImageRefContext {
  return {
    currentFilePath: () => options.file ?? "notes/doc.md",
    attachmentProvider: () => (options.noProvider === true ? null : providerOf(options.names ?? {})),
    wikilinkResolver: options.resolver ?? (() => null),
  };
}

const resolveResult = (path: string | null, embed: "attachment" | "note" | null, status = "resolved"): LinkResolveResult => ({
  status: status as LinkResolveResult["status"],
  path,
  candidates: [],
  embed_target: embed,
  anchor: { status: "none", heading: null, line: null },
});

const DOC = [
  "# 图",
  "",
  "第一段 ![std](assets/a.png) 结束。",
  "",
  "第二段 ![[b.png]] 与 ![inline](images/c.png) 混排。",
  "",
  "```",
  "![[code.png]]",
  "![code](assets/code.png)",
  "```",
  "",
  "![[note]]",
  "",
  "![remote](https://example.com/x.png)",
  "",
  "| 列 |",
  "| --- |",
  "| ![cell](assets/cell.png) |",
  "",
  "尾段。",
  "",
].join("\n");

test("两种语法各命中：标准 md 相对解析 + ![[...]] 文件名唯一匹配；文档序", () => {
  const state = stateOf(DOC);
  const refs = collectImageRefs(state, 0, state.doc.length, ctxOf({ names: { "b.png": "assets/b.png" } }));
  assert.deepEqual(
    refs.map((ref) => ref.path),
    ["notes/assets/a.png", "assets/b.png", "notes/images/c.png"],
  );
  // rawRef 是文档里的引用原文（人侧 / 错误提示用）。
  assert.equal(refs[0]!.rawRef, "![std](assets/a.png)");
  assert.equal(refs[1]!.rawRef, "![[b.png]]");
  // 范围就是引用源码的范围（选区「只有图片」判定依赖它）。
  assert.equal(state.doc.sliceString(refs[1]!.from, refs[1]!.to), "![[b.png]]");
});

test("排除面：代码块内两种语法、笔记嵌入、远程引用、表格内图片都不产引用", () => {
  const state = stateOf(DOC);
  const refs = collectImageRefs(state, 0, state.doc.length, ctxOf({ names: { "b.png": "assets/b.png" } }));
  const paths = refs.map((ref) => ref.path);
  assert.ok(!paths.some((path) => path.endsWith("code.png")), "代码块内的引用不应命中");
  assert.ok(!paths.some((path) => path.includes("n.md")), "![[note]] 是笔记嵌入，不是图片");
  assert.ok(!paths.some((path) => path.includes("x.png")), "远程 http(s) 引用渲染不出 <img>，不可引用");
  assert.ok(!paths.some((path) => path.includes("cell")), "表格内的标准图片不渲染（表格只放行行内格式 / 链接）");
  // 反向验证：把表格换成普通段落，同一张图就命中——证明上面那条不是空转。
  const outside = "![cell](assets/cell.png)\n";
  const hit = collectImageRefs(stateOf(outside), 0, outside.length, ctxOf({}));
  assert.deepEqual(hit.map((ref) => ref.path), ["notes/assets/cell.png"]);
});

test("选区边界：完全在选区之外的图片不命中；与选区部分相交的整张图命中", () => {
  const doc = "前言\n\n![a](assets/a.png)\n\n后记\n";
  const state = stateOf(doc);
  const imageFrom = doc.indexOf("![a]");
  // 选区止于图片引用之前：不命中。
  assert.deepEqual(collectImageRefs(state, 0, imageFrom, ctxOf({})), []);
  // 选区起点落在引用源码内部（1 个字符）：整张图命中。
  const refs = collectImageRefs(state, imageFrom + 1, imageFrom + 3, ctxOf({}));
  assert.deepEqual(refs.map((ref) => ref.path), ["notes/assets/a.png"]);
  // 空选区 / 反向区间：不产出（hi <= lo 早退）。
  assert.deepEqual(collectImageRefs(state, imageFrom, imageFrom, ctxOf({})), []);
  // 选区止于引用起点同一位（无正长度交集）：不命中。
  assert.deepEqual(collectImageRefs(state, 0, imageFrom, ctxOf({})), []);
});

test("同一路径去重：标准图片与 ![[...]] 指向同一张图时只引一次", () => {
  const doc = "![a](assets/a.png)\n\n![[assets/a.png]]\n";
  // 当前文件在 vault 根（"doc.md"）：两条引用解析到同一个 vault 相对路径。
  const refs = collectImageRefs(stateOf(doc), 0, doc.length, ctxOf({ file: "doc.md" }));
  assert.equal(refs.length, 1);
  assert.equal(refs[0]!.path, "assets/a.png");
  assert.equal(refs[0]!.rawRef, "![a](assets/a.png)", "去重保留文档序第一条");
});

test("解析器在线的分支：resolved / ambiguous（已选定目标）命中；note / pending / unresolved 跳过", () => {
  const doc = "![[good.png]] ![[note]] ![[pend.png]] ![[gone.png]] ![[pick.png]]\n";
  const state = stateOf(doc);
  const calls: string[] = [];
  const resolver = (raw: string): LinkResolveResult | undefined => {
    calls.push(raw);
    switch (raw) {
      case "![[good.png]]":
        return resolveResult("assets/good.png", "attachment");
      case "![[pick.png]]":
        return resolveResult("assets/pick.png", "attachment", "ambiguous");
      case "![[note]]":
        return resolveResult("notes/n.md", "note");
      case "![[gone.png]]":
        return resolveResult(null, null, "unresolved");
      default:
        return undefined;
    }
  };
  const refs = collectImageRefs(state, 0, doc.length, ctxOf({ resolver: () => ({ resolve: resolver }) }));
  // ambiguous 的 path 是「chosen 目标」，渲染层对 embed 只看 path ⇒ 同样命中（与渲染层同判据）。
  assert.deepEqual(refs.map((ref) => ref.path), ["assets/good.png", "assets/pick.png"]);
  // 解析器是语义真源：五条 embed 都问过它（不是只问命中的那条）。
  assert.deepEqual(calls, ["![[good.png]]", "![[note]]", "![[pend.png]]", "![[gone.png]]", "![[pick.png]]"]);
});

test("附件能力未接线：一律不产引用（渲染层此时全是占位）", () => {
  const doc = "![a](assets/a.png)\n";
  assert.deepEqual(collectImageRefs(stateOf(doc), 0, doc.length, ctxOf({ noProvider: true })), []);
});

test("文件名匹配不到 / 非图片扩展：跳过且不阻断其余引用", () => {
  const doc = "![[missing.png]] ![md](notes/other.md) ![ok](assets/ok.png)\n";
  const refs = collectImageRefs(stateOf(doc), 0, doc.length, ctxOf({}));
  assert.deepEqual(refs.map((ref) => ref.path), ["notes/assets/ok.png"]);
});
