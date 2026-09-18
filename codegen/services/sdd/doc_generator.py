"""
PURPOSE:
Generates professionally formatted Word documents from pipeline results.
Handles tables, headings, bullets, bold text, diagrams properly.
"""

import io
import re
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from . import diagram_renderer

# --- EY BRAND COLORS
EY_YELLOW = RGBColor(0xFF, 0xE6, 0x00)
EY_BLACK = RGBColor(0x1A, 0x1A, 0x1A)
EY_GRAY = RGBColor(0x40, 0x40, 0x40)
EY_WHITE = RGBColor(0xFF, 0xFF, 0xFF)
LIGHT_GRAY = RGBColor(0x70, 0x70, 0x70)

# --- HELPERS

def _set_cell_bg(cell, hex_color: str):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tcPr.append(shd)

def _clean_text(text: str) -> str:
    """Strip markdown and emoji from text for Word output."""
    # Bold: **text** -> text (but preserve the text)
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    text = re.sub(r'\*(.*?)\*', r'\1', text)
    # Remove markdown headers
    text = re.sub(r'^#{1,6}\s*', '', text, flags=re.MULTILINE)
    # Remove inline code
    text = re.sub(r'`[^`]*`', '', text)
    # Remove blockquote markers
    text = re.sub(r'^\s*>\s*', '', text, flags=re.MULTILINE)
    # Remove emoji (non-ASCII that aren't standard punctuation)
    text = re.sub(r'[^\x00-\x7F\u2013\u2014\u2018\u2019\u201C\u201D\u00A0-\u00FF]', '', text)
    return text.strip()

def _add_heading(doc: Document, text: str, level: int = 1):
    clean = _clean_text(text)
    if not clean:
        return
    style_name = f"Heading {min(level, 9)}"
    try:
        para = doc.add_paragraph(style=style_name)
    except KeyError:
        para = doc.add_paragraph()
    para.paragraph_format.space_before = Pt(14 if level == 1 else 10)
    para.paragraph_format.space_after = Pt(4)
    run = para.add_run(clean)
    run.bold = True
    run.font.color.rgb = EY_BLACK
    if level == 1:
        run.font.size = Pt(16)
    elif level == 2:
        run.font.size = Pt(13)
    else:
        run.font.size = Pt(11)
    # Yellow underline rule for H1 - decorative only, not a heading itself
    if level == 1:
        rule = doc.add_paragraph()
        rule.paragraph_format.space_before = Pt(0)
        rule.paragraph_format.space_after = Pt(6)
        r = rule.add_run("-" * 80)
        r.font.color.rgb = EY_YELLOW
        r.font.size = Pt(8)

def _add_table_of_contents(doc: Document, title: str = "Table of Contents"):
    heading = doc.add_paragraph()
    run = heading.add_run(title)
    run.bold = True
    run.font.size = Pt(16)
    run.font.color.rgb = EY_BLACK
    rule = doc.add_paragraph()
    r = rule.add_run("-" * 80)
    r.font.color.rgb = EY_YELLOW
    r.font.size = Pt(8)

    paragraph = doc.add_paragraph()
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    fld_begin.set(qn("w:dirty"), "true")

    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = 'TOC \\o "1-3" \\h \\z \\u'

    fld_separate = OxmlElement("w:fldChar")
    fld_separate.set(qn("w:fldCharType"), "separate")

    placeholder = OxmlElement("w:t")
    placeholder.text = "Right-click and choose \u201cUpdate Field\u201d to load the table of contents."

    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")

    r_el = run._r
    r_el.append(fld_begin)
    r_el.append(instr)
    r_el.append(fld_separate)
    r_el.append(placeholder)
    r_el.append(fld_end)

    doc.add_page_break()

def _force_update_fields_on_open(doc: Document):
    """
    Sets the document-level flag that tells Word to update all fields
    (the TOC in particular) the moment the file is opened, instead of
    requiring a manual right-click > Update Field first.
    """
    settings_el = doc.settings.element
    update_fields = OxmlElement("w:updateFields")
    update_fields.set(qn("w:val"), "true")
    settings_el.append(update_fields)

def _add_paragraph(doc: Document, text: str, bold_parts: bool = True):
    """Add body paragraph with optional bold formatting preserved."""
    if not text.strip():
        return
    para = doc.add_paragraph()
    para.paragraph_format.space_after = Pt(4)

    # Handle **bold** inline
    parts = re.split(r'(\*\*.*?\*\*)', text)
    for part in parts:
        clean = re.sub(r'[^\x00-\x7F\u2013\u2014\u2018\u2019\u201C\u201D\u00A0-\u00FF]', '', part)
        if not clean.strip():
            continue
        if part.startswith('**') and part.endswith('**'):
            run = para.add_run(clean.strip('*'))
            run.bold = True
        else:
            run = para.add_run(clean)
            run.font.size = Pt(10.5)
            run.font.color.rgb = EY_GRAY

def _add_bullet(doc: Document, text: str, level: int = 0):
    """Add bullet point."""
    clean = _clean_text(text)
    if not clean:
        return
    style = 'List Bullet'
    para = doc.add_paragraph(style=style)
    para.paragraph_format.left_indent = Inches(0.25 * (level + 1))
    para.paragraph_format.space_after = Pt(2)
    run = para.add_run(clean)
    run.font.size = Pt(10.5)
    run.font.color.rgb = EY_GRAY

def _add_numbered(doc: Document, text: str):
    """Add numbered list item."""
    clean = _clean_text(text)
    if not clean:
        return
    para = doc.add_paragraph(style='List Number')
    para.paragraph_format.space_after = Pt(2)
    # Handle bold within numbered items
    parts = re.split(r'(\*\*.*?\*\*)', clean)
    for part in parts:
        part = re.sub(r'[^\x00-\x7F\u2013\u2014\u2018\u2019\u201C\u201D\u00A0-\u00FF]', '', part)
        if not part.strip():
            continue
        if part.startswith('**') and part.endswith('**'):
            run = para.add_run(part.strip('*'))
            run.bold = True
        else:
            run = para.add_run(part)
            run.font.size = Pt(10.5)
            run.font.color.rgb = EY_GRAY

def _add_table(doc: Document, headers: list, rows: list):
    """Add EY-styled table with black header row and alternating rows."""
    if not headers:
        return
    safe_rows = []
    for row in rows:
        while len(row) < len(headers):
            row.append("")
        safe_rows.append(row[:len(headers)])

    table = doc.add_table(rows=1 + len(safe_rows), cols=len(headers))
    table.style = 'Table Grid'

    # Set column widths evenly
    col_width = Inches(6.5) / len(headers)
    for col in table.columns:
        for cell in col.cells:
            cell.width = col_width

    # Header row - black background, yellow text
    hdr_row = table.rows[0]
    for i, hdr in enumerate(headers):
        cell = hdr_row.cells[i]
        _set_cell_bg(cell, "1A1A1A")
        para = cell.paragraphs[0]
        para.paragraph_format.space_before = Pt(4)
        para.paragraph_format.space_after = Pt(4)
        clean_hdr = _clean_text(hdr)
        run = para.add_run(clean_hdr)
        run.bold = True
        run.font.color.rgb = EY_YELLOW
        run.font.size = Pt(10) # increased from 9

    # Data rows - alternating background
    for r_idx, row_data in enumerate(safe_rows):
        row = table.rows[r_idx + 1]
        bg = "F2F2F2" if r_idx % 2 == 0 else "FFFFFF"
        for c_idx, cell_val in enumerate(row_data):
            cell = row.cells[c_idx]
            _set_cell_bg(cell, bg)
            para = cell.paragraphs[0]
            para.paragraph_format.space_before = Pt(3)
            para.paragraph_format.space_after = Pt(3)
            clean_val = _clean_text(str(cell_val))
            # Handle bold inside cell
            parts = re.split(r'(\*\*.*?\*\*)', clean_val)
            for part in parts:
                if not part.strip():
                    continue
                if part.startswith('**') and part.endswith('**'):
                    r = para.add_run(part.strip('*'))
                    r.bold = True
                else:
                    r = para.add_run(part)
                    r.font.size = Pt(10) # increased from 9
                    r.font.color.rgb = EY_GRAY

    doc.add_paragraph().paragraph_format.space_after = Pt(8)

def _add_architecture_diagram(doc: Document, diagram_spec: dict | None):
    """
    Embeds the architecture diagram rendered from Agent 4's structured spec
    (layers/components/connections) via diagram_renderer - a local render,
    no network call.
    """
    img_bytes = None
    if diagram_spec:
        try:
            img_bytes = diagram_renderer.render_architecture_png(diagram_spec)
        except Exception as e:
            print(f"Architecture diagram render failed: {e}")

    if img_bytes:
        doc.add_paragraph()
        para = doc.add_paragraph()
        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = para.add_run()
        run.add_picture(io.BytesIO(img_bytes), width=Inches(6.2))
        caption = doc.add_paragraph("Figure: System Architecture Diagram")
        caption.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for r in caption.runs:
            r.font.italic = True
            r.font.size = Pt(9)
            r.font.color.rgb = LIGHT_GRAY
        doc.add_paragraph()
    else:
        para = doc.add_paragraph()
        r = para.add_run("[Architecture diagram unavailable - view in the web application]")
        r.font.italic = True
        r.font.color.rgb = LIGHT_GRAY
        r.font.size = Pt(10)

ARCHITECTURE_HEADING_RE = re.compile(r"architecture design", re.IGNORECASE)

# --- CORE PARSER

def _render_markdown_to_doc(doc: Document, text: str, include_diagrams: bool = False, architecture_diagram_spec: dict = None):
    """
    Main markdown parser. Converts markdown text to properly formatted
    Word content: headings, tables, bullets, numbered lists, bold text.

    When include_diagrams is True and architecture_diagram_spec is given,
    the diagram is injected right after the first heading whose text
    contains "Architecture Design" - this works whether the heading is
    "## 5. Architecture Design" (inside the full proposal) or "# Architecture
    Design" (the standalone architecture doc's own cover heading), without
    needing Agent 5 to embed anything itself.
    """
    diagram_inserted = not (include_diagrams and architecture_diagram_spec)
    lines = text.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith('```mermaid'):
            i += 1
            while i < len(lines) and lines[i].strip() != '```':
                i += 1
            i += 1
            continue

        # Other code blocks - render content as styled text, don't skip
        if stripped.startswith('```'):
            i += 1
            code_lines = []
            while i < len(lines) and not lines[i].strip().startswith('```'):
                code_lines.append(lines[i].strip())
                i += 1
            i += 1
            # Render code block content as body text with arrow flow styling
            for cl in code_lines:
                if cl.strip():
                    clean = re.sub(r'[^\x00-\x7F\u2192\u2013\u2014\u2018\u2019\u201C\u201D\u00A0-\u00FF]', '', cl)
                    clean = clean.replace('-->', '->').strip()
                    if clean:
                        para = doc.add_paragraph()
                        para.paragraph_format.left_indent = Inches(0.3)
                        para.paragraph_format.space_after = Pt(2)
                        r = para.add_run(clean)
                        r.font.size = Pt(10)
                        r.font.color.rgb = EY_BLACK
                        r.font.name = 'Courier New'
            continue

        # Headings
        if stripped.startswith('#### '):
            _add_heading(doc, stripped[5:], level=3)
        elif stripped.startswith('### '):
            _add_heading(doc, stripped[4:], level=3)
        elif stripped.startswith('## '):
            _add_heading(doc, stripped[3:], level=2)
        elif stripped.startswith('# '):
            _add_heading(doc, stripped[2:], level=1)

        if not diagram_inserted and ARCHITECTURE_HEADING_RE.search(stripped):
            _add_architecture_diagram(doc, architecture_diagram_spec)
            diagram_inserted = True

        # Markdown table
        elif stripped.startswith('|') and i + 1 < len(lines) and re.match(r'^\s*\|[\s\-\|:]+\|\s*$', lines[i + 1]):
            # Parse headers
            headers = [h.strip() for h in stripped.split('|') if h.strip()]
            i += 2 # skip separator row
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                row = [c.strip() for c in lines[i].strip().split('|') if c.strip()]
                rows.append(row)
                i += 1
            _add_table(doc, headers, rows)
            continue

        # Bullet points
        elif re.match(r'^\s*[\*\-]\s+', line):
            indent = len(line) - len(line.lstrip())
            level = indent // 2
            content = re.sub(r'^\s*[\*\-]\s+', '', line)
            _add_bullet(doc, content, level)

        # Numbered list
        elif re.match(r'^\s*\d+\.\s+', stripped):
            content = re.sub(r'^\s*\d+\.\s+', '', stripped)
            _add_numbered(doc, content)

        # Blockquote
        elif stripped.startswith('>'):
            content = re.sub(r'^\s*>\s*', '', stripped)
            clean = _clean_text(content)
            if clean:
                para = doc.add_paragraph()
                para.paragraph_format.left_indent = Inches(0.3)
                para.paragraph_format.space_after = Pt(4)
                r = para.add_run(clean)
                r.font.italic = True
                r.font.size = Pt(10.5)

        # Horizontal rule
        elif stripped.startswith('---') and len(stripped) >= 3 and all(c == '-' for c in stripped):
            para = doc.add_paragraph()
            para.paragraph_format.space_before = Pt(4)
            para.paragraph_format.space_after = Pt(4)

        # Regular paragraph
        elif stripped and not stripped.startswith('#'):
            _add_paragraph(doc, stripped)

        i += 1

# --- COVER PAGE

def _add_cover_page(doc: Document, subtitle: str = "Business Process"):
    """Professional EY cover page."""
    # EY Logo
    logo = doc.add_paragraph()
    logo.paragraph_format.space_before = Pt(60)
    logo.paragraph_format.space_after = Pt(0)
    r = logo.add_run("EY")
    r.bold = True
    r.font.size = Pt(52)
    r.font.color.rgb = EY_BLACK

    # Yellow rule
    rule = doc.add_paragraph()
    rule.paragraph_format.space_before = Pt(4)
    rule.paragraph_format.space_after = Pt(30)
    r = rule.add_run("-" * 60)
    r.font.color.rgb = EY_YELLOW
    r.font.size = Pt(14)

    # Title
    title = doc.add_paragraph()
    title.paragraph_format.space_before = Pt(20)
    title.paragraph_format.space_after = Pt(8)
    r = title.add_run("Solution Design Proposal")
    r.bold = True
    r.font.size = Pt(28)
    r.font.color.rgb = EY_BLACK

    # Subtitle
    sub = doc.add_paragraph()
    sub.paragraph_format.space_before = Pt(0)
    sub.paragraph_format.space_after = Pt(40)
    r = sub.add_run(subtitle)
    r.font.size = Pt(14)
    r.font.color.rgb = LIGHT_GRAY

    # Info table
    info = [
        ("Prepared by", "AI-Powered Process to Solution Design Generator"),
        ("Powered by", "Azure OpenAI GPT-4.1 mini"),
        ("Classification", "EY Internal Use Only"),
        ("Status", "Draft - Pending Review"),
    ]
    tbl = doc.add_table(rows=len(info), cols=2)
    tbl.style = "Table Grid"
    for i, (label, value) in enumerate(info):
        row = tbl.rows[i]
        _set_cell_bg(row.cells[0], "1A1A1A")
        lp = row.cells[0].paragraphs[0]
        lr = lp.add_run(label)
        lr.bold = True
        lr.font.color.rgb = EY_YELLOW
        lr.font.size = Pt(10)
        vp = row.cells[1].paragraphs[0]
        vr = vp.add_run(value)
        vr.font.size = Pt(10)
        vr.font.color.rgb = EY_BLACK

    doc.add_page_break()

# --- BASE DOC SETUP

def _base_doc() -> Document:
    doc = Document()
    sec = doc.sections[0]
    sec.page_width = Inches(8.5)
    sec.page_height = Inches(11)
    sec.left_margin = Inches(1)
    sec.right_margin = Inches(1)
    sec.top_margin = Inches(1)
    sec.bottom_margin = Inches(1)
    style = doc.styles['Normal']
    style.font.name = 'Calibri'
    style.font.size = Pt(10.5)
    return doc

def _save_doc(doc: Document) -> bytes:
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf.getvalue()

# --- PER-TAB GENERATORS

def generate_process_breakdown_doc(results: dict) -> bytes:
    doc = _base_doc()
    _add_cover_page(doc, "Process Breakdown")
    _add_heading(doc, "Process Breakdown", level=1)
    _render_markdown_to_doc(doc, results.get("process_breakdown", ""))
    return _save_doc(doc)

def generate_gap_analysis_doc(results: dict) -> bytes:
    doc = _base_doc()
    _add_cover_page(doc, "Gap and Risk Analysis")
    _add_heading(doc, "Gap and Risk Analysis", level=1)
    _render_markdown_to_doc(doc, results.get("gap_analysis", ""))
    return _save_doc(doc)

def generate_solution_design_doc(results: dict) -> bytes:
    doc = _base_doc()
    _add_cover_page(doc, "Solution Design")
    _add_heading(doc, "Solution Design", level=1)
    _render_markdown_to_doc(doc, results.get("solution_design", ""))
    return _save_doc(doc)

def generate_architecture_doc(results: dict) -> bytes:
    doc = _base_doc()
    _add_cover_page(doc, "Architecture Design")
    _add_heading(doc, "Architecture Design", level=1)
    _render_markdown_to_doc(
        doc,
        results.get("architecture", ""),
        include_diagrams=True,
        architecture_diagram_spec=results.get("architecture_diagram_spec"),
    )
    return _save_doc(doc)

def generate_proposal_only_doc(results: dict) -> bytes:
    doc = _base_doc()
    _add_cover_page(doc, "Business Process Analysis")
    _render_markdown_to_doc(
        doc,
        results.get("final_proposal", ""),
        include_diagrams=True,
        architecture_diagram_spec=results.get("architecture_diagram_spec"),
    )
    return _save_doc(doc)

def generate_word_doc(results: dict) -> bytes:
    """
    Full proposal Word doc - all sections + architecture diagram embedded,
    plus a Table of Contents covering the main proposal AND the appendix.
    """
    doc = _base_doc()
    _add_cover_page(doc, "Business Process Analysis")
    _add_table_of_contents(doc)

    _render_markdown_to_doc(
        doc,
        results.get("final_proposal", ""),
        include_diagrams=True,
        architecture_diagram_spec=results.get("architecture_diagram_spec"),
    )

    # Appendix
    doc.add_page_break()
    _add_heading(doc, "Appendix", level=1)

    appendix = [
        ("A. Process Breakdown", "process_breakdown", False),
        ("B. Gap and Risk Analysis", "gap_analysis", False),
        ("C. Solution Design", "solution_design", False),
        ("D. Architecture Design", "architecture", True),
    ]

    for title, key, with_diagram in appendix:
        doc.add_page_break()
        _add_heading(doc, title, level=2)
        _render_markdown_to_doc(
            doc,
            results.get(key, ""),
            include_diagrams=with_diagram,
            architecture_diagram_spec=results.get("architecture_diagram_spec") if with_diagram else None,
        )

    _force_update_fields_on_open(doc)
    return _save_doc(doc)