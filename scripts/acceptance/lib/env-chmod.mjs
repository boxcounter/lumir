import { chmodSync, statSync } from "node:fs";
import path from "node:path";
import { envHome, envRelPath } from "./util.mjs";

const originals = new Map();

function modeOf(value) {
  if (typeof value === "string" && /^0o?[0-7]+$/.test(value)) {
    const parsed = Number.parseInt(value.replace(/^0o?/, ""), 8);
    if (parsed <= 0o777) return parsed;
  }
  if (Number.isInteger(value) && value >= 0 && value <= 0o777) return value;
  throw new Error(`do=envChmod 需要 0..0o777 的 mode，收到 ${JSON.stringify(value)}`);
}

export function validateEnvChmod(step) {
  const rel = envRelPath(step?.file, "do=envChmod");
  return { rel, mode: modeOf(step?.mode) };
}

export function applyEnvChmod(step) {
  const { rel, mode } = validateEnvChmod(step);
  const target = path.join(envHome(), "lumir", rel);
  if (!originals.has(target)) originals.set(target, statSync(target).mode & 0o777);
  chmodSync(target, mode);
  return target;
}

export function restoreEnvChmods({ throwOnError = true } = {}) {
  const errors = [];
  for (const [target, mode] of [...originals.entries()].reverse()) {
    try {
      chmodSync(target, mode);
      originals.delete(target);
    } catch (error) {
      errors.push(`${target}: ${error.message}`);
    }
  }
  if (throwOnError && errors.length > 0) {
    throw new Error(`envChmod 恢复原 mode 失败：${errors.join("；")}`);
  }
  return errors;
}

process.on("exit", () => {
  restoreEnvChmods({ throwOnError: false });
});
