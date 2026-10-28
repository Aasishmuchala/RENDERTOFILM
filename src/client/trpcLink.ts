import {
  type HTTPBatchLinkOptions,
  httpBatchLink,
  splitLink,
  type TRPCLink,
} from '@trpc/client';
import type { AnyTRPCRouter } from '@trpc/server';

/**
 * Longest URL a query batch is sent as GET with. Node refuses a request head
 * over 16 KB (a bodyless 431) and that head also carries the visitor's
 * cookies and the gateway's identity headers, so the URL gets a quarter.
 */
export const MAX_QUERY_URL_LENGTH = 4096;

type BayTrpcLinkOptions<TRouter extends AnyTRPCRouter> = Omit<
  HTTPBatchLinkOptions<TRouter['_def']['_config']['$types']>,
  'methodOverride'
>;

/**
 * The app's tRPC link: queries go out as GET, mutations as POST.
 *
 * A signed-out visitor of a public app is view-only — Bay's gateway lets
 * through GET and HEAD and refuses everything else — so a query sent as
 * POST would leave a public preview with no data. A query whose input won't
 * fit in {@link MAX_QUERY_URL_LENGTH} still goes as POST, which the server
 * mount accepts (`allowMethodOverride: true` in `src/routes.ts`); that only
 * works for a signed-in visitor, so keep the inputs of queries a public page
 * runs small.
 */
export function bayTrpcLink<TRouter extends AnyTRPCRouter>(
  opts: BayTrpcLinkOptions<TRouter>
): TRPCLink<TRouter> {
  const maxURLLength = opts.maxURLLength ?? MAX_QUERY_URL_LENGTH;
  const { transformer } = opts as { transformer?: unknown };
  const getOpts = { ...opts, maxURLLength } as HTTPBatchLinkOptions<
    TRouter['_def']['_config']['$types']
  >;
  const postOpts = { ...opts, methodOverride: 'POST' } as HTTPBatchLinkOptions<
    TRouter['_def']['_config']['$types']
  >;
  return splitLink<TRouter>({
    condition: (op) =>
      op.type === 'query' &&
      queryUrlLength(
        opts.url,
        op.path,
        serializeInput(transformer, op.input)
      ) <= maxURLLength,
    true: httpBatchLink<TRouter>(getOpts),
    false: httpBatchLink<TRouter>(postOpts),
  });
}

type InputSerializer = { serialize: (value: unknown) => unknown };

/**
 * The input as the link's `transformer` (e.g. superjson) puts it on the
 * wire: either a plain `{ serialize }` or an `{ input, output }` pair.
 */
function serializeInput(transformer: unknown, input: unknown): unknown {
  if (transformer == null) return input;
  const t = transformer as Partial<InputSerializer> & {
    input?: InputSerializer;
  };
  if (t.input) return t.input.serialize(input);
  return t.serialize ? t.serialize(input) : input;
}

/**
 * The URL `httpBatchLink` would GET for this query on its own, given its
 * already-serialized input. An input JSON can't encode measures as
 * unbounded, so it takes the POST link, which reports the error itself.
 */
export function queryUrlLength(
  url: string | URL,
  path: string,
  serializedInput: unknown
): number {
  let encoded: string;
  try {
    encoded = encodeURIComponent(JSON.stringify({ 0: serializedInput }));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  const [base = '', search] = url.toString().split('?');
  const params = [search, 'batch=1'].filter(Boolean);
  params.push('input=' + encoded);
  return (base.replace(/\/$/, '') + '/' + path + '?' + params.join('&')).length;
}
