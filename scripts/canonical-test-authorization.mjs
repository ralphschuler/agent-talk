import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'ralphschuler/agent-talk';
const OWNER = 'ralphschuler';

function activeRepositoryRuleset(rules, repository) {
  assert.ok(Array.isArray(rules), 'Malformed active rules evidence');
  const groups = new Map();
  for (const rule of rules) {
    if (!rule || rule.ruleset_source_type !== 'Repository' || rule.ruleset_source !== repository || !Number.isInteger(rule.ruleset_id)) continue;
    const group = groups.get(rule.ruleset_id) ?? [];
    group.push(rule);
    groups.set(rule.ruleset_id, group);
  }
  for (const group of groups.values()) {
    const one = type => group.find(rule => rule.type === type);
    const pullRequest = one('pull_request');
    const codeScanning = one('code_scanning');
    const codeQuality = one('code_quality');
    const copilot = one('copilot_code_review');
    if (!one('deletion') || !one('non_fast_forward') || !one('required_linear_history') || !pullRequest || !codeScanning || !codeQuality || !copilot) continue;
    const pull = pullRequest.parameters;
    if (!pull || !Number.isInteger(pull.required_approving_review_count) || pull.required_approving_review_count < 0 || pull.required_review_thread_resolution !== true || !Array.isArray(pull.allowed_merge_methods) || !pull.allowed_merge_methods.includes('squash')) continue;
    const scanners = codeScanning.parameters?.code_scanning_tools;
    if (!Array.isArray(scanners) || !scanners.some(scanner => scanner?.tool === 'CodeQL' && scanner.security_alerts_threshold === 'high_or_higher' && scanner.alerts_threshold === 'errors')) continue;
    if (codeQuality.parameters?.severity !== 'errors' || copilot.parameters?.review_on_push !== true) continue;
    return pull.required_approving_review_count;
  }
  assert.fail('Required active repository ruleset evidence is missing or malformed');
}

export function authorizeCanonicalTest({ repository, ref, sha, event, actor, triggeringActor, rules, pulls, runs }) {
  assert.equal(repository, REPOSITORY, 'Canonical deployment is limited to its repository');
  assert.equal(ref, 'refs/heads/main', 'Canonical deployment requires main');
  assert.match(sha ?? '', /^[a-f0-9]{40}$/i, 'Canonical deployment requires an exact commit SHA');
  assert.equal(event, 'workflow_dispatch', 'Canonical deployment requires manual dispatch');
  assert.equal(actor, OWNER, 'Canonical deployment requires the repository owner to initiate it');
  assert.equal(triggeringActor, OWNER, 'Canonical deployment requires the repository owner to initiate any rerun');

  const approvals = activeRepositoryRuleset(rules, repository);
  assert.ok(Array.isArray(pulls), 'Malformed merged pull request evidence');
  assert.ok(pulls.some(pull => pull && pull.state === 'closed' && typeof pull.merged_at === 'string' && pull.merged_at.length > 0 && pull.merge_commit_sha === sha && pull.base?.ref === 'main'), 'Exact main SHA is not associated with a merged pull request');
  assert.ok(Array.isArray(runs), 'Malformed Verify run evidence');
  assert.ok(runs.some(run => run && run.workflowName === 'Verify' && run.headSha === sha && run.status === 'completed' && run.conclusion === 'success'), 'Exact successful Verify run is required');
  return {
    authorized: true,
    reason: 'owner-authorized-active-rules-and-verify',
    reviewRequirement: approvals === 0 ? 'not-required-by-active-rules' : `${approvals}-approval-active-rules`
  };
}

async function run(paths, env = process.env) {
  assert.equal(paths.length, 3, 'Expected rules, pull-request, and workflow-run evidence paths');
  const evidence = await Promise.all(paths.map(async path => JSON.parse(await readFile(path, 'utf8'))));
  const result = authorizeCanonicalTest({
    repository: env.GITHUB_REPOSITORY,
    ref: env.GITHUB_REF,
    sha: env.GITHUB_SHA,
    event: env.GITHUB_EVENT_NAME,
    actor: env.GITHUB_ACTOR,
    triggeringActor: env.GITHUB_TRIGGERING_ACTOR,
    rules: evidence[0],
    pulls: evidence[1],
    runs: evidence[2]
  });
  console.log(`Canonical test authorization passed (${result.reason}; ${result.reviewRequirement}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run(process.argv.slice(2));
