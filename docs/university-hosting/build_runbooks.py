"""Build the two university migration manuals from reviewed Markdown sources."""
from pathlib import Path
from html import escape
import json
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer,
    PageBreak, Preformatted, Table, TableStyle, KeepTogether,
)
from reportlab.platypus.tableofcontents import TableOfContents
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(__file__).resolve().parent
OUT = ROOT / 'output' / 'pdf'
QA = ROOT / 'tmp' / 'pdfs' / 'university-hosting'
OUT.mkdir(parents=True, exist_ok=True)
QA.mkdir(parents=True, exist_ok=True)

fonts = Path('C:/Windows/Fonts')
pdfmetrics.registerFont(TTFont('Manual', str(fonts / 'arial.ttf')))
pdfmetrics.registerFont(TTFont('ManualBold', str(fonts / 'arialbd.ttf')))
pdfmetrics.registerFont(TTFont('ManualItalic', str(fonts / 'ariali.ttf')))
pdfmetrics.registerFontFamily('Manual', normal='Manual', bold='ManualBold', italic='ManualItalic')

styles = getSampleStyleSheet()
styles.add(ParagraphStyle('ManualBody', fontName='Manual', fontSize=11,
    leading=14.6, spaceAfter=8, textColor=colors.black, splitLongWords=True,
    allowWidows=0, allowOrphans=0))
styles.add(ParagraphStyle('ManualStep', parent=styles['ManualBody'],
    leftIndent=38, firstLineIndent=-38, spaceAfter=8.5))
styles.add(ParagraphStyle('ManualTitle', fontName='ManualBold', fontSize=25,
    leading=30, spaceAfter=18, textColor=colors.black))
styles.add(ParagraphStyle('ManualSub', fontName='Manual', fontSize=14,
    leading=19, spaceAfter=14, textColor=colors.black))
styles.add(ParagraphStyle('ManualMeta', fontName='Manual', fontSize=10.5,
    leading=15, spaceAfter=12, textColor=colors.HexColor('#333333')))
styles.add(ParagraphStyle('ManualH1', fontName='ManualBold', fontSize=15,
    leading=19, spaceBefore=15, spaceAfter=10, keepWithNext=True,
    textColor=colors.black))
styles.add(ParagraphStyle('ManualCode', fontName='Courier', fontSize=8.7,
    leading=11.5, leftIndent=12, rightIndent=6, spaceBefore=4,
    spaceAfter=12, textColor=colors.black))
styles.add(ParagraphStyle('ManualRef', parent=styles['ManualBody'],
    fontSize=9.5, leading=12.5, spaceAfter=7))
styles.add(ParagraphStyle('ManualTOC', fontName='Manual', fontSize=10.5,
    leading=14, spaceAfter=6, leftIndent=0, firstLineIndent=0,
    textColor=colors.black))
styles.add(ParagraphStyle('ManualCell', parent=styles['ManualBody'],
    fontSize=10, leading=13, spaceAfter=0))


def inline(text):
    # Escape source first. Only our own small Markdown subset becomes markup.
    text = escape(text)
    text = re.sub(r'`([^`]+)`', r'<font name="Courier" size="9.5">\1</font>', text)
    text = re.sub(r'(https://[^\s<]+)',
        lambda m: '<link href="' + m.group(1) + '" color="#17486b">' + m.group(1) + '</link>', text)
    return text


def shared_sections():
    text = (SRC / 'shared-operations.md').read_text(encoding='utf-8')
    found = re.split(r'^## (.+)\n', text, flags=re.M)
    return {found[i]: '## ' + found[i] + '\n' + found[i + 1]
            for i in range(1, len(found), 2)}


class ManualDoc(BaseDocTemplate):
    def __init__(self, filename, short_name, **kwargs):
        self.short_name = short_name
        self.anchor_index = 0
        super().__init__(filename, pagesize=letter, leftMargin=48,
            rightMargin=48, topMargin=47, bottomMargin=47, **kwargs)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height,
            leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates(PageTemplate(id='Manual', frames=frame, onPage=self.page_header))

    def page_header(self, canvas, doc):
        canvas.saveState()
        canvas.setFillColor(colors.HexColor('#444444'))
        canvas.setFont('Manual', 8)
        if doc.page > 1:
            canvas.drawString(48, letter[1] - 28, self.short_name)
        canvas.drawString(48, 28, 'University migration runbook  |  5 November 2026')
        canvas.drawRightString(letter[0] - 48, 28, str(doc.page))
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and getattr(flowable, 'toc_heading', None):
            title = flowable.toc_heading
            key = flowable.anchor_key
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(title, key, 0, False)
            self.notify('TOCEntry', (0, title, self.page, key))


def build(source_name, output_name, prefix, short_name):
    raw = (SRC / source_name).read_text(encoding='utf-8')
    shared = shared_sections()
    raw = re.sub(r'^\{\{(.+)\}\}$', lambda m: shared[m.group(1)], raw, flags=re.M)
    assert not re.search(r'^\{\{', raw, re.M)
    lines = raw.splitlines()
    title = lines.pop(0).removeprefix('# ')
    intro = []
    while lines and not lines[0].startswith('## '):
        if lines[0].strip():
            intro.append(lines[0])
        lines.pop(0)
    story = [Spacer(1, 40), Paragraph(inline(title), styles['ManualTitle'])]
    for i, p in enumerate(intro):
        story.append(Paragraph(inline(p), styles['ManualSub'] if i == 0 else styles['ManualMeta']))
    story.append(Spacer(1, 24))
    story.append(Paragraph('How to use this runbook', styles['ManualH1']))
    story.append(Paragraph('Follow the numbered steps in sequence. Each stage names its owner and ends with completion evidence. Replace example hostnames, addresses, secrets, paths, and release identifiers before use. Keep the resulting evidence with the university change record.', styles['ManualBody']))
    story.append(Paragraph('The two routes are separate alternatives. This document is complete for its selected route. Production credentials, final server sizing, approved maintenance dates, and the university domain must be supplied by their designated owners.', styles['ManualBody']))
    story.append(PageBreak())
    story.append(Paragraph('Contents', styles['ManualH1']))
    toc = TableOfContents()
    toc.levelStyles = [styles['ManualTOC']]
    toc.dotsMinLevel = 0
    story.extend([toc, PageBreak()])
    step = 0
    chapter = 0
    compiled = ['# ' + title, *intro, '']
    idx = 0
    code_lengths = []
    while idx < len(lines):
        line = lines[idx]
        if not line.strip():
            idx += 1
            continue
        if line.startswith('## '):
            chapter += 1
            heading = f'{chapter:02d}  {line[3:]}'
            p = Paragraph(inline(heading), styles['ManualH1'])
            p.toc_heading = heading
            p.anchor_key = f'{prefix}-chapter-{chapter}'
            story.append(p)
            compiled.extend(['## ' + heading, ''])
        elif line.startswith('```'):
            code = []
            idx += 1
            while idx < len(lines) and not lines[idx].startswith('```'):
                code.append(lines[idx])
                code_lengths.append(len(lines[idx]))
                idx += 1
            command = Preformatted('\n'.join(code), styles['ManualCode'])
            # Keep configuration and command examples whole with their instruction.
            # A split environment file is particularly easy to copy incorrectly.
            preceding = story.pop() if isinstance(story[-1], Paragraph) else None
            story.append(KeepTogether(([preceding] if preceding else []) + [command]))
            compiled.extend(['```', *code, '```', ''])
        elif line.startswith('|'):
            rows = []
            while idx < len(lines) and lines[idx].startswith('|'):
                cells = [x.strip() for x in lines[idx].strip('|').split('|')]
                if not all(re.fullmatch(r'[-: ]+', cell) for cell in cells):
                    rows.append([Paragraph(inline(c), styles['ManualCell']) for c in cells])
                idx += 1
            idx -= 1
            table = Table(rows, colWidths=[150, 366], repeatRows=1, hAlign='LEFT')
            table.setStyle(TableStyle([
                ('GRID', (0, 0), (-1, -1), .5, colors.HexColor('#D9D9D9')),
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#DCE6EE')),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('LEFTPADDING', (0, 0), (-1, -1), 8),
                ('RIGHTPADDING', (0, 0), (-1, -1), 8),
                ('TOPPADDING', (0, 0), (-1, -1), 7),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
            ]))
            story.extend([table, Spacer(1, 10)])
        elif line.startswith('STEP '):
            step += 1
            label = f'{prefix}{step:03d}'
            text = line[5:]
            story.append(Paragraph(f'<b>{label}</b>  ' + inline(text), styles['ManualStep']))
            compiled.extend([label + ' ' + text, ''])
        else:
            is_reference = bool(re.match(r'^\[[A-Z][0-9]+\]', line))
            if line.startswith('Completion evidence:'):
                text = '<b>Completion evidence</b>' + inline(line[len('Completion evidence'):])
            elif line.startswith('Owner:'):
                text = '<b>Owner</b>' + inline(line[len('Owner'):])
            else:
                text = inline(line)
            story.append(Paragraph(text, styles['ManualRef'] if is_reference else styles['ManualBody']))
            compiled.extend([line, ''])
        idx += 1
    file = OUT / output_name
    doc = ManualDoc(str(file), short_name, title=title,
        author='Fyimpenroll', subject='University hosting migration and public launch',
        creator='Fyimpenroll documentation')
    doc.multiBuild(story)
    (QA / (file.stem + '.md')).write_text('\n'.join(compiled), encoding='utf-8')
    reader = PdfReader(file)
    alltext = '\n'.join(p.extract_text() or '' for p in reader.pages)
    labels = re.findall(r'\b' + prefix + r'\d{3}\b', alltext)
    assert len(labels) == step, (file, len(labels), step)
    assert all(f'{prefix}{n:03d}' in labels for n in range(1, step + 1))
    assert all(len(p.extract_text() or '') > 100 for p in reader.pages)
    assert max(code_lengths, default=0) <= 96, max(code_lengths)
    record = {'file': str(file), 'pages': len(reader.pages), 'steps': step,
        'chapters': chapter, 'words': len(alltext.split()), 'max_code_line': max(code_lengths),
        'has_bookmarks': bool(reader.outline)}
    print(json.dumps(record))
    return record


if __name__ == '__main__':
    records = [
        build('01-self-hosted-supabase.md', 'Fyimpenroll_University_Self_Hosted_Supabase.pdf',
              'A', 'Fyimpenroll  |  Self hosted Supabase'),
        build('02-postgresql-custom-auth.md', 'Fyimpenroll_University_PostgreSQL_Custom_Auth.pdf',
              'B', 'Fyimpenroll  |  PostgreSQL and custom authentication'),
    ]
    (QA / 'build-manifest.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
