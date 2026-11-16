"""Bottle print for the Blender render, built from the real Lavaquell logo files.
Layout matches the printed 1000 mL Still bottle (mark, wordmark, tagline,
BOTTLED DRINKING WATER, 1000 mL). Canvas spans the full circumference; the
artwork is centred at u = 0.5 (front)."""
import math
from PIL import Image, ImageDraw, ImageFont

R = 0.4855          # label radius (profile units)
Y0, Y1 = 0.18, 1.45 # label band (profile units)
W = 4096
px_u = W / (2 * math.pi * R)
H = round((Y1 - Y0) * px_u)
INK = (28, 79, 158, 255)

def tint(path):
    im = Image.open(path).convert('RGBA')
    a = im.getchannel('A')
    out = Image.new('RGBA', im.size, INK)
    out.putalpha(a)
    return out

img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
cx = W / 2
y2px = lambda y: (Y1 - y) * px_u

mark = tint('public/assets/mark-white.png')
mh = (1.36 - 1.0) * px_u
mw = mh * mark.width / mark.height
img.alpha_composite(mark.resize((round(mw), round(mh)), Image.LANCZOS), (round(cx - mw / 2), round(y2px(1.36))))

word = tint('public/assets/wordmark-white.png')
wh = (0.915 - 0.795) * px_u
ww = wh * word.width / word.height
img.alpha_composite(word.resize((round(ww), round(wh)), Image.LANCZOS), (round(cx - ww / 2), round(y2px(0.915))))

d = ImageDraw.Draw(img)
def font(size_u, weight):
    f = ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf', round(size_u * px_u))
    try: f.set_variation_by_name(weight)
    except Exception: pass
    return f
def text(t, y, f, spacing=0):
    if spacing:
        widths = [d.textlength(ch, font=f) for ch in t]
        total = sum(widths) + spacing * (len(t) - 1)
        x = cx - total / 2
        for ch, w_ in zip(t, widths):
            d.text((x, y2px(y)), ch, font=f, fill=INK, anchor='lm'); x += w_ + spacing
    else:
        d.text((cx, y2px(y)), t, font=f, fill=INK, anchor='mm')
text('Quell the thirst, keep it clean', 0.69, font(0.05, 'SemiBold'))
text('BOTTLED DRINKING WATER', 0.55, font(0.04, 'SemiBold'), spacing=round(0.006 * px_u))
text('1000 mL', 0.28, font(0.044, 'SemiBold'))
img.save('render/label_still.png')
print('label', W, H)
