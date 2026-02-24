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

function bindPrefEvents() {
  const doc = addon.data.prefs?.window.document;
  if (!doc) return;

  for (const binding of PREF_BINDINGS) {
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
  if (!menulist || !applyBtn) return;

  // 填充下拉框
  const popup = menulist.querySelector("menupopup");
  if (!popup) return;

  const placeholder = doc.createXULElement("menuitem");
  placeholder.setAttribute("label", "-- 选择模板 --");
  placeholder.setAttribute("value", "");
  popup.appendChild(placeholder);

  for (const tpl of BUILTIN_TEMPLATES) {
    const item = doc.createXULElement("menuitem");
    item.setAttribute("label", tpl.name);
    item.setAttribute("value", tpl.id);
    popup.appendChild(item);
  }

  (menulist as any).selectedIndex = 0;

  // 点击"应用模板"
  applyBtn.addEventListener("command", () => {
    const selectedId = (menulist as any).value;
    if (!selectedId) return;

    const tpl = BUILTIN_TEMPLATES.find((t) => t.id === selectedId);
    if (!tpl) return;

    const textarea = doc.querySelector<HTMLTextAreaElement>(
      "#mineru-parse-ai-system-prompt",
    );
    if (textarea) {
      textarea.value = tpl.prompt;
    }
    setPref("ai.systemPrompt" as any, tpl.prompt);

    // 重置下拉框到占位项
    (menulist as any).selectedIndex = 0;
  });
}
