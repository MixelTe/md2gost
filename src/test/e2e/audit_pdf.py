import argparse
import json
import re
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree

import pdfplumber
from pypdf import PdfReader
from pypdf.generic import ArrayObject, IndirectObject, NameObject, TextStringObject


def audit(file, source=None, pipeline=False):
    file = Path(file)
    reader = PdfReader(file)
    page_ids = {(p.indirect_reference.idnum, p.indirect_reference.generation): i for i, p in enumerate(reader.pages)}
    names = reader.named_destinations
    links = []
    for i, page in enumerate(reader.pages):
        for ref in page.get('/Annots', []):
            annot = ref.get_object()
            if annot.get('/Subtype') != '/Link':
                continue
            dest = annot.get('/Dest')
            action = annot.get('/A')
            if action:
                action = action.get_object()
                if action.get('/S') == '/URI':
                    continue
                if action.get('/S') == '/GoTo':
                    dest = action.get('/D')
            if dest is None:
                continue
            if isinstance(dest, (str, NameObject, TextStringObject)):
                resolved = names.get(str(dest))
                target = reader.get_destination_page_number(resolved) if resolved else None
            else:
                dest = dest.get_object()
                first = dest[0] if isinstance(dest, ArrayObject) and len(dest) else None
                target = page_ids.get((first.idnum, first.generation)) if isinstance(first, IndirectObject) else first if isinstance(first, int) else None
            links.append({'source': i, 'target': target, 'valid': isinstance(target, int) and 0 <= target < len(reader.pages)})
    texts = []
    bad_chars = []
    with pdfplumber.open(file) as pdf:
        for i, page in enumerate(pdf.pages):
            texts.append(page.extract_text() or '')
            for c in page.chars:
                if c.get('text', '').strip() and (c['x0'] < -1 or c['x1'] > page.width + 1 or c['top'] < -1 or c['bottom'] > page.height + 1):
                    bad_chars.append({'page': i, 'text': c['text'], 'box': [c['x0'], c['top'], c['x1'], c['bottom']]})
    text = '\n'.join(texts)
    result = {'file': str(file), 'pages': len(reader.pages), 'sizes': [[float(p.mediabox.width), float(p.mediabox.height)] for p in reader.pages], 'internalLinks': links, 'badCharacters': bad_chars}
    failures = []
    if any(not x['valid'] for x in links):
        failures.append('dangling internal PDF destinations')
    if bad_chars:
        failures.append('characters outside physical page')
    if pipeline:
        expected = ['DOCX_INSERT_ITEM_001', 'PDF_INSERT_ITEM_001', 'PDFMAIN_ITEM_001', 'PDFMAIN_ITEM_002'] if file.parent.name == 'pdf-prefix-includes' else ['PDFMAIN_ITEM_001', 'DOCX_INSERT_ITEM_001', 'PDF_INSERT_ITEM_001', 'PDFMAIN_ITEM_002']
        actual = re.findall(r'(?:DOCX_INSERT|PDF_INSERT|PDFMAIN)_ITEM_\d{3}', text)
        if actual != expected:
            failures.append('inserted PDF/DOCX markers missing, duplicated or reordered')
        if 'Подстановка' not in text or '{{person}}' in text or '!!(' in text:
            failures.append('DOCX substitution or include placeholder removal failed')
        heading_pages = {i for i, page_text in enumerate(texts) if 'PDFMAIN_ITEM_' in page_text}
        if len(links) != 2 or {link['target'] for link in links} != heading_pages:
            failures.append('TOC links do not target both actual section pages')
    if source:
        with zipfile.ZipFile(source) as archive:
            tree = ElementTree.fromstring(archive.read('word/document.xml'))
        raw_text = '\n'.join(''.join(p.itertext()) for p in tree.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'))
        pattern = r'[A-Z][A-Z0-9]*_(?:ROW|LINE|ITEM)_[0-9]{3}'
        expected = re.findall(pattern, raw_text)
        actual = re.findall(pattern, text)
        result['expectedMarkers'] = len(expected)
        result['actualMarkers'] = len(actual)
        if actual != expected:
            result['missingMarkers'] = list((Counter(expected) - Counter(actual)).elements())
            result['extraMarkers'] = list((Counter(actual) - Counter(expected)).elements())
            failures.append('PDF data markers lost, duplicated or reordered')
        if Path(source).parent.name == 'mixed-sections':
            for i, page_text in enumerate(texts):
                landscape = reader.pages[i].mediabox.width > reader.pages[i].mediabox.height
                if ('Заголовок альбомного раздела' in page_text) != landscape:
                    failures.append(f'header none inherited a previous section header on page {i+1}')
                if len(page_text.strip()) < 5:
                    failures.append(f'unexpected empty section page {i+1}')
    result['failures'] = failures
    file.with_suffix('.audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    file.with_suffix('.text.txt').write_text(text, encoding='utf-8')
    print(json.dumps(result, ensure_ascii=True))
    return bool(failures)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('pdf')
    parser.add_argument('--source')
    parser.add_argument('--pipeline', action='store_true')
    args = parser.parse_args()
    raise SystemExit(int(audit(args.pdf, args.source, args.pipeline)))
