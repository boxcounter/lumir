import { defineConfig } from "vite";

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
// 的 worktree，`dist/` 与 `playwright-report/` 是构建 / 视觉门禁产物，`test-results/` 是跑批
// 自己的证据目录。vite 8 自身已默认忽略 `.git/`、`node_modules/`、`test-results/`、cacheDir
// 与**根** outDir（见 `node_modules/vite/dist/node` 内的 `resolveChokidarOptions`）；这里补的是默认面之外的
// `.tower/`、worktree 里的嵌套 `dist/` 与 `playwright-report/`，并显式重列 test-results 让
// 口径自解释（REVIEW.md 第 8 条：宁可重列，也不要让读者去猜默认面）。
const ACCEPTANCE_WATCH_IGNORED = [
  "**/.tower/**",
  "**/test-results/**",
  "**/dist/**",
  "**/playwright-report/**",
];

// 验收实例的判定路径（M359）：`scripts/acceptance/run.mjs` 在真跑批开机时把 dev 端口的缺省值
// 显式落进 `LUMIR_ACCEPTANCE_PORT`，该变量在场即「这是验收实例」。Alex 手头的 `pnpm tauri dev`
// （1420，走 `src-tauri/tauri.conf.json` 的 `pnpm dev`）不经过 runner、不带这个变量 ⇒ 下面的
// `server` 段与加固前逐字节相同，日常 HMR 行为不变。
const acceptanceRun = process.env.LUMIR_ACCEPTANCE_PORT !== undefined;

if (acceptanceRun) {
  // 正向见证：让「跑批期间一次 reload 都没有」这条**负向**判据有输入——app.log 里看得到忽略面
  // 确实装上了。少了这行，日志里没有 reload 既可能是修好了，也可能是这段配置根本没生效
  // （REVIEW.md 第 1/2 条：负向断言必须先确认自己读到的不是缺失值）。
  console.log(
    `[vite] 验收模式 watch-ignore 生效（LUMIR_ACCEPTANCE_PORT=${process.env.LUMIR_ACCEPTANCE_PORT}）：` +
      ACCEPTANCE_WATCH_IGNORED.join(", "),
  );
}

// Tauri 2 约定：固定端口、直连、相对 base（见 tauri.conf.json devUrl/frontendDist）
export default defineConfig({
  base: "./",
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
