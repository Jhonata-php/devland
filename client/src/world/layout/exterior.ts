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

  // Estúdio tech à noite: em volta do andar só a noite escura (sem grama, árvores nem rua); a cidade aparece como skyline
  // desenhado pelo renderer acima do prédio. Uma calçada escura estreita contorna o prédio e leva à entrada (oeste).
  floors.push({ kind: 'street', x: px(bounds.x), y: px(bounds.y), w: px(bounds.w), h: px(bounds.h), seed: 11 });
  floors.push({ kind: 'concrete', x: px(-2), y: px(-1), w: px(w + 4), h: px(BUILDING_H + 2), seed: 12 });
  floors.push({ kind: 'concrete', x: px(-8), y: px(CORRIDOR_Y), w: px(6), h: px(5), seed: 13 });
  props.push({ kind: 'totem', x: px(-5) + 6, y: px(CORRIDOR_Y + 1), seed: 2 });
  void rng;
  return { bounds, floors, props, lanes: [], streetY: 0, streetH: 0 };
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
  // Estúdio tech à noite: slot vazio fica só com a fachada (sem deck, guarda-sóis nem árvores) sobre a noite escura.
  void floors;
  void props;
  return { slot, rect, walls, windows, floors: [], props: [] };
}
