"""Audit real PDF text, continuation pages and bounds using Poppler."""

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import subprocess
from xml.etree import ElementTree


def audit(file: Path) -> dict:
    result = subprocess.run(["pdftotext", "-bbox-layout", str(file), "-"], check=True, capture_output=True, text=True, encoding="utf-8")
    root = ElementTree.fromstring(result.stdout)
    namespace = "{http://www.w3.org/1999/xhtml}"
    pages = []
    for page in root.iter(namespace + "page"):
        words = list(page.iter(namespace + "word"))
        width, height = float(page.attrib["width"]), float(page.attrib["height"])
        for word in words:
            bounds = [float(word.attrib[key]) for key in ("xMin", "yMin", "xMax", "yMax")]
            assert bounds[0] >= -1 and bounds[1] >= -1 and bounds[2] <= width + 1 and bounds[3] <= height + 1, f"{file}: text outside page bounds: {word.text}"
        pages.append(" ".join(" ".join(word.text or "" for word in words).split()))
    text = "\n".join(pages)
    source = file.parent / "input.g.md"
    markdown = source.read_text(encoding="utf-8")
    expected = re.findall(r"\b[A-Z][A-Z0-9]*_(?:ROW|LINE)_\d+\b", markdown)
    actual = re.findall(r"\b[A-Z][A-Z0-9]*_(?:ROW|LINE)_\d+\b", text)
    assert Counter(actual) == Counter(expected), f"{file}: PDF lost or duplicated row/code markers"
    assert actual == expected, f"{file}: PDF marker order changed"
    seen = set()
    for page in pages:
        groups = {match.group(1): match.group(2) for match in re.finditer(r"\b([A-Z][A-Z0-9]*)_(ROW|LINE)_\d+\b", page)}
        for group, kind in groups.items():
            if group in seen:
                caption = "Продолжение таблицы" if kind == "ROW" else "Продолжение листинга"
                assert caption in page, f"{file}: missing {caption} on a following page of {group}: {page[:160]!r}"
            seen.add(group)
    listing = {"03-boundaries": "L6", "04-appendices": "LA"}.get(file.parent.name)
    if listing:
        counts = [len(re.findall(rf"\b{listing}_LINE_\d+\b", page)) for page in pages]
        fragments = [(number, count) for number, count in enumerate(counts, 1) if count]
        for number, count in fragments[1:-1]:
            assert count > 1, f"{file}: page {number} has only one line of listing {listing} before another continuation"
    if file.parent.name == "includes":
        required = ["BEFORE_TEXT", "INSERT_PDF_BODY", "FIELD_VALUE:", "INSERT_DOCX_SECOND", "AFTER_TEXT", "FINAL_TEXT"]
        positions = [text.find(marker) for marker in required]
        assert all(position >= 0 for position in positions), f"{file}: inserted content missing: {positions}"
        assert positions == sorted(positions), f"{file}: inserted content reordered"
        assert "{{name}}" not in text and "Подстановка" in text, f"{file}: DOCX field substitution failed"
        assert "!!(" not in text, f"{file}: include placeholders leaked into PDF"
    if file.parent.name == "features":
        for marker in ["FEATURE_START", "FEATURE_NOTE", "LANDSCAPE", "FEATURE_END"]:
            assert marker in text, f"{file}: missing {marker}"
    return {"file": str(file), "pages": len(pages), "markers": len(actual)}


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("directory", type=Path)
args = parser.parse_args()
files = sorted(args.directory.glob("*/result.pdf"))
assert files, "No PDF fixtures found"
print(json.dumps([audit(file) for file in files], ensure_ascii=False, indent=2))
