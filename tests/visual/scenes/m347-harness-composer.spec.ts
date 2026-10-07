import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M347 composer 控制行 + 复制 + 进度：合并选择器 chip（M373：model · effort 双读数 +
// 三维单浮层 + mock 可选列表隐藏 + effort 不支持置灰/段禁用/hover hint）、ctx% 读数
//（usage 事件消费 / 超阈值高亮 + hover 泡——M373 起含义句 D395 常驻、越线追加警示句 D335）、
// 发送钮两态（处理中 = 停止，停止钩子 M348 对接面桩期未注册——点击只走状态机）、不定态
// 进度条 + 阶段指示两档、消息复制钮（hover 浮现，复制源 = 源文本非渲染 HTML）。
// M370 起 ctx 读数改「{ctx}% · {cache}%」双裸读数（分隔符小圆点 U+00B7 与 modeline 同款；
// cache_pct 纯前端消费）、ⓘ 钮移除、警示说明改越线时 hover 读数翻出（D377 随 ⓘ 退场）。
// M351 起按新 DOM：composer 收进 .lumir-hp-composer-box（控制行 .lumir-hp-ctl 在容器底）、
// chip/浮层挪进 wrapper（a11y 修复）、发送钮图标化（两态 SVG glyph + aria-label 文案）。
// M363 起控制行插入思考 chip wrapper；M373 起双 chip 合一（.lumir-hp-effwrap 退役，
// effort 读数并入 .lumir-hp-model）。
// 消息区 / composer / 工具清单的**视觉还原**断言在 m351 场景，本场景只守行为不变量。
// M373 保真条款 b：合并 chip 关键形态写成本场景的 computed-style 断言（24px 高、r5、
// 11.5px、max-width 224px、U+00B7 分隔、model 名单独截断保 effort）——CI 结构层可判。
//
// 全部断言是**结构断言**（在场性 / 文案 / 状态 / 调用记录 / 计算样式）——本场景不碰任何
// 像素基线（批次末统一重建是 HP4 的面，tower 指令禁止 --update）。面板打开是纯前端路径，
// 事件经 __fireHarnessEvent 从桩侧注入（stubTauri 的 listen 闭包不可达，这里经暴露的
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
 *      「不伪造读数」口径隐藏；M373 起带 model 维度：kimi 两档（k2 不支持 effort）、
 *      deepseek 一档，mock 无模型维度（与 Rust HarnessMockConfig 同形）；
 *   2. harness_state 零态桩（同 m303）+ thinking 字段（M363 契约 {level, supported}；
 *      M373 起 supported 按桩内当前 provider+model 模拟 schema 判定：kimi/k2 → false）；
 *   3. harness_send / harness_set_thinking_effort / config_set_value 调用记录
 *      （写回判据 = 参数逐字，不看副作用）；
 *   4. harness:event 注入钩子（记录 listen 的 handler id，经 runCallback 送达）；
 *   5. 剪贴板 writeText 桩（__copied 记录写入内容——复制源的判据面）。 */
async function stubHarnessComposer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__providerWrites = [];
    w.__effortWrites = [];
    w.__sentMessages = [];
    w.__harnessEventHandlerIds = [];
    // 桩内会话态：当前 provider + model（config 写回后由面板经 refreshThinkingState 重取，
    // supported 据此模拟 schema 的逐模型 effort 声明——kimi/k2 = false，其余 = true）。
    let curProvider = "mock";
    let curModel = "";
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "config_set_value") {
        w.__providerWrites.push({ section: args.section, key: args.key, value: args.value });
        if (args.key === "provider") curProvider = args.value;
        if (args.key === "providers.kimi.model") curModel = args.value;
        return null;
      }
      if (cmd === "harness_set_thinking_effort") {
        w.__effortWrites.push(args.effort);
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
      // 在链条最前拦截——零态桩与 Rust StateSnapshot::empty 同形（同 m303）+ thinking。
      if (cmd === "harness_state") {
        const supported = !(curProvider === "kimi" && curModel === "k2");
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct: 0 },
          pending_approval: null,
          warn_ctx_pct: 85,
          thinking: { level: "high", supported },
        });
      }
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      const result = await origInvoke(cmd, args);
      if (cmd === "config_get" && result?.config) {
        result.config.harness = {
          provider: "mock",
          providers: {
            kimi: {
              model: "k2",
              models: [
                { id: "k2", effort: false, window: 262144 },
                { id: "kimi-k3", effort: true, window: 1048576 },
              ],
            },
            deepseek: { model: "d", models: [{ id: "d", effort: true, window: 131072 }] },
            mock: { fixture: "f.json" },
          },
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

test("composer 控制行：合并选择器三维写回 / 形态合同 / ctx 读数 hover / 发送钮两态 / 消息复制", async ({
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

  // ── composer 区结构（M351，原型 .h-box/.h-ctl）：box = [composer][ctl]；
  //    ctl = [合并选择器 chip（wrapper）][ctx 读数（wrapper）][spacer][图标发送钮]
  //    （M373：双 chip 合一，.lumir-hp-effwrap 退役）──
  const boxOrder = await page.locator(".lumir-hp-composer-box > *").evaluateAll((els) =>
    els.map((el) => el.classList[0]),
  );
  expect(boxOrder).toEqual(["lumir-hp-composer", "lumir-hp-ctl"]);
  const ctlOrder = await page.locator(".lumir-hp-ctl > *").evaluateAll((els) =>
    els.map((el) => el.classList[0]),
  );
  expect(ctlOrder).toEqual([
    "lumir-hp-modelwrap",
    "lumir-hp-ctxwrap",
    "lumir-hp-ctl-spacer",
    "lumir-hp-send",
  ]);

  // ── 合并选择器 chip：双读数（mock 无模型维度 → model 读数回落 provider id）/
  //    D393 读屏名 / 形态合同（保真条款 b：24px、r5、11.5px、224px、U+00B7、截断结构）──
  const modelChip = page.locator(".lumir-hp-model");
  await expect(modelChip).toBeVisible();
  await expect(modelChip.locator(".lumir-hp-model-name")).toHaveText("mock");
  await expect(modelChip.locator(".lumir-hp-model-sep")).toHaveText("·"); // U+00B7
  await expect(modelChip.locator(".lumir-hp-eff-reading")).toHaveText("High");
  await expect(modelChip).toHaveAttribute(
    "title",
    "模型：mock · 思考程度：High（点击切换）",
  );
  // 形态合同（computed-style）：现行 chip 配方逐值 + 截断只落 model 名。
  const chipStyle = await modelChip.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      height: s.height,
      borderRadius: s.borderRadius,
      fontSize: s.fontSize,
      maxWidth: s.maxWidth,
    };
  });
  expect(chipStyle).toEqual({
    height: "24px",
    borderRadius: "5px",
    fontSize: "11.5px",
    maxWidth: "224px",
  });
  const nameStyle = await modelChip.locator(".lumir-hp-model-name").evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      overflow: s.overflow,
      textOverflow: s.textOverflow,
      flexGrow: s.flexGrow,
      minWidth: s.minWidth,
    };
  });
  expect(nameStyle).toEqual({
    overflow: "hidden",
    textOverflow: "ellipsis",
    flexGrow: "1",
    minWidth: "0px",
  });
  // effort 读数与分隔符 flex:none —— 截断只发生在 model 名一侧，effort 永远保住。
  for (const sel of [".lumir-hp-model-sep", ".lumir-hp-eff-reading", ".lumir-hp-model-chev"]) {
    const flex = await modelChip.locator(sel).evaluate(
      (el) => getComputedStyle(el).flexShrink,
    );
    expect(flex, sel).toBe("0");
  }

  // ── 合并浮层：三维分段（Provider 段 mock 已隐藏）/ 选定不自动关 / provider 写回 ──
  await modelChip.click();
  const selPop = page.locator(".lumir-hp-selpop");
  await expect(selPop).toBeVisible();
  await expect(selPop).toHaveAttribute("aria-label", "模型与思考程度");
  const secs = selPop.locator(".lumir-hp-selpop-sec");
  // 当前 provider = mock（无模型维度）→ 段 = Provider + 思考程度 两段。
  await expect(secs).toHaveCount(2);
  await expect(secs.nth(0).locator(".lumir-hp-selpop-label")).toHaveText("提供商");
  await expect(secs.nth(1).locator(".lumir-hp-selpop-label")).toHaveText("思考程度");
  // mock 隐藏：provider 段只列 kimi / deepseek（闭集合 ∩ 已配置 − mock）。
  const provItems = secs.nth(0).locator(".lumir-hp-selpop-item");
  await expect(provItems).toHaveCount(2);
  await expect(provItems).toHaveText([/kimi/, /deepseek/]);
  // 当前 provider = mock（可选列表已隐藏）→ provider 段无当前项；effort 段当前项 = High。
  await expect(secs.nth(0).locator(".lumir-hp-selpop-item.is-current")).toHaveCount(0);
  await expect(secs.nth(1).locator(".lumir-hp-selpop-item.is-current")).toHaveCount(1);
  await expect(secs.nth(1).locator(".lumir-hp-selpop-item.is-current")).toContainText("High");

  // 选 kimi —— provider 写回 + 浮层不自动关（Alex 裁决）+ 模型段随之出现。
  await provItems.nth(0).click(); // 选 kimi
  await expect(selPop).toBeVisible();
  await expect(modelChip.locator(".lumir-hp-model-name")).toHaveText("k2");
  // 切 provider 不抹 effort：读数仍是 High。
  await expect(modelChip.locator(".lumir-hp-eff-reading")).toHaveText("High");
  let writes = await page.evaluate(() => (window as unknown as { __providerWrites: unknown[] }).__providerWrites);
  expect(writes).toEqual([{ section: "harness", key: "provider", value: "kimi" }]);
  // provider 段的当前项现在 = kimi（三维统一的勾选 + tint 表达）。
  await expect(secs.nth(0).locator(".lumir-hp-selpop-item.is-current")).toHaveCount(1);
  await expect(secs.nth(0).locator(".lumir-hp-selpop-item.is-current")).toContainText("kimi");
  // 模型段出现（kimi 的两档），当前项 = k2。
  await expect(secs).toHaveCount(3);
  await expect(secs.nth(1).locator(".lumir-hp-selpop-label")).toHaveText("模型");
  const modelItems = secs.nth(1).locator(".lumir-hp-selpop-item");
  await expect(modelItems).toHaveCount(2);
  await expect(modelItems.nth(0)).toContainText("k2");
  await expect(secs.nth(1).locator(".lumir-hp-selpop-item.is-current")).toHaveCount(1);

  // 选模型 kimi-k3 —— 点分嵌套键写回 providers.kimi.model；chip 读数翻转、浮层仍开着。
  await modelItems.nth(1).click(); // kimi-k3
  await expect(selPop).toBeVisible();
  await expect(modelChip.locator(".lumir-hp-model-name")).toHaveText("kimi-k3");
  writes = await page.evaluate(() => (window as unknown as { __providerWrites: unknown[] }).__providerWrites);
  expect(writes).toEqual([
    { section: "harness", key: "provider", value: "kimi" },
    { section: "harness", key: "providers.kimi.model", value: "kimi-k3" },
  ]);

  // 选回 k2（schema 声明 effort=false）→ 不支持态：读屏名换 D390、读数置灰、
  // hover hint（D394）翻出、浮层 effort 段禁用 + D390 说明句。
  await modelItems.nth(0).click(); // k2
  await expect(modelChip).toHaveAttribute("title", "当前模型不支持思考程度调节");
  const effReading = modelChip.locator(".lumir-hp-eff-reading");
  await expect(effReading).toHaveClass(/is-disabled/);
  const effHint = page.locator(".lumir-hp-effhint");
  await expect(effHint).toBeHidden();
  await effReading.hover();
  await expect(effHint).toBeVisible();
  await expect(effHint).toContainText("k2");
  await expect(effHint).toContainText("不支持思考程度调节");
  await page.mouse.move(10, 10);
  await expect(effHint).toBeHidden();
  // 浮层 effort 段整段禁用：项无 hover 反应、段尾挂 D390 说明句。
  const effSec = secs.nth(2);
  await expect(effSec).toHaveClass(/is-disabled/);
  await expect(effSec.locator(".lumir-hp-selpop-hint")).toHaveText("当前模型不支持思考程度调节");

  // 选回 kimi-k3（effort=true）→ 支持态恢复（读屏名回 D393）→ 选 Max 写会话。
  await modelItems.nth(1).click(); // kimi-k3
  await expect(modelChip).toHaveAttribute(
    "title",
    "模型：kimi-k3 · 思考程度：High（点击切换）",
  );
  await expect(effSec).not.toHaveClass(/is-disabled/);
  await effSec.locator(".lumir-hp-selpop-item").nth(2).click(); // Max
  const effortWrites = await page.evaluate(
    () => (window as unknown as { __effortWrites: unknown[] }).__effortWrites,
  );
  expect(effortWrites).toEqual(["max"]);
  await expect(modelChip.locator(".lumir-hp-eff-reading")).toHaveText("Max");
  await expect(modelChip).toHaveAttribute(
    "title",
    "模型：kimi-k3 · 思考程度：Max（点击切换）",
  );
  // 选定不关浮层（effort 选择后浮层仍在）。
  await expect(selPop).toBeVisible();

  // 浮层外交互收起。
  await page.locator(".lumir-hp-transcript").click();
  await expect(selPop).toBeHidden();

  // ── ctx% 读数（M370 双裸读数 + M373 hover 含义句常驻 / 越线追加警示句）──
  const ctxRead = page.locator(".lumir-hp-ctx");
  await expect(ctxRead).toHaveText("0% · 0%");
  await expect(ctxRead).not.toHaveClass(/is-warn/);
  const ctxWrap = page.locator(".lumir-hp-ctxwrap");
  const ctxPop = page.locator(".lumir-hp-ctxpop");
  // 未越线 hover → 含义句（D395）浮出。
  await expect(ctxPop).toBeHidden();
  await ctxWrap.hover();
  await expect(ctxPop).toBeVisible();
  await expect(ctxPop).toContainText("上下文窗口占用比例");
  await expect(ctxPop).toContainText("缓存命中比例");
  await page.mouse.move(10, 10);
  await expect(ctxPop).toBeHidden();
  // usage 事件越阈值 → 高亮 + hover 泡含义句 + 警示句（D335）两行。
  await page.evaluate(() =>
    (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent({
      type: "usage",
      ctx_pct: 86,
      cache_pct: 50,
    }),
  );
  await expect(ctxRead).toHaveText("86% · 50%");
  await expect(ctxRead).toHaveClass(/is-warn/);
  await ctxWrap.hover();
  await expect(ctxPop).toBeVisible();
  await expect(ctxPop).toContainText("上下文窗口占用比例"); // 含义句恒在第一行
  await expect(ctxPop).toContainText("86%");
  await expect(ctxPop).toContainText("85%");
  await page.mouse.move(10, 10);
  await expect(ctxPop).toBeHidden();
  // 低于阈值 → 高亮退场、hover 回到只有含义句。
  await page.evaluate(() =>
    (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent({
      type: "usage",
      ctx_pct: 60,
      cache_pct: 50,
    }),
  );
  await expect(ctxRead).toHaveText("60% · 50%");
  await expect(ctxRead).not.toHaveClass(/is-warn/);
  await ctxWrap.hover();
  await expect(ctxPop).toBeVisible();
  await expect(ctxPop).not.toContainText("60%"); // 警示句（带数值）退场
  await page.mouse.move(10, 10);

  // ── 发送钮两态 + 进度条/阶段指示：发送 → 停止态；停止点击 → 状态机；done → 回 idle ──
  // M351 图标化：钮面是 ↑ / ■ 两态 SVG glyph（[hidden] 切换），两态文案落 aria-label。
  const sendBtn = page.locator(".lumir-hp-send");
  const sendGo = page.locator(".lumir-hp-send-go");
  const sendStop = page.locator(".lumir-hp-send-stop");
  await expect(sendBtn).toHaveAttribute("aria-label", "发送");
  await expect(sendGo).toBeVisible();
  await expect(sendStop).toBeHidden();
  await page.locator(".lumir-hp-composer").fill("这段会触发压缩吗");
  await sendBtn.click(); // 空闲相位 = 发送
  await expect(sendBtn).toHaveAttribute("aria-label", "停止");
  await expect(sendGo).toBeHidden();
  await expect(sendStop).toBeVisible();
  await expect(sendBtn).toHaveClass(/is-busy/);
  await expect(sendBtn).toBeEnabled(); // 停止态可点
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
  await sendBtn.click();
  await expect(sendBtn).toBeDisabled();
  await sendBtn.click({ force: true });
  await expect(sendBtn).toBeDisabled();
  // done 收口：钮回发送态、进度条退场、消息定稿。
  await page.evaluate(() =>
    (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent({ type: "done" }),
  );
  await expect(sendBtn).toHaveAttribute("aria-label", "发送");
  await expect(sendGo).toBeVisible();
  await expect(sendStop).toBeHidden();
  await expect(sendBtn).not.toHaveClass(/is-busy/);
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
