/** 单个队列条目的状态 */
export type BatchItemStatus =
  | "pending"
  | "uploading"
  | "queued"
  | "parsing"
  | "downloading"
  | "importing"
  | "done"
  | "error"
  | "skipped"
  | "cancelled";

/** 队列整体状态 */
export type QueueState = "idle" | "running" | "paused";

/** 单个队列条目 */
export type BatchItem = {
  id: string; // item.key
  zoteroItem: Zotero.Item;
  title: string;
  status: BatchItemStatus;
  progress: number; // 0-100
  statusText: string;
  error?: string;
  pdfAttachment?: Zotero.Item;
  hasParsedNote: boolean;
};

/** 队列事件回调 */
export type QueueEvents = {
  onItemUpdated: (id: string) => void;
  onQueueStateChanged: (state: QueueState) => void;
  onCompleted: (summary: BatchSummary) => void;
};

/** 批量完成摘要 */
export type BatchSummary = {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  cancelled: number;
  elapsed: number; // 毫秒
};
