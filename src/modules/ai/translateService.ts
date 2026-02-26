import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { MINERU_NOTE_TAG, parseSelectedItem } from "../parse";
import { chatCompletion } from "./apiClient";
import type { AIConfig, ChatMessage } from "./types";

export async function translateNote(
  item: Zotero.Item,
  noteItem?: Zotero.Item,
): Promise<void> {
  let progress: ReturnType<typeof createProgressWindow> | null = null;
  try {
    const resolved = resolveInput(item, noteItem);
    if (!resolved.parentItem) {
      showAlert(getString("translate-error-no-note"));
      return;
    }
    const parentItem = resolved.parentItem;
    let sourceNote = resolved.noteItem;

    // 没有解析笔记时，自动触发全文解析
    if (!sourceNote) {
      await parseSelectedItem();
      sourceNote = findMineruNote(parentItem);
      if (!sourceNote) {
        return;
      }
    }
    const noteContent = stripHtml(sourceNote.getNote()).trim();
    if (!noteContent) {
      showAlert(getString("translate-error-no-note"));
      return;
    }

    const baseUrl =
      String(getPref("ai.baseUrl") || "https://api.openai.com/v1").trim() ||
      "https://api.openai.com/v1";
    const apiKey = String(getPref("ai.apiKey") || "").trim();
    const model =
      String(getPref("translate.model") || "gpt-4o-mini").trim() ||
      "gpt-4o-mini";
    const targetLang =
      String(getPref("translate.targetLang") || "English").trim() || "English";
    const systemPromptTemplate = String(
      getPref("translate.systemPrompt") || "",
    ).trim();

    if (!apiKey) {
      showAlert(getString("ai-error-no-apikey"));
      return;
    }

    const systemPrompt = systemPromptTemplate.replace(
      /\{\{\s*targetLang\s*\}\}/g,
      targetLang,
    );

    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          systemPrompt ||
          `You are a professional academic translator. Translate the following text to ${targetLang}. Preserve all formatting, mathematical formulas, tables, and technical terms. Output ONLY the translated text, no explanations.`,
      },
      { role: "user", content: noteContent },
    ];

    const config: AIConfig = {
      baseUrl,
      apiKey,
      model,
      systemPrompt: "",
    };

    progress = createProgressWindow(
      getString("translate-progress-title"),
      getString("translate-progress-requesting"),
    );

    let translationResult = "";
    let receivingShown = false;

    translationResult = await chatCompletion(config, messages, {
      onToken: (token: string) => {
        if (!receivingShown) {
          progress?.changeLine({
            text: getString("translate-progress-receiving"),
            progress: 60,
          });
          receivingShown = true;
        }
        translationResult += token;
      },
      onComplete: (content: string) => {
        if (content.trim()) {
          translationResult = content;
        }
      },
      onError: () => {
        // 错误在外层 catch 处理
      },
    });

    if (!translationResult.trim()) {
      throw new Error("empty_response");
    }

    const htmlContent = await markdownToHtml(translationResult);

    progress.changeLine({
      text: getString("translate-progress-saving"),
      progress: 85,
    });

    const translateNote = new Zotero.Item("note");
    translateNote.libraryID = parentItem.libraryID;
    translateNote.parentID = parentItem.id;
    translateNote.setNote(
      `<div data-schema-version="9">${[
        `<h2>${getString("translate-note-heading")} (${escapeHtml(targetLang)})</h2>`,
        `<p><em>${getString("translate-note-model")}: ${escapeHtml(model)} | ${getString("translate-note-time")}: ${formatDateTime(new Date())}</em></p>`,
        "<hr/>",
        htmlContent,
      ].join("")}</div>`,
    );
    await translateNote.saveTx();

    progress.changeLine({
      text: getString("translate-progress-done"),
      progress: 100,
      type: "success",
    });
    progress.startCloseTimer(1500);
  } catch (error) {
    const message = mapTranslateError(error);
    Zotero.debug(`[Translate] Error: ${error}`);

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
  if (noteItem?.isNote()) {
    if (hasMineruTag(noteItem)) {
      return {
        parentItem: resolveParentItem(noteItem) || resolveParentItem(item),
        noteItem,
      };
    }
  }

  if (item.isNote() && hasMineruTag(item)) {
    return {
      parentItem: resolveParentItem(item),
      noteItem: item,
    };
  }

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

function mapTranslateError(error: unknown): string {
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
  return `${getString("translate-error-generic")}: ${message}`;
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

function stripHtml(html: string): string {
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
