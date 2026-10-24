import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { analyzeWithAI } from "./ai/analysisService";
import { translateNote } from "./ai/translateService";
import { dispatchSelectedItem } from "../utils/itemSelection";

const menuIcon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
const menuIconAttributes = {
  image: menuIcon,
  style: `list-style-image: url("${menuIcon}"); --menuitem-icon: url("${menuIcon}");`,
};
let toolsMenuRegistered = false;

/**
 * 注册右键条目菜单（DOM 方式，逐窗口）
 */
export function registerItemMenu(win: Window) {
  const doc = win.document;
  const popup = doc.getElementById("zotero-itemmenu");
  if (!popup) return;

  const rootId = `${config.addonRef}-itemmenu-root`;
  if (doc.getElementById(rootId)) return;

  ztoolkit.UI.appendElement(
    {
      tag: "menu",
      id: rootId,
      namespace: "xul",
      classList: ["menu-iconic"],
      attributes: {
        label: getString("menuitem-root"),
        ...menuIconAttributes,
      },
      children: [
        {
          tag: "menupopup",
          children: [
            {
              tag: "menuitem",
              id: `${config.addonRef}-itemmenu-parse`,
              namespace: "xul",
              classList: ["menuitem-iconic"],
              attributes: {
                label: getString("menuitem-parse"),
                ...menuIconAttributes,
              },
              listeners: [
                {
                  type: "command",
                  listener: () => {
                    addon.hooks.onParseSelectedItem();
                  },
                },
              ],
            },
            {
              tag: "menuitem",
              id: `${config.addonRef}-itemmenu-parse-force`,
              namespace: "xul",
              classList: ["menuitem-iconic"],
              attributes: {
                label: getString("menuitem-parse-force"),
                ...menuIconAttributes,
              },
              listeners: [
                {
                  type: "command",
                  listener: () => {
                    addon.hooks.onParseSelectedItem({ force: true });
                  },
                },
              ],
            },
            {
              tag: "menuitem",
              id: `${config.addonRef}-itemmenu-ai-analyze`,
              namespace: "xul",
              classList: ["menuitem-iconic"],
              attributes: {
                label: getString("menu-ai-analyze"),
                ...menuIconAttributes,
              },
              listeners: [
                {
                  type: "command",
                  listener: () => {
                    dispatchSelectedItem(analyzeWithAI);
                  },
                },
              ],
            },
            {
              tag: "menuitem",
              id: `${config.addonRef}-itemmenu-translate`,
              namespace: "xul",
              classList: ["menuitem-iconic"],
              attributes: {
                label: getString("menu-translate"),
                ...menuIconAttributes,
              },
              listeners: [
                {
                  type: "command",
                  listener: () => {
                    dispatchSelectedItem(translateNote);
                  },
                },
              ],
            },
            {
              tag: "menuitem",
              id: `${config.addonRef}-itemmenu-import-parse`,
              namespace: "xul",
              classList: ["menuitem-iconic"],
              attributes: {
                label: getString("menuitem-import-parse"),
                ...menuIconAttributes,
              },
              listeners: [
                {
                  type: "command",
                  listener: () => {
                    addon.hooks.onImportAndParse();
                  },
                },
              ],
            },
            {
              tag: "menuitem",
              id: `${config.addonRef}-itemmenu-batch-window`,
              namespace: "xul",
              classList: ["menuitem-iconic"],
              attributes: {
                label: getString("menuitem-batch-window"),
                ...menuIconAttributes,
              },
              listeners: [
                {
                  type: "command",
                  listener: () => {
                    addon.hooks.onOpenBatchParseWindow();
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    popup,
  );
}

/**
 * 注册 Tools 主菜单项（使用 MenuManager API）
 */
export function registerToolsMenu(_win: Window) {
  if (toolsMenuRegistered) return;

  const menuManager = (Zotero as any).MenuManager;
  if (!menuManager?.registerMenu) return;

  menuManager.registerMenu({
    menuID: `${config.addonRef}-menuTools`,
    pluginID: config.addonID,
    target: "main/menubar/tools",
    menus: [
      {
        menuType: "separator",
      },
      {
        menuType: "menuitem",
        l10nID: `${config.addonRef}-menu-tools-batch-window`,
        icon: menuIcon,
        onCommand: () => {
          addon.hooks.onOpenBatchParseWindow();
        },
      },
    ],
  });

  toolsMenuRegistered = true;
}
