-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase 3 N3 (docs/specs/notifications-design.md §7.2): WhatsApp delivery statuses (delivered, read,
-- failed after acceptance), one Meta number per clinic, and the pre-tenant routing of Meta's webhook.

-- When the patient's phone received the message and when the patient opened it. Only a WhatsApp row that
-- was accepted (sent_at set) can carry them, and read implies delivered: the order only moves forward
-- (sent → delivered → read). A read status that arrives before its delivered one sets both. No grant
-- change: eyadex_app keeps 0056's table privileges, which cover the new columns; the platform has none.
ALTER TABLE patient_notifications
  ADD COLUMN delivered_at timestamptz NULL,
  ADD COLUMN read_at timestamptz NULL,
  ADD CONSTRAINT patient_notifications_delivery_check CHECK (
    (delivered_at IS NULL AND read_at IS NULL)
    OR (channel = 'whatsapp' AND sent_at IS NOT NULL AND delivered_at IS NOT NULL)
  );

-- A provider can accept a message, then report that it was not delivered. Such a row becomes `failed` and
-- keeps the route and acceptance time it had, but only for a delivery failure of its own transport:
--   evolution   → `evolution:evo_delivery_rejected` (0058, unchanged);
--   coexistence → `coexistence:<code>` with the code Meta's status webhook maps to: `meta_not_on_whatsapp`,
--                 `meta_rejected`, `meta_rate_limited` or `meta_template`.
-- Every other unsent row still has neither route nor acceptance time. A failure before acceptance (the
-- worker's own send) keeps route NULL even when its code is one of these, so the two never collide. The
-- NULL tests matter: a CHECK passes on NULL, and a failed row without a code must keep neither.
ALTER TABLE patient_notifications DROP CONSTRAINT patient_notifications_sent_check;
ALTER TABLE patient_notifications ADD CONSTRAINT patient_notifications_sent_check CHECK (
  (route IS NULL AND sent_at IS NULL AND status <> 'sent')
  OR (route IS NOT NULL AND sent_at IS NOT NULL AND (
    status = 'sent'
    OR (status = 'failed' AND channel = 'whatsapp' AND (
      (route = 'evolution' AND last_error IS NOT DISTINCT FROM 'evolution:evo_delivery_rejected')
      OR (route = 'coexistence' AND last_error IS NOT NULL AND last_error IN ('coexistence:meta_not_on_whatsapp',
        'coexistence:meta_rejected', 'coexistence:meta_rate_limited', 'coexistence:meta_template'))
    ))
  ))
);

-- One Meta number belongs to one clinic: Meta's webhook names the number, never the clinic, so a second
-- clinic holding the same number would receive the first one's statuses. A disconnected row keeps its
-- number and keeps holding it. The index scans every row whatever RLS says, so its creation is the guard:
-- an environment where two clinics already share a number refuses this file (none does: each clinic has at
-- most one row, and no number was shared when this was written).
CREATE UNIQUE INDEX clinic_whatsapp_channels_phone_number_unique
  ON clinic_whatsapp_channels (phone_number_id) WHERE phone_number_id IS NOT NULL;

-- The routing function's owner: NOLOGIN, no BYPASSRLS, the pattern of 0014/0027/0037/0040. The table is
-- FORCE ROW LEVEL SECURITY and no role bypasses it, so a function owned by the migration owner would see
-- no row without a clinic context. This role reads three columns, and only of coexistence channels.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_whatsapp_routing_owner') THEN
    CREATE ROLE eyadex_whatsapp_routing_owner NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO eyadex_whatsapp_routing_owner;
GRANT SELECT (clinic_id, transport, phone_number_id) ON clinic_whatsapp_channels
  TO eyadex_whatsapp_routing_owner;
CREATE POLICY clinic_whatsapp_channels_phone_routing ON clinic_whatsapp_channels FOR SELECT
  TO eyadex_whatsapp_routing_owner USING (transport = 'coexistence');

-- Meta's status webhook arrives with `value.metadata.phone_number_id` and no clinic. The API resolves the
-- clinic here, then applies every status inside withTenant(clinic). Returns the clinic id of the
-- coexistence channel holding that number, or NULL; reveals nothing else about any clinic.
CREATE FUNCTION whatsapp_clinic_for_phone_number(p_phone_number_id text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT clinic_id FROM public.clinic_whatsapp_channels
  WHERE transport = 'coexistence' AND phone_number_id = p_phone_number_id
$$;
ALTER FUNCTION whatsapp_clinic_for_phone_number(text) OWNER TO eyadex_whatsapp_routing_owner;
REVOKE ALL ON FUNCTION whatsapp_clinic_for_phone_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_clinic_for_phone_number(text) TO eyadex_app;
