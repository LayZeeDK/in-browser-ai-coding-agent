import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ITER = join(__dirname, 'iteration-2');
const META_RAW = JSON.parse(readFileSync(join(ITER, 'eval_metadata_all.json'), 'utf-8'));

// Corrected assertions (same as grade-iteration-2-corrected.mjs)
const ASSERTIONS = {
  'real-component-refactor': [
    { name: 'removes_standalone_true', antiPattern: /standalone:\s*true/, desc: 'No standalone:true' },
    { name: 'uses_onpush', pattern: /ChangeDetectionStrategy\.OnPush/, desc: 'OnPush' },
    { name: 'uses_native_control_flow', pattern: /@if\s*\(|@for\s*\(/, desc: '@if/@for' },
    { name: 'uses_input_function', pattern: /\binput[<(]|input\.required/, desc: 'input()' },
    { name: 'uses_inject', pattern: /inject\(/, desc: 'inject()' },
    { name: 'removes_any', antiPattern: /:\s*any\b/, desc: 'No any' },
    { name: 'uses_class_binding', pattern: /\[class\./, desc: '[class.x]' },
    { name: 'uses_proper_selector', pattern: /selector:\s*'app-product-card'/, desc: 'app- prefix' },
    { name: 'uses_ng_optimized_image', pattern: /ngSrc|NgOptimizedImage/, desc: 'NgOptimizedImage' },
    { name: 'uses_track_expression', pattern: /track\s+\S+/, desc: 'track expression' },
  ],
  'real-data-fetching': [
    { name: 'uses_httpResource_or_resource', pattern: /httpResource|resource\(|rxResource/, desc: 'Resource API' },
    { name: 'uses_onpush', pattern: /ChangeDetectionStrategy\.OnPush/, desc: 'OnPush' },
    { name: 'handles_loading', pattern: /loading|isLoading|Loading/, desc: 'Loading state' },
    { name: 'handles_error', pattern: /error|Error/, desc: 'Error state' },
    { name: 'uses_signals', pattern: /signal\(|computed\(/, desc: 'Signals' },
    { name: 'has_form_validation', pattern: /Validators|required|email|pattern|valid/, desc: 'Validation' },
  ],
  'real-testing': [
    { name: 'mocks_ai_service', pattern: /provide.*AiService|useValue.*prompt|vi\.fn|jasmine\.createSpy|mock.*AiService/s, desc: 'Mocks AiService' },
    { name: 'tests_loading_state', pattern: /loading|isLoading|Checking AI/, desc: 'Tests loading' },
    { name: 'tests_error_state', pattern: /error|unavailable|Error/, desc: 'Tests error' },
    { name: 'tests_send_message', pattern: /send|submit|user.*message/s, desc: 'Tests send' },
    { name: 'tests_ai_response', pattern: /assistant|response|AI.*response/s, desc: 'Tests AI response' },
    { name: 'uses_async_handling', pattern: /await|whenStable|fakeAsync|fixture\.whenStable/, desc: 'Async handling' },
  ],
  'real-accessibility': [
    { name: 'uses_role_combobox', pattern: /role.*combobox|combobox/s, desc: 'role=combobox' },
    { name: 'uses_aria_expanded', pattern: /aria-expanded/, desc: 'aria-expanded' },
    { name: 'uses_aria_activedescendant', pattern: /aria-activedescendant|activeDescendant|activedescendant/, desc: 'aria-activedescendant' },
    { name: 'handles_keyboard', pattern: /ArrowDown|ArrowUp|keydown|KeyboardEvent/, desc: 'Keyboard nav' },
    { name: 'uses_listbox_role', pattern: /role.*listbox|listbox/s, desc: 'role=listbox' },
    { name: 'debounces_input', pattern: /debounce|setTimeout|timer/, desc: 'Debounces' },
  ],
  'real-form': [
    { name: 'multi_step', pattern: /step|currentStep|Step/, desc: 'Multi-step' },
    { name: 'validates_email_async', pattern: /async.*valid|AsyncValidator|check-email|blur.*email/s, desc: 'Async email' },
    { name: 'validates_password', pattern: /password.*match|confirmPassword|passwordMatch|min.*8|minLength/s, desc: 'Password validation' },
    { name: 'validates_age', pattern: /18|dateOfBirth|age/, desc: 'Age 18+' },
    { name: 'shows_summary', pattern: /summary|Summary|review|confirm/, desc: 'Summary' },
    { name: 'handles_submit_states', pattern: /submitting|saving|success|submitted/, desc: 'Submit states' },
  ],
  'real-performance': [
    { name: 'uses_defer', pattern: /@defer/, desc: '@defer' },
    { name: 'uses_ng_optimized_image', pattern: /ngSrc|NgOptimizedImage/, desc: 'NgOptimizedImage' },
    { name: 'uses_onpush', pattern: /ChangeDetectionStrategy\.OnPush/, desc: 'OnPush' },
    { name: 'uses_virtual_scroll_or_delegation', pattern: /virtual|cdk-virtual|pagination|paginate|pageSize|slice|DataTable|data-table/i, desc: 'Virtual/delegation' },
    { name: 'uses_track_or_for', pattern: /track\s+\S+|@for/s, desc: 'track/@for' },
    { name: 'defers_chart', pattern: /@defer/s, desc: 'Defers heavy' },
  ],
};

const RUNS = ['', '_r2', '_r3'];
const CONFIGS = ['with_skill', 'without_skill'];

// Grade all runs
const allResults = {};

for (const [evalName, assertions] of Object.entries(ASSERTIONS)) {
  allResults[evalName] = {};

  for (const config of CONFIGS) {
    allResults[evalName][config] = { runs: [], passRates: [] };

    for (const run of RUNS) {
      const dir = join(ITER, evalName, `${config}${run}`, 'outputs');

      if (!existsSync(dir)) { allResults[evalName][config].runs.push({ error: 'no dir', run }); continue; }

      const files = readdirSync(dir).filter(f => f.endsWith('.ts'));

      if (!files.length) { allResults[evalName][config].runs.push({ error: 'no files', run }); continue; }

      const content = files.map(f => readFileSync(join(dir, f), 'utf-8')).join('\n');
      let passed = 0;
      const total = assertions.length;
      const details = {};

      for (const a of assertions) {
        let ok;

        if (a.antiPattern) { ok = !a.antiPattern.test(content); }
        else { ok = a.pattern.test(content); }

        if (ok) { passed++; }

        details[a.name] = ok;
      }

      const allPassed = passed === total;

      allResults[evalName][config].runs.push({ run: run || 'r1', passed, total, allPassed, details });
      allResults[evalName][config].passRates.push(passed / total);
    }
  }
}

// Compute Pass@k and Pass^k
function comb(n, k) {
  if (k > n) { return 0; }
  if (k === 0 || k === n) { return 1; }

  let result = 1;

  for (let i = 0; i < k; i++) {
    result = result * (n - i) / (i + 1);
  }

  return result;
}

function passAtK(n, c, k) {
  if (k > n) { return NaN; }

  return 1 - comb(n - c, k) / comb(n, k);
}

function passHatK(n, c, k) {
  if (k > n) { return NaN; }

  return comb(c, k) / comb(n, k);
}

console.log('=== K=3 ITERATION 2 BENCHMARK RESULTS ===\n');

// Per-eval results
for (const [evalName, configs] of Object.entries(allResults)) {
  console.log(`--- ${evalName} ---`);

  for (const config of CONFIGS) {
    const data = configs[config];
    const runs = data.runs.filter(r => !r.error);
    const n = runs.length;
    const c = runs.filter(r => r.allPassed).length;
    const avgRate = runs.reduce((s, r) => s + r.passed / r.total, 0) / n;

    console.log(`  ${config}: ${runs.map(r => `${r.passed}/${r.total}`).join(', ')} | avg=${(avgRate * 100).toFixed(1)}% | fully_correct=${c}/${n}`);

    // Show failures
    for (const r of runs) {
      if (r.error) { continue; }

      for (const [name, ok] of Object.entries(r.details)) {
        if (!ok) { console.log(`    [FAIL] ${r.run}/${name}`); }
      }
    }
  }

  console.log('');
}

// Aggregate Pass@k / Pass^k
console.log('=== PASS@K / PASS^K METRICS ===\n');
console.log('| Eval | Config | n | c | Pass@1 | Pass@3 | Pass^1 | Pass^3 |');
console.log('|------|--------|---|---|--------|--------|--------|--------|');

let totalWith = { n: 0, c: 0 };
let totalWithout = { n: 0, c: 0 };

for (const [evalName, configs] of Object.entries(allResults)) {
  for (const config of CONFIGS) {
    const runs = configs[config].runs.filter(r => !r.error);
    const n = runs.length;
    const c = runs.filter(r => r.allPassed).length;

    if (config === 'with_skill') { totalWith.n += n; totalWith.c += c; }
    else { totalWithout.n += n; totalWithout.c += c; }

    const p1 = passAtK(n, c, 1).toFixed(2);
    const p3 = passAtK(n, c, 3).toFixed(2);
    const ph1 = passHatK(n, c, 1).toFixed(2);
    const ph3 = passHatK(n, c, 3).toFixed(2);

    console.log(`| ${evalName} | ${config} | ${n} | ${c} | ${p1} | ${p3} | ${ph1} | ${ph3} |`);
  }
}

// Overall
console.log('|------|--------|---|---|--------|--------|--------|--------|');

for (const [label, t] of [['with_skill', totalWith], ['without_skill', totalWithout]]) {
  const p1 = passAtK(t.n, t.c, 1).toFixed(2);
  const p3 = passAtK(t.n, t.c, 3).toFixed(2);
  const ph1 = passHatK(t.n, t.c, 1).toFixed(2);
  const ph3 = passHatK(t.n, t.c, 3).toFixed(2);

  console.log(`| OVERALL | ${label} | ${t.n} | ${t.c} | ${p1} | ${p3} | ${ph1} | ${ph3} |`);
}

// Per-assertion pass rates across all runs
console.log('\n=== PER-ASSERTION PASS RATES (across k=3 runs) ===\n');

for (const [evalName, assertions] of Object.entries(ASSERTIONS)) {
  for (const a of assertions) {
    let withPass = 0, withTotal = 0, woPass = 0, woTotal = 0;

    for (const config of CONFIGS) {
      for (const r of allResults[evalName][config].runs) {
        if (r.error) { continue; }

        if (config === 'with_skill') { withTotal++; if (r.details[a.name]) { withPass++; } }
        else { woTotal++; if (r.details[a.name]) { woPass++; } }
      }
    }

    const wRate = (withPass / withTotal * 100).toFixed(0);
    const woRate = (woPass / woTotal * 100).toFixed(0);
    const delta = withPass / withTotal - woPass / woTotal;
    const flag = Math.abs(delta) > 0.01 ? (delta > 0 ? ' [SKILL+]' : ' [BASE+]') : '';

    if (flag) {
      console.log(`${evalName}/${a.name}: with=${wRate}% without=${woRate}%${flag}`);
    }
  }
}

writeFileSync(join(ITER, 'k3-results.json'), JSON.stringify(allResults, null, 2));
console.log('\nFull results: iteration-2/k3-results.json');
