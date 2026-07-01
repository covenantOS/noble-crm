-- Brand + painting-catalog seed data (Phase 3).
-- Run once after migrations: pnpm db:seed-brands:local / pnpm db:seed-brands:remote
--
-- Uses INSERT OR IGNORE with explicit ids so it's idempotent and safe to run
-- against a live dev DB that already has rows in service_types (from the
-- original seed.sql) -- this only ADDS new rows, it never deletes/updates
-- existing ones.

-- ── Brands ─────────────────────────────────────────────────────────

INSERT OR IGNORE INTO brands (id, name, slug, color_primary, color_secondary, logo_r2_key, active)
VALUES
  (1, 'Westchase Painting', 'westchase-painting', '#1a2b4a', '#c9a227', 'brands/westchase-painting-logo.webp', 1),
  -- TKC deliberately reuses Westchase's colors (no brand identity of its own
  -- yet) and has no logo yet -- logo_r2_key stays NULL, no placeholder image.
  (2, 'Tampa Kitchen Cabinets', 'tampa-kitchen-cabinets', '#1a2b4a', '#c9a227', NULL, 1);

-- ── Painting service catalog (brand_id 1: Westchase Painting) ────────
-- New ids (7+) so these coexist with the original generic seed.sql rows
-- (ids 1-6) in any DB that's already been seeded with those.

INSERT OR IGNORE INTO service_types (id, name, description, default_duration, default_price, color, brand_id)
VALUES
  (7,  'Interior Painting', 'Full interior painting service', 480, 2500, '#1a2b4a', 1),
  (8,  'Exterior Painting', 'Full exterior painting service', 600, 3800, '#2f4a7a', 1),
  (9,  'Cabinet Refinishing', 'Refinish existing cabinetry', 360, 1800, '#c9a227', 1),
  (10, 'Power Washing', 'Pressure washing of exterior surfaces', 120, 300, '#0891b2', 1),
  (11, 'Staining', 'Wood staining (deck, fence, trim)', 300, 1200, '#a15c2b', 1),
  (12, 'Drywall Repair', 'Patch and repair drywall damage', 180, 450, '#6b7280', 1);

-- ── Painting service catalog (brand_id 2: Tampa Kitchen Cabinets) ────

INSERT OR IGNORE INTO service_types (id, name, description, default_duration, default_price, color, brand_id)
VALUES
  (13, 'Kitchen Cabinet Installation', 'New cabinet installation', 720, 6500, '#1a2b4a', 2),
  (14, 'Cabinet Refacing', 'Reface existing cabinet boxes with new doors/panels', 480, 3200, '#c9a227', 2),
  (15, 'Countertops', 'Countertop measurement, fabrication, and install', 300, 2800, '#8b5cf6', 2);
