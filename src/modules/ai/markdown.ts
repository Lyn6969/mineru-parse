import { getString } from "../../utils/locale";

type BetterNotesGateway = {
  api: {
    convert: {
      md2html(markdown: string): Promise<string>;
    };
  };
};

export function requireBetterNotes(): BetterNotesGateway {
  // Better Notes is an optional plugin global; check its complete API before use.
  const betterNotes = (
    Zotero as unknown as { BetterNotes?: BetterNotesGateway }
  ).BetterNotes;
  if (!betterNotes?.api?.convert?.md2html) {
    throw new Error(getString("error-better-notes-missing"));
  }
  return betterNotes;
}

export async function markdownToHtml(markdown: string): Promise<string> {
  return requireBetterNotes().api.convert.md2html(markdown);
}
