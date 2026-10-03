const PERMISSION = /^(view|create|update|deactivate):([a-z_]+):(clinic|branch)$/;

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
