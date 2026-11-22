import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** 为 Lumir app 测量建立每次运行独立的 HOME/XDG 与确定性合成配置。 */
export async function createAppFixture({ panes = 0, env = process.env } = {}) {
  if (![0, 1, 2].includes(panes)) throw new Error(`unsupported app fixture panes: ${panes}`);
  const root = await mkdtemp(path.join(os.tmpdir(), "lumir-perf-app-"));
  const cleanup = () => rm(root, { recursive: true, force: true });
  try {
    const home = path.join(root, "home");
    const xdgConfigHome = path.join(root, "xdg");
    const configDir = path.join(xdgConfigHome, "lumir");
    await mkdir(home, { recursive: true });
    await mkdir(configDir, { recursive: true });

    if (panes === 0) {
      await writeJson(path.join(configDir, "config.json"), {
        version: 1,
        editor: { mode: "md" },
      });
      return {
        panes,
        root,
        home,
        xdgConfigHome,
        vault: null,
        env: { ...env, HOME: home, XDG_CONFIG_HOME: xdgConfigHome },
        cleanup,
      };
    }

    const vault = path.join(root, "vault");
    await mkdir(vault, { recursive: true });
    await writeFile(path.join(vault, "alpha.md"), "# Alpha\n\n常驻内存测量的甲文档。\n");
    await writeFile(path.join(vault, "beta.md"), "# Beta\n\n常驻内存测量的乙文档。\n");
    const realVault = realpathSync(vault);
    await mkdir(path.join(configDir, "vault-registry"), { recursive: true });
    await mkdir(path.join(configDir, "vault-sessions"), { recursive: true });
    const now = Date.now();
    const vaultId = "m320perf";
    await writeJson(path.join(configDir, "config.json"), {
      version: 1,
      last_vault: realVault,
      editor: { mode: "md" },
    });
    await writeJson(path.join(configDir, "vault-registry", `${vaultId}.json`), {
      id: vaultId,
      path: realVault,
      last_opened_at: now,
    });
    await writeJson(path.join(configDir, "vault-sessions", `${vaultId}.json`), {
      version: 2,
      panes:
        panes === 2
          ? [
              { tabs: ["alpha.md"], active: "alpha.md" },
              { tabs: ["beta.md"], active: "beta.md" },
            ]
          : [{ tabs: ["alpha.md"], active: "alpha.md" }],
      harness_pane: false,
      pane_split_ratio: 0.5,
      updated_at: now,
    });
    return {
      panes,
      root,
      home,
      xdgConfigHome,
      vault: realVault,
      env: { ...env, HOME: home, XDG_CONFIG_HOME: xdgConfigHome },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
