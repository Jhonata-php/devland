// Robô aspirador: só desenho (não é agente nem entra na simulação). Passeia devagar pelo chão livre do prédio,
// para quando alguém passa na frente e descansa um pouco a cada destino.
import { TILE } from '../../art/api';
import { FREE } from '../path/grid';
import type { Sim } from '../sim/sim';

/** px de mundo por segundo. */
const SPEED = 1.3 * TILE;
/** Alguém a menos disto (px) do próximo passo: o robô espera. */
const CLEARANCE = 11;

export class Robot {
  x = 0;
  y = 0;
  private path: number[] = [];
  private i = 0;
  private restUntil = 0;
  private blockedSince = 0;
  private version = -1;
  private placed = false;
  /** Sentido do movimento (para o farolzinho da frente). */
  private dx = 1;
  private dy = 0;

  update(sim: Sim, dt: number, now: number): void {
    const grid = sim.building.grid;
    if (sim.layoutVersion !== this.version) {
      // prédio mudou: recomeça do chão livre mais perto (ou da recepção)
      this.version = sim.layoutVersion;
      this.path = [];
      const tx = Math.floor(this.x / TILE);
      const ty = Math.floor(this.y / TILE);
      if (!this.placed || grid.get(tx, ty) !== FREE) {
        const n = grid.nearestWalkable(this.placed ? tx : 4, this.placed ? ty : 9, 30);
        if (!n) return;
        this.x = (n.x + 0.5) * TILE;
        this.y = (n.y + 0.5) * TILE;
        this.placed = true;
      }
    }
    if (now < this.restUntil) return;
    if (this.i >= this.path.length) {
      this.pickGoal(sim);
      this.restUntil = now + 1500 + Math.random() * 3500;
      return;
    }
    const gx = (this.path[this.i] + 0.5) * TILE;
    const gy = (this.path[this.i + 1] + 0.5) * TILE;
    // alguém no caminho: espera; se demorar, procura outro destino
    for (const p of sim.people()) {
      if (!p.visible || p.alpha < 0.3) continue;
      if (Math.hypot(p.x - gx, p.y - gy) < CLEARANCE || Math.hypot(p.x - this.x, p.y - this.y) < CLEARANCE - 3) {
        this.blockedSince ||= now;
        if (now - this.blockedSince > 2500) {
          this.path = [];
          this.blockedSince = 0;
        }
        return;
      }
    }
    this.blockedSince = 0;
    const ddx = gx - this.x;
    const ddy = gy - this.y;
    const d = Math.hypot(ddx, ddy);
    const step = SPEED * Math.min(dt, 0.1);
    if (d <= step) {
      this.x = gx;
      this.y = gy;
      this.i += 2;
    } else {
      this.x += (ddx / d) * step;
      this.y += (ddy / d) * step;
      this.dx = ddx / d;
      this.dy = ddy / d;
    }
  }

  /** Um destino sorteado no chão livre (corredor, salas, copa...), alcançável a partir de onde está. */
  private pickGoal(sim: Sim): void {
    const grid = sim.building.grid;
    const sx = Math.floor(this.x / TILE);
    const sy = Math.floor(this.y / TILE);
    this.path = [];
    this.i = 0;
    for (let tries = 0; tries < 20; tries++) {
      const gx = Math.floor(Math.random() * grid.w);
      const gy = Math.floor(Math.random() * grid.h);
      if (grid.get(gx, gy) !== FREE || Math.hypot(gx - sx, gy - sy) < 4) continue;
      const out: number[] = [];
      if (sim.finder.find(sx, sy, gx, gy, out) && out.length) {
        this.path = out;
        return;
      }
    }
  }

  /** Disco escuro com aro claro, para-choque na frente e um led que pisca; desenhado no chão (sob as pessoas). */
  draw(ctx: CanvasRenderingContext2D, now: number): void {
    if (!this.placed) return;
    const x = Math.round(this.x);
    const y = Math.round(this.y) + 3;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x - 5, y + 2, 11, 2);
    // corpo: elipse 11x6 em linhas
    const rows: [number, number][] = [[-3, 3], [-2, 5], [-1, 5], [0, 5], [1, 5], [2, 3]];
    for (const [dy, half] of rows) {
      ctx.fillStyle = dy === -3 || dy === -2 ? '#59606d' : dy === 2 ? '#1c1f25' : '#2e333c';
      ctx.fillRect(x - half, y + dy, half * 2 + 1, 1);
    }
    // botão no meio e o led (verde parado, azul andando), piscando
    ctx.fillStyle = '#8a92a0';
    ctx.fillRect(x - 1, y - 1, 3, 1);
    const moving = this.i < this.path.length && now >= this.restUntil;
    if (Math.floor(now / 500) % 2 === 0) {
      ctx.fillStyle = moving ? '#4de1ff' : '#4ade80';
      ctx.fillRect(x + Math.round(this.dx * 3), y - 1 + Math.round(this.dy * 1), 1, 1);
    }
  }
}
