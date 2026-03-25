import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ITERATION_DIR = resolve('iteration-1');

// Assertion patterns: regex or string checks per eval
const ASSERTION_PATTERNS = {
  'attr-directive': {
    uses_host_metadata: { pattern: /host:\s*\{/, description: 'host: {} in @Directive' },
    uses_input_function: { pattern: /\binput[<(]/, description: 'input() or input<>()' },
    correct_selector: { pattern: /selector:\s*'\[appHighlight\]'/, description: "[appHighlight] selector" },
    standalone_implicit: { antiPattern: /standalone:\s*true/, description: 'No standalone: true' },
  },
  'structural-directive': {
    uses_inject_function: { pattern: /inject\(TemplateRef\)|inject<.*TemplateRef/, description: 'inject(TemplateRef)' },
    creates_embedded_views: { pattern: /createEmbeddedView/, description: 'createEmbeddedView call' },
    exposes_implicit_context: { pattern: /\$implicit/, description: '$implicit in context' },
    handles_changes: { pattern: /clear\(\)|effect\(|set appRepeat/, description: 'Clears/recreates on change' },
  },
  'host-directives': {
    uses_hostDirectives: { pattern: /hostDirectives:\s*\[/, description: 'hostDirectives array' },
    exposes_inputs_outputs: { pattern: /inputs:\s*\[/, description: 'inputs array in hostDirectives' },
    explains_aliasing: { pattern: /:\s*'?\w+.*'?\s*(?:,|])/, description: 'aliasing syntax' },
    explains_composition_benefit: { pattern: /consumer|encapsulat|compos|without.*know/, description: 'Composition benefit explanation' },
  },
  'ng-optimized-image': {
    provides_image_loader: { pattern: /provideCloudinaryLoader|IMAGE_LOADER|provideImgixLoader/, description: 'Image loader provider' },
    uses_ngSrc: { pattern: /ngSrc/, description: 'ngSrc attribute' },
    shows_priority: { pattern: /priority/, description: 'priority attribute' },
    explains_fill_mode: { pattern: /\bfill\b/, description: 'fill mode' },
  },
  'style-naming': {
    kebab_case_filenames: { pattern: /user-profile\.component\.ts|user-profile\.service\.ts/, description: 'kebab-case filenames' },
    proper_selectors: { pattern: /selector:\s*'app-user-profile'/, description: 'app-user-profile selector' },
    proper_class_names: { pattern: /UserProfileComponent/, description: 'PascalCase class name' },
    modern_apis: { pattern: /inject\(|input\(|input\.required|CanActivateFn/, description: 'Modern Angular APIs' },
  },
  'style-patterns': {
    fixes_selector: { pattern: /selector:\s*'app-user-list'/, description: 'app-user-list selector' },
    removes_standalone_true: { antiPattern: /standalone:\s*true/, description: 'No standalone: true' },
    uses_control_flow: { pattern: /@if\s*\(|@for\s*\(/, description: '@if/@for control flow' },
    uses_inject: { pattern: /inject\(HttpClient\)|httpResource/, description: 'inject() or httpResource' },
    adds_onpush: { pattern: /ChangeDetectionStrategy\.OnPush/, description: 'OnPush change detection' },
    removes_any: { antiPattern: /:\s*any\b(?!\[)(?!.*interface)/, description: 'No any types (except interface definitions)' },
  },
  'defer-element-ref': {
    uses_template_ref_variable: { pattern: /#\w+Btn|#\w+[Ss]entinel|#preview/, description: 'Template reference variable' },
    uses_element_ref_in_trigger: { pattern: /on\s+(hover|interaction|viewport)\(\w+/, description: 'Element ref in trigger' },
    combines_triggers: { pattern: /on\s+\w+\([^)]+\)\s*;\s*on\s+\w+/, description: 'Multiple triggers with ;' },
    trigger_before_defer: { pattern: /<button[^>]*#\w+/, description: 'Button with ref before @defer' },
  },
  'defer-testing': {
    uses_getDeferBlocks: { pattern: /getDeferBlocks\(\)/, description: 'getDeferBlocks() call' },
    uses_DeferBlockState: { pattern: /DeferBlockState\.(Complete|Loading|Placeholder|Error)/, description: 'DeferBlockState enum' },
    handles_async: { pattern: /await\s+.*render\(|await\s+fixture/, description: 'Async handling' },
    complete_testbed_example: { pattern: /TestBed\.configureTestingModule/, description: 'TestBed setup' },
  },
  'defer-nested-prefetch': {
    top_level_only_getDeferBlocks: { pattern: /getDeferBlocks\(\)/, description: 'getDeferBlocks on fixture' },
    nested_access_after_parent_complete: { pattern: /getDeferBlocks\(\).*Complete|Complete.*getDeferBlocks/s, description: 'Nested access after Complete' },
    three_level_nesting: { pattern: /Complete.*Complete.*Complete/s, description: '3-level Complete chain' },
    playthrough_auto_resolve: { pattern: /DeferBlockBehavior\.Playthrough/, description: 'Playthrough mode' },
    error_blocks_nested: { pattern: /DeferBlockState\.Error/, description: 'Error state tested' },
  },
  'defer-error-recovery': {
    error_to_loading_retry: { pattern: /Error.*Loading|Loading.*Error/s, description: 'Error to Loading transition' },
    complete_to_placeholder_reset: { pattern: /Complete.*Placeholder|Placeholder.*Complete/s, description: 'Complete to Placeholder' },
    rapid_state_changes: { pattern: /Placeholder.*Loading.*Complete/s, description: 'Rapid state changes' },
    manual_default_state: { pattern: /Manual|placeholder.*default|default.*placeholder/is, description: 'Manual default state' },
    compile_components_requirement: { pattern: /compileComponents/, description: 'compileComponents reference' },
  },
  'i18n-icu': {
    i18n_attribute_with_meaning: { pattern: /i18n="[^"]*\|[^"]*"/, description: 'i18n with meaning|description' },
    icu_plural: { pattern: /plural\s*,/, description: 'ICU plural expression' },
    icu_select: { pattern: /select\s*,/, description: 'ICU select expression' },
    i18n_on_attributes: { pattern: /i18n-(placeholder|title|aria)/, description: 'i18n on attributes' },
    localize_tagged_template: { pattern: /\$localize`|\$localize\s*`|\$localize`:/, description: '$localize tagged template' },
  },
  'i18n-runtime': {
    loadTranslations_usage: { pattern: /loadTranslations/, description: 'loadTranslations() call' },
    angular_json_config: { pattern: /angular\.json|project\.json|i18n.*config/i, description: 'Angular CLI i18n config' },
    extract_i18n_command: { pattern: /extract-i18n/, description: 'ng extract-i18n command' },
    build_vs_runtime_comparison: { pattern: /build.time|runtime.*i18n|separate.*bundle|single.*bundle/is, description: 'Build vs runtime comparison' },
    locale_init_polyfill: { pattern: /@angular\/localize\/init|@angular\/localize/, description: '@angular/localize setup' },
  },
  'service-workers': {
    ng_add_pwa: { pattern: /ng\s+add\s+@angular\/pwa/, description: 'ng add @angular/pwa' },
    ngsw_config: { pattern: /assetGroups|dataGroups/, description: 'ngsw-config structure' },
    sw_update: { pattern: /versionUpdates.*activateUpdate|activateUpdate.*versionUpdates/s, description: 'SwUpdate usage' },
    sw_push: { pattern: /SwPush|requestSubscription/, description: 'SwPush usage' },
    local_testing: { pattern: /http-server|npx\s+serve/, description: 'Local testing instructions' },
  },
  'drag-drop': {
    basic_setup: { pattern: /cdkDropList.*cdkDrag|cdkDrag.*cdkDropList/s, description: 'cdkDropList + cdkDrag' },
    reorder: { pattern: /moveItemInArray/, description: 'moveItemInArray' },
    transfer_between_lists: { pattern: /transferArrayItem/, description: 'transferArrayItem' },
    drag_handle_preview: { pattern: /cdkDragHandle/, description: 'cdkDragHandle' },
    conditional_disable: { pattern: /cdkDragDisabled/, description: 'cdkDragDisabled' },
  },
  'rxjs-interop': {
    toSignal_toObservable: { pattern: /toSignal\(.*toObservable\(|toObservable\(.*toSignal\(/s, description: 'toSignal + toObservable' },
    takeUntilDestroyed: { pattern: /takeUntilDestroyed/, description: 'takeUntilDestroyed()' },
    output_interop: { pattern: /outputToObservable|outputFromObservable/, description: 'Output interop functions' },
    rxResource: { pattern: /rxResource\(/, description: 'rxResource()' },
    best_practices: { pattern: /prefer.*signal|signal.*prefer|when.*signal|signal.*when/is, description: 'Signals vs observables guidance' },
  },
  'angular-libraries': {
    generate_library: { pattern: /ng\s+generate\s+library/, description: 'ng generate library' },
    project_structure: { pattern: /public-api\.ts.*ng-package\.json|ng-package\.json.*public-api\.ts/s, description: 'public-api.ts + ng-package.json' },
    secondary_entry_points: { pattern: /secondary.*entry.*point|entry.*point.*secondary/is, description: 'Secondary entry points' },
    npm_publish: { pattern: /npm\s+publish/, description: 'npm publish command' },
    forRoot_pattern: { pattern: /forRoot|provideMyLib|provide\w+\(/, description: 'forRoot or provide* pattern' },
  },
};

const results = {};
let totalPassed = 0;
let totalAssertions = 0;

for (const [evalName, assertions] of Object.entries(ASSERTION_PATTERNS)) {
  results[evalName] = {};

  for (const config of ['with_skill', 'without_skill']) {
    // Find output files
    const outputDir = join(ITERATION_DIR, evalName, config, 'outputs');

    if (!existsSync(outputDir)) {
      results[evalName][config] = { error: 'Output directory not found' };
      continue;
    }

    const files = readdirSync(outputDir).filter(f => f.endsWith('.ts'));
    const content = files.map(f => readFileSync(join(outputDir, f), 'utf-8')).join('\n');

    const evalResults = {};
    let passed = 0;
    let total = 0;

    for (const [assertionName, check] of Object.entries(assertions)) {
      total++;
      totalAssertions++;
      let assertionPassed = false;

      if (check.antiPattern) {
        // Anti-pattern: PASSES if pattern is NOT found
        assertionPassed = !check.antiPattern.test(content);
      } else {
        assertionPassed = check.pattern.test(content);
      }

      if (assertionPassed) {
        passed++;
        totalPassed++;
      }

      evalResults[assertionName] = {
        passed: assertionPassed,
        description: check.description,
      };
    }

    results[evalName][config] = {
      passed,
      total,
      pass_rate: (passed / total * 100).toFixed(1) + '%',
      assertions: evalResults,
    };
  }
}

// Summary
console.log('\n=== PROGRAMMATIC GRADING RESULTS ===\n');
console.log(`Total: ${totalPassed}/${totalAssertions} assertions passed\n`);

for (const [evalName, configs] of Object.entries(results)) {
  const ws = configs.with_skill;
  const wos = configs.without_skill;

  if (ws?.error || wos?.error) {
    console.log(`${evalName}: ERROR - ${ws?.error || wos?.error}`);
    continue;
  }

  const wsRate = ws ? `${ws.passed}/${ws.total}` : 'N/A';
  const wosRate = wos ? `${wos.passed}/${wos.total}` : 'N/A';

  console.log(`${evalName}: with_skill=${wsRate} | without_skill=${wosRate}`);

  // Show failures
  for (const config of ['with_skill', 'without_skill']) {
    const c = configs[config];

    if (!c?.assertions) {
      continue;
    }

    for (const [name, result] of Object.entries(c.assertions)) {
      if (!result.passed) {
        console.log(`  [FAIL] ${config}/${name}: ${result.description}`);
      }
    }
  }
}

// Write full results
writeFileSync(
  join(ITERATION_DIR, 'programmatic-grading.json'),
  JSON.stringify({ totalPassed, totalAssertions, results }, null, 2)
);

console.log(`\nFull results written to iteration-1/programmatic-grading.json`);
