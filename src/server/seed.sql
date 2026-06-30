-- Seed data, ported from the original src/server/schema.sql.
-- Run once after migrations: pnpm db:seed:local / pnpm db:seed:remote

INSERT OR IGNORE INTO _meta (key, value) VALUES ('job_counter', '0');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('identifier_prefix', 'JOB');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('invoice_counter', '0');
INSERT OR IGNORE INTO _meta (key, value) VALUES ('invoice_prefix', 'INV');

INSERT OR IGNORE INTO service_types (id, name, description, default_duration, default_price, color)
VALUES
  (1, 'Standard Service', 'Standard service visit', 60, 150, '#16a34a'),
  (2, 'Inspection', 'On-site inspection and assessment', 45, 75, '#0891b2'),
  (3, 'Emergency', 'Urgent same-day service call', 90, 300, '#dc2626'),
  (4, 'Follow-up', 'Follow-up visit after initial service', 30, 50, '#9333ea'),
  (5, 'Installation', 'Equipment or system installation', 120, 400, '#ea580c'),
  (6, 'Maintenance', 'Routine maintenance visit', 60, 125, '#ca8a04');

INSERT OR IGNORE INTO materials (id, name, unit, unit_cost, in_stock)
VALUES
  (1, 'Service Fee', 'ea', 0, 999),
  (2, 'Filter Replacement', 'ea', 25, 50),
  (3, 'Sealant', 'tube', 12, 30),
  (4, 'Travel Surcharge', 'ea', 35, 999),
  (5, 'Disposable Supplies', 'kit', 8, 100);
