import { config } from "../../package.json";
import { getPref } from "../utils/prefs";
import { parseItem, hasExistingParsedNote } from "./parse";

let observerID: string | false = false;
let queue: Zotero.Item[] = [];
let queuedParents = new Set<number>();
let processing = false;

function enqueueIfEligible(item: Zotero.Item) {
  if (!item.isAttachment() || !item.isPDFAttachment()) return;

  const parent = item.parentItem;
  if (!parent?.isRegularItem()) return;

  // Dedupe by parent — one parse per parent item
  if (queuedParents.has(parent.id)) return;
  if (hasExistingParsedNote(parent)) return;

  queuedParents.add(parent.id);
  queue.push(item);
}

export function registerAutoParseObserver() {
  if (observerID !== false) return;

  observerID = Zotero.Notifier.registerObserver(
    {
      notify: async (event: string, type: string, ids: (string | number)[]) => {
        if (type !== "item") return;
        if (event !== "add" && event !== "modify") return;
        if (!getPref("auto_parse")) return;

        for (const id of ids) {
          try {
            const item = Zotero.Items.get(id as number);
            if (!item) continue;
            enqueueIfEligible(item);
          } catch (e) {
            Zotero.debug(`[Mineru Parse] autoParse filter error: ${e}`);
          }
        }

        if (queue.length > 0 && !processing) {
          processQueue();
        }
      },
    },
    ["item"],
    `${config.addonRef}-auto-parse`,
  );

  Zotero.debug(`[Mineru Parse] Auto-parse observer registered: ${observerID}`);
}

export function unregisterAutoParseObserver() {
  if (observerID !== false) {
    Zotero.Notifier.unregisterObserver(observerID);
    observerID = false;
    queue = [];
    queuedParents = new Set();
    processing = false;
    Zotero.debug("[Mineru Parse] Auto-parse observer unregistered");
  }
}

async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;

  // Snapshot and clear queue
  const items = [...queue];
  queue = [];

  const total = items.length;
  let done = 0;

  const progress = new ztoolkit.ProgressWindow(config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: localeText(`自动解析：0/${total}`, `Auto parse: 0/${total}`),
      type: "default",
      progress: 0,
    })
    .show();

  for (const pdfAttachment of items) {
    const parent = pdfAttachment.parentItem;
    if (!parent) {
      done++;
      continue;
    }

    // Re-check: another item in queue may have already parsed this parent
    if (hasExistingParsedNote(parent)) {
      done++;
      updateProgress(progress, done, total);
      continue;
    }

    try {
      await parseItem(
        parent,
        pdfAttachment,
        {},
        {
          onStatusChange: (_status, text) => {
            progress.changeLine({
              text: localeText(
                `自动解析 ${done + 1}/${total}：${text}`,
                `Auto parse ${done + 1}/${total}: ${text}`,
              ),
            });
          },
          onProgress: (value) => {
            const overall = ((done + value / 100) / total) * 100;
            progress.changeLine({ progress: Math.round(overall) });
          },
        },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Zotero.debug(
        `[Mineru Parse] Auto-parse failed for "${parent.getField("title")}": ${msg}`,
      );
    }

    done++;
    updateProgress(progress, done, total);

    // Drain any items added while we were processing
    if (queue.length > 0) {
      items.push(...queue);
      queue = [];
    }
  }

  progress.changeLine({
    text: localeText(
      `自动解析完成：${done} 篇`,
      `Auto parse complete: ${done} items`,
    ),
    progress: 100,
  });
  progress.startCloseTimer?.(4000);

  queuedParents = new Set();
  processing = false;
}

function updateProgress(
  progress: ReturnType<
    InstanceType<typeof ztoolkit.ProgressWindow>["createLine"]
  >,
  done: number,
  total: number,
) {
  progress.changeLine({
    text: localeText(
      `自动解析：${done}/${total}`,
      `Auto parse: ${done}/${total}`,
    ),
    progress: Math.round((done / total) * 100),
  });
}

function localeText(zh: string, en: string): string {
  return String(Zotero.locale || "")
    .toLowerCase()
    .startsWith("zh")
    ? zh
    : en;
}
