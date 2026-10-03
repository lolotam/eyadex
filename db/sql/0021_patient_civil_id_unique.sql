-- SQL baseline (pending; not yet applied to production).
-- Kuwaiti civil ID (PRD story 66): exactly 12 ASCII digits, and at most one patient file per
-- clinic may hold a given number. Uniqueness deliberately ignores status, so archiving a file
-- keeps its number reserved — two people never end up under one civil ID.
--
-- Patients without a number are unaffected: NULLs are distinct in a unique index, and the
-- partial predicate keeps the index small.

-- A stored civil ID is digits and nothing else. translate() drops every ASCII digit it finds,
-- so anything left over (an Arabic-Indic digit, a space, a letter) fails the check.
ALTER TABLE patients ADD CONSTRAINT patients_civil_id_digits CHECK (
  civil_id IS NULL
  OR (length(civil_id) = 12 AND translate(civil_id, '0123456789', '') = '')
);

-- The unique partial index also serves the only lookup there is: "which file in this clinic
-- holds this number", which is how the API answers a duplicate.
CREATE UNIQUE INDEX patients_clinic_civil_id_unique
  ON patients (clinic_id, civil_id) WHERE civil_id IS NOT NULL;

-- The plain index from 0010 is now redundant.
DROP INDEX patients_clinic_civil_id_idx;