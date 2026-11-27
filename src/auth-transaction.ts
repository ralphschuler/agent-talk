/** Typed upstream OAuth transactions. Values are created by the server, never from a callback URL. */
export type AuthFlow = "dashboard" | "mcp";
export interface Transaction { stateHash: string; browserHash: string; verifier: string; expires: number; flow: AuthFlow; }
export interface AuthTransactionStorage {
  transactionSync<T>(callback: () => T): T;
  sql: { exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(query: string, ...bindings: (string | number)[]): { toArray(): T[] } };
}

export function initAuthTransactions(storage: AuthTransactionStorage): void {
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS shared_oauth_transactions (
    state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, verifier TEXT NOT NULL,
    expires INTEGER NOT NULL, flow TEXT NOT NULL CHECK(flow IN ('dashboard','mcp'))
  )`);
}

export function saveAuthTransaction(storage: AuthTransactionStorage, transaction: Transaction, now: number): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(transaction.stateHash) || !/^[A-Za-z0-9_-]{43}$/.test(transaction.browserHash) ||
      !/^[A-Za-z0-9_-]{43}$/.test(transaction.verifier) || !Number.isSafeInteger(transaction.expires) ||
      transaction.expires <= now || transaction.expires > now + 300_000 || !["dashboard", "mcp"].includes(transaction.flow)) return false;
  return storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM shared_oauth_transactions WHERE expires <= ?", now);
    const count = storage.sql.exec<{ total: number }>("SELECT COUNT(*) AS total FROM shared_oauth_transactions").toArray()[0].total;
    if (count >= 1024) return false;
    storage.sql.exec("INSERT INTO shared_oauth_transactions VALUES (?, ?, ?, ?, ?)", transaction.stateHash, transaction.browserHash, transaction.verifier, transaction.expires, transaction.flow);
    return true;
  });
}

/** Consume atomically before code exchange; callbacks cannot select or modify the flow. */
export function consumeAuthTransaction(storage: AuthTransactionStorage, stateHash: string, browserHash: string, now: number): Transaction | null {
  return storage.transactionSync(() => {
    const row = storage.sql.exec<{ state_hash: string; browser_hash: string; verifier: string; expires: number; flow: AuthFlow }>(
      "SELECT state_hash, browser_hash, verifier, expires, flow FROM shared_oauth_transactions WHERE state_hash = ? AND browser_hash = ? AND expires > ?", stateHash, browserHash, now).toArray()[0];
    if (!row || (row.flow !== "dashboard" && row.flow !== "mcp")) return null;
    storage.sql.exec("DELETE FROM shared_oauth_transactions WHERE state_hash = ?", stateHash);
    return { stateHash: row.state_hash, browserHash: row.browser_hash, verifier: row.verifier, expires: row.expires, flow: row.flow };
  });
}
