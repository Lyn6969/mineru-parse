import { config } from "../../package.json";
import { getPref } from "../utils/prefs";
import { parseItem, hasExistingParsedNote } from "./parse";

let observerID: string | false = false;
const activeParents = new Set<number>();

export function registerAutoParseObserver() {
  if (observerID !== false) return;

  observerID = Zotero.Notifier.registerObserver(
    {
      notify: (event: string, type: string, ids: (string | number)[]) => {
        if (type !== "item") return;
        if (event !== "add") return;
        if (!getPref("auto_parse")) return;

        for (const id of ids) {
          try {
            const item = Zotero.Items.get(id as number);
            if (!item?.isAttachment() || !item.isPDFAttachment()) continue;

            const parent = item.parentItem;
            if (!parent?.isRegularItem()) continue;
            if (activeParents.has(parent.id)) continue;
            if (hasExistingParsedNote(parent)) continue;

            // Fire and forget — each PDF parses independently
            startAutoParse(parent, item);
          } catch (e) {
            Zotero.debug(`[Mineru Parse] autoParse filter error: ${e}`);
          }
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
    activeParents.clear();
    Zotero.debug("[Mineru Parse] Auto-parse observer unregistered");
  }
}

async function startAutoParse(parent: Zotero.Item, pdfAttachment: Zotero.Item) {
  activeParents.add(parent.id);
  const title = String(parent.getField("title") || "");
  const short = title.length > 30 ? title.slice(0, 30) + "…" : title;

  const progress = new ztoolkit.ProgressWindow(config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: localeText(`自动解析：${short}`, `Auto parse: ${short}`),
      type: "default",
      progress: 0,
    })
    .show();

  try {
    await parseItem(
      parent,
      pdfAttachment,
      {},
      {
        onStatusChange: (_status, text) => {
          progress.changeLine({ text: `${short} — ${text}` });
        },
        onProgress: (value) => {
          progress.changeLine({ progress: value });
        },
      },
    );

    progress.changeLine({
      text: localeText(`自动解析完成：${short}`, `Auto parse done: ${short}`),
      progress: 100,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Zotero.debug(`[Mineru Parse] Auto-parse failed for "${title}": ${msg}`);
    progress.changeLine({
      text: localeText(`自动解析失败：${short}`, `Auto parse failed: ${short}`),
      progress: 100,
    });
  }

  progress.startCloseTimer?.(4000);
  activeParents.delete(parent.id);
}

function localeText(zh: string, en: string): string {
  return String(Zotero.locale || "")
    .toLowerCase()
    .startsWith("zh")
    ? zh
    : en;
}
