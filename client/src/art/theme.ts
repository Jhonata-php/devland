// Temas de sala (puros): paletas bem distintas. Sementes consecutivas (slots vizinhos)
// recebem temas diferentes; a ordem da lista alterna famílias de cor de propósito.
import type { RoomTheme } from './api';

// Visual DevLand: salas de projeto escuras, com piso grafite/azul-noite, paredes escuras e um neon diferente por sala
// (o detalhe da parede, o tapete e o acento acendem na cor da sala). As salas comuns (recepção, copa...) ficam como eram.
const THEMES: readonly RoomTheme[] = [
  { carpet: '#1f2a36', carpet2: '#1a2430', wall: { base: '#2b3544', trim: '#39ff88', pattern: 'plain' }, accent: '#39ff88', deskVariant: 'dark', chairVariant: 'black' },
  { carpet: '#231f36', carpet2: '#1d1a2f', wall: { base: '#30294a', trim: '#b18cff', pattern: 'stripes' }, accent: '#b18cff', deskVariant: 'dark', chairVariant: 'gray' },
  { carpet: '#1b2c33', carpet2: '#16252b', wall: { base: '#253b44', trim: '#4de1ff', pattern: 'plain' }, accent: '#4de1ff', deskVariant: 'white', chairVariant: 'blue' },
  { carpet: '#2f2420', carpet2: '#281e1b', wall: { base: '#3d302a', trim: '#ffb547', pattern: 'wood_panel' }, accent: '#ffb547', deskVariant: 'wood', chairVariant: 'black' },
  { carpet: '#33202a', carpet2: '#2b1a23', wall: { base: '#432a37', trim: '#ff5c8a', pattern: 'plain' }, accent: '#ff5c8a', deskVariant: 'dark', chairVariant: 'red' },
  { carpet: '#1c2e25', carpet2: '#17271f', wall: { base: '#263c31', trim: '#6ee7a0', pattern: 'stripes' }, accent: '#6ee7a0', deskVariant: 'dark', chairVariant: 'green' },
  { carpet: '#262a30', carpet2: '#20242a', wall: { base: '#333942', trim: '#f2c14e', pattern: 'brick' }, accent: '#f2c14e', deskVariant: 'dark', chairVariant: 'black' },
  { carpet: '#1e2238', carpet2: '#191c30', wall: { base: '#29304d', trim: '#6f8cff', pattern: 'wood_panel' }, accent: '#6f8cff', deskVariant: 'white', chairVariant: 'blue' },
  { carpet: '#2c2333', carpet2: '#251d2b', wall: { base: '#3a2e44', trim: '#e47aff', pattern: 'stripes' }, accent: '#e47aff', deskVariant: 'dark', chairVariant: 'gray' },
  { carpet: '#1d2b2b', carpet2: '#182424', wall: { base: '#283a3a', trim: '#36d6c3', pattern: 'plain' }, accent: '#36d6c3', deskVariant: 'wood', chairVariant: 'green' },
];

export const THEME_COUNT = THEMES.length;

export function roomTheme(seed: number): RoomTheme {
  const n = THEMES.length;
  const t = THEMES[((Math.floor(seed) % n) + n) % n];
  return { ...t, wall: { ...t.wall } };
}
