"""Independent synthetic PDF drawing oracle: HarfBuzz, bidi, and font outlines.

Input contains actual glyph IDs/positions from PDF text operators, never a
ToUnicode-derived glyph identity. Expected outlines come from the pinned full
Amiri faces shaped from source text, not from the PDF's embedded font.
"""

import base64
import copy
import hashlib
import io
import json
import re
import sys
import unicodedata
from functools import lru_cache
from pathlib import Path

import uharfbuzz as hb
from bidi.wrapper import get_display
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

EMPTY = hashlib.sha256(repr([]).encode()).hexdigest()


class DrawingOracle:
    def __init__(self, document, font_dir):
        self.document = document
        self.faces = {name: (font_dir / f"Amiri-{name}.ttf").read_bytes()
                      for name in ("Regular", "Bold")}
        self.fonts = {name: self.load(blob) for name, blob in self.faces.items()}
        self.fonts.update({name: self.load(base64.b64decode(blob))
                           for name, blob in document["fonts"].items()})

    @staticmethod
    def load(blob):
        font = TTFont(io.BytesIO(blob))
        return font, font.getGlyphSet(), font.getGlyphOrder()

    @lru_cache(None)
    def outline(self, font_key, gid):
        _, glyphs, names = self.fonts[font_key]
        assert 0 <= gid < len(names), "unknown drawing glyph"
        pen = DecomposingRecordingPen(glyphs)
        glyphs[names[gid]].draw(pen)
        return hashlib.sha256(repr(pen.value).encode()).hexdigest()

    @lru_cache(None)
    def bounds(self, font_key, gid):
        _, glyphs, names = self.fonts[font_key]
        pen = BoundsPen(glyphs)
        glyphs[names[gid]].draw(pen)
        return pen.bounds

    @staticmethod
    def bidi_runs(text, lang):
        # python-bidi's pinned Rust binding exposes resolved levels in its debug
        # representation. Fail closed if that format changes, including byte counts.
        debug = get_display(text, base_dir="R" if lang == "ar" else "L", debug=True)
        block = debug.split("\n    levels: [", 1)[1].split("\n    ],", 1)[0]
        levels = [int(n) for n in re.findall(r"Level\(\s*(\d+),", block)]
        assert len(levels) == len(text.encode("utf8")), "unexpected bidi level format"
        runs, offset = [], 0
        for char in text:
            width = len(char.encode("utf8"))
            level = levels[offset]
            assert levels[offset:offset + width] == [level] * width
            offset += width
            if not runs or runs[-1][0] != level:
                runs.append([level, ""])
            runs[-1][1] += char
        visual = list(range(len(runs)))
        for level in range(max(r[0] for r in runs), 0, -1):
            start = 0
            while start < len(visual):
                if runs[visual[start]][0] < level:
                    start += 1
                    continue
                end = start + 1
                while end < len(visual) and runs[visual[end]][0] >= level:
                    end += 1
                visual[start:end] = reversed(visual[start:end])
                start = end
        return [runs[index] for index in visual]

    @lru_cache(None)
    def expected(self, text, weight, lang):
        font = hb.Font(hb.Face(self.faces[weight]))
        x = y = 0
        drawing = []
        for level, run in self.bidi_runs(text, lang):
            buffer = hb.Buffer()
            buffer.add_str(run)
            buffer.guess_segment_properties()
            buffer.direction = "rtl" if level % 2 else "ltr"
            hb.shape(font, buffer)
            for info, position in zip(buffer.glyph_infos, buffer.glyph_positions):
                assert info.codepoint != 0, "missing source glyph"
                shape = self.outline(weight, info.codepoint)
                if shape != EMPTY:
                    drawing.append((shape, x + position.x_offset, y + position.y_offset))
                x += position.x_advance
                y += position.y_advance
        return drawing

    @staticmethod
    def normalize(drawing, scale=1):
        left = min(g[1] for g in drawing)
        baseline = min(g[2] for g in drawing)
        return sorted((g[0], (g[1] - left) * scale, (g[2] - baseline) * scale)
                      for g in drawing)

    def matches(self, actual, text, weight, lang, size):
        expected = self.expected(text, weight, lang)
        if not actual or not expected or len(actual) != len(expected):
            return False
        scale = size / self.fonts[weight][0]["head"].unitsPerEm
        actual = self.normalize(actual)
        expected = self.normalize(expected, scale)
        # One-and-a-half font units at 10pt accommodates the integer positioning
        # rounding difference between HarfBuzz and the pinned Typst/rustybuzz.
        tolerance = 1.5 * scale
        return all(a[0] == e[0] and abs(a[1] - e[1]) <= tolerance
                   and abs(a[2] - e[2]) <= tolerance for a, e in zip(actual, expected))

    def verify(self, word):
        weight = "Bold" if word["weight"] == "bold" else "Regular"
        lang = word["lang"]
        glyphs = word["glyphs"]
        sizes = {g["size"] for g in glyphs}
        assert len(sizes) == 1, "mixed drawing sizes"
        size = sizes.pop()
        expected_em = self.fonts[weight][0]["head"].unitsPerEm
        anchored = 0
        for glyph in glyphs:
            font, outlines, names = self.fonts[glyph["font"]]
            assert font["head"].unitsPerEm == expected_em, "unexpected embedded font scale"
            bounds = self.bounds(glyph["font"], glyph["gid"])
            # Nonspacing marks can extend above Typst's link line box. Their
            # positions are checked relative to the anchored advancing glyphs.
            if bounds and font["hmtx"].metrics[names[glyph["gid"]]][0] > 0:
                l, b, r, t = bounds
                scale = size / expected_em
                ink = (glyph["x"] + l * scale, glyph["y"] + b * scale,
                       glyph["x"] + r * scale, glyph["y"] + t * scale)
                assert any(ink[0] <= rect[2] and ink[2] >= rect[0]
                           and ink[1] <= rect[3] and ink[3] >= rect[1]
                           for rect in word["rects"]), "glyph outside word anchor"
                anchored += 1
        assert anchored > 0, "drawing has no anchored advancing glyph"
        actual = [(self.outline(g["font"], g["gid"]), g["x"], g["y"])
                  for g in glyphs]
        actual = [g for g in actual if g[0] != EMPTY]
        if self.matches(actual, word["word"], weight, lang, size):
            return
        # A source word may wrap only between its grapheme clusters. Each drawn
        # line must match a consecutive source slice; no character can disappear.
        baselines = set()
        for g in glyphs:
            font, _, names = self.fonts[g["font"]]
            if font["hmtx"].metrics[names[g["gid"]]][0] > 0 and self.outline(g["font"], g["gid"]) != EMPTY:
                baselines.add(round(g["y"], 3))
        lines = sorted(baselines, reverse=True)
        assert len(lines) > 1, "word drawing mismatch"
        grouped = [[] for _ in lines]
        for glyph in actual:
            closest = min(range(len(lines)), key=lambda i: abs(glyph[2] - lines[i]))
            grouped[closest].append(glyph)
        clusters = []
        for char in word["word"]:
            if unicodedata.combining(char) and clusters:
                clusters[-1] += char
            else:
                clusters.append(char)

        @lru_cache(None)
        def visit(line, start):
            if line == len(grouped):
                return start == len(clusters)
            for end in range(start + 1, len(clusters) + 1):
                if self.matches(grouped[line], "".join(clusters[start:end]), weight, lang, size):
                    if visit(line + 1, end):
                        return True
            return False

        assert visit(0, 0), "wrapped word drawing mismatch"


def main():
    document = json.loads(sys.stdin.read())
    oracle = DrawingOracle(document, Path(sys.argv[1]))
    for word in document["words"]:
        try:
            oracle.verify(word)
        except (AssertionError, KeyError, ValueError, IndexError):
            # No source strings, glyph payloads, or child stderr in a failure.
            raise RuntimeError("glyph_outline_mismatch:" + word["id"]) from None
    guards = False
    if len(sys.argv) > 2 and sys.argv[2] == "--guards":
        original = next(w for w in document["words"]
                        if any(unicodedata.combining(c) for c in w["word"])
                        and len(w["glyphs"]) >= 3)
        for mutation in ("missing", "duplicate", "wrong", "moved", "association", "displaced", "missing_character"):
            word = copy.deepcopy(original)
            if mutation == "missing":
                word["glyphs"].pop(1)
            elif mutation == "duplicate":
                word["glyphs"].append(copy.deepcopy(word["glyphs"][1]))
            elif mutation == "wrong":
                word["glyphs"][1]["gid"] = word["glyphs"][0]["gid"]
            elif mutation == "moved":
                word["glyphs"][1]["x"] += 1
            elif mutation == "association":
                word["word"] = "\u0633\u0644\u0627\u0645"
            elif mutation == "missing_character":
                word["word"] = "\u0378"
            else:
                for glyph in word["glyphs"]:
                    glyph["x"] += 1000
                    glyph["y"] += 1000
            try:
                oracle.verify(word)
            except (AssertionError, KeyError, ValueError, IndexError):
                continue
            raise RuntimeError("drawing_mutation_accepted:" + mutation)
        changed = copy.deepcopy(document)
        key = original["glyphs"][0]["font"]
        font = TTFont(io.BytesIO(base64.b64decode(changed["fonts"][key])))
        font["head"].unitsPerEm *= 2
        payload = io.BytesIO()
        font.save(payload)
        changed["fonts"][key] = base64.b64encode(payload.getvalue()).decode()
        try:
            DrawingOracle(changed, Path(sys.argv[1])).verify(original)
        except AssertionError:
            pass
        else:
            raise RuntimeError("drawing_mutation_accepted:font_scale")
        changed = copy.deepcopy(document)
        displaced = copy.deepcopy(original)
        for glyph in displaced["glyphs"]:
            glyph["x"] += 1000
            glyph["y"] += 1000
        for font_key in {g["font"] for g in displaced["glyphs"]}:
            font = TTFont(io.BytesIO(base64.b64decode(changed["fonts"][font_key])))
            font["hmtx"].metrics = {name: (0, bearing)
                                    for name, (_, bearing) in font["hmtx"].metrics.items()}
            payload = io.BytesIO()
            font.save(payload)
            changed["fonts"][font_key] = base64.b64encode(payload.getvalue()).decode()
        try:
            DrawingOracle(changed, Path(sys.argv[1])).verify(displaced)
        except AssertionError:
            pass
        else:
            raise RuntimeError("drawing_mutation_accepted:erased_advances")
        guards = True
    print(json.dumps({"outlineWords": len(document["words"]), "drawingMutations": guards}))


if __name__ == "__main__":
    main()
