/**
 * MAJIN V4 — per-turn context that tools can read without changing their shape.
 *
 * V2's tool contract is `execute(input)`. V4 needs two tools that act on the
 * *turn* rather than on their input: `tools_activate` (make a discovered tool
 * callable in the next model round) and `agent_delegate` (run a bounded
 * sub-task inside the same goal). Threading a turn handle through every
 * signature would mean rewriting the V2 runner and every adapted V1 tool.
 *
 * AsyncLocalStorage does it without touching either: the agent wraps the one
 * call it already makes, and only the tools that ask for the turn see it.
 *
 * What is deliberately NOT here: secrets, messages, or the model. A tool that
 * reads the turn gets an exposure handle, the goal id and an emit function.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/** Run `fn` with `state` visible to `turnState()` inside it. */
export function runInTurn(state, fn) {
  return storage.run(state, fn);
}

/** The current turn, or null when a tool is called outside an agent turn. */
export function turnState() {
  return storage.getStore() || null;
}

/** Stable across an approval pause, isolated from other goals and delegates. */
export function hostSessionId(base = 'v4', state = turnState()) {
  return state?.goal?.id ? `${base}:${state.goal.id}` : base;
}
