import { Body, Controller, Get, Inject, Param, Put, Req } from "@nestjs/common";
import {
  bookingProfileInputSchema,
  type BookingProfile,
  type BookingProfileInput,
} from "@eyadex/contracts/services";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { Require, RequiresFeature } from "../access/access-rules.ts";
import type { ClinicRequest } from "../access/access.guard.ts";
import type { BookingProfileChanges } from "../use-cases/booking-profile/booking-profile-changes.ts";
import { actorOf, idOf } from "./users.controller.ts";

export const BOOKING_PROFILE_CHANGES = Symbol("identity.BookingProfileChanges");

// D-1, D-15 (ADR-0026 §5): the user editor's booking settings. The membership is identity's, so the route
// is too; the settings belong to the appointments module, so its flag gates them (rule 10).
@Controller("users")
export class BookingProfileController {
  constructor(@Inject(BOOKING_PROFILE_CHANGES) private readonly changes: BookingProfileChanges) {}

  @Get(":id/booking-profile")
  @Require("view:users:clinic")
  @RequiresFeature("appointments")
  read(@Req() request: ClinicRequest, @Param("id") id: string): Promise<BookingProfile> {
    return this.changes.read(actorOf(request), idOf(id));
  }

  @Put(":id/booking-profile")
  @Require("update:users:clinic")
  @RequiresFeature("appointments")
  update(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(bookingProfileInputSchema)) body: BookingProfileInput,
  ): Promise<BookingProfile> {
    return this.changes.update(actorOf(request), idOf(id), body);
  }
}
