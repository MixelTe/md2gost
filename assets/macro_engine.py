"""LibreOffice Writer postprocessor. Requires the Python UNO bridge, no pip packages."""

from __future__ import annotations

import argparse
import gc
import json
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import uuid
import zipfile

try:
    import uno
    from com.sun.star.beans import PropertyValue
    from com.sun.star.document.MacroExecMode import NEVER_EXECUTE
    from com.sun.star.document.UpdateDocMode import NO_UPDATE
    from com.sun.star.style.BreakType import PAGE_BEFORE
    from com.sun.star.text.ControlCharacter import PARAGRAPH_BREAK
except ImportError:
    print("Python UNO is unavailable. Use LibreOffice's bundled Python or install python3-uno for the system Python.", file=sys.stderr)
    sys.exit(3)


LISTING_CAPTIONS = {"Listing_Caption", "Listing_Cont"}
TABLE_CAPTIONS = {"Table_Caption", "Table_Cont"}


def properties(**values) -> tuple:
    return tuple(PropertyValue(Name=name, Value=value) for name, value in values.items())


def elements(text) -> list:
    result = []
    enumeration = text.createEnumeration()
    while enumeration.hasMoreElements():
        result.append(enumeration.nextElement())
    return result


def compatible_toc_input(file: Path, workdir: Path) -> Path:
    # LibreOffice 7.4 treats docx's alias-only SDT as a text control and drops its
    # TOC field. Unwrap only TOC controls in the private copy; keep the field and
    # every other DOCX part, including namespaces and relationships, unchanged.
    with zipfile.ZipFile(file) as source:
        xml = source.read("word/document.xml").decode("utf-8")
        pattern = r"<w:sdt\b[^>]*>\s*<w:sdtPr\b[^>]*>.*?</w:sdtPr>\s*<w:sdtContent\b[^>]*>(.*?)</w:sdtContent>\s*</w:sdt>"
        normalized = re.sub(pattern, lambda match: match.group(1) if re.search(r"<w:instrText\b[^>]*>\s*TOC\b", match.group(1)) else match.group(), xml, flags=re.DOTALL)
        if normalized == xml:
            return file
        directory = workdir / "compatible"
        directory.mkdir(exist_ok=True)
        output = directory / file.name
        with zipfile.ZipFile(output, "w") as target:
            for info in source.infolist():
                target.writestr(info, normalized.encode("utf-8") if info.filename == "word/document.xml" else source.read(info.filename))
        return output


class LibreOfficeBridge:
    def __init__(self, binary: str, workdir: Path, profile_root: Path | None = None, own_process_group: bool = True):
        self.binary = binary
        self.workdir = workdir
        self.own_process_group = own_process_group and os.name != "nt"
        profile_root = profile_root or (workdir if os.name == "nt" else Path(tempfile.gettempdir()))
        self.profile = Path(tempfile.mkdtemp(prefix="md2gost-profile-", dir=profile_root))
        self.pipe = "md2gost_" + uuid.uuid4().hex
        self.process = None
        self.desktop = None
        self.context = None

    def start(self):
        self.process = subprocess.Popen([
            self.binary,
            "-env:UserInstallation=" + self.profile.as_uri(),
            "--headless", "--invisible", "--nodefault", "--nologo", "--norestore", "--nofirststartwizard",
            f"--accept=pipe,name={self.pipe};urp;StarOffice.ServiceManager",
        ], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=sys.stderr,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            start_new_session=self.own_process_group)
        local_context = uno.getComponentContext()
        resolver = local_context.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local_context)
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            try:
                self.context = resolver.resolve(f"uno:pipe,name={self.pipe};urp;StarOffice.ComponentContext")
                self.desktop = self.context.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", self.context)
                return
            except Exception:
                if self.process.poll() not in (None, 0):
                    raise RuntimeError(f"LibreOffice exited during startup ({self.process.returncode})")
                time.sleep(0.2)
        raise RuntimeError("Could not connect to LibreOffice UNO within 60 seconds")

    def load(self, file: Path, normalize_toc: bool = False):
        source = compatible_toc_input(file, self.workdir) if normalize_toc else file
        document = self.desktop.loadComponentFromURL(source.resolve().as_uri(), "_blank", 0, properties(
            Hidden=True, ReadOnly=False, MacroExecutionMode=NEVER_EXECUTE, UpdateDocMode=NO_UPDATE,
        ))
        if document is None or not document.supportsService("com.sun.star.text.TextDocument"):
            raise RuntimeError(f"LibreOffice could not open the Writer document: {file}")
        return document

    def stop(self):
        if self.desktop is not None:
            try:
                self.desktop.terminate()
            except Exception:
                pass
        if self.process is not None:
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(self.process.pid), "/T", "/F"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   creationflags=subprocess.CREATE_NO_WINDOW, check=False)
                elif self.own_process_group:
                    try:
                        os.killpg(self.process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                else:
                    self.process.kill()
                self.process.wait(timeout=5)
            finally:
                if self.own_process_group:
                    try:
                        os.killpg(self.process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
        shutil.rmtree(self.profile, ignore_errors=True)


def page_number(document, location) -> int:
    view = document.getCurrentController().getViewCursor()
    view.gotoRange(location, False)
    return view.getPage()


def caption_number(text: str, kind: str) -> str | None:
    word = "листинга?" if kind == "listing" else "таблиц[аы]"
    match = re.search(rf"{word}[ \t\u00a0\u202f]+((?:[A-Za-zА-Яа-яЁё]\.)?[0-9]+(?:\.[0-9]+)*)(?![\w.])", text, re.IGNORECASE)
    return match.group(1) if match else None


def continuation_style(document, name: str, fallback: str) -> str:
    styles = document.StyleFamilies.getByName("ParagraphStyles")
    return name if styles.hasByName(name) else fallback


def update_fields(document):
    document.getTextFields().refresh()
    document.refresh()
    document.reformat()
    indexes = document.getDocumentIndexes()
    for index in range(indexes.getCount()):
        toc = indexes.getByIndex(index)
        toc.update()
        if toc.supportsService("com.sun.star.text.ContentIndex"):
            align_table_of_contents(document, toc)
    document.getTextFields().refresh()
    document.reformat()


def align_table_of_contents(document, toc):
    anchor = toc.getAnchor()
    cursor = document.Text.createTextCursorByRange(anchor.getStart())
    cursor.gotoRange(anchor.getEnd(), True)
    cursor.CharColor = -1
    cursor.CharUnderline = 0
    styles = document.StyleFamilies.getByName("ParagraphStyles")
    view = document.getCurrentController().getViewCursor()
    for paragraph in elements(cursor):
        if not paragraph.supportsService("com.sun.star.text.Paragraph"):
            continue
        style = styles.getByName(paragraph.ParaStyleName)
        base_indent = style.ParaLeftMargin + style.ParaFirstLineIndent
        paragraph.ParaLeftMargin = base_indent
        paragraph.ParaFirstLineIndent = 0
        prefix = re.match(r"^[0-9]+(?:\.[0-9]+)*\.?[ \t\u00a0]+", paragraph.getString())
        if prefix is None:
            continue
        view.gotoRange(paragraph.getStart(), False)
        start = view.getPosition()
        view.goRight(len(prefix.group()), False)
        end = view.getPosition()
        if end.Y == start.Y and end.X > start.X:
            paragraph.ParaLeftMargin = base_indent + end.X - start.X
            paragraph.ParaFirstLineIndent = start.X - end.X


def insert_listing_continuation(document, paragraph, number: str):
    cursor = document.Text.createTextCursorByRange(paragraph.getStart())
    cursor.gotoStartOfParagraph(False)
    document.Text.insertControlCharacter(cursor, PARAGRAPH_BREAK, False)
    cursor.goLeft(1, False)
    cursor.gotoStartOfParagraph(False)
    cursor.setString(f"Продолжение листинга {number}")
    cursor.ParaStyleName = continuation_style(document, "Listing_Cont", "Listing_Caption")
    cursor.BreakType = PAGE_BEFORE
    cursor.ParaKeepTogether = True
    document.reformat()


def is_listing_continuation(paragraph, number: str) -> bool:
    if not paragraph.supportsService("com.sun.star.text.Paragraph") or paragraph.ParaStyleName not in LISTING_CAPTIONS:
        return False
    return paragraph.getString().strip() == f"Продолжение листинга {number}"


def process_listing(document, body: list, index: int) -> tuple[int, int]:
    number = caption_number(body[index].getString(), "listing")
    index += 1
    if not number:
        return index, 0
    inserted = 0
    previous_page = None
    while index < len(body):
        paragraph = body[index]
        if not paragraph.supportsService("com.sun.star.text.Paragraph"):
            break
        style = paragraph.ParaStyleName
        if style == "Listing_Code":
            current_page = page_number(document, paragraph.getStart())
            if previous_page is not None and current_page != previous_page:
                # Reflow can push a line past the page boundary after we have
                # already put a continuation break before the following line.
                if index + 1 < len(body) and is_listing_continuation(body[index + 1], number):
                    document.Text.removeTextContent(body.pop(index + 1))
                insert_listing_continuation(document, paragraph, number)
                inserted += 1
                current_page = page_number(document, paragraph.getStart())
            previous_page = current_page
        elif is_listing_continuation(paragraph, number):
            previous_page = None
        else:
            break
        index += 1
    return index + inserted, inserted


def split_table(document, table, row: int, number: str, bridge: LibreOfficeBridge):
    tables = document.getTextTables()
    before = set(tables.getElementNames())
    view = document.getCurrentController().getViewCursor()
    view.gotoRange(table.getCellByPosition(0, row).createTextCursor(), False)
    dispatcher = bridge.context.ServiceManager.createInstanceWithContext("com.sun.star.frame.DispatchHelper", bridge.context)
    # LibreOffice's ContentCopy (2) copies the header; NONE (0) retains all data rows.
    dispatcher.executeDispatch(document.getCurrentController().getFrame(), ".uno:SplitTable", "", 0, properties(Type=2 if table.RepeatHeadline else 0))
    after = set(tables.getElementNames())
    names = after - before
    if len(names) != 1:
        raise RuntimeError(f"Could not split table {number} before row {row + 1}")
    return number


def finish_table_split(document, index: int, number: str) -> list:
    body = elements(document.Text)
    separator = body[index + 1]
    if not separator.supportsService("com.sun.star.text.Paragraph") or not body[index + 2].supportsService("com.sun.star.text.TextTable"):
        raise RuntimeError(f"Missing continuation paragraph for table {number}")
    separator.setString(f"Продолжение таблицы {number}")
    separator.ParaStyleName = continuation_style(document, "Table_Cont", "Table_Caption")
    separator.BreakType = PAGE_BEFORE
    separator.ParaKeepTogether = True
    document.reformat()
    return body


def process_table(document, table, caption, bridge: LibreOfficeBridge):
    if caption is None or not caption.supportsService("com.sun.star.text.Paragraph") or caption.ParaStyleName not in TABLE_CAPTIONS:
        return None, 0
    number = caption_number(caption.getString(), "table")
    if not number:
        return None, 0
    count = table.getRows().getCount()
    if count < 2:
        return None, 0
    moved = False
    changes = 0
    row = 1
    previous_page = page_number(document, table.getCellByPosition(0, 0).createTextCursor())
    while row < count:
        current_page = page_number(document, table.getCellByPosition(0, row).createTextCursor())
        if current_page != previous_page:
            if row < 3 and not moved:
                if caption.BreakType != PAGE_BEFORE:
                    changes += 1
                caption.BreakType = PAGE_BEFORE
                document.reformat()
                previous_page = page_number(document, table.getCellByPosition(0, 0).createTextCursor())
                moved = True
                row = 1
                continue
            if row == 1:
                raise RuntimeError("Table header and first data row do not fit on one page")
            return split_table(document, table, row, number, bridge), changes + 1
        # Writer may split an oversized row despite w:cantSplit. Never lose its tail.
        for column in range(table.getColumns().getCount()):
            cell = table.getCellByPosition(column, row)
            end = cell.createTextCursor()
            end.gotoEnd(False)
            if page_number(document, end) != current_page:
                raise RuntimeError("Table header and first data row do not fit on one page")
        previous_page = current_page
        row += 1
    return None, changes


def auto_continuation(document, bridge: LibreOfficeBridge):
    # Both kinds share document order: a table split can move a later listing.
    body = elements(document.Text)
    index = 0
    changes = 0
    while index < len(body):
        item = body[index]
        if item.supportsService("com.sun.star.text.TextTable"):
            split, table_changes = process_table(document, item, body[index - 1] if index else None, bridge)
            changes += table_changes
            if split is not None:
                # SplitTable clones UNO table identities. Release all old proxies
                # before resolving the new fragment, otherwise it aliases the top.
                body = []
                item = None
                gc.collect()
                document.reformat()
                body = finish_table_split(document, index, split)
        elif item.supportsService("com.sun.star.text.Paragraph") and item.ParaStyleName in LISTING_CAPTIONS:
            index, inserted = process_listing(document, body, index)
            changes += inserted
            if inserted:
                body = elements(document.Text)
            continue
        index += 1
    return changes


def export_pdf(document, file: Path):
    # Writer's print setting takes precedence over the PDF filter's empty-page
    # option. Keep physical page numbers aligned with the assembly manifest.
    document.createInstance("com.sun.star.text.DocumentSettings").PrintEmptyPages = True
    document.storeToURL(file.resolve().as_uri(), properties(
        FilterName="writer_pdf_Export", Overwrite=True,
        FilterData=uno.Any("[]com.sun.star.beans.PropertyValue", properties(
            ExportBookmarks=True, ExportLinksRelativeFsys=False, IsSkipEmptyPages=False, UseTaggedPDF=True,
        )),
    ))


def parse_include(text: str):
    match = re.fullmatch(r"\s*!!\((.*?)\)\s*(\{.*\})\s*", text, re.DOTALL)
    if match is None:
        return None
    fields = json.loads(match.group(2))
    if not isinstance(fields, dict):
        raise ValueError("Include fields must be a JSON object")
    return Path(match.group(1)), fields


def render_include(bridge: LibreOfficeBridge, source: Path, fields: dict, target: Path):
    if source.suffix.lower() == ".pdf":
        shutil.copyfile(source, target)
        return
    included = bridge.load(source)
    try:
        for key, value in fields.items():
            replacement = included.createReplaceDescriptor()
            replacement.SearchString = "{{" + key + "}}"
            replacement.ReplaceString = str(value)
            replacement.SearchRegularExpression = False
            included.replaceAll(replacement)
        update_fields(included)
        export_pdf(included, target)
    finally:
        included.close(True)


def render_pdf(document, bridge: LibreOfficeBridge, output: Path):
    output.mkdir()
    export_pdf(document, output / "000-main.pdf")
    view = document.getCurrentController().getViewCursor()
    view.jumpToLastPage()
    last_page = view.getPage()
    parts = []
    start_page = 1
    excluded_page = None
    for item in elements(document.Text):
        if not item.supportsService("com.sun.star.text.Paragraph"):
            continue
        include = parse_include(item.getString())
        if include is None:
            continue
        include_page = page_number(document, item.getStart())
        if include_page != excluded_page:
            if start_page < include_page:
                parts.append({"type": "main", "from": start_page, "to": include_page - 1})
            excluded_page = include_page
            start_page = include_page + 1
        source, fields = include
        name = f"{len(parts) + 1:03d}-{'pdf' if source.suffix.lower() == '.pdf' else 'include'}.pdf"
        render_include(bridge, source, fields, output / name)
        parts.append({"type": "include", "file": name})
    if start_page <= last_page:
        parts.append({"type": "main", "from": start_page, "to": last_page})
    (output / "manifest.json").write_text(json.dumps({"version": 1, "main": "000-main.pdf", "parts": parts}), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--soffice", required=True)
    parser.add_argument("--work-dir", required=True, type=Path)
    parser.add_argument("--profile-dir", type=Path)
    parser.add_argument("--shared-process-group", action="store_true")
    parser.add_argument("--render-pdf", action="store_true")
    args = parser.parse_args()
    bridge = LibreOfficeBridge(args.soffice, args.work_dir.resolve(), args.profile_dir, not args.shared_process_group)
    document = None
    try:
        try:
            bridge.start()
        except Exception:
            traceback.print_exc()
            return 3  # Office startup failure; document processing errors use 1.
        document = bridge.load(args.input, normalize_toc=True)
        print("[*1] Updating fields and continuations", flush=True)
        update_fields(document)
        for round_trip in range(5):
            for attempt in range(10):
                changes = auto_continuation(document, bridge)
                update_fields(document)
                if changes == 0:
                    break
            else:
                raise RuntimeError("Document pagination did not stabilize after 10 continuation passes")
            document.storeAsURL(args.output.resolve().as_uri(), properties(FilterName="Office Open XML Text", Overwrite=True))
            document.close(True)
            document = bridge.load(args.output, normalize_toc=True)
            document.reformat()
            # DOCX import can normalize table geometry. Export PDF from the same
            # layout that readers see when opening the saved DOCX.
            if auto_continuation(document, bridge) == 0:
                break
        else:
            raise RuntimeError("DOCX pagination did not stabilize after 5 save/open cycles")
        if args.render_pdf:
            print("[*3] Exporting PDF", flush=True)
            render_pdf(document, bridge, args.work_dir / ".md2gost_out")
    finally:
        try:
            if document is not None:
                document.close(True)
        finally:
            bridge.stop()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
