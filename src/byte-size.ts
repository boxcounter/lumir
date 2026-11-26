// 字节读数格式化（单一来源）：B / KB / MB，ASCII 单位、两档语言同形。
//
// 消费者：图片 modeline 的「文件大小」（`imageSizeText`，change add-image-file-preview）
// 与 harness Web 搜索结果健康摘要的文本大小（change compact-web-search-result-summary-nov26）。
// 两处读数是同一个语义（字节数 → 人话），MUST NOT 各写一份阈值表与舍入口径。
import { formatNumber } from "./copy";

/** 字节数 → 人话读数。只做数量级压缩，不做本地化宽度对齐。 */
export function byteSizeText(bytes: number): string {
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
