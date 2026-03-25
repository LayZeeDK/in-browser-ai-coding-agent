import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ITER = join(__dirname, 'iteration-2');

// v2: Fixed uses_inject to accept httpResource as alternative
const ASSERTIONS = {
  'real-component-refactor': [
    { name: 'removes_standalone_true', antiPattern: /standalone:\s*true/, desc: 'No standalone:true' },
    { name: 'uses_onpush', pattern: /ChangeDetectionStrategy\.OnPush/, desc: 'OnPush' },
    { name: 'uses_native_control_flow', pattern: /@if\s*\(|@for\s*\(/, desc: '@if/@for' },
    { name: 'uses_input_function', pattern: /\binput[<(]|input\.required/, desc: 'input()' },
    // FIXED: Accept httpResource as alternative to inject() -- it replaces manual DI
    { name: 'uses_inject_or_httpResource', pattern: /inject\(|httpResource/, desc: 'inject() or httpResource' },
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

function comb(n, k) {
  if (k > n) return 0;
  if (k === 0 || k === n) return 1;
  let r = 1;
  for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
  return r;
}
function passAtK(n, c, k) { return k > n ? NaN : 1 - comb(n - c, k) / comb(n, k); }
function passHatK(n, c, k) { return k > n ? NaN : comb(c, k) / comb(n, k); }

const allResults = {};
for (const [evalName, assertions] of Object.entries(ASSERTIONS)) {
  allResults[evalName] = {};
  for (const config of CONFIGS) {
    allResults[evalName][config] = { runs: [] };
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
        const ok = a.antiPattern ? !a.antiPattern.test(content) : a.pattern.test(content);
        if (ok) passed++;
        details[a.name] = ok;
      }
      allResults[evalName][config].runs.push({ run: run || 'r1', passed, total, allPassed: passed === total, details });
    }
  }
}

console.log('=== K=3 ITERATION 2 (V2: CORRECTED inject ASSERTION) ===\n');

let totalWith = { n: 0, c: 0 }, totalWithout = { n: 0, c: 0 };

for (const [evalName, configs] of Object.entries(allResults)) {
  console.log(`--- ${evalName} ---`);
  for (const config of CONFIGS) {
    const runs = configs[config].runs.filter(r => !r.error);
    const n = runs.length, c = runs.filter(r => r.allPassed).length;
    console.log(`  ${config}: ${runs.map(r => `${r.passed}/${r.total}`).join(', ')} | fully_correct=${c}/${n}`);
    for (const r of runs) {
      if (r.error) continue;
      for (const [name, ok] of Object.entries(r.details)) {
        if (!ok) console.log(`    [FAIL] ${r.run}/${name}`);
      }
    }
    if (config === 'with_skill') { totalWith.n += n; totalWith.c += c; }
    else { totalWithout.n += n; totalWithout.c += c; }
  }
  console.log('');
}

console.log('=== PASS@K / PASS^K ===\n');
console.log('| Config | n | c | Pass@1 | Pass@3 | Pass^1 | Pass^3 |');
console.log('|--------|---|---|--------|--------|--------|--------|');
for (const [label, t] of [['with_skill', totalWith], ['without_skill', totalWithout]]) {
  console.log(`| ${label} | ${t.n} | ${t.c} | ${passAtK(t.n, t.c, 1).toFixed(2)} | ${passAtK(t.n, t.c, 3).toFixed(2)} | ${passHatK(t.n, t.c, 1).toFixed(2)} | ${passHatK(t.n, t.c, 3).toFixed(2)} |`);
}

console.log('\n=== DIFFERENTIATING ASSERTIONS ===\n');
for (const [evalName, assertions_list] of Object.entries(ASSERTIONS)) {
  for (const a of assertions_list) {
    let wp = 0, wt = 0, bp = 0, bt = 0;
    for (const config of CONFIGS) {
      for (const r of allResults[evalName][config].runs) {
        if (r.error) continue;
        if (config === 'with_skill') { wt++; if (r.details[a.name]) wp++; }
        else { bt++; if (r.details[a.name]) bp++; }
      }
    }
    const wr = wp / wt, br = bp / bt;
    if (Math.abs(wr - br) > 0.01) {
      const flag = wr > br ? 'SKILL+' : 'BASE+';
      console.log(`${evalName}/${a.name}: with=${(wr*100).toFixed(0)}% without=${(br*100).toFixed(0)}% [${flag}]`);
    }
  }
}

writeFileSync(join(ITER, 'k3-results-v2.json'), JSON.stringify({ totalWith, totalWithout, allResults }, null, 2));
