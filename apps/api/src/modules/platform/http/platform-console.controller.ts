import { Body, Controller, Get, Inject, Put, Req } from "@nestjs/common";
import type { PlatformSettings } from "@eyadex/contracts/platform";
import {
  platformMeResponseSchema,
  platformOverviewResponseSchema,
  platformSettingsRequestSchema,
  platformSettingsResponseSchema,
  type PlatformMeResponse,
  type PlatformOverviewResponse,
  type PlatformSettingsBody,
} from "@eyadex/contracts/platform-console";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import {
  PLATFORM_TEAM_CHANGES,
  PlatformStaff,
  type AuthenticatedRequest,
  type PlatformTeamChanges,
} from "../../identity/index.ts";
import type { PlatformSettingsChanges } from "../../tenancy/index.ts";

export const PLATFORM_OVERVIEW = Symbol("platform.Overview");
export const PLATFORM_SETTINGS_READER = Symbol("platform.SettingsReader");
export const PLATFORM_SETTINGS_CHANGES = Symbol("platform.SettingsChanges");

/** يقرا النظرة العامة على pool المنصة. */
export type OverviewReader = () => Promise<PlatformOverviewResponse>;
/** يقرا إعدادات المنصة. */
export type SettingsReader = () => Promise<PlatformSettings>;

// Stories 3–4 and 26, and the signed-in account (ADR-0020). Every answer is parsed with its strict
// schema before it leaves: names, statuses, dates and settings only — never a patient field (PLAT-02).
@Controller("platform")
export class PlatformConsoleController {
  constructor(
    @Inject(PLATFORM_OVERVIEW) private readonly overview: OverviewReader,
    @Inject(PLATFORM_SETTINGS_READER) private readonly settings: SettingsReader,
    @Inject(PLATFORM_SETTINGS_CHANGES) private readonly settingsChanges: PlatformSettingsChanges,
    @Inject(PLATFORM_TEAM_CHANGES) private readonly team: PlatformTeamChanges,
  ) {}

  @Get("me")
  @PlatformStaff()
  async me(@Req() request: AuthenticatedRequest): Promise<PlatformMeResponse> {
    return platformMeResponseSchema.parse(await this.team.me(request.areaSession.session.user.id));
  }

  @Get("overview")
  @PlatformStaff()
  async readOverview(): Promise<PlatformOverviewResponse> {
    return platformOverviewResponseSchema.parse(await this.overview());
  }

  @Get("settings")
  @PlatformStaff()
  async readSettings(): Promise<PlatformSettingsBody> {
    return platformSettingsResponseSchema.parse(await this.settings());
  }

  @Put("settings")
  @PlatformStaff()
  async updateSettings(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(platformSettingsRequestSchema)) body: PlatformSettingsBody,
  ): Promise<PlatformSettingsBody> {
    const saved = await this.settingsChanges.update(request.areaSession.session.user.id, body);
    return platformSettingsResponseSchema.parse(saved);
  }
}
