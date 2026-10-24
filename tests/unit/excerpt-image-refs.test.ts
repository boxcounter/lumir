// 摘录原文里的图片引用数（M662，change quote-pipeline-consistency-oct24 的 D587 角标）。
//
// 判据与选区图片枚举（`collectImageRefs`）同源：标准 md 图片走 GFM 语法树、`![[…]]` embed 走
// findWikilinkSpans；代码上下文 / 表格内 / 远程 http(s) / 非图片扩展都不算，同一目标只算一次。
// 这里钉的是**派生读数**（人侧角标），不是引用事务——事务的失败读数在 tests/unit/quote-image.test.ts。
//
// 反向输入（断言有区分度）：代码块 / 行内代码 / 表格 / 远程 / 非图片扩展这五类必须判 0；
// 若实现退化成「数 `!` 或数 `[` 的裸正则」，它们会立刻变红。

import assert from "node:assert/strict";
import { test } from "node:test";
import { countExcerptImageRefs } from "../../src/preview/attachments.ts";

test("空文本 / 无图片：0", () => {
  assert.equal(countExcerptImageRefs(""), 0);
  assert.equal(countExcerptImageRefs("只有文字，没有图。"), 0);
});

test("标准 md 图片：按引用次数计（不同目标各算一次）", () => {
  assert.equal(countExcerptImageRefs("前 ![a](attachments/a.png) 后"), 1);
  assert.equal(
    countExcerptImageRefs("![a](attachments/a.png) 与 ![b](attachments/b.webp)"),
    2,
  );
  // 标题语法不影响 URL 取点。
  assert.equal(countExcerptImageRefs('![a](attachments/a.png "标题")'), 1);
});

test("同一目标只算一次（与枚举侧的按路径去重同口径）", () => {
  assert.equal(
    countExcerptImageRefs("![a](attachments/a.png) 再引一次 ![b](attachments/a.png)"),
    1,
  );
});

test("`![[…]]` embed：图片扩展算、笔记嵌入不算、非图片扩展不算", () => {
  assert.equal(countExcerptImageRefs("![[a.png]]"), 1);
  assert.equal(countExcerptImageRefs("![[a.png|300]]"), 1, "竖线后是显示参数，只取目标");
  assert.equal(countExcerptImageRefs("![[note]]"), 0, "笔记嵌入渲染不出 <img>，不可引用");
  assert.equal(countExcerptImageRefs("![[archive.zip]]"), 0);
  assert.equal(countExcerptImageRefs("[[a.png]]"), 0, "普通 wikilink 不是图片");
});

test("两种语法混合：各按自己的目标去重后相加", () => {
  assert.equal(countExcerptImageRefs("![](attachments/a.png) 与 ![[b.webp]]"), 2);
  // 同一张图两种写法（无目录上下文时两种解析都落到 `a.png`）：只算一次。
  assert.equal(countExcerptImageRefs("![](a.png) 与 ![[a.png]]"), 1);
});

test("代码上下文不算：围栏代码块 / 行内代码里的图片语法只是文字", () => {
  assert.equal(countExcerptImageRefs("```\n![a](attachments/a.png)\n![[b.png]]\n```"), 0);
  assert.equal(countExcerptImageRefs("行内 `![a](attachments/a.png)` 只是代码"), 0);
  assert.equal(countExcerptImageRefs("~~~\n![](a.png)\n~~~"), 0);
});

test("表格内的标准图片不算（渲染层跳过，枚举侧同判据）", () => {
  assert.equal(
    countExcerptImageRefs("| 列 | 值 |\n| --- | --- |\n| 图 | ![a](attachments/a.png) |"),
    0,
  );
});

test("远程 http(s) 引用不算（没有字节来源，渲染层只给幻影占位）", () => {
  assert.equal(countExcerptImageRefs("![a](https://example.com/a.png)"), 0);
  assert.equal(countExcerptImageRefs("![a](http://example.com/a.png)"), 0);
});

test("非图片扩展不算", () => {
  assert.equal(countExcerptImageRefs("![a](attachments/a.pdf)"), 0);
  assert.equal(countExcerptImageRefs("![a](attachments/noext)"), 0);
});

test("相对路径按摘录来源文档解析（与 resolveImagePath 同一口径）", () => {
  // 同一段文本、不同来源文档：解析结果不同，但都仍是图片 → 计数不变。
  assert.equal(countExcerptImageRefs("![a](assets/a.png)", "notes/doc.md"), 1);
  assert.equal(countExcerptImageRefs("![a](../assets/a.png)", "notes/deep/doc.md"), 1);
  // 逃逸 vault 根的回退解析也是「能解析到一张图」——计数只关心是不是图片引用。
  assert.equal(countExcerptImageRefs("![a](../../assets/a.png)", "notes/doc.md"), 1);
});

test("多行摘录：图片在第二行同样计数", () => {
  assert.equal(countExcerptImageRefs("第一行文字\n第二行 ![](attachments/a.png) 结尾"), 1);
});

test("引用块（blockquote）里的图片算（渲染层会画出来）", () => {
  assert.equal(countExcerptImageRefs("> 引用里的图 ![a](attachments/a.png)"), 1);
});

test("svg 照样计数（角标说的是摘录里有什么，与能不能引用无关）", () => {
  // 读数是**派生**的：`![[logo.svg]]` 先由 M662 的失败面覆盖，M666 起 svg 走栅格化成功路径——
  // 两条路径下这条读数都不变（它只回答「摘录里原本有几张图」）。
  assert.equal(countExcerptImageRefs("![[logo.svg]]"), 1);
  assert.equal(countExcerptImageRefs("![](attachments/logo.svg)"), 1);
});
