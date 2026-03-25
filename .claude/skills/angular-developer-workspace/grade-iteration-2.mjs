import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ITERATION_DIR = join(__dirname, 'iteration-2');
const META = JSON.parse(readFileSync(join(ITERATION_DIR, 'eval_metadata_all.json'), 'utf-8'));

const results = {};
let totalPassed = 0;
let totalAssertions = 0;
let withSkillPassed = 0;
let withoutSkillPassed = 0;
let withSkillTotal = 0;
let withoutSkillTotal = 0;

for (const [evalName, meta] of Object.entries(META)) {
  results[evalName] = {};

  for (const config of ['with_skill', 'without_skill']) {
    const outputDir = join(ITERATION_DIR, evalName, config, 'outputs');

    if (!existsSync(outputDir)) {
      results[evalName][config] = { error: 'Output directory not found' };
      continue;
    }

    const files = readdirSync(outputDir).filter(f => f.endsWith('.ts'));

    if (files.length === 0) {
      results[evalName][config] = { error: 'No output files found' };
      continue;
    }

    const content = files.map(f => readFileSync(join(outputDir, f), 'utf-8')).join('\n');
    const evalResults = {};
    let passed = 0;
    let total = 0;

    for (const assertion of meta.assertions) {
      total++;
      totalAssertions++;

      if (config === 'with_skill') {
        withSkillTotal++;
      } else {
        withoutSkillTotal++;
      }

      let assertionPassed = false;

      if (assertion.antiPattern) {
        const regex = new RegExp(assertion.antiPattern);
        assertionPassed = !regex.test(content);
      } else {
        const regex = new RegExp(assertion.pattern, assertion.pattern.includes('(?i)') ? 'is' : 's');
        assertionPassed = regex.test(content);
      }

      if (assertionPassed) {
        passed++;
        totalPassed++;

        if (config === 'with_skill') {
          withSkillPassed++;
        } else {
          withoutSkillPassed++;
        }
      }

      evalResults[assertion.name] = {
        passed: assertionPassed,
        description: assertion.description,
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

console.log('\n=== ITERATION 2: PROBLEM-ORIENTED EVALS ===\n');
console.log(`Total: ${totalPassed}/${totalAssertions} assertions passed`);
console.log(`  with_skill:    ${withSkillPassed}/${withSkillTotal} (${(withSkillPassed/withSkillTotal*100).toFixed(1)}%)`);
console.log(`  without_skill: ${withoutSkillPassed}/${withoutSkillTotal} (${(withoutSkillPassed/withoutSkillTotal*100).toFixed(1)}%)`);
console.log('');

for (const [evalName, configs] of Object.entries(results)) {
  const ws = configs.with_skill;
  const wos = configs.without_skill;

  if (ws?.error || wos?.error) {
    console.log(`${evalName}: ERROR - ${ws?.error || wos?.error}`);
    continue;
  }

  const wsRate = ws ? `${ws.passed}/${ws.total}` : 'N/A';
  const wosRate = wos ? `${wos.passed}/${wos.total}` : 'N/A';
  const delta = (ws && wos) ? (ws.passed - wos.passed) : 0;
  const deltaStr = delta > 0 ? ` (+${delta})` : delta < 0 ? ` (${delta})` : ' (=)';

  console.log(`${evalName}: with_skill=${wsRate} | without_skill=${wosRate}${deltaStr}`);

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

writeFileSync(
  join(ITERATION_DIR, 'programmatic-grading.json'),
  JSON.stringify({ totalPassed, totalAssertions, withSkillPassed, withSkillTotal, withoutSkillPassed, withoutSkillTotal, results }, null, 2)
);

console.log(`\nFull results: iteration-2/programmatic-grading.json`);
