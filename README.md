# Mineru Parse

[![Zotero 7 | 8](https://img.shields.io/badge/Zotero-7_|_8-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=flat-square)](https://www.gnu.org/licenses/agpl-3.0)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

English | [简体中文](./README.zh.md)

---

<a id="english"></a>

## English

### What is Mineru Parse?

Mineru Parse is a Zotero plugin (supports Zotero 7 & 8) that converts PDF attachments into structured Zotero notes using the [MinerU](https://mineru.net) cloud parsing service. It automatically extracts text, formulas, tables, and images from PDFs and imports them as rich Zotero notes via [Better Notes](https://github.com/windingwind/zotero-better-notes).

### Features

- **One-click PDF to Note** — Right-click any item to parse its PDF and generate a structured note
- **Auto Parse** — Automatically parse PDF when new attachments are added to items
- **Import & Parse** — Import the latest PDF from a configured folder and auto-parse it
- **Batch Parse Window** — Open a dedicated window to detect unparsed selected papers and parse them in queue
- **AI Analysis** — Send parsed notes to an LLM for intelligent analysis and interpretation; automatically triggers PDF parsing if no parsed note exists; includes 5 built-in prompt templates with full customization (edit, create, delete)
- **Full content extraction** — Text, mathematical formulas, tables, and images
- **Smart caching** — Parsed results are cached locally to avoid redundant API calls
- **Batch image import** — High-performance parallel image reading and embedding
- **Two parsing models** — Choose between `pipeline` (traditional) and `vlm` (vision-language model)
- **Bilingual UI** — English and Simplified Chinese interface
- **Customizable shortcuts** — Configure keyboard shortcuts for quick actions

### Prerequisites

1. **[Zotero 7 or 8](https://www.zotero.org/download/)** (version 6.999+)
2. **[Better Notes](https://github.com/windingwind/zotero-better-notes)** plugin — required for Markdown-to-HTML conversion
3. **MinerU API Token** — register at [mineru.net](https://mineru.net) to obtain your token

### Installation

1. Download the latest `.xpi` file from [Releases](https://github.com/LYN6969/mineru-parse/releases)
2. In Zotero, go to `Tools` → `Add-ons`
3. Click the gear icon → `Install Add-on From File...`
4. Select the downloaded `.xpi` file

### Quick Start

1. **Set your Token**: Go to `Edit` → `Settings` → `Mineru Parse`, enter your MinerU API token
2. **Parse a PDF**: Right-click an item with a PDF attachment → `Mineru` → `Mineru: Parse PDF to Note`
3. Wait for the progress indicator to complete — a new note will be created under the item

### Usage

#### Right-click Menu

| Menu Item                      | Description                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| **Mineru: Parse PDF to Note**  | Parse the PDF and create a note. Uses cached result if available                         |
| **Mineru: Force Re-parse**     | Ignore cache and re-upload the PDF for fresh parsing                                     |
| **Mineru: Import & Parse PDF** | Import the latest PDF from configured folder and auto-parse it                           |
| **Mineru: Batch Parse Window** | Open the batch task window, detect unparsed selected items, then run batch parse         |
| **AI Analyze**                 | Send the parsed note to an LLM for analysis; auto-triggers parsing if no note exists yet |

#### Tools Menu

| Menu Item       | Description                                           |
| --------------- | ----------------------------------------------------- |
| **Batch Parse** | Open a dedicated batch task window for selected items |

#### Workflow

```
Select item → Right-click → Mineru → Parse PDF to Note
  ├── Cache hit → Import directly from local cache
  └── Cache miss →
      1. Upload PDF to MinerU API
      2. Poll for parsing progress
      3. Download parsed result (ZIP)
      4. Extract Markdown + images
      5. Convert Markdown to HTML (via Better Notes)
      6. Import images as Zotero attachments
      7. Create note with embedded images
```

#### Auto Parse

Enable auto-parse in settings to automatically parse PDFs when they are added to items.

**How it works:**

1. When a PDF attachment is added to an item, the plugin automatically starts parsing
2. A progress window shows the current parsing status
3. Parsed notes are created automatically upon completion

**Note:** Auto-parse skips items that already have a parsed note to avoid duplicates.

#### Import & Parse

Import the latest PDF from a configured folder and automatically parse it.

**Setup:**

1. Configure the PDF import folder in settings
2. Select an item in Zotero
3. Right-click → `Mineru` → `Import & Parse PDF`
4. The latest PDF from the folder will be imported as an attachment and parsed automatically

**Keyboard Shortcut:** Configure a custom shortcut in settings for quick access.

### Settings

| Setting             | Default         | Description                                                                           |
| ------------------- | --------------- | ------------------------------------------------------------------------------------- |
| **Token**           | _(empty)_       | Your MinerU API token (required)                                                      |
| **Model Version**   | `pipeline`      | Parsing model: `pipeline` (traditional OCR pipeline) or `vlm` (vision-language model) |
| **Enable OCR**      | Off             | Force OCR for scanned PDFs                                                            |
| **Enable Formula**  | On              | Recognize mathematical formulas                                                       |
| **Enable Table**    | On              | Recognize tables                                                                      |
| **Language**        | `ch`            | Document language (`ch` for Chinese, `en` for English, etc.)                          |
| **Page Ranges**     | _(empty)_       | Parse specific pages only (e.g. `1-5,10`)                                             |
| **Cache Directory** | _(system temp)_ | Custom directory for caching parsed results                                           |
| **Poll Interval**   | `3000` ms       | How often to check parsing status                                                     |
| **Poll Timeout**    | `900000` ms     | Maximum wait time for parsing (15 minutes)                                            |
| **Auto Parse**      | On              | Automatically parse PDF when new attachments are added                                |
| **Parse Shortcut**  | `Ctrl+M`        | Keyboard shortcut to trigger PDF parsing                                              |
| **Import Shortcut** | `Ctrl+Shift+M`  | Keyboard shortcut to import and parse PDF                                             |
| **AI Shortcut**     | `Ctrl+Shift+A`  | Keyboard shortcut to trigger AI analysis for selected item                            |
| **Import Folder**   | _(empty)_       | Folder path to import PDFs from                                                       |

#### AI Analysis Settings

| Setting              | Default                     | Description                                                                                                                                                    |
| -------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API URL**          | `https://api.openai.com/v1` | OpenAI-compatible API endpoint                                                                                                                                 |
| **API Key**          | _(empty)_                   | API key for the LLM service (required for AI analysis)                                                                                                         |
| **Model**            | `gpt-4o`                    | Model name to use                                                                                                                                              |
| **System Prompt**    | _(default)_                 | Custom system prompt; supports `{{title}}`, `{{authors}}`, etc.                                                                                                |
| **Preset Templates** | 5 built-in                  | Choose from preset prompt templates (General, Method, Literature Review, Plain Summary, Critical Review); supports edit, create, delete, and reset to defaults |

### File Size Limit

PDF files larger than **200 MB** are not supported.

### Building from Source

```bash
# Install dependencies
npm install

# Development mode with hot reload
npm start

# Production build
npm run build
# Output: .scaffold/build/mineru-parse.xpi

# Lint
npm run lint:check

# Release
npm run release
```

### Project Structure

```
src/
├── index.ts                    # Plugin entry point
├── addon.ts                    # Addon class definition
├── hooks.ts                    # Lifecycle hooks
├── modules/
│   ├── parse.ts                # Core parsing logic (API, cache, ZIP extraction)
│   ├── autoParse.ts            # Auto-parse PDF when attachments are added
│   ├── importAndParse.ts       # Import PDF from folder and parse
│   ├── imageImporter.ts        # Batch image import with parallel I/O
│   ├── batchParse/             # Batch parse window and queue orchestration
│   ├── menu.ts                 # Right-click context menu & Tools menu
│   ├── ai/                     # AI analysis module
│   │   ├── types.ts            # Type definitions
│   │   ├── apiClient.ts        # OpenAI-compatible API client (SSE streaming)
│   │   ├── promptTemplate.ts   # Prompt template with variable substitution
│   │   └── analysisService.ts  # Analysis orchestration
│   ├── preferenceScript.ts     # Preference panel event binding
│   └── preferenceWindow.ts     # Preference pane registration
└── utils/
    ├── locale.ts               # i18n utilities
    ├── prefs.ts                # Preference read/write helpers
    └── ztoolkit.ts             # ZoteroToolkit initialization

addon/
├── bootstrap.js                # Zotero bootstrap loader
├── manifest.json               # Plugin manifest
├── prefs.js                    # Default preference values
├── content/
│   ├── preferences.xhtml       # Preference panel UI
│   └── icons/                  # Plugin icons
└── locale/
    ├── en-US/                  # English localization
    └── zh-CN/                  # Chinese localization
```

### Acknowledgements

- [MinerU](https://mineru.net) — PDF parsing API
- [Better Notes](https://github.com/windingwind/zotero-better-notes) — Markdown to HTML conversion
- [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template) — Plugin scaffold
- [Zotero Plugin Toolkit](https://github.com/windingwind/zotero-plugin-toolkit) — Plugin utilities

### License

[AGPL-3.0-or-later](LICENSE)
