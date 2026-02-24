import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import {
  parseItem,
  getPdfAttachmentForItem,
  hasExistingParsedNote,
} from "../parse";
import type {
  BatchItem,
  BatchItemStatus,
  QueueState,
  QueueEvents,
  BatchSummary,
} from "./batchTypes";

export class BatchQueue {
  private items = new Map<string, BatchItem>();
  private orderedKeys: string[] = [];
  private itemsCache: BatchItem[] = [];
  private itemsDirty = true;
  private state: QueueState = "idle";
  private events: QueueEvents;
  private cancelFlag = false;
  private pauseFlag = false;

  constructor(events: QueueEvents) {
    this.events = events;
  }

  // ---- 条目管理 ----

  addItem(zoteroItem: Zotero.Item, silent = false): boolean {
    const key = zoteroItem.key;
    if (this.items.has(key)) return false;
    if (!zoteroItem.isRegularItem()) return false;

    const title = String(zoteroItem.getField("title") || "") || `[${key}]`;
    const hasParsed = hasExistingParsedNote(zoteroItem);

    this.items.set(key, {
      id: key,
      zoteroItem,
      title,
      status: "pending",
      progress: 0,
      statusText: getString("batch-status-pending"),
      hasParsedNote: hasParsed,
    });
    this.orderedKeys.push(key);
    this.itemsDirty = true;
    if (!silent) {
      this.events.onItemUpdated(key);
    }
    return true;
  }

  addItems(items: Zotero.Item[]): number {
    let count = 0;
    for (const item of items) {
      if (this.addItem(item, true)) count++;
    }
    if (count > 0) {
      this.events.onItemUpdated("");
    }
    return count;
  }

  removeItem(id: string): void {
    const item = this.items.get(id);
    // 不允许移除正在处理中的条目
    if (
      item &&
      item.status !== "uploading" &&
      item.status !== "queued" &&
      item.status !== "parsing" &&
      item.status !== "downloading" &&
      item.status !== "importing"
    ) {
      this.items.delete(id);
      this.orderedKeys = this.orderedKeys.filter((k) => k !== id);
      this.itemsDirty = true;
    }
  }

  removeCompleted(): void {
    const toRemove = [...this.items.values()]
      .filter(
        (item) =>
          item.status === "done" ||
          item.status === "skipped" ||
          item.status === "cancelled",
      )
      .map((item) => item.id);
    if (toRemove.length === 0) return;
    for (const id of toRemove) {
      this.items.delete(id);
    }
    this.orderedKeys = this.orderedKeys.filter((k) => this.items.has(k));
    this.itemsDirty = true;
  }

  clear(): void {
    if (this.state === "running") return;
    this.items.clear();
    this.orderedKeys = [];
    this.itemsDirty = true;
  }

  hasItem(id: string): boolean {
    return this.items.has(id);
  }

  // ---- 扫描功能 ----

  async scanUnparsed(scope: "library" | "collection"): Promise<number> {
    let regularItems: Zotero.Item[] = [];

    if (scope === "collection") {
      const pane = Zotero.getActiveZoteroPane();
      const collection = (pane as any)?.getSelectedCollection?.();
      if (collection) {
        const childItems = collection.getChildItems() as Zotero.Item[];
        regularItems = childItems.filter((i: Zotero.Item) => i.isRegularItem());
      }
    } else {
      const libraryID = Zotero.Libraries.userLibraryID;
      const allItems = await Zotero.Items.getAll(libraryID);
      regularItems = (allItems as Zotero.Item[]).filter((i) =>
        i.isRegularItem(),
      );
    }

    // 快速同步过滤：跳过已在队列或已有解析笔记的条目
    const candidates = regularItems.filter(
      (item) => !this.hasItem(item.key) && !hasExistingParsedNote(item),
    );

    // 分批并发检查 PDF 附件（每批 20 条）
    const BATCH_SIZE = 20;
    let count = 0;
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (item) => {
          const pdf = await getPdfAttachmentForItem(item);
          return { item, pdf };
        }),
      );
      for (const { item, pdf } of results) {
        if (!pdf) continue;
        if (this.addItem(item, true)) {
          const batchItem = this.items.get(item.key);
          if (batchItem) batchItem.pdfAttachment = pdf;
          count++;
        }
      }
    }

    // 扫描完成后统一触发一次 UI 刷新
    if (count > 0) {
      this.itemsDirty = true;
      this.events.onItemUpdated("");
    }
    return count;
  }

  // ---- 队列控制 ----

  async start(): Promise<void> {
    if (this.state === "running") return;

    // 前置检查
    const token = String(getPref("token") || "").trim();
    if (!token) {
      throw new Error(getString("error-no-token"));
    }
    const betterNotes = (Zotero as any).BetterNotes;
    if (!betterNotes?.api?.convert?.md2html) {
      throw new Error(getString("error-better-notes-missing"));
    }

    this.state = "running";
    this.cancelFlag = false;
    this.pauseFlag = false;
    this.events.onQueueStateChanged("running");
    const startTime = Date.now();

    const pending = this.orderedKeys.filter(
      (k) => this.items.get(k)?.status === "pending",
    );

    for (const key of pending) {
      // 暂停等待
      while (this.pauseFlag && !this.cancelFlag) {
        await Zotero.Promise.delay(200);
      }
      if (this.cancelFlag) break;

      const item = this.items.get(key);
      if (!item) continue;

      try {
        // 获取 PDF 附件
        let pdf = item.pdfAttachment;
        if (!pdf) {
          pdf = (await getPdfAttachmentForItem(item.zoteroItem)) || undefined;
        }
        if (!pdf) {
          item.status = "skipped";
          item.statusText = getString("error-no-pdf");
          this.events.onItemUpdated(key);
          continue;
        }

        await parseItem(
          item.zoteroItem,
          pdf,
          { force: false },
          {
            onStatusChange: (status: string, text: string) => {
              item.status = status as BatchItemStatus;
              item.statusText = text;
              this.events.onItemUpdated(key);
            },
            onProgress: (progress: number) => {
              item.progress = progress;
              this.events.onItemUpdated(key);
            },
            shouldCancel: () => this.cancelFlag,
          },
        );

        item.status = "done";
        item.progress = 100;
        item.statusText = getString("batch-status-done");
      } catch (e) {
        item.status = "error";
        item.error = e instanceof Error ? e.message : String(e);
        item.statusText = `${getString("batch-status-error")}: ${item.error}`;
      }
      this.events.onItemUpdated(key);
    }

    // 标记被取消的剩余条目
    if (this.cancelFlag) {
      for (const key of this.orderedKeys) {
        const item = this.items.get(key);
        if (item && item.status === "pending") {
          item.status = "cancelled";
          item.statusText = getString("batch-status-cancelled");
          this.events.onItemUpdated(key);
        }
      }
    }

    this.state = "idle";
    this.events.onQueueStateChanged("idle");
    this.events.onCompleted(this.buildSummary(startTime));
  }

  pause(): void {
    if (this.state === "running") {
      this.pauseFlag = true;
      this.state = "paused";
      this.events.onQueueStateChanged("paused");
    }
  }

  resume(): void {
    if (this.state === "paused") {
      this.pauseFlag = false;
      this.state = "running";
      this.events.onQueueStateChanged("running");
    }
  }

  stop(): void {
    this.cancelFlag = true;
    this.pauseFlag = false;
    if (this.state === "paused") {
      // 暂停状态直接转为 idle（循环会检测到 cancelFlag）
      this.state = "idle";
      this.events.onQueueStateChanged("idle");
    }
  }

  // ---- 查询 ----

  getItems(): BatchItem[] {
    if (this.itemsDirty) {
      this.itemsCache = this.orderedKeys
        .map((k) => this.items.get(k))
        .filter(Boolean) as BatchItem[];
      this.itemsDirty = false;
    }
    return this.itemsCache;
  }

  getItem(id: string): BatchItem | undefined {
    return this.items.get(id);
  }

  getState(): QueueState {
    return this.state;
  }

  getCount(): number {
    return this.orderedKeys.length;
  }

  getStats(): {
    total: number;
    pending: number;
    done: number;
    error: number;
    running: number;
  } {
    let pending = 0;
    let done = 0;
    let error = 0;
    let running = 0;
    for (const item of this.items.values()) {
      switch (item.status) {
        case "pending":
          pending++;
          break;
        case "done":
        case "skipped":
        case "cancelled":
          done++;
          break;
        case "error":
          error++;
          break;
        default:
          running++;
      }
    }
    return { total: this.items.size, pending, done, error, running };
  }

  /** 重试所有失败的条目 */
  retryFailed(): void {
    let changed = false;
    for (const item of this.items.values()) {
      if (item.status === "error") {
        item.status = "pending";
        item.progress = 0;
        item.error = undefined;
        item.statusText = getString("batch-status-pending");
        changed = true;
      }
    }
    if (changed) {
      this.itemsDirty = true;
      this.events.onItemUpdated("");
    }
  }

  private buildSummary(startTime: number): BatchSummary {
    let success = 0;
    let failed = 0;
    let skipped = 0;
    let cancelled = 0;
    for (const item of this.items.values()) {
      switch (item.status) {
        case "done":
          success++;
          break;
        case "error":
          failed++;
          break;
        case "skipped":
          skipped++;
          break;
        case "cancelled":
          cancelled++;
          break;
      }
    }
    return {
      total: this.items.size,
      success,
      failed,
      skipped,
      cancelled,
      elapsed: Date.now() - startTime,
    };
  }
}
