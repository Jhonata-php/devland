#!/usr/bin/env python3
"""Gera a logo do DevLand — um planeta com anel orbital (o mundo dos devs) — em pixel art 48x48 e grava
os PNGs de client/public/assets/brand/. Só biblioteca padrão: `python3 scripts/brand-logo.py`."""
import math, pathlib, struct, zlib

N = 48
T = (0, 0, 0, 0)
BG, BG2 = (5, 13, 8, 255), (9, 24, 15, 255)
G, G2, G3, GL = (57, 255, 136, 255), (25, 168, 96, 255), (12, 82, 50, 255), (170, 255, 205, 255)
CY, W = (77, 225, 255, 255), (232, 255, 242, 255)
BR, BR2, BR3 = (150, 104, 62, 255), (104, 70, 42, 255), (68, 46, 28, 255)

g = [[T] * N for _ in range(N)]

def put(x, y, c):
    if 0 <= x < N and 0 <= y < N:
        g[y][x] = c

def rect(x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            put(x, y, c)

def inside(x, y):
    if not (0 <= x < N and 0 <= y < N):
        return False
    dx, dy = min(x, N - 1 - x), min(y, N - 1 - y)
    return not (dx < 5 and dy < 5 and dx + dy < 5)

# ladrilho: fundo em degradê vertical, estrelas e borda neon
for y in range(N):
    for x in range(N):
        if inside(x, y):
            put(x, y, BG if y < 28 else BG2)
for x, y in [(5, 6), (42, 5), (4, 40), (43, 41)]:
    put(x, y, G3)
for y in range(N):
    for x in range(N):
        if inside(x, y) and not all(inside(x + i, y + j) for i, j in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            put(x, y, G2)

# planeta com continentes, luz de um lado, anel orbital e lua
import random
random.seed(7)
pcx, pcy, pr = 23.5, 24.5, 15.5
PHI = math.radians(-24)
OCEAN = [(8, 70, 60, 255), (12, 110, 86, 255), (20, 150, 110, 255), (40, 200, 140, 255)]
LAND = [(30, 120, 60, 255), (57, 200, 100, 255), (120, 255, 150, 255)]

def ring(front):
    for k in range(0, 1440):
        t = math.radians(k / 4)
        if (math.sin(t) > 0) != front:
            continue
        for off, col in ((0, CY), (1.3, (40, 140, 190, 255))):
            x = pcx + (22 + off) * math.cos(t) * math.cos(PHI) - (7 + off * 0.3) * math.sin(t) * math.sin(PHI)
            y = pcy + (22 + off) * math.cos(t) * math.sin(PHI) + (7 + off * 0.3) * math.sin(t) * math.cos(PHI)
            put(int(round(x)), int(round(y)), col if front else (24, 90, 120, 255))

# continentes: manchas de ruído suavizado dentro da esfera
def land(x, y):
    v = math.sin(x * 0.55 + 1.3) * math.cos(y * 0.62) + 0.7 * math.sin((x + y) * 0.35 + 2) + 0.5 * math.cos(x * 0.9 - y * 0.4)
    return v
ring(False)
for y in range(N):
    for x in range(N):
        dx, dy = (x - pcx) / pr, (y - pcy) / pr
        d = math.hypot(dx, dy)
        if d <= 1:
            lit = max(0.0, min(1.0, 0.62 + (-dx * 0.55 - dy * 0.55) * 0.55 - d * 0.18))   # luz vindo de cima à esquerda
            k = min(3, int(lit * 4))
            put(x, y, LAND[min(2, k)] if land(x, y) > 0.85 else OCEAN[k])
# brilho (reflexo) e terminador escuro à direita embaixo
for x, y in [(15, 15), (16, 14), (17, 14), (15, 16)]:
    put(x, y, (200, 255, 235, 255))
# contorno do planeta
for k in range(0, 1440):
    t = math.radians(k / 4)
    put(int(round(pcx + (pr + 0.5) * math.cos(t))), int(round(pcy + (pr + 0.5) * math.sin(t))), G)
ring(True)
# lua e estrelas
for dx, dy in [(0, 0), (1, 0), (0, 1), (1, 1), (2, 1), (1, 2)]:
    put(38 + dx, 8 + dy, (190, 210, 205, 255))
for x, y in [(6, 7), (42, 18), (7, 40), (40, 39), (30, 5), (4, 20), (44, 30), (14, 43)]:
    put(x, y, GL if (x + y) % 2 else G2)

def downscale(size):
    """Média por área (tamanhos menores, para os ícones pequenos não ficarem serrilhados) ou vizinho mais próximo."""
    out = []
    for y in range(size):
        row = []
        for x in range(size):
            x0, x1 = x * N / size, (x + 1) * N / size
            y0, y1 = y * N / size, (y + 1) * N / size
            acc = [0.0, 0.0, 0.0, 0.0]; wsum = 0.0
            for yy in range(int(y0), min(N, math.ceil(y1))):
                for xx in range(int(x0), min(N, math.ceil(x1))):
                    wgt = max(0.0, min(x1, xx + 1) - max(x0, xx)) * max(0.0, min(y1, yy + 1) - max(y0, yy))
                    r, gg, b, a = g[yy][xx]
                    acc[0] += r * a * wgt; acc[1] += gg * a * wgt; acc[2] += b * a * wgt; acc[3] += a * wgt; wsum += wgt
            a = acc[3] / wsum if wsum else 0
            row.append((int(acc[0] / acc[3]), int(acc[1] / acc[3]), int(acc[2] / acc[3]), int(a)) if acc[3] else T)
        out.append(row)
    return out

def png(size, path):
    px = downscale(size) if size < N else [[g[y * N // size][x * N // size] for x in range(size)] for y in range(size)]
    raw = b''.join(b'\x00' + b''.join(bytes(c) for c in row) for row in px)
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)
    pathlib.Path(path).write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

out = pathlib.Path(__file__).resolve().parent.parent / 'client/public/assets/brand'
for name, size in [('favicon-16', 16), ('favicon-32', 32), ('logo-mark', 32), ('logo-mark@4x', 128), ('apple-touch-icon', 180), ('icon-192', 192), ('icon-512', 512)]:
    png(size, out / f'{name}.png')
png(480, pathlib.Path('/tmp/devland-logo-preview.png')) if False else None
print('ok')
