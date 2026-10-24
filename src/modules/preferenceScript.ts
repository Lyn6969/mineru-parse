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
  key: keyof _ZoteroTypes.Prefs["PluginPrefsMap"];
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
];

function bindPrefEvents() {
  const doc = addon.data.prefs?.window.document;
  if (!doc) return;

  for (const binding of PREF_BINDINGS) {
    const el = doc.querySelector<HTMLElement>(`#${binding.id}`);
    if (!el) continue;

    const current = getPref(binding.key);

    if (binding.type === "checkbox") {
      (el as HTMLInputElement).checked = Boolean(current);
      el.addEventListener("command", () => {
        setPref(binding.key, (el as HTMLInputElement).checked);
      });
    } else if (binding.type === "menulist") {
      (el as any).value = String(current || binding.defaultValue || "");
      el.addEventListener("command", () => {
        setPref(
          binding.key,
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
        setPref(binding.key, value);
        (el as HTMLInputElement).value = String(value);
      });
    } else {
      (el as HTMLInputElement).value = String(
        current || binding.defaultValue || "",
      );
      el.addEventListener("change", () => {
        setPref(
          binding.key,
          (el as HTMLInputElement).value.trim() ||
            String(binding.defaultValue || ""),
        );
      });
    }
  }
}

const MODIFIER_ONLY_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS"]);

const SHORTCUT_BINDINGS = [
  {
    inputId: "mineru-parse-shortcut",
    clearId: "mineru-parse-shortcut-clear",
    key: "shortcut_parse",
  },
  {
    inputId: "mineru-parse-shortcut-import",
    clearId: "mineru-parse-shortcut-import-clear",
    key: "shortcut_import",
  },
] as const;

function bindShortcutInput() {
  const doc = addon.data.prefs?.window.document;
  if (!doc) return;

  for (const binding of SHORTCUT_BINDINGS) {
    const input = doc.querySelector<HTMLInputElement>(`#${binding.inputId}`);
    if (!input) continue;
    const clearBtn = doc.querySelector<HTMLElement>(`#${binding.clearId}`);

    const saved = getPref(binding.key);
    if (saved) {
      input.value = new KeyModifier(saved).getLocalized();
    }

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (MODIFIER_ONLY_KEYS.has(e.key)) return;

      const km = new KeyModifier(e);
      setPref(binding.key, km.getRaw());
      input.value = km.getLocalized();
    });

    clearBtn?.addEventListener("command", () => {
      setPref(binding.key, "");
      input.value = "";
    });
  }
}
