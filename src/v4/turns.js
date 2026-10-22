/**
 * MAJIN V4 — turn journal.
 *
 * A turn is the unit a phone can lose. Mobile networks drop mid-answer, iOS
 * suspends a backgrounded tab, a tunnel hiccups. Before this module a dropped
 * response aborted the turn, so the work was lost and the user had to ask
 * again — the opposite of "close the app and come back".
 *
 * The journal decouples the turn from the HTTP response:
 *   - the agent runs to completion regardless of who is listening
 *   - every event gets a monotonically increasing sequence number
 *   - a client can reattach with `from=<lastSeq>` and receive exactly the
 *     events it missed, then continue live
 *
 * Bounded on purpose: a fixed number of turns and events, pruned by age. This
 * is a reconnection buffer, not an event-sourcing store.
 */

export const JOURNAL_MAX_TURNS = 50;
export const JOURNAL_MAX_EVENTS = 2000;
export const JOURNAL_TTL_MS = 10 * 60 * 1000;

export class TurnJournal {
  constructor({ maxTurns = JOURNAL_MAX_TURNS, maxEvents = JOURNAL_MAX_EVENTS, ttlMs = JOURNAL_TTL_MS, now = () => Date.now() } = {}) {
    this.maxTurns = maxTurns;
    this.maxEvents = maxEvents;
    this.ttlMs = ttlMs;
    this.now = now;
    this.turns = new Map(); // id -> turn
    this.order = [];
  }

  prune() {
    const cutoff = this.now() - this.ttlMs;
    for (const id of [...this.order]) {
      const turn = this.turns.get(id);
      if (!turn) {
        this.order = this.order.filter((x) => x !== id);
        continue;
      }
      if (turn.updatedAt < cutoff || (turn.done && this.turns.size > this.maxTurns)) {
        this.turns.delete(id);
        this.order = this.order.filter((x) => x !== id);
      }
    }
    while (this.order.length > this.maxTurns) {
      const id = this.order.shift();
      this.turns.delete(id);
    }
  }

  create({ conversationId = null, id = null } = {}) {
    this.prune();
    const turn = {
      id: id || `turn_${this.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      conversationId,
      seq: 0,
      events: [],
      subscribers: new Set(),
      done: false,
      status: 'running',
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.turns.set(turn.id, turn);
    this.order.push(turn.id);
    // Enforce the cap here too: pruning only on entry would let the list grow
    // by one turn per call until the next create.
    while (this.order.length > this.maxTurns) {
      const dropped = this.order.shift();
      this.turns.delete(dropped);
    }
    return turn;
  }

  get(id) {
    return this.turns.get(id) || null;
  }

  /** Record an event and forward it to everyone currently attached. */
  append(turn, type, data) {
    if (!turn) return null;
    turn.seq += 1;
    turn.updatedAt = this.now();
    const event = { seq: turn.seq, type, data, at: this.now() };
    turn.events.push(event);
    if (turn.events.length > this.maxEvents) turn.events.splice(0, turn.events.length - this.maxEvents);
    for (const fn of turn.subscribers) {
      try {
        fn(event);
      } catch {
        /* a broken subscriber must not stop the turn */
      }
    }
    return event;
  }

  finish(turn, status = 'completed') {
    if (!turn) return;
    turn.done = true;
    turn.status = status;
    turn.updatedAt = this.now();
    for (const fn of turn.subscribers) {
      try {
        fn({ seq: turn.seq, type: '__done', data: { status }, at: this.now() });
      } catch { /* ignored */ }
    }
    turn.subscribers.clear();
  }

  /**
   * Replay from `from` (exclusive) and then follow live. Returns an unsubscribe
   * function. If the turn already finished, only the replay happens.
   */
  subscribe(turn, from, handler) {
    const start = Number.isFinite(from) && from > 0 ? from : 0;
    for (const event of turn.events) {
      if (event.seq > start) handler(event);
    }
    if (turn.done) {
      handler({ seq: turn.seq, type: '__done', data: { status: turn.status }, at: this.now() });
      return () => {};
    }
    turn.subscribers.add(handler);
    return () => turn.subscribers.delete(handler);
  }

  /** Last sequence number a client should hold. */
  head(turn) {
    return turn ? turn.seq : 0;
  }
}
