import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { parseItem } from "./parse";
import { suppressAutoParse, unsuppressAutoParse } from "./autoParse";

/**
 * 从配置的文件夹中找到最新的 PDF，导入到当前选中条目，然后解析。
 */
export async function importLatestPdfAndParse() {
  const pane = Zotero.getActiveZoteroPane();
  const selected = pane?.getSelectedItems() || [];
  const item = selected[0];

  if (!item?.isRegularItem()) {
    Zotero.getMainWindow().alert(getString("error-no-selection"));
    return;
  }

  const folder = String(getPref("import_folder") || "").trim();
  if (!folder) {
    Zotero.getMainWindow().alert(
      localeText(
        "请先在设置中配置 PDF 导入文件夹路径",
        "Please configure the PDF import folder in preferences first",
      ),
    );
    return;
  }

  // Find the newest PDF in the folder
  let entries: { name: string; path: string }[];
  try {
    const children = await IOUtils.getChildren(folder);
    entries = [];
    for (const fullPath of children) {
      if (!fullPath.toLowerCase().endsWith(".pdf")) continue;
      const name = PathUtils.filename(fullPath);
      entries.push({ name, path: fullPath });
    }
  } catch {
    Zotero.getMainWindow().alert(
      localeText(
        `无法访问文件夹：${folder}`,
        `Cannot access folder: ${folder}`,
      ),
    );
    return;
  }

  if (entries.length === 0) {
    Zotero.getMainWindow().alert(
      localeText(
        `文件夹中没有找到 PDF 文件：${folder}`,
        `No PDF files found in: ${folder}`,
      ),
    );
    return;
  }

  // Sort by modification time, newest first
  const withStats = await Promise.all(
    entries.map(async (entry) => {
      try {
        const stat = await IOUtils.stat(entry.path);
        return { ...entry, mtime: stat.lastModified };
      } catch {
        return { ...entry, mtime: 0 };
      }
    }),
  );
  withStats.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  const newest = withStats[0];

  // Confirm before importing
  const confirmed = Zotero.getMainWindow().confirm(
    localeText(
      `将导入以下 PDF 并解析：\n\n${newest.name}\n\n是否继续？`,
      `Import and parse the following PDF?\n\n${newest.name}\n\nContinue?`,
    ),
  );
  if (!confirmed) return;

  Zotero.debug(
    `[Mineru Parse] Importing latest PDF: ${newest.name} from ${folder}`,
  );

  // Show progress
  const progress = new ztoolkit.ProgressWindow(config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: localeText(`导入：${newest.name}`, `Importing: ${newest.name}`),
      type: "default",
      progress: 10,
    })
    .show();

  // Suppress auto-parse so the notifier doesn't trigger a duplicate parse
  suppressAutoParse(item.id);

  try {
    // Import PDF as attachment
    const pdfAttachment = await Zotero.Attachments.importFromFile({
      file: newest.path,
      parentItemID: item.id,
    });

    if (!pdfAttachment) {
      throw new Error(
        localeText("创建附件失败", "Failed to create attachment"),
      );
    }

    progress.changeLine({
      text: localeText(
        `已导入，开始解析：${newest.name}`,
        `Imported, parsing: ${newest.name}`,
      ),
      progress: 20,
    });

    // Parse
    await parseItem(
      item,
      pdfAttachment,
      {},
      {
        onStatusChange: (_status, text) => {
          progress.changeLine({ text });
        },
        onProgress: (value) => {
          progress.changeLine({ progress: Math.max(20, value) });
        },
      },
    );

    progress.changeLine({
      text: localeText("导入并解析完成", "Import and parse complete"),
      progress: 100,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Zotero.debug(`[Mineru Parse] Import and parse failed: ${msg}`);
    progress.changeLine({
      text: localeText(`失败：${msg}`, `Failed: ${msg}`),
      progress: 100,
    });
  } finally {
    unsuppressAutoParse(item.id);
  }

  progress.startCloseTimer?.(4000);
}

function localeText(zh: string, en: string): string {
  return String(Zotero.locale || "")
    .toLowerCase()
    .startsWith("zh")
    ? zh
    : en;
}
