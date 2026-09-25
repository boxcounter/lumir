// doc-title / doc-meta 的纯格式化 helper（M218 A1，M216 gap 表 §2.2 缺失项）：定稿
// 12 张内容屏全部含此块。位置 = fm 区之后正文之前（原型 index.html:871-877 实例 +
// NOTES.md:45）。数据源：标题 = 文件名去扩展名；meta 路径段 = vault 相对父目录；
// 修改时间 = 文件 mtime（经 PreviewContext.fileMtime，后端 fs_file_mtime）。
//
// 独立成纯模块（零依赖、不触 DOM）是为了单测可达：tests/unit 用 Node 类型剥离直接
// 跑 src/*.ts，从 livePreview.ts 导入会拖入整个装饰层依赖图（含参数属性等剥离模式
// 不支持的语法）。

/** doc-title 的显示名：文件 basename 去扩展名（定稿实例：「2026 R&D Strategy」）。 */
export function docTitleFromPath(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** doc-meta 的路径段：vault 相对父目录，层级用「 / 」分隔（定稿实例：
 *  「Work-Tracking-Method / decisions」）。根目录文件返回空串（该段省略）。 */
export function docDirFromPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash).split("/").join(" / ");
}

/** 「修改于」的日期段：同年 `M月D日`、跨年 `YYYY年M月D日`（定稿实例：「修改于 9月22日」）。
 *  now 可注入以便单测钉住跨年分支。 */
export function formatDocDate(mtimeMs: number, now: Date = new Date()): string {
  const d = new Date(mtimeMs);
  return d.getFullYear() === now.getFullYear()
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
