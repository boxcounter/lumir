export type ThreadStatus = "active" | "paused" | "completed" | "archived";
import type { Thread as IpcThread } from "./bindings/Thread";
export type Thread = IpcThread;
export const threadView = (item: Thread) => ({ id: item.id, title: item.title, status: item.status, updatedAt: item.recent_activity });
export interface ThreadsCallbacks {
  onCreate(title: string): void | Promise<void>;
  onSelect(id: string): void | Promise<void>;
  onStatus(id: string, status: ThreadStatus): void | Promise<void>;
}
export const COPY = {
  heading: "Threads", create: "+ 新建", placeholder: "Thread 名称", submit: "创建", cancel: "取消",
  empty: "还没有 Thread。创建一个意图，开始工作。", confirm: "确认将 Thread 状态改为归档？",
  recent: "最近活动：", session: "仅当前会话，尚未接入持久化存储。",
};
export const STATUS: Record<ThreadStatus, string> = { active: "进行中", paused: "暂停", completed: "完成", archived: "归档" };
export interface ThreadsView { setThreads(items: Thread[]): void; setCurrent(id?: string): void; }

export function createThreads(mount: HTMLElement, cb: ThreadsCallbacks): ThreadsView {
  const root = document.createElement("section");
  root.className = "threads";
  const heading = document.createElement("div");
  heading.className = "threads-heading";
  const title = document.createElement("h2");
  title.textContent = COPY.heading;
  const add = document.createElement("button");
  add.type = "button"; add.className = "threads-add"; add.textContent = COPY.create;
  heading.append(title, add);
  const session = document.createElement("p");
  session.className = "threads-session"; session.textContent = COPY.session;
  const list = document.createElement("div");
  list.className = "threads-list";
  root.append(heading, session, list); mount.replaceChildren(root);
  let current: string | undefined;
  let items: Thread[] = [];
  let form: HTMLFormElement | undefined;
  add.addEventListener("click", () => {
    if (form) { form.querySelector("input")?.focus(); return; }
    const input = document.createElement("input");
    input.className = "thread-create-input"; input.placeholder = COPY.placeholder;
    input.setAttribute("aria-label", COPY.placeholder); input.required = true; input.maxLength = 200;
    const submit = document.createElement("button");
    submit.type = "submit"; submit.textContent = COPY.submit; submit.className = "thread-create-submit";
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.textContent = COPY.cancel;
    form = document.createElement("form"); form.className = "thread-create-form";
    form.append(input, submit, cancel); heading.after(form); input.focus();
    const close = () => { form?.remove(); form = undefined; add.focus(); };
    cancel.addEventListener("click", close);
    form.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); close(); } });
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); const name = input.value.trim(); if (!name || submit.disabled) return;
      submit.disabled = true;
      try { await cb.onCreate(name); close(); } finally { submit.disabled = false; }
    });
  });
  function render() {
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p"); empty.className = "threads-empty"; empty.textContent = COPY.empty;
      list.append(empty); return;
    }
    for (const item of items) {
      const card = document.createElement("article");
      card.className = "thread-card"; card.classList.toggle("is-current", item.id === current); card.dataset.threadId = item.id;
      const select = document.createElement("button");
      select.type = "button"; select.className = "thread-select"; select.title = item.title;
      select.setAttribute("aria-pressed", String(item.id === current));
      const name = document.createElement("strong"); name.textContent = item.title;
      const state = document.createElement("span"); state.className = "thread-status"; state.textContent = STATUS[item.status];
      const activity = document.createElement("time"); activity.textContent = COPY.recent + item.recent_activity;
      select.append(name, state, activity);
      select.addEventListener("click", () => { void cb.onSelect(item.id); });
      const actions = document.createElement("div"); actions.className = "thread-actions";
      for (const status of ["active", "paused", "completed", "archived"] as const) {
        if (status === item.status) continue;
        const action = document.createElement("button");
        action.type = "button"; action.className = "thread-action"; action.textContent = STATUS[status];
        action.addEventListener("click", () => {
          if (status === "archived" && !window.confirm(COPY.confirm)) return;
          void cb.onStatus(item.id, status);
        });
        actions.append(action);
      }
      card.append(select, actions); list.append(card);
    }
  }
  render();
  return { setThreads(value) { items = value; render(); }, setCurrent(id) { current = id; render(); } };
}
