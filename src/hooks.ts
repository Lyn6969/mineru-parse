import { registerPrefsScripts } from "./modules/preferenceScript";
import { registerPrefsWindow } from "./modules/preferenceWindow";
import {
  registerItemMenu,
  registerToolsMenu,
  registerToolbarButton,
} from "./modules/menu";
import { parseSelectedItem } from "./modules/parse";
import { importLatestPdfAndParse } from "./modules/importAndParse";
import { openBatchParseWindow } from "./modules/batchParse/window";
import { analyzeWithAI } from "./modules/ai/analysisService";
import {
  registerAutoParseObserver,
  unregisterAutoParseObserver,
} from "./modules/autoParse";
import { getString, initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import { getPref } from "./utils/prefs";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  registerPrefsWindow();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  const popupWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: 4000,
  })
    .createLine({
      text: getString("startup-begin"),
      type: "default",
      progress: 0,
    })
    .show();

  registerItemMenu(win);
  registerToolsMenu(win);
  registerToolbarButton(win);
  registerShortcut();
  registerAutoParseObserver();

  popupWin.changeLine({
    progress: 100,
    text: getString("startup-finish"),
  });
}

function registerShortcut() {
  ztoolkit.Keyboard.register((event, { keyboard }) => {
    if (!keyboard) return;

    const parseKey = getPref("shortcut_parse") as string;
    if (parseKey && keyboard.equals(parseKey)) {
      event.preventDefault();
      addon.hooks.onParseSelectedItem();
      return;
    }

    const importKey = getPref("shortcut_import") as string;
    if (importKey && keyboard.equals(importKey)) {
      event.preventDefault();
      addon.hooks.onImportAndParse();
      return;
    }

    const aiKey = getPref("shortcut_ai") as string;
    if (aiKey && keyboard.equals(aiKey)) {
      event.preventDefault();
      addon.hooks.onAnalyzeSelectedItem();
    }
  });
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  unregisterAutoParseObserver();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  if (type === "load") {
    registerPrefsScripts(data.window);
  }
}

async function onParseSelectedItem(options?: { force?: boolean }) {
  await parseSelectedItem(options);
}

async function onImportAndParse() {
  await importLatestPdfAndParse();
}

async function onAnalyzeSelectedItem() {
  await dispatchSelectedItem(analyzeWithAI);
}

async function onOpenBatchParseWindow() {
  await openBatchParseWindow();
}

async function dispatchSelectedItem(
  handler: (parent: Zotero.Item, note?: Zotero.Item) => Promise<void>,
) {
  const pane = Zotero.getActiveZoteroPane();
  const selectedItems = pane?.getSelectedItems() || [];
  const item = selectedItems[0];
  if (!item) {
    Zotero.getMainWindow().alert(getString("error-no-selection"));
    return;
  }

  if (item.isNote() && item.parentItem) {
    await handler(item.parentItem, item);
    return;
  }

  if (item.isRegularItem()) {
    await handler(item);
    return;
  }

  if (item.isAttachment() && item.parentItem?.isRegularItem()) {
    await handler(item.parentItem);
    return;
  }

  Zotero.getMainWindow().alert(getString("error-no-selection"));
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
  onParseSelectedItem,
  onImportAndParse,
  onAnalyzeSelectedItem,
  onOpenBatchParseWindow,
};
