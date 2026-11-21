// IME 验收 case 的唯一真源（纯数据，不 import CodeMirror）。
//
// 驱动与 runner 静态校验共用这一份：case 名、组合文本、候选文本。新增 case 必须同时
// 在 ime-driver.mjs 的 runCase 里实现分支，否则 `--check` 放行、运行期 fatal。

export const IME_CASES = Object.freeze({
  compose: Object.freeze({ text: "s" }),
  "delete-empty": Object.freeze({ text: "s" }),
  commit: Object.freeze({ text: "s", commit: "是" }),
});

export const IME_CASE_NAMES = Object.freeze(Object.keys(IME_CASES));

/** 校验一条来自 runner 的命令；返回问题串，null = 合法。 */
export function validateImeCommand(cmd) {
  if (!cmd || typeof cmd !== "object" || Array.isArray(cmd)) return "命令需要对象";
  const allowed = new Set(["id", "runTag", "case", "line", "text", "commit", "timeoutMs"]);
  for (const key of Object.keys(cmd)) {
    if (!allowed.has(key)) return `未知键 ${key}（允许：${[...allowed].join(" / ")}）`;
  }
  if (typeof cmd.id !== "string" || cmd.id === "") return "id 需要非空字符串";
  if (typeof cmd.runTag !== "string" || cmd.runTag === "") return "runTag 需要非空字符串";
  if (!IME_CASE_NAMES.includes(cmd.case)) return `case 必须是 ${IME_CASE_NAMES.join(" / ")}`;
  if (typeof cmd.text !== "string" || cmd.text === "") return "text 需要非空字符串（case 数据）";
  if (cmd.commit !== null && cmd.commit !== undefined && (typeof cmd.commit !== "string" || cmd.commit === "")) {
    return "commit 需要非空字符串或 null";
  }
  if (!Number.isInteger(cmd.line) || cmd.line < 1) return "line 需要正整数";
  if (!Number.isFinite(cmd.timeoutMs) || cmd.timeoutMs <= 0) return "timeoutMs 需要正数";
  return null;
}
