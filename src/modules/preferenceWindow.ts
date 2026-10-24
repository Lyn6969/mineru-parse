import { config } from "../../package.json";

export async function registerPrefsWindow() {
  const paneID = `${config.addonRef}-preferences`;
  if (Zotero.PreferencePanes.pluginPanes.some((pane) => pane.id === paneID)) {
    return;
  }

  await Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    id: paneID,
    src: rootURI + "content/preferences.xhtml",
    scripts: [rootURI + "content/scripts/preferences-init.js"],
    label: config.addonName,
    image: `chrome://${config.addonRef}/content/icons/favicon.png`,
  });
}
