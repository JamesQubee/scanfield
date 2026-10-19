-- A simulated checkout, used only when DEMO_MODE = "1". Completing it sends a signed
-- test-mode subscription_created event through the real webhook handler.
CREATE TABLE checkout_sessions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX checkout_sessions_player ON checkout_sessions(player_id);
