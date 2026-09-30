"""Rebuild assets/fonts/Fredoka_300-700.woff2 from Fredoka-variable.ttf (OFL, see OFL.txt).

Steps:
 1. Fredoka has no double-acute letters (o, O, u, U with double acute, needed in Hungarian). Build them as composites
    (base letter + combining double acute) and copy the variation data of the acute versions so they follow the weight axis.
 2. Subset to Latin (Basic, Latin-1, Extended-A), punctuation and the few symbols we use; keep wght.
 3. Pin wdth to 100 to save bytes; write woff2.
Run: PYTHONIOENCODING=utf-8 python assets/fonts/_src/make_font.py
"""
import copy
import os
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent
from fontTools.varLib import instancer
from fontTools import subset

here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, '..', 'Fredoka_300-700.woff2')
f = TTFont(os.path.join(here, 'Fredoka-variable.ttf'))

# name, codepoint, base glyph, reference glyph whose gvar we copy, x and y offset of the mark, mark scale
# (the font's own double acute is tall, so it is scaled down to sit like the acute on the neighbouring letters)
NEW = [
    ('odblacute', 0x151, 'o', 'oacute', 151, 109, 0.75),
    ('udblacute', 0x171, 'u', 'uacute', 133, 109, 0.75),
    ('Odblacute', 0x150, 'O', 'Oacute', 229, 272, 0.8),
    ('Udblacute', 0x170, 'U', 'Uacute', 225, 272, 0.8),
]
glyf, hmtx, gvar = f['glyf'], f['hmtx'], f['gvar']
hvar_map = f['HVAR'].table.AdvWidthMap.mapping
order = f.getGlyphOrder()
for name, cp, base, ref, dx, dy, sc in NEW:
    order.append(name)
    f.setGlyphOrder(order)
    g = Glyph()
    g.numberOfContours = -1
    c1 = GlyphComponent()
    c1.glyphName, c1.x, c1.y, c1.flags = base, 0, 0, 0x204  # ROUND_XY_TO_GRID | USE_MY_METRICS style flags copied from oacute
    c2 = GlyphComponent()
    c2.glyphName, c2.x, c2.y, c2.flags = 'uni030B', dx, dy, 0x4
    c2.transform = [[sc, 0], [0, sc]]
    g.components = [c1, c2]
    glyf.glyphs[name] = g
    glyf.glyphOrder = order
    hmtx[name] = hmtx[ref]
    gvar.variations[name] = copy.deepcopy(gvar.variations[ref])
    hvar_map[name] = hvar_map[ref]
    for t in f['cmap'].tables:
        if t.isUnicode():
            t.cmap[cp] = name
f['maxp'].numGlyphs = len(order)

ranges = [(0x20, 0x7E), (0xA0, 0xFF), (0x100, 0x17F), (0x2010, 0x2027), (0x2030, 0x203A), (0x20AC, 0x20AC)]
uni = [c for a, b in ranges for c in range(a, b + 1)]
uni += [0xD7, 0x2605, 0x25CF, 0x25C0, 0x25B6, 0x25B2, 0x25BC, 0x2713]
opts = subset.Options()
opts.layout_features = ['kern', 'liga', 'calt', 'ccmp', 'locl', 'mark', 'mkmk']
opts.notdef_outline = True
opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
sub = subset.Subsetter(opts)
sub.populate(unicodes=uni)
sub.subset(f)

f = instancer.instantiateVariableFont(f, {'wdth': 100})
f.flavor = 'woff2'
f.save(out)
cm = TTFont(out).getBestCmap()
for ch in 'őŐűŰöÖüÜáÁ×★●◀▶▲▼✓':
    print('U+%04X' % ord(ch), 'ok' if ord(ch) in cm else 'not in font (system fallback)')
g = TTFont(out)
print('wrote', os.path.normpath(out), os.path.getsize(out), 'bytes; axes', [(a.axisTag, a.minValue, a.maxValue) for a in g['fvar'].axes], 'glyphs', len(g.getGlyphOrder()))
