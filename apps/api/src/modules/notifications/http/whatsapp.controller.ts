import { Body, Controller, Get, HttpCode, Inject, Post, Put, Req } from "@nestjs/common";
import {
  whatsappChannelViewSchema,
  whatsappCoexistenceRequestSchema,
  whatsappConnectRequestSchema,
  whatsappEmbeddedSignupRequestSchema,
  whatsappQrResponseSchema,
  whatsappSignupConfigSchema,
  type WhatsappChannelView,
  type WhatsappCoexistenceRequest,
  type WhatsappConnectRequest,
  type WhatsappEmbeddedSignupRequest,
  type WhatsappQrResponse,
  type WhatsappSignupConfig,
} from "@eyadex/contracts/whatsapp";

import { parseContract } from "../../../shared/contract-parser.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, type ClinicRequest } from "../../identity/index.ts";
import { WHATSAPP_COEXISTENCE, WHATSAPP_EMBEDDED_SIGNUP, WHATSAPP_LINK } from "../ports/tokens.ts";
import type { WhatsappCoexistence } from "../use-cases/whatsapp-channel/whatsapp-coexistence.ts";
import type { WhatsappEmbeddedSignup } from "../use-cases/whatsapp-channel/whatsapp-embedded-signup.ts";
import type { WhatsappLink } from "../use-cases/whatsapp-channel/whatsapp-link.ts";
import type { WhatsappActor } from "../use-cases/whatsapp-channel/whatsapp-shared.ts";

const actor = (request: ClinicRequest): WhatsappActor => ({
  clinicId: request.clinicContext.clinicId,
  userId: request.clinicContext.userId,
});

// Phase 3 N2 (spec §7.1): the clinic's WhatsApp channel. Clinic settings keys, like the notification
// settings. The QR refresh needs the update key: a scanned QR links a number to the clinic. Thin:
// validate → call → map; no response ever carries the token or the full number.
@Controller("clinic/whatsapp")
export class WhatsappController {
  constructor(
    @Inject(WHATSAPP_LINK) private readonly link: WhatsappLink,
    @Inject(WHATSAPP_COEXISTENCE) private readonly coexistence: WhatsappCoexistence,
    @Inject(WHATSAPP_EMBEDDED_SIGNUP) private readonly signup: WhatsappEmbeddedSignup,
  ) {}

  @Get()
  @Require("view:clinic_settings:clinic")
  async view(@Req() request: ClinicRequest): Promise<WhatsappChannelView> {
    return parseContract(
      whatsappChannelViewSchema,
      await this.link.view(request.clinicContext.clinicId),
    );
  }

  @Post("connect")
  @HttpCode(200)
  @Require("update:clinic_settings:clinic")
  async connect(
    @Req() request: ClinicRequest,
    @Body(new ZodValidationPipe(whatsappConnectRequestSchema)) body: WhatsappConnectRequest,
  ): Promise<WhatsappQrResponse> {
    return parseContract(whatsappQrResponseSchema, await this.link.connect(actor(request), body));
  }

  @Get("qr")
  @Require("update:clinic_settings:clinic")
  async qr(@Req() request: ClinicRequest): Promise<WhatsappQrResponse> {
    return parseContract(whatsappQrResponseSchema, await this.link.refresh(actor(request)));
  }

  @Post("disconnect")
  @HttpCode(200)
  @Require("update:clinic_settings:clinic")
  async disconnect(@Req() request: ClinicRequest): Promise<WhatsappChannelView> {
    return parseContract(whatsappChannelViewSchema, await this.link.disconnect(actor(request)));
  }

  @Put("coexistence")
  @Require("update:clinic_settings:clinic")
  async saveCoexistence(
    @Req() request: ClinicRequest,
    @Body(new ZodValidationPipe(whatsappCoexistenceRequestSchema)) body: WhatsappCoexistenceRequest,
  ): Promise<WhatsappChannelView> {
    return parseContract(
      whatsappChannelViewSchema,
      await this.coexistence.update(actor(request), body),
    );
  }

  // N3 (spec §7.2): Meta's Embedded Signup. Public ids only; 404 `unavailable` without the Meta app.
  @Get("signup-config")
  @Require("view:clinic_settings:clinic")
  signupConfig(): WhatsappSignupConfig {
    return parseContract(whatsappSignupConfigSchema, this.signup.signupConfig());
  }

  @Post("embedded-signup")
  @HttpCode(200)
  @Require("update:clinic_settings:clinic")
  async embeddedSignup(
    @Req() request: ClinicRequest,
    @Body(new ZodValidationPipe(whatsappEmbeddedSignupRequestSchema))
    body: WhatsappEmbeddedSignupRequest,
  ): Promise<WhatsappChannelView> {
    return parseContract(
      whatsappChannelViewSchema,
      await this.signup.complete(actor(request), body),
    );
  }
}
