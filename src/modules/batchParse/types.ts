export type BatchTaskStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "stopped";

export type BatchFilter = BatchTaskStatus | "all";

export type BatchTask = {
  id: string;
  parentItemID: number;
  parentItemKey: string;
  title: string;
  pdfAttachmentID: number;
  status: BatchTaskStatus;
  statusText: string;
  progress: number;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  noteID?: number;
  errorMessage?: string;
  cancelRequested?: boolean;
};

export type DetectSummary = {
  added: number;
  skippedNoPdf: number;
  skippedParsed: number;
  skippedDuplicate: number;
  skippedInvalid: number;
};

export type DetectResult = {
  tasks: BatchTask[];
  summary: DetectSummary;
};

export type BatchCategoryKey =
  | "journal"
  | "conference"
  | "thesis"
  | "book"
  | "other";

export type UnparsedCandidate = {
  parentItemID: number;
  parentItemKey: string;
  title: string;
  pdfAttachmentID: number;
  category: BatchCategoryKey;
};

export type BatchCategoryStat = {
  key: BatchCategoryKey;
  parsed: number;
  unparsed: number;
  total: number;
  percent: number;
  candidates: UnparsedCandidate[];
};

export type BatchLibraryStats = {
  libraryID: number;
  scannedCount: number;
  parseableTotal: number;
  parsed: number;
  unparsed: number;
  percent: number;
  durationMs: number;
  categories: BatchCategoryStat[];
};

export type BatchStatsScanProgress = {
  processed: number;
  total: number;
  scannedRegular: number;
};
