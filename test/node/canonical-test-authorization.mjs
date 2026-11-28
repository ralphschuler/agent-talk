import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeCanonicalTest } from '../../scripts/canonical-test-authorization.mjs';

const repository = 'ralphschuler/agent-talk';
const sha = 'a'.repeat(40);
const rules = [
  {type:'deletion',ruleset_source_type:'Repository',ruleset_source:repository,ruleset_id:28248984},
  {type:'non_fast_forward',ruleset_source_type:'Repository',ruleset_source:repository,ruleset_id:28248984},
  {type:'required_linear_history',ruleset_source_type:'Repository',ruleset_source:repository,ruleset_id:28248984},
  {type:'pull_request',ruleset_source_type:'Repository',ruleset_source:repository,ruleset_id:28248984,parameters:{required_approving_review_count:0,required_review_thread_resolution:true,allowed_merge_methods:['squash']}},
  {type:'code_scanning',ruleset_source_type:'Repository',ruleset_source:repository,ruleset_id:28248984,parameters:{code_scanning_tools:[{tool:'CodeQL',security_alerts_threshold:'high_or_higher',alerts_threshold:'errors'}]}},
  {type:'code_quality',ruleset_source_type:'Repository',ruleset_source:repository,ruleset_id:28248984,parameters:{severity:'errors'}},
  {type:'copilot_code_review',ruleset_source_type:'Repository',ruleset_source:repository,ruleset_id:28248984,parameters:{review_on_push:true}}
];
const pulls = [{number:2,state:'closed',merged_at:'2026-11-27T19:01:51Z',merge_commit_sha:sha,base:{ref:'main'}}];
const currentMain = {sha};
const runs = [{workflowName:'Verify',event:'push',headBranch:'main',headSha:sha,status:'completed',conclusion:'success'}];
const input = {repository,ref:'refs/heads/main',sha,event:'workflow_dispatch',actor:'ralphschuler',triggeringActor:'ralphschuler',currentMain,rules,pulls,runs};

test('authorizes the owner-initiated test release under the active repository rules and exact Verify evidence', () => {
  assert.deepEqual(authorizeCanonicalTest(input), {authorized:true,reason:'owner-authorized-active-rules-and-verify',reviewRequirement:'not-required-by-active-rules'});
});

test('fails closed for stale main, non-owner or rerun actor, malformed rule evidence, unrelated merged PR, and absent Verify', () => {
  assert.throws(() => authorizeCanonicalTest({...input,currentMain:{sha:'b'.repeat(40)}}), /current main/i);
  assert.throws(() => authorizeCanonicalTest({...input,actor:'other'}), /owner/i);
  assert.throws(() => authorizeCanonicalTest({...input,triggeringActor:'other'}), /owner/i);
  assert.throws(() => authorizeCanonicalTest({...input,rules:rules.filter(rule => rule.type !== 'pull_request')}), /ruleset/i);
  assert.throws(() => authorizeCanonicalTest({...input,pulls:[{...pulls[0],merge_commit_sha:'b'.repeat(40)}]}), /merged pull request/i);
  assert.throws(() => authorizeCanonicalTest({...input,runs:[{...runs[0],conclusion:'failure'}]}), /Verify/i);
  assert.throws(() => authorizeCanonicalTest({...input,runs:[{...runs[0],event:'pull_request'}]}), /Verify/i);
});

test('does not treat zero required approvals as independent review evidence', () => {
  const result = authorizeCanonicalTest(input);
  assert.equal(result.reviewRequirement, 'not-required-by-active-rules');
});
