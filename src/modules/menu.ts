import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { analyzeWithAI } from "./ai/analysisService";
import { translateNote } from "./ai/translateService";

const menuIcon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;

/**
 * 将选中条目分发到对应的 AI 服务函数
 */
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
  } else if (item.isRegularItem()) {
    await handler(item);
  } else if (item.isAttachment() && item.parentItem?.isRegularItem()) {
    await handler(item.parentItem);
  } else {
    Zotero.getMainWindow().alert(getString("error-no-selection"));
  }
}

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
        image: menuIcon,
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
                image: menuIcon,
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
                image: menuIcon,
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
                image: menuIcon,
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
                image: menuIcon,
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
          ],
        },
      ],
    },
    popup,
  );
}

/**
 * 注册 Tools 主菜单项（DOM 方式，逐窗口）
 */
export function registerToolsMenu(_win: Window) {}

/**
 * 注册工具栏按钮
 */
export function registerToolbarButton(_win: Window) {}
