import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initAuthTransactions, saveAuthTransaction, consumeAuthTransaction } from '../../src/auth-transaction.ts';
import { beginAuthorization, exchangeAuthorization } from '../../src/github-oauth.ts';

test('typed transactions are browser-bound, expire and can only be consumed once', () => {
  const db = new DatabaseSync(':memory:');
  const store = { sql: { exec(query, ...params) { if (/^(SELECT)/i.test(query.trim())) return { toArray: () => db.prepare(query).all(...params) }; db.prepare(query).run(...params); return { toArray: () => [] }; } }, transactionSync(fn) { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
  initAuthTransactions(store);
  const a = 'A'.repeat(43), b = 'B'.repeat(43), c = 'C'.repeat(43), d = 'D'.repeat(43);
  assert.equal(saveAuthTransaction(store, {stateHash:a,browserHash:b,verifier:c,expires:1001,flow:'dashboard'}, 1), true);
  assert.equal(saveAuthTransaction(store, {stateHash:d,browserHash:b,verifier:c,expires:1001,flow:'mcp'}, 1), true);
  assert.equal(consumeAuthTransaction(store, a, c, 5), null);
  assert.equal(consumeAuthTransaction(store, a, b, 5).flow, 'dashboard');
  assert.equal(consumeAuthTransaction(store, a, b, 5), null);
  assert.equal(consumeAuthTransaction(store, d, b, 5).flow, 'mcp');
  assert.equal(saveAuthTransaction(store, {stateHash:a,browserHash:b,verifier:c,expires:10,flow:'mcp'}, 1), true);
  assert.equal(consumeAuthTransaction(store, a, b, 10), null);
});
test('GitHub authorization uses S256 and fixed callback and exchanges only with matching state', async () => {
  const config = {clientId:'synthetic',clientSecret:'synthetic',callback:'https://agent-talk-test.nyphon.de/auth/callback'};
  const {transaction,url} = await beginAuthorization(config, 100);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(transaction.verifier));
  assert.equal(parsed.searchParams.get('code_challenge'), Buffer.from(digest).toString('base64url'));
  await assert.rejects(exchangeAuthorization(config, transaction, transaction.state, 'code', async () => { throw new Error('expired transaction exchanged'); }, transaction.expiresAt));
  assert.equal(parsed.searchParams.get('redirect_uri'), config.callback);
  await assert.rejects(exchangeAuthorization(config, transaction, 'wrong', 'code', async () => { throw new Error('must not exchange'); }, 101));
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    if (calls === 1) { const body = JSON.parse(options.body); assert.equal(body.code_verifier, transaction.verifier); assert.equal(body.redirect_uri, config.callback); return Response.json({access_token:'synthetic',scope:''}); }
    return Response.json({id:123});
  };
  assert.equal(await exchangeAuthorization(config, transaction, transaction.state, 'code', fetcher, 101), '123');
  assert.equal(calls, 2);
});
