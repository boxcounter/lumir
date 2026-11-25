// 首启验收的 vault-open 桥驱动（只在验收实例的 Vite dev server 注入）。
//
// 边界：本脚本不碰产品装载逻辑，只把 runner 下发的 path 交给 main.ts 安装的
// `window.__lumirAcceptanceVaultOpen`（内部是 switchToVault 完整链路：loadUserVault →
// vaultOpenPath → applyVault）。不重启、不 reload，因此本次启动的 firstRunPending 保留。
//
// 协议：GET /__lumir-acceptance-vault-open/command → 执行 → POST /report。
// 驱动只在 `apply:"serve"` + `LUMIR_ACCEPTANCE_VAULT_OPEN=1` 时由 vite.config.ts 注入；
// 生产构建与普通 1420 dev 都看不到本文件 / 端点 / 全局桥。

const ENDPOINT = "/__lumir-acceptance-vault-open";
const POLL_MS = 150;

if (!globalThis.__lumirAcceptanceVaultOpenDriver) {
  globalThis.__lumirAcceptanceVaultOpenDriver = true;
  let lastId = null;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function report(id, ok, error) {
    try {
      await fetch(`${ENDPOINT}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ok, error: error ?? null }),
        cache: "no-store",
      });
    } catch {
      // runner 已超时 / 页面卸载：报告丢了不影响下一次动作的状态机。
    }
  }

  async function poll() {
    try {
      const response = await fetch(`${ENDPOINT}/command`, { cache: "no-store" });
      if (response.status === 204 || !response.ok) return;
      const command = await response.json();
      if (!command || typeof command.id !== "string" || typeof command.path !== "string") return;
      if (command.id === lastId) return;
      lastId = command.id;
      const bridge = globalThis.__lumirAcceptanceVaultOpen;
      if (typeof bridge !== "function") {
        await report(command.id, false, "window.__lumirAcceptanceVaultOpen 不存在（桥未安装）");
        return;
      }
      try {
        await bridge(command.path);
        await report(command.id, true, null);
      } catch (error) {
        await report(command.id, false, String(error?.message ?? error));
      }
    } catch {
      // dev server 尚未就绪 / 页面正在卸载：下一拍重试。
    }
  }

  // 就绪判据是**桥已安装**，不是脚本已执行：main.ts 的模块求值在驱动脚本之后完成，
  // 若脚本一执行就报 ready，动作可能在桥出现前下发命令。等桥出现再 POST /ready。
  async function markReadyWhenBridge() {
    while (typeof globalThis.__lumirAcceptanceVaultOpen !== "function") await sleep(50);
    await fetch(`${ENDPOINT}/ready`, { method: "POST", cache: "no-store" }).catch(() => {});
  }

  void markReadyWhenBridge();
  setInterval(() => void poll(), POLL_MS);
  void poll();
}
