#!/usr/bin/env python3
import sys
import os
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime


def _meta(relative_path: str):
    return [
        f"# {os.path.basename(relative_path)}",
        "",
        f"- Source: {relative_path}",
        f"- Converted at: {datetime.utcnow().isoformat()}Z",
        "",
    ]


def convert_docx(src: str):
    with zipfile.ZipFile(src, "r") as zf:
        xml = zf.read("word/document.xml")
    root = ET.fromstring(xml)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    lines = []
    for p in root.findall(".//w:p", ns):
        texts = [t.text or "" for t in p.findall(".//w:t", ns)]
        line = "".join(texts).strip()
        if line:
            lines.append(line)
    return "\n\n".join(lines)


def convert_pptx(src: str):
    lines = []
    with zipfile.ZipFile(src, "r") as zf:
        slide_names = sorted([n for n in zf.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml")])
        ns = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
        for idx, name in enumerate(slide_names, 1):
            xml = zf.read(name)
            root = ET.fromstring(xml)
            texts = [t.text.strip() for t in root.findall(".//a:t", ns) if t.text and t.text.strip()]
            if not texts:
                continue
            lines.append(f"## Slide {idx}")
            lines.extend([f"- {t}" for t in texts])
            lines.append("")
    return "\n".join(lines)


def convert_xlsx(src: str):
    with zipfile.ZipFile(src, "r") as zf:
        shared = []
        if "xl/sharedStrings.xml" in zf.namelist():
            sroot = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            shared = ["".join([t.text or "" for t in si.findall(".//s:t", ns)]) for si in sroot.findall(".//s:si", ns)]

        ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        lines = []
        sheets = sorted([n for n in zf.namelist() if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")])
        for idx, sheet in enumerate(sheets, 1):
            root = ET.fromstring(zf.read(sheet))
            lines.append(f"## Sheet {idx}")
            for row in root.findall(".//s:row", ns):
                vals = []
                for c in row.findall("s:c", ns):
                    t = c.attrib.get("t")
                    v = c.find("s:v", ns)
                    if v is None or v.text is None:
                        vals.append("")
                        continue
                    text = v.text
                    if t == "s":
                        try:
                            text = shared[int(text)]
                        except Exception:
                            pass
                    vals.append(text)
                if any(v for v in vals):
                    lines.append("| " + " | ".join(vals) + " |")
            lines.append("")
    return "\n".join(lines)


def convert_pdf(src: str):
    try:
        from pypdf import PdfReader
    except Exception as e:
        raise RuntimeError(f"missing pypdf: {e}")
    reader = PdfReader(src)
    chunks = []
    for i, page in enumerate(reader.pages, 1):
        text = (page.extract_text() or "").strip()
        if text:
            chunks.append(f"## Page {i}\n\n{text}")
    return "\n\n".join(chunks)


def main():
    if len(sys.argv) < 3:
        print("usage: convert_document.py <sourcePath> <relativeSourcePath>", file=sys.stderr)
        sys.exit(2)
    src = sys.argv[1]
    rel = sys.argv[2]
    ext = os.path.splitext(src)[1].lower()

    try:
        if ext == ".docx":
            body = convert_docx(src)
        elif ext == ".pptx":
            body = convert_pptx(src)
        elif ext == ".xlsx":
            body = convert_xlsx(src)
        elif ext == ".pdf":
            body = convert_pdf(src)
        else:
            raise RuntimeError(f"unsupported extension: {ext}")

        text = "\n".join(_meta(rel)) + (body.strip() if body else "(empty)") + "\n"
        sys.stdout.write(text)
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
