/* global Services, document, window */
"use strict";

document.addEventListener("DOMContentLoaded", () => {
  Services.scriptloader.loadSubScript(
    "chrome://zotero/content/include.js",
    window,
  );
  window.arguments[0]._initPromise.resolve();
});
