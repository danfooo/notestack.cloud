# Import Format Exploration

This document summarises the import formats explored for brains, with notes on what each can and can't provide. Use it to inform future importer work.

## Formats

### 1. Apple Privacy Export (ZIP)

Obtained via [privacy.apple.com](https://privacy.apple.com) → "Obtain a copy of your data" → Notes. Apple delivers a ZIP file. Full format reference: [`apple-notes-export-format.html`](./apple-notes-export-format.html).

**Status:** Fully implemented. See `server/src/routes/import.ts` and `server/src/services/importParser.ts`.

### 2. Apple Notes Markdown Export

Obtained by multi-selecting notes in the macOS Notes app and choosing Export as Markdown. Produces a flat folder of `.md` files — one per note — with a shared `Attachments/` subdirectory containing all attachment files named by UUID.

**Status:** Not yet implemented. Sample data in `metadata/notes-export-2026-04-13/`.

Key quirks:
- No folder hierarchy — all notes land in a single `Archive/` directory regardless of their original Apple Notes folder.
- No metadata (dates, pinned state, deleted notes, participants) — the selection/export flow doesn't include CSV sidecar files.
- Content is duplicated N times due to an export bug in the Notes app. Every paragraph, heading, and list item appears repeated verbatim.
- Images are referenced as `![alt](Attachments/UUID.ext)` pointing into the flat shared `Attachments/` folder.
- Filenames are the note title; no mechanism for duplicate titles.

---

## Feature Comparison

| Feature | Apple Privacy Export | Apple Notes MD Export | storizzi/notes-exporter |
|---|---|---|---|
| **Format** | `.txt` with Unicode encoding | `.md` with standard Markdown | `.md` converted from internal HTML |
| **Delivery** | ZIP file | Folder (or ZIP of folder) | `md/` + `data/` folders |
| **Note title** | Wrapper directory name | Filename (minus `.md`) | Filename (minus `-<id>.md`) |
| **Folder hierarchy** | Encoded in directory depth | None — flat `Archive/` | Preserved as directories (`iCloud-<FolderName>/`) |
| **Created date** | `Notes Details.csv` | None | `data/<folder>.json` keyed by note ID |
| **Modified date** | `Notes Details.csv` | None | `data/<folder>.json` keyed by note ID |
| **Pinned flag** | `Notes Details.csv` | None | None |
| **Deleted notes** | `Recently Deleted/` dir, imported with `deleted_at` | None | `iCloud-Recently-Deleted/` dir — no timestamp |
| **Shared note participants** | `Shared Notes Info.csv` (name, masked email, permission, acceptance) | None | None |
| **Subscribed note participants** | `Subscribed Notes Info.csv` (owner info) | None | None |
| **Bold / italic** | Not preserved (plain text) | `**bold**`, `*italic*` | `**bold**`, `*italic*` |
| **Headings** | Not preserved | `## heading` | `## heading` |
| **Tables** | Not preserved | Not preserved | `\| col \| col \|` Markdown tables |
| **Checkboxes** | Unicode `◦` / `✓` with tab encoding | `- [ ]` / `- [x]` | `- [ ]` / `- [x]` |
| **Bullet lists** | `- ` (dash) and `* ` (star), visually distinct | `- ` only | `- ` only |
| **Images** | U+FFFC placeholder in `.txt`, file co-located per note | `![alt](Attachments/UUID.ext)`, flat shared folder | `![](./attachments/<note>-attachment-001.ext)`, per-folder |
| **Image filenames** | Meaningful (`Attachment.png`, `Attachment-1.png`) | UUID (no semantic info) | Sequential per note (`<note>-attachment-001`, `-002`, …) |
| **Other attachments** | PDFs, HEIC, MOV, M4A co-located per note | Same UUID pool | Same `attachments/` pool; extensions may be MIME-type based (e.g. `svg+xml`) |
| **Duplicate content** | No | Yes — export bug repeats lines N times | No — HTML source stores note once |
| **Duplicate titles** | Handled (Apple appends `-N` to filename only) | No mechanism | Disambiguated by numeric ID suffix in filename |
| **Tags** | None | None | None |

### 3. storizzi/notes-exporter Markdown Output

Produced by [storizzi/notes-exporter](https://github.com/storizzi/notes-exporter), an open source tool that runs locally on macOS. The output is structurally similar to the native MD export (format 2) but the pipeline is different and worth understanding.

**Status:** Not yet implemented. Best overall format for content fidelity. Sample data in `temp-sample-data/from-notes-exporter/`.

#### How the pipeline works

```
Apple Notes app
      │
      │  AppleScript (export_notes.scpt)
      ▼
   raw/       Raw HTML exactly as Apple Notes stores it internally.
              Images are base64-encoded blobs inline in the HTML —
              not usable as standalone files.
      │
      │  extract_images.py
      ▼
   html/      Same HTML, but base64 blobs are extracted and saved as
              real image files in attachments/. The HTML now references
              them by filename. Renders correctly in a browser.
      │
      │  convert_to_markdown.py
      ▼
    md/       HTML converted to Markdown. Images become standard
              ![](./attachments/...) references. Portable, Obsidian-
              and Notion-compatible.
```

AppleScript can only read what Notes exposes, which is HTML with embedded base64 images. There is no direct "give me Markdown" API. The pipeline has to peel it apart in stages.

#### What storizzi loses — and why

The Apple iCloud Notes ZIP is ~2GB; the storizzi `md/` + `data/` output is ~351MB. The size difference is not image compression — it's entire attachment types being silently dropped. This is not a storizzi design choice; it is an **AppleScript API limitation**.

`export_notes.scpt` retrieves note content via:
```applescript
set htmlContent to body of theNote
```
The `body` property only returns the note's HTML. Apple embeds images inline as `data:image/...` base64 blobs in that HTML — but all other attachment types (PDF, video, audio, etc.) are simply not surfaced by this API. They have no representation in the HTML body.

`extract_images.py` then extracts only what it knows is there:
```python
if img_src and img_src.startswith("data:image"):
```

So non-image attachments don't get dropped — they were never reachable. To access them you'd need to either read the Notes SQLite database directly (as kzaremski's tool does) or use Apple's privacy export, which packages everything.

| Attachment type | Present in Apple export | Survives storizzi | Reason |
|---|---|---|---|
| PNG / JPEG / GIF / TIFF | Yes | Yes | Embedded as base64 in HTML body |
| HEIC | Yes | Partially | Passes through if embedded; may not always be |
| SVG | Yes | Yes (as `svg+xml` extension) | Embedded as base64 in HTML body |
| PDF | Yes | **No** | Not exposed via AppleScript `body` |
| MOV / MP4 / M4A / OPUS | Yes | **No** | Not exposed via AppleScript `body` |
| ICS (calendar invites) | Yes | **No** | Not exposed via AppleScript `body` |
| PKPASS (boarding passes) | Yes | **No** | Not exposed via AppleScript `body` |
| IPS / DAT / misc files | Yes | **No** | Not exposed via AppleScript `body` |

| Attachment type | Present in Apple export | Survives storizzi |
|---|---|---|
| PNG / JPEG / GIF / TIFF | Yes | Yes |
| HEIC | Yes | Partially (passes through, not converted) |
| SVG | Yes | Yes (as `svg+xml` extension) |
| PDF | Yes | **No** |
| MOV / MP4 / M4A / OPUS | Yes | **No** |
| ICS (calendar invites) | Yes | **No** |
| PKPASS (boarding passes, tickets) | Yes | **No** |
| IPS (crash reports) | Yes | **No** |
| TXT / HTML / DAT / misc files | Yes | **No** |
| Extension-less binary blobs | Yes | **No** |

**Image quality caveat:** storizzi extracts images from the base64 blobs Apple embeds in the HTML. No re-encoding happens, so quality is whatever Apple embedded. However, Apple's HTML may contain downscaled previews rather than the original full-resolution assets — the originals live in the iCloud asset store and may never make it into the export at all. This is an Apple-side limitation, not a storizzi one.

#### Metadata sidecar (data/ folder)

Alongside the `md/` folder, storizzi writes a `data/` folder with one JSON file per Apple Notes folder (e.g. `iCloud-Notes.json`). Each file is a map keyed by Apple's internal note ID (the number suffix in every `.md` filename):

```json
"7969": {
  "created":  "Friday, 3. April 2026 at 21:00:17",
  "modified": "Friday, 3. April 2026 at 21:00:20",
  "filename": "Robert-7969",
  "fullNoteId": "x-coredata://0AF8DC05-8A3A-4E1D-A771-647F036F7F7D/ICNote/p7969",
  "exportCount": 1,
  "firstExported": "...", "lastExported": "...", ...
}
```

Fields useful for import: `created`, `modified`, `filename`. The `fullNoteId` is Apple's CoreData URI — not directly useful but could serve as a deduplication key for incremental re-imports.

Date format is European locale: `"Friday, 3. April 2026 at 21:00:17"` — needs a custom parser, not a standard ISO parser.

#### Key implications for import

- The MD output originates from Apple's **internal HTML representation**, not the plain `.txt` format used in the privacy export. This means it has richer formatting (bold, italic, headings, tables) that format 1 cannot represent.
- **Created and modified dates are fully available** via the JSON sidecar, joined by the numeric ID suffix in the filename. This closes the biggest gap vs the privacy export.
- Images land in a per-folder `attachments/` subdirectory with sequential per-note filenames (`<note-title>-attachment-001.png`), not UUIDs.
- Folder structure is preserved as directories (unlike the native MD export which flattens everything). Folder names are prefixed with `iCloud-` and have spaces replaced with dashes.
- The duplicate-content bug seen in the native MD export does not appear here — the HTML source stores the note once.
- The intermediate `html/` stage is the highest-fidelity artifact. If we ever import from HTML instead of MD we'd get even cleaner structure.
- Attachment file extensions can be MIME-type based (e.g. `svg+xml`) rather than standard extensions — needs normalization.

---

### 4. Apple Notes PDF Export

Obtained by opening a note in macOS Notes and choosing File → Export as PDF. Produces a single rendered `.pdf` per note. Sample data in `metadata/single-export-2026-04-13/`.

**Status:** Not implemented. Low priority.

Key quirks:
- The PDF is a rendered visual — checkboxes are drawn as ○ glyphs, not structured task items. Recovering checkbox semantics requires heuristics.
- Text extraction (e.g. via `pdf-parse`) works but link text gets line-wrapped and mangled.
- Headings are visually larger but carry no semantic markup in the text layer.
- Images are rasterized and embedded — not separately accessible as files.
- No metadata (dates, folder, pinned, participants).
- No bulk export — even multi-selecting notes produces a single PDF, making it useless for migrating a library.
- The duplicate-content bug present in the MD export does **not** affect PDFs (the note renders once).

---

## Summary

The privacy export is richer in every metadata dimension. The MD export gains proper Markdown formatting (bold, italic, headings) but loses everything else — dates, folders, pinned state, deleted notes, and participant info. They are complementary: if a user has access to both, the privacy export is strictly more useful for import fidelity.

The storizzi format is the best overall for content fidelity — it has folder hierarchy, dates, rich formatting, tables, and no duplication. The only meaningful gaps vs the privacy export are pinned flag and participant data. If a user can only do one export, storizzi is the recommendation.

For the **native MD export** to be worth implementing, the main work items are:
1. Markdown → TipTap conversion (headings, bold/italic, checkboxes, links)
2. Image resolution from the flat `Attachments/UUID.ext` pool
3. Deduplication of repeated content (export bug)
4. Accepting a folder or ZIP-of-folder rather than the current ZIP-with-structure

For the **storizzi export**, the main work items are:
1. Markdown → TipTap conversion (same as above, plus tables)
2. Parse `data/<folder>.json` sidecar for created/modified dates (custom date parser for European locale format)
3. Join note ID suffix in filename to JSON key to attach metadata
4. Strip `iCloud-` prefix and dash-encode from folder names to recover display names
5. Normalize attachment extensions (e.g. `svg+xml` → `.svg`)
6. Handle `iCloud-Recently-Deleted/` — import with `deleted_at = import time` (no original timestamp available)
