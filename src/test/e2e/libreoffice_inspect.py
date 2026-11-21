"""Inspect actual Writer pagination of processed continuation fixtures."""

import argparse
import importlib.util
import json
from pathlib import Path


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--input", type=Path, required=True)
parser.add_argument("--soffice", required=True)
parser.add_argument("--work-dir", type=Path, required=True)
parser.add_argument("--require-toc", action="store_true")
args = parser.parse_args()
script = Path(__file__).resolve().parents[3] / "assets/macro_engine.py"
spec = importlib.util.spec_from_file_location("macro_engine", script)
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)
bridge = engine.LibreOfficeBridge(args.soffice, args.work_dir.resolve())
document = None
try:
    bridge.start()
    document = bridge.load(args.input)
    document.reformat()
    if args.require_toc:
        assert document.getDocumentIndexes().getCount() > 0, "Saved DOCX lost its dynamic table of contents"
    headers = {}
    previous = None
    tables = 0
    listing_page = None
    listing_number = None
    listings = set()
    for item in engine.elements(document.Text):
        if item.supportsService("com.sun.star.text.Paragraph"):
            if item.ParaStyleName in engine.LISTING_CAPTIONS:
                listing_number = engine.caption_number(item.getString(), "listing")
                assert listing_number, f"Invalid listing caption: {item.getString()}"
                if "Продолжение листинга" in item.getString():
                    assert listing_number in listings, f"Listing {listing_number}: original caption was replaced"
                else:
                    listings.add(listing_number)
                listing_page = engine.page_number(document, item.getStart())
            elif item.ParaStyleName == "Listing_Code" and listing_number is not None:
                actual_page = engine.page_number(document, item.getStart())
                assert actual_page == listing_page, f"Listing {listing_number}: expected page {listing_page}, got {actual_page}: {item.getString()[:60]}"
                assert engine.page_number(document, item.getEnd()) == listing_page, f"Listing {listing_number}: code paragraph spans pages"
            else:
                listing_number = None
        else:
            listing_number = None
        if item.supportsService("com.sun.star.text.TextTable") and previous is not None and previous.ParaStyleName in engine.TABLE_CAPTIONS:
            number = engine.caption_number(previous.getString(), "table")
            assert number, f"Invalid table caption: {previous.getString()}"
            first_page = engine.page_number(document, item.getCellByPosition(0, 0).createTextCursor())
            assert engine.page_number(document, previous.getStart()) == first_page, f"Table {number}: caption and table are on different pages"
            assert engine.page_number(document, previous.getEnd()) == first_page, f"Table {number}: caption wraps to a different page"
            columns = item.getColumns().getCount()
            header = [item.getCellByPosition(column, 0).getString() for column in range(columns)]
            if number in headers:
                assert "Продолжение таблицы" in previous.getString(), f"Table {number}: missing continuation label"
                assert header == headers[number], f"Table {number}: header content changed"
            else:
                assert "Продолжение таблицы" not in previous.getString(), f"Table {number}: original caption was replaced"
                headers[number] = header
            for row in range(item.getRows().getCount()):
                for column in range(columns):
                    cursor = item.getCellByPosition(column, row).createTextCursor()
                    assert engine.page_number(document, cursor) == first_page, f"Table {number}, row {row}: fragment spans pages"
                    cursor.gotoEnd(False)
                    assert engine.page_number(document, cursor) == first_page, f"Table {number}, row {row}: row spans pages"
            tables += 1
        previous = item if item.supportsService("com.sun.star.text.Paragraph") else None
    print(json.dumps({"tables": tables, "numbers": list(headers), "listings": list(listings)}, ensure_ascii=False))
finally:
    try:
        if document is not None:
            document.close(True)
    finally:
        bridge.stop()
