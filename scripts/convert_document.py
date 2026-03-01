#!/usr/bin/env python3
import os
import sys
from datetime import datetime, timezone

SUPPORTED_EXTS = {".docx", ".pptx", ".xlsx", ".pdf"}


def _meta(relative_path: str):
    return [
        f"# {os.path.basename(relative_path)}",
        "",
        f"- Source: {relative_path}",
        f"- Converted at: {datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')}",
        "",
    ]


def convert_with_markitdown(src: str):
    try:
        from markitdown import MarkItDown
    except Exception as e:
        raise RuntimeError(
            f"missing markitdown: {e}. install with: pip install markitdown[all]"
        )

    md = MarkItDown()
    result = md.convert(src)
    text = getattr(result, "text_content", None)
    if text is None:
        raise RuntimeError("markitdown returned no text_content")
    return str(text)


def main():
    if len(sys.argv) < 3:
        print("usage: convert_document.py <sourcePath> <relativeSourcePath>", file=sys.stderr)
        sys.exit(2)
    src = sys.argv[1]
    rel = sys.argv[2]
    ext = os.path.splitext(src)[1].lower()

    try:
        if ext not in SUPPORTED_EXTS:
            raise RuntimeError(f"unsupported extension: {ext}")

        body = convert_with_markitdown(src)
        text = "\n".join(_meta(rel)) + (body.strip() if body else "(empty)") + "\n"
        sys.stdout.write(text)
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
