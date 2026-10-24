import { assert } from "chai";
import manifest from "../addon/manifest.json";
import { config } from "../package.json";

type AddonGlobal = {
  hooks: {
    onMainWindowLoad(win: Window): Promise<void>;
    onOpenBatchParseWindow(): Promise<void>;
  };
  data: {
    ztoolkit: unknown;
    prefs?: {
      window: Window;
    };
  };
};

function getAddon(): AddonGlobal {
  // Zotero's plugin registry is keyed dynamically by the manifest instance name.
  return (Zotero as unknown as Record<string, AddonGlobal>)[
    config.addonInstance
  ];
}

async function waitUntil(
  condition: () => boolean,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeout}ms waiting for condition`);
    }
    await Zotero.Promise.delay(50);
  }
}

describe("Zotero 11 compatibility", function () {
  this.timeout(20_000);

  it("declares support for Zotero 11", function () {
    assert.equal(manifest.applications.zotero.strict_min_version, "7.0");
    assert.equal(manifest.applications.zotero.strict_max_version, "11.*");
  });

  it("reuses one toolkit across main window loads", async function () {
    const previousToolkit = getAddon().data.ztoolkit;
    await getAddon().hooks.onMainWindowLoad(Zotero.getMainWindow());
    assert.strictEqual(getAddon().data.ztoolkit, previousToolkit);
  });

  it("declares the item menu icon through the Zotero 11 icon property", function () {
    const doc = Zotero.getMainWindow().document;
    const item = doc.getElementById(`${config.addonRef}-itemmenu-parse`);
    if (!item) {
      throw new Error("Item menu was not registered");
    }

    const icon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
    assert.include(item.style.getPropertyValue("--menuitem-icon"), icon);
  });

  it("keeps MinerU menu actions and removes AI actions", function () {
    const doc = Zotero.getMainWindow().document;
    for (const id of [
      "itemmenu-parse",
      "itemmenu-parse-force",
      "itemmenu-import-parse",
      "itemmenu-batch-window",
    ]) {
      assert.exists(doc.getElementById(`${config.addonRef}-${id}`));
    }
    assert.isNull(doc.getElementById(`${config.addonRef}-itemmenu-ai-analyze`));
    assert.isNull(doc.getElementById(`${config.addonRef}-itemmenu-translate`));
  });

  it("opens batch windows with the external bootstrap script", async function () {
    await getAddon().hooks.onOpenBatchParseWindow();

    const win = Services.wm.getMostRecentWindow(
      `${config.addonRef}-batchParse`,
    );
    if (!win) {
      throw new Error("Batch parse window was not opened");
    }
    assert.exists(
      win.document.querySelector('script[src$="/batch-window-init.js"]'),
    );
    assert.exists(win.document.getElementById("batch-table-container"));

    const statsButton = win.document.getElementById(
      "batch-open-stats",
    ) as HTMLElement | null;
    if (!statsButton) {
      throw new Error("Batch stats button was not registered");
    }
    statsButton.click();
    await waitUntil(
      () =>
        Boolean(
          Services.wm.getMostRecentWindow(`${config.addonRef}-batchStats`),
        ),
      5_000,
    );

    const statsWin = Services.wm.getMostRecentWindow(
      `${config.addonRef}-batchStats`,
    );
    if (!statsWin) {
      throw new Error("Batch stats window was not opened");
    }
    await waitUntil(
      () =>
        Boolean(
          statsWin.document
            .getElementById("batch-stats-refresh")
            ?.getAttribute("title"),
        ),
      5_000,
    );
    assert.exists(
      statsWin.document.querySelector('script[src$="/batch-window-init.js"]'),
    );
    assert.exists(statsWin.document.getElementById("batch-stats-content"));

    statsWin.close();
    win.close();
  });

  it("initializes the preferences pane through an external script", async function () {
    const pane = Zotero.PreferencePanes.pluginPanes.find(
      (entry) => entry.pluginID === config.addonID,
    );
    if (!pane?.id) {
      throw new Error("Preferences pane was not registered");
    }
    assert.isTrue(
      (pane.scripts ?? []).some((script) =>
        script.endsWith("/preferences-init.js"),
      ),
    );

    const win = Zotero.Utilities.Internal.openPreferences(pane.id);
    if (!win) {
      throw new Error("Preferences window was not opened");
    }
    // openDialog() returns before the preferences document has initialized.
    await waitUntil(() => Object.hasOwn(win, "Zotero_Preferences"), 5_000);
    await waitUntil(() => Boolean(getAddon().data.prefs?.window), 10_000);

    const initializedPrefs = getAddon().data.prefs?.window;
    if (!initializedPrefs) {
      throw new Error("Addon preference window was not initialized");
    }
    assert.exists(
      initializedPrefs.document.getElementById(
        `zotero-prefpane-${config.addonRef}`,
      ),
    );
    for (const id of [
      "mineru-parse-token",
      "mineru-parse-auto-parse",
      "mineru-parse-model-version",
      "mineru-parse-is-ocr",
      "mineru-parse-enable-formula",
      "mineru-parse-enable-table",
      "mineru-parse-language",
      "mineru-parse-page-ranges",
      "mineru-parse-cache-dir",
      "mineru-parse-poll-interval",
      "mineru-parse-poll-timeout",
      "mineru-parse-import-folder",
      "mineru-parse-shortcut",
      "mineru-parse-shortcut-clear",
      "mineru-parse-shortcut-import",
      "mineru-parse-shortcut-import-clear",
    ]) {
      assert.exists(initializedPrefs.document.getElementById(id));
    }

    for (const id of [
      "mineru-parse-ai-base-url",
      "mineru-parse-translate-model",
      "mineru-parse-shortcut-ai",
    ]) {
      assert.isNull(initializedPrefs.document.getElementById(id));
    }

    win.close();
  });
});
