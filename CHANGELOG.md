# Changelog

## Unreleased

## v0.5.5 - 2026-08-18

### Changed

- 升级 `zotero-plugin-toolkit` 至 5.2.0，并迁移 `ZoteroToolkit` 至新的 `/ztoolkit` 导入路径。
- 同步采用 Toolkit 5.2.0 的快捷键解析修复，并移除上游遗留的 Zotero 6 兼容代码。

### Fixed

- 增加对已删除或失效 Zotero 条目的安全检查，避免自动解析、批量队列和 AI 笔记查找访问无效条目。

## v0.5.4 - 2026-08-18

### Changed

- 新增 Zotero 10 兼容支持，插件支持范围更新为 Zotero 7、8、9 和 10。
- 同步更新中英文安装与兼容性说明；Zotero 10 用户需使用 Better Notes 3.2.6 或更高版本。

## v0.5.3 - 2026-04-11

### Changed

- 适配 Zotero 9，插件版本范围更新为同时支持 Zotero 7、8、9。
- 同步更新 README 中的支持版本说明，避免发布页与安装条件不一致。
