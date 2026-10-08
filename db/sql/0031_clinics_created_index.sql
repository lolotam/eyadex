-- Slice W2 (ADR-0016): the platform clinic list reads newest first, `created_at desc, id desc`,
-- with a (created_at, id) row-comparison cursor. A plain btree serves that order backwards.
CREATE INDEX clinics_created_at_id_idx ON clinics (created_at, id);
