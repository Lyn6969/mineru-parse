import {
  MINERU_NOTE_TAG,
  getItemTitle,
  isCancelError,
  parseItem,
} from "../parse";
import { getString } from "../../utils/locale";
import type { BatchTask } from "./types";

type BatchQueueOptions = {
  getConcurrency: () => number;
  onTaskChange: () => void;
  run?: (task: BatchTask) => Promise<{ noteID?: number }>;
};

export class BatchQueue {
  private readonly tasks = new Map<string, BatchTask>();
  private runningCount = 0;
  private stopRequested = false;
  private sessionID = 0;
  private largePdfDecision: "unset" | "allow_all" | "deny_all" = "unset";

  constructor(private readonly options: BatchQueueOptions) {}

  start(tasks: BatchTask[]) {
    this.syncTasks(tasks);
    this.largePdfDecision = "unset";
    const sessionID = this.ensureSession();
    this.pump(sessionID);
  }

  startTask(task: BatchTask, tasks: BatchTask[]) {
    this.syncTasks(tasks);
    if (task.status === "running" || task.status === "success") {
      return;
    }
    if (task.status === "failed" || task.status === "stopped") {
      this.retry(task);
    }
    const sessionID = this.ensureSession();
    this.pump(sessionID);
  }

  ensureRunning(tasks: BatchTask[]) {
    if (this.runningCount === 0 || this.stopRequested) return;
    this.syncTasks(tasks);
    this.pump(this.sessionID);
  }

  stopAll(tasks: BatchTask[]) {
    this.syncTasks(tasks);
    this.stopRequested = true;

    for (const task of this.tasks.values()) {
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
    this.largePdfDecision = "unset";
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
    this.tasks.clear();
    this.largePdfDecision = "unset";
  }

  private syncTasks(tasks: BatchTask[]) {
    for (const task of tasks) {
      this.tasks.set(task.id, task);
    }
  }

  private ensureSession(): number {
    if (this.sessionID === 0 || this.stopRequested) {
      this.stopRequested = false;
      this.sessionID += 1;
      this.largePdfDecision = "unset";
    }
    return this.sessionID;
  }

  private pump(sessionID: number) {
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
      const next = [...this.tasks.values()].find(
        (task) => task.status === "queued",
      );
      if (!next) break;
      void this.runTask(next, sessionID);
    }
  }

  private async runTask(task: BatchTask, sessionID: number) {
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
      const result = await this.executeTask(task, sessionID);
      task.status = "success";
      task.statusText = "success";
      task.progress = 100;
      task.noteID = result.noteID;
    } catch (error) {
      const message = normalizeErrorMessage(error);
      task.errorMessage = message;
      if (isCancelError(error)) {
        task.status = "stopped";
        task.statusText = "stopped";
      } else {
        task.status = "failed";
        task.statusText = "failed";
      }
      task.progress = task.status === "failed" ? Math.max(task.progress, 1) : 0;
    } finally {
      this.runningCount = Math.max(0, this.runningCount - 1);
      if (sessionID === this.sessionID) {
        task.endedAt = Date.now();
        task.durationMs = Math.max(
          0,
          task.endedAt - (task.startedAt || task.endedAt),
        );
        this.options.onTaskChange();
      }
      this.pump(this.sessionID);
    }
  }

  private async executeTask(
    task: BatchTask,
    sessionID: number,
  ): Promise<{ noteID?: number }> {
    if (this.options.run) {
      return this.options.run(task);
    }

    const parentItem = Zotero.Items.get(task.parentItemID);
    const pdfAttachment = Zotero.Items.get(task.pdfAttachmentID);
    if (
      !parentItem ||
      !pdfAttachment ||
      !parentItem.isRegularItem() ||
      !pdfAttachment.isPDFAttachment()
    ) {
      throw new Error("invalid_task_item");
    }

    await parseItem(
      parentItem,
      pdfAttachment,
      { source: "batch" },
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
        confirmLargePdf: async ({ item, pageCount, threshold }) => {
          if (
            sessionID !== this.sessionID ||
            this.stopRequested ||
            task.cancelRequested
          ) {
            return false;
          }
          if (this.largePdfDecision === "allow_all") {
            return true;
          }
          if (this.largePdfDecision === "deny_all") {
            return false;
          }

          const confirmed = Zotero.getMainWindow().confirm(
            getString("large-pdf-confirm-batch-body", {
              args: {
                title: getItemTitle(item),
                pages: pageCount,
                threshold,
              },
            }),
          );
          this.largePdfDecision = confirmed ? "allow_all" : "deny_all";
          return confirmed;
        },
      },
    );

    const latestNote = findLatestMineruNote(parentItem);
    return { noteID: latestNote?.id };
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

function findLatestMineruNote(parentItem: Zotero.Item): Zotero.Item | null {
  const notes = parentItem
    .getNotes()
    .map((id) => Zotero.Items.get(id))
    .filter((note): note is Zotero.Item => {
      if (!note || !note.isNote()) return false;
      return note
        .getTags()
        .some(
          (tag: { tag: string; type?: number }) => tag.tag === MINERU_NOTE_TAG,
        );
    })
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
