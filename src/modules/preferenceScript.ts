import { getPref, setPref } from "../utils/prefs";
import { KeyModifier } from "zotero-plugin-toolkit";

type PromptTemplate = {
  id: string;
  name: string;
  prompt: string;
};

const BUILTIN_TEMPLATES: PromptTemplate[] = [
  {
    id: "general",
    name: "通用学术解读",
    prompt:
      "你是一位学术论文分析助手。请对论文《{{title}}》（{{authors}}，{{year}}）进行全面深度解读，包括：\n1. 核心研究问题与动机\n2. 主要方法与技术路线\n3. 关键发现与结论\n4. 创新点与贡献\n5. 局限性与未来方向",
  },
  {
    id: "method",
    name: "方法论精读",
    prompt:
      "你是一位方法论审查专家。请对论文《{{title}}》（{{authors}}，{{year}}）的方法论进行精读分析：\n1. 研究设计与实验框架\n2. 模型假设与理论依据\n3. 数据采集与处理流程\n4. 评估指标与基线选择\n5. 实验结果的可复现性评估",
  },
  {
    id: "related",
    name: "文献综述视角",
    prompt:
      "你是一位文献综述专家。请从综述视角分析论文《{{title}}》（{{authors}}，{{year}}，发表于 {{publicationTitle}}）：\n1. 所属研究领域与学科定位\n2. 与同类工作的异同比较\n3. 对先前研究的继承与突破\n4. 在领域发展脉络中的位置\n5. 对后续研究的潜在影响",
  },
  {
    id: "plain",
    name: "通俗摘要",
    prompt:
      "你是一位科学传播专家。请用通俗易懂的语言向非专业读者解释论文《{{title}}》（{{authors}}，{{year}}）的核心内容：\n1. 这篇论文要解决什么问题？（用生活类比）\n2. 作者是怎么做的？（避免术语）\n3. 发现了什么？（用简洁语言概括）\n4. 这个发现有什么意义？（对普通人的影响）",
  },
  {
    id: "critique",
    name: "批判性评读",
    prompt:
      "你是一位严谨的学术审稿人。请对论文《{{title}}》（{{authors}}，{{year}}）进行批判性评读：\n1. 论证逻辑是否严密，有无推理跳跃\n2. 实验设计是否充分，有无遗漏变量\n3. 数据分析是否存在偏差或过度解读\n4. 结论是否得到充分支持\n5. 与现有文献的矛盾之处\n6. 可改进的具体建议",
  },
];

export async function registerPrefsScripts(_window: Window) {
  if (!addon.data.prefs) {
    addon.data.prefs = { window: _window };
  } else {
    addon.data.prefs.window = _window;
  }
  bindPrefEvents();
  bindShortcutInput();
  bindTemplateSelector();
}

type PrefBinding = {
  id: string;
  key: string;
  type: "text" | "number" | "checkbox" | "menulist";
  defaultValue?: string | number;
};

const PREF_BINDINGS: PrefBinding[] = [
  { id: "mineru-parse-token", key: "token", type: "text" },
  { id: "mineru-parse-auto-parse", key: "auto_parse", type: "checkbox" },
  {
    id: "mineru-parse-model-version",
    key: "model_version",
    type: "menulist",
    defaultValue: "pipeline",
  },
  { id: "mineru-parse-is-ocr", key: "is_ocr", type: "checkbox" },
  {
    id: "mineru-parse-enable-formula",
    key: "enable_formula",
    type: "checkbox",
  },
  { id: "mineru-parse-enable-table", key: "enable_table", type: "checkbox" },
  {
    id: "mineru-parse-language",
    key: "language",
    type: "text",
    defaultValue: "ch",
  },
  { id: "mineru-parse-page-ranges", key: "page_ranges", type: "text" },
  { id: "mineru-parse-cache-dir", key: "cache_dir", type: "text" },
  {
    id: "mineru-parse-poll-interval",
    key: "poll_interval_ms",
    type: "number",
    defaultValue: 3000,
  },
  {
    id: "mineru-parse-poll-timeout",
    key: "poll_timeout_ms",
    type: "number",
    defaultValue: 900000,
  },
  {
    id: "mineru-parse-import-folder",
    key: "import_folder",
    type: "text",
    defaultValue: "",
  },
  {
    id: "mineru-parse-ai-base-url",
    key: "ai.baseUrl",
    type: "text",
    defaultValue: "https://api.openai.com/v1",
  },
  { id: "mineru-parse-ai-api-key", key: "ai.apiKey", type: "text" },
  {
    id: "mineru-parse-ai-model",
    key: "ai.model",
    type: "text",
    defaultValue: "gpt-4o",
  },
  {
    id: "mineru-parse-ai-system-prompt",
    key: "ai.systemPrompt",
    type: "text",
    defaultValue:
      "你是一位学术论文分析助手，请对以下笔记内容进行深度解读，包括核心观点提炼、方法论分析、关键发现总结等。",
  },
];

const TRANSLATE_PREF_BINDINGS: PrefBinding[] = [
  {
    id: "mineru-parse-translate-model",
    key: "translate.model",
    type: "text",
    defaultValue: "gpt-4o-mini",
  },
  {
    id: "mineru-parse-translate-target-lang",
    key: "translate.targetLang",
    type: "text",
    defaultValue: "English",
  },
  {
    id: "mineru-parse-translate-system-prompt",
    key: "translate.systemPrompt",
    type: "text",
    defaultValue:
      "You are a professional academic translator. Translate the following text to {{targetLang}}. Preserve all formatting, mathematical formulas, tables, and technical terms. Output ONLY the translated text, no explanations.",
  },
];

function bindPrefEvents() {
  const doc = addon.data.prefs?.window.document;
  if (!doc) return;

  for (const binding of [...PREF_BINDINGS, ...TRANSLATE_PREF_BINDINGS]) {
    const el = doc.querySelector<HTMLElement>(`#${binding.id}`);
    if (!el) continue;

    const current = getPref(binding.key as any);

    if (binding.type === "checkbox") {
      (el as HTMLInputElement).checked = Boolean(current);
      el.addEventListener("command", () => {
        setPref(binding.key as any, (el as HTMLInputElement).checked);
      });
    } else if (binding.type === "menulist") {
      (el as any).value = String(current || binding.defaultValue || "");
      el.addEventListener("command", () => {
        setPref(
          binding.key as any,
          String((el as any).value || binding.defaultValue || ""),
        );
      });
    } else if (binding.type === "number") {
      (el as HTMLInputElement).value = String(
        current || binding.defaultValue || 0,
      );
      el.addEventListener("change", () => {
        const value =
          Number((el as HTMLInputElement).value) || binding.defaultValue || 0;
        setPref(binding.key as any, value);
        (el as HTMLInputElement).value = String(value);
      });
    } else {
      (el as HTMLInputElement).value = String(
        current || binding.defaultValue || "",
      );
      el.addEventListener("change", () => {
        setPref(
          binding.key as any,
          (el as HTMLInputElement).value.trim() ||
            String(binding.defaultValue || ""),
        );
      });
    }
  }
}

const MODIFIER_ONLY_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS"]);

function bindShortcutInput() {
  const doc = addon.data.prefs?.window.document;
  if (!doc) return;

  const input = doc.querySelector<HTMLInputElement>("#mineru-parse-shortcut");
  const clearBtn = doc.querySelector<HTMLElement>(
    "#mineru-parse-shortcut-clear",
  );
  if (!input) return;

  // 初始化显示
  const saved = getPref("shortcut_parse") as string;
  if (saved) {
    input.value = new KeyModifier(saved).getLocalized();
  }

  // 录入快捷键
  input.addEventListener("keydown", (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (MODIFIER_ONLY_KEYS.has(e.key)) return;

    const km = new KeyModifier(e);
    const raw = km.getRaw();
    setPref("shortcut_parse", raw);
    input.value = km.getLocalized();
  });

  // 清除快捷键
  clearBtn?.addEventListener("command", () => {
    setPref("shortcut_parse", "");
    input.value = "";
  });

  // Import shortcut
  const importInput = doc.querySelector<HTMLInputElement>(
    "#mineru-parse-shortcut-import",
  );
  const importClearBtn = doc.querySelector<HTMLElement>(
    "#mineru-parse-shortcut-import-clear",
  );

  if (importInput) {
    const savedImport = getPref("shortcut_import") as string;
    if (savedImport) {
      importInput.value = new KeyModifier(savedImport).getLocalized();
    }

    importInput.addEventListener("keydown", (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (MODIFIER_ONLY_KEYS.has(e.key)) return;

      const km = new KeyModifier(e);
      setPref("shortcut_import", km.getRaw());
      importInput.value = km.getLocalized();
    });

    importClearBtn?.addEventListener("command", () => {
      setPref("shortcut_import", "");
      importInput.value = "";
    });
  }

  // AI shortcut
  const aiInput = doc.querySelector<HTMLInputElement>(
    "#mineru-parse-shortcut-ai",
  );
  const aiClearBtn = doc.querySelector<HTMLElement>(
    "#mineru-parse-shortcut-ai-clear",
  );

  if (aiInput) {
    const savedAI = getPref("shortcut_ai") as string;
    if (savedAI) {
      aiInput.value = new KeyModifier(savedAI).getLocalized();
    }

    aiInput.addEventListener("keydown", (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (MODIFIER_ONLY_KEYS.has(e.key)) return;

      const km = new KeyModifier(e);
      setPref("shortcut_ai", km.getRaw());
      aiInput.value = km.getLocalized();
    });

    aiClearBtn?.addEventListener("command", () => {
      setPref("shortcut_ai", "");
      aiInput.value = "";
    });
  }
}

function loadTemplates(): PromptTemplate[] {
  const json = getPref("ai.promptTemplates") as string;
  if (!json) return BUILTIN_TEMPLATES.map((t) => ({ ...t }));
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) && parsed.length
      ? parsed
      : BUILTIN_TEMPLATES.map((t) => ({ ...t }));
  } catch {
    return BUILTIN_TEMPLATES.map((t) => ({ ...t }));
  }
}

function saveTemplates(templates: PromptTemplate[]): void {
  setPref("ai.promptTemplates", JSON.stringify(templates));
}

function refreshMenulist(
  doc: Document,
  popup: Element,
  templates: PromptTemplate[],
): void {
  while (popup.firstChild) popup.removeChild(popup.firstChild);

  const placeholder = doc.createXULElement("menuitem");
  placeholder.setAttribute("label", "-- 选择模板 --");
  placeholder.setAttribute("value", "");
  popup.appendChild(placeholder);

  for (const tpl of templates) {
    const item = doc.createXULElement("menuitem");
    item.setAttribute("label", tpl.name);
    item.setAttribute("value", tpl.id);
    popup.appendChild(item);
  }
}

function bindTemplateSelector() {
  const doc = addon.data.prefs?.window.document;
  if (!doc) return;

  const menulist = doc.querySelector<HTMLElement>(
    "#mineru-parse-ai-prompt-template",
  );
  const applyBtn = doc.querySelector<HTMLElement>(
    "#mineru-parse-ai-apply-template",
  );
  const saveBtn = doc.querySelector<HTMLElement>(
    "#mineru-parse-ai-save-template",
  );
  const newBtn = doc.querySelector<HTMLElement>(
    "#mineru-parse-ai-new-template",
  );
  const deleteBtn = doc.querySelector<HTMLElement>(
    "#mineru-parse-ai-delete-template",
  );
  const resetBtn = doc.querySelector<HTMLElement>(
    "#mineru-parse-ai-reset-templates",
  );
  if (!menulist || !applyBtn) return;

  const popup = menulist.querySelector("menupopup");
  if (!popup) return;

  let templates = loadTemplates();
  refreshMenulist(doc, popup, templates);
  (menulist as any).selectedIndex = 0;

  const getTextarea = () =>
    doc.querySelector<HTMLTextAreaElement>("#mineru-parse-ai-system-prompt");

  // 应用模板
  applyBtn.addEventListener("command", () => {
    const selectedId = (menulist as any).value;
    if (!selectedId) return;

    const tpl = templates.find((t) => t.id === selectedId);
    if (!tpl) return;

    const textarea = getTextarea();
    const current = textarea?.value?.trim() || "";
    if (current && current !== tpl.prompt.trim()) {
      const win = addon.data.prefs?.window;
      if (win && !win.confirm("当前提示词将被替换，是否继续？")) return;
    }

    if (textarea) textarea.value = tpl.prompt;
    setPref("ai.systemPrompt", tpl.prompt);
    (menulist as any).selectedIndex = 0;
  });

  // 保存模板
  saveBtn?.addEventListener("command", () => {
    const selectedId = (menulist as any).value;
    if (!selectedId) return;

    const textarea = getTextarea();
    if (!textarea) return;

    const idx = templates.findIndex((t) => t.id === selectedId);
    if (idx === -1) return;

    templates[idx].prompt = textarea.value;
    saveTemplates(templates);
  });

  // 新建模板
  newBtn?.addEventListener("command", () => {
    const win = addon.data.prefs?.window;
    if (!win) return;

    const name = win.prompt("请输入模板名称：");
    if (!name?.trim()) return;

    const textarea = getTextarea();
    const prompt = textarea?.value?.trim() || "";

    const tpl: PromptTemplate = {
      id: `custom_${Date.now()}`,
      name: name.trim(),
      prompt,
    };
    templates.push(tpl);
    saveTemplates(templates);
    refreshMenulist(doc, popup, templates);

    // 选中新模板
    (menulist as any).selectedIndex = templates.length;
  });

  // 删除模板
  deleteBtn?.addEventListener("command", () => {
    const selectedId = (menulist as any).value;
    if (!selectedId) return;

    const win = addon.data.prefs?.window;
    const tpl = templates.find((t) => t.id === selectedId);
    if (!tpl || !win) return;

    if (!win.confirm(`确定删除模板「${tpl.name}」吗？`)) return;

    templates = templates.filter((t) => t.id !== selectedId);
    saveTemplates(templates);
    refreshMenulist(doc, popup, templates);
    (menulist as any).selectedIndex = 0;
  });

  // 恢复默认
  resetBtn?.addEventListener("command", () => {
    const win = addon.data.prefs?.window;
    if (!win) return;

    if (!win.confirm("将恢复为内置默认模板，自定义模板将被清除。是否继续？"))
      return;

    templates = BUILTIN_TEMPLATES.map((t) => ({ ...t }));
    saveTemplates(templates);
    refreshMenulist(doc, popup, templates);
    (menulist as any).selectedIndex = 0;
  });
}
