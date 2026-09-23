# Decisions — stability-ai-api 1.0

Why the 1.0 rewrite is shaped the way it is: what was decided, the reason, and what
would break the reasoning. Where a decision copies bfl-api 2.0.1, it says so and cites
bfl's `docs/DECISIONS.md` number, so a fix to one package can be carried to the other.

**Contents**

- [1. Scope of the 1.0 endpoint set](#1-scope-of-the-10-endpoint-set)
- [2. Send only what the caller set; one registry of fields](#2-send-only-what-the-caller-set-one-registry-of-fields)
- [3. The spec is checked, not trusted](#3-the-spec-is-checked-not-trusted)
- [4. The server's validator is an oracle, and it is free](#4-the-servers-validator-is-an-oracle-and-it-is-free)
- [5. Where the spec and the server disagreed](#5-where-the-spec-and-the-server-disagreed)
- [6. SD 3.5 `mode` is derived, not a parameter](#6-sd-35-mode-is-derived-not-a-parameter)
- [7. Image-to-image rules are enforced before the request](#7-image-to-image-rules-are-enforced-before-the-request)
- [8. One `sd3` endpoint key](#8-one-sd3-endpoint-key)
- [9. Native fetch; API requests follow no redirects](#9-native-fetch-api-requests-follow-no-redirects)
- [10. SSRF: every hop, every address, every embedded form](#10-ssrf-every-hop-every-address-every-embedded-form)
- [11. Retry on type, only while polling](#11-retry-on-type-only-while-polling)
- [12. Typed errors, sanitised messages](#12-typed-errors-sanitised-messages)
- [13. The unit suite never touches the network](#13-the-unit-suite-never-touches-the-network)
- [14. Releases are manual; the version is 1.0.0](#14-releases-are-manual-the-version-is-100)
- [15. Line endings are LF](#15-line-endings-are-lf)
- [16. Response shapes are checked, not cast](#16-response-shapes-are-checked-not-cast)
- [17. The constructor takes the key three ways](#17-the-constructor-takes-the-key-three-ways)
- [18. CLI mapping lives in `cli-helpers.ts`](#18-cli-mapping-lives-in-cli-helpersts)
- [19. The library has no host-process side effects; the CLI does](#19-the-library-has-no-host-process-side-effects-the-cli-does)
- [20. A content-filtered result is a success with a warning, not an error](#20-a-content-filtered-result-is-a-success-with-a-warning-not-an-error)
- [21. Known gaps recorded rather than fixed in 1.0](#21-known-gaps-recorded-rather-than-fixed-in-10)
- [22. Task ids are validated before they are put in a URL](#22-task-ids-are-validated-before-they-are-put-in-a-url)
- [23. `undici` is a dependency, pinned to major 7](#23-undici-is-a-dependency-pinned-to-major-7)

## 1. Scope of the 1.0 endpoint set

1.0 covers the 17 `v2beta/stable-image` submit endpoints (generate ×3, upscale ×3,
edit ×7, control ×4) plus result polling and balance. It adds no endpoints: a diff
against the live spec on 2026-09-22 found all 17 already wired. What 0.4.0 lacked
was *fields* on them (SD 3.5 image-to-image, `cfg_scale`, `style_preset` on Ultra and
SD 3.5, conservative `creativity`, creative `style_preset`) and one model (#5).

**Deliberately out of scope** (Alex, 2026-09-22): Stable Fast 3D and SPAR3D
(`/v2beta/3d/*`), Stable Audio 1 and 2 (`/v2beta/audio/*`), the v1 SDXL engine routes,
and the superseded `/v2alpha/generation/*` routes. 3D and audio produce different
media and belong in their own modules if they come at all. The drift check (#3) walks
`ENDPOINT_FIELDS`, not the spec's path list, so these do not register as drift.

**Breaks if:** a new `stable-image` endpoint ships. The drift check will not notice an
added *path*, only changes to paths we already hold. Extending it to diff the spec's
`/v2beta/stable-image/*` paths against the registry is the obvious next guard; it was
left out of 1.0 to keep the check's failure modes the same as bfl's.

## 2. Send only what the caller set; one registry of fields

`ENDPOINT_FIELDS` (config.ts) lists, per path, the exact text and file parts each
endpoint accepts. Every method builds its request through `StabilityAPI._submit`, which
reads only those fields from the caller's values and skips `undefined`/`null`. Falsy
values that were set (`0`, `false`, `''`) are sent.

0.4.0 filled `aspect_ratio: '1:1'`, `output_format: 'png'`, `model: 'sd3.5-large'` and
creative `creativity: 0.3` client-side. All four equal the server defaults (checked
against the spec on 2026-09-22), so dropping them changes no output.

**Why:** the same as bfl #2. The server's default is correct by definition and can
change without a wrapper release, and a field the wrapper forces is a field that turns
into a 400 when the API renames it. For Stability there was also a concrete failure: SD
3.5 rejects `aspect_ratio` in image-to-image, so a forced `'1:1'` would have made
image-to-image impossible.

**Exception:** `upscaleFast(image, outputFormat = 'png')` keeps its positional default
for signature compatibility. The value equals the server default.

**Why keyed by path:** the three `sd3-*` endpoint keys pointed at one URL (#8), and the
drift check needs one entry per URL.

`test/payloads.test.js` sends every registered field through every public method and
requires the multipart body to carry exactly that set. This closes the gap that let
`style_preset` and `creativity` go unsent: before 1.0 no test inspected a request body.

## 3. The spec is checked, not trusted

`scripts/check-spec-drift.ts` follows bfl #6, adapted to multipart bodies. For each
registered path it compares:
- the field set, including text vs file;
- every spec range and enum against the constraint tables;
- constraints we hold for fields the spec no longer has;
- prompt `maxLength`.

`--control` seeds seven kinds of drift and requires each to be caught, and requires
the unmodified spec to be clean. CI runs it before the tests.

**Where the spec lives:** `https://api.stability.ai/v2alpha/openapi`. It serves the
v2beta spec (`info.version: "v2beta"`) despite the path. It is linked from nowhere.
It was found in the JS bundle of the docs site (`platform.stability.ai/docs/api-reference`
is a client-rendered page), after `api.stability.ai/openapi.json` and
`/v2beta/openapi.json` both returned 404.
`docs/openapi-snapshot-2026-09-22.json` is the offline fallback
(`npm run check:spec:snapshot`).

**Deliberate divergences** go in `KNOWN_DIVERGENCES` with a reason and report as INFO.
An entry that stops matching any difference is itself a FAIL, so the list cannot go
stale. The control exercises exactly that case.

**Breaks if:** Stability moves or removes that URL. CI then fails on the fetch, not
on drift. Switch to the snapshot and go looking. The URL being undocumented is the
most fragile assumption in this package.

## 4. The server's validator is an oracle, and it is free

Stability validates request parameters **before** authentication. A request with a
bad parameter and an invalid key returns `400` with the validator's full error list.
A request with valid parameters and an invalid key returns `401`. Failed requests are
not billed, and an invalid key cannot be billed at all. So "does the server accept
X?" can be answered with zero spend: send X with a dummy key and read whether the
status is 400 or 401. The error text often names the accepted enum outright.

All three "where the spec and server disagree" findings in #5 came from this, on
2026-09-22.

**Breaks if:** Stability moves auth ahead of validation, so every probe returns 401.
When that happens, probes need a real key and a live call, which costs credits.

## 5. Where the spec and the server disagreed

| What | Spec says | Server does (probed 2026-09-22) | Wrapper follows |
|---|---|---|---|
| SD 3.5 `model` enum | 3 values; prose and pricing name `sd3.5-flash` | Validator lists `'sd3.5-large' \| 'sd3.5-large-turbo' \| 'sd3.5-medium' \| 'sd3.5-flash'`; a Flash request passes validation | Server: Flash is accepted (`KNOWN_DIVERGENCES`) |
| erase `required` | lists `prompt`, but erase has no `prompt` property | no prompt → no prompt error | Server: no prompt |
| upscale conservative / creative `prompt` | required | `400 prompt: required` | Spec and server agree. **0.4.0 typed it optional**, so the wrapper was the thing that was wrong |

## 6. SD 3.5 `mode` is derived, not a parameter

`generateSD3` sends `mode=image-to-image` when `image` is set and otherwise sends no
`mode`, so the server's text-to-image default applies. There is no `mode` in
`SD3Params`, and a `mode` passed from JavaScript is overwritten.

**Why:** the API's `mode` is fully determined by whether an image is present. A
separate parameter would add two states that can only be wrong (image-to-image with no
image, text-to-image with one). The drift check records `mode` as derived rather than
requiring a constraint for its enum.

## 7. Image-to-image rules are enforced before the request

`imageToImageErrors` applies to the generate endpoints that take an input image
(Ultra, SD 3.5):
- `image` requires `strength`, because the server requires it;
- `strength` requires `image`, because a strength with nothing to apply it to is
  a mistake;
- on SD 3.5 only, `aspect_ratio` with `image` is an error, because the API accepts
  it only for text-to-image.

`validateModelParams` (used by the CLI) and the API methods both call it, so
programmatic callers get the same message without a round trip.

This also fixes an 0.4.0 bug in both directions. The API sent Ultra's `strength` with
no image. The CLI silently dropped `--strength` when `--image` was missing.

## 8. One `sd3` endpoint key

`MODEL_ENDPOINTS['sd3-large' | 'sd3-medium' | 'sd3-large-turbo']` are replaced by
`MODEL_ENDPOINTS['sd3']`. All three were the same URL; the SD 3.5 variant is the `model`
field. The old names also read as the SD3.0 model IDs Stability retired in April 2025,
and the morning audit that started this work had to stop and establish they were not.
This is a breaking change to an exported constant, which is acceptable at 1.0.

## 9. Native fetch; API requests follow no redirects

The HTTP layer is `src/http.ts`, ported near-verbatim from bfl-api, so bfl #11 applies
in full. fetch provides none of the four things axios did implicitly, so each was
rebuilt: throw on non-2xx, a streaming size cap, manual redirects with per-hop
validation, and typed errors. The one addition is a `form` option for multipart
bodies. Every Stability generation endpoint takes multipart; BFL's are JSON.

**Stability-specific:** requests to the API itself use `maxRedirects: 0`. The API does
not redirect, and refusing to follow keeps the `Authorization` header from being sent
anywhere but `api.stability.ai`. Image downloads do follow redirects, re-validating
each hop (#10).

**(1.0.1)** `request()` itself also drops credential headers (`authorization`,
`proxy-authorization`, `cookie`, `x-key`) on any redirect that changes origin, as fetch's
own redirect mode does for `authorization`. Here that is a backstop — the API calls follow
no redirects and downloads carry no credentials — but bfl-api shares the loop and its
authenticated calls did follow redirects, re-sending the key to any origin (bfl #16). The
strip lives in the shared loop so a future authenticated call site cannot reopen it.

`axios` and `form-data` are gone. Runtime dependencies are `commander`, `dotenv` and
`winston`. Node 22 is required, the same as bfl.

## 10. SSRF: every hop, every address, every embedded form

`validateImageUrl` is shared with bfl-api and had the same three gaps there:

1. **Redirects were followed blind.** A URL that passed validation could 302 to a
   private address or downgrade to http. Every download hop now passes
   `validateImageUrl` (bfl #12).
2. **Only the first DNS answer was checked** (`lookup(host)`). A name with one public
   and one private record passed. Now `lookup(host, { all: true })` checks every
   address, and IPv4-mapped IPv6 answers (`::ffff:10.0.0.1`) are judged by their IPv4.
3. **IPv6 ranges were matched as literals.** `/^fc00:/` and `/^fd00:/` let the rest
   of `fc00::/7` through (`fd12:3456::1`), and `/^fe80:/` missed the rest of
   `fe80::/10`. They are now `/^f[cd][0-9a-f]{2}:/` and `/^fe[89ab][0-9a-f]:/`. Both
   require four hex digits, because `fd1::` is `0x0fd1` and is not unique-local.

Also, `urlToBase64` now validates its own argument. Called directly, it performed no
check at all.

Items 2 and 3 (and 4 and 5 below) were carried to bfl-api in its 2.0.2; the two
packages' `isBlockedIP`, `validateImageUrl` and `createGuardedLookup` are the same code
again, so a fix to one should be carried to the other.

4. **(ship run #2)** Node's URL parser rewrites `https://[::ffff:127.0.0.1]` to
   `[::ffff:7f00:1]`, and only the dotted mapped form was recognised, so the hex
   form of loopback passed both checks. IPv6 addresses are now expanded and any
   embedded IPv4 — mapped, translated, NAT64 (`64:ff9b::/96`), IPv4-compatible —
   is judged as that IPv4. 100.64/10, 198.18/15, 192.0.0/24, 224/3 and ff00::/8
   were added to the blocklist.

5. **(1.0.1) DNS rebinding.** Validation resolved the name, then fetch resolved it
   again to connect, leaving a time-of-check/time-of-use window: a name answering
   public, then private (low TTL, attacker-run DNS) passed the check and connected
   inward. Downloads now go through an undici `Agent` whose `connect.lookup`
   (`createGuardedLookup`) resolves every address and refuses if any is blocked; the
   addresses checked are the addresses the socket gets, so there is no second
   resolution to race. `validateImageUrl` still runs first: undici connects to IP
   literals without a lookup, and the early check gives the readable refusal. API
   calls to `api.stability.ai` keep the default dispatcher — a fixed host with no
   redirects has no rebinding surface worth a second pool. The dependency this needs
   is pinned to major 7 (#23).
6. **(1.0.1, pre-release security review)** The tunnel forms. 6to4 (`2002::/16`)
   carries an IPv4 in hextets 1-2 and Teredo (`2001::/32`) carries the client IPv4
   bit-inverted in the last 32 bits; a relay delivers either to that IPv4, so both
   are now judged by it like the mapped forms. Blocking the two prefixes outright
   was the alternative; judging by the embedded address keeps one rule for every
   IPv4-carrying form. Deprecated site-local `fec0::/10` is blocked (RFC 3879
   retired it, but a host can still be configured to route it). The re-review added
   ISATAP (interface identifier `0:5efe` / `200:5efe` under any prefix, IPv4 in the
   last 32 bits) under the same rule.

## 11. Retry on type, only while polling

`isTransientError` classifies on type and fields, never message text, following
bfl #13. Transient means:
- HTTP 429, 502, 503 or 504;
- a `StabilityNetworkError` whose undici code is retryable;
- a `StabilityTimeoutError`.

0.4.0's matcher never fired. `'rate limit'` was compared against the message
`'Rate limit exceeded…'` (capital R), and `'502'`/`'503'` against axios's development
message, which production sanitising replaced. `MAX_RETRIES` was declared and never
read.

Retries happen only inside `waitForResult`: `maxRetries` consecutive failures
(default 3), a budget that resets after any successful poll, and a wait that
starts at `pollInterval`, doubles with each consecutive failure (ship run #3),
is never shorter than `Retry-After`, and never runs past the overall timeout.

**Submissions are never retried.** A generate/edit/control/upscale call is a paid
operation, and a timeout or a 502 does not prove the server did no work, so an
automatic retry risks billing twice. Callers who want that trade can make it
themselves.

The README had described exponential backoff, a `maxRetries` option and no retry on
429 since 0.2. None of that matched the code. The section now describes 1.0, and
`maxRetries` exists.

## 12. Typed errors, sanitised messages

A non-2xx response throws `StabilityHttpError` with `status`, `retryAfter` and the
parsed `body`. The messages for 400/401/403/413/429 are unchanged from 0.4.0, so
existing `error.message.includes(...)` checks keep working. With
`NODE_ENV=production`, unmapped statuses keep the generic message, and the detail
moves to `.body` rather than being lost.

## 13. The unit suite never touches the network

`test/setup.js` replaces `fetch` with a guard that rejects any non-local host. It
records each violation and fails the test in `afterEach`, so a test's own try/catch
cannot swallow it.

**Why:** found during 1.0, six tests were sending real requests to `api.stability.ai`.
They relied on a nonexistent input file to fail. A sibling suite's `buildFormData` spy
leaked into them, so no file was read, and their
`catch (e) { expect(e.message).not.toContain(...) }` shape passed on whatever the live
server said. This was harmless in effect, since the keys were fake and the server
validates first (#4), but it was invisible until the fetch migration made the
responses show up in the logs. The guard caught exactly those six. `test/http.test.ts`
uses a local server, which the guard allows.

## 14. Releases are manual; the version is 1.0.0

This follows bfl #10. semantic-release is removed, CI verifies and does not publish,
`version` is bumped by hand, `CHANGELOG.md` is hand-written, and `npm publish` runs from
a checkout that passed `npm run verify`. semantic-release was removed in the **first**
commit on `release/1.0`. Before that, any push to `master` would have auto-published a
stray 0.x.

`1.0.0` was checked against npm's tombstones before being chosen (bfl #14). The
packument `time` map and `versions` map had no set difference on 2026-09-22.

## 15. Line endings are LF

Seven files were CRLF in an otherwise-LF repo with no `.gitattributes`. The first
rewrite of `api.ts` produced a whole-file diff. The fix is a `.gitattributes`
(`* text=auto eol=lf`) and a separate renormalisation commit, the same as bfl
`e0c80c7`. Note that `git add --renormalize` updates the index but **not the working
tree**. The unchanged files stayed CRLF on disk, and `dist/` kept CRLF, until they
were checked out again.

## 16. Response shapes are checked, not cast

`_makeFormDataRequest` can return an image, a task handle, or other JSON, and
the 0.4.0 methods cast whichever arrived to the type they promised:
`as ImageResult` on 15 synchronous methods, `as unknown as TaskResult` on a 202.
Now `isImageResult` / `isTaskResult` are runtime guards, `_submitImage` and
`_submitTask` narrow with them, and a 2xx of the wrong shape throws
`StabilityResponseError` carrying the body. No public method in `api.ts` or
`cli.ts` contains a type assertion on response data.

**Why:** found by the ship pipeline's type-safety gate (run #1, 2026-09-22).
For an SDK, return types are the contract, and a cast lets the contract lie:
`result.image` was `undefined` behind a `Buffer` type if the server ever answered
an image endpoint with JSON. `waitForResult` already narrowed correctly; the
other paths now match it.

**Breaks if:** Stability starts returning images as JSON (base64) under
`accept: image/*`. That would now throw loudly instead of silently yielding an
empty result — the intended failure.

## 17. The constructor takes the key three ways

Positional (`new StabilityAPI(key, baseUrl, logLevel)`, the 0.4.0 form), an
options object (`StabilityApiOptions`), or nothing (falls back to
`STABILITY_API_KEY`). A missing key is still reported on the first request, not
at construction, so building a client in code that never calls it stays cheap.

**Why:** the README has shown `new StabilityAPI()` and
`new StabilityAPI({ apiKey })` since 0.2, and `StabilityApiOptions` was exported,
but the constructor took only a positional string: the first form failed on the
first request, the second stored `"[object Object]"` as the key. Making the code
match nine README examples and an exported type was cheaper and friendlier than
rewriting the examples to the positional form.

## 18. CLI mapping lives in `cli-helpers.ts`

`cli.ts` parses `process.argv` on import, so nothing in it could be tested. The
option→parameter builders and `saveImageResult` moved to `src/cli-helpers.ts`,
typed with the SDK's own parameter types (removing the
`params as unknown as Parameters<...>` casts), and are unit-tested. That test is
how the webp corruption in `writeToFile` (CHANGELOG, Fixed) was found. `cli.ts`
itself (argument parsing, spinners, exit codes) stays excluded from coverage.

## 19. The library has no host-process side effects; the CLI does

Importing the package reads no files and writes nothing to stdout by default:
- `.env` loading moved from `config.ts` import time to `loadEnvFiles()`, which the
  CLI calls at startup and a library user may call explicitly;
- the shared logger defaults to `warn` (the CLI sets `info`);
- `waitForResult`'s spinner defaults off (the CLI passes `showSpinner: true`).

**Why:** found by the ship pipeline's anxiety-reader (run #2). A server importing
the SDK silently loaded the working directory's `.env` and `~/.stability/.env`,
and `new StabilityAPI()` then fell back to that key — it could bill a key a
developer left in their home directory. Info lines include prompts, and the async
path forced an 80 ms ANSI spinner onto the host's stdout for up to 5 minutes.
Alex chose CLI-only side effects over documenting them (2026-09-22).

**Breaks if:** a library user relied on the implicit `.env` loading — the fix is
one `loadEnvFiles()` call, recorded in the CHANGELOG as breaking.

## 20. A content-filtered result is a success with a warning, not an error

Stability answers a filtered request with 200, a blurred image, and
`finish-reason: CONTENT_FILTERED` — and bills it. The library returns it like any
image (the caller checks `result.finish_reason`); the CLI saves it, warns, and
exits with code 3 so batch scripts can tell "done" from "done but blurred".

**Why:** the ship pipeline's anxiety-reader (F1). Throwing from the SDK would
turn a paid 200 into an exception for every consumer; exiting 0 with a ✓ hid it
from scripts. Alex chose the CLI exit code (2026-09-22).

## 21. Known gaps recorded rather than fixed in 1.0

- **The drift check covers requests, not responses.** Content types, the
  `finish-reason`/`seed` headers, the 202 `{ id }` body and the results endpoint's
  bytes have no guard; a change there shows up at runtime, after billing. The
  response-shape guards (#16) make it loud rather than silent.
- **402 semantics** are mapped by HTTP convention; not confirmed that Stability uses
  402 for an empty balance.
- **The final poll can get a tiny budget.** If the last sleep ends just before the
  timeout, the last poll has milliseconds and reports `StabilityTaskTimeoutError`
  even if the image finished in that window; `sai result <taskId>` recovers it.

## 22. Task ids are validated before they are put in a URL

`waitForResult`, `getResult` and `sai result` take an id that goes into
`/v2beta/results/{id}` on an authenticated request. It must be one
`[A-Za-z0-9_-]{1,128}` segment. **Why:** found by the ship pipeline's code-auditor
(run #3): `sai result ../../v1/user/balance` was normalised by the URL parser to a
different endpoint, carrying the API key. Stability's ids are 64-character hex
(`GenerationID` in the spec); the check is looser than that on purpose, so a
change in id length does not break resume, while still refusing `.`, `/` and `%`.

## 23. `undici` is a dependency, pinned to major 7

The rebinding guard (#10) needs an undici `Agent` passed to fetch as its
`dispatcher`, and Node does not expose the undici it bundles, so `undici` is an
explicit dependency. It stays on **major 7** (`^7`), for a measured reason: on both
Node 22.23 (bundled undici 6.28) and Node 24.14 (bundled 7.24), global `fetch`
rejects an undici **8** `Agent` with `UND_ERR_INVALID_ARG` on every request — the
happy path included — while an undici 7 `Agent` works on both (checked 2026-09-22).
A bump to 8 would therefore break every image download, not just the guard.

Global `fetch` is kept rather than switching the download path to undici's own
`fetch`: the unit suite's network guard and fetch stubs intercept the global, and
moving downloads off it would silently exempt them from both.

Types are the other seam. `@types/node` types `fetch` against its own copy of
undici's declarations (`undici-types`), whose version follows `@types/node`, not
the undici we install; the two `Dispatcher` declarations differ structurally. The
option is widened at the one place they meet (`request()` in `src/http.ts`) rather
than by pinning undici to whatever `undici-types` happens to be.

**Guarded by** the `dispatcher: connect-time SSRF guard` suite in
`test/http.test.ts`, which drives real global fetch with the real `Agent` against a
local server: with undici 8 installed all four of its tests fail (checked). Revisit
when Node's bundled undici reaches 8 — then a bump becomes possible, and this test
says whether it works.
