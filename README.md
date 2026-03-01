# Mineru Parse

[![Zotero 7 | 8](https://img.shields.io/badge/Zotero-7_|_8-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=flat-square)](https://www.gnu.org/licenses/agpl-3.0)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

[English](#english) | [简体中文](#简体中文)

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

---

<a id="简体中文"></a>

## 简体中文

### 简介

Mineru Parse 是一个 Zotero 插件（支持 Zotero 7 和 8），通过 [MinerU](https://mineru.net) 云端解析服务，将 PDF 附件转换为结构化的 Zotero 笔记。它能自动提取 PDF 中的文本、公式、表格和图片，并借助 [Better Notes](https://github.com/windingwind/zotero-better-notes) 插件生成富文本笔记。

### 功能特性

- **一键 PDF 转笔记** — 右键菜单一键解析 PDF，自动生成结构化笔记
- **自动解析** — 当条目添加 PDF 附件时自动触发解析
- **导入并解析** — 从配置的文件夹中导入最新 PDF 并自动解析
- **批量解析窗口** — 打开独立任务窗口，检测未解析文献并执行批量解析
- **AI 解读** — 将解析笔记发送给大模型进行智能分析解读；无解析笔记时自动触发全文解析；内置 5 个提示词预设模板，支持编辑、新建、删除
- **全内容提取** — 支持文本、数学公式、表格和图片
- **智能缓存** — 解析结果本地缓存，避免重复调用 API
- **批量图片导入** — 高性能并行读取和嵌入图片
- **双模型可选** — `pipeline`（传统 OCR 流水线）和 `vlm`（视觉语言模型）
- **中英双语界面** — 自动适配 Zotero 语言设置
- **自定义快捷键** — 为常用功能配置键盘快捷键

### 前置要求

1. **[Zotero 7 或 8](https://www.zotero.org/download/)**（版本 6.999+）
2. **[Better Notes](https://github.com/windingwind/zotero-better-notes)** 插件 — 用于 Markdown 转 HTML
3. **MinerU API Token** — 在 [mineru.net](https://mineru.net) 注册获取

### 安装方法

1. 从 [Releases](https://github.com/LYN6969/mineru-parse/releases) 下载最新的 `.xpi` 文件
2. 在 Zotero 中，打开 `工具` → `附加组件`
3. 点击齿轮图标 → `从文件安装附加组件…`
4. 选择下载的 `.xpi` 文件

### 快速开始

1. **设置 Token**：打开 `编辑` → `设置` → `Mineru Parse`，填入你的 MinerU API Token
2. **解析 PDF**：右键点击含有 PDF 附件的条目 → `Mineru` → `Mineru：解析 PDF 到笔记`
3. 等待进度条完成，笔记将自动创建在该条目下

### 使用说明

#### 右键菜单

| 菜单项                      | 说明                                           |
| --------------------------- | ---------------------------------------------- |
| **Mineru：解析 PDF 到笔记** | 解析 PDF 并创建笔记，优先使用缓存              |
| **Mineru：强制重新解析**    | 忽略缓存，重新上传 PDF 进行解析                |
| **Mineru：导入并解析 PDF**  | 从配置的文件夹导入最新 PDF 并自动解析          |
| **Mineru：批量解析窗口**    | 打开批量任务窗口，检测未解析条目并批量执行解析 |
| **AI 解读**                 | 将解析笔记发送给大模型分析；无笔记时自动先解析 |

#### 工具菜单

| 菜单项       | 说明                                         |
| ------------ | -------------------------------------------- |
| **批量解析** | 打开独立批量任务窗口，对选中文献执行批量解析 |

#### 工作流程

```
选中条目 → 右键 → Mineru → 解析 PDF 到笔记
  ├── 命中缓存 → 直接从本地缓存导入
  └── 未命中缓存 →
      1. 上传 PDF 到 MinerU API
      2. 轮询解析进度
      3. 下载解析结果（ZIP 包）
      4. 解压提取 Markdown 和图片
      5. Markdown 转 HTML（通过 Better Notes）
      6. 将图片导入为 Zotero 附件
      7. 创建含嵌入图片的笔记
```

#### 自动解析

在设置中启用自动解析功能，当条目添加 PDF 附件时将自动触发解析。

**工作原理：**

1. 当条目添加 PDF 附件时，插件自动开始解析
2. 进度窗口显示当前解析状态
3. 解析完成后自动创建笔记

**注意：** 自动解析会跳过已有解析笔记的条目，避免重复解析。

#### 导入并解析

从配置的文件夹中导入最新的 PDF 文件并自动解析。

**设置步骤：**

1. 在设置中配置 PDF 导入文件夹路径
2. 在 Zotero 中选中一个条目
3. 右键 → `Mineru` → `导入并解析 PDF`
4. 文件夹中最新的 PDF 将被导入为附件并自动解析

**快捷键：** 可在设置中配置自定义快捷键快速触发此功能

### 设置选项

| 选项           | 默认值             | 说明                                                  |
| -------------- | ------------------ | ----------------------------------------------------- |
| **Token**      | _（空）_           | MinerU API Token（必填）                              |
| **解析模型**   | `pipeline`         | `pipeline`（传统 OCR 流水线）或 `vlm`（视觉语言模型） |
| **启用 OCR**   | 关闭               | 对扫描版 PDF 强制使用 OCR                             |
| **识别公式**   | 开启               | 识别数学公式                                          |
| **识别表格**   | 开启               | 识别表格                                              |
| **语言**       | `ch`               | 文档语言（`ch` 中文、`en` 英文等）                    |
| **页码范围**   | _（空）_           | 仅解析指定页码（如 `1-5,10`）                         |
| **缓存目录**   | _（系统临时目录）_ | 自定义解析结果缓存路径                                |
| **轮询间隔**   | `3000` 毫秒        | 查询解析状态的间隔时间                                |
| **轮询超时**   | `900000` 毫秒      | 解析最长等待时间（15 分钟）                           |
| **自动解析**   | 开启               | 当条目添加 PDF 附件时自动触发解析                     |
| **解析快捷键** | `Ctrl+M`           | 触发 PDF 解析的键盘快捷键                             |
| **导入快捷键** | `Ctrl+Shift+M`     | 触发导入并解析的键盘快捷键                            |
| **导入文件夹** | _（空）_           | 导入 PDF 的文件夹路径                                 |

#### AI 解读设置

| 选项           | 默认值                      | 说明                                                                                                         |
| -------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **API 地址**   | `https://api.openai.com/v1` | OpenAI 兼容的 API 端点                                                                                       |
| **API 密钥**   | _（空）_                    | 大模型服务的 API 密钥（使用 AI 解读前必填）                                                                  |
| **模型**       | `gpt-4o`                    | 使用的模型名称                                                                                               |
| **系统提示词** | _（默认）_                  | 自定义系统提示词，支持 `{{title}}`、`{{authors}}` 等变量                                                     |
| **预设模板**   | 5 个内置                    | 可选择预设提示词模板（通用解读、方法论精读、文献综述、通俗摘要、批判性评读）；支持编辑、新建、删除和恢复默认 |

### 文件大小限制

不支持超过 **200 MB** 的 PDF 文件。

### 从源码构建

```bash
# 安装依赖
npm install

# 开发模式（热重载）
npm start

# 生产构建
npm run build
# 产物：.scaffold/build/mineru-parse.xpi

# 代码检查
npm run lint:check

# 发版
npm run release
```

### 项目结构

```
src/
├── index.ts                    # 插件入口
├── addon.ts                    # Addon 类定义
├── hooks.ts                    # 生命周期钩子
├── modules/
│   ├── parse.ts                # 核心解析逻辑（API 交互、缓存、ZIP 解压）
│   ├── autoParse.ts            # 自动解析模块（附件添加时自动触发）
│   ├── importAndParse.ts       # 导入并解析模块（从文件夹导入 PDF）
│   ├── imageImporter.ts        # 批量图片导入（并行 I/O）
│   ├── batchParse/             # 批量解析窗口与队列调度
│   ├── menu.ts                 # 右键菜单与工具菜单注册
│   ├── ai/                     # AI 解读模块
│   │   ├── types.ts            # 类型定义
│   │   ├── apiClient.ts        # OpenAI 兼容 API 客户端（SSE 流式）
│   │   ├── promptTemplate.ts   # 提示词模板变量替换
│   │   └── analysisService.ts  # 分析主流程
│   ├── preferenceScript.ts     # 偏好设置事件绑定
│   └── preferenceWindow.ts     # 偏好设置面板注册
└── utils/
    ├── locale.ts               # 国际化工具
    ├── prefs.ts                # 偏好设置读写
    └── ztoolkit.ts             # ZoteroToolkit 初始化

addon/
├── bootstrap.js                # Zotero 引导加载器
├── manifest.json               # 插件清单
├── prefs.js                    # 偏好默认值
├── content/
│   ├── preferences.xhtml       # 偏好设置 UI
│   └── icons/                  # 插件图标
└── locale/
    ├── en-US/                  # 英文本地化
    └── zh-CN/                  # 中文本地化
```

### 致谢

- [MinerU](https://mineru.net) — PDF 解析服务
- [Better Notes](https://github.com/windingwind/zotero-better-notes) — Markdown 转 HTML
- [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template) — 插件脚手架
- [Zotero Plugin Toolkit](https://github.com/windingwind/zotero-plugin-toolkit) — 插件工具库

### 许可证

[AGPL-3.0-or-later](LICENSE)
