// Real-mode ledger — one JSON line per event in higgsfield-ledger.jsonl.
// Append-only, so a restart (or a crash mid-run) never loses what was spent:
// the budget is summed back from this file, not held in memory.
//
// Line shape: { t, session, mode, event, taskId, appType, ... }; events are
// quote, refused, dry-submit, submit, resume, result, error.
import fs from 'node:fs';
import path from 'node:path';

const SPEND_EVENTS = new Set(['submit', 'dry-submit']);

/** Appends one line, stamping `t` (ISO) when the caller gave none. */
export function append(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row = line.t ? line : { t: new Date().toISOString(), ...line };
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  return row;
}

/** Every well-formed line, oldest first; a missing file is empty, a bad line is skipped. */
export function readAll(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const rows = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    try {
      const row = JSON.parse(raw);
      if (row && typeof row === 'object' && !Array.isArray(row)) rows.push(row);
    } catch {
      // half-written or hand-edited line: ignore it
    }
  }
  return rows;
}

/** Credits already committed in this session and mode (submit + dry-submit). */
export function spent(file, { session, mode }) {
  let total = 0;
  for (const row of readAll(file)) {
    if (!SPEND_EVENTS.has(row.event) || row.session !== session || row.mode !== mode) continue;
    if (Number.isFinite(row.credits)) total += row.credits;
  }
  return total;
}

const show = (n) => String(Math.round(n * 100) / 100);

/** `{ ok: true }`, or `{ ok: false, message }` when this quote would pass the budget. */
export function budgetCheck({ spent: used, quote, budget, session }) {
  if (Math.round((used + quote) * 100) <= Math.round(budget * 100)) return { ok: true };
  return {
    ok: false,
    message:
      `Real-mode budget reached: this run quotes ${show(quote)} credits and ` +
      `${show(used)} of ${show(budget)} are already used this session (${session}). ` +
      'Raise REAL_GEN_BUDGET or set REAL_GEN_SESSION to start a new budget.',
  };
}

/** REAL_GEN_BUDGET as credits: unset, blank, negative or not a number -> `fallback`. */
export function parseBudget(value, fallback = 60) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
