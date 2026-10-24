import { getString } from "./locale";

export async function dispatchSelectedItem(
  handler: (parent: Zotero.Item, note?: Zotero.Item) => Promise<void>,
): Promise<void> {
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
