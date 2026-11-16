"""Convert rendered PNG frames to optimised WebP sequences for the site.

  python render/export_webp.py

  public/frames/d/0001.webp ...  desktop, 1280 x 800
  public/frames/m/0001.webp ...  phones, centre crop 500 x 800 (bottle stays centred)
"""
import os, glob
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
src = sorted(glob.glob(os.path.join(HERE, 'frames', '*.png')))
out_d = os.path.join(ROOT, 'public', 'frames', 'd')
out_m = os.path.join(ROOT, 'public', 'frames', 'm')
os.makedirs(out_d, exist_ok=True)
os.makedirs(out_m, exist_ok=True)
total_d = total_m = 0
for p in src:
    name = os.path.splitext(os.path.basename(p))[0] + '.webp'
    im = Image.open(p).convert('RGB')
    im.save(os.path.join(out_d, name), quality=74, method=6)
    w, h = im.size
    cw = round(h * 0.625)
    im.crop(((w - cw) // 2, 0, (w - cw) // 2 + cw, h)).save(os.path.join(out_m, name), quality=72, method=6)
    total_d += os.path.getsize(os.path.join(out_d, name))
    total_m += os.path.getsize(os.path.join(out_m, name))
print(f'{len(src)} frames  desktop {total_d / 1e6:.1f} MB  mobile {total_m / 1e6:.1f} MB')
