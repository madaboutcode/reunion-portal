-- Bank statement import: transactions + M:M link to payments

CREATE TABLE bank_transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_hash        TEXT    NOT NULL UNIQUE,
  txn_date        TEXT    NOT NULL,
  txn_date_iso    TEXT    NOT NULL,
  value_date      TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  ref_no          TEXT,
  branch_code     TEXT,
  debit_paise     INTEGER NOT NULL DEFAULT 0,
  credit_paise    INTEGER NOT NULL DEFAULT 0,
  balance_paise   INTEGER NOT NULL DEFAULT 0,
  txn_type        TEXT    NOT NULL CHECK (txn_type IN ('credit', 'debit')),
  comment         TEXT,
  import_batch    TEXT    NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_btxn_date ON bank_transactions(txn_date_iso);
CREATE INDEX idx_btxn_type ON bank_transactions(txn_type);
CREATE INDEX idx_btxn_batch ON bank_transactions(import_batch);

CREATE TABLE bank_transaction_payments (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_transaction_id   INTEGER NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  payment_id            INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(bank_transaction_id, payment_id)
);

CREATE INDEX idx_btp_txn ON bank_transaction_payments(bank_transaction_id);
CREATE INDEX idx_btp_payment ON bank_transaction_payments(payment_id);
