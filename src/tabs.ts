// 标签（M149）：模型就是 editor 的会话列表（顺序 = 打开顺序），本模块只多维护
// 「哪个是可复用的预览标签」与标签栏 DOM。选中 / 关闭 / 切换都经内核的会话 API，
// 这里不自己存第二份文档清单（REVIEW.md 第 8 条：同一语义不要两处真源）。
//
// M151 从 main.ts 抽出（M127 的拆分判据「main.ts 收敛为装配层」的续作）。抽出的判据：
// 会话模型的读写全在 editor 的会话 API，本模块不持有任何状态，只是「会话列表 → 标签栏
// DOM + 切换/关闭动作」这一层表现与交互；装配侧注入的七个入口每一个都只有一个职责，
// 且都是本模块看不到的事实：
//   - saveCurrent：保存链路在 save-controller（关标签前的「保存并关闭」）；
//   - invalidateResolve：解析缓存的 from 基准随前台文档而变，能力在 link-follow.ts；
//   - showEditor：撤下「暂不支持预览」覆盖层（覆盖层属装配层的编辑器区）；
//   - syncActiveDocument：前台文档变化后的表现层**一次**对齐，它在装配层（要同时对齐
//     masthead / 文件树 / 大纲 / 标签栏），因此 activateTab 与 closeTabNow 末了都要回调它。
//     这条回调与 renderTabs 构成一次「本模块 → 装配层 → 本模块」的往返，与抽出前
//     两个函数同处一个文件时的调用关系逐字相同。
//
// 关闭确认的未命名文档守卫（reviewer r1 P2-1 的那条）在 closeTab 里，语义见该函数注释。

import type { EditorHandle, EditorSession } from "./editor";
import { TAB_GOTO_IDS } from "./keys";
import type { CommandRunner } from "./keys";
import { baseName } from "./tree";

export interface TabsDeps {
  editor: EditorHandle;
  /** 标签栏容器（shell.tabStrip）。 */
  mount: HTMLElement;
  /** 提示出口（关标签确认用的是 sticky 提示）。 */
  toast: (text: string, actions: Array<{ label: string; run(): void }>, sticky?: boolean) => void;
  /** 保存**前台**文档（main 的 save.save）；关标签确认里的「保存并关闭」用它。 */
  saveCurrent: () => Promise<void>;
  /** wikilink 解析缓存整批失效（from 基准随前台文档而变，能力在 src/link-follow.ts）。 */
  invalidateResolve: () => void;
  /** 撤下「暂不支持预览」覆盖层（切换 / 关闭标签后）。 */
  showEditor: () => void;
  /** 前台文档变化后的表现层一次对齐（装配层的 syncActiveDocument）。 */
  syncActiveDocument: () => void;
}

export interface TabsHandle {
  /** 从会话列表**全量重建**标签栏（前台会话 / 会话集合变化后调用）。 */
  renderTabs(): void;
  /** 切换前台会话（已是前台时只重绘标签栏）。 */
  activateTab(session: EditorSession): void;
  /** 关标签：有未保存修改的先给三个出口确认。 */
  closeTab(session: EditorSession): Promise<void>;
  /** 按意图挑落点会话（只决定「落到哪个标签」，内容装载在 openFile 里做）。 */
  targetSessionFor(intent: "preview" | "pinned" | "current"): EditorSession;
  /** 循环切换（⌃⇥ / ⌃⇧⇥）：首尾回卷。 */
  cycleTab(delta: number): void;
  /** ⌘1–9 的九条命令实现（用 TAB_GOTO_IDS 生成，序号与命令 id 出自同一次遍历）。 */
  gotoCommands(): Record<(typeof TAB_GOTO_IDS)[number], CommandRunner>;
}

export function createTabs(deps: TabsDeps): TabsHandle {
  const { editor, mount, toast, saveCurrent, invalidateResolve, showEditor, syncActiveDocument } = deps;

  /** 标签栏渲染：从会话列表**全量重建**。标签数量是人的注意力量级（几到十几个），全量重建
   *  比增量 diff 简单，也天然不会漂。空态（没有任何带路径的会话）整条隐藏——它在网格里
   *  不占行高，所以空态布局与多标签之前逐像素一致（整页基线的空态对照因此不需要更新）。
   *  标签可见文本是路径末段：basename 派生全前端只有一份（`src/tree.ts` 的 baseName，
   *  REVIEW.md 第 8 条），标签栏、文件树、masthead 与切换器列表共用它。 */
  function renderTabs(): void {
    const sessions = editor.sessions().filter((session) => session.path !== undefined);
    const active = editor.activeSession();
    mount.hidden = sessions.length === 0;
    mount.replaceChildren(
      ...sessions.map((session) => {
        const path = session.path as string;
        const name = baseName(path);
        const isActive = session === active;

        const tab = document.createElement("div");
        tab.className = "tab";
        tab.dataset.path = path;
        tab.classList.toggle("is-active", isActive);
        // 预览（临时）标签：标题走斜体。多标签下「这一篇会不会被下一次单击顶掉」必须有
        // 可见线索，否则用户以为它已经固定住了。
        tab.classList.toggle("is-preview", session.preview);

        const open = document.createElement("button");
        open.type = "button";
        open.className = "tab-open";
        open.setAttribute("role", "tab");
        open.setAttribute("aria-selected", String(isActive));
        // 读屏名点名文件名 + 它自己的未保存状态（文案 D90）；悬停提示给完整相对路径
        //（同名文件分散在不同目录时要能分辨，文案 D91）。
        open.setAttribute("aria-label", session.dirty ? `${name}（未保存）` : name);
        open.title = path;
        open.addEventListener("mousedown", (event) => event.preventDefault());
        open.addEventListener("click", () => activateTab(session));

        const dot = document.createElement("span");
        dot.className = "tab-dirty";
        dot.textContent = "●";
        dot.hidden = !session.dirty;
        const label = document.createElement("span");
        label.className = "tab-name";
        label.textContent = name;
        open.append(dot, label);

        const close = document.createElement("button");
        close.type = "button";
        close.className = "tab-close";
        close.textContent = "×";
        close.title = `关闭 ${name}`;
        close.setAttribute("aria-label", `关闭 ${name}`);
        close.addEventListener("mousedown", (event) => event.preventDefault());
        close.addEventListener("click", (event) => {
          event.stopPropagation();
          void closeTab(session);
        });

        tab.append(open, close);
        return tab;
      }),
    );
    // 标签栏出现 / 消失会改变编辑器列的高度，通知 CM 立刻重新测量一次：否则它要等浏览器
    // resize 观察器的回调，滚动锚点会在之后的某一拍才被修正——那一拍落在用户操作之间时，
    // 表现为「莫名其妙跳了几个像素」。m118 的「cell 内 Ctrl+E」场景按 1px 容差断言
    // 「内容不下挫」，实测就是被这一拍打红的（全量跑 3px、单跑 ≤1px，典型的竞态形态）。
    // requestMeasure 由 CM 合并，代价只有一次测量。
    editor.view.requestMeasure();
  }

  function activateTab(session: EditorSession): void {
    if (session !== editor.activeSession()) {
      editor.activateSession(session);
      invalidateResolve(); // from 变了（多半是另一篇文档），按 from 键控的缓存整批失效
      showEditor();
    }
    // 已经是前台时也要重绘：调用方可能在本次调用前改过会话的可见属性（例如把预览标签
    // 固定住），标签栏必须跟着变。
    syncActiveDocument();
  }

  /** 关标签：有未保存修改的先给三个出口确认（文案 D92 / D93）。
   *
   * **未命名文档（没有路径）不是标签**：⌘W 与逐标签关闭钮对它一律无操作（reviewer r1 P2-1）。
   * 它的内容只活在内存里，根本没有「关掉」这个语义——不加这条守卫时，冷启动的 SAMPLE 演示
   * 文档会被静默换成一份空文档（用户看到的是文档被无声清空），对一个无路径的 dirty 文档还会
   * 弹出主体为空的确认浮条（`「」有未保存修改…`）。spec 与 proposal 都写「零标签时 ⌘W 无操作」，
   * 这条守卫就是它的落点。 */
  async function closeTab(session: EditorSession): Promise<void> {
    if (session.path === undefined) return;
    if (!session.dirty) {
      closeTabNow(session);
      return;
    }
    // 上面的守卫已把 path 收窄成 string，这里不再要 `?? ""` 这类不可达兜底。
    const path = session.path;
    toast(
      `「${path}」有未保存修改，关闭后修改将丢失`,
      [
        { label: "保存并关闭", run: () => void saveThenClose(session) },
        { label: "放弃修改并关闭", run: () => closeTabNow(session) },
        { label: "取消", run: () => {} },
      ],
      true,
    );
  }

  /** 保存链路以「前台文档」为落点，所以先把要关的这一个切到前台再存——顺序是有意的，
   *  不是随手切的。保存未闭环（冲突 / 写失败 / 无落盘基准）时不关：用户还没处置完。 */
  async function saveThenClose(session: EditorSession): Promise<void> {
    activateTab(session);
    await saveCurrent();
    if (session.dirty) return;
    closeTabNow(session);
  }

  function closeTabNow(session: EditorSession): void {
    const wasActive = session === editor.activeSession();
    editor.closeSession(session);
    if (wasActive) {
      invalidateResolve(); // 前台文档被关掉：它的 from 基准一并作废
      showEditor(); // 关掉最后一个标签会落在未命名空文档上，撤下「暂不支持预览」覆盖层
    }
    syncActiveDocument();
  }

  /** 按意图挑落点会话（只决定「落到哪个标签」，内容装载在 openFile 里做）：
   *  - "current"：前台会话就地换文档（跟随链接 / 另存为新文件 / 恢复崩溃备份）；
   *  - "preview"：复用可复用的标签（预览标签，或还没有文件的未命名文档）；没有就新建一个；
   *  - "pinned"：总是新建固定标签。
   *
   *  预览标签一定是干净的——首次输入即固定（见 editor.onDirty 的处理），因此就地替换
   *  不会丢内容；兜底再判一次 dirty，异常情况下宁可新开一个也不覆盖。未命名文档同理：
   *  openFile 的守卫已经保证它在 dirty 时不会被走到这里。 */
  function targetSessionFor(intent: "preview" | "pinned" | "current"): EditorSession {
    if (intent === "current") return editor.activeSession();
    if (intent === "preview") {
      const reusable = editor.sessions().find(
        (session) => session.path === undefined || (session.preview && !session.dirty),
      );
      if (reusable !== undefined) {
        reusable.preview = true;
        return reusable;
      }
      const created = editor.createSession();
      created.preview = true;
      return created;
    }
    return editor.createSession();
  }

  /** 可见标签（有文件路径的会话），按打开顺序。标签栏、⌘1–9、⌃⇥ 共用这一份口径——
   *  未命名文档不是标签（空态就是它），所以一律经这里过滤。 */
  function visibleTabs(): EditorSession[] {
    return editor.sessions().filter((session) => session.path !== undefined);
  }

  /** 序号落点（⌘1–9 / 循环切换的唯一解析点）：越界返回 undefined，调用方无操作。
   *  **不做**「越界就跳到最后一个」这类隐式兜底——⌘7 在只有 3 个标签时不该有动作。 */
  function sessionAt(index: number): EditorSession | undefined {
    return visibleTabs()[index];
  }

  function activateTabByIndex(index: number): void {
    const session = sessionAt(index);
    if (session !== undefined) activateTab(session);
  }

  /** 循环切换（⌃⇥ / ⌃⇧⇥）：首尾回卷。0 或 1 个标签时什么都不做——「下一个」不存在，
   *  回卷到自己只会产生一次无意义的标签栏重绘。 */
  function cycleTab(delta: number): void {
    const tabs = visibleTabs();
    if (tabs.length < 2) return;
    const current = tabs.indexOf(editor.activeSession());
    activateTab(tabs[(current + delta + tabs.length) % tabs.length]);
  }

  /** ⌘1–9 的九条命令实现。用 TAB_GOTO_IDS 生成而不是手写九遍：序号与命令 id 出自同一次
   *  遍历，不可能错位（手抄一处错的表现是「某个 ⌘N 静默不动」，最难发现的一类 bug）。 */
  function gotoCommands(): Record<(typeof TAB_GOTO_IDS)[number], CommandRunner> {
    const table = {} as Record<(typeof TAB_GOTO_IDS)[number], CommandRunner>;
    TAB_GOTO_IDS.forEach((id, index) => {
      table[id] = () => activateTabByIndex(index);
    });
    return table;
  }

  return { renderTabs, activateTab, closeTab, targetSessionFor, cycleTab, gotoCommands };
}
