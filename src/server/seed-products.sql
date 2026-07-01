-- Tampa Kitchen Cabinets (brand_id 2) product catalog seed data.
-- Run once after migrations: pnpm db:seed-products:local / pnpm db:seed-products:remote
--
-- Uses INSERT OR IGNORE with explicit ids so it's idempotent and safe to run
-- against a live dev DB, same convention as seed-brands.sql -- this only
-- ADDS new rows, it never deletes/updates existing ones. Assumes
-- seed-brands.sql has already been run (brand_id 2 = Tampa Kitchen Cabinets).

-- ── Door styles ──────────────────────────────────────────────────────

INSERT OR IGNORE INTO products (id, brand_id, name, sku, category, unit_cost, unit, active)
VALUES
  (1, 2, 'Shaker Door - Painted White',       'TKC-DOOR-SHK-WHT', 'door style', 42.00,  'ea', 1),
  (2, 2, 'Shaker Door - Stained Maple',       'TKC-DOOR-SHK-MPL', 'door style', 48.00,  'ea', 1),
  (3, 2, 'Raised Panel Door - Cherry',        'TKC-DOOR-RSP-CHY', 'door style', 65.00,  'ea', 1),
  (4, 2, 'Slab Door - Matte Gray',            'TKC-DOOR-SLB-GRY', 'door style', 55.00,  'ea', 1),
  (5, 2, 'Beadboard Door - Antique White',    'TKC-DOOR-BDB-AWH', 'door style', 58.00,  'ea', 1);

-- ── Hardware ─────────────────────────────────────────────────────────

INSERT OR IGNORE INTO products (id, brand_id, name, sku, category, unit_cost, unit, active)
VALUES
  (6,  2, 'Brushed Nickel Bar Pull - 5in',    'TKC-HW-PULL-BN5',  'hardware', 4.50,  'ea', 1),
  (7,  2, 'Matte Black Bar Pull - 6in',       'TKC-HW-PULL-MB6',  'hardware', 5.25,  'ea', 1),
  (8,  2, 'Brass Knob - Round',               'TKC-HW-KNOB-BRS',  'hardware', 3.75,  'ea', 1),
  (9,  2, 'Soft-Close Hinge (pair)',          'TKC-HW-HNG-SC',    'hardware', 8.00,  'pair', 1),
  (10, 2, 'Soft-Close Drawer Slide (pair)',   'TKC-HW-SLD-SC',    'hardware', 22.00, 'pair', 1);

-- ── Countertops ──────────────────────────────────────────────────────

INSERT OR IGNORE INTO products (id, brand_id, name, sku, category, unit_cost, unit, active)
VALUES
  (11, 2, 'Quartz Countertop - Calacatta',        'TKC-CTOP-QTZ-CAL', 'countertop', 78.00,  'sqft', 1),
  (12, 2, 'Granite Countertop - Absolute Black',   'TKC-CTOP-GRN-BLK', 'countertop', 65.00,  'sqft', 1),
  (13, 2, 'Butcher Block Countertop - Maple',      'TKC-CTOP-BUT-MPL', 'countertop', 45.00,  'sqft', 1),
  (14, 2, 'Laminate Countertop - Standard',        'TKC-CTOP-LAM-STD', 'countertop', 22.00,  'sqft', 1);
