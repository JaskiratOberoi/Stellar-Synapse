---
name: read-pdf
description: >-
  Extract text from a PDF file with pdftotext (poppler). Use whenever you need to
  read a PDF and the native Read tool fails with "pdftoppm is not installed", or
  when a PDF is a text document (manual, spec, datasheet, protocol) where searching
  the extracted text is more useful than page images. Triggers: "read this PDF",
  "review the manual", any *.pdf path the Read tool can't render.
---

# Reading PDFs on this machine

The native Read tool renders PDF pages to images via `pdftoppm`, which is **not
installed** here (this is Git-for-Windows MINGW64). However `pdftotext` (also from
poppler) **is** available at `/mingw64/bin/pdftotext.exe`. For text-based PDFs
(manuals, HL7/ASTM specs, datasheets) extracting text is preferable anyway — it is
searchable with Grep and cheaper to read.

## Extract the whole document

```bash
pdftotext -layout "<path-to.pdf>" /tmp/<name>.txt && wc -l /tmp/<name>.txt
```

`-layout` preserves columns/tables (important for spec tables like OBX/OBR field
layouts). Then use **Grep** on the `.txt` to jump to the relevant section, and
**Read** the `.txt` around those line numbers — do NOT read a 5000-line dump whole.

## Read specific pages only

```bash
pdftotext -layout -f <firstPage> -l <lastPage> "<path.pdf>" /tmp/<name>.txt
```

## Tips

- Two-column manuals interleave columns even with `-layout`; when a table looks
  scrambled, re-extract that page range and cross-reference line numbers.
- If the extracted text is empty or garbage, the PDF is **scanned images** — there
  is no embedded text. Say so; OCR (`tesseract`, not installed) would be required.
- The control characters in protocol logs (`<STX>`, `<CR>`, `<VT>`) survive
  extraction as literal `<STX>` tokens — useful for reverse-engineering wire formats.

## Optional: enable the native Read tool for PDFs

To make the built-in Read tool render PDF pages, install the rest of poppler so
`pdftoppm` is on PATH (needs elevation, so do it in an admin shell, not here):

```bash
choco install poppler -y   # or: winget install oschwartz10612.Poppler
```
After that, `Read` with a `pages:` range works directly and this skill is unneeded.
