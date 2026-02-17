import { unzipSync } from "fflate";
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import {
  extractImagePathsFromHtml,
  prepareImageTasks,
  batchImportImages,
  replaceImageSrcs,
} from "./imageImporter";

const API_BASE = "https://mineru.net";
const MAX_FILE_SIZE = 200 * 1024 * 1024;

type MineruUploadResponse = {
  code: number;
  msg?: string;
  data?: {
    batch_id?: string;
    file_urls?: string[];
  };
};

type MineruBatchResult = {
  code: number;
  msg?: string;
  data?: {
    extract_result?: Array<{
      file_name?: string;
      data_id?: string;
      state: string;
      err_msg?: string;
      full_zip_url?: string;
      extract_progress?: {
        extracted_pages?: number;
        total_pages?: number;
      };
    }>;
  };
};

type ProgressLine = {
  changeLine: (options: { text?: string; progress?: number }) => void;
  startCloseTimer?: (ms: number) => void;
};

type ParseOptions = {
  force?: boolean;
};

type CacheMetadata = {
  itemKey: string;
  attachmentKey: string;
  attachmentSize?: number;
  attachmentMtime?: number;
  modelVersion?: string;
  mdPath: string;
  createdAt: number;
  dataId?: string;
};

type ImportResult = {
  pendingImages: number;
  remainingImages: number;
};

type ImportOptions = {
  progress?: ProgressLine;
  progressStart?: number;
  progressEnd?: number;
};

export async function parseSelectedItem(options: ParseOptions = {}) {
  let progress: ProgressLine | null = null;
  try {
    const item = getSelectedItem();
    if (!item) {
      alertMain(getString("error-no-selection"));
      return;
    }

    const pdfAttachment =
      getSelectedPdfAttachment() || (await getPdfAttachment(item));
    if (!pdfAttachment) {
      alertMain(getString("error-no-pdf"));
      return;
    }

    const betterNotes = (Zotero as any).BetterNotes;
    if (!betterNotes?.api?.convert?.md2html) {
      alertMain(getString("error-better-notes-missing"));
      return;
    }

    const filePath = await pdfAttachment.getFilePathAsync();
    if (!filePath) {
      alertMain(getString("error-no-pdf"));
      return;
    }

    const fileStat = await IOUtils.stat(filePath);
    const fileSize =
      typeof fileStat.size === "number" ? fileStat.size : Number.NaN;
    if (Number.isFinite(fileSize) && fileSize > MAX_FILE_SIZE) {
      alertMain(`文件大小超过 200MB：${Math.round(fileSize / 1024 / 1024)}MB`);
      return;
    }

    const fileName = PathUtils.filename(filePath);
    const prefs = getMineruPrefs();

    const cacheHit =
      !options.force &&
      (await findCachedMarkdown({
        itemKey: item.key,
        attachmentKey: pdfAttachment.key,
        attachmentSize: Number.isFinite(fileSize) ? fileSize : undefined,
        attachmentMtime: fileStat.lastModified,
        modelVersion: prefs.model_version,
      }));

    if (cacheHit) {
      progress = new ztoolkit.ProgressWindow(config.addonName, {
        closeOnClick: true,
        closeTime: -1,
      })
        .createLine({
          text: getString("status-cache-hit"),
          type: "default",
          progress: 40,
        })
        .show();

      progress.changeLine({
        text: getString("status-importing"),
        progress: 70,
      });
      const noteItem = await createItemNote(item);
      const importResult = await importMarkdownToNote(
        betterNotes,
        noteItem,
        cacheHit,
        {
          progress,
          progressStart: 70,
          progressEnd: 99,
        },
      );
      progress.changeLine({
        text: getImportStatusText(importResult),
        progress: 100,
      });
      progress.startCloseTimer?.(4000);
      return;
    }

    const token = String(getPref("token") || "").trim();
    if (!token) {
      alertMain(getString("error-no-token"));
      return;
    }

    const dataId = `${item.key}-${Date.now()}`;

    progress = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
      closeTime: -1,
    })
      .createLine({
        text: getString("status-uploading"),
        type: "default",
        progress: 10,
      })
      .show();

    const { batchId, uploadUrl } = await createUploadUrl(
      token,
      fileName,
      dataId,
      prefs,
    );
    await uploadFile(uploadUrl, filePath);
    progress.changeLine({ text: getString("status-queued"), progress: 30 });

    const fullZipUrl = await pollBatchResult(
      token,
      batchId,
      dataId,
      fileName,
      progress,
      prefs,
    );

    progress.changeLine({
      text: getString("status-downloading"),
      progress: 70,
    });
    const zipBuffer = await downloadFile(fullZipUrl);
    const outputDir = await createTempDir(dataId);
    const mdPath = await extractMarkdown(zipBuffer, outputDir);
    await writeCacheMetadata(outputDir, {
      itemKey: item.key,
      attachmentKey: pdfAttachment.key,
      attachmentSize: Number.isFinite(fileSize) ? fileSize : undefined,
      attachmentMtime: fileStat.lastModified,
      modelVersion: prefs.model_version,
      mdPath,
      createdAt: Date.now(),
      dataId,
    });

    progress.changeLine({ text: getString("status-importing"), progress: 85 });
    const noteItem = await createItemNote(item);
    const importResult = await importMarkdownToNote(
      betterNotes,
      noteItem,
      mdPath,
      {
        progress,
        progressStart: 85,
        progressEnd: 99,
      },
    );

    progress.changeLine({
      text: getImportStatusText(importResult),
      progress: 100,
    });
    progress.startCloseTimer?.(4000);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error || "未知错误");
    ztoolkit.log("[Mineru Parse] Error", error);
    if (progress) {
      progress.changeLine({ text: message, progress: 100 });
      progress.startCloseTimer?.(6000);
    }
    alertMain(message);
  }
}

function getSelectedItem(): Zotero.Item | null {
  const pane = Zotero.getActiveZoteroPane();
  const selected = pane?.getSelectedItems() || [];
  if (!selected.length) {
    return null;
  }
  const item = selected[0];
  if (item.isAttachment()) {
    return item.parentItem && item.parentItem.isRegularItem()
      ? item.parentItem
      : null;
  }
  return item.isRegularItem() ? item : null;
}

function getSelectedPdfAttachment(): Zotero.Item | null {
  const pane = Zotero.getActiveZoteroPane();
  const selected = pane?.getSelectedItems() || [];
  if (!selected.length) {
    return null;
  }
  const item = selected[0];
  if (item?.isAttachment() && item.isPDFAttachment()) {
    return item;
  }
  return null;
}

async function getPdfAttachment(
  item: Zotero.Item,
): Promise<Zotero.Item | null> {
  if (item.isAttachment()) {
    return item.isPDFAttachment() ? item : null;
  }
  const best = await item.getBestAttachment();
  if (best && best.isPDFAttachment()) {
    return best;
  }
  const attachments = item.getAttachments();
  for (const id of attachments) {
    const att = Zotero.Items.get(id);
    if (att?.isAttachment() && att.isPDFAttachment()) {
      return att;
    }
  }
  return null;
}

async function createItemNote(parentItem: Zotero.Item) {
  const noteItem = new Zotero.Item("note");
  noteItem.libraryID = parentItem.libraryID;
  noteItem.parentID = parentItem.id;
  await noteItem.saveTx();
  return noteItem;
}

async function importMarkdownToNote(
  betterNotes: any,
  noteItem: Zotero.Item,
  mdPath: string,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const timingStart = Date.now();
  let timingLast = timingStart;
  const logTiming = (step: string) => {
    const now = Date.now();
    ztoolkit.log(
      `[Mineru Parse][timing] ${step} +${now - timingLast}ms total=${
        now - timingStart
      }ms`,
    );
    timingLast = now;
  };

  const exists = await IOUtils.exists(mdPath);
  if (!exists) {
    throw new Error(`未找到解析结果文件: ${mdPath}`);
  }
  logTiming("md-path-ready");

  const progressStart =
    typeof options.progressStart === "number" ? options.progressStart : 0;
  const progressEnd =
    typeof options.progressEnd === "number" ? options.progressEnd : 100;
  const progressSpan = Math.max(0, progressEnd - progressStart);

  const updateProgress = async (
    text?: string,
    value?: number,
  ): Promise<void> => {
    if (!options.progress) {
      return;
    }
    const progressValue =
      typeof value === "number"
        ? Math.min(progressEnd, Math.max(progressStart, value))
        : value;
    options.progress.changeLine({ text, progress: progressValue });
    await Zotero.Promise.delay(0);
  };

  // 阶段 1：读取 Markdown 文件
  const contentRaw = (await Zotero.File.getContentsAsync(
    mdPath,
    "utf-8",
  )) as string;
  logTiming("read-md");
  await updateProgress(getString("status-importing"), progressStart);

  // 阶段 2：使用 Better Notes 的 md2html 转换
  if (!betterNotes.api?.convert?.md2html) {
    throw new Error("Better Notes API 不完整，无法导入 Markdown");
  }

  const content = stripBeforeFirstHeading(contentRaw);
  let htmlContent = await betterNotes.api.convert.md2html(content);
  logTiming("md2html");

  const convertProgressEnd = progressStart + Math.round(progressSpan * 0.15);
  await updateProgress(getString("status-importing"), convertProgressEnd);

  // 阶段 3：提取图片路径并准备导入任务
  // fileDir 使用 PathUtils.parent（与 BN 的 getMDStatus 一致）
  const fileDir = PathUtils.parent(mdPath) || "";
  const imageSrcs = extractImagePathsFromHtml(htmlContent);
  const imageTasks = prepareImageTasks(imageSrcs, fileDir);
  logTiming(`prepare-images (${imageTasks.length} images)`);

  // 阶段 4：高性能批量导入图片
  const imageProgressStart = convertProgressEnd;
  const imageProgressEnd = progressStart + Math.round(progressSpan * 0.9);
  const imageProgressSpan = imageProgressEnd - imageProgressStart;

  const importResult = {
    pendingImages: imageTasks.length,
    remainingImages: 0,
  };

  if (imageTasks.length > 0) {
    const batchResult = await batchImportImages(noteItem, imageTasks, {
      concurrency: 8,
      onProgress: (done, total, phase) => {
        const ratio = total > 0 ? done / total : 0;
        let phaseOffset = 0;
        let phaseSpan = imageProgressSpan;

        if (phase === "reading") {
          phaseSpan = imageProgressSpan * 0.4;
        } else if (phase === "importing") {
          phaseOffset = imageProgressSpan * 0.4;
          phaseSpan = imageProgressSpan * 0.6;
        }

        const progress = Math.round(
          imageProgressStart + phaseOffset + ratio * phaseSpan,
        );
        const phaseText =
          phase === "reading"
            ? getString("status-reading-images")
            : getString("status-importing-images");
        updateProgress(`${phaseText} (${done}/${total})`, progress);
      },
    });
    logTiming(
      `batch-import (${batchResult.successCount}/${batchResult.totalCount})`,
    );

    // 阶段 5：替换 HTML 中的图片路径为附件引用
    htmlContent = replaceImageSrcs(htmlContent, batchResult.srcToKey);
    logTiming("replace-image-srcs");

    importResult.remainingImages = batchResult.failed.length;
    if (batchResult.failed.length > 0) {
      ztoolkit.log(
        `[Mineru Parse] Failed to import ${batchResult.failed.length} images:`,
        batchResult.failed,
      );
    }
  }

  await updateProgress(getString("status-importing"), imageProgressEnd);

  // 阶段 6：保存笔记
  const noteStatus = betterNotes.api?.sync?.getNoteStatus?.(noteItem.id) || {
    meta: '<div data-schema-version="9">',
    tail: "</div>",
  };

  noteItem.setNote(
    `${noteStatus.meta}${htmlContent}${noteStatus.tail || "</div>"}`,
  );
  await noteItem.saveTx({
    notifierData: {
      autoSyncDelay: Zotero.Notes.AUTO_SYNC_DELAY,
    },
  });
  logTiming("save-note");
  await updateProgress(getString("status-importing"), progressEnd);

  return importResult;
}

function getImportStatusText(result: ImportResult) {
  if (!result || result.remainingImages <= 0) {
    return getString("status-success");
  }
  return getString("status-images-pending", {
    args: { count: result.remainingImages },
  });
}

function getMineruPrefs() {
  return {
    model_version: String(getPref("model_version") || "pipeline"),
    is_ocr: Boolean(getPref("is_ocr")),
    enable_formula: Boolean(getPref("enable_formula")),
    enable_table: Boolean(getPref("enable_table")),
    language: String(getPref("language") || "ch"),
    page_ranges: String(getPref("page_ranges") || "").trim(),
    poll_interval_ms: Number(getPref("poll_interval_ms") || 3000),
    poll_timeout_ms: Number(getPref("poll_timeout_ms") || 900000),
  };
}

async function createUploadUrl(
  token: string,
  fileName: string,
  dataId: string,
  prefs: ReturnType<typeof getMineruPrefs>,
) {
  const body: Record<string, any> = {
    files: [
      {
        name: fileName,
        data_id: dataId,
        is_ocr: prefs.is_ocr,
        page_ranges: prefs.page_ranges || undefined,
      },
    ],
    model_version: prefs.model_version,
    enable_formula: prefs.enable_formula,
    enable_table: prefs.enable_table,
    language: prefs.language,
  };
  if (!prefs.page_ranges) {
    delete body.files[0].page_ranges;
  }
  const res = await fetchJson<MineruUploadResponse>(
    `${API_BASE}/api/v4/file-urls/batch`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (res.code !== 0) {
    throw new Error(`申请上传链接失败: ${res.msg || res.code}`);
  }
  const uploadUrl = res.data?.file_urls?.[0];
  const batchId = res.data?.batch_id;
  if (!uploadUrl || !batchId) {
    throw new Error("申请上传链接失败: 返回数据不完整");
  }
  return { uploadUrl, batchId };
}

async function uploadFile(uploadUrl: string, filePath: string) {
  const data = await IOUtils.read(filePath);
  const res = await fetch(uploadUrl, {
    method: "PUT",
    body: data,
  });
  if (!res.ok) {
    throw new Error(`文件上传失败: ${res.status}`);
  }
}

async function pollBatchResult(
  token: string,
  batchId: string,
  dataId: string,
  fileName: string,
  progress: ProgressLine,
  prefs: ReturnType<typeof getMineruPrefs>,
) {
  const start = Date.now();
  while (Date.now() - start < prefs.poll_timeout_ms) {
    const res = await fetchJson<MineruBatchResult>(
      `${API_BASE}/api/v4/extract-results/batch/${batchId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "*/*",
        },
      },
    );
    if (res.code !== 0) {
      throw new Error(`任务查询失败: ${res.msg || res.code}`);
    }
    const result =
      res.data?.extract_result?.find(
        (entry) => entry.data_id === dataId || entry.file_name === fileName,
      ) || res.data?.extract_result?.[0];
    if (!result) {
      throw new Error("任务查询失败: 未找到结果");
    }
    if (result.state === "done") {
      if (!result.full_zip_url) {
        throw new Error("任务完成但未返回下载链接");
      }
      return result.full_zip_url;
    }
    if (result.state === "failed") {
      throw new Error(`解析失败: ${result.err_msg || "未知原因"}`);
    }
    if (result.state === "pending") {
      progress.changeLine({ text: getString("status-queued"), progress: 40 });
    } else if (result.state === "running") {
      const extracted = result.extract_progress?.extracted_pages;
      const total = result.extract_progress?.total_pages;
      if (
        typeof extracted === "number" &&
        typeof total === "number" &&
        total > 0
      ) {
        const ratio = Math.min(1, Math.max(0, extracted / total));
        const percent = 40 + Math.round(ratio * 20);
        progress.changeLine({
          text: getString("status-running-progress", {
            args: { current: extracted, total },
          }),
          progress: percent,
        });
      } else {
        progress.changeLine({
          text: getString("status-running"),
          progress: 55,
        });
      }
    } else if (result.state === "converting") {
      progress.changeLine({
        text: getString("status-converting"),
        progress: 60,
      });
    }
    await Zotero.Promise.delay(prefs.poll_interval_ms);
  }
  throw new Error("任务超时，请稍后重试");
}

async function downloadFile(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`下载失败: ${res.status}`);
  }
  return await res.arrayBuffer();
}

async function createTempDir(dataId: string) {
  const baseDir = await getCacheBaseDir();
  const dir = PathUtils.join(baseDir, `${config.addonRef}-${dataId}`);
  await ensureDir(dir);
  return dir;
}

async function getCacheBaseDir() {
  const customDir = String(getPref("cache_dir") || "").trim();
  if (customDir) {
    try {
      await ensureDir(customDir);
      return customDir;
    } catch (error) {
      ztoolkit.log("[Mineru Parse] Cache dir not available", error);
    }
  }
  return Zotero.getTempDirectory().path;
}

async function extractMarkdown(zipBuffer: ArrayBuffer, outputDir: string) {
  const files = unzipSync(new Uint8Array(zipBuffer));
  const mdCandidates: string[] = [];
  const createdDirs = new Set<string>();

  const ensureDirOnce = async (dir: string) => {
    if (createdDirs.has(dir)) return;
    await ensureDir(dir);
    createdDirs.add(dir);
  };

  for (const [entryPath, data] of Object.entries(files)) {
    const segments = normalizeZipEntryPath(entryPath);
    if (!segments.length) {
      if (entryPath && !entryPath.endsWith("/")) {
        throw new Error("压缩包包含不安全的路径，已中止解压");
      }
      continue;
    }
    if (entryPath.endsWith("/")) {
      await ensureDirOnce(PathUtils.join(outputDir, ...segments));
      continue;
    }
    const outPath = PathUtils.join(outputDir, ...segments);
    const parentDir = PathUtils.parent(outPath);
    if (parentDir) {
      await ensureDirOnce(parentDir);
    }
    await IOUtils.write(outPath, data);
    if (entryPath.toLowerCase().endsWith(".md")) {
      mdCandidates.push(segments.join("/"));
    }
  }
  const selected = selectMarkdown(mdCandidates);
  if (!selected) {
    throw new Error("未找到 Markdown 结果文件");
  }
  return PathUtils.join(outputDir, ...selected.split("/"));
}

function selectMarkdown(paths: string[]) {
  if (!paths.length) {
    return "";
  }
  const preferred = paths.find((p) => {
    const normalized = p.replace(/\\/g, "/").toLowerCase();
    return /(^|\/)markdown\//.test(normalized);
  });
  return (
    preferred ||
    paths
      .slice()
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))[0]
  );
}

function normalizeZipEntryPath(entryPath: string): string[] {
  const normalized = entryPath.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!normalized) {
    return [];
  }
  if (normalized.startsWith("/") || normalized.startsWith("\\")) {
    return [];
  }
  if (/^[a-zA-Z]:/.test(normalized)) {
    return [];
  }
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length) {
    return [];
  }
  if (segments.some((seg) => seg === "." || seg === "..")) {
    return [];
  }
  return segments;
}

async function fetchJson<T>(url: string, options: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`请求失败: ${res.status}`);
  }
  return (await res.json()) as T;
}

async function ensureDir(path: string) {
  await IOUtils.makeDirectory(path, {
    createAncestors: true,
    ignoreExisting: true,
  });
}

function alertMain(message: string) {
  Zotero.getMainWindow().alert(message);
}

async function findCachedMarkdown(info: {
  itemKey: string;
  attachmentKey: string;
  attachmentSize?: number;
  attachmentMtime?: number;
  modelVersion?: string;
}) {
  const baseDir = await getCacheBaseDir();
  if (!(await IOUtils.exists(baseDir))) {
    return "";
  }

  const cachePrefix = `${config.addonRef}-`;
  let bestPath = "";
  let bestScore = -1;
  const entries = await IOUtils.getChildren(baseDir).catch(() => []);

  for (const entry of entries) {
    // 跳过非插件缓存目录，避免在临时目录中做无效 I/O
    if (!PathUtils.filename(entry).startsWith(cachePrefix)) {
      continue;
    }

    const stat = await IOUtils.stat(entry).catch(() => null);
    if (!stat || stat.type !== "directory") {
      continue;
    }

    const meta = await readCacheMetadata(entry);
    if (meta) {
      if (
        meta.itemKey !== info.itemKey ||
        meta.attachmentKey !== info.attachmentKey
      ) {
        continue;
      }
      if (!isSameAttachment(meta, info)) {
        continue;
      }
      if (info.modelVersion && meta.modelVersion !== info.modelVersion) {
        continue;
      }
      if (meta.mdPath && (await IOUtils.exists(meta.mdPath))) {
        const score = meta.createdAt || stat.lastModified || 0;
        if (score > bestScore) {
          bestScore = score;
          bestPath = meta.mdPath;
        }
      }
      continue;
    }

    const fallback = await inferCachedMarkdown(entry, info);
    if (fallback) {
      const score = stat.lastModified || 0;
      if (score > bestScore) {
        bestScore = score;
        bestPath = fallback;
      }
    }
  }

  return bestPath;
}

async function readCacheMetadata(dir: string): Promise<CacheMetadata | null> {
  const metaPath = PathUtils.join(dir, "cache-info.json");
  if (!(await IOUtils.exists(metaPath))) {
    return null;
  }
  try {
    const data = (await IOUtils.readJSON(metaPath)) as CacheMetadata;
    if (!data?.mdPath) {
      return null;
    }
    return data;
  } catch (error) {
    ztoolkit.log("[Mineru Parse] Read cache metadata failed", error);
    return null;
  }
}

function isSameAttachment(
  meta: { attachmentSize?: number; attachmentMtime?: number },
  info: { attachmentSize?: number; attachmentMtime?: number },
) {
  const sizeMatch =
    typeof meta.attachmentSize !== "number" ||
    typeof info.attachmentSize !== "number" ||
    meta.attachmentSize === info.attachmentSize;
  const mtimeMatch =
    typeof meta.attachmentMtime !== "number" ||
    typeof info.attachmentMtime !== "number" ||
    meta.attachmentMtime === info.attachmentMtime;
  return sizeMatch && mtimeMatch;
}

async function inferCachedMarkdown(
  dir: string,
  info: {
    itemKey: string;
    attachmentSize?: number;
    attachmentMtime?: number;
  },
) {
  const dirName = PathUtils.filename(dir);
  if (!dirName.startsWith(`${config.addonRef}-${info.itemKey}-`)) {
    return "";
  }

  const children = await IOUtils.getChildren(dir).catch(() => []);
  const originPdf = children.find((child) =>
    child.toLowerCase().endsWith("_origin.pdf"),
  );
  if (originPdf && typeof info.attachmentSize === "number") {
    const stat = await IOUtils.stat(originPdf).catch(() => null);
    if (stat?.size && stat.size !== info.attachmentSize) {
      return "";
    }
  }

  const mdPath = await findMarkdownFile(dir);
  return mdPath;
}

async function findMarkdownFile(rootDir: string) {
  const mdCandidates: string[] = [];
  const queue = [rootDir];
  while (queue.length) {
    const current = queue.pop();
    if (!current) {
      continue;
    }
    const children = await IOUtils.getChildren(current).catch(() => []);
    for (const child of children) {
      const stat = await IOUtils.stat(child).catch(() => null);
      if (!stat) {
        continue;
      }
      if (stat.type === "directory") {
        queue.push(child);
        continue;
      }
      if (child.toLowerCase().endsWith(".md")) {
        mdCandidates.push(child);
      }
    }
  }
  return selectMarkdown(mdCandidates);
}

async function writeCacheMetadata(dir: string, meta: CacheMetadata) {
  const metaPath = PathUtils.join(dir, "cache-info.json");
  try {
    await IOUtils.writeJSON(metaPath, meta);
  } catch (error) {
    ztoolkit.log("[Mineru Parse] Write cache metadata failed", error);
  }
}

// 裁剪第一个 Markdown 标题之前的噪声内容（页眉、页码、DOI 等）
// 使笔记显示标题为论文真正标题
function stripBeforeFirstHeading(md: string): string {
  const idx = md.search(/^#{1,6}\s/m);
  return idx > 0 ? md.slice(idx) : md;
}
