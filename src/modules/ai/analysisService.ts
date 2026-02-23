import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { MINERU_NOTE_TAG, parseSelectedItem } from "../parse";
import { chatCompletion } from "./apiClient";
import { getItemMetadata, replaceTemplateVariables } from "./promptTemplate";
import type { AIConfig, ChatMessage } from "./types";

export async function analyzeWithAI(
  item: Zotero.Item,
  noteItem?: Zotero.Item,
): Promise<void> {
  let progress: ReturnType<typeof createProgressWindow> | null = null;
  try {
    const resolved = resolveInput(item, noteItem);
    if (!resolved.parentItem) {
      showAlert(getString("ai-error-no-note"));
      return;
    }
    const parentItem = resolved.parentItem;
    let sourceNote = resolved.noteItem;

    // 没有解析笔记时，自动触发全文解析
    // parseSelectedItem 通过 Zotero 选区获取条目，此处假设选区与 item 一致
    if (!sourceNote) {
      await parseSelectedItem();
      sourceNote = findMineruNote(parentItem);
      if (!sourceNote) {
        // parseSelectedItem 内部已处理错误提示，此处静默返回
        return;
      }
    }
    const noteContent = stripHtml(sourceNote.getNote()).trim();
    if (!noteContent) {
      showAlert(getString("ai-error-no-note"));
      return;
    }

    const baseUrl =
      String(getPref("ai.baseUrl") || "https://api.openai.com/v1").trim() ||
      "https://api.openai.com/v1";
    const apiKey = String(getPref("ai.apiKey") || "").trim();
    const model = String(getPref("ai.model") || "gpt-4o").trim() || "gpt-4o";
    const systemPrompt = String(getPref("ai.systemPrompt") || "").trim();

    if (!apiKey) {
      showAlert(getString("ai-error-no-apikey"));
      return;
    }

    const metadata = getItemMetadata(parentItem);
    const processedPrompt = replaceTemplateVariables(systemPrompt, metadata);
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: processedPrompt || "请根据用户提供的笔记内容进行结构化分析。",
      },
      { role: "user", content: noteContent },
    ];

    const config: AIConfig = { baseUrl, apiKey, model, systemPrompt };

    progress = createProgressWindow(
      getString("ai-progress-title"),
      getString("ai-progress-requesting"),
    );

    let analysisResult = "";
    let receivingShown = false;

    analysisResult = await chatCompletion(config, messages, {
      onToken: (token: string) => {
        if (!receivingShown) {
          progress?.changeLine({
            text: getString("ai-progress-receiving"),
            progress: 60,
          });
          receivingShown = true;
        }
        analysisResult += token;
      },
      onComplete: (content: string) => {
        if (content.trim()) {
          analysisResult = content;
        }
      },
      onError: () => {
        // 错误在外层 catch 处理
      },
    });

    if (!analysisResult.trim()) {
      throw new Error("empty_response");
    }

    const htmlContent = await markdownToHtml(analysisResult);

    progress.changeLine({
      text: getString("ai-progress-saving"),
      progress: 85,
    });

    const aiNote = new Zotero.Item("note");
    aiNote.libraryID = parentItem.libraryID;
    aiNote.parentID = parentItem.id;
    aiNote.setNote(
      [
        "<h2>AI 解读</h2>",
        `<p><em>模型: ${escapeHtml(model)} | 时间: ${formatDateTime(new Date())}</em></p>`,
        "<hr/>",
        htmlContent,
      ].join(""),
    );
    await aiNote.saveTx();

    progress.changeLine({
      text: getString("ai-progress-done"),
      progress: 100,
      type: "success",
    });
    progress.startCloseTimer(1500);
  } catch (error) {
    const message = mapAIError(error);
    ztoolkit.log("[AI Analysis] Error", error);

    if (progress) {
      progress.changeLine({
        text: message,
        progress: 100,
        type: "error",
      });
      progress.startCloseTimer(5000);
    }

    showAlert(message);
  }
}

function createProgressWindow(title: string, text: string) {
  return new ztoolkit.ProgressWindow(title, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({ text, type: "default", progress: 20 })
    .show();
}

type ResolvedInput = {
  parentItem: Zotero.Item | null;
  noteItem: Zotero.Item | null;
};

function resolveInput(
  item: Zotero.Item,
  noteItem?: Zotero.Item,
): ResolvedInput {
  // 明确传入笔记时，检查是否为 MinerU 解析笔记
  if (noteItem?.isNote()) {
    if (hasMineruTag(noteItem)) {
      return {
        parentItem: resolveParentItem(noteItem) || resolveParentItem(item),
        noteItem,
      };
    }
    // 传入的不是解析笔记，回退到自动查找
  }

  // 如果选中的就是一个带 tag 的笔记
  if (item.isNote() && hasMineruTag(item)) {
    return {
      parentItem: resolveParentItem(item),
      noteItem: item,
    };
  }

  // 从父条目查找 MinerU 解析笔记
  const parentItem = resolveParentItem(item);
  if (!parentItem) {
    return { parentItem: null, noteItem: null };
  }

  return {
    parentItem,
    noteItem: findMineruNote(parentItem),
  };
}

function resolveParentItem(item: Zotero.Item): Zotero.Item | null {
  if (item.isRegularItem()) return item;
  if (item.parentItem && item.parentItem.isRegularItem())
    return item.parentItem;
  return null;
}

function hasMineruTag(item: Zotero.Item): boolean {
  return item.getTags().some((t) => t.tag === MINERU_NOTE_TAG);
}

function findMineruNote(parentItem: Zotero.Item): Zotero.Item | null {
  const noteIDs = parentItem.getNotes();
  if (!noteIDs.length) return null;

  const mineruNotes = noteIDs
    .map((id) => Zotero.Items.get(id))
    .filter(
      (n): n is Zotero.Item => Boolean(n && n.isNote()) && hasMineruTag(n!),
    );

  if (!mineruNotes.length) return null;

  // 多个解析笔记时取最新的
  mineruNotes.sort((a, b) => getModifiedTime(b) - getModifiedTime(a));
  return mineruNotes[0];
}

function getModifiedTime(item: Zotero.Item): number {
  const raw = item.dateModified || item.getField("dateModified");
  if (!raw) return 0;
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapAIError(error: unknown): string {
  const message = getErrorMessage(error);
  const lower = message.toLowerCase();

  if (lower.includes("密钥无效") || lower.includes("已过期")) {
    return getString("ai-error-auth");
  }
  if (lower.includes("频率过高")) {
    return getString("ai-error-ratelimit");
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return getString("ai-error-timeout");
  }
  if (
    lower.includes("无法连接") ||
    lower.includes("failed to fetch") ||
    lower.includes("network")
  ) {
    return getString("ai-error-network");
  }
  return `${getString("ai-error-generic")}: ${message}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || "Unknown error";
  if (typeof error === "string") return error;
  return "Unknown error";
}

function formatDateTime(date: Date): string {
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showAlert(message: string) {
  Zotero.getMainWindow().alert(message);
}

export function stripHtml(html: string): string {
  if (!html) return "";

  const withLineBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n");

  try {
    const doc = new DOMParser().parseFromString(withLineBreaks, "text/html");
    return (doc.body?.textContent || "").replace(/\u00A0/g, " ").trim();
  } catch {
    return withLineBreaks
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .trim();
  }
}

async function markdownToHtml(md: string): Promise<string> {
  const betterNotes = (Zotero as any).BetterNotes;
  return (await betterNotes.api.convert.md2html(md)) as string;
}
