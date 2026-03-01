import { MINERU_NOTE_TAG, parseItem } from "../parse";
import type { BatchTask } from "./types";

type BatchQueueOptions = {
  getConcurrency: () => number;
  onTaskChange: () => void;
};

export class BatchQueue {
  private runningCount = 0;
  private stopRequested = false;
  private sessionID = 0;

  constructor(private readonly options: BatchQueueOptions) {}

  start(tasks: BatchTask[]) {
    const sessionID = this.ensureSession();
    this.pump(tasks, sessionID);
  }

  startTask(task: BatchTask, tasks: BatchTask[]) {
    if (task.status === "running" || task.status === "success") {
      return;
    }
    if (task.status === "failed" || task.status === "stopped") {
      this.retry(task);
    }
    const sessionID = this.ensureSession();
    this.pump(tasks, sessionID);
  }

  stopAll(tasks: BatchTask[]) {
    this.stopRequested = true;

    for (const task of tasks) {
      if (task.status === "queued") {
        task.status = "stopped";
        task.statusText = "";
        task.progress = 0;
      } else if (task.status === "running") {
        task.cancelRequested = true;
        task.statusText = "stopping";
      }
    }
    this.options.onTaskChange();
  }

  retry(task: BatchTask) {
    if (task.status !== "failed" && task.status !== "stopped") {
      return;
    }
    task.status = "queued";
    task.statusText = "";
    task.progress = 0;
    task.startedAt = undefined;
    task.endedAt = undefined;
    task.durationMs = undefined;
    task.errorMessage = undefined;
    task.noteID = undefined;
    task.cancelRequested = false;
    this.options.onTaskChange();
  }

  stopTask(task: BatchTask) {
    if (task.status === "queued") {
      task.status = "stopped";
      task.statusText = "";
      task.progress = 0;
      this.options.onTaskChange();
      return;
    }

    if (task.status === "running") {
      task.cancelRequested = true;
      task.statusText = "stopping";
      this.options.onTaskChange();
    }
  }

  reset() {
    this.stopRequested = true;
    this.sessionID += 1;
    this.runningCount = 0;
  }

  private ensureSession(): number {
    if (this.sessionID === 0 || this.stopRequested) {
      this.stopRequested = false;
      this.sessionID += 1;
      this.runningCount = 0;
    }
    return this.sessionID;
  }

  private pump(tasks: BatchTask[], sessionID: number) {
    if (sessionID !== this.sessionID) return;
    const maxConcurrency = Math.max(
      1,
      Math.floor(this.options.getConcurrency()),
    );
    while (
      sessionID === this.sessionID &&
      !this.stopRequested &&
      this.runningCount < maxConcurrency
    ) {
      const next = tasks.find((task) => task.status === "queued");
      if (!next) break;
      void this.runTask(next, tasks, sessionID);
    }
  }

  private async runTask(
    task: BatchTask,
    tasks: BatchTask[],
    sessionID: number,
  ) {
    if (sessionID !== this.sessionID) return;
    this.runningCount += 1;
    task.status = "running";
    task.statusText = "running";
    task.progress = Math.max(1, task.progress || 0);
    task.cancelRequested = false;
    task.startedAt = Date.now();
    task.endedAt = undefined;
    task.durationMs = undefined;
    this.options.onTaskChange();

    try {
      const parentItem = Zotero.Items.get(task.parentItemID);
      const pdfAttachment = Zotero.Items.get(task.pdfAttachmentID);
      if (!parentItem?.isRegularItem() || !pdfAttachment?.isPDFAttachment()) {
        throw new Error("invalid_task_item");
      }

      await parseItem(
        parentItem,
        pdfAttachment,
        {},
        {
          onStatusChange: (status, text) => {
            if (sessionID !== this.sessionID) return;
            task.statusText = status || text || "";
            this.options.onTaskChange();
          },
          onProgress: (progress) => {
            if (sessionID !== this.sessionID) return;
            task.progress = clampProgress(progress);
            this.options.onTaskChange();
          },
          shouldCancel: () =>
            sessionID !== this.sessionID ||
            this.stopRequested ||
            Boolean(task.cancelRequested),
        },
      );

      task.status = "success";
      task.statusText = "success";
      task.progress = 100;
      const latestNote = findLatestMineruNote(parentItem);
      task.noteID = latestNote?.id;
    } catch (error) {
      const message = normalizeErrorMessage(error);
      task.errorMessage = message;
      if (isCancelError(message)) {
        task.status = "stopped";
        task.statusText = "stopped";
      } else {
        task.status = "failed";
        task.statusText = "failed";
      }
      task.progress = task.status === "failed" ? Math.max(task.progress, 1) : 0;
    } finally {
      if (sessionID === this.sessionID) {
        task.endedAt = Date.now();
        task.durationMs = Math.max(
          0,
          task.endedAt - (task.startedAt || task.endedAt),
        );
        this.runningCount = Math.max(0, this.runningCount - 1);
        this.options.onTaskChange();
        this.pump(tasks, sessionID);
      }
    }
  }
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, Math.round(progress)));
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || "Unknown error";
  if (typeof error === "string") return error;
  return "Unknown error";
}

function isCancelError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    message.includes("已取消") ||
    lower.includes("canceled") ||
    lower.includes("cancelled")
  );
}

function findLatestMineruNote(parentItem: Zotero.Item): Zotero.Item | null {
  const notes = parentItem
    .getNotes()
    .map((id) => Zotero.Items.get(id))
    .filter(
      (note): note is Zotero.Item =>
        Boolean(note?.isNote()) &&
        note!.getTags().some((tag) => tag.tag === MINERU_NOTE_TAG),
    )
    .sort((a, b) => getModifiedTime(b) - getModifiedTime(a));
  return notes[0] || null;
}

function getModifiedTime(item: Zotero.Item): number {
  const raw = item.dateModified || item.getField("dateModified");
  if (!raw) return 0;
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
