import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { DEMO_VAULT, dirtyReports, externalWrite, fileText, fireFsEvent, logEvents, stubTauri } from "./tauri-stub";

// M127 自动保存与崩溃备份：自动保存按「停止输入 2s」debounce 落盘；dogfood 核心场景
// （Lumir ↔ Obsidian 来回）里存在未解决冲突 / 外部修改待决时自动保存必须暂停，不得
// 硬冲 CAS——暂停期间 dirty 内容改走崩溃备份，保存成功即清除。
//
// tauri-stub 不在本 mission scope，故 recovery_* 桩与调用计数在本文件里以
// addInitScript 包一层 __TAURI_INTERNALS__.invoke 实现（注册顺序保证 stub 先建）；
// 真后端命令见 src-tauri/src/recovery.rs 与 commands.rs。

/** 恢复目录里一条备份：正文 + 备份写入时的 CAS 基准 revision（null = 老格式无基准）。 */
interface StoredBackup {
  content: string;
  baseRevision: string | null;
}

interface HardeningOpts {
  /** 预置的恢复目录内容（模拟上次异常退出留下的备份）。 */
  seedRecovery?: Record<string, StoredBackup>;
}

async function stubHardening(page: Page, opts: HardeningOpts = {}): Promise<void> {
  await page.addInitScript((o: HardeningOpts) => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: any) => unknown;
    w.__recoveryStore = { ...(o.seedRecovery ?? {}) };
    w.__saveCalls = 0;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (cmd === "recovery_backup") {
        w.__recoveryStore[args.path] = { content: args.content, baseRevision: args.base_revision };
        return null;
      }
      if (cmd === "recovery_discard") {
        delete w.__recoveryStore[args.path];
        return null;
      }
      if (cmd === "recovery_list") return Object.keys(w.__recoveryStore);
      if (cmd === "recovery_load") return w.__recoveryStore[args.path]?.content ?? null;
      if (cmd === "recovery_base_revision") return w.__recoveryStore[args.path]?.baseRevision ?? null;
      if (cmd === "document_save") w.__saveCalls += 1;
      return invoke(cmd, args);
    };
  }, opts);
}

/** 恢复目录当前内容（崩溃备份落盘 / 清除 / 基准的证据）。 */
async function recoveryStore(page: Page): Promise<Record<string, StoredBackup>> {
  return page.evaluate(
    () =>
      (window as unknown as { __recoveryStore: Record<string, StoredBackup> }).__recoveryStore,
  );
}

/** 单条备份的正文（无备份 → undefined）。 */
async function backupContent(page: Page, path: string): Promise<string | undefined> {
  return (await recoveryStore(page))[path]?.content;
}

/** 单条备份记录的 CAS 基准 revision（无备份 → undefined）。 */
async function backupBaseRevision(page: Page, path: string): Promise<string | null | undefined> {
  return (await recoveryStore(page))[path]?.baseRevision;
}

/** 与 tauri-stub 的 fs_read_snapshot 同口径的 revision。 */
function fixtureRevision(text: string): string {
  return `fixture-revision-${text}`;
}

const README_ORIGINAL = DEMO_VAULT.files?.["README.md"] ?? "";

/** document_save 的调用次数（自动保存是否真的发起过写入的证据）。 */
async function saveCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __saveCalls: number }).__saveCalls);
}

/** 打开 README.md 并敲入一段本地修改。 */
async function openAndEdit(page: Page, typed = "ZZZ") {
  await page.goto("/");
  await page.locator('.ft-row[title="README.md"]').click();
  const content = page.locator(".cm-content");
  await expect(content).toContainText("Demo Vault");
  await content.click();
  await page.keyboard.type(typed);
  await expect(page.locator(".masthead-file")).toContainText("未保存");
  return content;
}

test("停止输入 debounce 后自动保存：内容落盘、dirty 清除与手动保存一致", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await stubHardening(page);
  const content = await openAndEdit(page);

  // debounce 语义：刚停下不落盘（否则每敲一个字符就发一次 CAS 写入）。
  await page.waitForTimeout(800);
  expect(await fileText(page, "README.md")).not.toContain("ZZZ");

  // 停止输入 2s 后自动保存：磁盘拿到内容，dirty 表现层与手动保存走同一清除路径。
  await expect.poll(() => fileText(page, "README.md"), { timeout: 5000 }).toContain("ZZZ");
  await expect(page.locator(".lumir-toast", { hasText: "已自动保存" })).toBeVisible();
  await expect(page.locator(".masthead-file")).not.toContainText("未保存");
  await expect.poll(async () => (await dirtyReports(page)).at(-1)).toBe(false);
  await expect(content).toContainText("ZZZ");
});

test("debounce 随每次输入重置：连续输入期间不落盘", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await stubHardening(page);
  await openAndEdit(page);

  // 第一次停顿不足 2s 再继续输入：计时重置，第一次的 2s 到期点不得触发落盘。
  await page.waitForTimeout(1500);
  await page.keyboard.type("MORE");
  await page.waitForTimeout(1000);
  expect(await fileText(page, "README.md")).not.toContain("ZZZ");
  expect(await saveCalls(page)).toBe(0);

  // 真正停止输入后一次落盘，内容含两次输入。
  await expect.poll(() => fileText(page, "README.md"), { timeout: 5000 }).toContain("MORE");
  await expect(page.locator(".masthead-file")).not.toContainText("未保存");
});

test("未解决冲突时自动保存暂停：不硬冲 CAS，dirty 内容落崩溃备份", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await stubHardening(page);
  const content = await openAndEdit(page);

  // Obsidian 侧先保存同文件 → Lumir 保存得到真实 CAS 冲突（未处置）。
  await externalWrite(page, "README.md", "# External version\n");
  await page.keyboard.press("Meta+s");
  await expect(page.locator(".lumir-toast", { hasText: "保存冲突" })).toBeVisible();
  const afterManualSave = await saveCalls(page);
  expect(afterManualSave).toBe(1);

  // 诊断埋点（M136）：冲突确立即经 log_event 转发一条 autosave_paused。跃迁语义——
  // 只在暂停集合由空变非空时记，暂停期间每 2s 一次的 reconcile 不重复灌日志。
  await expect
    .poll(async () => (await logEvents(page, "autosave_paused")).map((e) => e.fields))
    .toEqual([{ path: "README.md", reason: "conflict" }]);

  // 冲突未处置期间继续输入并等过 debounce：自动保存 MUST 暂停（不得重试 CAS）。
  await content.click();
  await page.keyboard.type("MORE");
  await page.waitForTimeout(3000);
  expect(await saveCalls(page)).toBe(afterManualSave);
  expect(await fileText(page, "README.md")).toBe("# External version\n");
  await expect(page.locator(".masthead-file")).toContainText("未保存");

  // 兜底：暂停期间 dirty 内容进了崩溃备份（进程崩溃仍有内容可恢复），
  // 且基准 revision 是「最后一次与编辑器同步的磁盘版本」（外部修改前的那个），
  // 不是外部修改后的版本——恢复侧据此才能判定磁盘已被改过。
  await expect.poll(async () => backupContent(page, "README.md") ?? "").toContain("MORE");
  expect(await backupBaseRevision(page, "README.md")).toBe(fixtureRevision(README_ORIGINAL));
});

test("外部修改待决（dirty）时自动保存暂停：等过 debounce 也无保存尝试", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await stubHardening(page);
  await openAndEdit(page);

  // watch 送达外部修改：dirty 时把选择权交给用户，自动保存同步暂停。
  await externalWrite(page, "README.md", "# External version\n");
  await fireFsEvent(page, [{ kind: "modified", path: "README.md", entry_kind: "file" }]);
  await expect(page.locator(".lumir-toast", { hasText: "检测到外部修改" })).toBeVisible();

  await page.waitForTimeout(3000);
  expect(await saveCalls(page)).toBe(0);
  expect(await fileText(page, "README.md")).toBe("# External version\n");
  await expect(page.locator(".masthead-file")).toContainText("未保存");
  await expect.poll(async () => backupContent(page, "README.md") ?? "").toContain("ZZZ");
  expect(await backupBaseRevision(page, "README.md")).toBe(fixtureRevision(README_ORIGINAL));
});

test("处置冲突后自动保存恢复，备份随保存成功清除", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await stubHardening(page);
  const content = await openAndEdit(page);

  await externalWrite(page, "README.md", "# External version\n");
  await page.keyboard.press("Meta+s");
  const conflict = page.locator(".lumir-toast", { hasText: "保存冲突" });
  await expect(conflict).toBeVisible();
  // 暂停态下等一个 debounce：产生崩溃备份（下一步验证保存成功即清除）。
  await expect.poll(async () => backupContent(page, "README.md") ?? "").toContain("ZZZ");

  await conflict.getByRole("button", { name: "强制覆盖保存" }).click();
  await page
    .locator(".lumir-toast", { hasText: "将覆盖磁盘上较新的内容" })
    .getByRole("button", { name: "覆盖保存" })
    .click();
  await expect(page.locator(".lumir-toast", { hasText: "已强制覆盖保存" })).toBeVisible();

  await expect.poll(() => fileText(page, "README.md")).toContain("ZZZ");
  await expect.poll(async () => (await recoveryStore(page))).toEqual({});
  await expect(page.locator(".masthead-file")).not.toContainText("未保存");

  // 暂停解除：再次输入后自动保存恢复正常。
  await content.click();
  await page.keyboard.type("TAIL");
  await expect.poll(() => fileText(page, "README.md"), { timeout: 5000 }).toContain("TAIL");
  await expect(page.locator(".lumir-toast", { hasText: "已自动保存" })).toBeVisible();
});

test("启动发现残留崩溃备份：给出恢复入口，恢复后内容进编辑器并保持未保存", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  // 备份记录的基准 = 磁盘当前 revision（备份之后磁盘没被动过）→ 恢复后的保存不冲突。
  await stubHardening(page, {
    seedRecovery: {
      "README.md": {
        content: "# Recovered\n\n恢复的内容\n",
        baseRevision: fixtureRevision(README_ORIGINAL),
      },
    },
  });
  await page.goto("/");

  const prompt = page.locator(".lumir-toast", { hasText: "发现未保存的崩溃备份" });
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText("README.md");
  await prompt.getByRole("button", { name: "恢复内容" }).click();
  await expect(page.locator(".lumir-toast", { hasText: "已恢复未保存内容" })).toBeVisible();

  // 恢复的内容进编辑器缓冲且是未保存状态——仍走保存链路，不静默改写磁盘。
  const content = page.locator(".cm-content");
  await expect(content).toContainText("恢复的内容");
  await expect(page.locator(".masthead-file")).toContainText("未保存");

  // debounce 后自动保存：内容落盘，备份随之清除。
  await expect.poll(() => fileText(page, "README.md"), { timeout: 6000 }).toContain("恢复的内容");
  await expect.poll(async () => (await recoveryStore(page))).toEqual({});
});

test("备份后磁盘被外部修改：恢复按 CAS 报冲突，不静默覆盖较新版本", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  // 备份是崩溃前写的（基准 = 当时的磁盘版本）；崩溃之后 Obsidian 又改了同一个文件。
  await stubHardening(page, {
    seedRecovery: {
      "README.md": {
        content: "# Recovered\n\n恢复的内容\n",
        baseRevision: fixtureRevision(README_ORIGINAL),
      },
    },
  });
  await page.goto("/");
  await externalWrite(page, "README.md", "# External newer\n");

  const content = page.locator(".cm-content");
  await page
    .locator(".lumir-toast", { hasText: "发现未保存的崩溃备份" })
    .getByRole("button", { name: "恢复内容" })
    .click();
  await expect(page.locator(".lumir-toast", { hasText: "已恢复未保存内容" })).toBeVisible();
  await expect(content).toContainText("恢复的内容");
  await expect(page.locator(".masthead-file")).toContainText("未保存");

  // 恢复时 MUST NOT 把磁盘当前 revision 吸为新基准：debounce 后的自动保存按 CAS
  // 报冲突（进而不是静默覆盖），磁盘上较新的外部版本原样保留。
  const conflict = page.locator(".lumir-toast", { hasText: "保存冲突" });
  await expect(conflict).toBeVisible({ timeout: 6000 });
  await expect(conflict).toContainText("未丢失");
  await expect(conflict.getByRole("button", { name: "重新载入（放弃我的修改）" })).toBeVisible();
  await expect(conflict.getByRole("button", { name: "强制覆盖保存" })).toBeVisible();
  expect(await fileText(page, "README.md")).toBe("# External newer\n");
  await expect(page.locator(".lumir-toast", { hasText: "已自动保存" })).toHaveCount(0);
  await expect(content).toContainText("恢复的内容");

  // 逃生口仍可达：用户显式选择强制覆盖后，恢复的内容才落盘，备份随之清除。
  await conflict.getByRole("button", { name: "强制覆盖保存" }).click();
  await page
    .locator(".lumir-toast", { hasText: "将覆盖磁盘上较新的内容" })
    .getByRole("button", { name: "覆盖保存" })
    .click();
  await expect(page.locator(".lumir-toast", { hasText: "已强制覆盖保存" })).toBeVisible();
  await expect.poll(() => fileText(page, "README.md")).toContain("恢复的内容");
  await expect.poll(async () => (await recoveryStore(page))).toEqual({});
});

test("启动发现残留崩溃备份：可丢弃，编辑器不被改动", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await stubHardening(page, {
    seedRecovery: {
      "README.md": { content: "旧备份内容", baseRevision: fixtureRevision(README_ORIGINAL) },
    },
  });
  await page.goto("/");

  const prompt = page.locator(".lumir-toast", { hasText: "发现未保存的崩溃备份" });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "丢弃备份" }).click();

  await expect(page.locator(".lumir-toast", { hasText: "已丢弃崩溃备份" })).toBeVisible();
  await expect.poll(async () => (await recoveryStore(page))).toEqual({});
  await expect(page.locator(".lumir-toast", { hasText: "发现未保存的崩溃备份" })).toHaveCount(0);
  await expect(page.locator(".cm-content")).not.toContainText("旧备份内容");
});

test("多个残留备份逐个给出提示，处置互不影响", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await stubHardening(page, {
    seedRecovery: {
      "README.md": { content: "a", baseRevision: fixtureRevision(README_ORIGINAL) },
      "docs/guide.md": { content: "b", baseRevision: null },
    },
  });
  await page.goto("/");

  const prompts = page.locator(".lumir-toast", { hasText: "发现未保存的崩溃备份" });
  await expect(prompts).toHaveCount(2);
  await expect(prompts.filter({ hasText: "docs/guide.md" })).toBeVisible();
  await expect(prompts.filter({ hasText: "README.md" })).toBeVisible();
});
