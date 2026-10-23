// 编辑器事务注解的唯一出处（change cursor-visibility-oct23 的 2.7）。
//
// `trustedLoad` 标记「应用自己的装载事务」：整篇替换 + 选区复位，不属于用户编辑。
// 消费方有两处——
//   · `src/editor.ts` 的 `changeFilter`（不可编辑会话放行装载）与 `dispatchTrusted` /
//     `loadedState`（给装载事务打标）；
//   · `src/preview/livePreview.ts` 的 `frontmatterCaretFilter`（装载事务不走边界光标分流，
//     由装载路径显式把初始光标放到正文首行——否则「打开只有 frontmatter 的文档」会立刻
//     变成源码）。
//
// 为什么住在叶子模块而不是留在 editor.ts：livePreview 也要读它，而 editor → livePreview
// 的 import 关系已经存在，反向 import 会成环；注解只依赖 @codemirror/state，两边都能 import，
// 也不会出现第二份定义（REVIEW.md「同一语义两处真源」条）。
import { Annotation } from "@codemirror/state";

export const trustedLoad = Annotation.define<boolean>();
