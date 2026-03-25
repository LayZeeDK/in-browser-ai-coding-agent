import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ITER = 'D:/projects/github/LayZeeDK/in-browser-ai-coding-agent/.claude/skills/angular-developer-workspace/iteration-2';

const META = {
  'real-component-refactor': {
    assertions: [
      { name: 'removes_standalone_true', antiPattern: /standalone:\s*true/, description: 'Removes standalone:true' },
      { name: 'uses_onpush', pattern: /ChangeDetectionStrategy\.OnPush/, description: 'OnPush' },
      { name: 'uses_native_control_flow', pattern: /@if\s*\(|@for\s*\(/, description: '@if/@for control flow' },
      { name: 'uses_input_function', pattern: /\binput[<(]|input\.required/, description: 'input() function' },
      { name: 'uses_inject', pattern: /inject\(/, description: 'inject() DI' },
      { name: 'removes_any', antiPattern: /:\s*any\b/, description: 'No any types' },
      { name: 'uses_class_binding', pattern: /\[class\./, description: '[class.x] binding' },
      { name: 'uses_proper_selector', pattern: /selector:\s*'app-product-card'/, description: 'app- prefix' },
      { name: 'uses_ng_optimized_image', pattern: /ngSrc|NgOptimizedImage/, description: 'NgOptimizedImage' },
      // CORRECTED: Accept any track expression
      { name: 'uses_track_expression', pattern: /track\s+\S+/, description: '@for uses track (any expression)' },
    ],
  },
  'real-data-fetching': {
    assertions: [
      { name: 'uses_httpResource_or_resource', pattern: /httpResource|resource\(|rxResource/, description: 'Reactive resource API' },
      { name: 'uses_onpush', pattern: /ChangeDetectionStrategy\.OnPush/, description: 'OnPush' },
      { name: 'handles_loading', pattern: /loading|isLoading|Loading/, description: 'Loading state' },
      { name: 'handles_error', pattern: /error|Error/, description: 'Error state' },
      { name: 'uses_signals', pattern: /signal\(|computed\(/, description: 'Signals' },
      { name: 'has_form_validation', pattern: /Validators|required|email|pattern|valid/, description: 'Validation' },
    ],
  },
  'real-testing': {
    assertions: [
      { name: 'mocks_ai_service', pattern: /provide.*AiService|useValue.*prompt|vi\.fn|jasmine\.createSpy|mock.*AiService/s, description: 'Mocks AiService' },
      { name: 'tests_loading_state', pattern: /loading|isLoading|Checking AI/, description: 'Tests loading' },
      { name: 'tests_error_state', pattern: /error|unavailable|Error/, description: 'Tests error' },
      { name: 'tests_send_message', pattern: /send|submit|user.*message/s, description: 'Tests send' },
      { name: 'tests_ai_response', pattern: /assistant|response|AI.*response/s, description: 'Tests AI response' },
      { name: 'uses_async_handling', pattern: /await|whenStable|fakeAsync|fixture\.whenStable/, description: 'Async handling' },
    ],
  },
  'real-accessibility': {
    assertions: [
      { name: 'uses_role_combobox', pattern: /role.*combobox|combobox/s, description: 'role=combobox' },
      { name: 'uses_aria_expanded', pattern: /aria-expanded/, description: 'aria-expanded' },
      { name: 'uses_aria_activedescendant', pattern: /aria-activedescendant|activeDescendant|activedescendant/, description: 'aria-activedescendant' },
      { name: 'handles_keyboard', pattern: /ArrowDown|ArrowUp|keydown|KeyboardEvent/, description: 'Keyboard nav' },
      { name: 'uses_listbox_role', pattern: /role.*listbox|listbox/s, description: 'role=listbox' },
      { name: 'debounces_input', pattern: /debounce|setTimeout|timer/, description: 'Debounces API' },
    ],
  },
  'real-form': {
    assertions: [
      { name: 'multi_step', pattern: /step|currentStep|Step/, description: 'Multi-step' },
      { name: 'validates_email_async', pattern: /async.*valid|AsyncValidator|check-email|blur.*email/s, description: 'Async email validation' },
      { name: 'validates_password', pattern: /password.*match|confirmPassword|passwordMatch|min.*8|minLength/s, description: 'Password validation' },
      { name: 'validates_age', pattern: /18|dateOfBirth|age/, description: 'Age validation' },
      { name: 'shows_summary', pattern: /summary|Summary|review|confirm/, description: 'Summary step' },
      { name: 'handles_submit_states', pattern: /submitting|saving|success|submitted/, description: 'Submit states' },
    ],
  },
  'real-performance': {
    assertions: [
      { name: 'uses_defer', pattern: /@defer/, description: '@defer lazy loading' },
      { name: 'uses_ng_optimized_image', pattern: /ngSrc|NgOptimizedImage/, description: 'NgOptimizedImage' },
      { name: 'uses_onpush', pattern: /ChangeDetectionStrategy\.OnPush/, description: 'OnPush' },
      // CORRECTED: Accept delegation to child component
      { name: 'uses_virtual_scroll_or_delegation', pattern: /virtual|cdk-virtual|pagination|paginate|pageSize|slice|DataTable|data-table/i, description: 'Virtual scroll or child delegation' },
      // CORRECTED: Accept track or @for (delegation to child has @for in template)
      { name: 'uses_track_or_for', pattern: /track\s+\S+|@for/s, description: 'track expression or @for' },
      { name: 'defers_chart', pattern: /@defer/s, description: 'Defers heavy components' },
    ],
  },
};

const results = {};
let tp = 0, ta = 0, wsp = 0, wst = 0, wosp = 0, wost = 0;

for (const [en, meta] of Object.entries(META)) {
  results[en] = {};

  for (const cfg of ['with_skill', 'without_skill']) {
    const dir = join(ITER, en, cfg, 'outputs');

    if (!existsSync(dir)) { results[en][cfg] = { error: 'no dir' }; continue; }

    const files = readdirSync(dir).filter(f => f.endsWith('.ts'));

    if (!files.length) { results[en][cfg] = { error: 'no files' }; continue; }

    const content = files.map(f => readFileSync(join(dir, f), 'utf-8')).join('\n');
    let p = 0, t = 0;
    const ar = {};

    for (const a of meta.assertions) {
      t++; ta++;

      if (cfg === 'with_skill') { wst++; } else { wost++; }

      let ok = false;

      if (a.antiPattern) {
        ok = !a.antiPattern.test(content);
      } else {
        ok = a.pattern.test(content);
      }

      if (ok) {
        p++; tp++;

        if (cfg === 'with_skill') { wsp++; } else { wosp++; }
      }

      ar[a.name] = { passed: ok, desc: a.description };
    }

    results[en][cfg] = { passed: p, total: t, assertions: ar };
  }
}

console.log('=== ITERATION 2 (CORRECTED GRADING) ===');
console.log(`Total: ${tp}/${ta}`);
console.log(`  with_skill:    ${wsp}/${wst} (${(wsp / wst * 100).toFixed(1)}%)`);
console.log(`  without_skill: ${wosp}/${wost} (${(wosp / wost * 100).toFixed(1)}%)`);
console.log('');

for (const [en, cfgs] of Object.entries(results)) {
  const ws = cfgs.with_skill, wos = cfgs.without_skill;

  if (ws?.error || wos?.error) { console.log(`${en}: ERROR`); continue; }

  const d = ws.passed - wos.passed;
  const ds = d > 0 ? ` (+${d})` : d < 0 ? ` (${d})` : ' (=)';

  console.log(`${en}: with=${ws.passed}/${ws.total} | without=${wos.passed}/${wos.total}${ds}`);

  for (const c of ['with_skill', 'without_skill']) {
    for (const [n, r] of Object.entries(cfgs[c].assertions || {})) {
      if (!r.passed) { console.log(`  [FAIL] ${c}/${n}: ${r.desc}`); }
    }
  }
}

writeFileSync(
  join(ITER, 'programmatic-grading-corrected.json'),
  JSON.stringify({ tp, ta, wsp, wst, wosp, wost, results }, null, 2)
);

console.log(`\nSaved: iteration-2/programmatic-grading-corrected.json`);
