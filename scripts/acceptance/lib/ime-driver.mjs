// runner 侧的 IME 驱动 HTTP 客户端（零新依赖，Node 内置 fetch）。
//
// 端点只存在于验收实例：vite.config.ts 在 `LUMIR_ACCEPTANCE_PORT` + `LUMIR_ACCEPTANCE_IME=1`
// 时注入 driver 并挂 `/__lumir-ime/*`。本文件不碰产品代码。

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { envHome, InfraError, sleep } from "./util.mjs";

export const IME_ENDPOINT = () =>
  `http://127.0.0.1:${process.env.LUMIR_ACCEPTANCE_PORT ?? 1430}/__lumir-ime`;

async function request(method, pathname, body) {
  const response = await fetch(`${IME_ENDPOINT()}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  return response;
}

/** 等驱动注入并报到。超时是基建错误（门没开 / 脚本没注入）。 */
export async function waitReady(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const response = await request("GET", "/ready");
      if (response.ok) {
        const payload = await response.json();
        if (payload?.ready === true) return;
        last = JSON.stringify(payload);
      } else {
        last = `HTTP ${response.status}`;
      }
    } catch (error) {
      last = String(error?.message ?? error);
    }
    await sleep(150);
  }
  throw new InfraError(
    `IME 驱动未就绪（${timeoutMs}ms）：${last}。` +
      "驱动只在验收实例的 Vite dev server 注入——确认本次场景含 imeDrive、runner 已设 LUMIR_ACCEPTANCE_IME=1，且 dev 端口是 LUMIR_ACCEPTANCE_PORT。",
  );
}

export async function sendCommand(command) {
  const response = await request("POST", "/command", command);
  if (response.status !== 202 && !response.ok) {
    throw new InfraError(`imeDrive 下发命令失败：HTTP ${response.status} ${await response.text().catch(() => "")}`.trim());
  }
}

export async function waitReport(id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await request("GET", `/report?id=${encodeURIComponent(id)}`);
      if (response.ok) return await response.json();
    } catch {
      // driver 尚未 post / 页面重载：继续等
    }
    await sleep(150);
  }
  throw new InfraError(`imeDrive 等待报告超时（${timeoutMs}ms，id=${id}）：驱动未回传（页面崩溃 / 注入缺失）。`);
}

/** 报告落到隔离 env：`<envHome>/lumir/acceptance/ime/<case>.jsonl`，一行一份。 */
export async function writeImeReport(caseName, report) {
  const dir = path.join(envHome(), "lumir", "acceptance", "ime");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${caseName}.jsonl`);
  await writeFile(file, `${JSON.stringify(report)}\n`);
  return file;
}
