export type ThreadStatus = "active" | "paused" | "completed" | "archived";

export interface Thread { id: string; title: string; status: ThreadStatus; updatedAt: string; }
export interface ThreadsCallbacks {
  onCreate(): void;
  onSelect(id: string): void;
  onStatus(id: string, status: ThreadStatus): void;
}

const STATUS: Record<ThreadStatus, string> = { active: "进行中", paused: "暂停", completed: "完成", archived: "归档" };

export interface ThreadsView { setThreads(items: Thread[]): void; setCurrent(id?: string): void; }

export function createThreads(mount: HTMLElement, cb: ThreadsCallbacks): ThreadsView {
  const root = document.createElement("section"); root.className = "threads";
  const heading = document.createElement("div"); heading.className = "threads-heading";
  const title = document.createElement("h2"); title.textContent = "Threads";
  const add = document.createElement("button"); add.type = "button"; add.className = "threads-add"; add.textContent = "+ 新建";
  add.addEventListener("click", () => cb.onCreate()); heading.append(title, add);
  const list = document.createElement("div"); list.className = "threads-list"; root.append(heading, list); mount.replaceChildren(root);
  let current: string | undefined;
  function render(items: Thread[]) {
    list.replaceChildren();
    if (!items.length) { const empty = document.createElement("p"); empty.className = "threads-empty"; empty.textContent = "还没有 Thread。创建一个意图，开始工作。"; list.append(empty); return; }
    for (const item of items) {
      const card = document.createElement("button"); card.type = "button"; card.className = "thread-card"; card.classList.toggle("is-current", item.id === current);
      card.dataset.threadId = item.id; card.title = item.title;
      const name = document.createElement("strong"); name.textContent = item.title;
      const state = document.createElement("span"); state.className = `thread-status thread-${item.status}`; state.textContent = STATUS[item.status];
      const activity = document.createElement("time"); activity.textContent = item.updatedAt;
      card.append(name, state, activity); card.addEventListener("click", () => { current = item.id; cb.onSelect(item.id); render(items); });
      card.addEventListener("contextmenu", (e) => { e.preventDefault(); const next: ThreadStatus = item.status === "active" ? "paused" : item.status === "paused" ? "completed" : item.status === "completed" ? "archived" : "active"; cb.onStatus(item.id, next); });
      list.append(card);
    }
  }
  return { setThreads: render, setCurrent(id) { current = id; list.querySelectorAll(".thread-card").forEach((el) => el.classList.toggle("is-current", (el as HTMLElement).dataset.threadId === id)); } };
}
