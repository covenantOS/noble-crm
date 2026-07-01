-- Seed data for the Westchase Painting field service app.
-- Run once after migrations: pnpm db:seed:local / pnpm db:seed:remote
-- Then seed the brand + painting service catalog: pnpm db:seed-brands:local
--
-- USERS ARE NOT SEEDED HERE. Auth users are created through better-auth, not
-- raw SQL. The flow (see scripts/seed-users.sh):
--   1. The FIRST public sign-up bootstraps the system and is auto-promoted to
--      "admin" (this is the owner -- Will). Public sign-up is then closed:
--      once any user exists, POST /api/auth/sign-up/email returns 403.
--   2. Every subsequent user (Leo=office, Regi=technician, Rubem=estimator) is
--      created by the admin via POST /api/users, which sets their role. There
--      is no open self-registration.
--   A brand-new account that somehow reaches signup defaults to the powerless
--   "pending" role (no access to anything) until an admin grants a real role.

-- ── Counters (job/invoice/estimate identifier sequences) ────────────
INSERT OR IGNORE INTO _meta (key, value) VALUES ('job_counter', '0');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('identifier_prefix', 'JOB');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('invoice_counter', '0');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('invoice_prefix', 'INV');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('estimate_counter', '0');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('estimate_prefix', 'EST');

-- ── Service types ───────────────────────────────────────────────────
-- The real painting/cabinet service catalog is seeded per-brand in
-- seed-brands.sql (ids 7-15). No generic service_types are seeded here -- the
-- old HVAC/generic placeholder rows (Standard Service, Inspection, Emergency,
-- Follow-up, Installation, Maintenance) have been removed as they don't
-- reflect this business.

-- ── Materials (real painting materials) ─────────────────────────────
-- Realistic painting materials within the current materials schema
-- (name/unit/unit_cost/in_stock). A richer paint-spec model (brand/color/
-- sheen) is a later chunk -- no extra columns here. Costs are typical retail
-- ballparks; the office can adjust in-app.
-- unit_cost is INTEGER CENTS (see the cents-migration note in
-- src/db/schema.ts) -- e.g. $38.00 is stored as 3800. in_stock is a
-- quantity, not money, and stays as-is.
INSERT OR IGNORE INTO materials (id, name, unit, unit_cost, in_stock)
VALUES
  (1,  'Interior Paint',   'gal',   3800, 40),
  (2,  'Exterior Paint',   'gal',   4500, 40),
  (3,  'Primer',           'gal',   2800, 30),
  (4,  'Ceiling Paint',    'gal',   3200, 20),
  (5,  'Painter''s Tape',  'roll',   600, 60),
  (6,  'Drop Cloth',       'ea',    1400, 25),
  (7,  'Caulk',            'tube',   500, 80),
  (8,  'Spackle',          'tub',   1200, 25),
  (9,  'Sandpaper',        'pack',   900, 40),
  (10, 'Roller Cover',     'ea',     700, 100),
  (11, 'Brush',            'ea',    1100, 60),
  (12, 'Plastic Sheeting', 'roll',  1800, 30);
