# apps/web rules

- The medical module lives in `apps/web/src/visits` (visit screens) and `apps/web/src/medical` (medical file, attachments, medicines); its mock rules are `shared/api/mock/mock-medical-*.ts`, whose audit rows carry field names only — so clinical text can never reach the log.
