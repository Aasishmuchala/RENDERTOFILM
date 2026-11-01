// The tool registry: every ToolImpl by name, checked against the contracts when it is
// built, so a tool that is missing, unlisted or out of step with its schema stops the
// server at start and never reaches a Turn. `defs` is TOOLS itself, in its sorted order,
// because the prompt cache keys on those bytes.
import { TOOLS } from '../contracts.ts';
import { canonicalJson, type ToolCtx, type ToolImpl, type ToolRegistry, type ToolRunCtx } from '../domain.ts';

/**
 * The loop passes a ToolCtx and a tool works with a ToolRunCtx; `bind` builds one from the
 * other. Without it, `run` must be handed a whole ToolRunCtx.
 */
export function createRegistry(
  impls: ToolImpl[],
  bind: (ctx: ToolCtx) => ToolRunCtx | Promise<ToolRunCtx> = (ctx) => ctx as ToolRunCtx
): ToolRegistry {
  const byName = new Map(impls.map((impl) => [impl.def.name, impl]));
  const stray = impls.find((impl, i) => {
    const listed = TOOLS.some((def) => def.name === impl.def.name);
    return !listed || impls.findIndex((other) => other.def.name === impl.def.name) !== i;
  });
  if (stray) throw new Error(`The tool ${stray.def.name} is not in the contracts, or is listed twice.`);
  for (const def of TOOLS) {
    const impl = byName.get(def.name);
    if (!impl) throw new Error(`The tool ${def.name} has no implementation.`);
    if (canonicalJson(impl.def) !== canonicalJson(def)) throw new Error(`The tool ${def.name} differs from its contract.`);
  }
  return {
    defs: TOOLS,
    async run(name, input, ctx) {
      const impl = byName.get(name);
      if (!impl) return { content: [{ type: 'text', text: `Unknown tool ${name}.` }], isError: true };
      return impl.run(input, await bind(ctx));
    },
  };
}
