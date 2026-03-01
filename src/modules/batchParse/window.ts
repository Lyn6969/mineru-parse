import { config } from "../../../package.json";
import { getString } from "../../utils/locale";
import { getPref, setPref } from "../../utils/prefs";
import {
  createBatchTaskFromCandidate,
  detectBatchTasksFromSelection,
  scanLibraryUnparsedStats,
} from "./detect";
import { BatchQueue } from "./queue";
import type {
  BatchCategoryKey,
  BatchCategoryStat,
  BatchFilter,
  BatchLibraryStats,
  BatchStatsScanProgress,
  BatchTask,
  BatchTaskStatus,
  UnparsedCandidate,
} from "./types";

const WINDOW_NAME = `${config.addonRef}-batch-parse`;
const STATS_WINDOW_NAME = `${config.addonRef}-batch-stats`;
const CONCURRENCY_MIN = 1;
const CONCURRENCY_MAX = 5;
const CONCURRENCY_DEFAULT = 2;
const IMPORT_CHUNK_SIZE = 250;

let batchWindow: Window | undefined;
let statsWindow: Window | undefined;
let tableHelper: any;
let tableSelection: any;
let tasks: BatchTask[] = [];
let filteredTasksCache: BatchTask[] = [];
let filteredTasksDirty = true;
let activeFilter: BatchFilter = "all";
let statsLoading = false;
let statsData: BatchLibraryStats | null = null;
let statsScanProgress: BatchStatsScanProgress | null = null;

function safeRefreshBatchWindowUI() {
  const win = batchWindow;
  if (!isWindowAlive(win)) {
    return;
  }
  win.setTimeout(() => {
    try {
      refreshUI();
    } catch {
      return;
    }
  }, 0);
}

const CATEGORY_META: Record<
  BatchCategoryKey,
  { icon: string; labelKey: Parameters<typeof getString>[0] }
> = {
  journal: { icon: "📄", labelKey: "batch-stats-cat-journal" },
  conference: { icon: "🔨", labelKey: "batch-stats-cat-conference" },
  thesis: { icon: "🎓", labelKey: "batch-stats-cat-thesis" },
  book: { icon: "📚", labelKey: "batch-stats-cat-book" },
  other: { icon: "📎", labelKey: "batch-stats-cat-other" },
};

const queue = new BatchQueue({
  getConcurrency: () => getConcurrency(),
  onTaskChange: () => {
    refreshUI();
  },
});

export async function openBatchParseWindow() {
  if (isWindowAlive(batchWindow)) {
    batchWindow?.focus();
    refreshUI();
    return;
  }

  const windowArgs = {
    _initPromise: Zotero.Promise.defer(),
  };
  const win = Zotero.getMainWindow().openDialog(
    `chrome://${config.addonRef}/content/batch-parse.xhtml`,
    WINDOW_NAME,
    "chrome,centerscreen,resizable,status,dialog=no",
    windowArgs,
  );
  if (!win) return;

  await windowArgs._initPromise.promise;
  batchWindow = win;
  initializeBatchWindow(win);
  refreshUI();
}

function initializeBatchWindow(win: Window) {
  bindBatchControls(win);
  initTable(win);
  initConcurrency(win);
  initFilters(win);
  win.addEventListener("unload", () => {
    if (batchWindow !== win) return;
    queue.stopAll(tasks);
    queue.reset();
    if (isWindowAlive(statsWindow)) {
      statsWindow.close();
    }
    batchWindow = undefined;
    statsWindow = undefined;
    tableHelper = undefined;
    tasks = [];
    filteredTasksCache = [];
    filteredTasksDirty = true;
    activeFilter = "all";
    statsLoading = false;
    statsData = null;
    statsScanProgress = null;
  });
}

function bindBatchControls(win: Window) {
  const addButton = win.document.getElementById("batch-add-selected");
  const startSelectedButton = win.document.getElementById(
    "batch-start-selected",
  );
  const startButton = win.document.getElementById("batch-start-all");
  const stopButton = win.document.getElementById("batch-stop-all");
  const clearButton = win.document.getElementById("batch-clear-finished");
  const openStatsButton = win.document.getElementById("batch-open-stats");

  addButton?.addEventListener("click", () => {
    void onAddSelected();
  });
  startSelectedButton?.addEventListener("click", () => {
    onStartSelected();
  });
  startButton?.addEventListener("click", () => {
    queue.start(tasks);
    refreshUI();
  });
  stopButton?.addEventListener("click", () => {
    queue.stopAll(tasks);
  });
  clearButton?.addEventListener("click", () => {
    tasks = tasks.filter((task) => !isTerminalStatus(task.status));
    refreshUI();
  });

  if (openStatsButton) {
    const label = getString("batch-action-stats");
    openStatsButton.setAttribute("title", label);
    openStatsButton.setAttribute("aria-label", label);
  }
  openStatsButton?.addEventListener("click", () => {
    void onOpenStatsWindow();
  });
}

function initConcurrency(win: Window) {
  const input = win.document.getElementById(
    "batch-concurrency",
  ) as HTMLInputElement | null;
  if (!input) return;
  input.value = String(getConcurrency());
  input.addEventListener("change", () => {
    const value = Number(input.value);
    const normalized = normalizeConcurrency(value);
    input.value = String(normalized);
    setPref("batch_parse_concurrency", normalized);
    refreshUI();
  });
}

function initFilters(win: Window) {
  const filterButtons = win.document.querySelectorAll<HTMLElement>(
    "[data-batch-filter]",
  );
  for (const button of filterButtons) {
    button.addEventListener("click", () => {
      const nextFilter = button.dataset.batchFilter as BatchFilter | undefined;
      if (!nextFilter) return;
      activeFilter = nextFilter;
      filteredTasksDirty = true;
      refreshUI();
    });
  }
}

function initTable(win: Window) {
  tableHelper = new ztoolkit.VirtualizedTable(win)
    .setContainerId("batch-table-container")
    .setProp({
      id: "batch-task-table",
      columns: [
        {
          dataKey: "progress",
          label: getString("batch-column-progress"),
          width: 90,
          fixedWidth: true,
        },
        {
          dataKey: "title",
          label: getString("batch-column-title"),
          fixedWidth: false,
        },
        {
          dataKey: "status",
          label: getString("batch-column-status"),
          width: 140,
          fixedWidth: true,
        },
        {
          dataKey: "duration",
          label: getString("batch-column-duration"),
          width: 90,
          fixedWidth: true,
        },
        {
          dataKey: "actions",
          label: getString("batch-column-actions"),
          width: 130,
          fixedWidth: true,
        },
      ],
      showHeader: true,
      multiSelect: true,
      staticColumns: true,
      disableFontSizeScaling: true,
    })
    .setProp("getRowCount", () => getFilteredTasks().length)
    .setProp("getRowData", (index: number) => {
      const task = getFilteredTasks()[index];
      return toRowData(task);
    })
    .setProp("renderItem", renderRow)
    .setProp("onSelectionChange", () => {
      tableSelection = tableHelper?.treeInstance?.selection || tableSelection;
      refreshSelectionUI();
      return true;
    })
    .setProp("onActivate", (_event: Event, items: number[]) => {
      const index = items[0];
      const task = getFilteredTasks()[index];
      if (!task) return true;
      const win = batchWindow;
      if (isWindowAlive(win)) {
        win.setTimeout(() => {
          locateTaskItem(task);
        }, 0);
      } else {
        locateTaskItem(task);
      }
      return true;
    })
    .render();
}

function renderRow(
  index: number,
  selection: any,
  oldElem: HTMLElement | undefined,
  columns: Array<{ dataKey: string; className?: string }>,
) {
  const task = getFilteredTasks()[index];
  const win = batchWindow;
  if (!task || !win) {
    if (oldElem) return oldElem;
    const fallbackDoc =
      batchWindow?.document || Zotero.getMainWindow().document;
    return fallbackDoc.createElement("div");
  }

  const row = oldElem || win.document.createElement("div");
  tableSelection = selection;
  row.className = "row";
  row.innerHTML = "";
  row.classList.toggle("selected", Boolean(selection?.isSelected?.(index)));
  row.classList.toggle("focused", selection?.focused === index);

  for (const column of columns) {
    const cell = win.document.createElement("span");
    cell.className = `cell ${column.className || ""}`.trim();

    if (column.dataKey === "actions") {
      cell.appendChild(createActionGroup(task, win.document));
    } else if (column.dataKey === "status") {
      cell.appendChild(createStatusBadge(task, win.document));
      cell.setAttribute("title", task.errorMessage || "");
    } else if (column.dataKey === "progress") {
      cell.textContent = `${Math.max(0, Math.min(100, task.progress))}%`;
    } else if (column.dataKey === "duration") {
      cell.textContent = formatDuration(task.durationMs);
    } else if (column.dataKey === "title") {
      cell.textContent = task.title;
      cell.setAttribute("title", task.title);
    }

    row.appendChild(cell);
  }

  return row;
}

function createActionGroup(task: BatchTask, doc: Document): HTMLElement {
  const container = doc.createElement("div");
  container.className = "batch-actions";

  if (task.status === "running") {
    container.appendChild(
      createActionButton(
        doc,
        getString("batch-op-stop"),
        "■",
        "is-stop",
        () => {
          queue.stopTask(task);
        },
      ),
    );
    container.appendChild(
      createActionButton(
        doc,
        getString("batch-op-locate"),
        "⌕",
        "is-locate",
        () => {
          locateTaskItem(task);
        },
      ),
    );
    return container;
  }

  if (task.status === "success" && task.noteID) {
    container.appendChild(
      createActionButton(
        doc,
        getString("batch-op-open-note"),
        "⌕",
        "is-open",
        () => {
          openNote(task.noteID!);
        },
      ),
    );
    container.appendChild(
      createActionButton(
        doc,
        getString("batch-op-locate"),
        "⌖",
        "is-locate",
        () => {
          locateTaskItem(task);
        },
      ),
    );
    return container;
  }

  if (
    task.status === "queued" ||
    task.status === "failed" ||
    task.status === "stopped"
  ) {
    container.appendChild(
      createActionButton(
        doc,
        getString("batch-op-parse"),
        "▶",
        "is-parse",
        () => {
          onRunSingleTask(task);
        },
      ),
    );
    container.appendChild(
      createActionButton(
        doc,
        getString("batch-op-locate"),
        "⌖",
        "is-locate",
        () => {
          locateTaskItem(task);
        },
      ),
    );
  }

  return container;
}

function createStatusBadge(task: BatchTask, doc: Document): HTMLElement {
  const badge = doc.createElement("span");
  const isStopping =
    task.status === "running" && task.statusText === "stopping";
  badge.className = `status-badge ${isStopping ? "is-stopping" : `is-${task.status}`}`;
  badge.textContent = getStatusDisplay(task);
  return badge;
}

function createActionButton(
  doc: Document,
  label: string,
  icon: string,
  variantClass: string,
  handler: () => void,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.className = `icon-button ${variantClass}`;
  button.textContent = icon;
  button.setAttribute("title", label);
  button.setAttribute("aria-label", label);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    handler();
  });
  return button;
}

function onRunSingleTask(task: BatchTask) {
  if (task.status === "running" || task.status === "success") {
    return;
  }
  queue.startTask(task, [task]);
  refreshUI();
}

function onStartSelected() {
  const selectedTasks = getSelectedTasks().filter(
    (task) =>
      task.status === "queued" ||
      task.status === "failed" ||
      task.status === "stopped",
  );
  for (const task of selectedTasks) {
    queue.startTask(task, selectedTasks);
  }
  refreshUI();
}

async function onAddSelected() {
  const result = await detectBatchTasksFromSelection(tasks);
  if (result.tasks.length > 0) {
    tasks.push(...result.tasks);
    filteredTasksDirty = true;
  }
  refreshUI();
  showDetectSummary(result.summary);
}

function showDetectSummary(summary: {
  added: number;
  skippedNoPdf: number;
  skippedParsed: number;
  skippedDuplicate: number;
  skippedInvalid: number;
}) {
  const win = getMessageWindow();
  const message = getString("batch-add-summary", {
    args: {
      added: summary.added,
      noPdf: summary.skippedNoPdf,
      parsed: summary.skippedParsed,
      duplicate: summary.skippedDuplicate,
      invalid: summary.skippedInvalid,
    },
  });
  win.alert(message);
}

async function onOpenStatsWindow() {
  if (isWindowAlive(statsWindow)) {
    statsWindow.focus();
    refreshStatsWindowUI();
    if (!statsData) {
      await refreshStatsData();
    }
    return;
  }

  const windowArgs = {
    _initPromise: Zotero.Promise.defer(),
  };
  const win = Zotero.getMainWindow().openDialog(
    `chrome://${config.addonRef}/content/batch-stats.xhtml`,
    STATS_WINDOW_NAME,
    "chrome,centerscreen,resizable,status,dialog=no,width=760,height=700",
    windowArgs,
  );
  if (!win) return;

  await windowArgs._initPromise.promise;
  statsWindow = win;
  initializeStatsWindow(win);
  refreshStatsWindowUI();
  if (!statsData) {
    await refreshStatsData();
  }
}

function initializeStatsWindow(win: Window) {
  const closeButton = win.document.getElementById("batch-stats-close");
  const importAllButton = win.document.getElementById("batch-stats-import-all");
  const refreshButton = win.document.getElementById("batch-stats-refresh");

  if (refreshButton) {
    refreshButton.setAttribute("title", getString("batch-stats-refresh"));
    refreshButton.setAttribute("aria-label", getString("batch-stats-refresh"));
  }
  if (closeButton) {
    closeButton.setAttribute("title", getString("batch-stats-close"));
    closeButton.setAttribute("aria-label", getString("batch-stats-close"));
  }

  closeButton?.addEventListener("click", () => {
    win.close();
  });
  importAllButton?.addEventListener("click", () => {
    void onImportAllUnparsedFromStats();
  });
  refreshButton?.addEventListener("click", () => {
    void refreshStatsData();
  });

  win.addEventListener("unload", () => {
    if (statsWindow === win) {
      statsWindow = undefined;
    }
  });
}

async function refreshStatsData() {
  const libraryID = getCurrentLibraryID();
  if (!libraryID) {
    getMessageWindow().alert(getString("batch-stats-error-no-library"));
    return;
  }

  statsLoading = true;
  statsScanProgress = null;
  refreshStatsWindowUI();
  safeRefreshBatchWindowUI();
  await Zotero.Promise.delay(0);
  try {
    statsData = await scanLibraryUnparsedStats(libraryID, (progress) => {
      statsScanProgress = progress;
      refreshStatsWindowUI();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    getMessageWindow().alert(
      `${getString("batch-stats-error-scan")}: ${message}`,
    );
  } finally {
    statsLoading = false;
    statsScanProgress = null;
    refreshStatsWindowUI();
    safeRefreshBatchWindowUI();
  }
}

function refreshStatsWindowUI() {
  const win = statsWindow;
  if (!isWindowAlive(win)) return;

  const loading = win.document.getElementById("batch-stats-loading");
  const content = win.document.getElementById("batch-stats-content");
  const refreshButton = win.document.getElementById(
    "batch-stats-refresh",
  ) as HTMLButtonElement | null;
  const importAllButton = win.document.getElementById(
    "batch-stats-import-all",
  ) as HTMLButtonElement | null;

  if (loading) {
    loading.textContent =
      statsLoading && statsScanProgress && statsScanProgress.total > 0
        ? getString("batch-stats-loading-progress", {
            args: {
              processed: statsScanProgress.processed,
              total: statsScanProgress.total,
              scanned: statsScanProgress.scannedRegular,
            },
          })
        : getString("batch-stats-loading");
    loading.toggleAttribute("hidden", !statsLoading);
  }
  if (content) {
    content.toggleAttribute("hidden", statsLoading || !statsData);
  }
  if (refreshButton) {
    refreshButton.disabled = statsLoading;
  }
  if (importAllButton) {
    importAllButton.disabled =
      !statsData || statsData.unparsed <= 0 || statsLoading;
  }

  if (!statsData || statsLoading) {
    return;
  }

  const parsedEl = win.document.getElementById("batch-stats-overall-parsed");
  const totalEl = win.document.getElementById("batch-stats-overall-total");
  const ratioEl = win.document.getElementById("batch-stats-overall-ratio");
  const progressEl = win.document.getElementById(
    "batch-stats-overall-progress",
  ) as HTMLProgressElement | null;
  const footnoteEl = win.document.getElementById("batch-stats-footnote");

  if (parsedEl) parsedEl.textContent = String(statsData.parsed);
  if (totalEl) totalEl.textContent = String(statsData.parseableTotal);
  if (ratioEl) ratioEl.textContent = `${statsData.percent.toFixed(1)}%`;
  if (progressEl) progressEl.value = Math.round(statsData.percent);
  if (footnoteEl) {
    footnoteEl.textContent = getString("batch-stats-footnote", {
      args: {
        scanned: statsData.scannedCount,
        duration: (statsData.durationMs / 1000).toFixed(1),
      },
    });
  }

  renderCategoryStats(win, statsData.categories);
}

async function onImportAllUnparsedFromStats() {
  if (!statsData) return;
  const candidates = statsData.categories.flatMap((entry) => entry.candidates);
  const summary = await importCandidatesToQueue(candidates);
  showImportSummary(summary);
  safeRefreshBatchWindowUI();
  refreshStatsWindowUI();
}

async function onImportCategoryUnparsed(stat: BatchCategoryStat) {
  const summary = await importCandidatesToQueue(stat.candidates);
  showImportSummary(summary);
  safeRefreshBatchWindowUI();
  refreshStatsWindowUI();
}

async function importCandidatesToQueue(candidates: UnparsedCandidate[]) {
  const summary = {
    added: 0,
    skippedNoPdf: 0,
    skippedParsed: 0,
    skippedDuplicate: 0,
    skippedInvalid: 0,
  };

  const existingParentIDs = new Set(tasks.map((task) => task.parentItemID));

  for (let index = 0; index < candidates.length; index += IMPORT_CHUNK_SIZE) {
    const chunk = candidates.slice(index, index + IMPORT_CHUNK_SIZE);
    const itemIDs = new Set<number>();
    for (const candidate of chunk) {
      itemIDs.add(candidate.parentItemID);
      itemIDs.add(candidate.pdfAttachmentID);
    }
    const items = (await Zotero.Items.getAsync([...itemIDs])) as Zotero.Item[];
    const itemByID = new Map(items.map((item) => [item.id, item]));

    for (const candidate of chunk) {
      if (existingParentIDs.has(candidate.parentItemID)) {
        summary.skippedDuplicate++;
        continue;
      }

      const parentItem = itemByID.get(candidate.parentItemID);
      const pdfAttachment = itemByID.get(candidate.pdfAttachmentID);
      if (
        !parentItem?.isRegularItem() ||
        !pdfAttachment?.isAttachment() ||
        !pdfAttachment.isPDFAttachment()
      ) {
        summary.skippedInvalid++;
        continue;
      }

      tasks.push(createBatchTaskFromCandidate(candidate));
      existingParentIDs.add(candidate.parentItemID);
      summary.added++;
    }

    await Zotero.Promise.delay(0);
  }

  filteredTasksDirty = true;
  return summary;
}

function showImportSummary(summary: {
  added: number;
  skippedNoPdf: number;
  skippedParsed: number;
  skippedDuplicate: number;
  skippedInvalid: number;
}) {
  getMessageWindow().alert(
    getString("batch-import-summary", {
      args: {
        added: summary.added,
        noPdf: summary.skippedNoPdf,
        parsed: summary.skippedParsed,
        duplicate: summary.skippedDuplicate,
        invalid: summary.skippedInvalid,
      },
    }),
  );
}

function renderCategoryStats(win: Window, categories: BatchCategoryStat[]) {
  const list = win.document.getElementById("batch-stats-list");
  if (!list) return;
  list.innerHTML = "";

  for (const stat of categories) {
    const row = win.document.createElement("div");
    row.className = "batch-stats-row";

    const icon = win.document.createElement("button");
    icon.className = "batch-stats-icon";
    icon.textContent = CATEGORY_META[stat.key].icon;
    icon.disabled = stat.unparsed <= 0;
    icon.setAttribute("title", getString("batch-stats-import-unparsed"));
    icon.setAttribute("aria-label", getString("batch-stats-import-unparsed"));
    icon.addEventListener("click", () => {
      void onImportCategoryUnparsed(stat);
    });
    row.appendChild(icon);

    const info = win.document.createElement("div");
    info.className = "batch-stats-info";

    const title = win.document.createElement("div");
    title.className = "batch-stats-item-title";
    title.textContent = getString(CATEGORY_META[stat.key].labelKey);
    info.appendChild(title);

    const count = win.document.createElement("div");
    count.className = "batch-stats-count";
    count.textContent = getString("batch-stats-item-count", {
      args: { parsed: stat.parsed, unparsed: stat.unparsed },
    });
    info.appendChild(count);

    const progress = win.document.createElement("progress");
    progress.max = 100;
    progress.value = Math.round(stat.percent);
    progress.className = "batch-stats-progress";
    info.appendChild(progress);
    row.appendChild(info);

    const right = win.document.createElement("div");
    right.className = "batch-stats-right";

    const percent = win.document.createElement("div");
    percent.className = "batch-stats-percent";
    percent.textContent = `${stat.percent.toFixed(1)}%`;
    right.appendChild(percent);

    row.appendChild(right);
    list.appendChild(row);
  }
}

function getCurrentLibraryID(): number {
  const pane =
    Zotero.getMainWindow().ZoteroPane || Zotero.getActiveZoteroPane();
  const selectedLibraryID = Number((pane as any)?.getSelectedLibraryID?.());
  if (Number.isFinite(selectedLibraryID) && selectedLibraryID > 0) {
    return selectedLibraryID;
  }
  return Number((Zotero as any).Libraries?.userLibraryID || 1);
}

function refreshUI() {
  const win = batchWindow;
  if (!isWindowAlive(win)) return;

  filteredTasksDirty = true;
  updateHeader(win);
  updateFilterLabels(win);
  updateFilterState(win);
  updateButtons(win);
  tableHelper?.render();
  updateEmptyState(win);
}

function refreshSelectionUI() {
  const win = batchWindow;
  if (!isWindowAlive(win)) return;
  updateButtons(win);
}

function updateHeader(win: Window) {
  const overallProgress = win.document.getElementById(
    "batch-overall-progress",
  ) as HTMLProgressElement | null;
  const summary = win.document.getElementById("batch-summary");
  if (!overallProgress || !summary) return;

  const total = tasks.length;
  const done = tasks.filter((task) => task.status === "success").length;
  const running = tasks.filter((task) => task.status === "running").length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  overallProgress.value = progress;
  summary.textContent = getString("batch-summary", {
    args: { done, total, running },
  });
}

function updateFilterLabels(win: Window) {
  const counts = getFilterCounts();
  setFilterButtonText(win, "all", getString("batch-filter-all"), counts.all);
  setFilterButtonText(
    win,
    "queued",
    getString("batch-filter-queued"),
    counts.queued,
  );
  setFilterButtonText(
    win,
    "running",
    getString("batch-filter-running"),
    counts.running,
  );
  setFilterButtonText(
    win,
    "success",
    getString("batch-filter-success"),
    counts.success,
  );
  setFilterButtonText(
    win,
    "failed",
    getString("batch-filter-failed"),
    counts.failed,
  );
  setFilterButtonText(
    win,
    "stopped",
    getString("batch-filter-stopped"),
    counts.stopped,
  );
}

function setFilterButtonText(
  win: Window,
  filter: BatchFilter,
  label: string,
  count: number,
) {
  const button = win.document.querySelector<HTMLElement>(
    `[data-batch-filter="${filter}"]`,
  );
  if (!button) return;
  button.textContent = `${label} ${count}`;
}

function updateFilterState(win: Window) {
  const buttons = win.document.querySelectorAll<HTMLElement>(
    "[data-batch-filter]",
  );
  for (const button of buttons) {
    const isActive = button.dataset.batchFilter === activeFilter;
    button.classList.toggle("active", isActive);
  }
}

function updateButtons(win: Window) {
  const startSelectedButton = win.document.getElementById(
    "batch-start-selected",
  ) as HTMLButtonElement | null;
  const startButton = win.document.getElementById(
    "batch-start-all",
  ) as HTMLButtonElement | null;
  const stopButton = win.document.getElementById(
    "batch-stop-all",
  ) as HTMLButtonElement | null;
  const clearButton = win.document.getElementById(
    "batch-clear-finished",
  ) as HTMLButtonElement | null;

  if (startSelectedButton) {
    startSelectedButton.disabled = !getSelectedTasks().some(
      (task) =>
        task.status === "queued" ||
        task.status === "failed" ||
        task.status === "stopped",
    );
  }
  if (startButton) {
    startButton.disabled = !tasks.some((task) => task.status === "queued");
  }
  if (stopButton) {
    stopButton.disabled = !tasks.some(
      (task) => task.status === "queued" || task.status === "running",
    );
  }
  if (clearButton) {
    clearButton.disabled = !tasks.some((task) => isTerminalStatus(task.status));
  }
}

function updateEmptyState(win: Window) {
  const empty = win.document.getElementById("batch-empty");
  if (!empty) return;
  empty.textContent = getString("batch-empty");
  empty.toggleAttribute("hidden", getFilteredTasks().length > 0);
}

function getFilteredTasks(): BatchTask[] {
  if (!filteredTasksDirty) {
    return filteredTasksCache;
  }
  filteredTasksCache =
    activeFilter === "all"
      ? tasks
      : tasks.filter((task) => task.status === activeFilter);
  filteredTasksDirty = false;
  return filteredTasksCache;
}

function getSelectedTasks(): BatchTask[] {
  const filtered = getFilteredTasks();
  if (!tableSelection?.isSelected) return [];
  const selected: BatchTask[] = [];
  for (let index = 0; index < filtered.length; index++) {
    if (tableSelection.isSelected(index)) {
      selected.push(filtered[index]);
    }
  }
  return selected;
}

function getFilterCounts() {
  return {
    all: tasks.length,
    queued: tasks.filter((task) => task.status === "queued").length,
    running: tasks.filter((task) => task.status === "running").length,
    success: tasks.filter((task) => task.status === "success").length,
    failed: tasks.filter((task) => task.status === "failed").length,
    stopped: tasks.filter((task) => task.status === "stopped").length,
  };
}

function getStatusDisplay(task: BatchTask): string {
  if (task.status === "running" && task.statusText === "stopping") {
    return getString("batch-status-stopping");
  }
  switch (task.status) {
    case "queued":
      return getString("batch-status-queued");
    case "running":
      return getString("batch-status-running");
    case "success":
      return getString("batch-status-success");
    case "failed":
      return getString("batch-status-failed");
    case "stopped":
      return getString("batch-status-stopped");
    default:
      return task.status;
  }
}

function formatDuration(durationMs?: number): string {
  if (!durationMs || durationMs <= 0) return "-";
  return `${Math.round(durationMs / 1000)}s`;
}

function isTerminalStatus(status: BatchTaskStatus): boolean {
  return status === "success" || status === "failed" || status === "stopped";
}

function getConcurrency(): number {
  return normalizeConcurrency(Number(getPref("batch_parse_concurrency")));
}

function normalizeConcurrency(value: number): number {
  if (!Number.isFinite(value)) return CONCURRENCY_DEFAULT;
  const rounded = Math.round(value);
  return Math.max(CONCURRENCY_MIN, Math.min(CONCURRENCY_MAX, rounded));
}

function openNote(noteID: number) {
  const pane = Zotero.getActiveZoteroPane();
  pane?.selectItem(noteID);
}

function locateTaskItem(task: BatchTask) {
  const parentItem = Zotero.Items.get(task.parentItemID);
  if (!parentItem) return;
  const pane =
    Zotero.getMainWindow().ZoteroPane || Zotero.getActiveZoteroPane();
  pane?.selectItem(parentItem.id);
}

function toRowData(task: BatchTask | undefined) {
  if (!task) {
    return {
      progress: "0%",
      title: "",
      status: "",
      duration: "",
      actions: "",
    };
  }
  return {
    progress: `${task.progress}%`,
    title: task.title,
    status: getStatusDisplay(task),
    duration: formatDuration(task.durationMs),
    actions: "",
  };
}

function getMessageWindow(): Window {
  if (isWindowAlive(statsWindow)) return statsWindow;
  if (isWindowAlive(batchWindow)) return batchWindow;
  return Zotero.getMainWindow();
}

function isWindowAlive(win?: Window): win is Window {
  return Boolean(win && !Components.utils.isDeadWrapper(win) && !win.closed);
}
