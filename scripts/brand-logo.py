#!/usr/bin/env python3
"""Gera a logo do DevLand em pixel art (casa com </> dentro, verde-neon sobre preto) e grava os PNGs de
client/public/assets/brand/. Só biblioteca padrão: `python3 scripts/brand-logo.py`."""
import struct, zlib, pathlib

N = 24
BG, EDGE, ROOF, WALL, GLYPH, WIN = (6, 18, 10, 255), (57, 255, 136, 255), (57, 255, 136, 255), (25, 140, 80, 255), (230, 255, 240, 255), (77, 225, 255, 255)
g = [[(0, 0, 0, 0)] * N for _ in range(N)]

def put(x, y, c):
    if 0 <= x < N and 0 <= y < N:
        g[y][x] = c

# ladrilho de fundo com cantos cortados e borda neon contínua
def inside(x, y):
    if not (0 <= x < N and 0 <= y < N):
        return False
    dx, dy = min(x, N - 1 - x), min(y, N - 1 - y)
    return not (dx < 3 and dy < 3 and dx + dy < 3)
for y in range(N):
    for x in range(N):
        if inside(x, y):
            border = not all(inside(x + i, y + j) for i, j in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            put(x, y, EDGE if border else BG)
# telhado em degraus
for i, y in enumerate(range(4, 11)):
    for x in range(11 - i, 13 + i):
        put(x, y, ROOF)
for y in range(3, 7):  # chaminé
    for x in (16, 17):
        put(x, y, ROOF)
# parede
for y in range(11, 20):
    for x in range(6, 18):
        put(x, y, WALL)
# </> dentro da casa
for x, y in [(9, 13), (8, 14), (7, 15), (8, 16), (9, 17), (14, 13), (15, 14), (16, 15), (15, 16), (14, 17), (12, 13), (12, 14), (11, 15), (11, 16), (10, 17)]:
    put(x, y, GLYPH)
# chão
for x in range(4, 20):
    put(x, 20, EDGE)

def png(scale, path):
    w = N * scale
    raw = bytearray()
    for row in g:
        line = b''.join(bytes(c) * scale for c in row)
        raw += (b'\x00' + line) * scale
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, w, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    pathlib.Path(path).write_bytes(data)

def resized(size, path):
    """Escala vizinho-mais-próximo para um tamanho qualquer (ex.: 180, 192, 512, 16, 32)."""
    raw = bytearray()
    for y in range(size):
        row = b''.join(bytes(g[y * N // size][x * N // size]) for x in range(size))
        raw += b'\x00' + row
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)
    pathlib.Path(path).write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))

out = pathlib.Path(__file__).resolve().parent.parent / 'client/public/assets/brand'
for name, size in [('favicon-16', 16), ('favicon-32', 32), ('logo-mark', 32), ('logo-mark@4x', 128), ('apple-touch-icon', 180), ('icon-192', 192), ('icon-512', 512)]:
    resized(size, out / f'{name}.png')
print('ok')
