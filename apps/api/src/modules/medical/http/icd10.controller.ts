import { Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { icd10QuerySchema, type Icd10Result } from "@eyadex/contracts/icd10";
import type { Database } from "@eyadex/db";
import type { z } from "zod";

import { DATABASE } from "../../../shared/database.provider.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { searchIcd10 } from "../queries/icd10-search.ts";

// P2-F1. The words a doctor types reveal a diagnosis, so they travel in the body, never the URL; the
// guard admits `view:medical:clinic` too (the wider key held).
@Controller("icd10")
export class Icd10Controller {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Post("search")
  @HttpCode(200)
  @Require("view:medical:own")
  @RequiresFeature("medical")
  search(
    @Req() request: ClinicRequest,
    @Body(new ZodValidationPipe(icd10QuerySchema)) body: z.infer<typeof icd10QuerySchema>,
  ): Promise<Icd10Result> {
    return searchIcd10(this.db, request.clinicContext.clinicId, body.q);
  }
}
