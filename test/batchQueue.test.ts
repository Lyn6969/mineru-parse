import { assert } from "chai";
import { BatchQueue } from "../src/modules/batchParse/queue";
import type { BatchTask } from "../src/modules/batchParse/types";

function createTask(id: string): BatchTask {
  return {
    id,
    parentItemID: 1,
    parentItemKey: id,
    title: id,
    pdfAttachmentID: 1,
    status: "queued",
    statusText: "",
    progress: 0,
    cancelRequested: false,
  };
}

function deferred() {
  let resolve!: (value: { noteID?: number }) => void;
  const promise = new Promise<{ noteID?: number }>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitForStatus(
  task: BatchTask,
  status: BatchTask["status"],
  timeout = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (task.status !== status) {
    if (Date.now() > deadline) {
      throw new Error(`Task ${task.id} stayed ${task.status}`);
    }
    await Zotero.Promise.delay(10);
  }
}

describe("BatchQueue scheduling", function () {
  this.timeout(5_000);

  it("does not start an idle batch when concurrency changes", function () {
    const task = createTask("idle");
    const queue = new BatchQueue({
      getConcurrency: () => 1,
      onTaskChange: () => {},
      run: () => Promise.reject(new Error("must not run")),
    });

    queue.ensureRunning([task]);
    assert.equal(task.status, "queued");
  });

  it("starts the next single task after the current task finishes", async function () {
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const queue = new BatchQueue({
      getConcurrency: () => 1,
      onTaskChange: () => {},
      run: (task: BatchTask) => {
        const gate = deferred();
        gates.set(task.id, gate);
        return gate.promise;
      },
    });
    const first = createTask("first");
    const second = createTask("second");

    queue.startTask(first, [first]);
    queue.startTask(second, [second]);
    assert.equal(first.status, "running");
    assert.equal(second.status, "queued");

    gates.get("first")!.resolve({});
    await waitForStatus(second, "running");
    assert.equal(first.status, "success");

    gates.get("second")!.resolve({});
    await waitForStatus(second, "success");
  });

  it("does not restart a drained batch when tasks are added later", async function () {
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const queue = new BatchQueue({
      getConcurrency: () => 1,
      onTaskChange: () => {},
      run: (task: BatchTask) => {
        const gate = deferred();
        gates.set(task.id, gate);
        return gate.promise;
      },
    });
    const first = createTask("first");
    const second = createTask("second");

    queue.start([first]);
    gates.get("first")!.resolve({});
    await waitForStatus(first, "success");
    await Zotero.Promise.delay(0);

    queue.ensureRunning([second]);
    assert.equal(second.status, "queued");

    queue.startTask(second, [second]);
    gates.get("second")!.resolve({});
    await waitForStatus(second, "success");
  });

  it("admits newly added tasks after a running slot finishes", async function () {
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const queue = new BatchQueue({
      getConcurrency: () => 1,
      onTaskChange: () => {},
      run: (task: BatchTask) => {
        const gate = deferred();
        gates.set(task.id, gate);
        return gate.promise;
      },
    });
    const first = createTask("first");
    const second = createTask("second");

    queue.start([first]);
    queue.ensureRunning([first, second]);
    assert.equal(second.status, "queued");

    gates.get("first")!.resolve({});
    await waitForStatus(second, "running");
    gates.get("second")!.resolve({});
    await waitForStatus(second, "success");
  });

  it("does not exceed the real active count when restarting after stop", async function () {
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const queue = new BatchQueue({
      getConcurrency: () => 1,
      onTaskChange: () => {},
      run: (task: BatchTask) => {
        const gate = deferred();
        gates.set(task.id, gate);
        return gate.promise;
      },
    });
    const first = createTask("first");
    const second = createTask("second");

    queue.start([first]);
    queue.stopAll([first]);
    queue.start([second]);

    assert.equal(first.status, "running");
    assert.equal(second.status, "queued");

    gates.get("first")!.resolve({});
    await waitForStatus(second, "running");
    gates.get("second")!.resolve({});
    await waitForStatus(second, "success");
  });
});
