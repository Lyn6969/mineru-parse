/* global Zotero, document, window */
"use strict";

document.addEventListener(
  "load",
  (event) => {
    if (event.target?.id !== "zotero-prefpane-__addonRef__") {
      return;
    }
    Zotero.__addonInstance__.hooks.onPrefsEvent("load", { window });
  },
  true,
);
