// 浮层内容的主题 scope 镜像（M240 实测结论，M277 抽为共用机制）。
//
// 机制（实测，不是推断）：`EditorView.theme` 把主题规则前缀成生成类后注入，生成类落在
// **编辑器根**上——实测编辑器根的 class 列表是 `cm-editor ͼ1 ͼ2 ͼm ͼ14 ͼ5`，规则形如
// `.ͼ1 .cm-lp-inline-code { … }`。因此 preview 主题的**全部**规则都随之 scope 到编辑器根，
// 脱离编辑器根的浮层内容整批不命中——比 M240 design 推断的「CM 基础主题的字体 / 行高不入
// 克隆」更广：行内代码会退回 sans + 13.5px（实测 cell 的 max-content 因此短 9px），链接丢
// accent 色与 ↗︎ 标记的小号字。
//
// 修法是**镜像**而非复制：规则值仍只有 src/preview/theme.ts 一处（单一来源），这里只把
// scope 类搬到浮层内容容器上，让同一批规则重新命中。过滤掉 `cm-` 前缀的类：那是 CM 的结构 /
// 状态类（`cm-editor` / `cm-focused` / …），镜像它们会把 `.cm-editor` 那套布局规则带进内容
// 容器，而浮层要的是主题（取值），不是编辑器布局。守卫是两处浮层的计算样式断言（表格
// 5.4 / 代码块 5.4）——CM 若换掉这套 scope 机制，断言会红，不会静默降级。

export function mirrorThemeScope(source: HTMLElement, container: HTMLElement, baseClass: string): void {
  const mirrored: string[] = [];
  const editor = source.closest(".cm-editor");
  if (editor !== null) {
    for (const cls of [...editor.classList]) {
      if (!cls.startsWith("cm-")) mirrored.push(cls);
    }
  }
  // 每次装内容都从「容器自己的基类 + 本次镜像到的 scope 类」重建，不放任上一次留下的类漂着。
  container.className = [baseClass, ...mirrored].join(" ");
}
