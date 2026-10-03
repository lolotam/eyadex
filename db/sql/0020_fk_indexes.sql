-- SQL baseline (pending; not yet applied to production).
-- Missing leading-column indexes for two foreign keys (found by db/tests/fk-indexes.sql):
-- invitations.clinic_id_role_id_fkey speeds up role-side joins and deletes, and
-- role_permissions.permission_id_fkey speeds up permission-side joins and deletes.
-- Index names follow <table>_<cols>_idx. Columns start with clinic_id where the
-- foreign key includes it.

CREATE INDEX invitations_clinic_id_role_id_idx ON invitations (clinic_id, role_id);
CREATE INDEX role_permissions_permission_id_idx ON role_permissions (permission_id);
