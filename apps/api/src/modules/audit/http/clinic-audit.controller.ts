import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import {
  clinicAuditQuerySchema,
  type ClinicAuditListResponse,
  type ClinicAuditQuery,
} from "@eyadex/contracts/audit-http";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, type ClinicRequest } from "../../identity/index.ts";
import { mayReadPatientAccess } from "../domain/audit-access.ts";
import { CLINIC_AUDIT_READER, type ClinicAuditReader } from "../ports/audit-readers.ts";

// Story 53 (ADR-0019). The clinic comes from the guard's context, never from the request.
@Controller("clinic/audit")
export class ClinicAuditController {
  constructor(@Inject(CLINIC_AUDIT_READER) private readonly reader: ClinicAuditReader) {}

  @Get()
  @Require("view:audit_log:clinic")
  list(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(clinicAuditQuerySchema)) query: ClinicAuditQuery,
  ): Promise<ClinicAuditListResponse> {
    const { clinicId, permissions } = request.clinicContext;
    return this.reader.list({ clinicId, patientAccess: mayReadPatientAccess(permissions) }, query);
  }
}
