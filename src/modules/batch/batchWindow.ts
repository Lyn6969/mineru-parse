import { getString } from "../../utils/locale";
import { BatchQueue } from "./batchQueue";
import type { QueueState, BatchSummary } from "./batchTypes";

let windowInstance: Window | null = null;
let queueInstance: BatchQueue | null = null;
let windowReadyResolve: (() => void) | null = null;
let windowReadyPromise: Promise<void> | null = null;

export function openBatchWindow(): Promise<void> {
  // 单例：已有窗口则聚焦
  if (windowInstance && !windowInstance.closed) {
    windowInstance.focus();
    return Promise.resolve();
  }

  windowReadyPromise = new Promise<void>((resolve) => {
    windowReadyResolve = resolve;
  });

  const items: ReturnType<BatchQueue["getItems"]> = [];
  let tableHelper: any = null;
  let statsLabel: HTMLElement | null = null;
  let startBtn: HTMLElement | null = null;
  let pauseBtn: HTMLElement | null = null;
  let stopBtn: HTMLElement | null = null;

  function setElementText(el: Element | null, text: string) {
    if (!el) return;
    (el as any).label = text;
    (el as any).value = text;
    (el as HTMLElement).textContent = text;
  }

  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let throttlePending = false;

  function scheduleRefresh() {
    if (throttleTimer) {
      throttlePending = true;
      return;
    }
    doRefresh();
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      if (throttlePending) {
        throttlePending = false;
        doRefresh();
      }
    }, 200);
  }

  function doRefresh() {
    refreshTableData();
    tableHelper?.treeInstance?.invalidate();
    updateStats();
  }

  const queue = new BatchQueue({
    onItemUpdated: () => {
      scheduleRefresh();
    },
    onQueueStateChanged: (state: QueueState) => {
      updateButtonStates(state);
    },
    onCompleted: (summary: BatchSummary) => {
      updateStats();
      if (windowInstance && !windowInstance.closed) {
        windowInstance.alert(
          getString("batch-complete-summary", {
            args: {
              success: summary.success,
              failed: summary.failed,
              skipped: summary.skipped,
            },
          }),
        );
      }
    },
  });
  queueInstance = queue;

  function refreshTableData() {
    items.length = 0;
    items.push(...queue.getItems());
  }

  function updateStats() {
    if (!statsLabel) return;
    const stats = queue.getStats();
    const text = getString("batch-stats-summary", {
      args: {
        total: stats.total,
        pending: stats.pending,
        running: stats.running,
        done: stats.done,
        error: stats.error,
      },
    });
    setElementText(statsLabel, text);
  }

  function updateButtonStates(state: QueueState) {
    if (!startBtn || !pauseBtn || !stopBtn) return;
    const isIdle = state === "idle";
    const isRunning = state === "running";
    const isPaused = state === "paused";

    (startBtn as any).disabled = !isIdle;
    (pauseBtn as any).disabled = !isRunning && !isPaused;
    setElementText(
      pauseBtn,
      isPaused ? getString("batch-btn-resume") : getString("batch-btn-pause"),
    );
    (stopBtn as any).disabled = isIdle;
  }

  const dialog = new ztoolkit.Dialog(5, 1);

  // 第 0 行：统计信息栏
  dialog.addCell(0, 0, {
    tag: "div",
    id: "batch-stats-label",
    namespace: "html",
    properties: {
      textContent: getString("batch-stats-summary", {
        args: { total: 0, pending: 0, running: 0, done: 0, error: 0 },
      }),
    },
    styles: {
      fontSize: "13px",
      padding: "6px 8px",
    },
  });

  // 第 1 行：操作按钮行
  dialog.addCell(1, 0, {
    tag: "div",
    namespace: "html",
    styles: {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "4px 8px",
      flexWrap: "wrap",
    },
    children: [
      {
        tag: "button",
        namespace: "html",
        properties: { textContent: getString("batch-btn-scan") },
        listeners: [
          {
            type: "click",
            listener: async () => {
              const count = await queue.scanUnparsed("library");
              refreshTableData();
              tableHelper?.treeInstance?.invalidate();
              updateStats();
              if (windowInstance) {
                windowInstance.alert(
                  getString("batch-scan-result", { args: { count } }),
                );
              }
            },
          },
        ],
      },
      {
        tag: "button",
        namespace: "html",
        properties: { textContent: getString("batch-btn-scan-collection") },
        listeners: [
          {
            type: "click",
            listener: async () => {
              const count = await queue.scanUnparsed("collection");
              refreshTableData();
              tableHelper?.treeInstance?.invalidate();
              updateStats();
              if (windowInstance) {
                windowInstance.alert(
                  getString("batch-scan-result", { args: { count } }),
                );
              }
            },
          },
        ],
      },
      {
        tag: "button",
        namespace: "html",
        properties: { textContent: getString("batch-btn-add-selected") },
        listeners: [
          {
            type: "click",
            listener: () => {
              const pane = Zotero.getActiveZoteroPane();
              const selected = pane?.getSelectedItems() || [];
              const regular = selected.filter((i: Zotero.Item) =>
                i.isRegularItem(),
              );
              const count = queue.addItems(regular);
              refreshTableData();
              tableHelper?.treeInstance?.invalidate();
              updateStats();
              if (windowInstance) {
                windowInstance.alert(
                  getString("batch-add-result", { args: { count } }),
                );
              }
            },
          },
        ],
      },
      {
        tag: "button",
        namespace: "html",
        properties: { textContent: getString("batch-btn-clear") },
        listeners: [
          {
            type: "click",
            listener: () => {
              queue.clear();
              refreshTableData();
              tableHelper?.treeInstance?.invalidate();
              updateStats();
            },
          },
        ],
      },
    ],
  });

  // 第 2 行：VirtualizedTable 容器
  dialog.addCell(2, 0, {
    tag: "div",
    namespace: "html",
    id: "batch-table-container",
    styles: {
      height: "400px",
      width: "100%",
      borderTop: "1px solid #ccc",
      borderBottom: "1px solid #ccc",
    },
  });

  // 第 3 行：控制按钮行
  dialog.addCell(3, 0, {
    tag: "div",
    namespace: "html",
    styles: {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "4px 8px",
      flexWrap: "wrap",
    },
    children: [
      {
        tag: "button",
        namespace: "html",
        id: "batch-btn-start",
        properties: { textContent: getString("batch-btn-start") },
        listeners: [
          {
            type: "click",
            listener: async () => {
              if (queue.getCount() === 0) {
                windowInstance?.alert(getString("batch-no-items"));
                return;
              }
              try {
                await queue.start();
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                windowInstance?.alert(msg);
              }
            },
          },
        ],
      },
      {
        tag: "button",
        namespace: "html",
        id: "batch-btn-pause",
        properties: {
          textContent: getString("batch-btn-pause"),
          disabled: true,
        },
        listeners: [
          {
            type: "click",
            listener: () => {
              if (queue.getState() === "paused") {
                queue.resume();
              } else {
                queue.pause();
              }
            },
          },
        ],
      },
      {
        tag: "button",
        namespace: "html",
        id: "batch-btn-stop",
        properties: {
          textContent: getString("batch-btn-stop"),
          disabled: true,
        },
        listeners: [
          {
            type: "click",
            listener: () => {
              queue.stop();
            },
          },
        ],
      },
      {
        tag: "button",
        namespace: "html",
        properties: { textContent: getString("batch-btn-retry-failed") },
        listeners: [
          {
            type: "click",
            listener: () => {
              queue.retryFailed();
              refreshTableData();
              tableHelper?.treeInstance?.invalidate();
              updateStats();
            },
          },
        ],
      },
      {
        tag: "button",
        namespace: "html",
        properties: { textContent: getString("batch-btn-remove-done") },
        listeners: [
          {
            type: "click",
            listener: () => {
              queue.removeCompleted();
              refreshTableData();
              tableHelper?.treeInstance?.invalidate();
              updateStats();
            },
          },
        ],
      },
    ],
  });

  dialog.setDialogData({
    loadCallback: () => {
      const win = dialog.window;
      windowInstance = win;

      // 获取 DOM 引用
      const doc = win.document;
      statsLabel = doc.getElementById(
        "batch-stats-label",
      ) as HTMLElement | null;
      startBtn = doc.getElementById("batch-btn-start") as HTMLElement | null;
      pauseBtn = doc.getElementById("batch-btn-pause") as HTMLElement | null;
      stopBtn = doc.getElementById("batch-btn-stop") as HTMLElement | null;

      // 初始化 VirtualizedTable
      tableHelper = new ztoolkit.VirtualizedTable(win);
      tableHelper.setProp({
        id: "batch-parse-table",
        columns: [
          {
            dataKey: "title",
            label: getString("batch-col-title"),
            width: 350,
            fixedWidth: false,
          },
          {
            dataKey: "statusText",
            label: getString("batch-col-status"),
            width: 150,
            fixedWidth: false,
          },
          {
            dataKey: "progress",
            label: getString("batch-col-progress"),
            width: 80,
            fixedWidth: true,
          },
        ],
        showHeader: true,
        multiSelect: true,
        staticColumns: true,
        getRowCount: () => items.length,
        getRowData: (index: number) => {
          const item = items[index];
          if (!item) return { title: "", statusText: "", progress: "" };
          return {
            title: item.title,
            statusText: item.statusText,
            progress: `${item.progress}%`,
          };
        },
      });
      tableHelper.setContainerId("batch-table-container");
      tableHelper.render();

      updateButtonStates("idle");

      // 通知等待方窗口已就绪
      windowReadyResolve?.();
      windowReadyResolve = null;
    },
    unloadCallback: () => {
      windowInstance = null;
      queueInstance = null;
      windowReadyPromise = null;
      windowReadyResolve = null;
      // 运行中关闭窗口时停止队列
      if (queue.getState() !== "idle") {
        queue.stop();
      }
    },
  });

  dialog.open(getString("batch-window-title"), {
    width: 750,
    height: 550,
    centerscreen: true,
    resizable: true,
    noDialogMode: true,
    fitContent: false,
  });

  return windowReadyPromise!;
}

/** 将当前选中条目添加到已打开的批量窗口队列 */
export async function addSelectedItemsToBatch() {
  // 如果窗口未打开，先打开并等待就绪
  if (!windowInstance || windowInstance.closed || !queueInstance) {
    await openBatchWindow();
  }
  doAddSelected();
}

function doAddSelected() {
  if (!queueInstance) return;
  const pane = Zotero.getActiveZoteroPane();
  const selected = pane?.getSelectedItems() || [];
  const regular = selected.filter((i: Zotero.Item) => i.isRegularItem());
  const count = queueInstance.addItems(regular);
  if (windowInstance && !windowInstance.closed) {
    windowInstance.alert(getString("batch-add-result", { args: { count } }));
  }
}
