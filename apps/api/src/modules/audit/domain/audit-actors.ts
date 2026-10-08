import { normalizeAuditText, scrubAuditText } from "@eyadex/observability";

/** فاعل ليه اسم القارئ يقدر يشوفه. */
export interface KnownActor {
  readonly userId: string;
  readonly name: string;
}

/** نتيجة بحث الفاعل: الـ ids اللي اسمها المعروض بيطابق، وهل الاسم البديل (`Eyadex`) بيطابق. */
export interface ActorMatch {
  readonly userIds: readonly string[];
  readonly unnamed: boolean;
}

/**
 * بحث الفاعل على الاسم زي ما القارئ بيشوفه بالظبط (`scrubAuditText`)، مش على المتخزن: لو البحث كان
 * على المتخزن، عدد النتايج كان هيكشف رقم مدني أو باسورد أو تليفون مستخبي حرف حرف.
 *
 * @param search النص اللي اتكتب في البحث
 * @param actors الفاعلين اللي ليهم اسم عند القارئ
 * @param unnamedName الاسم المعروض لفاعل من غير اسم
 * @returns الـ ids المطابقة، وهل الفاعلين من غير اسم مطابقين
 */
export function matchActors(
  search: string,
  actors: readonly KnownActor[],
  unnamedName: string,
): ActorMatch {
  const needle = normalizeAuditText(search).toLocaleLowerCase();
  const hit = (name: string) => scrubAuditText(name).toLocaleLowerCase().includes(needle);
  return {
    userIds: actors.filter((actor) => hit(actor.name)).map((actor) => actor.userId),
    unnamed: hit(unnamedName),
  };
}
