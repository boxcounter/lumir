// KimiCU MCP 客户端 —— 验收套件驱动真实 app 的唯一通道。
//
// 为什么直接说 stdio JSON-RPC 而不是让 agent 手动调 MCP 工具：套件要能「一条命令跑完」，
// 且断言必须确定性（同一场景两次跑得到同一判定）。agent 手调的路径无法固化成制品。
// 这里复用 KimiCU 官方 MCP server 本体（`kimi-cu mcp`，与 kimi-code 插件同一入口），
// 因此不引入任何新依赖，也不绕过设计不变量——事件注入仍由 KimiCU launchd 服务在后台
// 执行，不改前台、不动真实鼠标。
import { spawn } from "node:child_process";

const DEFAULT_BIN = "/Applications/KimiCU.app/Contents/MacOS/kimi-cu";

export class CuError extends Error {}

export class CuClient {
  #proc;
  #buf = "";
  #nextId = 1;
  #pending = new Map();
  #stderr = [];
  #spawnError = null;

  static async start({ bin = process.env.KIMICU_BIN ?? DEFAULT_BIN } = {}) {
    const client = new CuClient();
    await client.#spawn(bin);
    return client;
  }

  async #spawn(bin) {
    try {
      this.#proc = spawn(bin, ["mcp"], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      throw new CuError(`无法启动 KimiCU MCP server（${bin}）：${e.message}`);
    }
    // spawn 失败（ENOENT 等）走 'error' 事件，不经同步 try/catch。这里**不 throw**（会变成
    // uncaughtException，进程带栈崩溃、绕过 README 的退出码约定），改为存下错误并 reject 在飞请求，
    // 让 initialize 正常 reject → run.mjs 走「运行失败 = exit 2」的路径留痕。
    this.#proc.on("error", (e) => {
      this.#spawnError = new CuError(
        `KimiCU 不可用（${bin}）：${e.message}。安装：curl -fsSL https://cdn.kimi.com/kimi-computer-use/latest/setup_macos.sh | bash`,
      );
      for (const { reject } of this.#pending.values()) reject(this.#spawnError);
      this.#pending.clear();
    });
    this.#proc.stderr.on("data", (d) => this.#stderr.push(d.toString()));
    this.#proc.stdout.on("data", (d) => this.#onData(d.toString()));
    this.#proc.on("exit", (code) => {
      for (const { reject } of this.#pending.values()) {
        reject(new CuError(`KimiCU MCP server 退出（code=${code}）：${this.#stderr.join("").slice(-500)}`));
      }
      this.#pending.clear();
    });

    await this.#request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "lumir-acceptance", version: "0" },
    });
    this.#notify("notifications/initialized", {});
  }

  #onData(chunk) {
    this.#buf += chunk;
    let idx;
    while ((idx = this.#buf.indexOf("\n")) >= 0) {
      const line = this.#buf.slice(0, idx);
      this.#buf = this.#buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // server 的裸打印不算协议帧，丢弃
      }
      const entry = this.#pending.get(msg.id);
      if (!entry) continue;
      this.#pending.delete(msg.id);
      if (msg.error) entry.reject(new CuError(`MCP 错误：${JSON.stringify(msg.error)}`));
      else entry.resolve(msg.result);
    }
  }

  #send(obj) {
    this.#proc.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  #notify(method, params) {
    this.#send({ jsonrpc: "2.0", method, params });
  }

  #request(method, params, timeoutMs = 30_000) {
    // spawn 已失败时立刻 reject：否则请求会干等到超时才报错，掩盖真实原因。
    if (this.#spawnError) return Promise.reject(this.#spawnError);
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new CuError(`MCP ${method} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.#send({ jsonrpc: "2.0", id, method, params });
    });
  }

  /** 调一个 KimiCU 工具；返回 { text, image, json }。工具自报 ok:false 时抛 CuError。 */
  async call(name, args = {}, { timeoutMs = 30_000 } = {}) {
    const res = await this.#request("tools/call", { name, arguments: args }, timeoutMs);
    const blocks = res?.content ?? [];
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const image = blocks.find((b) => b.type === "image")?.data ?? null;
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* get_app_state 的 text 是 markdown，不是 JSON */
    }
    if (res?.isError) throw new CuError(`${name} 失败：${text.slice(0, 400)}`);
    if (json && json.ok === false) throw new CuError(`${name} 失败：${text.slice(0, 400)}`);
    return { text, image, json };
  }

  async listApps() {
    const { json } = await this.call("list_apps");
    return json?.apps ?? [];
  }

  /** AX 树 + 截图。mode: full | ax | image */
  async state(pid, { mode = "full", windowId, axFilter } = {}) {
    const args = { pid, mode };
    if (windowId !== undefined) args.window_id = windowId;
    if (axFilter) args.ax_filter = axFilter;
    return this.call("get_app_state", args, { timeoutMs: 60_000 });
  }

  async pressKey(pid, keys) {
    return this.call("press_key", { pid, keys });
  }

  async click(pid, { index, x, y, button = "left" }) {
    const args = { pid };
    if (index !== undefined) args.index = index;
    if (x !== undefined) {
      args.x = x;
      args.y = y;
    }
    args.button = button;
    return this.call("click", args);
  }

  async doubleClick(pid, target) {
    return this.call("click", { pid, ...target, button: "left", count: 2 });
  }

  async typeText(pid, text, { index, clear, submit, x, y } = {}) {
    const args = { pid, text };
    if (index !== undefined) args.index = index;
    if (x !== undefined) {
      args.x = x;
      args.y = y;
    }
    if (clear) args.clear = true;
    if (submit) args.submit = true;
    return this.call("type_text", args, { timeoutMs: 60_000 });
  }

  async setValue(pid, index, value) {
    return this.call("set_value", { pid, index, value });
  }

  async scroll(pid, { index, page }) {
    const args = { pid };
    if (index !== undefined) args.index = index;
    if (page !== undefined) args.page = page;
    return this.call("scroll", args);
  }

  async performSecondaryAction(pid, index, action) {
    const { json } = await this.call("perform_secondary_action", { pid, index, action });
    return json;
  }

  async stop() {
    this.#proc?.kill("SIGKILL");
    // 等进程收尸，避免僵尸影响下一次 start
    await new Promise((r) => setTimeout(r, 100));
  }
}
