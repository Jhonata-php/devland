#!/usr/bin/env python3
"""Gera a logo do DevLand — uma ilha flutuante com um terminal em cima (a "land" dos devs) — em pixel art 48x48 e grava
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
for x, y in [(6, 8), (40, 6), (9, 22), (38, 18), (12, 38), (42, 36), (30, 4), (5, 30)]:
    put(x, y, G3)
for y in range(N):
    for x in range(N):
        if inside(x, y) and not all(inside(x + i, y + j) for i, j in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            put(x, y, G2)

# monitor (terminal) com brilho
rect(13, 6, 34, 21, G)
rect(14, 7, 33, 20, BG)
rect(14, 7, 33, 8, G3)           # barra de título
put(15, 7, (255, 95, 86, 255)); put(17, 7, (255, 189, 46, 255)); put(19, 7, (39, 201, 63, 255))
for x, y in [(17, 11), (18, 12), (19, 13), (20, 14), (19, 15), (18, 16), (17, 17)]:   # prompt >
    put(x, y, GL); put(x + 1, y, G)
rect(23, 16, 29, 17, CY)         # cursor _
rect(23, 11, 31, 11, G3); rect(23, 13, 28, 13, G3)  # linhas de texto
rect(22, 22, 25, 24, G2); rect(19, 25, 28, 26, G2)    # pé

# ilha: topo elíptico em grama, com luz na borda de cima
cx, cy, rx, ry = 23.5, 33, 18, 5.5
for y in range(26, 41):
    for x in range(N):
        d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
        if d <= 1:
            top = ((x - cx) / rx) ** 2 + ((y + 1 - cy) / ry) ** 2 > 1
            put(x, y, GL if top else (G if d < 0.55 else G2))
# rocha embaixo, afinando em V, com camadas
for i, y in enumerate(range(37, 46)):
    half = 17 - int(i * 1.9)
    for x in range(int(cx - half), int(cx + half) + 1):
        if half < 1:
            continue
        shade = BR if x < cx - half * 0.3 else (BR2 if x < cx + half * 0.4 else BR3)
        put(x, y, shade if (y + x) % 7 else BR3)
# detalhes: arbusto, bandeirinha com </>, faíscas de código
for x, y in [(10, 31), (11, 30), (12, 31), (11, 31)]: put(x, y, G3)
rect(35, 25, 35, 31, W); rect(36, 25, 39, 27, CY)
for x, y in [(6, 14), (7, 15), (6, 16)]: put(x, y, G2)
for x, y in [(41, 12), (40, 13), (41, 14)]: put(x, y, G2)
for x, y in [(8, 42), (9, 43)]: put(x, y, CY)

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
