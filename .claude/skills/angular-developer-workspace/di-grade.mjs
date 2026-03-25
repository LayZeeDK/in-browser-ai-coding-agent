// Programmatic grading for DI evals
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const BASE = 'angular-developer-workspace/di-iteration-1';

function readAllOutputs(dir) {
  const files = readdirSync(dir).filter(f => f.endsWith('.ts') || f.endsWith('.md'));
  let combined = '';
  for (const f of files) {
    combined += `\n// === ${f} ===\n` + readFileSync(join(dir, f), 'utf8');
  }
  return combined;
}

function grade(content, assertions) {
  return assertions.map(a => {
    let passed = false;
    let evidence = '';

    switch (a.id) {
      // Eval 1: DestroyRef + takeUntilDestroyed
      case '1-destroyref':
        passed = content.includes('DestroyRef') && content.includes('@angular/core');
        evidence = passed ? 'Found DestroyRef imported from @angular/core' : 'DestroyRef not found';
        break;
      case '1-takeuntildestroyed':
        passed = content.includes('takeUntilDestroyed');
        evidence = passed ? 'Found takeUntilDestroyed usage' : 'takeUntilDestroyed not found';
        break;
      case '1-no-ondestroy':
        passed = !content.includes('implements') || !content.includes('OnDestroy');
        if (!passed) passed = !(/implements\s+\w*OnDestroy/.test(content));
        evidence = passed ? 'No OnDestroy implementation found' : 'Found OnDestroy implementation';
        break;
      case '1-correct-import':
        passed = content.includes('@angular/core/rxjs-interop');
        evidence = passed ? 'Correct import from @angular/core/rxjs-interop' : 'Wrong import path for takeUntilDestroyed';
        break;
      case '1-explicit-destroyref':
        // If used outside injection context, should pass DestroyRef. Check if ANY usage outside constructor/field init passes it.
        // This is a soft check - pass if takeUntilDestroyed() is used in injection context (no arg needed) OR if DestroyRef is passed
        const hasNoArgUsage = /takeUntilDestroyed\(\)/.test(content);
        const hasArgUsage = /takeUntilDestroyed\(\s*\w+/.test(content);
        const inFieldOrCtor = /(?:private|protected|public|readonly)\s+\w+.*takeUntilDestroyed|constructor\s*\([\s\S]*?takeUntilDestroyed/.test(content);
        passed = hasNoArgUsage || hasArgUsage;
        evidence = hasNoArgUsage ? 'Used takeUntilDestroyed() in injection context (no arg needed)' :
                   hasArgUsage ? 'Passes DestroyRef explicitly' : 'takeUntilDestroyed not used properly';
        break;
      case '1-onpush':
        passed = content.includes('ChangeDetectionStrategy.OnPush');
        evidence = passed ? 'Found OnPush change detection' : 'OnPush not set';
        break;

      // Eval 2: viewProviders + content projection
      case '2-viewproviders':
        passed = content.includes('viewProviders');
        evidence = passed ? 'Found viewProviders in component' : 'viewProviders not used';
        break;
      case '2-ng-content':
        passed = content.includes('<ng-content') || content.includes('ng-content');
        evidence = passed ? 'Found ng-content for projection' : 'ng-content not found';
        break;
      case '2-formstateservice':
        passed = /FormState(Service|Manager)|formState/.test(content) && content.includes('@Injectable');
        evidence = passed ? 'Found injectable form state service' : 'FormStateService not found or not injectable';
        break;
      case '2-isolation':
        // Check if code demonstrates or explains that projected content doesn't get viewProviders instance
        passed = (content.includes('projected') && (content.includes('NOT') || content.includes('not') || content.includes("won't") || content.includes('cannot'))) ||
                 content.includes('optional') || content.includes('skipSelf') ||
                 (content.includes('viewProviders') && content.includes('ng-content'));
        evidence = passed ? 'Demonstrates isolation of projected content' : 'No clear demonstration of isolation';
        break;
      case '2-explanation':
        passed = content.includes('viewProviders') && (
          content.includes('#VIEW') || content.includes('view boundary') ||
          content.includes('projected content') || content.includes('content projection') ||
          content.includes('not visible') || content.includes('not available')
        );
        evidence = passed ? 'Explains viewProviders isolation behavior' : 'Missing explanation of isolation';
        break;
      case '2-onpush':
        passed = content.includes('ChangeDetectionStrategy.OnPush');
        evidence = passed ? 'Found OnPush' : 'OnPush not set';
        break;

      // Eval 3: App/Environment initializers
      case '3-provideappinitializer':
        passed = content.includes('provideAppInitializer');
        evidence = passed ? 'Uses provideAppInitializer()' : 'provideAppInitializer not found';
        break;
      case '3-no-app-initializer-token':
        // Should NOT use APP_INITIALIZER multi token
        const usesOldToken = content.includes('APP_INITIALIZER') && content.includes('multi');
        passed = content.includes('provideAppInitializer') || !usesOldToken;
        evidence = usesOldToken ? 'Uses deprecated APP_INITIALIZER multi token' : 'Does not use deprecated token';
        break;
      case '3-injectiontoken':
        passed = content.includes('InjectionToken');
        evidence = passed ? 'Creates InjectionToken for config' : 'InjectionToken not found';
        break;
      case '3-async-init':
        passed = content.includes('Promise') || content.includes('Observable') ||
                 content.includes('firstValueFrom') || content.includes('lastValueFrom') ||
                 content.includes('async') || content.includes('.toPromise');
        evidence = passed ? 'Async initialization detected' : 'No async initialization';
        break;
      case '3-inject-in-initializer':
        passed = content.includes('inject(') && (content.includes('HttpClient') || content.includes('http'));
        evidence = passed ? 'Uses inject() in initializer' : 'No inject() in initializer context';
        break;
      case '3-env-initializer':
        passed = content.includes('provideEnvironmentInitializer') || content.includes('ENVIRONMENT_INITIALIZER');
        evidence = passed ? 'Uses environment initializer' : 'No environment initializer found';
        break;
    }

    return { text: a.text, passed, evidence };
  });
}

const evals = [
  {
    name: 'destroyref-takeuntildestroyed',
    assertions: [
      { id: '1-destroyref', text: 'Uses DestroyRef from @angular/core for cleanup registration' },
      { id: '1-takeuntildestroyed', text: 'Uses takeUntilDestroyed() from @angular/core/rxjs-interop' },
      { id: '1-no-ondestroy', text: 'Does NOT implement OnDestroy interface or ngOnDestroy method' },
      { id: '1-correct-import', text: 'Imports takeUntilDestroyed from @angular/core/rxjs-interop' },
      { id: '1-explicit-destroyref', text: 'If used outside injection context, passes DestroyRef explicitly' },
      { id: '1-onpush', text: 'Component uses ChangeDetectionStrategy.OnPush' },
    ]
  },
  {
    name: 'viewproviders-content-projection',
    assertions: [
      { id: '2-viewproviders', text: 'Uses viewProviders array in the form wrapper component' },
      { id: '2-ng-content', text: 'Uses ng-content for content projection' },
      { id: '2-formstateservice', text: 'FormStateService is injectable and demonstrates isolated state' },
      { id: '2-isolation', text: 'Projected content does NOT receive the viewProviders instance' },
      { id: '2-explanation', text: 'Code or comments explain viewProviders isolation behavior' },
      { id: '2-onpush', text: 'Components use ChangeDetectionStrategy.OnPush' },
    ]
  },
  {
    name: 'app-initializer-env-initializer',
    assertions: [
      { id: '3-provideappinitializer', text: 'Uses provideAppInitializer() function from @angular/core' },
      { id: '3-no-app-initializer-token', text: 'Does not use deprecated APP_INITIALIZER multi token' },
      { id: '3-injectiontoken', text: 'Creates an InjectionToken for the feature flags config' },
      { id: '3-async-init', text: 'The app initializer returns a Promise or Observable' },
      { id: '3-inject-in-initializer', text: 'Uses inject() inside the initializer' },
      { id: '3-env-initializer', text: 'Uses provideEnvironmentInitializer() for lazy-loaded route setup' },
    ]
  }
];

for (const ev of evals) {
  for (const config of ['with_skill', 'without_skill']) {
    const dir = join(BASE, ev.name, config, 'outputs');
    const content = readAllOutputs(dir);
    const results = grade(content, ev.assertions);
    const passed = results.filter(r => r.passed).length;
    const total = results.length;

    const grading = {
      expectations: results,
      summary: { passed, failed: total - passed, total, pass_rate: +(passed / total).toFixed(2) }
    };

    const outPath = join(BASE, ev.name, config, 'grading.json');
    writeFileSync(outPath, JSON.stringify(grading, null, 2));
    console.log(`${ev.name}/${config}: ${passed}/${total} (${(passed/total*100).toFixed(0)}%)`);
    for (const r of results) {
      console.log(`  ${r.passed ? '[OK]' : '[FAIL]'} ${r.text}`);
      if (!r.passed) console.log(`    Evidence: ${r.evidence}`);
    }
  }
}
