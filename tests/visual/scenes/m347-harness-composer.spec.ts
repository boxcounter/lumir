import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M347 composer 控制行 + 复制 + 进度：合并选择器 chip（M373：model · effort 双读数 +
// 三维单浮层 + mock 可选列表隐藏 + effort 不支持置灰/段禁用/hover hint）、ctx% 读数
//（usage 事件消费 / 超阈值高亮 + hover 泡——M373 起含义句 D395 常驻、越线追加警示句 D335）、
// 发送钮两态（处理中 = 停止，停止钩子 M348 对接面桩期未注册——点击只走状态机）、不定态
// 进度条 + 阶段指示两档、消息复制钮（hover 浮现，复制源 = 源文本非渲染 HTML）。
// M370 起 ctx 读数改「{ctx}% · {cache}%」双裸读数（分隔符小圆点 U+00B7 与 modeline 同款；
// cache_pct 纯前端消费）、ⓘ 钮移除、警示说明改越线时 hover 读数翻出（D377 随 ⓘ 退场）。
// M378 起 hover hint 改两行带当时实际值（第一行 context window usage = D395、第二行
// cache hit rate = D401，越线时 D335 警示句追加为第三行）并按面板边界收编（窄 pane 左缘
// 不被 overflow:hidden 裁）；harness pane 内容字号支持 ⌘+/- 步进（与内容 pane 同语义，
// 焦点路由——焦点在 composer 时 ⌘= 放大面板内容、焦点在编辑器时照旧放大编辑器内容）。
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
          // M414：权限 chip 的读数来自 `permission_mode`（闭集合；控制行第三位）。
          permission_mode: "vault_write",
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
  //    ctl = [合并选择器 chip（wrapper）][权限 chip（wrapper）][ctx 读数（wrapper）][spacer][图标发送钮]
  //    （M373：双 chip 合一，.lumir-hp-effwrap 退役；M414：权限 chip 进第三位，思考 chip 之后、
  //     ctx 读数之前）──
  const boxOrder = await page.locator(".lumir-hp-composer-box > *").evaluateAll((els) =>
    els.map((el) => el.classList[0]),
  );
  expect(boxOrder).toEqual(["lumir-hp-composer", "lumir-hp-ctl"]);
  const ctlOrder = await page.locator(".lumir-hp-ctl > *").evaluateAll((els) =>
    els.map((el) => el.classList[0]),
  );
  expect(ctlOrder).toEqual([
    "lumir-hp-modelwrap",
    "lumir-hp-permwrap",
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

  // ── ctx% 读数（M370 双裸读数 + M373 hover 常驻 + M378 两行带当时实际值）──
  const ctxRead = page.locator(".lumir-hp-ctx");
  await expect(ctxRead).toHaveText("0% · 0%");
  await expect(ctxRead).not.toHaveClass(/is-warn/);
  const ctxWrap = page.locator(".lumir-hp-ctxwrap");
  const ctxPop = page.locator(".lumir-hp-ctxpop");
  // 未越线 hover → 两行带值含义句：第一行 ctx（D395）、第二行 cache（D401），无警示句。
  await expect(ctxPop).toBeHidden();
  await ctxWrap.hover();
  await expect(ctxPop).toBeVisible();
  await expect(ctxPop.locator(".lumir-hp-ctxpop-meaning")).toHaveText("上下文窗口占用：0%");
  await expect(ctxPop.locator(".lumir-hp-ctxpop-cache")).toHaveText("缓存命中率：0%");
  await expect(ctxPop.locator(".lumir-hp-ctxpop-warn")).toHaveCount(0);
  await page.mouse.move(10, 10);
  await expect(ctxPop).toBeHidden();

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
  // usage 事件注入须落在**开轮窗口**（M374 轮次闸门：sent 之后、done 之前，关闭期的 usage
  // 一律丢弃）——M374 起本场景的 usage 断言都在发送后、终态前完成。
  // usage 事件越阈值 → 高亮 + hover 泡两行带值 + 警示句（D335）追加为第三行。
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
  // 第一行带 hover 当时的 ctx 实际值（M378：不再是固定含义句）。
  await expect(ctxPop.locator(".lumir-hp-ctxpop-meaning")).toHaveText("上下文窗口占用：86%");
  await expect(ctxPop.locator(".lumir-hp-ctxpop-cache")).toHaveText("缓存命中率：50%");
  await expect(ctxPop.locator(".lumir-hp-ctxpop-warn")).toContainText("86%");
  await expect(ctxPop.locator(".lumir-hp-ctxpop-warn")).toContainText("85%");
  await page.mouse.move(10, 10);
  await expect(ctxPop).toBeHidden();
  // 低于阈值 → 高亮退场、警示句退场，hover 回到只有两行带值含义句（第一行仍带当时值）。
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
  await expect(ctxPop.locator(".lumir-hp-ctxpop-meaning")).toHaveText("上下文窗口占用：60%");
  await expect(ctxPop.locator(".lumir-hp-ctxpop-warn")).toHaveCount(0); // 警示句（第三行）退场
  await page.mouse.move(10, 10);
  await expect(ctxPop).toBeHidden();
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

test("权限 chip（M414）：短名读数 / 三档浮层全名 + 释义 / 档位写回 config / 选定不关浮层", async ({
  page,
}) => {
  // design §7 的呈现口径（Alex 2026-10-09 裁决）：chip 面 = **短名**（控制行空间紧），
  // 浮层列表项 = **全名 + 每档一行释义**（全名只在那里出现一次）。写入面 = 配置键
  // `[harness].permission_mode`（与模型 chip 同一条 config_set_value 通道；切换对下一个
  // 判定生效，前端不碰在途轮次）。
  await stubTauri(page, VAULT);
  await stubHarnessComposer(page);
  await page.goto("/");

  await page.locator('.ft-row[title="harness-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();

  // ── chip 读数 = 短名（D424 = 写入）+ 读屏名 / title = D426（{mode} 取全名）──
  const permChip = page.locator(".lumir-hp-perm");
  await expect(permChip).toBeVisible();
  await expect(permChip).toHaveAttribute("aria-haspopup", "menu");
  await expect(permChip.locator(".lumir-hp-perm-name")).toHaveText("写入");
  await expect(permChip).toHaveAttribute("title", "权限模式：保险库写入（点击切换）");
  await expect(permChip).toHaveAttribute("aria-label", "权限模式：保险库写入（点击切换）");
  // 形态合同（computed-style）：与合并 chip 同一份配方（24px / r5 / 11.5px）。
  const permStyle = await permChip.evaluate((el) => {
    const s = getComputedStyle(el);
    return { height: s.height, borderRadius: s.borderRadius, fontSize: s.fontSize };
  });
  expect(permStyle).toEqual({ height: "24px", borderRadius: "5px", fontSize: "11.5px" });

  // ── 点开浮层：三档单选，项 = 全名 + 释义；当前档 .is-current + aria-checked ──
  await permChip.click();
  const permPop = page.locator(".lumir-hp-permpop");
  await expect(permPop).toBeVisible();
  await expect(permPop).toHaveAttribute("aria-label", "权限模式");
  const items = permPop.locator(".lumir-hp-permpop-item");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0).locator(".lumir-hp-permpop-name")).toHaveText("只读");
  await expect(items.nth(0).locator(".lumir-hp-permpop-desc")).toHaveText("读自动放行；写操作都先问你");
  await expect(items.nth(1).locator(".lumir-hp-permpop-name")).toHaveText("保险库写入");
  await expect(items.nth(1).locator(".lumir-hp-permpop-desc")).toHaveText("库内写自动放行；库外命令先问你");
  await expect(items.nth(2).locator(".lumir-hp-permpop-name")).toHaveText("完全访问");
  await expect(items.nth(2).locator(".lumir-hp-permpop-desc")).toHaveText("全自动；仅危险命令仍问你");
  await expect(items.nth(1)).toHaveClass(/is-current/);
  await expect(items.nth(1)).toHaveAttribute("aria-checked", "true");
  await expect(items.nth(0)).toHaveAttribute("aria-checked", "false");
  // 当前档 check 格有勾选图形、非当前档留空（纵对齐靠固定宽格）。
  await expect(items.nth(1).locator(".lumir-hp-permpop-check svg")).toHaveCount(1);
  await expect(items.nth(0).locator(".lumir-hp-permpop-check svg")).toHaveCount(0);

  // ── 选「完全访问」：chip 读数先翻（选择先行），写回随后；浮层不自动关 ──
  await items.nth(2).click();
  await expect(permChip.locator(".lumir-hp-perm-name")).toHaveText("完全");
  await expect(permChip).toHaveAttribute("title", "权限模式：完全访问（点击切换）");
  await expect(items.nth(2)).toHaveClass(/is-current/);
  await expect(permPop).toBeVisible(); // 选定不自动关（三条关闭路径见下）
  // 写回判据：config_set_value("harness", "permission_mode", …)（桩的 __providerWrites
  // 记录全部 config_set_value 调用，键值逐字对账）。
  const permWrites = await page.evaluate(
    () => (window as unknown as { __providerWrites: { section: string; key: string; value: unknown }[] }).__providerWrites,
  );
  expect(permWrites).toContainEqual({
    section: "harness",
    key: "permission_mode",
    value: "full_access",
  });

  // ── 合并 chip 与权限浮层互斥：开一个即收另一个 ──
  await page.locator(".lumir-hp-model").click();
  await expect(page.locator(".lumir-hp-selpop")).toBeVisible();
  await expect(permPop).toBeHidden();
  // ── Esc 收浮层（面板不收：焦点回到 chip，浮层收起是面板内第一段） ──
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-hp-selpop")).toBeHidden();
  await expect(page.locator(".lumir-harness")).toBeVisible();
});

test("ctx hover 泡边界收编：窄面板下完整可见（三主题），不越出面板可视区", async ({ page }) => {
  // M378 根因的复现条件：浮层默认锚 right:-18px、宽 224px（向左延 ~206px），祖先
  // .lumir-harness 有 overflow:hidden——面板窄时浮层左缘被裁（Alex「hint 显示不全」）。
  // 760px 宽视口把 harness pane 压到默认锚必溢出左缘的宽度；每条主题下量浮层边界 ⊆
  // 面板边界，并量「未收编左缘」作证这条断言非空转（它 < 面板左缘 = 不收编必红）。
  await page.setViewportSize({ width: 760, height: 600 });
  await stubTauri(page, VAULT);
  await stubHarnessComposer(page);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  const panel = page.locator(".lumir-harness");
  await expect(panel).toBeVisible();
  const ctxWrap = page.locator(".lumir-hp-ctxwrap");
  const ctxPop = page.locator(".lumir-hp-ctxpop");

  const measure = () =>
    page.evaluate(() => {
      const panelEl = document.querySelector(".lumir-harness");
      const popEl = document.querySelector(".lumir-hp-ctxpop");
      const wrapEl = document.querySelector(".lumir-hp-ctxwrap");
      if (panelEl === null || popEl === null || wrapEl === null) return null;
      const p = panelEl.getBoundingClientRect();
      const c = popEl.getBoundingClientRect();
      const w = wrapEl.getBoundingClientRect();
      return {
        theme: document.documentElement.dataset.theme ?? "",
        panelLeft: p.left,
        panelRight: p.right,
        popLeft: c.left,
        popRight: c.right,
        popWidth: c.width,
        // 未收编的默认左缘 = 读数右缘 + 18px 探出 − 224px 宽（right:-18px 锚的算式）。
        unclampedPopLeft: w.right + 18 - 224,
      };
    });

  // 逐主题量一遍（几何与主题无关，三主题各验是 M378 的显式验收项）；主题钮 = cycleTheme
  // 同一条命令路径（light → dark → eink）。
  for (let i = 0; i < 3; i += 1) {
    await ctxWrap.hover();
    await expect(ctxPop).toBeVisible();
    const m = await measure();
    expect(m, "读不到面板 / 浮层 / 读数（判 FAIL，不当成空）").not.toBeNull();
    expect(m!.theme, "主题应逐次循环（light → dark → eink）").toBe(["light", "dark", "eink"][i]);
    // 复现条件成立：默认锚下浮层左缘越出面板——不收编这条断言必红（REVIEW.md 第 1 条
    // 的反向验证：判据对「没有修复」必须有区分度）。
    expect(
      m!.unclampedPopLeft,
      `第 ${i + 1} 主题（${m!.theme}）下面板宽度不足以复现溢出（unclamped ${m!.unclampedPopLeft} ≥ panel ${m!.panelLeft}），断言空转`,
    ).toBeLessThan(m!.panelLeft);
    // 收编后的真值：浮层完整落在面板可视边界内（±0.5 吸收亚像素取整）。
    expect(m!.popLeft).toBeGreaterThanOrEqual(m!.panelLeft - 0.5);
    expect(m!.popRight).toBeLessThanOrEqual(m!.panelRight + 0.5);
    expect(m!.popWidth).toBeGreaterThan(0);
    await page.mouse.move(10, 10);
    await expect(ctxPop).toBeHidden();
    if (i < 2) await page.locator(".modeline-theme").click();
  }
});

test("权限浮层边界收编：窄面板下完整可见、未被祖先裁切（O1/O2）", async ({ page }) => {
  // O1/O2（docs/specs/overlay-visibility.md）：浮层锚在权限 chip 上（left:0 向右展开 208px+），
  // chip 的位置随 model 名长短浮动，而祖先 .lumir-harness 有 overflow:hidden——窄面板下
  // 右缘会被祖先裁掉（可见区域 < 包围盒 = O1 违规）。760px 视口把 harness pane 压到必溢出
  // 的宽度；断言两段：① 几何——收编后浮层完整落在面板可视边界内；② 绘制/命中——浮层内容
  // 各段端点做 elementFromPoint，落点必须仍在浮层内（chromium 对被祖先裁掉的区域不做命中，
  // 这一条才是「真的画出来了」的判据；纯包围盒断言对被裁内容无区分度，REVIEW.md 第 5 条）。
  await page.setViewportSize({ width: 760, height: 600 });
  await stubTauri(page, VAULT);
  await stubHarnessComposer(page);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await page.locator(".lumir-hp-perm").click();
  await expect(page.locator(".lumir-hp-permpop")).toBeVisible();

  const m = await page.evaluate(() => {
    const panelEl = document.querySelector(".lumir-harness");
    const popEl = document.querySelector(".lumir-hp-permpop");
    const wrapEl = document.querySelector(".lumir-hp-permwrap");
    if (panelEl === null || popEl === null || wrapEl === null) return null;
    const p = panelEl.getBoundingClientRect();
    const c = popEl.getBoundingClientRect();
    const w = wrapEl.getBoundingClientRect();
    const probes: { text: string; x: number; y: number; hitSelf: boolean }[] = [];
    const spans = popEl.querySelectorAll(".lumir-hp-permpop-name, .lumir-hp-permpop-desc");
    for (const span of spans) {
      const box = span.getBoundingClientRect();
      if (box.width < 12) continue; // 太窄的格子量不出「端点被裁」，跳过（不装作有区分度）
      for (const x of [box.left + 4, box.right - 4]) {
        const y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y);
        probes.push({
          text: (span.textContent ?? "").slice(0, 12),
          x,
          y,
          hitSelf: hit !== null && popEl.contains(hit),
        });
      }
    }
    return {
      panelLeft: p.left,
      panelRight: p.right,
      popLeft: c.left,
      popRight: c.right,
      popWidth: c.width,
      // 未收编的自然几何 = chip 左缘 + 浮层最小宽（锚 left:0 向右展开）。
      unclampedPopRight: w.left + 208,
      probes,
    };
  });
  expect(m, "读不到面板 / 浮层 / chip（判 FAIL，不当成空）").not.toBeNull();
  // 复现条件成立：自然几何越出面板右缘——不收编这条断言必红（REVIEW.md 第 1 条的反向验证）。
  expect(
    m!.unclampedPopRight,
    `面板宽度不足以复现溢出（unclampedRight ${m!.unclampedPopRight} ≤ panel ${m!.panelRight}），断言空转`,
  ).toBeGreaterThan(m!.panelRight);
  // ① 几何：收编后浮层完整落在面板可视边界内（±0.5 吸收亚像素取整）。
  expect(m!.popLeft).toBeGreaterThanOrEqual(m!.panelLeft - 0.5);
  expect(m!.popRight).toBeLessThanOrEqual(m!.panelRight + 0.5);
  expect(m!.popWidth).toBeGreaterThan(0);
  // ② 绘制/命中：浮层内容的端点都还在浮层里（被裁的部分命中的是它下方的内容）。
  expect(m!.probes.length, "探针为空 = 没有可判的浮层内容").toBeGreaterThan(0);
  for (const probe of m!.probes) {
    expect(probe.hitSelf, `「${probe.text}」在 (${Math.round(probe.x)}, ${Math.round(probe.y)}) 处被裁（命中浮动层之外）`).toBe(
      true,
    );
  }
});

test("harness pane ⌘+/- 内容字号步进：焦点路由、重置与编辑器隔离（M378）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarnessComposer(page);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  const panel = page.locator(".lumir-harness");
  await expect(panel).toBeVisible();
  const composer = page.locator(".lumir-hp-composer");
  const composerFontSize = () => composer.evaluate((el) => getComputedStyle(el).fontSize);
  const editorFontToken = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--editor-font-size").trim(),
    );

  // 焦点在 composer（harness pane）：⌘= 步进**面板**内容字号（基线 --fs-ui 13 → 14 → 15）。
  await composer.click();
  await expect.poll(composerFontSize).toBe("13px");
  const editorBefore = await editorFontToken();
  await page.keyboard.press("Meta+=");
  await expect.poll(composerFontSize).toBe("14px");
  await page.keyboard.press("Meta+=");
  await expect.poll(composerFontSize).toBe("15px");
  // 面板持焦期间编辑器内容字号不被触碰（路由隔离）。
  await expect.poll(editorFontToken).toBe(editorBefore);
  // ⌘0 回面板基线（= --fs-ui 现值，与内容 pane「回配置字号」同口径，不是出厂默认）。
  await page.keyboard.press("Meta+0");
  await expect.poll(composerFontSize).toBe("13px");

  // 焦点在编辑器：⌘= 照旧步进**编辑器**内容字号（M378 之前的行为逐字节保留），面板不动。
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+=");
  await expect.poll(editorFontToken).not.toBe(editorBefore);
  await expect.poll(composerFontSize).toBe("13px");
  // ⌘- 回退编辑器字号到步进前，面板依旧不动。
  await page.keyboard.press("Meta+-");
  await expect.poll(editorFontToken).toBe(editorBefore);
  await expect.poll(composerFontSize).toBe("13px");
});
