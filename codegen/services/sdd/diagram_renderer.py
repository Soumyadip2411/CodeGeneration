"""
Renders Agent 4's structured architecture spec (layers, components,
connections) into a clean, professional layered architecture diagram.

REWRITTEN TO USE PILLOW ONLY (no cairosvg / no system Cairo library).

USAGE:
    from agents.agent4_architecture import parse_architecture
    display_text, spec = parse_architecture(agent4_raw_output)
    if spec:
        png_bytes = render_architecture_png(spec)  # -> bytes, ready for docx
"""

import io
import math
import textwrap
from PIL import Image, ImageDraw, ImageFont

NAVY = (26, 46, 74)
NAVY_FILL = (237, 241, 247)
LAYER_BORDER = (143, 163, 192)
LAYER_FILL = (247, 249, 252)
GRAY_ARROW = (90, 108, 114)
EXC_COLOR = (192, 57, 43)
WHITE = (255, 255, 255)
TEXT = (26, 46, 74)

FONT_CANDIDATES_REGULAR = [
    "arial.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]
FONT_CANDIDATES_BOLD = [
    "arialbd.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]


def _load_font(candidates, size):
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def _font(size, bold=False):
    return _load_font(FONT_CANDIDATES_BOLD if bold else FONT_CANDIDATES_REGULAR, size)


def _wrap(s, max_chars=22):
    return textwrap.wrap(s, max_chars) or [""]


def _text_center(draw, xy, text, font, fill):
    try:
        draw.text(xy, text, font=font, fill=fill, anchor="mm")
    except TypeError:
        bbox = draw.textbbox((0, 0), text, font=font)
        w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text((xy[0] - w / 2, xy[1] - h / 2), text, font=font, fill=fill)


def _draw_arrowhead(draw, tip, direction, color, size=9):
    """direction: (dx, dy) unit-ish vector pointing INTO the tip."""
    length = math.hypot(direction[0], direction[1]) or 1
    ux, uy = direction[0] / length, direction[1] / length
    px, py = -uy, ux
    back = (tip[0] - ux * size, tip[1] - uy * size)
    left = (back[0] + px * size * 0.5, back[1] + py * size * 0.5)
    right = (back[0] - px * size * 0.5, back[1] - py * size * 0.5)
    draw.polygon([tip, left, right], fill=color)


def _quad_bezier_points(p0, p1, p2, n=24):
    pts = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]
        pts.append((x, y))
    return pts


def render_architecture_png(spec: dict, width_px: int = 1600) -> bytes:
    """
    Renders the architecture spec to PNG bytes for embedding in a Word doc.

    spec: {"layers": [...], "components": [...], "connections": [...]}
          as produced by agents.agent4_architecture.parse_architecture()
    """
    img = render_architecture_image(spec)
    if width_px and img.width != width_px:
        ratio = width_px / img.width
        img = img.resize((width_px, int(img.height * ratio)), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def render_architecture_image(spec: dict) -> "Image.Image":
    layers = spec["layers"]
    components = spec["components"]
    connections = spec["connections"]

    comp_by_id = {c["id"]: c for c in components}
    layer_index = {name: i for i, name in enumerate(layers)}

    by_layer = {name: [] for name in layers}
    for c in components:
        by_layer.setdefault(c["layer"], []).append(c)
    for name in list(by_layer.keys()):
        if name not in layer_index:
            layer_index[name] = len(layer_index)
    ordered_layers = sorted(by_layer.keys(), key=lambda n: layer_index[n])

    # --- Layout constants (same properties as the original SVG version)
    COL_W = 280
    COL_GAP = 110
    BOX_W = 240
    BOX_H = 80
    ROW_GAP = 55
    TOP_MARGIN = 110
    BOTTOM_MARGIN = 90
    SIDE_MARGIN = 60
    LAYER_HEADER_H = 50
    SCALE = 2  # supersample for crisper text, downscaled on export

    max_rows = max((len(v) for v in by_layer.values()), default=1)
    canvas_h = TOP_MARGIN + max_rows * BOX_H + (max_rows - 1) * ROW_GAP + BOTTOM_MARGIN
    canvas_w = SIDE_MARGIN * 2 + len(ordered_layers) * COL_W + max(0, len(ordered_layers) - 1) * COL_GAP

    positions = {}
    col_x = {}
    for i, name in enumerate(ordered_layers):
        x = SIDE_MARGIN + i * (COL_W + COL_GAP)
        col_x[name] = x
        comps = by_layer[name]
        n = len(comps)
        total_h = n * BOX_H + (n - 1) * ROW_GAP
        start_y = TOP_MARGIN + (canvas_h - TOP_MARGIN - BOTTOM_MARGIN - total_h) / 2
        for j, c in enumerate(comps):
            box_x = x + (COL_W - BOX_W) / 2
            box_y = start_y + j * (BOX_H + ROW_GAP)
            positions[c["id"]] = (box_x, box_y, BOX_W, BOX_H)

    img = Image.new("RGB", (int(canvas_w * SCALE), int(canvas_h * SCALE)), WHITE)
    draw = ImageDraw.Draw(img)

    def S(v):
        return v * SCALE

    font_layer_title = _font(int(15 * SCALE), bold=True)
    font_box = _font(int(13.5 * SCALE), bold=True)
    font_label = _font(int(11.5 * SCALE), bold=True)
    font_legend = _font(int(12.5 * SCALE))

    # --- Layer containers
    for name in ordered_layers:
        x = col_x[name]
        y0 = TOP_MARGIN - LAYER_HEADER_H
        h = canvas_h - TOP_MARGIN + LAYER_HEADER_H - BOTTOM_MARGIN + 20
        draw.rounded_rectangle(
            [S(x), S(y0), S(x + COL_W), S(y0 + h)],
            radius=S(10),
            outline=LAYER_BORDER,
            width=max(1, int(1.5 * SCALE)),
            fill=LAYER_FILL,
        )
        _text_center(
            draw,
            (S(x + COL_W / 2), S(y0 + 30)),
            name.upper(),
            font_layer_title,
            NAVY,
        )

    def edge_point(comp_id, side):
        x, y, w, h = positions[comp_id]
        return {
            "left": (x, y + h / 2),
            "right": (x + w, y + h / 2),
            "top": (x + w / 2, y),
            "bottom": (x + w / 2, y + h),
        }[side]

    # --- Connections (behind component boxes)
    for conn in connections:
        src, tgt = conn["source"], conn["target"]
        if src not in positions or tgt not in positions:
            continue

        kind = conn.get("kind", "normal")
        label = conn.get("label")
        color = EXC_COLOR if kind == "exception" else GRAY_ARROW

        src_layer = comp_by_id[src]["layer"]
        tgt_layer = comp_by_id[tgt]["layer"]
        src_col = layer_index.get(src_layer, 0)
        tgt_col = layer_index.get(tgt_layer, 0)

        width = max(1, int(2 * SCALE))
        dashed = kind == "exception"

        def _line(a, b):
            if dashed:
                _dashed_line(draw, (S(a[0]), S(a[1])), (S(b[0]), S(b[1])), color, width)
            else:
                draw.line(
                    [(S(a[0]), S(a[1])), (S(b[0]), S(b[1]))],
                    fill=color,
                    width=width,
                )

        if tgt_col > src_col:
            p1 = edge_point(src, "right")
            p2 = edge_point(tgt, "left")
            _line(p1, p2)
            _draw_arrowhead(
                draw,
                (S(p2[0]), S(p2[1])),
                (p2[0] - p1[0], p2[1] - p1[1]),
                color,
                size=S(9),
            )
            mid = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2 - 8)
        elif tgt_col < src_col:
            p1 = edge_point(src, "bottom")
            p2 = edge_point(tgt, "bottom")
            route_y = canvas_h - BOTTOM_MARGIN / 2
            pts = [(p1[0], p1[1]), (p1[0], route_y), (p2[0], route_y), (p2[0], p2[1])]
            for a, b in zip(pts, pts[1:]):
                _line(a, b)
            _draw_arrowhead(
                draw,
                (S(p2[0]), S(p2[1])),
                (0, p2[1] - route_y),
                color,
                size=S(9),
            )
            mid = ((p1[0] + p2[0]) / 2, route_y + 18)
        else:
            x, y, w, h = positions[src]
            p1 = edge_point(src, "right")
            p2 = edge_point(tgt, "right")
            bulge_x = x + w + 55
            curve_pts = _quad_bezier_points(
                (p1[0], p1[1]),
                (bulge_x, (p1[1] + p2[1]) / 2),
                (p2[0], p2[1]),
            )
            for a, b in zip(curve_pts, curve_pts[1:]):
                _line(a, b)
            _draw_arrowhead(
                draw,
                (S(p2[0]), S(p2[1])),
                (p2[0] - bulge_x, 0),
                color,
                size=S(9),
            )
            mid = (bulge_x + 6, (p1[1] + p2[1]) / 2)

        if label:
            bbox = draw.textbbox((0, 0), label, font=font_label)
            lw, lh = bbox[2] - bbox[0], bbox[3] - bbox[1]
            pad = 4 * SCALE
            draw.rectangle(
                [
                    S(mid[0]) - lw / 2 - pad,
                    S(mid[1]) - lh / 2 - pad,
                    S(mid[0]) + lw / 2 + pad,
                    S(mid[1]) + lh / 2 + pad,
                ],
                fill=WHITE,
            )
            _text_center(draw, (S(mid[0]), S(mid[1])), label, font_label, color)

    # --- Component boxes (on top of connections)
    for c in components:
        if c["id"] not in positions:
            continue
        x, y, w, h = positions[c["id"]]
        draw.rounded_rectangle(
            [S(x), S(y), S(x + w), S(y + h)],
            radius=S(8),
            outline=NAVY,
            width=max(1, int(2 * SCALE)),
            fill=NAVY_FILL,
        )

        lines = _wrap(c["name"], max_chars=22)
        line_h = 17
        start_y = y + h / 2 - (len(lines) - 1) * line_h / 2
        for i, line in enumerate(lines):
            _text_center(
                draw,
                (S(x + w / 2), S(start_y + i * line_h)),
                line,
                font_box,
                TEXT,
            )

    # --- Legend
    ly = 25
    draw.line(
        [(S(SIDE_MARGIN), S(ly)), (S(SIDE_MARGIN + 40), S(ly))],
        fill=GRAY_ARROW,
        width=max(1, int(2 * SCALE)),
    )
    draw.text((S(SIDE_MARGIN + 50), S(ly - 8)), "Normal data / flow", font=font_legend, fill=TEXT)

    _dashed_line(
        draw,
        (S(SIDE_MARGIN + 180), S(ly)),
        (S(SIDE_MARGIN + 220), S(ly)),
        EXC_COLOR,
        max(1, int(2 * SCALE)),
    )
    draw.text(
        (S(SIDE_MARGIN + 230), S(ly - 8)),
        "Exception / error path",
        font=font_legend,
        fill=TEXT,
    )

    if SCALE != 1:
        img = img.resize((int(canvas_w), int(canvas_h)), Image.LANCZOS)
    return img


def _dashed_line(draw, p1, p2, color, width, dash_len=10, gap_len=7):
    x1, y1 = p1
    x2, y2 = p2
    length = math.hypot(x2 - x1, y2 - y1)
    if length == 0:
        return

    ux, uy = (x2 - x1) / length, (y2 - y1) / length
    dist = 0
    draw_on = True

    while dist < length:
        seg = dash_len if draw_on else gap_len
        end = min(dist + seg, length)
        if draw_on:
            draw.line(
                [
                    (x1 + ux * dist, y1 + uy * dist),
                    (x1 + ux * end, y1 + uy * end),
                ],
                fill=color,
                width=width,
            )
        dist = end
        draw_on = not draw_on
