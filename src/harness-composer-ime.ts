export interface ComposerImeCoordinatorDeps<T> {
  insert(item: T): boolean;
  send(): void;
}

export interface ComposerImeCoordinator<T> {
  insert(item: T, generation: number, composing: boolean): "inserted" | "queued" | "failed";
  send(generation: number, composing: boolean): "sent" | "pending" | "failed";
  compositionEnd(generation: number): "sent" | "drained" | "failed" | "idle";
  reset(generation: number): void;
  snapshot(): { queueLength: number; pendingSend: boolean };
}

export function createComposerImeCoordinator<T>(
  deps: ComposerImeCoordinatorDeps<T>,
): ComposerImeCoordinator<T> {
  let generation = 0;
  let queue: Array<{ generation: number; item: T }> = [];
  let pendingSend: { generation: number } | null = null;

  function reset(nextGeneration: number): void {
    generation = nextGeneration;
    queue = [];
    pendingSend = null;
  }

  function sync(nextGeneration: number): void {
    if (nextGeneration !== generation) reset(nextGeneration);
  }

  function drain(): boolean {
    while (queue.length > 0) {
      const request = queue[0];
      if (request.generation !== generation) {
        queue.shift();
        continue;
      }
      let inserted = false;
      try {
        inserted = deps.insert(request.item);
      } catch {
        inserted = false;
      }
      if (!inserted) {
        pendingSend = null;
        return false;
      }
      queue.shift();
    }
    return true;
  }

  function insert(item: T, nextGeneration: number, composing: boolean): "inserted" | "queued" | "failed" {
    sync(nextGeneration);
    if (composing) {
      queue.push({ generation, item });
      return "queued";
    }
    queue.push({ generation, item });
    return drain() ? "inserted" : "failed";
  }

  function send(nextGeneration: number, composing: boolean): "sent" | "pending" | "failed" {
    sync(nextGeneration);
    if (composing) {
      pendingSend ??= { generation };
      return "pending";
    }
    if (!drain()) return "failed";
    pendingSend = null;
    deps.send();
    return "sent";
  }

  function compositionEnd(nextGeneration: number): "sent" | "drained" | "failed" | "idle" {
    sync(nextGeneration);
    const hadRequests = queue.length > 0;
    if (!drain()) return "failed";
    if (pendingSend?.generation === generation) {
      pendingSend = null;
      deps.send();
      return "sent";
    }
    pendingSend = null;
    return hadRequests ? "drained" : "idle";
  }

  return {
    insert,
    send,
    compositionEnd,
    reset,
    snapshot: () => ({ queueLength: queue.length, pendingSend: pendingSend !== null }),
  };
}
