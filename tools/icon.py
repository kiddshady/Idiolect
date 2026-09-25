"""Genera el ícono de Idiolect: build/icon.png (256) y build/icon.ico (16…256).

La misma marca del splash y la titlebar (el globo de diálogo con la virgulilla
de la ñ adentro) sobre una baldosa oscura que llega a sangre, sin margen ni
borde: el ícono ES la baldosa. La virgulilla va en el violeta del acento; el
globo, en la tinta de la UI. Se dibuja a 4x y se baja con Lanczos para que el
trazo quede limpio en los tamaños chicos.

    python tools/icon.py
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "build"
S = 256          # tamaño base
SS = 4           # supermuestreo
N = S * SS

TILE = (17, 17, 21, 255)       # un paso más clara que el fondo de la app (#0b0b0d)
INK = (242, 244, 247, 255)     # --ox-text
ACCENT = (167, 139, 250, 255)  # --ox-accent (violeta)

ESCALA = 0.86   # el glifo respira dentro de la baldosa


def u(x, y):
    """Grilla de 16 del SVG → píxeles del lienzo, achicada hacia el centro."""
    return ((8 + (x - 8) * ESCALA) * N / 16, (8 + (y - 8) * ESCALA) * N / 16)


img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# La baldosa, a sangre, con el radio de las apps de Windows 11 (~22 %).
d.rounded_rectangle((0, 0, N - 1, N - 1), radius=int(N * 0.22), fill=TILE)

w = int(1.25 * N / 16 * ESCALA)   # grosor del trazo

# El cuerpo del globo: el rounded-rect del SVG (2…14 × 2.6…11.2, r 1.6).
x0, y0 = u(2, 2.6)
x1, y1 = u(14, 11.2)
d.rounded_rectangle((x0, y0, x1, y1), radius=1.6 * N / 16 * ESCALA, outline=INK, width=w)

# La cola: se abre el borde de abajo entre x=4.4 y x=7.4 y se dibuja el pico
# hasta (4.4, 13.8), como el path del SVG.
ax, ay = u(4.4, 11.2)
bx, by = u(7.4, 11.2)
d.rectangle((ax + w / 2, ay - w, bx - w / 2, ay + w), fill=TILE)
px, py = u(4.4, 13.8)
d.line([(bx, by - w / 2), (px, py), (ax, ay - w / 2)], fill=INK, width=w, joint="curve")
for cx, cy in [(px, py)]:
    d.ellipse((cx - w / 2, cy - w / 2, cx + w / 2, cy + w / 2), fill=INK)

# La virgulilla: una onda de un período entre x=5.1 y x=10.9, centrada en y=6.9.
# Se estampa con círculos pegados en vez de d.line(): con muchos segmentos
# cortos, las uniones de Pillow dejan rayitas del fondo en la parte curva.
for i in range(1201):
    t = i / 1200
    cx, cy = u(5.1 + 5.8 * t, 6.9 - 0.62 * math.sin(2 * math.pi * t))
    d.ellipse((cx - w / 2, cy - w / 2, cx + w / 2, cy + w / 2), fill=ACCENT)

base = img.resize((S, S), Image.LANCZOS)
OUT.mkdir(exist_ok=True)
base.save(OUT / "icon.png")
base.save(OUT / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(f"{OUT / 'icon.png'}\n{OUT / 'icon.ico'}")
