# docs/specs/wikilink/

- [link-semantics.md](link-semantics.md) — Wikilink 链接语义 spec（冻结 v1.0）：兼容性本体（ADR 0003 §4），覆盖 `[[note]]` / `[[note|alias]]` / `[[note#heading]]` 的解析与跳转、未创建链接、名称→路径解析、`![[...]]` 双语义判别与明确排除项。
- 机器可执行形态（合成 fixture 集）：[tests/wikilink-fixtures/](../../../tests/wikilink-fixtures/)。
- 实现提案：[openspec/changes/add-wikilink/](../../../openspec/changes/add-wikilink/)。

措辞纪律（ADR 0003 §5）：本项目"兼容 Obsidian 方言的阅读与导航语义"，不声称"兼容 Obsidian"。
