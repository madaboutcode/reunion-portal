CREATE TABLE refunds (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id  INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  source_payment_id INTEGER NOT NULL REFERENCES payments(id),
  amount           INTEGER NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  bank_reference   TEXT,
  resolved_by      TEXT,
  resolved_at      INTEGER,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_refund_registration ON refunds(registration_id);
CREATE INDEX idx_refund_status ON refunds(status);
