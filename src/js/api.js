// @ts-check
/**
 * Thin client for the public Squeekchain API (https://api.squeekchain.com/v1).
 * Read-only GET requests, no credentials. Every call resolves to a Result;
 * it never throws, so one failing endpoint cannot break the others.
 *
 * Result kinds:
 *   ok          data parsed and passed its shape check
 *   unavailable HTTP 200 with {"status":"unavailable"}: unknown, never zero
 *   error       network, HTTP, parse or schema failure
 */

export const API_BASE = 'https://api.squeekchain.com/v1';

/**
 * @typedef {{kind:'ok', data:any, at:number, settlementSource?:string|null}
 *   | {kind:'unavailable', reason:string, at:number}
 *   | {kind:'error', message:string, code?:string, retryAfterMs?:number, at:number}} Result
 */

/**
 * Shape checks. Each returns an error message, or null when the payload is usable.
 * Versions follow the docs' advice: reject schema versions we were not written for.
 * @type {Record<string, (d:any) => string | null>}
 */
export const validators = {
  status: (d) =>
    d.schemaVersion !== 1 ? `unsupported status schema ${d.schemaVersion}` :
    !('measurement' in d) ? 'status response has no measurement field' : null,
  events: (d) =>
    d.schemaVersion !== 4 ? `unsupported events schema ${d.schemaVersion}` :
    !Array.isArray(d.events) ? 'events response has no events list' : null,
  runs: (d) =>
    d.schemaVersion !== 'measurement-runs.v1' ? `unsupported runs schema ${d.schemaVersion}` :
    !Array.isArray(d.items) ? 'runs response has no items list' : null,
  blocks: (d) =>
    d.schemaVersion !== 'game-block-projection.v1' ? `unsupported blocks schema ${d.schemaVersion}` :
    !Array.isArray(d.blocks) ? 'blocks response has no blocks list' : null,
  stats: (d) =>
    d.schemaVersion !== 1 ? `unsupported stats schema ${d.schemaVersion}` :
    typeof d.window !== 'object' ? 'stats response has no window' : null,
  settlements: (d) =>
    d.schemaVersion !== 3 ? `unsupported settlements schema ${d.schemaVersion}` :
    !Array.isArray(d.recentSettlements) ? 'settlements response has no settlement list' : null,
};

/** @param {string} code */
function describeError(code) {
  /** @type {Record<string,string>} */
  const map = {
    rate_limited: 'rate limited by the API',
    database_busy: 'API database busy',
    indexer_busy: 'API indexer busy',
    database_unavailable: 'API database unavailable',
    request_timeout: 'API request timed out',
    internal_error: 'API internal error',
    invalid_query: 'invalid request',
    not_found: 'endpoint not found',
  };
  return map[code] ?? code;
}

/**
 * Fetch one endpoint.
 * @param {string} path e.g. "/status"
 * @param {keyof typeof validators} kind
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<Result>}
 */
export async function getJson(path, kind, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 9000);
  const at = Date.now();
  try {
    const res = await fetchImpl(API_BASE + path, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
      credentials: 'omit',
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      return { kind: 'error', message: `response from ${path} was not JSON (HTTP ${res.status})`, at };
    }
    if (!res.ok) {
      const ra = Number(res.headers.get('Retry-After'));
      const code = body && typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
      return {
        kind: 'error',
        message: describeError(code),
        code,
        retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined,
        at,
      };
    }
    if (!body || typeof body !== 'object') {
      return { kind: 'error', message: `unexpected response from ${path}`, at };
    }
    if (body.status === 'unavailable') {
      return { kind: 'unavailable', reason: humanReason(body.reason), at };
    }
    const problem = validators[kind](body);
    if (problem) return { kind: 'error', message: problem, at };
    return {
      kind: 'ok', data: body, at,
      ...(kind === 'settlements' ? { settlementSource: res.headers.get('X-Squeek-Settlement-Source') } : {}),
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return { kind: 'error', message: aborted ? 'request timed out' : 'network error, API unreachable', at };
  } finally {
    clearTimeout(timer);
  }
}

/** @param {unknown} reason */
export function humanReason(reason) {
  if (typeof reason !== 'string' || !reason) return 'no reason given';
  return reason.replace(/_/g, ' ');
}
