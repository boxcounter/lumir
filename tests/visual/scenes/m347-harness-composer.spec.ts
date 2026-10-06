import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M347 composer 控制行 + 复制 + 进度：模型 chip（闭集合 provider 浮层 + config_set_value
// 写回）、ctx% 读数（usage 事件消费 / 超阈值高亮 + ⓘ 按需气泡）、发送钮两态（处理中 = 停止，
// 停止钩子 M348 对接面桩期未注册——点击只走状态机）、不定态进度条 + 阶段指示两档、
// 消息复制钮（hover 浮现，复制源 = 源文本非渲染 HTML）。
//
// 全部断言是**结构断言**（在场性 / 文案 / 状态 / 调用记录）——本场景不碰任何像素基线
//（批次末统一重建是 HP4 的面，tower 指令禁止 --update）。面板打开是纯前端路径，事件经
// __fireHarnessEvent 从桩侧注入（stubTauri 的 listen 闭包不可达，这里经暴露的
// runCallback + 自己记录的 handler id 送达，与既有 __fireMenuCommand 同机制）。

const DOC = "# 控制行笔记\n\n第一段，给上下文 chip 一个视口口径。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

/** M347 场景桩：在 stubTauri 的 init script 之后运行（addInitScript 按注册序执行，
 *  __TAURI_INTERNALS__ 已就位）：
 *   1. config_get 补 `[harness]` 段（通用 stub 不认识 harness 配置——不补则 chip 按
 *      「不伪造读数」口径隐藏，模型 chip 的用例就跑不起来）；
 *   2. harness_state 零态桩（同 m303）；
 *   3. harness_send / config_set_value 调用记录（写回判据 = 参数逐字，不看副作用）；
 *   4. harness:event 注入钩子（记录 listen 的 handler id，经 runCallback 送达）；
 *   5. 剪贴板 writeText 桩（__copied 记录写入内容——复制源的判据面）。 */
async function stubHarnessComposer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__providerWrites = [];
    w.__sentMessages = [];
    w.__harnessEventHandlerIds = [];
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "config_set_value") {
        w.__providerWrites.push({ section: args.section, key: args.key, value: args.value });
        return null;
      }
      if (cmd === "harness_send") {
        w.__sentMessages.push({ message: args.message });
        return null;
      }
      // 停止路径（面板自 M348 起把默认停止钩子接成真实的 harnessAbort）：桩里**成功返回、
      // 不发终态事件**——相位因此停在 stopping（这正是本用例要判的子态；不拦这条会走
      // origInvoke 抛 unknown_command，钩子的 catch 立刻 finished 收口回 idle，断言必红）。
      if (cmd === "harness_abort") {
        return null;
      }
      // harness_state：通用 stub 不认识这条命令（走 origInvoke 会抛 unknown_command），
      // 在链条最前拦截——零态桩与 Rust StateSnapshot::empty 同形（同 m303）。
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct: 0 },
          pending_approval: null,
          warn_ctx_pct: 85,
        });
      }
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      const result = await origInvoke(cmd, args);
      if (cmd === "config_get" && result?.config) {
        result.config.harness = {
          provider: "mock",
          providers: { kimi: { model: "k2" }, deepseek: { model: "d" }, mock: { fixture: "f.json" } },
          permissions: { allow: [], deny: [] },
          loop_max: 8,
          warn_ctx_pct: 85,
          auto_compact: true,
        };
      }
      return result;
    };
    w.__fireHarnessEvent = (payload: unknown) => {
      for (const id of w.__harnessEventHandlerIds) {
        internals.runCallback(id, { event: "harness:event", id, payload });
      }
    };
    w.__copied = [];
    Object.assign(navigator.clipboard, {
      writeText: (text: string) => {
        w.__copied.push(text);
        return Promise.resolve();
      },
    });
  });
}

test("composer 控制行：模型 chip 写回 / ctx 读数高亮 + ⓘ 气泡 / 发送钮两态 / 消息复制", async ({
  page,
}) => {
  await stubTauri(page, VAULT);
  await stubHarnessComposer(page);
  await page.goto("/");

  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  const panel = page.locator(".lumir-harness");
  await expect(panel).toBeVisible();

  // ── 控制行结构（M347）：[模型 chip][composer][ctx 读数][发送钮] ──
  const order = await page.locator(".lumir-hp-composer-row > *").evaluateAll((els) =>
    els.map((el) => el.classList[0]),
  );
  expect(order).toEqual(["lumir-hp-model", "lumir-hp-composer", "lumir-hp-ctxwrap", "lumir-hp-send"]);

  // ── 模型 chip：读数 / ellipsis / 悬停全名 / provider 浮层 / config_set_value 写回 ──
  const modelChip = page.locator(".lumir-hp-model");
  await expect(modelChip).toBeVisible();
  await expect(modelChip).toHaveText("mock");
  await expect(modelChip).toHaveAttribute("title", "模型：mock（点击切换）");
  const chipStyle = await modelChip.locator(".lumir-hp-model-name").evaluate((el) => {
    const s = getComputedStyle(el);
    return { overflow: s.overflow, textOverflow: s.textOverflow };
  });
  expect(chipStyle).toEqual({ overflow: "hidden", textOverflow: "ellipsis" });

  await modelChip.click();
  const modelPop = page.locator(".lumir-hp-modelpop");
  await expect(modelPop).toBeVisible();
  const items = modelPop.locator(".lumir-hp-modelpop-item");
  await expect(items).toHaveCount(3);
  await expect(items).toHaveText([/kimi/, /deepseek/, /mock/]);
  // 当前项：唯一、带「当前」标记与 aria-checked（闭集合外的配置键不上屏——桩里只配了三档）。
  await expect(modelPop.locator(".lumir-hp-modelpop-item.is-current")).toHaveCount(1);
  await expect(modelPop.locator(".lumir-hp-modelpop-item.is-current")).toContainText("当前");
  await items.nth(0).click(); // 选 kimi
  await expect(modelChip.locator(".lumir-hp-model-name")).toHaveText("kimi");
  const writes = await page.evaluate(() => (window as unknown as { __providerWrites: unknown[] }).__providerWrites);
  expect(writes).toEqual([{ section: "harness", key: "provider", value: "kimi" }]);
  // 浮层外交互收起。
  await page.locator(".lumir-hp-transcript").click();
  await expect(modelPop).toBeHidden();

  // ── ctx% 读数：快照零读数在场；usage 事件越阈值 → 高亮 + ⓘ 气泡 ──
  const ctxRead = page.locator(".lumir-hp-ctx");
  await expect(ctxRead).toHaveText("ctx 0%");
  await expect(ctxRead).not.toHaveClass(/is-warn/);
  await expect(page.locator(".lumir-hp-ctx-info")).toBeHidden();
  await page.evaluate(() =>
    (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent({
      type: "usage",
      ctx_pct: 86,
      cache_pct: 0,
    }),
  );
  await expect(ctxRead).toHaveText("ctx 86%");
  await expect(ctxRead).toHaveClass(/is-warn/);
  const ctxInfo = page.locator(".lumir-hp-ctx-info");
  await expect(ctxInfo).toBeVisible();
  await expect(ctxInfo).toHaveAttribute("aria-label", "上下文用量说明"); // D377 消费落账
  await ctxInfo.click();
  const ctxPop = page.locator(".lumir-hp-ctxpop");
  await expect(ctxPop).toBeVisible();
  await expect(ctxPop).toContainText("86%");
  await expect(ctxPop).toContainText("85%");
  // 低于阈值 → 高亮与 ⓘ 退场（气泡随之收起）。
  await page.locator(".lumir-hp-transcript").click();
  await expect(ctxPop).toBeHidden();
  await page.evaluate(() =>
    (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent({
      type: "usage",
      ctx_pct: 60,
      cache_pct: 0,
    }),
  );
  await expect(ctxRead).toHaveText("ctx 60%");
  await expect(ctxRead).not.toHaveClass(/is-warn/);
  await expect(ctxInfo).toBeHidden();

  // ── 发送钮两态 + 进度条/阶段指示：发送 → 停止态；停止点击 → 状态机；done → 回 idle ──
  await page.locator(".lumir-hp-composer").fill("这段会触发压缩吗");
  await page.locator(".lumir-hp-send").click(); // 空闲相位 = 发送
  await expect(page.locator(".lumir-hp-send")).toHaveText("停止");
  await expect(page.locator(".lumir-hp-send")).toHaveClass(/is-busy/);
  await expect(page.locator(".lumir-hp-send")).toBeEnabled(); // 停止态可点
  await expect(page.locator(".lumir-hp-progress")).toBeVisible();
  await expect(page.locator(".lumir-hp-stage")).toHaveText("等待响应…");
  // 阶段指示第二档：首个 text_chunk 到达 → 「生成中」。
  await page.evaluate(() =>
    (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent({
      type: "text_chunk",
      text: "初步回答",
    }),
  );
  await expect(page.locator(".lumir-hp-stage")).toHaveText("正在生成回复…");
  // 停止点击（M348 桩期：只走状态机——running → stopping，连点被幂等挡下；
  // stopping 子态钮已禁用，playwright 的 actionability 会拒点——force 模拟真实双击的第二次落下）。
  await page.locator(".lumir-hp-send").click();
  await expect(page.locator(".lumir-hp-send")).toBeDisabled();
  await page.locator(".lumir-hp-send").click({ force: true });
  await expect(page.locator(".lumir-hp-send")).toBeDisabled();
  // done 收口：钮回「发送」、进度条退场、消息定稿。
  await page.evaluate(() =>
    (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent({ type: "done" }),
  );
  await expect(page.locator(".lumir-hp-send")).toHaveText("发送");
  await expect(page.locator(".lumir-hp-send")).not.toHaveClass(/is-busy/);
  await expect(page.locator(".lumir-hp-progress")).toBeHidden();
  await expect(page.locator(".lumir-hp-msg-assistant")).toContainText("初步回答");
  const sent = await page.evaluate(() => (window as unknown as { __sentMessages: unknown[] }).__sentMessages);
  expect(sent).toHaveLength(1);

  // ── 消息复制：hover 浮现；复制源 = 源文本（agent = 模型原始输出，非渲染 HTML）──
  await page.locator(".lumir-hp-msg-assistant").hover();
  const assistantCopy = page.locator(".lumir-hp-msg-assistant .lumir-hp-copy");
  await expect(assistantCopy).toBeVisible();
  await assistantCopy.click();
  await expect(assistantCopy).toHaveText("✓ 已复制");
  let copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  expect(copied).toEqual(["初步回答"]);
  // 用户消息：复制源 = 发送前原始输入。
  await page.locator(".lumir-hp-msg-user").hover();
  const userCopy = page.locator(".lumir-hp-msg-user .lumir-hp-copy");
  await expect(userCopy).toBeVisible();
  await userCopy.click();
  copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  expect(copied).toEqual(["初步回答", "这段会触发压缩吗"]);
});
