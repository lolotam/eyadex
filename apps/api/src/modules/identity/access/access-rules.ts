import { PERMISSION_KEYS, type PermissionKey } from "@eyadex/contracts/permissions";
import type { ClinicModule } from "@eyadex/contracts/clinics";

/**
 * How one route is reached (ADR-0009, RBAC-04). Every handler carries exactly one; the global
 * `AccessGuard` refuses a handler with none or with two, and the app refuses to start with one.
 */
export type AccessRule =
  | { readonly kind: "public" }
  | { readonly kind: "authenticated" }
  | { readonly kind: "require"; readonly permission: PermissionKey }
  | { readonly kind: "platform_staff" };

const ACCESS_RULES = Symbol("identity.accessRules");
const KNOWN_KEYS: ReadonlySet<string> = new Set(PERMISSION_KEYS);

// Appends instead of overwriting (SetMetadata would let a second decorator silently replace the
// first), so a doubled declaration stays visible to the guard and to the startup check.
function declare(rule: AccessRule): MethodDecorator {
  return (_target, _key, descriptor) => {
    const handler = descriptor.value as object;
    const rules: AccessRule[] = Reflect.getMetadata(ACCESS_RULES, handler) ?? [];
    Reflect.defineMetadata(ACCESS_RULES, [...rules, rule], handler);
    return descriptor;
  };
}

/** مسار من غير جلسة (health، الدعوات). أي حماية تانية (host، rate limit) بتبقى guards على الـ controller. */
export const Public = (): MethodDecorator => declare({ kind: "public" });

/** جلسة عيادة + عضوية نشطة + عيادة مسموح لها، من غير صلاحية معيّنة (`/me`). */
export const Authenticated = (): MethodDecorator => declare({ kind: "authenticated" });

/** فريق المنصة: host المنصة + جلسة متحقق فيها TOTP. مفيش أدوار جوه فريق المنصة في الـ MVP (PRD §7). */
export const PlatformStaff = (): MethodDecorator => declare({ kind: "platform_staff" });

/**
 * زي `Authenticated` + الدور لازم يحمل الصلاحية دي. المفتاح typed من الكتالوج، ومفتاح مش موجود
 * بيرمي وقت تحميل الـ controller.
 *
 * @param permission مفتاح من `PERMISSION_KEYS`
 * @returns الـ decorator
 */
export function Require(permission: PermissionKey): MethodDecorator {
  if (!KNOWN_KEYS.has(permission)) throw new Error(`unknown permission key: ${permission}`);
  return declare({ kind: "require", permission });
}

/**
 * القواعد اللي اتعلنت على handler.
 *
 * @param handler دالة الـ route
 * @returns القواعد بالترتيب (المفروض واحدة بالظبط)
 */
export function accessRulesOf(handler: unknown): readonly AccessRule[] {
  if (typeof handler !== "function") return [];
  return (Reflect.getMetadata(ACCESS_RULES, handler) as AccessRule[] | undefined) ?? [];
}

const REQUIRED_FEATURE = Symbol("identity.requiredFeature");

/**
 * الموديول اللي الـ route تبعه (PRD §4.8، ADR-0010). مش declaration وصول: بيتحط جنب واحدة بالظبط
 * من التلاتة اللي فوق، والـ guard بيرفض بـ `module_disabled` لو الموديول مقفول للعيادة.
 *
 * @param module الموديول من `moduleSchema`
 * @returns الـ decorator
 */
export function RequiresFeature(module: ClinicModule): MethodDecorator {
  return (_target, _key, descriptor) => {
    Reflect.defineMetadata(REQUIRED_FEATURE, module, descriptor.value as object);
    return descriptor;
  };
}

/**
 * الموديول اللي اتعلن على handler.
 *
 * @param handler دالة الـ route
 * @returns الموديول، أو `null` = الـ route من الأساس (core)
 */
export function featureOf(handler: unknown): ClinicModule | null {
  if (typeof handler !== "function") return null;
  return (Reflect.getMetadata(REQUIRED_FEATURE, handler) as ClinicModule | undefined) ?? null;
}
