import { test } from "node:test";
import assert from "node:assert/strict";

const coordinatorModule = await import("../../src/harness-composer-ime.ts").catch(() => null);

function fixture() {
  assert.notEqual(coordinatorModule, null, "IME FIFO 协调器必须存在");
  const inserted: string[] = [];
  let sends = 0;
  let failNext = false;
  const coordinator = coordinatorModule!.createComposerImeCoordinator<string>({
    insert: (item) => {
      if (failNext) {
        failNext = false;
        return false;
      }
      inserted.push(item);
      return true;
    },
    send: () => { sends += 1; },
  });
  return {
    coordinator,
    inserted,
    sends: () => sends,
    failNext: () => { failNext = true; },
  };
}

test("组合期连续两卡 FIFO，compositionend 后按序落入并只发送一次", () => {
  const { coordinator, inserted, sends } = fixture();
  assert.equal(coordinator.insert("A", 0, true), "queued");
  assert.equal(coordinator.insert("B", 0, true), "queued");
  assert.equal(coordinator.send(0, true), "pending");
  assert.equal(coordinator.send(0, true), "pending");
  assert.deepEqual(inserted, []);
  assert.equal(coordinator.compositionEnd(0), "sent");
  assert.deepEqual(inserted, ["A", "B"]);
  assert.equal(sends(), 1);
  assert.deepEqual(coordinator.snapshot(), { queueLength: 0, pendingSend: false });
});

test("切视图取消旧队列与 pendingSend，新视图不发送旧代内容", () => {
  const { coordinator, inserted, sends } = fixture();
  coordinator.insert("OLD", 0, true);
  coordinator.send(0, true);
  coordinator.reset(1);
  assert.deepEqual(coordinator.snapshot(), { queueLength: 0, pendingSend: false });
  assert.equal(coordinator.compositionEnd(1), "idle");
  assert.deepEqual(inserted, []);
  assert.equal(sends(), 0);
});

test("drain 失败取消发送并保留未消费请求，后续可重试", () => {
  const { coordinator, inserted, sends, failNext } = fixture();
  coordinator.insert("A", 0, true);
  coordinator.insert("B", 0, true);
  coordinator.send(0, true);
  failNext();
  assert.equal(coordinator.compositionEnd(0), "failed");
  assert.equal(sends(), 0);
  assert.deepEqual(coordinator.snapshot(), { queueLength: 2, pendingSend: false });
  assert.equal(coordinator.compositionEnd(0), "drained");
  assert.deepEqual(inserted, ["A", "B"]);
  assert.equal(sends(), 0);
  assert.equal(coordinator.send(0, false), "sent");
  assert.equal(sends(), 1);
});

test("无插卡请求的组合期重复发送仍合并，drain 后只执行一次", () => {
  const { coordinator, sends } = fixture();
  assert.equal(coordinator.send(0, true), "pending");
  assert.equal(coordinator.send(0, true), "pending");
  assert.equal(coordinator.compositionEnd(0), "sent");
  assert.equal(sends(), 1);
});
