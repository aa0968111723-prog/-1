#!/usr/bin/env node
/**
 * Workflow sanity: every .github/workflows/*.yml must parse, and every `run:`
 * block must be syntactically valid shell.
 *
 * Written after breaking release-android.yml by embedding a heredoc whose body
 * sat at column 0 inside a YAML block scalar — an unindented line terminates
 * the block, and the entire workflow became unparseable. Nothing caught it
 * except running a parser by hand, and a broken release workflow is only
 * discovered when you try to release.
 */
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = '.github/workflows';
const errors = [];
const tmp = mkdtempSync(join(tmpdir(), 'wf-'));

/** Minimal YAML structure probe: we only need the run blocks, not full fidelity. */
function parseYaml(text, file) {
  try {
    // js-yaml is not a dependency; python3 is always present on the runner and
    // locally, and this only has to answer "does it parse, and what are the
    // run blocks".
    const out = execFileSync('python3', ['-c', `
import sys, yaml, json
d = yaml.safe_load(open(sys.argv[1]))
runs = []
for job in (d.get('jobs') or {}).values():
    for step in (job.get('steps') or []):
        if isinstance(step, dict) and step.get('run'):
            runs.append({'name': step.get('name') or '(unnamed)', 'run': step['run']})
print(json.dumps({'runs': runs}))
`, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(out);
  } catch (e) {
    errors.push(`${file}: does not parse as YAML\n    ${String(e.stderr || e.message).trim().split('\n').pop()}`);
    return null;
  }
}

const files = readdirSync(DIR).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
if (files.length === 0) errors.push(`${DIR} contains no workflows`);

for (const f of files) {
  const path = join(DIR, f);
  readFileSync(path, 'utf8'); // surface an unreadable file early
  const parsed = parseYaml(null, path);
  if (!parsed) continue;
  for (const step of parsed.runs) {
    const sh = join(tmp, 'step.sh');
    writeFileSync(sh, step.run);
    try {
      execFileSync('bash', ['-n', sh], { stdio: 'pipe' });
    } catch (e) {
      errors.push(`${f} → step "${step.name}": shell syntax error\n    ${String(e.stderr).trim().split('\n')[0]}`);
    }
  }
}

if (errors.length > 0) {
  console.error('Workflow checks failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`workflows OK: ${files.length} file(s), all run blocks parse as shell`);
