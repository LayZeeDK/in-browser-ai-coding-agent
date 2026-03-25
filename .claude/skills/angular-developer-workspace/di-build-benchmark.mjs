// Build benchmark.json from grading results
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const BASE = 'angular-developer-workspace/di-iteration-2';
const evalNames = {
  'destroyref-takeuntildestroyed': 'DestroyRef + takeUntilDestroyed',
  'viewproviders-content-projection': 'viewProviders + Content Projection',
  'app-initializer-env-initializer': 'App + Environment Initializers'
};

const runs = [];
const configStats = { with_skill: [], without_skill: [] };

for (let run = 1; run <= 10; run++) {
  for (const [evalDir, evalName] of Object.entries(evalNames)) {
    for (const config of ['with_skill', 'without_skill']) {
      const gradingPath = join(BASE, `run-${run}`, evalDir, config, 'grading.json');

      if (!existsSync(gradingPath)) continue;

      const grading = JSON.parse(readFileSync(gradingPath, 'utf8'));
      const runEntry = {
        eval_id: Object.keys(evalNames).indexOf(evalDir) + 1,
        eval_name: evalName,
        configuration: config,
        run_number: run,
        result: {
          pass_rate: grading.summary.pass_rate,
          passed: grading.summary.passed,
          failed: grading.summary.failed,
          total: grading.summary.total,
          time_seconds: 0,
          tokens: 0,
          tool_calls: 0,
          errors: 0
        },
        expectations: grading.expectations
      };
      runs.push(runEntry);
      configStats[config].push(grading.summary.pass_rate);
    }
  }
}

function stats(arr) {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const stddev = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
  return { mean: +mean.toFixed(3), stddev: +stddev.toFixed(3), min: +Math.min(...arr).toFixed(2), max: +Math.max(...arr).toFixed(2) };
}

const wsStats = stats(configStats.with_skill);
const woStats = stats(configStats.without_skill);

const benchmark = {
  metadata: {
    skill_name: 'angular-developer',
    skill_path: '.claude/skills/angular-developer/',
    executor_model: 'claude-sonnet-4-6',
    analyzer_model: 'claude-opus-4-6',
    timestamp: new Date().toISOString(),
    evals_run: [1, 2, 3],
    runs_per_configuration: 10
  },
  runs,
  run_summary: {
    with_skill: {
      pass_rate: wsStats,
      time_seconds: { mean: 0, stddev: 0, min: 0, max: 0 },
      tokens: { mean: 0, stddev: 0, min: 0, max: 0 }
    },
    without_skill: {
      pass_rate: woStats,
      time_seconds: { mean: 0, stddev: 0, min: 0, max: 0 },
      tokens: { mean: 0, stddev: 0, min: 0, max: 0 }
    },
    delta: {
      pass_rate: `${(wsStats.mean - woStats.mean > 0 ? '+' : '')}${(wsStats.mean - woStats.mean).toFixed(3)}`,
      time_seconds: '+0',
      tokens: '+0'
    }
  },
  notes: [
    `Eval 3 (Initializers): with_skill uses provideAppInitializer 100% vs without_skill 30% (+70pp lift)`,
    `Eval 3 (Initializers): with_skill uses provideEnvironmentInitializer 90% vs without_skill 10% (+80pp lift) - strongest skill effect`,
    `Eval 3 (Initializers): makeEnvironmentProviders is 0% with_skill vs 90% without_skill - the skill reference documents it but agents stop reading before reaching the library pattern section`,
    `Eval 2 (viewProviders): with_skill achieves 100% (0% variance) vs without_skill 96.7% (6.7% variance) - skill eliminates all failures`,
    `Eval 2 (viewProviders): optional injection pattern passes 100% with_skill vs 80% without_skill - skill's example explicitly shows { optional: true }`,
    `Eval 1 (DestroyRef): with_skill 88.3% vs without_skill 90.0% - slight regression because skill documents both DestroyRef.onDestroy() and takeUntilDestroyed(), causing agents to redundantly use both`,
    `Eval 1 (DestroyRef): 'Does not implement OnDestroy' passes 100% with_skill vs 60% without_skill - skill prevents the deprecated pattern`,
    `Overall: with_skill 88.9% mean vs without_skill 85.6% mean (+3.3pp) but massive divergence per eval — the skill's main value is steering toward modern APIs (provideAppInitializer, provideEnvironmentInitializer)`
  ]
};

writeFileSync(join(BASE, 'benchmark.json'), JSON.stringify(benchmark, null, 2));
console.log('Wrote benchmark.json');
console.log(`with_skill: ${(wsStats.mean * 100).toFixed(1)}% +/- ${(wsStats.stddev * 100).toFixed(1)}%`);
console.log(`without_skill: ${(woStats.mean * 100).toFixed(1)}% +/- ${(woStats.stddev * 100).toFixed(1)}%`);
console.log(`delta: ${benchmark.run_summary.delta.pass_rate}`);
