/**
 * LENT — alla verktyg på ett ställe. Inget att aktivera.
 */
import { Registry } from './registry.js';
import { fileTools } from './files.js';
import { shellTools } from './shell.js';
import { sysTools } from './sys.js';
import { netTools } from './net.js';
import { webTools } from './web.js';
import { reTools } from './re.js';
import { lentTools } from './lent.js';
import { agentTools } from './agent.js';
import { approvals } from '../guard.js';

export const ALL_TOOLS = [...fileTools, ...shellTools, ...sysTools, ...netTools, ...webTools, ...reTools, ...lentTools, ...agentTools];

export function buildRegistry(ctx) {
  if (!ctx.approvals) ctx.approvals = approvals;
  const reg = new Registry(ALL_TOOLS, ctx);
  ctx.registry = reg;
  return reg;
}

export function toolCount() {
  return ALL_TOOLS.length;
}

export { Registry, ALL_TOOLS as tools };
