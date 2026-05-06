# Zotero Doc2X Tag

A lightweight Zotero plugin (v7–9) that automatically adds the **Ⓜ️** tag to a library item whenever a [Doc2X](https://doc2x.noedgeai.com) child note is detected.

## What it does

When the Doc2X Zotero plugin converts a PDF and writes a child note titled `原文MD_doc2x-*` or `parse_-*`, this plugin:

1. Detects the new note (via Zotero's internal Notifier)
2. Finds the parent item
3. Adds the **Ⓜ️** tag automatically — no action required

Once you assign a color to the **Ⓜ️** tag in Zotero's Tag Selector, a colored square appears next to every converted item in the item list.

## Installation

1. Download `doc2x-tag.xpi` from [Releases](https://github.com/huanongfish/zotero-doc2x-tag/releases/latest)
2. In Zotero: **Tools → Add-ons → ⚙️ → Install Add-on From File…**
3. Select the downloaded `.xpi` file and restart Zotero

## Make the tag visible

1. In Zotero's **Tag Selector** (bottom-left panel), find **Ⓜ️**
2. Right-click → **Assign Color** → pick blue → **Set Color**

The **Ⓜ️** square now appears before the title of every item that has a doc2x child note.

## Batch-tag existing items

For items converted before the plugin was installed:

**Tools → Doc2X: scan & tag Ⓜ️**

This scans the currently selected collection (or selected items) and tags any item that already has a `原文MD_doc2x-*` or `parse_-*` child note.

## Supported note prefixes

| Prefix | Source |
|---|---|
| `原文MD_doc2x-*` | Doc2X Zotero plugin (canonical) |
| `原文md_doc2x-*` | Doc2X Zotero plugin (lowercase variant) |
| `parse_-*` | Older parse flavor |

## Requirements

- Zotero 7, 8, or 9
- [Doc2X Zotero Plugin](https://github.com/NoEdgeAI/Doc2XZoteroPlugin9) (for automatic triggering)
