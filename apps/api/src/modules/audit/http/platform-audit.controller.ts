import { Controller, Get, Inject, Query } from "@nestjs/common";
import {
  platformAuditQuerySchema,
  type PlatformAuditClinicOptionsResponse,
  type PlatformAuditListResponse,
  type PlatformAuditQuery,
} from "@eyadex/contracts/audit-http";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { PlatformStaff } from "../../identity/index.ts";
import { PLATFORM_AUDIT_READER, type PlatformAuditReader } from "../ports/audit-readers.ts";

// Story 22 (ADR-0019). Platform host first (anything else → 404), then a platform session with a
// verified second factor — all in the global AccessGuard.
@Controller("platform/audit")
export class PlatformAuditController {
  constructor(@Inject(PLATFORM_AUDIT_READER) private readonly reader: PlatformAuditReader) {}

  @Get()
  @PlatformStaff()
  list(
    @Query(new ZodValidationPipe(platformAuditQuerySchema)) query: PlatformAuditQuery,
  ): Promise<PlatformAuditListResponse> {
    return this.reader.list(query);
  }

  @Get("clinics")
  @PlatformStaff()
  clinics(): Promise<PlatformAuditClinicOptionsResponse> {
    return this.reader.clinicOptions();
  }
}
