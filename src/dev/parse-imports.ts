/** The export-clause reader behind `bay:pending-imports`. No Vite import, so
 * the monorepo can unit-test it (`studio-agent/src/parse-imports.test.ts`). */

export interface RequestedExports {
  names: string[];
  hasDefault: boolean;
}

/**
 * Names the stub has to carry, read off the importer — native ESM checks named
 * exports exist, so a default-only stub still fails. `null` falls through to
 * Vite's normal error. `import * as ns` is unsupported on purpose: a namespace
 * can't be given unknown members, so a stub trades a clear build error for a
 * confusing runtime one.
 */
export function parseRequestedExports(
  importerSource: string,
  specifier: string
): RequestedExports | null {
  const quoted = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Every statement, not just the first — TypeScript splits a path across
  // `import type { … }` and a value import. No `from` inside the clause, or a
  // semicolon-free file lets one match swallow the statement above it.
  const statements = [
    ...importerSource.matchAll(
      new RegExp(
        `(?:import|export)\\s+((?:(?!\\bfrom\\b)[^;])*?)\\s+from\\s*['"]${quoted}['"]`,
        'g'
      )
    ),
  ];

  if (statements.length === 0) {
    // A bare side-effect import (`import './x'`) needs no exports at all.
    const sideEffect = new RegExp(`import\\s*['"]${quoted}['"]`).test(
      importerSource
    );
    return sideEffect ? { names: [], hasDefault: false } : null;
  }

  let hasDefault = false;
  const names = new Set<string>();

  for (const statement of statements) {
    const clause = statement[1]?.trim() ?? '';
    // Erased before the browser sees it, so it asks nothing of the stub.
    // Skipped before the default-name check, which would otherwise read the
    // `type` keyword itself as a default import.
    if (/^type\b/.test(clause)) continue;
    if (clause.includes('*')) return null;

    const braced = /\{([\s\S]*)\}/.exec(clause);
    const beforeBrace = braced ? clause.slice(0, clause.indexOf('{')) : clause;

    const defaultName = beforeBrace.replace(/,\s*$/, '').trim();
    if (defaultName && /^[A-Za-z_$][\w$]*$/.test(defaultName))
      hasDefault = true;

    for (const part of braced?.[1]?.split(',') ?? []) {
      // `b as c` must export `b` — the importer's local alias is irrelevant.
      const source = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0];
      const name = source?.trim();
      if (name === 'default') hasDefault = true;
      else if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }

  return { names: [...names], hasDefault };
}
