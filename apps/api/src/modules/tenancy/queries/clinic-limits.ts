import { ApiError } from "../../../shared/errors.ts";
import { branchesUsage, checkLimit, usersUsage, type LimitCheck } from "../domain/limits.ts";
import type { ClinicLimits } from "../ports/clinic-limits.ts";
import type { ClinicReader } from "../ports/clinic-reader.ts";
import type { Clock } from "../ports/clock.ts";
import type { SeatUsageReader } from "../ports/seat-usage-reader.ts";

/** `ClinicLimits` فوق قارئ العيادة وقارئ المقاعد (port بينفّذه identity) والـ Clock. */
export class ReaderClinicLimits implements ClinicLimits {
  constructor(
    private readonly reader: ClinicReader,
    private readonly seats: SeatUsageReader,
    private readonly clock: Clock,
  ) {}

  async canAddUser(clinicId: string): Promise<LimitCheck> {
    const snapshot = await this.snapshot(clinicId);
    const usage = await this.seats.readSeatUsage(clinicId, this.clock.now());
    return checkLimit(
      usersUsage(usage.activeMemberships, usage.livePendingInvitations, snapshot.maxUsers),
    );
  }

  async canAddBranch(clinicId: string): Promise<LimitCheck> {
    const snapshot = await this.snapshot(clinicId);
    return checkLimit(branchesUsage(snapshot.activeBranches, snapshot.maxBranches));
  }

  private async snapshot(clinicId: string) {
    const snapshot = await this.reader.readSnapshot(clinicId);
    if (snapshot === null) throw new ApiError("not_found");
    return snapshot;
  }
}
