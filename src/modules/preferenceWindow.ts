import { config } from "../../package.json";

export function registerPrefsWindow() {
  Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: config.addonName,
    image: `chrome://${config.addonRef}/content/icons/favicon.png`,
  });
}
