-- Players are anonymous: an id, a hashed bearer token and a nickname. No email, no phone.
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- One drill run. The id is a UUID made on the client, so a resend is a no-op.
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  drill_id TEXT NOT NULL,
  content_version TEXT NOT NULL,
  score INTEGER NOT NULL,
  moments_count INTEGER NOT NULL,
  correct_count INTEGER NOT NULL,
  avg_reaction_ms INTEGER,
  scans_total INTEGER NOT NULL,
  device_class TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX runs_player ON runs(player_id, finished_at DESC);

-- One decision inside a run.
CREATE TABLE moments (
  run_id TEXT NOT NULL REFERENCES runs(id),
  idx INTEGER NOT NULL,
  scene_id TEXT NOT NULL,
  skill TEXT NOT NULL,
  choice_kind TEXT NOT NULL,
  choice_id TEXT,
  best_id TEXT NOT NULL,
  grade INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  reaction_ms INTEGER,
  scans INTEGER NOT NULL,
  last_scan_before_arrival_ms INTEGER,
  input_to_frame_ms REAL,
  PRIMARY KEY (run_id, idx)
);

-- Lemon Squeezy subscription state, keyed by their subscription id.
CREATE TABLE subscriptions (
  ls_subscription_id TEXT PRIMARY KEY,
  player_id TEXT REFERENCES players(id),
  status TEXT NOT NULL,
  variant_id TEXT,
  renews_at TEXT,
  ends_at TEXT,
  test_mode INTEGER NOT NULL DEFAULT 0,
  ls_updated_at TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX subscriptions_player ON subscriptions(player_id);

-- Every webhook delivery we accepted, deduplicated by a hash of the raw body.
CREATE TABLE webhook_events (
  dedupe_key TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  ls_object_id TEXT,
  result TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
