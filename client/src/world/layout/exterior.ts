// Área externa: quarteirão de cidade (praça, duas avenidas com carros, parques fora); pátio/jardim nos slots sem sala.
import type { WallStyle } from '../../art/api';
import { mulberry32 } from '../../../../shared/hash';
import { BUILDING_H, COL_W, CORE_COLS, CORRIDOR_Y, EXT_EAST, EXT_NORTH, EXT_SOUTH, EXT_WEST, SOUTH_Y, TILE } from '../constants';
import { cellRect, slotAt, slotColumn, slotSide } from './geometry';
import type { ExteriorProp, FloorPatch, TileRect, WallItemPlacement, WallSegment } from './types';

export const EXTERIOR_WALL: WallStyle = { base: '#cfc8bd', trim: '#8a8174', pattern: 'brick', exterior: true };

export interface ExteriorLayout {
  /** Limites da área desenhada (tiles). */
  bounds: TileRect;
  floors: FloorPatch[];
  props: ExteriorProp[];
  /** Faixas da rua (y em px) e sentido (+1 = leste, -1 = oeste). */
  lanes: { y: number; dir: 1 | -1 }[];
  /** Linha central da rua (px), para as faixas tracejadas. */
  streetY: number;
  streetH: number;
}

/** Fechamento do corredor e pátio de um slot sem sala. */
export interface SlotShell {
  slot: number;
  rect: TileRect;
  walls: WallSegment[];
  windows: WallItemPlacement[];
  floors: FloorPatch[];
  props: ExteriorProp[];
}

export function layoutExterior(cols: number): ExteriorLayout {
  const w = cols * COL_W;
  const bounds: TileRect = { x: -EXT_WEST, y: -EXT_NORTH, w: w + EXT_WEST + EXT_EAST, h: BUILDING_H + EXT_NORTH + EXT_SOUTH };
  const px = (t: number) => t * TILE;
  const floors: FloorPatch[] = [];
  const props: ExteriorProp[] = [];
  const rng = mulberry32(0xc0de + cols);

  // Quarteirão de cidade (andar open-space): praça de pedra em volta do prédio, uma avenida ao norte e outra ao sul
  // com carros, árvores em canteiros nas calçadas e parques (grama) nos quarteirões de fora.
  const south = BUILDING_H;
  const NORTH_ST = -11; // avenida norte: linhas -11..-6
  const SOUTH_ST = south + 6; // avenida sul: 6 linhas
  const ST_H = 6;
  floors.push({ kind: 'grass', x: px(bounds.x), y: px(bounds.y), w: px(bounds.w), h: px(bounds.h), seed: 11 });
  // praça de cimento claro em volta do prédio, com calçada de pedra só junto às avenidas
  floors.push({ kind: 'concrete', x: px(bounds.x), y: px(NORTH_ST + ST_H), w: px(bounds.w), h: px(SOUTH_ST - NORTH_ST - ST_H), seed: 12 });
  floors.push({ kind: 'sidewalk', x: px(bounds.x), y: px(NORTH_ST + ST_H), w: px(bounds.w), h: px(3), seed: 17 });
  floors.push({ kind: 'sidewalk', x: px(bounds.x), y: px(SOUTH_ST - 3), w: px(bounds.w), h: px(3), seed: 18 });
  // canteiros de grama na praça, dos dois lados do prédio
  floors.push({ kind: 'grass', x: px(-14), y: px(2), w: px(10), h: px(CORRIDOR_Y - 4), seed: 19 });
  floors.push({ kind: 'grass', x: px(-14), y: px(CORRIDOR_Y + 7), w: px(10), h: px(BUILDING_H - CORRIDOR_Y - 9), seed: 20 });
  floors.push({ kind: 'grass', x: px(w + 4), y: px(2), w: px(10), h: px(BUILDING_H - 4), seed: 21 });
  floors.push({ kind: 'street', x: px(bounds.x), y: px(NORTH_ST), w: px(bounds.w), h: px(ST_H), seed: 13 });
  floors.push({ kind: 'street', x: px(bounds.x), y: px(SOUTH_ST), w: px(bounds.w), h: px(ST_H), seed: 14 });
  // meio-fio das avenidas (faixa de calçada estreita do outro lado)
  floors.push({ kind: 'sidewalk', x: px(bounds.x), y: px(NORTH_ST - 2), w: px(bounds.w), h: px(2), seed: 15 });
  floors.push({ kind: 'sidewalk', x: px(bounds.x), y: px(SOUTH_ST + ST_H), w: px(bounds.w), h: px(2), seed: 16 });

  // árvores em canteiros e postes nas calçadas das duas avenidas
  for (let x = bounds.x + 2; x < bounds.x + bounds.w - 1; x += 6) {
    props.push({ kind: 'tree', x: px(x) + 4, y: px(NORTH_ST + ST_H + 2), seed: Math.floor(rng() * 1e9) });
    props.push({ kind: 'tree', x: px(x + 3) + 4, y: px(SOUTH_ST - 1), seed: Math.floor(rng() * 1e9) });
    props.push({ kind: 'lamp', x: px(x + 3), y: px(NORTH_ST + ST_H + 1) + 4, seed: x });
    props.push({ kind: 'lamp', x: px(x), y: px(SOUTH_ST) - 4, seed: x + 1 });
  }
  // cerca viva + flores ao longo da fachada sul (abre diante das salas de projeto que existem)
  for (let x = 0; x < w; x += 2) {
    const col = Math.floor(x / COL_W);
    const lx = x - col * COL_W;
    const gate = col >= CORE_COLS && (lx === 6 || lx === 8) ? slotAt(col, 'south') : undefined;
    props.push({ kind: (x / 2) % 3 === 1 ? 'flowers' : 'hedge', x: px(x) + TILE, y: px(south + 1) + 10, seed: x * 7 + 3, whenRoom: gate });
  }
  // bancos na praça em volta do prédio
  for (let x = bounds.x + 5; x < bounds.x + bounds.w - 3; x += 14) {
    props.push({ kind: 'bench', x: px(x), y: px(south + 3) + 10, seed: x });
    props.push({ kind: 'bench', x: px(x + 7), y: px(NORTH_ST + ST_H + 3) + 10, seed: x + 3 });
  }
  // parques nos quarteirões de fora (norte e sul): árvores e arbustos sobre a grama
  for (const [y0, y1] of [[bounds.y + 1, NORTH_ST - 3], [SOUTH_ST + ST_H + 3, bounds.y + bounds.h - 1]] as const) {
    for (let y = y0; y < y1; y += 3) {
      for (let x = bounds.x + 2; x < bounds.x + bounds.w - 1; x += 4 + Math.floor(rng() * 4)) {
        props.push({ kind: rng() < 0.25 ? 'pine' : rng() < 0.15 ? 'bush' : 'tree', x: px(x) + Math.floor(rng() * 10), y: px(y + 1) + Math.floor(rng() * 10), seed: Math.floor(rng() * 1e9) });
      }
    }
  }
  // laterais (oeste/leste) da praça: algumas árvores em canteiros, fora do caminho da entrada
  for (const side of [-1, 1]) {
    for (let y = 1; y < BUILDING_H; y += 4) {
      if (side < 0 && y >= CORRIDOR_Y - 2 && y <= CORRIDOR_Y + 6) continue;
      props.push({ kind: 'tree', x: px(side < 0 ? -8 : w + 6), y: px(y + 1), seed: Math.floor(rng() * 1e9) });
      props.push({ kind: 'bush', x: px(side < 0 ? -3 : w + 2), y: px(y + 2), seed: Math.floor(rng() * 1e9) });
    }
  }
  props.push({ kind: 'bench', x: px(-5), y: px(CORRIDOR_Y + 3) + 6, seed: 1 });
  // totem com a marca na entrada principal (oeste)
  props.push({ kind: 'totem', x: px(-3) + 6, y: px(CORRIDOR_Y + 1), seed: 2 });

  // faixas das avenidas: duas por avenida, uma em cada sentido; a linha amarela central é a da avenida sul
  const lanes: ExteriorLayout['lanes'] = [
    { y: px(NORTH_ST + 2) + 6, dir: -1 },
    { y: px(NORTH_ST + 4) + 10, dir: 1 },
    { y: px(SOUTH_ST + 2) + 6, dir: -1 },
    { y: px(SOUTH_ST + 4) + 10, dir: 1 },
  ];
  return { bounds, floors, props, lanes, streetY: px(SOUTH_ST), streetH: px(ST_H) };
}

/** Parede externa + jardim de um slot vazio: deck de madeira com mesas e guarda-sóis, canteiros e caminho. */
export function slotShell(slot: number, lastColumn: boolean): SlotShell {
  const col = slotColumn(slot);
  const side = slotSide(slot);
  const rect = cellRect(col, side);
  const x0 = rect.x * TILE;
  const rng = mulberry32(0x9a7d + slot * 31);
  const walls: WallSegment[] = [];
  const windows: WallItemPlacement[] = [];
  const floors: FloorPatch[] = [];
  const props: ExteriorProp[] = [];
  const W = COL_W * TILE;
  const T = (n: number) => n * TILE;
  const seed = () => Math.floor(rng() * 1e9);
  /** Deck de madeira com borda de pedra (tiles locais). */
  const deck = (lx: number, ly: number, w: number, h: number) => {
    floors.push({ kind: 'sidewalk', x: x0 + T(lx), y: T(rect.y + ly), w: T(w), h: T(h), seed: slot + 7 });
    floors.push({ kind: 'wood', x: x0 + T(lx) + 4, y: T(rect.y + ly) + 4, w: T(w) - 8, h: T(h) - 8, seed: slot + 8 });
  };

  if (side === 'north') {
    // fachada com janelas fechando o corredor (linhas 10–11)
    const fy = (CORRIDOR_Y - 2) * TILE;
    walls.push({ kind: 'face', x: x0, y: fy, w: W, style: EXTERIOR_WALL });
    [3, 8, 13].forEach((cx, i) =>
      windows.push({ id: `shell:${slot}:janela${i}`, kind: 'window', cx: x0 + cx * TILE, baseY: CORRIDOR_Y * TILE, on: 'face', order: 0 }),
    );
    if (lastColumn) walls.push({ kind: 'cap', x: x0 + W - TILE / 2, y: fy, w: TILE / 2, h: 2 * TILE, style: EXTERIOR_WALL });
    // caminho do gramado até o deck, deck no meio e canteiros sob as janelas
    floors.push({ kind: 'sidewalk', x: x0 + T(7), y: T(rect.y), w: T(2), h: T(3), seed: slot });
    deck(3, 3, 10, 5);
    props.push({ kind: 'parasol', x: x0 + T(5.5), y: T(rect.y + 6) + 4, seed: seed(), slot });
    props.push({ kind: 'parasol', x: x0 + T(10.5), y: T(rect.y + 6) + 4, seed: seed(), slot });
    props.push({ kind: 'bush', x: x0 + T(3.5), y: T(rect.y + 3) + 6, seed: seed(), slot });
    props.push({ kind: 'bush', x: x0 + T(12.5), y: T(rect.y + 3) + 6, seed: seed(), slot });
    for (const cx of [3, 8, 13]) props.push({ kind: 'flowers', x: x0 + T(cx), y: T(rect.y + 9) + 12, seed: slot * 3 + cx, slot });
    props.push({ kind: 'tree', x: x0 + T(1) + 4, y: T(rect.y + 3), seed: seed(), slot });
    props.push({ kind: rng() < 0.5 ? 'pine' : 'tree', x: x0 + T(15) - 4, y: T(rect.y + 3) + 6, seed: seed(), slot });
    props.push({ kind: 'bush', x: x0 + T(1) + 8, y: T(rect.y + 8), seed: seed(), slot });
    props.push({ kind: 'bush', x: x0 + T(15) - 8, y: T(rect.y + 8), seed: seed(), slot });
  } else {
    // mureta externa fechando o corredor (linha 17) e jardim abaixo, ligado à calçada da rua
    walls.push({ kind: 'south', x: x0, y: SOUTH_Y * TILE, w: W, style: EXTERIOR_WALL });
    if (lastColumn) walls.push({ kind: 'cap', x: x0 + W - TILE / 2, y: SOUTH_Y * TILE, w: TILE / 2, h: TILE, style: EXTERIOR_WALL });
    floors.push({ kind: 'sidewalk', x: x0 + T(7), y: T(rect.y + 1), w: T(2), h: T(rect.h - 1), seed: slot });
    // trecho entre a fachada e a calçada: só existe enquanto o slot está vazio (a cerca viva fecha)
    props.push({ kind: 'paving', x: x0 + T(7), y: T(BUILDING_H), seed: slot, slot });
    deck(3, 3.5, 10, 5);
    props.push({ kind: 'parasol', x: x0 + T(5.5), y: T(rect.y + 6.5) + 4, seed: seed(), slot });
    props.push({ kind: 'parasol', x: x0 + T(10.5), y: T(rect.y + 6.5) + 4, seed: seed(), slot });
    props.push({ kind: 'bush', x: x0 + T(3.5), y: T(rect.y + 4) + 4, seed: seed(), slot });
    props.push({ kind: 'bush', x: x0 + T(12.5), y: T(rect.y + 4) + 4, seed: seed(), slot });
    for (const cx of [3, 13]) props.push({ kind: 'flowers', x: x0 + T(cx), y: T(rect.y + 2), seed: slot * 3 + cx, slot });
    props.push({ kind: 'bench', x: x0 + T(4), y: T(rect.y + 10) + 6, seed: slot, slot });
    props.push({ kind: 'bench', x: x0 + T(12), y: T(rect.y + 10) + 6, seed: slot + 1, slot });
    props.push({ kind: 'tree', x: x0 + T(1) + 6, y: T(rect.y + 11), seed: seed(), slot });
    props.push({ kind: rng() < 0.5 ? 'pine' : 'tree', x: x0 + T(15) - 6, y: T(rect.y + 11) + 4, seed: seed(), slot });
    props.push({ kind: 'rock', x: x0 + T(14), y: T(rect.y + 2) + 4, seed: slot + 3, slot });
  }
  return { slot, rect, walls, windows, floors, props };
}
