import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { analyzeWithAI } from "./ai/analysisService";

const menuIcon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;

export function registerItemMenu(_win: Window) {
  ztoolkit.Menu.register("item", {
    tag: "menu",
    id: `${config.addonRef}-itemmenu-root`,
    label: getString("menuitem-root"),
    icon: menuIcon,
    children: [
      {
        tag: "menuitem",
        id: `${config.addonRef}-itemmenu-parse`,
        label: getString("menuitem-parse"),
        commandListener: () => {
          addon.hooks.onParseSelectedItem();
        },
      },
      {
        tag: "menuitem",
        id: `${config.addonRef}-itemmenu-parse-force`,
        label: getString("menuitem-parse-force"),
        commandListener: () => {
          addon.hooks.onParseSelectedItem({ force: true });
        },
      },
      {
        tag: "menuitem",
        id: `${config.addonRef}-itemmenu-ai-analyze`,
        label: getString("menu-ai-analyze"),
        commandListener: async () => {
          const pane = Zotero.getActiveZoteroPane();
          const selectedItems = pane?.getSelectedItems() || [];
          const item = selectedItems[0];
          if (!item) {
            Zotero.getMainWindow().alert(getString("error-no-selection"));
            return;
          }

          if (item.isNote() && item.parentItem) {
            await analyzeWithAI(item.parentItem, item);
          } else if (item.isRegularItem()) {
            await analyzeWithAI(item);
          } else if (item.isAttachment() && item.parentItem?.isRegularItem()) {
            await analyzeWithAI(item.parentItem);
          } else {
            Zotero.getMainWindow().alert(getString("error-no-selection"));
          }
        },
      },
      {
        tag: "menuitem",
        id: `${config.addonRef}-itemmenu-add-to-batch`,
        label: getString("menuitem-add-to-batch"),
        commandListener: () => {
          addon.hooks.onAddToBatch();
        },
      },
    ],
  });
}

export function registerToolsMenu(_win: Window) {
  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: `${config.addonRef}-tools-batch-parse`,
    label: getString("menuitem-batch-parse"),
    icon: menuIcon,
    commandListener: () => {
      addon.hooks.onOpenBatchWindow();
    },
  });
}
