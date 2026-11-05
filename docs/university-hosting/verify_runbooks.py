"""Check PDF geometry and make contact sheets for visual inspection."""
from pathlib import Path
import json
import pdfplumber
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[2]
qa = root / 'tmp' / 'pdfs' / 'university-hosting'
records = []
for pdf in (root / 'output' / 'pdf').glob('Fyimpenroll_University_*.pdf'):
    with pdfplumber.open(pdf) as document:
        issues = []
        pages = []
        for n, page in enumerate(document.pages, 1):
            words = page.extract_words()
            outside = [w['text'] for w in words if w['x0'] < 45 or w['x1'] > 567
                       or w['top'] < 15 or w['bottom'] > 772]
            if outside:
                issues.append({'page': n, 'outside': outside})
            text = page.extract_text() or ''
            assert 'REPLACE_WITH' not in text or ('configuration' in text.lower() or '=' in text)
            assert '\u25a0' not in text
            pages.append({'page': n, 'words': len(words),
                          'last_body_line': max([w['bottom'] for w in words
                              if w['top'] > 45 and w['bottom'] < 748], default=0)})
        records.append({'pdf': pdf.name, 'geometry_issues': issues, 'pages': pages})
        assert not issues, issues
for name in ['a', 'b']:
    images = sorted((qa / ('render-' + name)).glob('page-*.png'))
    for start in range(0, len(images), 4):
        loaded = [Image.open(p).convert('RGB') for p in images[start:start + 4]]
        width, height = loaded[0].size
        sheet = Image.new('RGB', (width * 2 + 24, height * 2 + 52), '#bbbbbb')
        draw = ImageDraw.Draw(sheet)
        for i, im in enumerate(loaded):
            x, y = (i % 2) * (width + 12), (i // 2) * (height + 26)
            draw.text((x + 5, y + 4), f'{name.upper()} page {start + i + 1}', fill='black')
            sheet.paste(im, (x, y + 20))
        sheet.save(qa / f'contact-{name}-{start // 4 + 1:02d}.png')
(qa / 'geometry-report.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
print(json.dumps([{'pdf': r['pdf'], 'pages': len(r['pages']),
    'geometry_issues': len(r['geometry_issues'])} for r in records]))
