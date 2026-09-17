// 词法原语：markdown 原文上的小型扫描工具（M152 收口）。
//
// 原先 runLen/findClosingRun 在 wikilinks.ts 与 math.ts 里各有一份逐字相同的副本，
// 两边服务的都是同一条规则——inline code run 内的语法（`[[...]]` / `$...$`）不识别。
// 两份副本意味着改一处会漏另一处，且两边对「反引号串多长才算闭合」的判定必须永远一致。
//
// 为什么单独一个模块：两个消费方都在词法层扫原文，原语既不属于 wikilink 语义也不属于
// 公式语义；任一消费方持有，另一个就得为一个通用工具 import 一整个语义模块。

/** 从 from 起连续相同字符的游程长度（`runLen(text, i, "`")` 即 i 处反引号串的长度）。 */
export function runLen(text: string, from: number, c: string): number {
  let n = 0;
  while (text[from + n] === c) n++;
  return n;
}

/**
 * 从 from 起找长度恰好为 n 的反引号闭合串（GFM inline code 规则），返回闭合串之后的
 * 偏移；找不到返回 null（调用方按原文处理）。长度不等（如 `` ` `` 对 ``` `` ```）不算
 * 闭合，继续往后找——这是 GFM 的「同等长度配对」口径。
 */
export function findClosingRun(text: string, from: number, n: number): number | null {
  let k = from;
  while (k < text.length) {
    if (text[k] === "`") {
      const run = runLen(text, k, "`");
      if (run === n) return k + n;
      k += run;
    } else {
      k++;
    }
  }
  return null;
}
