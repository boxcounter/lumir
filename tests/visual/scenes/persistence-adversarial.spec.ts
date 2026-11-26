import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  DEMO_VAULT,
  dirtyReports,
  documentWrites,
  externalWrite,
  fileText,
  fireFsEvent,
  fireQuitBlocked,
  stubTauri,
  type VaultFixture,
  type VaultListRow,
} from "./tauri-stub";

// 持久化对抗场景（M844）：保存链路与 composer 草稿在**可控故障**下的端到端不变量。
//
// 桩的扩展方式沿用 `save-hardening-autosave.spec.ts` / `m455-draft-reject-no-rewrite.spec.ts`
// 的既有做法：`stubTauri` 之后追加一个 addInitScript，把 `__TAURI_INTERNALS__.invoke`
// 包一层（init script 按注册顺序执行，桩先建好、包装后套上），因此不改 `tauri-stub.ts`。
// 包装层提供：
//   - hold（执行前 / 执行后两种）：造「写还在磁盘上飞」「读已发生、应答在路上」；
//   - fail：按真后端信封抛错（code + message，必要时 params）；
//   - arrivals / calls / held：**正观测**注入点到达，缺到达即红，不靠结果反推。
//
// 覆盖的故障面：保存中继续编辑、写失败（磁盘满 / 权限）与重试、保存中外部改写（必须
// CAS 冲突、绝不覆盖）、保存中切文档 + **乱序返回**（后发的保存先完成）、保存中退出拦截、
// 草稿延迟读跨 vault（旧读不得覆盖新输入）、草稿写失败重试（输入与 history 不被清）、
// 崩溃备份恢复（内容进缓冲仍 dirty，保存按备份基准）。
//
// 只动合成 fixture 与桩，不碰真实 vault / config，不启动真机。

const README_ORIGINAL = DEMO_VAULT.files?.["README.md"] ?? "";

function fixtureRevision(text: string): string {
  return `fixture-revision-${text}`;
}

// ---------------------------------------------------------------------------
// 故障注入层
// ---------------------------------------------------------------------------

type FaultMode = "pass" | "hold" | "fail";
interface FaultOptions {
  /** hold 的时点：true = body 先执行、结果延迟交付（读/应答延迟）；缺省 = 执行本身被挡住。 */
  after?: boolean;
  error?: unknown;
}

/** 在桩之上再包一层 invoke：按命令挂起 / 失败 / 放行，并记录每次到达。 */
async function installFaults(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => Promise<unknown>;
    interface GateCall {
      args: unknown;
      resolve: () => void;
      reject: (error: unknown) => void;
    }
    const state = {
      policies: {} as Record<string, { mode: FaultMode; after?: boolean; error?: unknown }>,
      held: {} as Record<string, GateCall[]>,
      arrivals: {} as Record<string, number>,
      calls: {} as Record<string, unknown[]>,
    };
    const queue = (cmd: string): GateCall[] => (state.held[cmd] ??= []);
    w.__fault = {
      policy(cmd: string, mode: FaultMode, options: FaultOptions = {}) {
        state.policies[cmd] = { mode, ...options };
      },
      arrivals: (cmd: string) => state.arrivals[cmd] ?? 0,
      held: (cmd: string) => queue(cmd).length,
      calls: (cmd: string) => state.calls[cmd] ?? [],
      release(cmd: string, index = 0) {
        const call = queue(cmd)[index];
        if (call === undefined) throw new Error(`没有挂起的调用可放行：${cmd}`);
        queue(cmd).splice(index, 1);
        call.resolve();
      },
      reject(cmd: string, error: unknown, index = 0) {
        const call = queue(cmd)[index];
        if (call === undefined) throw new Error(`没有挂起的调用可拒绝：${cmd}`);
        queue(cmd).splice(index, 1);
        call.reject(error);
      },
    };
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => {
      state.arrivals[cmd] = (state.arrivals[cmd] ?? 0) + 1;
      (state.calls[cmd] ??= []).push(args);
      const policy = state.policies[cmd];
      if (policy?.mode === "fail") throw policy.error ?? { code: "fixture_fault", message: cmd };
      if (policy?.mode === "hold") {
        if (policy.after) {
          const result = await invoke(cmd, args);
          await new Promise<void>((resolve, reject) => queue(cmd).push({ args, resolve, reject }));
          return result;
        }
        await new Promise<void>((resolve, reject) => queue(cmd).push({ args, resolve, reject }));
      }
      return invoke(cmd, args);
    };
  });
}

async function faultPolicy(
  page: Page,
  cmd: string,
  mode: FaultMode,
  options: FaultOptions = {},
): Promise<void> {
  await page.evaluate(
    ({ cmd, mode, options }) => (window as unknown as Record<string, any>).__fault.policy(cmd, mode, options),
    { cmd, mode, options },
  );
}

async function faultArrivals(page: Page, cmd: string): Promise<number> {
  return page.evaluate(
    (c) => (window as unknown as Record<string, any>).__fault.arrivals(c) as number,
    cmd,
  );
}

async function faultHeld(page: Page, cmd: string): Promise<number> {
  return page.evaluate(
    (c) => (window as unknown as Record<string, any>).__fault.held(c) as number,
    cmd,
  );
}

async function faultCalls<T>(page: Page, cmd: string): Promise<T[]> {
  return page.evaluate(
    (c) => (window as unknown as Record<string, any>).__fault.calls(c) as T[],
    cmd,
  );
}

/** 正观测：注入点必须真的挂住了 n 个调用，否则后续断言验的不是这个故障。 */
async function expectHeld(page: Page, cmd: string, n = 1): Promise<void> {
  await expect
    .poll(() => faultHeld(page, cmd), { timeout: 5000, message: `${cmd} 未到达故障注入点` })
    .toBe(n);
}

async function releaseFault(page: Page, cmd: string, index = 0): Promise<void> {
  await page.evaluate(
    ({ cmd, index }) => (window as unknown as Record<string, any>).__fault.release(cmd, index),
    { cmd, index },
  );
}

/** 打开文件树里的一个文件（目录逐级点开）。 */
async function openDoc(page: Page, title: string): Promise<void> {
  const parts = title.split("/");
  for (const part of parts.slice(0, -1)) {
    await page.locator(`.ft-row[title="${part}"]`).click();
  }
  await page.locator(`.ft-row[title="${title}"]`).click();
  await expect(page.locator(".modeline-path")).toContainText(parts.at(-1)!);
}

/** 把焦点放到正文编辑器（只在每段连续输入的开头点一次——重复点击会把光标挪到元素中心）。 */
async function focusDoc(page: Page): Promise<void> {
  await page.locator(".editor-pane .cm-content[data-language]").click();
}

/** 在**已聚焦**的正文编辑器里键入（不重新点击，保持光标与选区）。 */
async function typeInDoc(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
}

// ---------------------------------------------------------------------------
// 草稿桩：按 vault 作用域存盘，并让测试能在页内读回写入序列
// ---------------------------------------------------------------------------

interface DraftSeed {
  [vaultId: string]: string | null;
}

/** 在桩之上接管 harness_draft_get / put：作用域随后端 vault 切换（与真后端同构）。 */
async function installDraftStore(page: Page, seed: DraftSeed, initialScope: string): Promise<void> {
  await page.addInitScript(
    ({ seed, initialScope }) => {
      const w = window as unknown as Record<string, any>;
      const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => Promise<unknown>;
      let scope = initialScope;
      const files: Record<string, string | null> = { ...seed };
      w.__draftWrites = [] as Array<{ scope: string; value: string }>;
      w.__draftReads = [] as string[];
      w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
        if (cmd === "harness_draft_get") {
          w.__draftReads.push(scope);
          return files[scope] ?? null;
        }
        if (cmd === "harness_draft_put") {
          const value = String(args.draft_json ?? "");
          w.__draftWrites.push({ scope, value });
          files[scope] = value === "" ? null : value;
          return null;
        }
        const result = await invoke(cmd, args);
        if (cmd === "vault_open_path" || cmd === "vault_open") {
          const info = result as { vault_id?: string } | null;
          if (info?.vault_id !== undefined) scope = info.vault_id;
        }
        return result;
      };
      w.__draftFile = (vaultId: string) => files[vaultId] ?? null;
    },
    { seed, initialScope },
  );
}

async function draftWrites(page: Page): Promise<Array<{ scope: string; value: string }>> {
  return page.evaluate(
    () => (window as unknown as Record<string, any>).__draftWrites as Array<{ scope: string; value: string }>,
  );
}

async function draftFile(page: Page, vaultId: string): Promise<string | null> {
  return page.evaluate(
    (id) => (window as unknown as Record<string, any>).__draftFile(id) as string | null,
    vaultId,
  );
}

/** composer 的文本与光标（CM 状态，不是 DOM 选区——后者在未持焦时不可见）。 */
async function composerState(page: Page): Promise<{ text: string; caret: number }> {
  return page.evaluate(() => {
    const view = (document.querySelector(".lumir-hp-composer .cm-content") as unknown as {
      cmTile: { root: { view: { state: { doc: { toString(): string }; selection: { main: { head: number } } } } } };
    }).cmTile.root.view;
    return { text: view.state.doc.toString(), caret: view.state.selection.main.head };
  });
}

async function openComposer(page: Page): Promise<void> {
  const composer = page.locator(".lumir-hp-composer .cm-content");
  if (!(await composer.isVisible())) await page.locator(".lumir-hp-toggle").click();
  await expect(composer).toBeVisible();
}

// ---------------------------------------------------------------------------
// 正文保存：延迟、失败、外部变更、乱序、退出
// ---------------------------------------------------------------------------

test("保存中继续编辑：延迟写只算快照，dirty / 选区 / history 不被偷走，重试写最新内容", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await installFaults(page);
  await page.goto("/");
  await openDoc(page, "README.md");
  await focusDoc(page);
  await typeInDoc(page, "ONE");
  await expect(page.locator(".modeline-path")).toContainText("未保存");

  await faultPolicy(page, "document_save", "hold");
  await page.keyboard.press("Meta+s");
  await expectHeld(page, "document_save");
  const calls = await faultCalls<{ path: string; expected_revision: string; content: string }>(
    page,
    "document_save",
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]!.path).toBe("README.md");
  expect(calls[0]!.expected_revision).toBe(fixtureRevision(README_ORIGINAL));
  expect(calls[0]!.content).toContain("ONE");

  // 在途期间继续输入 + 后端 dirty 镜像是 true：退出仍被拦（居中模态）。
  await typeInDoc(page, "TWO");
  await fireQuitBlocked(page);
  await expect(page.locator(".lumir-quit-card")).toBeVisible();
  await expect(page.locator("#lumir-quit-title")).toHaveText("有未保存的修改");
  // 取消只关弹框，后续保存 / 重试步骤继续在编辑器里做。
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-quit-overlay")).toBeHidden();

  await releaseFault(page, "document_save");
  await expect(page.locator(".lumir-toast", { hasText: "仍有未保存修改" })).toBeVisible();
  await expect(page.locator(".modeline-path")).toContainText("未保存");
  await expect(page.locator(".editor-pane .cm-content[data-language]")).toContainText("ONETWO");

  // 选区与 history 未被重载吞掉：追加的字符落在原光标处，⌘Z 只撤掉它这一段
  //（等过一个 CM 的 newGroupDelay，免得 TAIL 与前一段输入并进同一个 undo 组）。
  await page.waitForTimeout(700);
  await page.keyboard.type("TAIL");
  await expect(page.locator(".editor-pane .cm-content[data-language]")).toContainText("ONETWOTAIL");
  await page.keyboard.press("Meta+z");
  await expect(page.locator(".editor-pane .cm-content[data-language]")).not.toContainText("TAIL");
  await expect(page.locator(".editor-pane .cm-content[data-language]")).toContainText("ONETWO");

  // 重试：CAS 基准已推进到第一笔写返回的 revision，内容是最新的。
  await faultPolicy(page, "document_save", "pass");
  await page.keyboard.press("Meta+s");
  await expect.poll(async () => (await documentWrites(page)).length, { timeout: 5000 }).toBe(2);
  const writes = await documentWrites(page);
  // 第一笔写的是发起保存那一刻的快照（只有 ONE）；续打进来的 TWO 必须留给第二笔。
  expect(writes[0]!.content).toContain("ONE");
  expect(writes[0]!.content).not.toContain("TWO");
  expect(writes[1]!.content).toContain("ONETWO");
  expect(writes[1]!.content).not.toContain("TAIL");
  await expect(page.locator(".modeline-path")).not.toContainText("未保存");
  await expect(page.locator(".lumir-quit-overlay")).toBeHidden();
  expect(await fileText(page, "README.md")).toContain("ONETWO");
  expect(await dirtyReports(page)).toContain(false);
});

test("写失败（磁盘满）：如实提示、内容与 history 保留、重试真的落盘", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await installFaults(page);
  await page.goto("/");
  await openDoc(page, "README.md");
  await focusDoc(page);
  await typeInDoc(page, "KEEP1");

  await faultPolicy(page, "document_save", "fail", {
    error: {
      code: "document_write_failed",
      message: "无法创建临时文件：No space left on device",
    },
  });
  await page.keyboard.press("Meta+s");
  await expect(page.locator(".lumir-toast", { hasText: "保存失败" })).toContainText("无法写入文档");
  await expect(page.locator(".modeline-path")).toContainText("未保存");
  await expect(page.locator(".editor-pane .cm-content[data-language]")).toContainText("KEEP1");
  expect(await documentWrites(page)).toEqual([]); // 正观测：一次写都没到后端

  // 失败不清 history：继续键入后 ⌘Z 只撤掉这一段、⌘⇧Z 能把它拿回来。
  //（等过一个 CM 的 newGroupDelay，让两次输入落在不同的 undo 组里。）
  await page.waitForTimeout(700);
  await typeInDoc(page, "KEEP2");
  await expect(page.locator(".editor-pane .cm-content[data-language]")).toContainText("KEEP1KEEP2");
  await page.keyboard.press("Meta+z");
  await expect(page.locator(".editor-pane .cm-content[data-language]")).toContainText("KEEP1");
  await expect(page.locator(".editor-pane .cm-content[data-language]")).not.toContainText("KEEP2");
  await page.keyboard.press("Meta+Shift+z");
  await expect(page.locator(".editor-pane .cm-content[data-language]")).toContainText("KEEP1KEEP2");

  await faultPolicy(page, "document_save", "pass");
  await page.keyboard.press("Meta+s");
  await expect(page.locator(".lumir-toast", { hasText: "已保存" })).toBeVisible();
  await expect(page.locator(".modeline-path")).not.toContainText("未保存");
  expect(await fileText(page, "README.md")).toContain("KEEP1KEEP2");
});

test("保存中外部改写：CAS 冲突、第三方内容不被覆盖；在途期间的 watch 事件不误报", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await installFaults(page);
  await page.goto("/");
  await openDoc(page, "README.md");
  await focusDoc(page);
  await typeInDoc(page, "LOCAL");

  await faultPolicy(page, "document_save", "hold");
  await page.keyboard.press("Meta+s");
  await expectHeld(page, "document_save");

  // 在途期间的 watch 事件不得弹「检测到外部修改」（saving 快速路径）。
  await externalWrite(page, "README.md", "# EXTERNAL\n");
  await fireFsEvent(page, [{ kind: "modified", path: "README.md", entry_kind: "file" }]);
  await page.waitForTimeout(200);
  await expect(page.locator(".lumir-toast", { hasText: "检测到外部修改" })).toHaveCount(0);

  // 放行后写盘看到的是外部版本：必须按 CAS 冲突收敛，绝不覆盖。
  await releaseFault(page, "document_save");
  const conflict = page.locator(".lumir-toast", { hasText: "保存冲突" });
  await expect(conflict).toBeVisible();
  expect(await fileText(page, "README.md")).toBe("# EXTERNAL\n");
  await expect(page.locator(".modeline-path")).toContainText("未保存");
  await expect(page.locator(".editor-pane .cm-content[data-language]")).toContainText("LOCAL");

  // 用户显式选择覆盖：内容落盘、dirty 清除（逃生口可用）。第二笔写不再挂起。
  await faultPolicy(page, "document_save", "pass");
  await conflict.getByRole("button", { name: "强制覆盖保存" }).click();
  await page.locator(".lumir-toast", { hasText: "将覆盖磁盘上较新的内容" }).getByRole("button", { name: "覆盖保存" }).click();
  await expect.poll(() => fileText(page, "README.md"), { timeout: 5000 }).toContain("LOCAL");
  await expect(page.locator(".modeline-path")).not.toContainText("未保存");
});

test("保存中切文档 + 乱序返回：后发的保存先完成，结果仍各归各的文档", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await installFaults(page);
  await page.goto("/");
  await openDoc(page, "README.md");
  await focusDoc(page);
  await typeInDoc(page, "R-EDIT");

  await faultPolicy(page, "document_save", "hold");
  await page.keyboard.press("Meta+s");
  await expectHeld(page, "document_save", 1);

  // 切到另一份文档并保存：第二笔写也挂住，队列里两笔并存。
  await openDoc(page, "docs/guide.md");
  await focusDoc(page);
  await typeInDoc(page, "G-EDIT");
  await page.keyboard.press("Meta+s");
  await expectHeld(page, "document_save", 2);
  const calls = await faultCalls<{ path: string; content: string }>(page, "document_save");
  expect(calls.map((call) => call.path)).toEqual(["README.md", "docs/guide.md"]);

  // 乱序：guide（后发）先完成，README（先发）后完成。
  await releaseFault(page, "document_save", 1);
  await expect.poll(async () => (await documentWrites(page)).map((write) => write.path)).toContain(
    "docs/guide.md",
  );
  await expect(
    page.locator(".tab", { hasText: "guide.md" }).locator(".tab-dirty"),
  ).not.toBeVisible();
  await releaseFault(page, "document_save", 0);
  await expect.poll(async () => (await documentWrites(page)).length, { timeout: 5000 }).toBe(2);
  // 落盘顺序是「后发先至」：guide（后发）先完成、README（先发）后完成——这就是乱序现场。
  expect((await documentWrites(page)).map((write) => write.path)).toEqual([
    "docs/guide.md",
    "README.md",
  ]);
  await expect(
    page.locator(".tab", { hasText: "README.md" }).locator(".tab-dirty"),
  ).not.toBeVisible();

  expect((await fileText(page, "README.md")) ?? "").toContain("R-EDIT");
  expect((await fileText(page, "docs/guide.md")) ?? "").toContain("G-EDIT");
  await expect(page.locator(".modeline-path")).toContainText("guide.md");
  await expect(page.locator(".modeline-path")).not.toContainText("未保存");
});

// ---------------------------------------------------------------------------
// 草稿：延迟读跨 vault、写失败重试
// ---------------------------------------------------------------------------

const VAULT_A_ID = "fixture-vault";
const VAULT_B_ID = "fixture-vault-b";
const VAULT_B_ROOT = "/Users/alex/notes-vault";
const VAULT_B: VaultFixture & { root: string } = {
  root: VAULT_B_ROOT,
  vault_id: VAULT_B_ID,
  entries: [
    { path: "inbox.md", kind: "file", size: 32, mtime_ms: 1757000000000 },
  ],
  files: { "inbox.md": "# Inbox\n\n第二个 vault。\n" },
};
const REGISTRY: VaultListRow[] = [
  {
    id: VAULT_A_ID,
    path: "/Users/alex/demo-vault",
    name: "demo-vault",
    available: true,
    last_opened_at: 1757000002000,
    tab_count: 1,
  },
  {
    id: VAULT_B_ID,
    path: VAULT_B_ROOT,
    name: "notes-vault",
    available: true,
    last_opened_at: 1757000001000,
    tab_count: 0,
  },
];
const DRAFT_A = JSON.stringify({ version: 3, text: "A-DRAFT", caret: 7, cards: [], skills: [] });

test("草稿延迟读跨 vault：旧 vault 的读在途时打字、切走，读回来不得覆盖新输入", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, vaults: REGISTRY, switchTo: VAULT_B });
  await installDraftStore(page, { [VAULT_A_ID]: DRAFT_A, [VAULT_B_ID]: null }, VAULT_A_ID);
  await installFaults(page);
  await page.goto("/");
  await openDoc(page, "README.md");
  await openComposer(page);

  // 装载读回：文本与光标都来自盘上的草稿（caret 7）。
  await expect.poll(async () => (await composerState(page)).text, { timeout: 5000 }).toBe("A-DRAFT");
  expect((await composerState(page)).caret).toBe(7);

  // 下一次装载（切 vault）的读挂住：结果已经产生，应答延迟。
  await faultPolicy(page, "harness_draft_get", "hold", { after: true });
  await page.locator(".ft-vault").click();
  await page.locator(`.vault-row[data-vault="${VAULT_B_ID}"]`).click();
  await expectHeld(page, "harness_draft_get");

  // 切 vault 会重置面板视图；重新打开输入区（不触发新的 load，读仍挂住）。
  await openComposer(page);

  // 读在途时用户在新 vault 里打字。
  const composer = page.locator(".lumir-hp-composer .cm-content");
  await composer.click();
  await page.keyboard.type("B-INPUT");
  await expect.poll(async () => (await composerState(page)).text).toBe("B-INPUT");

  await releaseFault(page, "harness_draft_get");
  await page.waitForTimeout(200);
  // 旧读（B 的 null）不得清掉新输入；A 的草稿更不得被铺进 B 的输入区。
  await expect.poll(async () => (await composerState(page)).text).toBe("B-INPUT");

  // 新输入按 B 的作用域落盘，A 的草稿原样保留。
  await expect.poll(async () => (await draftWrites(page)).length, { timeout: 5000 }).toBeGreaterThan(0);
  const writes = await draftWrites(page);
  expect(writes.at(-1)!.scope).toBe(VAULT_B_ID);
  expect(writes.at(-1)!.value).toContain("B-INPUT");
  expect(await draftFile(page, VAULT_A_ID)).toBe(DRAFT_A);
  expect(await draftFile(page, VAULT_B_ID)).toContain("B-INPUT");
});

test("草稿写失败（磁盘满）：只降级提示，输入与 history 保留；重试写最新内容", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await installDraftStore(page, { [VAULT_A_ID]: null }, VAULT_A_ID);
  await installFaults(page);
  await page.goto("/");
  await openDoc(page, "README.md");
  await openComposer(page);

  const composer = page.locator(".lumir-hp-composer .cm-content");
  await composer.click();
  await page.keyboard.type("D1");
  await expect.poll(async () => (await draftWrites(page)).length, { timeout: 5000 }).toBe(1);
  expect((await draftWrites(page))[0]!.value).toContain("D1");

  await faultPolicy(page, "harness_draft_put", "fail", {
    error: {
      code: "harness_draft_write_failed",
      message: "草稿保存失败：No space left on device",
      params: { reason: "No space left on device" },
    },
  });
  const arrivalsBefore = await faultArrivals(page, "harness_draft_put");
  await page.keyboard.type("D2");
  await expect(page.locator(".lumir-toast", { hasText: "草稿保存失败" })).toBeVisible({
    timeout: 5000,
  });
  // 正观测：失败那次确实到达了后端命令（不是被上层吞掉）。
  expect(await faultArrivals(page, "harness_draft_put")).toBeGreaterThan(arrivalsBefore);
  // 输入不被阻断，history 也还在（⌘Z 撤掉刚打的这一段）。
  await page.keyboard.type("D3");
  await expect.poll(async () => (await composerState(page)).text).toBe("D1D2D3");
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await composerState(page)).text).toBe("D1D2");

  // 重试：离开输入区触发离散 flush，写走的是最新内容。
  await faultPolicy(page, "harness_draft_put", "pass");
  await page.locator(".editor-pane .cm-content[data-language]").click();
  await expect.poll(async () => (await draftWrites(page)).at(-1)?.value ?? "", { timeout: 5000 }).toContain(
    "D1D2",
  );
  expect(await draftFile(page, VAULT_A_ID)).toContain("D1D2");
});

// ---------------------------------------------------------------------------
// 崩溃备份恢复
// ---------------------------------------------------------------------------

test("崩溃备份：恢复内容进缓冲且保持 dirty，保存按备份基准走、成功后清除备份", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await page.addInitScript((seed) => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: any) => Promise<unknown>;
    const backups: Record<string, { content: string; baseRevision: string }> = { ...seed };
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (cmd === "recovery_list") return Object.keys(backups);
      if (cmd === "recovery_load") return backups[args.path]?.content ?? null;
      if (cmd === "recovery_base_revision") return backups[args.path]?.baseRevision ?? null;
      if (cmd === "recovery_backup") {
        backups[args.path] = { content: args.content, baseRevision: args.base_revision };
        return null;
      }
      if (cmd === "recovery_discard") {
        delete backups[args.path];
        return null;
      }
      return invoke(cmd, args);
    };
    w.__backups = backups;
  }, { "README.md": { content: "# RECOVERED\n", baseRevision: fixtureRevision(README_ORIGINAL) } });

  await page.goto("/");
  const prompt = page.locator(".lumir-toast", { hasText: "发现未保存的崩溃备份" });
  await expect(prompt).toContainText("README.md");
  await prompt.getByRole("button", { name: "恢复内容" }).click();

  // 内容进了缓冲，但仍是未保存状态（不得静默覆盖磁盘）。
  await expect(page.locator(".editor-pane .cm-content[data-language]")).toContainText("RECOVERED");
  await expect(page.locator(".modeline-path")).toContainText("未保存");
  expect(await fileText(page, "README.md")).toBe(README_ORIGINAL);

  // 保存用备份记录的基准：桩的 CAS 校验通过才可能走到「已保存」。
  await page.keyboard.press("Meta+s");
  await expect(page.locator(".lumir-toast", { hasText: "已保存" })).toBeVisible();
  await expect(page.locator(".modeline-path")).not.toContainText("未保存");
  expect(await fileText(page, "README.md")).toContain("RECOVERED");
  const backups = await page.evaluate(
    () => (window as unknown as Record<string, any>).__backups as Record<string, unknown>,
  );
  expect(backups["README.md"]).toBeUndefined();
});
