import { getPref, setPref } from "../utils/prefs";
import { KeyModifier } from "zotero-plugin-toolkit";

export async function registerPrefsScripts(_window: Window) {
  if (!addon.data.prefs) {
    addon.data.prefs = { window: _window };
  } else {
    addon.data.prefs.window = _window;
  }
  bindPrefEvents();
  bindShortcutInput();
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

const MODIFIER_ONLY_KEYS = new Set([
  "Control",
  "Shift",
  "Alt",
  "Meta",
  "OS",
]);

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
