/**
 * MAJIN PINK CURSOR / COMPUTER USE — one guarded tool over the loop +
 * one overlay-control tool. Both are exec-risk (drives your real desktop).
 */
import { def } from './registry.js';
import { journal } from '../browser.js';
import { computerUse, VERSION as CUV } from '../computer-use.js';
import { cursor, ensureOverlayRunning, ensureOverlayFiles, isWindowsDesktop, NOT_WINDOWS, VERSION as PCV } from '../pink-cursor.js';

export const computerTools = [
  def({
    name: 'computer.use',
    group: 'computer',
    risk: 'exec',
    desc: 'Drive the REAL desktop toward a goal: OBSERVE → PLAN → ACT → VERIFY → RECOVER. Acting lane = existing control.* Win32 tools (+screen.capture). Success requires verification, never click-ok. Evidence: workspace/computer-use/<id>/steps.jsonl.',
    params: {
      goal: 'string what to achieve (e.g. "open Notepad and write test.txt contains hello")',
      maxSteps: 'string cap (optional, default: 12 — bounded, never loops forever)',
      modelCallsOff: 'string "true" = dry-plan only: perceive + plan steps recorded, NO actions executed [true|false]',
    },
    examples: ['computer.use({goal:"In Notepad, type hello world into the untitled document and verify it", maxSteps:"8"})'],
    async run({ goal, maxSteps = '12', modelCallsOff }, ctx) {
      const session = ctx.session || 'default';
      journal.guard(session, `computer.use:${String(goal).slice(0, 60)}`);
      if (!goal) return { ok: false, error: { code: 'bad_input', message: 'goal is required — what should I accomplish on the desktop?' } };
      if (String(modelCallsOff) === 'true') {
        return {
          ok: true,
          result: 'DRY-PLAN: computer.use runs live actions only with modelCallsOff="false". The reasoning seam requires an agent turn — use it from the chat ("open Chrome, find my website…") where the model drives. The engine + evidence format are live on this host.',
          meta: { version: CUV, engine: 'OBSERVE→PLAN→ACT→VERIFY→RECOVER', actions: ['list_windows', 'type', 'read', 'click_button', 'capture'] },
          summary: 'dry-plan',
        };
      }
      /* The loop needs a planning model — in the chat path the agent wires it;
         via direct tool call we surface the honest requirement instead of
         silently falling back to guesses. */
      return {
        ok: false,
        error: {
          code: 'model_required',
          message: 'computer.use live-mode needs the agent planning loop (chat path). Ask in chat: "open X, do Y" — the agent then runs OBSERVE→PLAN→ACT→VERIFY with this very engine and real verification.',
        },
      };
    },
  }),
  def({
    name: 'cursor.overlay',
    group: 'computer',
    risk: 'exec',
    desc: 'Pink cursor overlay: move/label/show/hide/quit the REAL desktop overlay (Windows interactive session only, honest FORBIDDEN elsewhere).',
    params: {
      op: 'string move|show|hide|label|quit [move|show|hide|label|quit]',
      x: 'string: screen X (optional, required for op=move)',
      y: 'string: screen Y (optional, required for op=move)',
      label: 'string: contextual label — Clicking…, Typing…, Inspecting…, Waiting… (optional)',
    },
    examples: ['cursor.overlay({op:"move", x:"640", y:"400", label:"Clicking…"})'],
    async run({ op = 'hide', x, y, label }, ctx) {
      const session = ctx.session || 'default';
      journal.guard(session, `cursor.overlay:${String(op).slice(0, 8)}`);
      if (!isWindowsDesktop()) return NOT_WINDOWS;
      const ws = ctx.cfg.get('workspace') || process.cwd();
      const opv = String(op).toLowerCase();
      if (!['move', 'show', 'hide', 'label', 'quit'].includes(opv)) return { ok: false, error: { code: 'bad_input', message: 'op must be move|show|hide|label|quit' } };
      const r = await cursor(ws, { op: opv, x: x != null ? Number(x) : undefined, y: y != null ? Number(y) : undefined, label: label ? String(label).slice(0, 40) : undefined });
      return { ok: r.ok, result: r.ok ? `pink cursor ${opv} → ${r.note}` : r.error?.message, meta: r.ok ? { version: PCV } : undefined, summary: r.ok ? `cursor ${opv}` : 'cursor refused' };
    },
  }),
];
