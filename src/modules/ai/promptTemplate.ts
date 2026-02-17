const SUPPORTED_TEMPLATE_VARIABLES = new Set([
  "title",
  "authors",
  "year",
  "abstractNote",
  "publicationTitle",
  "DOI",
  "url",
  "date",
  "itemType",
]);

export function replaceTemplateVariables(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, rawKey: string) => {
      const key = rawKey.trim();
      if (!SUPPORTED_TEMPLATE_VARIABLES.has(key)) {
        return "";
      }
      return variables[key] ?? "";
    },
  );
}

export function getItemMetadata(item: Zotero.Item): Record<string, string> {
  const date = getFieldSafely(item, "date");
  const year = getFieldSafely(item, "year") || extractYearFromDate(date);

  return {
    title: getFieldSafely(item, "title"),
    authors: formatCreators(item.getCreators()),
    year,
    abstractNote: getFieldSafely(item, "abstractNote"),
    publicationTitle: getFieldSafely(item, "publicationTitle"),
    DOI: getFieldSafely(item, "DOI"),
    url: getFieldSafely(item, "url"),
    date,
    itemType: item.itemType || "",
  };
}

function formatCreators(creators: _ZoteroTypes.Item.Creator[]): string {
  return creators
    .map((creator) => {
      if (creator.fieldMode === 1) {
        return (creator.lastName || "").trim();
      }
      return `${creator.firstName || ""} ${creator.lastName || ""}`.trim();
    })
    .filter((name) => Boolean(name))
    .join(", ");
}

function getFieldSafely(item: Zotero.Item, field: string): string {
  try {
    return item.getField(field) || "";
  } catch {
    return "";
  }
}

function extractYearFromDate(date: string): string {
  const match = date.match(/\b\d{4}\b/);
  return match ? match[0] : "";
}
