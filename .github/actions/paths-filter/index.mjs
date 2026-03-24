import * as core from '@actions/core';
import { getExecOutput } from '@actions/exec';

/**
 * Parse a YAML-like filters string into a map of filter names to path patterns.
 *
 * Format:
 *   filterName:
 *     - 'pattern'
 *     - '!exclusion'
 */
function parseFilters(input) {
  const filters = new Map();
  let currentFilter = null;

  for (const line of input.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    // Filter name line (e.g., "code:")
    const nameMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*$/);

    if (nameMatch) {
      currentFilter = nameMatch[1];
      filters.set(currentFilter, []);
      continue;
    }

    // Pattern line (e.g., "- '!.planning/**'")
    const patternMatch = trimmed.match(/^-\s+['"]?(!?)([^'"]+)['"]?\s*$/);

    if (patternMatch && currentFilter) {
      const negate = patternMatch[1];
      const pattern = patternMatch[2];
      filters.get(currentFilter).push({ negate: negate === '!', pattern });
    }
  }

  return filters;
}

/**
 * Build git pathspec arguments from parsed filter patterns.
 */
function buildPathspecs(patterns) {
  const pathspecs = [];
  let hasIncludes = false;

  for (const { negate, pattern } of patterns) {
    if (negate) {
      pathspecs.push(`:!${pattern}`);
    } else {
      hasIncludes = true;
      pathspecs.push(pattern);
    }
  }

  // If only exclusions, prepend '.' to match everything then exclude
  if (!hasIncludes) {
    pathspecs.unshift('.');
  }

  return pathspecs;
}

async function run() {
  const base = core.getInput('base', { required: true });
  const head = core.getInput('head') || 'HEAD';
  const filtersInput = core.getInput('filters', { required: true });

  const filters = parseFilters(filtersInput);
  const result = {};

  for (const [name, patterns] of filters) {
    const pathspecs = buildPathspecs(patterns);
    const args = ['diff', '--name-only', base, head, '--', ...pathspecs];

    const output = await getExecOutput('git', args, {
      silent: true,
      ignoreReturnCode: true,
    });

    const changed = output.stdout.trim().length > 0;
    result[name] = changed;
    core.info(`Filter '${name}': ${changed}`);
  }

  core.setOutput('changes', JSON.stringify(result));
}

run().catch((error) => {
  core.setFailed(error.message);
});
