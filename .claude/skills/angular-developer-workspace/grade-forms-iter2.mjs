import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const BASE = 'D:/projects/github/LayZeeDK/in-browser-ai-coding-agent/angular-developer-workspace/forms-iteration-2';

// Eval definitions with assertions and file-check functions
const evals = {
  'typed-registration-form': {
    files: ['registration-form.component.ts', 'username-validator.ts'],
    assertions: [
      {
        text: 'Uses fb.nonNullable.group() or NonNullableFormBuilder',
        check: (content) => /nonNullable|NonNullableFormBuilder/.test(content)
      },
      {
        text: 'FormControls are typed -- no any/Untyped',
        check: (content) => !/UntypedForm|: any[;\s,)]/.test(content)
      },
      {
        text: 'Custom async validator returns Observable<ValidationErrors | null>',
        check: (_, files) => {
          const v = files['username-validator.ts'] || '';
          return /Observable<ValidationErrors\s*\|\s*null>|AsyncValidatorFn/.test(v);
        }
      },
      {
        text: 'Async validator in third argument or asyncValidators option',
        check: (content) => /asyncValidators|,\s*\[.*[Vv]alidator/.test(content) || /\],\s*\[/.test(content)
      },
      {
        text: 'Template uses @if (not *ngIf)',
        check: (content) => /@if\s*\(/.test(content) && !/\*ngIf/.test(content)
      },
      {
        text: 'Submit button disabled when invalid',
        check: (content) => /\[disabled\].*invalid/.test(content)
      }
    ]
  },
  'cross-field-password-validation': {
    files: ['password-change.component.ts', 'password-match.validator.ts'],
    assertions: [
      {
        text: 'Cross-field validator is a ValidatorFn',
        check: (_, files) => /ValidatorFn/.test(files['password-match.validator.ts'] || '')
      },
      {
        text: 'Validator attached to FormGroup via validators option',
        check: (content) => /\{\s*validators\s*:/.test(content)
      },
      {
        text: 'Validator uses control.get() to compare sibling controls',
        check: (_, files) => {
          const v = files['password-match.validator.ts'] || '';
          return /\.get\(\s*['"]newPassword/.test(v) && /\.get\(\s*['"]confirmPassword/.test(v);
        }
      },
      {
        text: 'Returns { passwordMismatch: true } or null',
        check: (_, files) => /passwordMismatch:\s*true/.test(files['password-match.validator.ts'] || '')
      },
      {
        text: 'Template checks group-level hasError or form.errors for passwordMismatch',
        check: (content) => /form\.hasError\(\s*['"]passwordMismatch/.test(content) || /form\.errors\?\.\[['"]passwordMismatch/.test(content)
      },
      {
        text: 'Uses typed forms (nonNullable, not UntypedFormGroup)',
        check: (content) => /nonNullable|NonNullableFormBuilder|FormControl<string>/.test(content) && !/UntypedForm/.test(content)
      }
    ]
  },
  'requiredif-validator-directive': {
    files: ['required-if.directive.ts', 'contact-form.component.ts'],
    assertions: [
      {
        text: 'Directive implements Validator interface',
        check: (_, files) => /implements.*Validator/.test(files['required-if.directive.ts'] || '')
      },
      {
        text: 'Registered with NG_VALIDATORS using useExisting + forwardRef + multi',
        check: (_, files) => {
          const d = files['required-if.directive.ts'] || '';
          return /NG_VALIDATORS/.test(d) && /forwardRef/.test(d) && /multi:\s*true/.test(d);
        }
      },
      {
        text: 'Has boolean condition input',
        check: (_, files) => {
          const d = files['required-if.directive.ts'] || '';
          return /input[.(].*boolean|@Input.*appRequiredIf|input\.required<boolean>/.test(d);
        }
      },
      {
        text: 'validate() returns error when condition true and value empty',
        check: (_, files) => {
          const d = files['required-if.directive.ts'] || '';
          return /requiredIf:\s*true|required:\s*true/.test(d);
        }
      },
      {
        text: 'validate() returns null when condition false',
        check: (_, files) => {
          const d = files['required-if.directive.ts'] || '';
          return /return\s+null/.test(d);
        }
      },
      {
        text: 'Template shows usage with ngModel, name, and error display',
        check: (_, files) => {
          const t = files['contact-form.component.ts'] || '';
          return /ngModel/.test(t) && /name=/.test(t) && /appRequiredIf/.test(t);
        }
      }
    ]
  }
};

const results = [];

for (const [evalName, evalDef] of Object.entries(evals)) {
  // Find all run directories for this eval
  const dirs = readdirSync(BASE).filter(d => d.startsWith(evalName + '-run'));

  for (const dir of dirs) {
    const runMatch = dir.match(/run(\d+)/);
    const runNum = runMatch ? parseInt(runMatch[1]) : 1;

    for (const config of ['with_skill', 'without_skill']) {
      const outputDir = join(BASE, dir, config, 'outputs');

      if (!existsSync(outputDir)) {
        continue;
      }

      // Read all output files
      const files = {};
      let allContent = '';

      for (const fname of evalDef.files) {
        const fpath = join(outputDir, fname);

        if (existsSync(fpath)) {
          const content = readFileSync(fpath, 'utf-8');
          files[fname] = content;
          allContent += content + '\n';
        }
      }

      if (!allContent.trim()) {
        continue;
      }

      // Grade assertions
      const expectations = evalDef.assertions.map(a => {
        const passed = a.check(allContent, files);

        return {
          text: a.text,
          passed,
          evidence: passed ? 'Pattern matched in output' : 'Pattern not found in output'
        };
      });

      const passedCount = expectations.filter(e => e.passed).length;
      const total = expectations.length;

      const grading = {
        expectations,
        summary: {
          passed: passedCount,
          failed: total - passedCount,
          total,
          pass_rate: parseFloat((passedCount / total).toFixed(2))
        }
      };

      // Write grading.json
      const gradingPath = join(BASE, dir, config, 'grading.json');
      writeFileSync(gradingPath, JSON.stringify(grading, null, 2));

      // Read timing
      const timingPath = join(BASE, dir, config, 'timing.json');
      let tokens = 0;
      let timeSec = 0;

      if (existsSync(timingPath)) {
        const timing = JSON.parse(readFileSync(timingPath, 'utf-8'));
        tokens = timing.total_tokens || 0;
        timeSec = timing.total_duration_seconds || 0;
      }

      results.push({
        eval_name: evalName,
        run_number: runNum,
        configuration: config,
        pass_rate: grading.summary.pass_rate,
        passed: passedCount,
        failed: total - passedCount,
        total,
        tokens,
        time_seconds: timeSec,
        expectations
      });
    }
  }
}

// Compute summary stats
function stats(arr) {
  const n = arr.length;

  if (n === 0) {
    return { mean: 0, stddev: 0, min: 0, max: 0 };
  }

  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const stddev = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / n);

  return {
    mean: parseFloat(mean.toFixed(2)),
    stddev: parseFloat(stddev.toFixed(2)),
    min: parseFloat(Math.min(...arr).toFixed(2)),
    max: parseFloat(Math.max(...arr).toFixed(2))
  };
}

const wsRuns = results.filter(r => r.configuration === 'with_skill');
const nsRuns = results.filter(r => r.configuration === 'without_skill');

const benchmark = {
  metadata: {
    skill_name: 'angular-developer',
    skill_path: 'D:\\projects\\github\\LayZeeDK\\in-browser-ai-coding-agent\\.claude\\skills\\angular-developer',
    executor_model: 'claude-sonnet-4-6',
    analyzer_model: 'claude-opus-4-6',
    timestamp: new Date().toISOString(),
    evals_run: ['typed-registration-form', 'cross-field-password-validation', 'requiredif-validator-directive'],
    runs_per_configuration: 10
  },
  runs: results.map(r => ({
    eval_id: r.eval_name === 'typed-registration-form' ? 1 : r.eval_name === 'cross-field-password-validation' ? 2 : 3,
    eval_name: r.eval_name,
    configuration: r.configuration,
    run_number: r.run_number,
    result: {
      pass_rate: r.pass_rate,
      passed: r.passed,
      failed: r.failed,
      total: r.total,
      time_seconds: r.time_seconds,
      tokens: r.tokens,
      tool_calls: 0,
      errors: 0
    },
    expectations: r.expectations
  })),
  run_summary: {
    with_skill: {
      pass_rate: stats(wsRuns.map(r => r.pass_rate)),
      time_seconds: stats(wsRuns.map(r => r.time_seconds)),
      tokens: stats(wsRuns.map(r => r.tokens))
    },
    without_skill: {
      pass_rate: stats(nsRuns.map(r => r.pass_rate)),
      time_seconds: stats(nsRuns.map(r => r.time_seconds)),
      tokens: stats(nsRuns.map(r => r.tokens))
    },
    delta: {
      pass_rate: `+${(stats(wsRuns.map(r => r.pass_rate)).mean - stats(nsRuns.map(r => r.pass_rate)).mean).toFixed(2)}`,
      time_seconds: `+${(stats(wsRuns.map(r => r.time_seconds)).mean - stats(nsRuns.map(r => r.time_seconds)).mean).toFixed(1)}`,
      tokens: `+${Math.round(stats(wsRuns.map(r => r.tokens)).mean - stats(nsRuns.map(r => r.tokens)).mean)}`
    }
  },
  notes: []
};

// Per-eval breakdown
for (const evalName of Object.keys(evals)) {
  const wsEval = wsRuns.filter(r => r.eval_name === evalName);
  const nsEval = nsRuns.filter(r => r.eval_name === evalName);
  const wsRate = stats(wsEval.map(r => r.pass_rate));
  const nsRate = stats(nsEval.map(r => r.pass_rate));
  benchmark.notes.push(`${evalName}: with-skill ${wsRate.mean} +/- ${wsRate.stddev} vs without-skill ${nsRate.mean} +/- ${nsRate.stddev} (delta: ${(wsRate.mean - nsRate.mean).toFixed(2)})`);
}

writeFileSync(join(BASE, 'benchmark.json'), JSON.stringify(benchmark, null, 2));

// Print summary
console.log('\n=== BENCHMARK SUMMARY ===');
console.log(`With-skill (${wsRuns.length} runs): pass_rate=${stats(wsRuns.map(r => r.pass_rate)).mean} +/- ${stats(wsRuns.map(r => r.pass_rate)).stddev}`);
console.log(`Without-skill (${nsRuns.length} runs): pass_rate=${stats(nsRuns.map(r => r.pass_rate)).mean} +/- ${stats(nsRuns.map(r => r.pass_rate)).stddev}`);
console.log(`Delta: ${benchmark.run_summary.delta.pass_rate}`);
console.log('\nPer-eval:');

for (const note of benchmark.notes) {
  console.log(`  ${note}`);
}
