# Tasks: align-editor-live-preview-spec

补记 change：下列任务按「已存在的实现」逐条核对，不新增代码。

## 1. 与现状矛盾的表述

- [x] 1.1 核对「M1 只读口径」与实现的关系：md 模式可编辑由 `src/editor.ts:1220-1222` 的三条扩展决定（`EditorView.editable.of(mode === "md")` / `EditorState.readOnly.of(mode !== "md")` / `contentAttributes` 的 `aria-readonly`），只读合同的对象是非 md 文档
- [x] 1.2 核对「MUST NOT 实现光标所在行 reveal 源码」与实现的关系：`src/preview/livePreview.ts` 的 `touchesSelection` / `revealInlineSource` 对 callout 行、链接（整条）、frontmatter、math/mermaid widget、分隔线行生效，均为已发布行为
- [x] 1.3 按现行口径重写 `live preview 装饰层` requirement 的编辑态段落（MODIFIED）
- [x] 1.4 归档后直接重写 living spec 的 Purpose（去掉「M1 只读口径」并写明编辑态口径）——`## Purpose` 的增量只在 capability 创建时被读取，CLI 在 validate 提示里给出同一指引

## 2. M138 渲染保真三件套补记

- [x] 2.1 分隔线：`src/preview/livePreview.ts` 的 `HorizontalRuleWidget`（`aria-label="分隔线"`、frontmatter 内剪枝、选区触及该行则显露源码）
- [x] 2.2 围栏代码块着色：`src/preview/code.ts`（21 种 legacy-modes 语言 + 别名表；info string 缺失或不在表内不着色；mermaid 走自身路径；tag 解析与 code 模式同一套）
- [x] 2.3 引用内列表：`src/preview/lists.ts:192-206`（行首连续 `>` 跳过后按常规列表判定，与正文列表同一套标记 widget 与对齐）
- [x] 2.4 三项写成一条 ADDED requirement，各带 scenario；条款只描述已发布行为，不引入新承诺
- [x] 2.5 证据在案：真机场景 `render-markdown`（横线读屏名与 `editor.not "---"`、围栏源码逐字保留、未收录语言纯文本、引用内列表按常规列表渲染）；配色与几何由 `tests/visual/scenes/render-{hr,codeblock,quote-list}.spec.ts` 的计算色/几何断言守

## 3. 验证

- [x] 3.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 3.2 归档后核对 living spec：`editor-live-preview` 的 Purpose 与 `live preview 装饰层` requirement 不再含只读口径表述，新增 requirement 落在文末且与既有 requirement 无冲突
- [x] 3.3 归档评审（节点 2）：由 M150 批次授权执行（Alex 对整体 review 的裁决「好，采纳。你动手吧」），本 change 随该批次归档
