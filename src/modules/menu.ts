import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { analyzeWithAI } from "./ai/analysisService";
import { translateNote } from "./ai/translateService";

const menuIcon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
const toolbarIcon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;

/** Fluent l10nID 前缀，与 locale.ts 一致 */
const L10N_PREFIX = `${config.addonRef}-`;

/** 已注册的 menuID，用于卸载时清理 */
const registeredMenuIDs: string[] = [];

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
 * 注册右键条目菜单（submenu + 子菜单项）
 */
export function registerItemMenu(_win: Window) {
  const menuID = `${config.addonRef}-itemmenu-root`;

  (Zotero as any).MenuManager.registerMenu({
    menuID,
    pluginID: config.addonID,
    target: "main/library/item",
    l10nID: `${L10N_PREFIX}menuitem-root`,
    icon: menuIcon,
    menuType: "submenu",
    menus: [
      {
        menuType: "menuitem",
        l10nID: `${L10N_PREFIX}menuitem-parse`,
        icon: menuIcon,
        onCommand: () => {
          addon.hooks.onParseSelectedItem();
        },
      },
      {
        menuType: "menuitem",
        l10nID: `${L10N_PREFIX}menuitem-parse-force`,
        icon: menuIcon,
        onCommand: () => {
          addon.hooks.onParseSelectedItem({ force: true });
        },
      },
      {
        menuType: "menuitem",
        l10nID: `${L10N_PREFIX}menu-ai-analyze`,
        icon: menuIcon,
        onCommand: () => {
          dispatchSelectedItem(analyzeWithAI);
        },
      },
      {
        menuType: "menuitem",
        l10nID: `${L10N_PREFIX}menu-translate`,
        icon: menuIcon,
        onCommand: () => {
          dispatchSelectedItem(translateNote);
        },
      },
      {
        menuType: "menuitem",
        l10nID: `${L10N_PREFIX}menuitem-add-to-batch`,
        icon: menuIcon,
        onCommand: () => {
          addon.hooks.onAddToBatch();
        },
      },
    ],
  });

  registeredMenuIDs.push(menuID);
}

/**
 * 注册 Tools 主菜单项
 */
export function registerToolsMenu(_win: Window) {
  const menuID = `${config.addonRef}-tools-batch-parse`;

  (Zotero as any).MenuManager.registerMenu({
    menuID,
    pluginID: config.addonID,
    target: "main/menubar/tools",
    l10nID: `${L10N_PREFIX}menuitem-batch-parse`,
    icon: menuIcon,
    menuType: "menuitem",
    onCommand: () => {
      addon.hooks.onOpenBatchWindow();
    },
  });

  registeredMenuIDs.push(menuID);
}

/**
 * 注册工具栏按钮（无原生 API，使用 ztoolkit.UI）
 */
export function registerToolbarButton(win: Window) {
  const doc = win.document;
  const toolbar = doc.getElementById("zotero-items-toolbar");
  if (!toolbar) return;

  // 在 spacer 之前插入按钮（spacer 是工具栏左侧按钮和右侧搜索框的分隔）
  const spacer = toolbar.querySelector("spacer");
  if (!spacer) return;

  const btnId = `${config.addonRef}-tb-batch-parse`;

  ztoolkit.UI.insertElementBefore(
    {
      tag: "toolbarbutton",
      id: btnId,
      namespace: "xul",
      classList: ["zotero-tb-button", "toolbarbutton-1"],
      attributes: {
        tooltiptext: getString("toolbar-batch-parse"),
        tabindex: "-1",
      },
      styles: {
        listStyleImage: `url(${toolbarIcon})`,
      },
      listeners: [
        {
          type: "command",
          listener: () => {
            addon.hooks.onOpenBatchWindow();
          },
        },
      ],
      ignoreIfExists: true,
    },
    spacer as HTMLElement,
  );
}

/**
 * 卸载所有通过原生 API 注册的菜单
 */
export function unregisterMenus() {
  for (const menuID of registeredMenuIDs) {
    try {
      (Zotero as any).MenuManager.unregisterMenu(menuID);
    } catch {
      // 忽略卸载失败
    }
  }
  registeredMenuIDs.length = 0;
}
