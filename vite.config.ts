import { defineConfig } from "vite";
import { validateImeCommand } from "./scripts/acceptance/driver/ime-cases.mjs";

// 验收实例的 watch 忽略面（M359）。
//
// 为什么需要：验收 runner 以**仓库根**起 vite（`pnpm tauri dev` 的 beforeDevCommand），
// `.tower/worktrees/**` 因此也落在 watch 面内。同机别的 agent 在自己的 worktree 里
// checkout / 构建时写下的 `.html` / `tsconfig.json`，会让 vite 向验收实例的前端推一次整页
// reload——重载 = 前端在**同一个 Rust 进程**里重新启动，菜单、行内输入框、焦点这些瞬时界面
// 状态全灭，正在跑的场景于是产出一串与产品缺陷无法区分的级联假 FAIL。2026-10-07 现场：
// 一次跑批的 18 条 reload 全部来自 `.tower/worktrees/` 下，同刻场景 47 的 17 条断言级联判红
// （finding `.tower/comms/findings/20261007-worker-rfn1-bug-dev-server-watch-tower-worktrees-agent-html-tsconfig-reload.md`）。
//
// 为什么忽略这几处是安全的：套件不在这几处放「改了就该重载」的源码——`.tower/` 是别的 agent
// 的 worktree，`dist/` 与 `playwright-report/` 是构建 / 视觉门禁产物，`.local/` 是跑批
// 自己的证据目录。vite 8 自身已默认忽略 `.git/`、`node_modules/`、`test-results/`、cacheDir
// 与**根** outDir（见 `node_modules/vite/dist/node` 内的 `resolveChokidarOptions`）；这里补的是默认面之外的
// `.tower/`、`.local/`、worktree 里的嵌套 `dist/` 与 `playwright-report/`。`.local/` 必须显式
// 列出——它是点目录，不在默认面内；漏掉就等于让跑批自己写证据的动作触发整页 reload（M359
// 要挡的那类级联假 FAIL）。
const ACCEPTANCE_WATCH_IGNORED = [
  "**/.tower/**",
  "**/.local/**",
  "**/dist/**",
  "**/playwright-report/**",
];

// 验收实例的判定路径（M359）：`scripts/acceptance/run.mjs` 在真跑批开机时把 dev 端口的缺省值
// 显式落进 `LUMIR_ACCEPTANCE_PORT`，该变量在场即「这是验收实例」。Alex 手头的 `pnpm tauri dev`
// （1420，走 `src-tauri/tauri.conf.json` 的 `pnpm dev`）不经过 runner、不带这个变量 ⇒ 下面的
// `server` 段与加固前逐字节相同，日常 HMR 行为不变。
const acceptanceRun = process.env.LUMIR_ACCEPTANCE_PORT !== undefined;
// IME 自动回归驱动（change fix-ime-list-composition-nov20 收尾）：只有验收实例且场景显式
// 请求时才装。生产构建不经过 configureServer，`apply: "serve"` 再加一道硬门；普通 dev（1420）
// 不带 `LUMIR_ACCEPTANCE_IME`，看不到端点与脚本。
const acceptanceIme = acceptanceRun && process.env.LUMIR_ACCEPTANCE_IME === "1";
// 首启验收的 vault-open 桥（change add-first-run-onboarding-nov25）：只有含 `vaultOpenPath`
// 动作的场景由 run.mjs 设 `LUMIR_ACCEPTANCE_VAULT_OPEN=1` 时才装。普通 1420 dev 无此变量，
// 端点不存在；production build 不跑 `apply:"serve"`，桥与端点都不进产物。
const acceptanceVaultOpen = acceptanceRun && process.env.LUMIR_ACCEPTANCE_VAULT_OPEN === "1";

function acceptanceImeDriver() {
  let driverReady = false;
  let command: unknown = null;
  let report: { id?: string } | null = null;
  const json = (res: import("node:http").ServerResponse, status: number, payload: unknown) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(payload === undefined ? "" : JSON.stringify(payload));
  };
  const readJson = (req: import("node:http").IncomingMessage) =>
    new Promise<unknown>((resolve, reject) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1_000_000) reject(new Error("请求体过大"));
      });
      req.on("end", () => {
        try {
          resolve(body ? JSON.parse(body) : null);
        } catch (error) {
          reject(error);
        }
      });
      req.on("error", reject);
    });

  return {
    name: "lumir-acceptance-ime",
    apply: "serve" as const,
    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { type: "module", src: "/scripts/acceptance/driver/ime-driver.mjs" },
          injectTo: "body" as const,
        },
      ];
    },
    configureServer(server: { middlewares: { use: (path: string, handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void) => void } }) {
      server.middlewares.use("/__lumir-ime", (req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const pathname = url.pathname;
        if (req.method === "GET" && pathname === "/ready") return json(res, 200, { ready: driverReady });
        if (req.method === "POST" && pathname === "/ready") {
          driverReady = true;
          return json(res, 204, undefined);
        }
        if (req.method === "GET" && pathname === "/command") {
          return command === null ? (res.statusCode = 204, res.end()) : json(res, 200, command);
        }
        if (req.method === "POST" && pathname === "/command") {
          void readJson(req).then(
            (payload) => {
              const problem = validateImeCommand(payload);
              if (problem) return json(res, 400, { error: problem });
              command = payload;
              return json(res, 202, { accepted: true });
            },
            (error) => json(res, 400, { error: String(error?.message ?? error) }),
          );
          return;
        }
        if (req.method === "POST" && pathname === "/report") {
          void readJson(req).then(
            (payload) => {
              if (!payload || typeof payload !== "object" || typeof (payload as { id?: unknown }).id !== "string") {
                return json(res, 400, { error: "报告需要 id" });
              }
              report = payload as { id?: string };
              return json(res, 204, undefined);
            },
            (error) => json(res, 400, { error: String(error?.message ?? error) }),
          );
          return;
        }
        if (req.method === "GET" && pathname === "/report") {
          const id = url.searchParams.get("id");
          if (report && report.id === id) return json(res, 200, report);
          return json(res, 404, { error: "report not found" });
        }
        return json(res, 404, { error: "not found" });
      });
      console.log("[vite] 验收 IME 驱动已装入（/__lumir-ime）");
    },
  };
}


/** 仅验收实例：把「用户选中首个 vault」的终态交给前端完整 `switchToVault` 链路。
 *
 *  不能在 runner 里直接 invoke `vault_open_path`：后端切换后前端仍停在首启面；reload 又会
 *  丢掉本次启动的 firstRunPending。这里的桥只把 path 送进页面，页面调用 main.ts 在
 *  `import.meta.env.DEV` + 本插件注入的 flag 双开时安装的 `window.__lumirAcceptanceVaultOpen`
 *  （内部就是 `switchToVault`：loadUserVault → vaultOpenPath → applyVault，不重启 / 不 reload）。
 *  驱动脚本只做命令轮询与报告；报告落证据，不写产品状态。
 */
function acceptanceVaultOpenDriver() {
  let driverReady = false;
  let command: unknown = null;
  let report: { id?: string } | null = null;
  const json = (res: import("node:http").ServerResponse, status: number, payload: unknown) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(payload === undefined ? "" : JSON.stringify(payload));
  };
  const readJson = (req: import("node:http").IncomingMessage) =>
    new Promise<unknown>((resolve, reject) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1_000_000) reject(new Error("请求体过大"));
      });
      req.on("end", () => {
        try {
          resolve(body ? JSON.parse(body) : null);
        } catch (error) {
          reject(error);
        }
      });
      req.on("error", reject);
    });

  return {
    name: "lumir-acceptance-vault-open",
    apply: "serve" as const,
    transformIndexHtml() {
      return [
        {
          tag: "script",
          children: "globalThis.__LUMIR_ACCEPTANCE_VAULT_OPEN__ = true;",
          injectTo: "head-prepend" as const,
        },
        {
          tag: "script",
          attrs: { type: "module", src: "/scripts/acceptance/driver/vault-open-driver.mjs" },
          injectTo: "body" as const,
        },
      ];
    },
    configureServer(server: { middlewares: { use: (path: string, handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void) => void } }) {
      server.middlewares.use("/__lumir-acceptance-vault-open", (req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const pathname = url.pathname;
        if (req.method === "GET" && pathname === "/ready") return json(res, 200, { ready: driverReady });
        if (req.method === "POST" && pathname === "/ready") {
          driverReady = true;
          return json(res, 204, undefined);
        }
        if (req.method === "GET" && pathname === "/command") {
          return command === null ? (res.statusCode = 204, res.end()) : json(res, 200, command);
        }
        if (req.method === "POST" && pathname === "/command") {
          void readJson(req).then(
            (payload) => {
              const body = payload as { id?: unknown; path?: unknown } | null;
              if (!body || typeof body.id !== "string" || typeof body.path !== "string" || body.path === "") {
                return json(res, 400, { error: "命令需要 id 与非空 path" });
              }
              command = { id: body.id, path: body.path };
              return json(res, 202, { accepted: true });
            },
            (error) => json(res, 400, { error: String(error?.message ?? error) }),
          );
          return;
        }
        if (req.method === "POST" && pathname === "/report") {
          void readJson(req).then(
            (payload) => {
              const body = payload as { id?: unknown } | null;
              if (!body || typeof body.id !== "string") return json(res, 400, { error: "报告需要 id" });
              report = body as { id?: string };
              return json(res, 204, undefined);
            },
            (error) => json(res, 400, { error: String(error?.message ?? error) }),
          );
          return;
        }
        if (req.method === "GET" && pathname === "/report") {
          const id = url.searchParams.get("id");
          if (report && report.id === id) return json(res, 200, report);
          return json(res, 404, { error: "report not found" });
        }
        return json(res, 404, { error: "not found" });
      });
      console.log("[vite] 验收 vault-open 驱动已装入（/__lumir-acceptance-vault-open）");
    },
  };
}

if (acceptanceRun) {
  // 正向见证：让「跑批期间一次 reload 都没有」这条**负向**判据有输入——app.log 里看得到忽略面
  // 确实装上了。少了这行，日志里没有 reload 既可能是修好了，也可能是这段配置根本没生效
  // （REVIEW.md 「断言等价于子串 / 读不到当成空」条：负向断言必须先确认自己读到的不是缺失值）。
  console.log(
    `[vite] 验收模式 watch-ignore 生效（LUMIR_ACCEPTANCE_PORT=${process.env.LUMIR_ACCEPTANCE_PORT}）：` +
      ACCEPTANCE_WATCH_IGNORED.join(", "),
  );
}

// Tauri 2 约定：固定端口、直连、相对 base（见 tauri.conf.json devUrl/frontendDist）
export default defineConfig({
  base: "./",
  plugins: [
    ...(acceptanceIme ? [acceptanceImeDriver()] : []),
    ...(acceptanceVaultOpen ? [acceptanceVaultOpenDriver()] : []),
  ],
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    ...(acceptanceRun ? { watch: { ignored: ACCEPTANCE_WATCH_IGNORED } } : {}),
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
});
