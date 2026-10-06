import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { ModulesContainer } from "@nestjs/core";

import type { ClinicModule } from "@eyadex/contracts/clinics";
import { PERMISSION_CATALOG } from "@eyadex/contracts/permissions";

import { accessRulesOf, featureOf, type AccessRule } from "./access-rules.ts";

/** One registered route handler and what it declares. */
export interface RouteAccess {
  readonly route: string;
  readonly rules: readonly AccessRule[];
  readonly feature: ClinicModule | null;
}

const join = (...parts: unknown[]) =>
  `/${parts
    .flatMap((p) => (typeof p === "string" ? p.split("/") : []))
    .filter((p) => p !== "")
    .join("/")}`;

/**
 * Every route handler of every controller Nest registered, with its access declarations.
 *
 * @param modules the app's `ModulesContainer`
 * @returns `METHOD /v1/path` and its rules, sorted by route
 */
export function registeredRoutes(modules: ModulesContainer): RouteAccess[] {
  const routes: RouteAccess[] = [];
  for (const module of modules.values()) {
    for (const wrapper of module.controllers.values()) {
      const type = wrapper.metatype as (new (...args: never[]) => unknown) | null;
      if (type === null || typeof type !== "function") continue;
      const prefix: unknown = Reflect.getMetadata(PATH_METADATA, type);
      for (const name of Object.getOwnPropertyNames(type.prototype)) {
        if (name === "constructor") continue;
        const handler = (type.prototype as Record<string, unknown>)[name];
        if (typeof handler !== "function") continue;
        const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined || !Reflect.hasMetadata(PATH_METADATA, handler)) continue;
        const path = join("v1", prefix, Reflect.getMetadata(PATH_METADATA, handler));
        routes.push({
          route: `${RequestMethod[method]} ${path}`,
          rules: accessRulesOf(handler),
          feature: featureOf(handler),
        });
      }
    }
  }
  return routes.sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * Refuses to start an app with a route that does not declare exactly one access rule (RBAC-04):
 * the global guard would answer 500 on it anyway, this makes the mistake fail at boot instead.
 *
 * @param modules the app's `ModulesContainer`
 * @returns nothing; throws naming the offending routes
 */
export function assertRouteAccess(modules: ModulesContainer): void {
  const routes = registeredRoutes(modules);
  const bad = routes.filter((r) => r.rules.length !== 1);
  if (bad.length > 0) {
    throw new Error(
      `routes without exactly one access declaration: ${bad.map((r) => r.route).join(", ")}`,
    );
  }
  const ungated = routes.filter((r) => missingFeature(r) !== null);
  if (ungated.length > 0) {
    throw new Error(
      `routes whose permission belongs to a module without @RequiresFeature: ${ungated
        .map((r) => `${r.route} (${missingFeature(r)})`)
        .join(", ")}`,
    );
  }
}

const MODULE_OF = new Map(PERMISSION_CATALOG.map((p) => [p.key, p.module]));

/**
 * The module a route's `@Require` key belongs to when the route does not declare it (ADR-0010).
 *
 * @param route one registered route
 * @returns the missing module, or `null` when the route is consistent
 */
export function missingFeature(route: RouteAccess): ClinicModule | null {
  const rule = route.rules[0];
  if (route.rules.length !== 1 || rule?.kind !== "require") return null;
  const module = MODULE_OF.get(rule.permission) ?? null;
  return module !== null && route.feature !== module ? module : null;
}
