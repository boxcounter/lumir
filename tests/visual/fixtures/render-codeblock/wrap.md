# 折行口径

正文段落：一行普通长度的句子，用来对照折行开关只作用于超长行。

超长正文行（刻意超过阅读栏宽）：折行口径的默认值来自配置的 editor.line_wrap，运行期翻转由 view.toggle-line-wrap 承担；这一行刻意写得很长，长到远超阅读栏宽，因此默认折行时它应折成多个视觉行，关掉文件级折行时它应保持单行、由编辑区横向平移到达，两种口径都必须让行尾这段标记可达：PROSE-END-MARK。

```text
{"vault":"Everything-copy","file":"Logbook/2026-09/2026-09-18.md","note":"the quick brown fox jumps over the lazy dog 0123456789","flag":true,"count":42,"tail":"CODE-END-MARK"}
```

```text
short code line
```

> 引用块里的围栏代码块（嵌套语境）：
>
> ```text
> {"nested":"true","note":"a long nested code line that must also be scrollable inside its own container","tail":"NESTED-END-MARK"}
> ```

尾段：代码块的横滚容器不得改变下方内容的纵向位置。
