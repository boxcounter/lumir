import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { DEMO_VAULT, externalWrite, fileText, fireFsEvent, stubTauri } from "./tauri-stub";

// M127 崩溃备份与 M278 保存链路硬化（本文件原名与自动保存有关，自动保存已整条移除，
// 文件名保留以免孤立既有的基线快照；内容以崩溃备份为轴）：
//
// - **写盘时机归作者**（change remove-autosave）：vault 内文档只由用户的显式动作改写
//   （⌘S / 冲突处置的两个动作 / 另存为新文件），没有任何「dirty 即自行落盘」的路径；
// - **崩溃备份有自有触发**：dirty 后停止输入满一个 debounce（2s）写一份，每次内容变化
//   重置窗口；备份 ≠ 保存（不清 dirty、不推基准、不发「已保存」）；
// - **备份的生命周期与 dirty 对齐**：内存内容回到磁盘基线（保存成功 / 撤销回到基线 /
//   放弃修改）即清除该路径的备份；
// - **自身写盘回声**（D2）：命中打开中文件的 modified 事件先比对磁盘 revision 与会话基准，
//   一致即回声、不产生任何用户可见处置——不论编辑器是否 dirty（M266 实测 177ms 的窗口）。
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

/** document_save 的调用次数：写盘只由用户的显式动作触发（自动保存已移除），
 *  因此「等过多个 debounce 窗口而计数不变」是一条有效判据。 */
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
  await expect(page.locator(".modeline-path")).toContainText("未保存");
  return content;
}

test("崩溃备份：停止输入满 debounce 才写，连续输入期间不写且 vault 内文件不被改写", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await stubHardening(page);
  const content = await openAndEdit(page);

  // debounce 语义：刚停下不写备份（否则每敲一个字符就写一次磁盘）。
  await page.waitForTimeout(800);
  expect(await backupContent(page, "README.md")).toBeUndefined();

  // 停顿不足一个窗口就继续输入：计时重置，第一次的到期点不得写备份。
  await page.keyboard.type("MORE");
  await page.waitForTimeout(800);
  expect(await backupContent(page, "README.md")).toBeUndefined();

  // 真正停止输入满一个窗口后写入一份备份：内容含两次输入，基准是编辑器已知的磁盘 revision。
  await expect
    .poll(async () => backupContent(page, "README.md") ?? "", { timeout: 6000 })
    .toContain("MORE");
  expect(await backupBaseRevision(page, "README.md")).toBe(fixtureRevision(README_ORIGINAL));

  // 备份 ≠ 保存：vault 内文件逐字节未变、没有发过任何写入、dirty 未清除。
  expect(await fileText(page, "README.md")).toBe(README_ORIGINAL);
  expect(await saveCalls(page)).toBe(0);
  await expect(page.locator(".modeline-path")).toContainText("未保存");
  await expect(content).toContainText("MORE");
});

test("未解决冲突时不再有任何自动写盘：dirty 内容只进崩溃备份", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await stubHardening(page);
  const content = await openAndEdit(page);

  // Obsidian 侧先保存同文件 → Lumir 保存得到真实 CAS 冲突（未处置）。
  await externalWrite(page, "README.md", "# External version\n");
  await page.keyboard.press("Meta+s");
  await expect(page.locator(".lumir-toast", { hasText: "保存冲突" })).toBeVisible();
  const afterManualSave = await saveCalls(page);
  expect(afterManualSave).toBe(1);

  // 冲突未处置期间继续输入并等过 debounce：没有任何自动写盘（CAS 必败，重试无意义）。
  await content.click();
  await page.keyboard.type("MORE");
  await page.waitForTimeout(3000);
  expect(await saveCalls(page)).toBe(afterManualSave);
  expect(await fileText(page, "README.md")).toBe("# External version\n");
  await expect(page.locator(".modeline-path")).toContainText("未保存");

  // dirty 内容按自己的 debounce 进崩溃备份（进程崩溃仍有内容可恢复），且基准 revision 是
  // 「最后一次与编辑器同步的磁盘版本」（外部修改前的那个），不是外部修改后的版本——
  // 恢复侧据此才能判定磁盘已被改过。
  await expect.poll(async () => backupContent(page, "README.md") ?? "").toContain("MORE");
  expect(await backupBaseRevision(page, "README.md")).toBe(fixtureRevision(README_ORIGINAL));
});

test("外部修改待决（dirty）：等过 debounce 也无保存尝试，磁盘与缓冲都保持原样", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await stubHardening(page);
  await openAndEdit(page);

  // watch 送达外部修改：dirty 时把选择权交给用户（磁盘 revision 与会话基准不一致 ⇒ 不是回声）。
  await externalWrite(page, "README.md", "# External version\n");
  await fireFsEvent(page, [{ kind: "modified", path: "README.md", entry_kind: "file" }]);
  await expect(page.locator(".lumir-toast", { hasText: "检测到外部修改" })).toBeVisible();

  await page.waitForTimeout(3000);
  expect(await saveCalls(page)).toBe(0);
  expect(await fileText(page, "README.md")).toBe("# External version\n");
  await expect(page.locator(".modeline-path")).toContainText("未保存");
  await expect.poll(async () => backupContent(page, "README.md") ?? "").toContain("ZZZ");
  expect(await backupBaseRevision(page, "README.md")).toBe(fixtureRevision(README_ORIGINAL));
});

test("强制覆盖保存成功：备份随保存成功清除；此后再输入只落备份、不再自动写盘", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await stubHardening(page);
  const content = await openAndEdit(page);

  await externalWrite(page, "README.md", "# External version\n");
  await page.keyboard.press("Meta+s");
  const conflict = page.locator(".lumir-toast", { hasText: "保存冲突" });
  await expect(conflict).toBeVisible();
  // 等一个 debounce：dirty 内容先产生崩溃备份（下一步验证保存成功即清除）。
  await expect.poll(async () => backupContent(page, "README.md") ?? "").toContain("ZZZ");

  await conflict.getByRole("button", { name: "强制覆盖保存" }).click();
  await page
    .locator(".lumir-toast", { hasText: "将覆盖磁盘上较新的内容" })
    .getByRole("button", { name: "覆盖保存" })
    .click();
  await expect(page.locator(".lumir-toast", { hasText: "已强制覆盖保存" })).toBeVisible();

  await expect.poll(() => fileText(page, "README.md")).toContain("ZZZ");
  await expect.poll(async () => (await recoveryStore(page))).toEqual({});
  await expect(page.locator(".modeline-path")).not.toContainText("未保存");

  // 此后再输入：vault 内文件只在用户按 ⌘S 时才更新，定时写入只剩崩溃备份。
  const writesAfterForce = await saveCalls(page);
  await content.click();
  await page.keyboard.type("TAIL");
  await expect
    .poll(async () => backupContent(page, "README.md") ?? "", { timeout: 6000 })
    .toContain("TAIL");
  expect(await saveCalls(page)).toBe(writesAfterForce);
  expect(await fileText(page, "README.md")).not.toContain("TAIL");
  await expect(page.locator(".modeline-path")).toContainText("未保存");
});

test("撤销回到已保存基线：该路径的崩溃备份同步清除", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await stubHardening(page);
  const content = await openAndEdit(page);

  // 先制造一份备份（等满一个 debounce 窗口）。
  await expect
    .poll(async () => backupContent(page, "README.md") ?? "", { timeout: 6000 })
    .toContain("ZZZ");

  // ⌘Z 撤销回到打开时的内容：dirty 收窄为 false，该路径的备份随之作废——
  // 否则下次启动会追问「要不要恢复一份用户已经撤销掉的内容」。
  await content.click();
  await page.keyboard.press("Meta+z");
  await expect(page.locator(".modeline-path")).not.toContainText("未保存");
  await expect.poll(async () => (await recoveryStore(page))).toEqual({});
  expect(await fileText(page, "README.md")).toBe(README_ORIGINAL);
});

test("自身写盘回声（D2）：保存后立刻再键入，回声到达时不误报外部修改", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await stubHardening(page);
  const content = await openAndEdit(page);

  await page.keyboard.press("Meta+s");
  await expect(page.locator(".lumir-toast", { hasText: "已保存" })).toBeVisible();
  const savedText = (await fileText(page, "README.md")) ?? "";

  // 回声到达前继续键入（M266 实测的 177ms 窗口）：缓冲区重新 dirty。
  await page.keyboard.type("LATE");
  await expect(page.locator(".modeline-path")).toContainText("未保存");

  // 注入那次保存产生的 fs 事件：磁盘 revision 与会话已知基准一致 ⇒ 判为自身写盘回声。
  // 负向判据的正对照在同文件的「外部修改待决」一组：同一条 fireFsEvent 通道在磁盘真有
  // 第三方写入时确实会给出提示，这里的 toHaveCount(0) 不是「读不到就当没有」。
  await fireFsEvent(page, [{ kind: "modified", path: "README.md", entry_kind: "file" }]);

  await expect(page.locator(".lumir-toast", { hasText: "检测到外部修改" })).toHaveCount(0);
  await expect(page.locator(".modeline-path")).toContainText("未保存");
  await expect(content).toContainText("LATE");
  expect(await fileText(page, "README.md")).toBe(savedText);
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
  await expect(page.locator(".modeline-path")).toContainText("未保存");

  // 等过多个备份窗口也不落盘（写盘只由 ⌘S 触发，自动保存已移除）。
  await page.waitForTimeout(2600);
  expect(await fileText(page, "README.md")).toBe(README_ORIGINAL);

  // 按 ⌘S 才落盘，备份随之清除。
  await content.click();
  await page.keyboard.press("Meta+s");
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
  await expect(page.locator(".modeline-path")).toContainText("未保存");

  // 恢复时 MUST NOT 把磁盘当前 revision 吸为新基准。本 change 之后没有任何自动写盘，
  // 所以冲突不会被「自动替用户撞出来」：先等过多个备份窗口证明磁盘纹丝不动、内存内容仍在，
  // 再由用户的 ⌘S 触发按 CAS 报冲突（不静默覆盖），磁盘上较新的外部版本原样保留。
  await page.waitForTimeout(2600);
  expect(await fileText(page, "README.md")).toBe("# External newer\n");
  await expect(page.locator(".lumir-toast", { hasText: "保存冲突" })).toHaveCount(0);

  await content.click();
  await page.keyboard.press("Meta+s");
  const conflict = page.locator(".lumir-toast", { hasText: "保存冲突" });
  await expect(conflict).toBeVisible({ timeout: 6000 });
  await expect(conflict).toContainText("未丢失");
  await expect(conflict.getByRole("button", { name: "重新载入（放弃我的修改）" })).toBeVisible();
  await expect(conflict.getByRole("button", { name: "强制覆盖保存" })).toBeVisible();
  expect(await fileText(page, "README.md")).toBe("# External newer\n");
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
