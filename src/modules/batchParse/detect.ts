import {
  MINERU_NOTE_TAG,
  getPdfAttachmentForItem,
  hasExistingParsedNote,
  getItemTitle,
} from "../parse";
import type {
  BatchCategoryKey,
  BatchCategoryStat,
  BatchLibraryStats,
  BatchStatsScanProgress,
  BatchTask,
  DetectResult,
  UnparsedCandidate,
} from "./types";

type CreateTaskParams = {
  parent: Zotero.Item;
  pdfAttachment: Zotero.Item;
};

const CATEGORY_KEYS: BatchCategoryKey[] = [
  "journal",
  "conference",
  "thesis",
  "book",
  "other",
];

const SEARCH_CHUNK_SIZE = 400;
const CHUNK_YIELD_INTERVAL = 2;
const PDF_MIME_TYPE = "application/pdf";

export async function detectBatchTasksFromSelection(
  existingTasks: BatchTask[],
): Promise<DetectResult> {
  const result: DetectResult = {
    tasks: [],
    summary: {
      added: 0,
      skippedNoPdf: 0,
      skippedParsed: 0,
      skippedDuplicate: 0,
      skippedInvalid: 0,
    },
  };

  const pane = Zotero.getActiveZoteroPane();
  const selected = pane?.getSelectedItems() || [];
  if (!selected.length) {
    return result;
  }

  const parents = normalizeSelectedToParents(selected);
  const existingParentIDs = new Set(
    existingTasks.map((task) => task.parentItemID),
  );

  for (const parent of parents) {
    if (!parent?.isRegularItem()) {
      result.summary.skippedInvalid++;
      continue;
    }

    if (existingParentIDs.has(parent.id)) {
      result.summary.skippedDuplicate++;
      continue;
    }

    const pdfAttachment = await getPdfAttachmentForItem(parent);
    if (!pdfAttachment) {
      result.summary.skippedNoPdf++;
      continue;
    }

    if (hasExistingParsedNote(parent)) {
      result.summary.skippedParsed++;
      continue;
    }

    result.tasks.push(createBatchTask({ parent, pdfAttachment }));
    existingParentIDs.add(parent.id);
    result.summary.added++;
  }

  return result;
}

export async function scanLibraryUnparsedStats(
  libraryID: number,
  onProgress?: (progress: BatchStatsScanProgress) => void,
): Promise<BatchLibraryStats> {
  const startedAt = Date.now();

  if (onProgress) {
    onProgress({ processed: 0, total: 0, scannedRegular: 0 });
  }

  const {
    parentToPdfAttachmentID,
    processedAttachmentCount,
    parseableParentCount,
  } = await collectPdfAttachmentMap(libraryID, onProgress);
  const parsedParentIDs = await collectParsedParentIDs(libraryID);
  const parseableParentIDs = [...parentToPdfAttachmentID.keys()];

  const totalProgress = processedAttachmentCount + parseableParentCount;
  let processedParents = 0;

  const categories = new Map<BatchCategoryKey, BatchCategoryStat>(
    CATEGORY_KEYS.map((key) => [
      key,
      { key, parsed: 0, unparsed: 0, total: 0, percent: 0, candidates: [] },
    ]),
  );

  let parseableTotal = 0;
  let parsed = 0;
  let unparsed = 0;

  let chunkIndex = 0;
  for (
    let index = 0;
    index < parseableParentIDs.length;
    index += SEARCH_CHUNK_SIZE
  ) {
    const chunkIDs = parseableParentIDs.slice(index, index + SEARCH_CHUNK_SIZE);
    const parents = (await Zotero.Items.getAsync(chunkIDs)) as Zotero.Item[];

    for (const parent of parents) {
      if (!parent?.isRegularItem() || parent.libraryID !== libraryID) {
        continue;
      }

      const pdfAttachmentID = parentToPdfAttachmentID.get(parent.id);
      if (!pdfAttachmentID) continue;

      const category = resolveCategory(parent.itemType || "");
      const stat = categories.get(category)!;
      stat.total++;
      parseableTotal++;

      if (parsedParentIDs.has(parent.id)) {
        stat.parsed++;
        parsed++;
        continue;
      }

      stat.unparsed++;
      unparsed++;
      stat.candidates.push({
        parentItemID: parent.id,
        parentItemKey: parent.key,
        title: getItemTitle(parent),
        pdfAttachmentID,
        category,
      });
    }

    processedParents += chunkIDs.length;
    if (onProgress) {
      onProgress({
        processed: processedAttachmentCount + processedParents,
        total: totalProgress,
        scannedRegular: processedParents,
      });
    }
    chunkIndex++;
    if (chunkIndex % CHUNK_YIELD_INTERVAL === 0) {
      await Zotero.Promise.delay(0);
    }
  }

  for (const stat of categories.values()) {
    stat.percent = stat.total > 0 ? (stat.parsed / stat.total) * 100 : 0;
  }

  return {
    libraryID,
    scannedCount: parseableParentCount,
    parseableTotal,
    parsed,
    unparsed,
    percent: parseableTotal > 0 ? (parsed / parseableTotal) * 100 : 0,
    durationMs: Date.now() - startedAt,
    categories: CATEGORY_KEYS.map((key) => categories.get(key)!),
  };
}

export function createBatchTaskFromCandidate(
  candidate: UnparsedCandidate,
): BatchTask {
  return {
    id: `${candidate.parentItemID}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    parentItemID: candidate.parentItemID,
    parentItemKey: candidate.parentItemKey,
    title: candidate.title,
    pdfAttachmentID: candidate.pdfAttachmentID,
    status: "queued",
    statusText: "",
    progress: 0,
    cancelRequested: false,
  };
}

function normalizeSelectedToParents(items: Zotero.Item[]): Zotero.Item[] {
  const parentsByID = new Map<number, Zotero.Item>();

  for (const item of items) {
    if (!item) continue;

    if (item.isRegularItem()) {
      parentsByID.set(item.id, item);
      continue;
    }

    if (
      (item.isAttachment() || item.isNote()) &&
      item.parentItem?.isRegularItem()
    ) {
      parentsByID.set(item.parentItem.id, item.parentItem);
    }
  }

  return [...parentsByID.values()];
}

function createBatchTask({
  parent,
  pdfAttachment,
}: CreateTaskParams): BatchTask {
  return createBatchTaskFromCandidate({
    parentItemID: parent.id,
    parentItemKey: parent.key,
    title: getItemTitle(parent),
    pdfAttachmentID: pdfAttachment.id,
    category: resolveCategory(parent.itemType || ""),
  });
}

function resolveCategory(itemType: string): BatchCategoryKey {
  switch (itemType) {
    case "journalArticle":
      return "journal";
    case "conferencePaper":
      return "conference";
    case "thesis":
      return "thesis";
    case "book":
    case "bookSection":
      return "book";
    default:
      return "other";
  }
}

function normalizeSearchResultIDs(ids: unknown): number[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is number => Number.isFinite(id as number));
}

async function collectPdfAttachmentMap(
  libraryID: number,
  onProgress?: (progress: BatchStatsScanProgress) => void,
): Promise<{
  parentToPdfAttachmentID: Map<number, number>;
  processedAttachmentCount: number;
  parseableParentCount: number;
}> {
  const pdfFileTypeID = await Zotero.FileTypes.getIDFromMIMEType(PDF_MIME_TYPE);
  const search = new Zotero.Search({ libraryID });
  search.addCondition("itemType", "is", "attachment");
  search.addCondition("fileTypeID", "is", String(pdfFileTypeID));
  search.addCondition("deleted", "false");

  const pdfAttachmentIDs = normalizeSearchResultIDs(await search.search());
  const total = pdfAttachmentIDs.length;
  const parentToPdfAttachmentID = new Map<number, number>();
  let processed = 0;
  let chunkIndex = 0;

  if (onProgress) {
    onProgress({ processed: 0, total, scannedRegular: 0 });
  }

  for (
    let index = 0;
    index < pdfAttachmentIDs.length;
    index += SEARCH_CHUNK_SIZE
  ) {
    const chunkIDs = pdfAttachmentIDs.slice(index, index + SEARCH_CHUNK_SIZE);
    const attachments = (await Zotero.Items.getAsync(
      chunkIDs,
    )) as Zotero.Item[];

    for (const attachment of attachments) {
      if (!attachment?.isAttachment() || !attachment.isPDFAttachment()) {
        continue;
      }
      const parent = attachment.parentItem;
      if (!parent?.isRegularItem() || parent.libraryID !== libraryID) {
        continue;
      }
      if (!parentToPdfAttachmentID.has(parent.id)) {
        parentToPdfAttachmentID.set(parent.id, attachment.id);
      }
    }

    processed += chunkIDs.length;
    if (onProgress) {
      onProgress({
        processed,
        total,
        scannedRegular: parentToPdfAttachmentID.size,
      });
    }
    chunkIndex++;
    if (chunkIndex % CHUNK_YIELD_INTERVAL === 0) {
      await Zotero.Promise.delay(0);
    }
  }

  return {
    parentToPdfAttachmentID,
    processedAttachmentCount: processed,
    parseableParentCount: parentToPdfAttachmentID.size,
  };
}

async function collectParsedParentIDs(libraryID: number): Promise<Set<number>> {
  const search = new Zotero.Search({ libraryID });
  search.addCondition("itemType", "is", "note");
  search.addCondition("tag", "is", MINERU_NOTE_TAG);
  search.addCondition("deleted", "false");

  const noteIDs = normalizeSearchResultIDs(await search.search());
  const parsedParentIDs = new Set<number>();
  let chunkIndex = 0;

  for (let index = 0; index < noteIDs.length; index += SEARCH_CHUNK_SIZE) {
    const chunkIDs = noteIDs.slice(index, index + SEARCH_CHUNK_SIZE);
    const notes = (await Zotero.Items.getAsync(chunkIDs)) as Zotero.Item[];
    for (const note of notes) {
      if (!note?.isNote()) continue;
      const parent = note.parentItem;
      if (!parent?.isRegularItem() || parent.libraryID !== libraryID) {
        continue;
      }
      parsedParentIDs.add(parent.id);
    }
    chunkIndex++;
    if (chunkIndex % CHUNK_YIELD_INTERVAL === 0) {
      await Zotero.Promise.delay(0);
    }
  }
  return parsedParentIDs;
}
