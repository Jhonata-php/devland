// Função do agente na interface: etiqueta com ícone e cor próprios (tema hacker), usada no personagem do mapa, na
// barra lateral, no cartão e nas Conversas. A regra de qual função é fica em shared/roles.ts.
import { tr } from '../../../shared/i18n';
import { agentRole, ROLES, type RoleId } from '../../../shared/roles';
import type { AgentInfo, RoomInfo } from '../../../shared/types';
import { h, setHidden, setStyleVar, setText, setTitle } from './dom';

export function roleLabel(id: RoleId): string {
  switch (id) {
    case 'front':
      return tr('Front-end');
    case 'back':
      return tr('Back-end');
    case 'tests':
      return tr('Testes');
    case 'infra':
      return tr('DevOps');
    case 'review':
      return tr('Revisão');
    default:
      return tr('Design');
  }
}

/** Função do agente, achando a sala dele no escritório. */
export function roleOf(a: AgentInfo, rooms: readonly RoomInfo[] | undefined): RoleId | undefined {
  return agentRole(a, rooms?.find((r) => r.id === a.roomId));
}

export function createFuncChip(): HTMLElement {
  return h('span', { class: 'ui-func', hidden: true });
}

/** Etiqueta pronta (lista de Conversas): vazia quando não há função. */
export function funcChip(role: RoleId | undefined): HTMLElement {
  const el = createFuncChip();
  updateFuncChip(el, role);
  return el;
}

/** `role` ausente esconde a etiqueta. */
export function updateFuncChip(el: HTMLElement, role: RoleId | undefined): void {
  setHidden(el, !role);
  if (!role) return;
  const r = ROLES[role];
  setText(el, `${r.icon} ${roleLabel(role)}`);
  setTitle(el, tr('Função: {0}', [roleLabel(role)]));
  setStyleVar(el, '--func', r.color);
  el.dataset.role = role;
}
