// Stricter programmatic grading for DI evals — iteration 2
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const BASE = 'angular-developer-workspace/di-iteration-2';

function readAllOutputs(dir) {
  if (!existsSync(dir)) return '';
  const files = readdirSync(dir).filter(f => f.endsWith('.ts') || f.endsWith('.md'));
  let combined = '';
  for (const f of files) {
    combined += `\n// === ${f} ===\n` + readFileSync(join(dir, f), 'utf8');
  }
  return combined;
}

function gradeEval1(content) {
  // Eval 1: DestroyRef + takeUntilDestroyed
  const assertions = [
    {
      text: 'Uses takeUntilDestroyed() from @angular/core/rxjs-interop',
      passed: content.includes('takeUntilDestroyed'),
      evidence: content.includes('takeUntilDestroyed') ? 'Found takeUntilDestroyed usage' : 'Not found'
    },
    {
      text: 'Does NOT implement OnDestroy interface',
      passed: !/implements\s+[\w,\s]*OnDestroy/.test(content) && !/ngOnDestroy\s*\(/.test(content),
      evidence: /implements\s+[\w,\s]*OnDestroy/.test(content) ? 'Found OnDestroy implementation' : 'No OnDestroy'
    },
    {
      text: 'Imports takeUntilDestroyed from @angular/core/rxjs-interop',
      passed: content.includes('@angular/core/rxjs-interop'),
      evidence: content.includes('@angular/core/rxjs-interop') ? 'Correct import path' : 'Wrong path'
    },
    {
      text: 'If takeUntilDestroyed used outside injection context, passes DestroyRef explicitly',
      passed: /takeUntilDestroyed\(\)/.test(content) || /takeUntilDestroyed\(\s*\w+/.test(content),
      evidence: /takeUntilDestroyed\(\)/.test(content) ? 'No-arg in injection context' : (/takeUntilDestroyed\(\s*\w+/.test(content) ? 'Explicit DestroyRef passed' : 'Not used properly')
    },
    {
      text: 'Component uses ChangeDetectionStrategy.OnPush',
      passed: content.includes('ChangeDetectionStrategy.OnPush'),
      evidence: content.includes('ChangeDetectionStrategy.OnPush') ? 'Found OnPush' : 'Not found'
    },
    {
      text: 'Does not use explicit DestroyRef.onDestroy() when takeUntilDestroyed() alone suffices',
      passed: !(/\.onDestroy\s*\(/.test(content) && /takeUntilDestroyed/.test(content)),
      evidence: /\.onDestroy\s*\(/.test(content) ? 'Uses redundant onDestroy alongside takeUntilDestroyed' : 'Clean — only takeUntilDestroyed'
    }
  ];
  return assertions;
}

function gradeEval2(content) {
  // Eval 2: viewProviders + content projection
  return [
    {
      text: 'Uses viewProviders array in the form wrapper component',
      passed: content.includes('viewProviders'),
      evidence: content.includes('viewProviders') ? 'Found viewProviders' : 'Not found'
    },
    {
      text: 'Uses ng-content for content projection',
      passed: content.includes('ng-content'),
      evidence: content.includes('ng-content') ? 'Found ng-content' : 'Not found'
    },
    {
      text: 'FormStateService is injectable',
      passed: /FormState/.test(content) && content.includes('@Injectable'),
      evidence: /FormState/.test(content) ? 'Found FormState service' : 'Not found'
    },
    {
      text: 'Projected content uses inject() with { optional: true }',
      passed: /optional\s*:\s*true/.test(content),
      evidence: /optional\s*:\s*true/.test(content) ? 'Uses optional injection' : 'No optional injection'
    },
    {
      text: 'Explains #VIEW boundary or viewProviders isolation from projected content',
      passed: (content.includes('#VIEW') || content.includes('view boundary') ||
        (content.includes('projected') && (content.includes('not') || content.includes('NOT') || content.includes('cannot') || content.includes("won't")))) ||
        (content.includes('viewProviders') && content.includes('not available')),
      evidence: content.includes('#VIEW') ? 'Explains #VIEW boundary' : (content.includes('projected') ? 'Explains projection isolation' : 'No explanation')
    },
    {
      text: 'Components use ChangeDetectionStrategy.OnPush',
      passed: content.includes('ChangeDetectionStrategy.OnPush'),
      evidence: content.includes('ChangeDetectionStrategy.OnPush') ? 'Found OnPush' : 'Not found'
    }
  ];
}

function gradeEval3(content) {
  // Eval 3: App + Environment initializers (STRICT)
  const usesModernAppInit = content.includes('provideAppInitializer');
  const usesDeprecatedAppInit = /APP_INITIALIZER/.test(content) && /multi\s*:\s*true/.test(content);
  const usesModernEnvInit = content.includes('provideEnvironmentInitializer');
  const usesDeprecatedEnvInit = /ENVIRONMENT_INITIALIZER/.test(content) && /multi\s*:\s*true/.test(content);
  const usesMakeEnvProviders = content.includes('makeEnvironmentProviders');
  const usesHttpClient = /inject\s*\(\s*HttpClient\s*\)/.test(content) || /http\s*=\s*inject\s*\(\s*HttpClient/.test(content);
  const usesFetch = /\bfetch\s*\(/.test(content);

  return [
    {
      text: 'Uses provideAppInitializer() (not APP_INITIALIZER multi token)',
      passed: usesModernAppInit && !usesDeprecatedAppInit,
      evidence: usesModernAppInit ? (usesDeprecatedAppInit ? 'Uses both modern and deprecated' : 'Uses modern provideAppInitializer') : (usesDeprecatedAppInit ? 'Uses deprecated APP_INITIALIZER' : 'Neither found')
    },
    {
      text: 'Creates an InjectionToken for config',
      passed: content.includes('InjectionToken'),
      evidence: content.includes('InjectionToken') ? 'Found InjectionToken' : 'Not found'
    },
    {
      text: 'Uses inject(HttpClient) inside initializer (not raw fetch())',
      passed: usesHttpClient || (!usesFetch && usesModernAppInit),
      evidence: usesHttpClient ? 'Uses HttpClient' : (usesFetch ? 'Uses raw fetch() instead of HttpClient' : 'No HTTP call found')
    },
    {
      text: 'Uses provideEnvironmentInitializer() (not deprecated ENVIRONMENT_INITIALIZER token)',
      passed: usesModernEnvInit && !usesDeprecatedEnvInit,
      evidence: usesModernEnvInit ? 'Uses modern provideEnvironmentInitializer' : (usesDeprecatedEnvInit ? 'Uses DEPRECATED ENVIRONMENT_INITIALIZER token' : 'No env initializer found')
    },
    {
      text: 'Uses makeEnvironmentProviders() for provider wrapping',
      passed: usesMakeEnvProviders,
      evidence: usesMakeEnvProviders ? 'Found makeEnvironmentProviders' : 'Not found'
    },
    {
      text: 'Config token is injectable after initialization',
      passed: content.includes('InjectionToken') && (content.includes('inject(') || content.includes('useValue') || content.includes('useFactory')),
      evidence: 'Token creation and provision pattern present'
    }
  ];
}

const evalGraders = {
  'destroyref-takeuntildestroyed': gradeEval1,
  'viewproviders-content-projection': gradeEval2,
  'app-initializer-env-initializer': gradeEval3
};

// Aggregate results
const allResults = {};
let totalComplete = 0;
let totalMissing = 0;

for (let run = 1; run <= 10; run++) {
  for (const [evalName, graderFn] of Object.entries(evalGraders)) {
    for (const config of ['with_skill', 'without_skill']) {
      const dir = join(BASE, `run-${run}`, evalName, config, 'outputs');
      const content = readAllOutputs(dir);

      if (!content || content.length < 200) {
        totalMissing++;
        continue;
      }

      totalComplete++;
      const results = graderFn(content);
      const passed = results.filter(r => r.passed).length;
      const total = results.length;

      const key = `${evalName}/${config}`;
      if (!allResults[key]) allResults[key] = [];
      allResults[key].push({ run, passed, total, pass_rate: passed / total, results });

      // Write grading.json
      const grading = {
        expectations: results,
        summary: { passed, failed: total - passed, total, pass_rate: +(passed / total).toFixed(2) }
      };
      const gradingPath = join(BASE, `run-${run}`, evalName, config, 'grading.json');
      writeFileSync(gradingPath, JSON.stringify(grading, null, 2));
    }
  }
}

console.log(`\nCompleted: ${totalComplete} runs, Missing: ${totalMissing} runs\n`);

// Print summary table
console.log('=== AGGREGATE RESULTS ===\n');
for (const [key, runs] of Object.entries(allResults).sort()) {
  const rates = runs.map(r => r.pass_rate);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const stddev = Math.sqrt(rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length);
  console.log(`${key}: ${(mean * 100).toFixed(1)}% +/- ${(stddev * 100).toFixed(1)}% (n=${runs.length})`);

  // Per-assertion breakdown
  const assertionCounts = {};
  for (const r of runs) {
    for (const a of r.results) {
      if (!assertionCounts[a.text]) assertionCounts[a.text] = { passed: 0, total: 0 };
      assertionCounts[a.text].total++;
      if (a.passed) assertionCounts[a.text].passed++;
    }
  }
  for (const [text, counts] of Object.entries(assertionCounts)) {
    const rate = (counts.passed / counts.total * 100).toFixed(0);
    const marker = rate === '100' ? '  ' : (parseInt(rate) >= 50 ? '~ ' : '! ');
    console.log(`  ${marker}${rate}% ${text}`);
  }
  console.log();
}
