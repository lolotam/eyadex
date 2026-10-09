const PERMISSION = /^(view|create|update|deactivate|overbook):([a-z_]+):(clinic|branch|own)$/;

type Lookup = (key: string) => string;

/** Translates one coded audit value; returns null when no translation exists. */
export function translateAuditValue(text: string, tr: Lookup): string | null {
  const permission = PERMISSION.exec(text);
  if (permission) {
    const [, action, resource, scope] = permission;
    const parts = [
      tr(`roles.actions.${action}`),
      tr(`roles.resources.${resource}`),
      tr(`roles.scopes.${scope}`),
    ];
    const keys = [
      `roles.actions.${action}`,
      `roles.resources.${resource}`,
      `roles.scopes.${scope}`,
    ];
    return parts.some((p, i) => p === keys[i]) ? null : parts.join(" · ");
  }
  const key = `audit.values.${text}`;
  const translated = tr(key);
  return translated === key ? null : translated;
}

/**
 * The keys switched on in an on/off map (a clinic's modules, the platform's default modules);
 * null when the value is not such a map, so the caller shows it another way.
 */
export function enabledFlags(value: unknown): string[] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.some(([, on]) => typeof on !== "boolean")) return null;
  return entries.filter(([, on]) => on).map(([key]) => key);
}
