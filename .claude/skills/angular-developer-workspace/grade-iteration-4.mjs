import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ITER = join(__dirname, 'iteration-4');

const ASSERTIONS = {
  'version-19-fetch': [
    // Should NOT use resource() from @angular/core (unavailable in v19)
    { name: 'no_core_resource', antiPattern: /import\s*\{[^}]*\bresource\b[^}]*\}\s*from\s*['"]@angular\/core['"]/, desc: 'Does not import resource from @angular/core (unavailable in v19)' },
    // Should use httpResource OR rxResource OR HttpClient+toSignal (all valid for v19)
    { name: 'uses_valid_v19_fetching', pattern: /httpResource|rxResource|toSignal|HttpClient/, desc: 'Uses v19-compatible fetching (httpResource/rxResource/HttpClient+toSignal)' },
    // If using rxResource, should use request/loader (v19 API), NOT params/stream
    { name: 'rxResource_v19_api_if_used', pattern: /rxResource[\s\S]*?(request|loader)|httpResource|toSignal.*HttpClient|HttpClient[\s\S]*toSignal/s, desc: 'If rxResource used, uses v19 API (request/loader) or uses other approach' },
    // Should handle loading state
    { name: 'handles_loading', pattern: /loading|isLoading|Loading/i, desc: 'Handles loading state' },
    // Should handle error state
    { name: 'handles_error', pattern: /error|Error|catchError/, desc: 'Handles error state' },
  ],
  'version-upgrade-19-to-21': [
    // Must rename request -> params
    { name: 'renames_request_to_params', pattern: /params\s*:?\s*\(\)/, desc: 'Renames request to params' },
    // Must rename loader -> stream
    { name: 'renames_loader_to_stream', pattern: /stream\s*:/, desc: 'Renames loader to stream' },
    // Should NOT still have request: in rxResource options
    { name: 'no_old_request', antiPattern: /rxResource\s*\(\s*\{[\s\S]*?\brequest\s*:/, desc: 'Does not use old request property' },
    // Should NOT still have loader: in rxResource options (loader is for resource(), not rxResource in v20+)
    { name: 'no_old_loader', antiPattern: /rxResource\s*\(\s*\{[\s\S]*?\bloader\s*:/, desc: 'Does not use old loader property in rxResource' },
  ],
  'version-21-choice': [
    // Should use httpResource for simple GET (stats)
    { name: 'uses_httpResource', pattern: /httpResource/, desc: 'Uses httpResource for HTTP fetching' },
    // Should handle WebSocket separately (not via resource)
    { name: 'handles_websocket', pattern: /webSocket|WebSocket|ws:\/\//, desc: 'Handles WebSocket separately' },
    // Should use OnPush
    { name: 'uses_onpush', pattern: /ChangeDetectionStrategy\.OnPush/, desc: 'OnPush change detection' },
    // Should NOT use resource() from @angular/core for HTTP (httpResource is better for that)
    // This is a softer check -- resource() is valid but httpResource is preferred per the skill
    { name: 'prefers_httpResource_over_resource', pattern: /httpResource/, desc: 'Prefers httpResource for HTTP endpoints' },
    // Comments explain the choice
    { name: 'explains_choices', pattern: /\/\/.*(?:httpResource|rxResource|resource|WebSocket|HttpClient)/s, desc: 'Comments explain API choice' },
  ],
  'multifile-performance': [
    { name: 'uses_defer', pattern: /@defer/, desc: '@defer lazy loading' },
    { name: 'uses_ng_optimized_image', pattern: /ngSrc|NgOptimizedImage/, desc: 'NgOptimizedImage' },
    { name: 'uses_onpush', pattern: /ChangeDetectionStrategy\.OnPush/, desc: 'OnPush' },
    { name: 'uses_virtual_scroll_or_pagination', pattern: /virtual|cdk-virtual|pagination|paginate|pageSize|slice\(/i, desc: 'Virtual scroll or pagination' },
    { name: 'uses_track', pattern: /track\s+\S+/, desc: 'track expression in @for' },
    { name: 'multiple_files', pattern: /.*/, desc: 'Produces output files', custom: (dir) => {
      const files = readdirSync(dir).filter(f => f.endsWith('.ts'));
      return files.length >= 2;
    }},
  ],
};

const RUNS = ['', '_r2', '_r3'];
const CONFIGS = ['with_skill', 'without_skill'];

function comb(n, k) {
  if (k > n) return 0;
  if (k === 0 || k === n) return 1;
  let r = 1;
  for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
  return r;
}
function passAtK(n, c, k) { return k > n ? NaN : 1 - comb(n - c, k) / comb(n, k); }
function passHatK(n, c, k) { return k > n ? NaN : comb(c, k) / comb(n, k); }

console.log('=== ITERATION 4: VERSION-SPECIFIC + MULTI-FILE EVALS ===\n');

let totalWith = { n: 0, c: 0 }, totalWithout = { n: 0, c: 0 };

for (const [evalName, assertions] of Object.entries(ASSERTIONS)) {
  console.log(`--- ${evalName} ---`);

  for (const config of CONFIGS) {
    const runResults = [];

    for (const run of RUNS) {
      const dir = join(ITER, evalName, `${config}${run}`, 'outputs');

      if (!existsSync(dir)) { runResults.push({ error: 'no dir', run }); continue; }

      const files = readdirSync(dir).filter(f => f.endsWith('.ts'));

      if (!files.length) { runResults.push({ error: 'no files', run }); continue; }

      const content = files.map(f => readFileSync(join(dir, f), 'utf-8')).join('\n');
      let passed = 0;
      const total = assertions.length;
      const details = {};

      for (const a of assertions) {
        let ok;

        if (a.custom) {
          ok = a.custom(dir);
        } else if (a.antiPattern) {
          ok = !a.antiPattern.test(content);
        } else {
          ok = a.pattern.test(content);
        }

        if (ok) passed++;
        details[a.name] = ok;
      }

      runResults.push({ run: run || 'r1', passed, total, allPassed: passed === total, details });
    }

    const validRuns = runResults.filter(r => !r.error);
    const n = validRuns.length;
    const c = validRuns.filter(r => r.allPassed).length;

    if (config === 'with_skill') { totalWith.n += n; totalWith.c += c; }
    else { totalWithout.n += n; totalWithout.c += c; }

    console.log(`  ${config}: ${validRuns.map(r => `${r.passed}/${r.total}`).join(', ')} | fully_correct=${c}/${n}`);

    for (const r of validRuns) {
      for (const [name, ok] of Object.entries(r.details)) {
        if (!ok) console.log(`    [FAIL] ${r.run}/${name}`);
      }
    }
  }

  console.log('');
}

console.log('=== OVERALL PASS@K / PASS^K ===\n');
console.log('| Config | n | c | Pass@1 | Pass@3 | Pass^1 | Pass^3 |');
console.log('|--------|---|---|--------|--------|--------|--------|');

for (const [label, t] of [['with_skill', totalWith], ['without_skill', totalWithout]]) {
  console.log(`| ${label} | ${t.n} | ${t.c} | ${passAtK(t.n, t.c, 1).toFixed(2)} | ${passAtK(t.n, t.c, 3).toFixed(2)} | ${passHatK(t.n, t.c, 1).toFixed(2)} | ${passHatK(t.n, t.c, 3).toFixed(2)} |`);
}

// Per-assertion differentiators
console.log('\n=== DIFFERENTIATING ASSERTIONS ===\n');

for (const [evalName, assertions_list] of Object.entries(ASSERTIONS)) {
  for (const a of assertions_list) {
    if (a.custom) continue;

    let wp = 0, wt = 0, bp = 0, bt = 0;

    for (const config of CONFIGS) {
      for (const run of RUNS) {
        const dir = join(ITER, evalName, `${config}${run}`, 'outputs');

        if (!existsSync(dir)) continue;

        const files = readdirSync(dir).filter(f => f.endsWith('.ts'));

        if (!files.length) continue;

        const content = files.map(f => readFileSync(join(dir, f), 'utf-8')).join('\n');
        const ok = a.antiPattern ? !a.antiPattern.test(content) : a.pattern.test(content);

        if (config === 'with_skill') { wt++; if (ok) wp++; }
        else { bt++; if (ok) bp++; }
      }
    }

    if (wt === 0 || bt === 0) continue;

    const wr = wp / wt, br = bp / bt;

    if (Math.abs(wr - br) > 0.01) {
      const flag = wr > br ? 'SKILL+' : 'BASE+';
      console.log(`${evalName}/${a.name}: with=${(wr * 100).toFixed(0)}% without=${(br * 100).toFixed(0)}% [${flag}]`);
    }
  }
}
