#!/usr/bin/env tsx
/**
 * check-spec-drift — compare this wrapper against Stability's live OpenAPI spec.
 *
 * For every endpoint in ENDPOINT_FIELDS it checks, against the spec:
 *
 *   1. the path still exists, takes POST, and takes multipart/form-data;
 *   2. the request schema's property set equals ENDPOINT_FIELDS[path] exactly,
 *      with binary properties under `files` and the rest under `text` — a field
 *      the API added is a FAIL (the wrapper cannot send it), and a field the API
 *      dropped is a FAIL (the wrapper would send a key the server no longer
 *      declares);
 *   3. every numeric range / enum the spec states has a matching constraint
 *      (MODEL_ / EDIT_ / CONTROL_CONSTRAINTS) with the same bounds, and every
 *      constraint we hold names a field the spec still has;
 *   4. a prompt `maxLength` the spec states equals our `promptMaxLength`.
 *
 * Where the wrapper deliberately differs from the spec, KNOWN_DIVERGENCES
 * records why and the finding is INFO, not FAIL. Where the wrapper is stricter
 * than a spec that states nothing, it is INFO.
 *
 * Ported from bfl-api/scripts/check-spec-drift.ts (its DECISIONS #6). The
 * differences are Stability's: request bodies are multipart, not JSON; the
 * field registry is keyed by path; and the spec lives at an undocumented URL
 * found in the docs site's bundle (see docs/DECISIONS.md).
 *
 * Usage:
 *   npx tsx scripts/check-spec-drift.ts               # fetch live spec
 *   npx tsx scripts/check-spec-drift.ts --snapshot docs/openapi-snapshot-2026-09-22.json
 *   npx tsx scripts/check-spec-drift.ts --save docs/openapi-snapshot-<date>.json
 *   npx tsx scripts/check-spec-drift.ts --control     # prove the check can fail
 *
 * Exit 1 on any FAIL. `--control` exits 0 only if every seeded drift is caught
 * and the unmodified spec is clean.
 */

import { readFileSync, writeFileSync } from 'fs';
import {
  ENDPOINT_FIELDS,
  MODEL_ENDPOINTS,
  EDIT_ENDPOINTS,
  CONTROL_ENDPOINTS,
  MODEL_CONSTRAINTS,
  EDIT_CONSTRAINTS,
  CONTROL_CONSTRAINTS,
} from '../src/config.js';

/**
 * Served as the v2beta REST spec (`info.version: "v2beta"`) despite the path.
 * Not linked from the docs; the docs site's JS bundle fetches it.
 */
const SPEC_URL = 'https://api.stability.ai/v2alpha/openapi';

type Json = Record<string, unknown>;
interface Prop {
  type?: string;
  format?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  default?: unknown;
}
interface Range { min: number; max: number }
type Constraint = Record<string, unknown>;

/**
 * Deliberate differences from the spec, keyed `path field`. Each needs a reason;
 * the finding it covers is reported as INFO. An entry that no longer matches a
 * difference is itself a FAIL, so this list cannot go stale silently.
 */
const KNOWN_DIVERGENCES: Record<string, { extraEnum?: unknown[]; reason: string }> = {
  '/v2beta/stable-image/generate/sd3 model': {
    extraEnum: ['sd3.5-flash'],
    reason:
      'published enum omits sd3.5-flash; the server validator lists and accepts it ' +
      '(probed 2026-09-22) and the spec prose/pricing name it',
  },
};

/**
 * Spec fields the wrapper sets itself rather than taking a caller constraint.
 */
const DERIVED_FIELDS: Record<string, Record<string, string>> = {
  '/v2beta/stable-image/generate/sd3': { mode: 'derived from `image` by generateSD3' },
};

/** Constraint keys that are not named after the API field they constrain. */
const RENAMED_CONSTRAINTS: Record<string, string> = {
  output_format: 'outputFormats',
  aspect_ratio: 'aspectRatios',
  style_preset: 'stylePresets',
  model: 'models',
  light_source_direction: 'light_source_directions',
};

/** Constraint keys that describe something other than one API field. */
const NON_FIELD_CONSTRAINT_KEYS = new Set([
  'promptMaxLength', // checked against prompt/negative_prompt maxLength
  'pixels', // input-image size rule; the spec states it only in prose
  'requiresAspectRatio',
  'async',
  'imageToImageForbidsAspectRatio',
  'direction', // outpaint: one range for left/right/up/down
]);

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const control = args.includes('--control');
const snapshotPath = flag('--snapshot');
const savePath = flag('--save');

async function loadSpec(): Promise<Json> {
  if (snapshotPath) {
    return JSON.parse(readFileSync(snapshotPath, 'utf8')) as Json;
  }
  const res = await fetch(SPEC_URL);
  if (!res.ok) throw new Error(`GET ${SPEC_URL} → ${res.status}`);
  const spec = (await res.json()) as Json;
  if (savePath) {
    writeFileSync(savePath, JSON.stringify(spec, null, 2) + '\n');
    console.log(`saved spec to ${savePath}`);
  }
  return spec;
}

/** Resolve a local JSON-pointer `$ref` (repeatedly). */
function deref(spec: Json, node: Json): Json {
  let current = node;
  while (typeof current.$ref === 'string') {
    let target: unknown = spec;
    for (const part of (current.$ref as string).replace(/^#\//, '').split('/')) {
      target = (target as Json)[part];
    }
    current = target as Json;
  }
  return current;
}

/** The path's multipart request schema, dereferenced — mutable in place for the control. */
function requestSchema(spec: Json, path: string): Json {
  const op = ((spec.paths as Json)[path] as Json | undefined)?.post as Json | undefined;
  if (!op) throw new Error(`no POST ${path}`);
  const content = (op.requestBody as Json | undefined)?.content as Json | undefined;
  const multipart = content?.['multipart/form-data'] as Json | undefined;
  if (!multipart) {
    throw new Error(`POST ${path} no longer takes multipart/form-data (has: ${Object.keys(content ?? {}).join(', ') || 'none'})`);
  }
  return deref(spec, multipart.schema as Json);
}

function requestProps(spec: Json, path: string): { props: Record<string, Prop>; required: string[] } {
  const schema = requestSchema(spec, path);
  const props: Record<string, Prop> = {};
  for (const [name, raw] of Object.entries((schema.properties ?? {}) as Record<string, Json>)) {
    props[name] = deref(spec, raw) as Prop;
  }
  return { props, required: (schema.required ?? []) as string[] };
}

/** Which constraint table and key govern a path. */
function constraintsFor(path: string): { label: string; c: Constraint | undefined } {
  const find = (endpoints: Record<string, string>, table: Record<string, unknown>, prefix: string) => {
    const key = Object.keys(endpoints).find((k) => endpoints[k] === path);
    return key ? { label: `${prefix}.${key}`, c: table[key] as Constraint | undefined } : null;
  };
  return (
    find(MODEL_ENDPOINTS as Record<string, string>, MODEL_CONSTRAINTS, 'MODEL_CONSTRAINTS') ??
    find(EDIT_ENDPOINTS as Record<string, string>, EDIT_CONSTRAINTS, 'EDIT_CONSTRAINTS') ??
    find(CONTROL_ENDPOINTS as Record<string, string>, CONTROL_CONSTRAINTS, 'CONTROL_CONSTRAINTS') ?? {
      label: '(no endpoint key)',
      c: undefined,
    }
  );
}

/** Our constraint for one API field, as a range or an enum. */
function ourConstraint(c: Constraint | undefined, field: string): { range?: Range; enum?: readonly unknown[] } | null {
  if (!c) return null;
  if (['left', 'right', 'up', 'down'].includes(field) && c.direction) {
    return { range: c.direction as Range };
  }
  const v = c[RENAMED_CONSTRAINTS[field] ?? field];
  if (v === undefined) return null;
  if (Array.isArray(v)) return { enum: v };
  return { range: v as Range };
}

interface Finding {
  level: 'FAIL' | 'INFO';
  path: string;
  message: string;
}

function describe(p: Prop): string {
  const bits: string[] = [];
  if (p.minimum !== undefined) bits.push(`min ${p.minimum}`);
  if (p.maximum !== undefined) bits.push(`max ${p.maximum}`);
  if (p.enum) bits.push(`enum ${JSON.stringify(p.enum)}`);
  return bits.join(', ');
}

function check(spec: Json): Finding[] {
  const findings: Finding[] = [];
  const usedDivergences = new Set<string>();

  for (const [path, fields] of Object.entries(ENDPOINT_FIELDS)) {
    const fail = (message: string) => findings.push({ level: 'FAIL', path, message });
    const info = (message: string) => findings.push({ level: 'INFO', path, message });

    let props: Record<string, Prop>;
    let required: string[];
    try {
      ({ props, required } = requestProps(spec, path));
    } catch (e) {
      fail(`endpoint missing or changed: ${(e as Error).message}`);
      continue;
    }

    // 2. field set equality, with part kind
    const isFile = (p: Prop) => p.format === 'binary';
    const ourText = new Set(fields.text);
    const ourFiles = new Set(fields.files);
    for (const [name, p] of Object.entries(props)) {
      if (ourText.has(name)) {
        if (isFile(p)) fail(`"${name}" is a file in the spec but ENDPOINT_FIELDS lists it under text`);
        continue;
      }
      if (ourFiles.has(name)) {
        if (!isFile(p)) fail(`"${name}" is text in the spec but ENDPOINT_FIELDS lists it under files`);
        continue;
      }
      const shape = isFile(p) ? 'file' : p.enum ? `enum ${JSON.stringify(p.enum)}` : p.type ?? '?';
      fail(`API added field "${name}" (${shape}) that the wrapper does not send`);
    }
    for (const name of [...ourText, ...ourFiles]) {
      if (!props[name]) fail(`wrapper sends "${name}" but the API no longer declares it`);
    }
    for (const name of required) {
      if (!props[name]) info(`spec lists "${name}" as required but declares no such property (spec error)`);
    }

    // 3. ranges / enums
    const { label, c } = constraintsFor(path);
    for (const [field, p] of Object.entries(props)) {
      const hasRange = p.minimum !== undefined || p.maximum !== undefined;
      const hasEnum = Array.isArray(p.enum) && p.enum.length > 0;
      if (!hasRange && !hasEnum) continue;
      if (DERIVED_FIELDS[path]?.[field]) {
        info(`"${field}" (${describe(p)}) not constrained: ${DERIVED_FIELDS[path][field]}`);
        continue;
      }

      const mine = ourConstraint(c, field);
      if (!mine) {
        fail(`spec constrains "${field}" (${describe(p)}) but ${label} has no entry`);
        continue;
      }
      if (hasRange) {
        if (!mine.range) {
          fail(`spec gives "${field}" a numeric range (${describe(p)}) but ours is an enum`);
        } else {
          if (p.minimum !== undefined && p.minimum !== mine.range.min)
            fail(`"${field}" minimum: spec ${p.minimum}, ours ${mine.range.min}`);
          if (p.maximum !== undefined && p.maximum !== mine.range.max)
            fail(`"${field}" maximum: spec ${p.maximum}, ours ${mine.range.max}`);
          if (p.minimum === undefined) info(`"${field}": spec states no minimum; wrapper enforces ${mine.range.min}`);
          if (p.maximum === undefined) info(`"${field}": spec states no maximum; wrapper enforces ${mine.range.max}`);
        }
      }
      if (hasEnum) {
        if (!mine.enum) {
          fail(`spec gives "${field}" an enum ${JSON.stringify(p.enum)} but ours is a range`);
        } else {
          const specSet = new Set(p.enum!.map(String));
          const ourSet = new Set(mine.enum.map(String));
          const missing = [...specSet].filter((v) => !ourSet.has(v));
          const extra = [...ourSet].filter((v) => !specSet.has(v));
          if (missing.length) fail(`"${field}" enum: spec has ${JSON.stringify(missing)} that ours lacks`);
          if (extra.length) {
            // Split: values an allowlist entry explains are INFO; the rest FAIL
            // on their own, so a known divergence cannot mask a new one.
            const key = `${path} ${field}`;
            const known = KNOWN_DIVERGENCES[key];
            const allowed = new Set((known?.extraEnum ?? []).map(String));
            const covered = extra.filter((v) => allowed.has(v));
            const uncovered = extra.filter((v) => !allowed.has(v));
            if (covered.length) {
              usedDivergences.add(key);
              info(`"${field}" enum: ours adds ${JSON.stringify(covered)} — ${known!.reason}`);
            }
            if (uncovered.length) fail(`"${field}" enum: ours has ${JSON.stringify(uncovered)} the spec lacks`);
          }
        }
      }
    }

    // Constraints we hold for fields the spec no longer has, or states nothing about
    for (const key of Object.keys(c ?? {})) {
      if (NON_FIELD_CONSTRAINT_KEYS.has(key)) continue;
      const field = Object.keys(RENAMED_CONSTRAINTS).find((f) => RENAMED_CONSTRAINTS[f] === key) ?? key;
      const p = props[field];
      if (!p) {
        fail(`${label}.${key} set but the spec has no "${field}" field`);
      } else if (!p.enum && p.minimum === undefined && p.maximum === undefined) {
        info(`"${field}": wrapper constrains it (${label}.${key}); spec states nothing`);
      }
    }
    if (c?.direction) {
      for (const f of ['left', 'right', 'up', 'down']) {
        if (!props[f]) fail(`${label}.direction set but the spec has no "${f}" field`);
      }
    }

    // 4. prompt length
    const maxLen = c?.promptMaxLength as number | undefined;
    for (const f of ['prompt', 'negative_prompt']) {
      const p = props[f];
      if (!p?.maxLength) continue;
      if (maxLen === undefined) fail(`spec caps "${f}" at ${p.maxLength} characters but ${label} has no promptMaxLength`);
      else if (p.maxLength !== maxLen) fail(`"${f}" maxLength: spec ${p.maxLength}, ours ${maxLen}`);
    }
  }

  for (const key of Object.keys(KNOWN_DIVERGENCES)) {
    if (!usedDivergences.has(key)) {
      const [path] = key.split(' ');
      findings.push({ level: 'FAIL', path, message: `KNOWN_DIVERGENCES["${key}"] no longer matches any difference — remove it` });
    }
  }
  return findings;
}

/**
 * Seed drift into a copy of the spec, through the same lookup the check uses
 * (so it does not depend on Stability's schema names), and require each to be
 * caught. Then require the unmodified spec to be clean.
 */
function runControl(spec: Json): number {
  const clone = JSON.parse(JSON.stringify(spec)) as Json;
  const propsOf = (path: string) => requestSchema(clone, path).properties as Json;

  // (a) range change
  (propsOf('/v2beta/stable-image/edit/erase').grow_mask as Json).maximum = 30;
  // (b) added text field
  propsOf('/v2beta/stable-image/edit/inpaint').feather = { type: 'integer' };
  // (c) added file field
  propsOf('/v2beta/stable-image/edit/outpaint').mask = { type: 'string', format: 'binary' };
  // (d) removed field
  delete propsOf('/v2beta/stable-image/generate/core').style_preset;
  // (e) enum loses a value we accept
  const model = deref(clone, propsOf('/v2beta/stable-image/generate/sd3').model as Json);
  model.enum = (model.enum as string[]).filter((m) => m !== 'sd3.5-medium');
  // (f) endpoint removed
  delete (clone.paths as Json)['/v2beta/stable-image/upscale/fast'];
  // (g) the known Flash divergence resolves upstream — the allowlist entry must then fail as stale
  const clone2 = JSON.parse(JSON.stringify(spec)) as Json;
  const model2 = deref(clone2, (requestSchema(clone2, '/v2beta/stable-image/generate/sd3').properties as Json).model as Json);
  model2.enum = [...(model2.enum as string[]), 'sd3.5-flash'];

  const findings = [...check(clone), ...check(clone2)].filter((f) => f.level === 'FAIL');
  const expect = [
    /edit\/erase .*"grow_mask" maximum: spec 30, ours 20/,
    /edit\/inpaint .*API added field "feather"/,
    /edit\/outpaint .*API added field "mask" \(file\)/,
    /generate\/core .*wrapper sends "style_preset" but the API no longer declares it/,
    /generate\/sd3 .*"model" enum: ours has \["sd3.5-medium"\] the spec lacks/,
    /upscale\/fast .*endpoint missing or changed/,
    /generate\/sd3 .*KNOWN_DIVERGENCES.*no longer matches/,
  ];
  let ok = true;
  for (const re of expect) {
    const hit = findings.some((f) => re.test(`${f.path} ${f.message}`));
    console.log(`${hit ? 'caught ' : 'MISSED '} ${re}`);
    if (!hit) ok = false;
  }
  const baseline = check(spec).filter((f) => f.level === 'FAIL');
  console.log(`baseline FAIL count: ${baseline.length} (must be 0 for control to be meaningful)`);
  if (baseline.length) {
    ok = false;
    for (const f of baseline) console.log(`  ${f.path}: ${f.message}`);
  }
  console.log(ok ? '\ncontrol OK — the check can fail and passes on the real spec' : '\ncontrol FAILED');
  return ok ? 0 : 1;
}

const spec = await loadSpec();
if (control) {
  process.exit(runControl(spec));
}

const findings = check(spec);
const fails = findings.filter((f) => f.level === 'FAIL');
const infos = findings.filter((f) => f.level === 'INFO');
for (const f of infos) console.log(`INFO  ${f.path}: ${f.message}`);
for (const f of fails) console.log(`FAIL  ${f.path}: ${f.message}`);
console.log(
  `\n${Object.keys(ENDPOINT_FIELDS).length} endpoints checked against ${snapshotPath ?? SPEC_URL}: ${fails.length} FAIL, ${infos.length} INFO`
);
process.exit(fails.length ? 1 : 0);
