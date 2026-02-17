/**
 * 高性能批量图片导入器
 *
 * 路径处理与 Better Notes 保持一致（path-browserify + formatPath）
 * 性能优化：
 * 1. IOUtils.read 直接返回 Uint8Array（BN 用 getBinaryContentsAsync + 逐字节转换）
 * 2. 并行读取文件
 * 3. 单事务批量写入 + skipNotifier
 */

import pathBrowserify from "path-browserify";

// 图片导入任务
export type ImageTask = {
  src: string; // HTML 中的原始 src（可能经过 encodeURI）
  decodedSrc: string; // 解码后的路径
  absolutePath: string; // 平台原生绝对路径
  data?: Uint8Array;
  mimeType?: string;
};

// 导入结果
export type ImageImportResult = {
  srcToKey: Map<string, string>; // 原始 src → attachmentKey
  failed: string[];
  totalCount: number;
  successCount: number;
  totalTime: number;
};

// 导入选项
export type ImageImportOptions = {
  concurrency?: number; // 并行读取数，默认 8
  onProgress?: (done: number, total: number, phase: string) => void;
};

// 扩展名到 MIME 类型映射
const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

/**
 * 与 Better Notes 一致的路径格式化
 * 统一为 Unix 风格，Windows 上再转回反斜杠
 */
function formatPath(p: string): string {
  p = p.replace(/\\/g, "/");
  if (typeof Zotero !== "undefined" && Zotero.isWin) {
    p = p.replace(/\//g, "\\");
    if (p[0] === "\\" && p[1] !== "\\") {
      p = `\\${p}`;
    }
  }
  return p;
}

/**
 * 与 Better Notes 一致的路径拼接（path-browserify.join + formatPath）
 */
function jointPath(...paths: string[]): string {
  return formatPath(
    pathBrowserify.join(...paths.map((p) => p.replace(/\\/g, "/"))),
  );
}

/**
 * 从 HTML 中提取所有本地图片的 src
 */
export function extractImagePathsFromHtml(html: string): string[] {
  const paths: string[] = [];
  const regex = /<img[^>]+src=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const src = match[1];
    if (src && !src.startsWith("data:") && !src.startsWith("http")) {
      paths.push(src);
    }
  }
  return [...new Set(paths)];
}

/**
 * 准备图片导入任务
 * 路径解析逻辑与 BN processM2NRehypeImageNodes 一致：
 * 1. decodeURIComponent 解码
 * 2. formatPath 规范化
 * 3. 非绝对路径用 jointPath(fileDir, src) 拼接
 */
export function prepareImageTasks(
  imageSrcs: string[],
  fileDir: string,
): ImageTask[] {
  const tasks: ImageTask[] = [];
  for (const rawSrc of imageSrcs) {
    // 与 BN 一致：先 decodeURIComponent
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawSrc);
    } catch {
      decoded = rawSrc;
    }
    decoded = formatPath(decoded);

    const ext = pathBrowserify.extname(decoded).toLowerCase().split("?")[0];
    if (!EXT_TO_MIME[ext]) {
      continue;
    }

    // 与 BN 一致：非绝对路径用 jointPath 拼接 fileDir
    let absolutePath: string;
    if (pathBrowserify.isAbsolute(decoded.replace(/\\/g, "/"))) {
      absolutePath = formatPath(decoded);
    } else {
      absolutePath = jointPath(fileDir, decoded);
    }

    tasks.push({
      src: rawSrc,
      decodedSrc: decoded,
      absolutePath,
      mimeType: EXT_TO_MIME[ext] || "image/png",
    });
  }
  return tasks;
}

/**
 * 并行读取图片文件（分批），使用 IOUtils.read 直接获取 Uint8Array
 */
async function readImagesParallel(
  tasks: ImageTask[],
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const total = tasks.length;
  let done = 0;

  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (task) => {
        try {
          task.data = await IOUtils.read(task.absolutePath);
        } catch {
          ztoolkit.log(
            `[Mineru Parse] Failed to read image: ${task.absolutePath}`,
          );
        }
        done++;
        onProgress?.(done, total);
      }),
    );
  }
}

/**
 * 逐个创建图片附件（不包裹外层事务，与 BN 一致）
 * 数据已预读到内存，每次 importEmbeddedImage 只需传 Blob，无需再读文件
 */
async function createAttachments(
  noteItem: Zotero.Item,
  tasks: ImageTask[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, string>> {
  const srcToKey = new Map<string, string>();
  const validTasks = tasks.filter((t) => t.data && t.data.length > 0);
  const total = validTasks.length;
  let done = 0;

  if (total === 0) {
    return srcToKey;
  }

  ztoolkit.log(
    `[Mineru Parse] Creating ${total} attachments (${tasks.length - total} skipped - no data)`,
  );

  for (const task of validTasks) {
    try {
      const blob = new Blob([task.data!], { type: task.mimeType });
      const attachment = await Zotero.Attachments.importEmbeddedImage({
        blob,
        parentItemID: noteItem.id,
        saveOptions: {
          skipNotifier: true,
        },
      });
      srcToKey.set(task.src, attachment.key);
    } catch (error) {
      ztoolkit.log(
        `[Mineru Parse] Failed to create attachment: ${task.src}`,
        error,
      );
    }
    done++;
    onProgress?.(done, total);
  }

  return srcToKey;
}

/**
 * 替换 HTML 中的 <img src="..."> 为 <img data-attachment-key="...">
 * 单次正则遍历，避免逐图片扫描全文的 O(n*m) 开销
 */
export function replaceImageSrcs(
  html: string,
  srcToKey: Map<string, string>,
): string {
  if (srcToKey.size === 0) return html;

  const escapedSrcs = [...srcToKey.keys()].map((src) =>
    src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const pattern = new RegExp(
    `<img([^>]*)\\ssrc=["'](${escapedSrcs.join("|")})["']([^>]*)>`,
    "gi",
  );

  return html.replace(pattern, (_match, before, matchedSrc, after) => {
    const key = srcToKey.get(matchedSrc);
    if (!key) return _match;
    return `<img${before} data-attachment-key="${key}"${after}>`;
  });
}

/**
 * 高性能批量导入图片
 */
export async function batchImportImages(
  noteItem: Zotero.Item,
  tasks: ImageTask[],
  options: ImageImportOptions = {},
): Promise<ImageImportResult> {
  const startTime = Date.now();
  const concurrency = options.concurrency ?? 8;
  const onProgress = options.onProgress;

  const result: ImageImportResult = {
    srcToKey: new Map(),
    failed: [],
    totalCount: tasks.length,
    successCount: 0,
    totalTime: 0,
  };

  if (tasks.length === 0) {
    result.totalTime = Date.now() - startTime;
    return result;
  }

  ztoolkit.log(
    `[Mineru Parse] Starting batch import of ${tasks.length} images`,
  );
  ztoolkit.log(
    `[Mineru Parse] fileDir used for path resolution: first task absolutePath = ${tasks[0]?.absolutePath}`,
  );

  // 阶段 1：并行读取文件
  onProgress?.(0, tasks.length, "reading");
  await readImagesParallel(tasks, concurrency, (done, total) => {
    onProgress?.(done, total, "reading");
  });

  // 阶段 2：逐个创建附件（不包事务，与 BN 兼容）
  onProgress?.(0, tasks.length, "importing");
  const srcToKey = await createAttachments(
    noteItem,
    tasks,
    (done, total) => {
      onProgress?.(done, total, "importing");
    },
  );

  // 统计
  result.srcToKey = srcToKey;
  result.successCount = srcToKey.size;
  for (const task of tasks) {
    if (!srcToKey.has(task.src)) {
      result.failed.push(task.src);
    }
  }
  result.totalTime = Date.now() - startTime;

  ztoolkit.log(
    `[Mineru Parse] Batch import completed: ${result.successCount}/${result.totalCount} in ${result.totalTime}ms`,
  );

  return result;
}
