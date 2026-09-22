/**
 * Network guard for the unit suite.
 *
 * Every test file starts with a `fetch` that fails the test on any request to
 * a non-local host. Tests that exercise HTTP stub fetch (test/helpers/
 * fetch-mock.js); `vi.unstubAllGlobals()` restores this guard, not the real
 * fetch, because the guard is assigned directly rather than via stubGlobal.
 *
 * Added in 1.0 after the suite was found making live calls to
 * api.stability.ai: several relight tests relied on a nonexistent input file
 * to fail, but a leaked buildFormData mock meant the file was never read and
 * the request went out. Harmless (fake keys; the server validates before
 * auth) but a unit suite must not depend on — or talk to — the network.
 */

import { afterEach } from 'vitest';

const realFetch = globalThis.fetch;
const violations = [];

globalThis.fetch = async (url, init) => {
  const { hostname } = new URL(String(url));
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return realFetch(url, init);
  }
  const message = `Unexpected network request in unit test: ${init?.method ?? 'GET'} ${url} — stub fetch (test/helpers/fetch-mock.js)`;
  violations.push(message);
  throw new Error(message);
};

// The throw above can be swallowed by a test's own try/catch — which is exactly
// how the leaking tests passed. Recording it and failing here cannot be.
afterEach(() => {
  if (violations.length > 0) {
    const found = violations.splice(0);
    throw new Error(found.join('\n'));
  }
});
