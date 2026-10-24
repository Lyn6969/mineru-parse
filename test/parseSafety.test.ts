import { assert } from "chai";
import { config } from "../package.json";
import { hasExistingParsedNote, parseItem } from "../src/modules/parse";
import { prepareImageTasks } from "../src/modules/imageImporter";
import { setPref } from "../src/utils/prefs";

Object.assign(globalThis, {
  addon: {
    data: {
      config,
    },
  },
});

const DEFAULT_OPTIONS = {
  model_version: "pipeline",
  is_ocr: false,
  enable_formula: true,
  enable_table: true,
  language: "ch",
  page_ranges: "",
};

type Fixture = {
  item: Zotero.Item;
  attachment: Zotero.Item;
  filePath: string;
  cacheBase: string;
};

const cleanupPaths: string[] = [];
let fixtureCounter = 0;
const originalFetch = globalThis.fetch;

function installBetterNotes(markdownToHtml: (md: string) => Promise<string>) {
  Object.assign(Zotero, {
    BetterNotes: {
      api: {
        convert: {
          md2html: markdownToHtml,
        },
      },
    },
  });
}

async function createFixture(): Promise<Fixture> {
  const suffix = `${Date.now()}-${fixtureCounter++}`;
  const root = PathUtils.join(
    Zotero.getTempDirectory().path,
    `mineru-parse-test-${suffix}`,
  );
  const cacheBase = PathUtils.join(root, "cache");
  cleanupPaths.push(root);
  await IOUtils.makeDirectory(cacheBase, {
    createAncestors: true,
    ignoreExisting: true,
  });

  const filePath = PathUtils.join(root, "paper.pdf");
  await IOUtils.write(
    filePath,
    new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"),
  );

  const item = new Zotero.Item("book");
  item.libraryID = Zotero.Libraries.userLibraryID;
  await item.saveTx();
  const attachment = await Zotero.Attachments.importFromFile({
    file: filePath,
    parentItemID: item.id,
  });
  if (!attachment) {
    throw new Error("Failed to create PDF fixture");
  }

  setPref("cache_dir", cacheBase);
  setPref("token", "");
  setPref("model_version", DEFAULT_OPTIONS.model_version);
  setPref("is_ocr", DEFAULT_OPTIONS.is_ocr);
  setPref("enable_formula", DEFAULT_OPTIONS.enable_formula);
  setPref("enable_table", DEFAULT_OPTIONS.enable_table);
  setPref("language", DEFAULT_OPTIONS.language);
  setPref("page_ranges", DEFAULT_OPTIONS.page_ranges);
  return { item, attachment, filePath, cacheBase };
}

async function writeCache(
  fixture: Fixture,
  metadata: Record<string, unknown>,
): Promise<void> {
  const storedPath = await fixture.attachment.getFilePathAsync();
  if (!storedPath) {
    throw new Error("Failed to resolve stored PDF fixture");
  }
  const stat = await IOUtils.stat(storedPath);
  const cacheDir = PathUtils.join(
    fixture.cacheBase,
    `MineruParse-${fixture.item.key}-cached`,
  );
  await IOUtils.makeDirectory(cacheDir, {
    createAncestors: true,
    ignoreExisting: true,
  });
  const mdPath = PathUtils.join(cacheDir, "full.md");
  await IOUtils.write(
    mdPath,
    new TextEncoder().encode("# Parsed title\n\nBody\n"),
  );
  await IOUtils.writeJSON(PathUtils.join(cacheDir, "cache-info.json"), {
    itemKey: fixture.item.key,
    attachmentKey: fixture.attachment.key,
    attachmentSize: stat.size,
    attachmentMtime: stat.lastModified,
    mdPath,
    createdAt: Date.now(),
    ...metadata,
  });
}

async function writeLegacyCache(fixture: Fixture): Promise<void> {
  const cacheDir = PathUtils.join(
    fixture.cacheBase,
    `MineruParse-${fixture.item.key}-legacy`,
  );
  await IOUtils.makeDirectory(cacheDir, {
    createAncestors: true,
    ignoreExisting: true,
  });
  await IOUtils.write(
    PathUtils.join(cacheDir, "full.md"),
    new TextEncoder().encode("# Legacy title\n"),
  );
}

async function expectTokenError(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, /token/i);
    return;
  }
  assert.fail("Expected a cache miss and missing-token error");
}

describe("parse cache and note commit safety", function () {
  this.timeout(20_000);

  beforeEach(function () {
    installBetterNotes(async (md) => `<p>${md}</p>`);
  });

  afterEach(async function () {
    globalThis.fetch = originalFetch;
    Reflect.deleteProperty(Zotero, "BetterNotes");
    setPref("cache_dir", "");
    setPref("page_ranges", "");
    while (cleanupPaths.length) {
      const path = cleanupPaths.pop();
      if (path) {
        await IOUtils.remove(path, { recursive: true, ignoreAbsent: true });
      }
    }
  });

  it("does not trust a cache directory without metadata", async function () {
    const fixture = await createFixture();
    await writeLegacyCache(fixture);
    await expectTokenError(parseItem(fixture.item, fixture.attachment));
  });

  it("treats old metadata without parse options as a cache miss", async function () {
    const fixture = await createFixture();
    await writeCache(fixture, {});
    await expectTokenError(parseItem(fixture.item, fixture.attachment));
  });

  it("does not reuse results after page ranges change", async function () {
    const fixture = await createFixture();
    await writeCache(fixture, { options: DEFAULT_OPTIONS });
    setPref("page_ranges", "1-5");
    await expectTokenError(parseItem(fixture.item, fixture.attachment));
  });

  it("does not mark a failed note import as parsed", async function () {
    const fixture = await createFixture();
    await writeCache(fixture, { options: DEFAULT_OPTIONS });
    let conversionAttempted = false;
    installBetterNotes(async () => {
      conversionAttempted = true;
      throw new Error("conversion failed");
    });

    try {
      await parseItem(fixture.item, fixture.attachment);
    } catch {
      // Expected conversion failure.
    }
    assert.isTrue(conversionAttempted);
    assert.isFalse(hasExistingParsedNote(fixture.item));
  });

  it("marks the note as parsed only after a successful import", async function () {
    const fixture = await createFixture();
    await writeCache(fixture, { options: DEFAULT_OPTIONS });
    await parseItem(fixture.item, fixture.attachment);
    assert.isTrue(hasExistingParsedNote(fixture.item));
  });

  describe("image path containment", function () {
    it("keeps images inside the result directory", function () {
      try {
        const fileDir = Zotero.getTempDirectory().path;
        const tasks = prepareImageTasks(["images/figure.png"], fileDir);
        assert.lengthOf(tasks, 1);
        assert.include(tasks[0].absolutePath, "figure.png");
      } catch (error) {
        assert.fail(
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
        );
      }
    });

    it("rejects traversal and absolute image paths", function () {
      try {
        const fileDir = Zotero.getTempDirectory().path;
        const tasks = prepareImageTasks(
          [
            "../outside.png",
            "%2e%2e/outside.png",
            "/etc/outside.png",
            "C:\\outside.png",
            "\\\\server\\share\\outside.png",
          ],
          fileDir,
        );
        assert.deepEqual(tasks, []);
      } catch (error) {
        assert.fail(
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
        );
      }
    });
  });
});
