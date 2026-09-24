// 两处列表浮层的输入筛选（change list-filter）：匹配判定、查询状态与三条共用文案的**唯一**实现。
//
// 为什么单独一个模块（REVIEW.md 第 8 条）：`s 开头` 这类语义一旦在两处各写一份，就会漂移成
// 「大纲是子串、vault 是前缀」。规则本体在 `openspec/specs/toc-outline` 的两条 ADDED requirement
// （「浮层输入筛选的匹配语义」与「浮层输入筛选的交互（输入框、焦点与退出）」），`vault-workspace`
// 引用它们；**实现也只有这一份**——两个浮层 import 同一个 `isMatch` / `filterIndices`，以及同一组
// 文案常量。
//
// 本模块是纯逻辑：零 DOM、零 CodeMirror、零 IPC，可被 tests/unit 直接 import（那一层的分工见
// tests/unit/README.md）。DOM 与焦点迁移留在两处浮层自己那一层。
//
// 口径（逐条对齐 spec，别在调用方再解释一遍）：
//   - 匹配 = 大小写折叠后的**子串包含**（不是前缀、不是模糊/子序列）；查询为空一律命中（全量态）；
//   - 匹配对象是条目的**显示文本**本身（与界面上逐字相同），MUST NOT 另造一份「可搜文本」；
//   - 多字节安全：走字符串包含语义（UTF-16 序列），不按字节或码点切；不做全角/半角、简繁归一，
//     不检索拼音；
//   - 结果集是**源条目数组的下标数组**（升序），调用方的游标 / 当前项高亮 / 动作落点都从它取；
//   - 不做结果重排、不做打分、不做命中高亮。

/** 大小写折叠：匹配前文本与查询串各做一次。只对存在大小写的字符有效（CJK 原样）。 */
export function foldCase(value: string): string {
  return value.toLowerCase();
}

/** 单条判定：查询为空即命中（空查询 = 全量态，不特判调用方）。 */
export function isMatch(text: string, query: string): boolean {
  if (query === "") return true;
  return foldCase(text).includes(foldCase(query));
}

/** 结果集：`texts` 里匹配 `query` 的下标（升序 = 源顺序，MUST NOT 重排）。 */
export function filterIndices(texts: readonly string[], query: string): number[] {
  const visible: number[] = [];
  for (let index = 0; index < texts.length; index += 1) {
    if (isMatch(texts[index] as string, query)) visible.push(index);
  }
  return visible;
}

export interface ListFilter {
  /** 当前查询串（浮层关闭后为空）。 */
  readonly query: string;
  /** 结果集：源条目数组的下标，升序。**唯一**的「哪些条目可见」真源。 */
  readonly visible: readonly number[];
  /** 置入新查询并重算结果集；返回本次结果集（调用方不必再算一遍）。 */
  setQuery(query: string, texts: readonly string[]): readonly number[];
  /**
   * 游标起点（**结果集下标**，不是源下标）：
   *   - 查询非空 → 首条命中（结果集为空时 -1，调用方据此得到「无命中 = 没有游标」）；
   *   - 查询为空 → 调用方给的全量态起点（`fullStart`，即源下标；空查询下结果集与源同序同长，
   *     两个空间逐项对应），`fullStart` 不在结果集里（无当前段 / 无当前项，传 -1）时落第一条。
   */
  cursorStart(fullStart: number): number;
  /** 丢弃查询与结果集（浮层关闭时调用）：下次打开从空查询与全量态起点开始。 */
  reset(): void;
}

/** 一处浮层一份（两处各持一个实例；状态本身是纯数据，可脱离 DOM 单测三条转移）。 */
export function createListFilter(): ListFilter {
  let query = "";
  let visible: number[] = [];
  return {
    get query() {
      return query;
    },
    get visible() {
      return visible;
    },
    setQuery(next, texts) {
      query = next;
      visible = filterIndices(texts, next);
      return visible;
    },
    cursorStart(fullStart) {
      if (query !== "") return visible.length === 0 ? -1 : 0;
      const index = visible.indexOf(fullStart);
      return index >= 0 ? index : 0;
    },
    reset() {
      query = "";
      visible = [];
    },
  };
}

// ---------------------------------------------------------------------------
// 共用文案（单一来源 文案-Copy.md 的 D117–D119）
//
// 两处浮层引用**同一组常量**，MUST NOT 在各处再写一份字面量：这三条是筛选唯一的可发现性出口
// （vault 浮层没有提示行，大纲的提示行只覆盖导航键），漂移会让两处对同一个动作说两种话。
// ---------------------------------------------------------------------------

/** D117 无命中提示（浮层保持打开，显示在列表区）。 */
export const NO_MATCH_TEXT = "没有匹配的条目";
/** D118 输入框占位（可发现性的主要出口）。 */
export const FILTER_PLACEHOLDER = "输入以筛选";
/** D119 输入框读屏名。 */
export const FILTER_LABEL = "筛选";
