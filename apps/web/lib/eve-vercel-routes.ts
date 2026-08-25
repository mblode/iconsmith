import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * `withEve()` writes Vercel Build Output routes for `/eve/v1/*` and does not
 * know about Next `basePath`. This zone is reached as `/iconsmith/*`, so the
 * browser calls `/iconsmith/eve/v1/*` and those unprefixed routes never fire.
 * The request falls through to Next and Studio gets the 404 HTML document as
 * `error.message`.
 *
 * Named-agent `publicRoutePrefix` is the same rewrite (`^<prefix>/eve/v1/(.*)$`
 * plus a request-path transform back to `/eve/v1/$1`). withEve does not expose
 * that prefix for the default agent, so this is the zone's copy of it.
 */

const EVE_ROUTE_BODY = "/eve/v1/(.*)$";
const CONFIG_FILE = "config.json";
const PUBLIC_PREFIX_ENV = "EVE_PUBLIC_ROUTE_PREFIX";

type JsonRecord = Record<string, unknown>;

export interface EveVercelRoute {
  readonly src?: string;
  readonly [key: string]: unknown;
}

export interface EveVercelService {
  readonly buildCommand?: string;
  readonly framework?: string;
  readonly routes?: readonly EveVercelRoute[];
  readonly [key: string]: unknown;
}

export interface EveVercelOutputConfig {
  readonly routes?: readonly EveVercelRoute[];
  readonly services?: Record<string, EveVercelService> | readonly EveVercelService[];
  readonly [key: string]: unknown;
}

export type ApplyEvePublicRoutePrefixResult =
  | { readonly path: string; readonly status: "written" | "unchanged" }
  | { readonly status: "missing" };

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const escapeRegExp = (value: string): string => value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const quoteShellArg = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

const normalizePrefix = (prefix: string): string => {
  const trimmed = (prefix.startsWith("/") ? prefix : `/${prefix}`).replaceAll(/\/+$/gu, "");
  if (trimmed.length === 0) {
    throw new Error("Eve public route prefix cannot resolve to the origin root.");
  }
  return trimmed;
};

export const eveServiceRouteSrc = (prefix: string): string =>
  prefix.length === 0
    ? `^${EVE_ROUTE_BODY}`
    : `^${escapeRegExp(normalizePrefix(prefix))}${EVE_ROUTE_BODY}`;

const rewriteRouteSrc = (src: string | undefined, prefix: string): string | undefined => {
  if (src === undefined) {
    return src;
  }
  const prefixed = eveServiceRouteSrc(prefix);
  if (src === prefixed || src === eveServiceRouteSrc("")) {
    return prefixed;
  }
  return src;
};

const mapIfChanged = <T>(items: readonly T[], rewrite: (item: T) => T): readonly T[] => {
  let changed = false;
  const next = items.map((item) => {
    const rewritten = rewrite(item);
    if (rewritten !== item) {
      changed = true;
    }
    return rewritten;
  });
  return changed ? next : items;
};

const withPrefixedSrc = (route: EveVercelRoute, prefix: string): EveVercelRoute => {
  const src = rewriteRouteSrc(route.src, prefix);
  return src === route.src ? route : { ...route, src };
};

const withPublicPrefixEnv = (buildCommand: string, prefix: string): string => {
  if (buildCommand.includes(PUBLIC_PREFIX_ENV)) {
    return buildCommand;
  }
  return `export ${PUBLIC_PREFIX_ENV}=${quoteShellArg(normalizePrefix(prefix))} && ${buildCommand}`;
};

const isEveService = (name: string, service: EveVercelService): boolean =>
  service.framework === "eve" || name === "eve" || name.startsWith("eve-");

const prefixService = (service: EveVercelService, prefix: string): EveVercelService => {
  const routes =
    service.routes === undefined
      ? undefined
      : mapIfChanged(service.routes, (route) => withPrefixedSrc(route, prefix));
  const buildCommand =
    service.buildCommand === undefined
      ? undefined
      : withPublicPrefixEnv(service.buildCommand, prefix);
  if (routes === service.routes && buildCommand === service.buildCommand) {
    return service;
  }
  return {
    ...service,
    ...(buildCommand === undefined ? {} : { buildCommand }),
    ...(routes === undefined ? {} : { routes }),
  };
};

const prefixServices = (
  services: EveVercelOutputConfig["services"],
  prefix: string,
): EveVercelOutputConfig["services"] => {
  if (services === undefined) {
    return services;
  }
  if (Array.isArray(services)) {
    return mapIfChanged(services, (service) =>
      service.framework === "eve" ? prefixService(service, prefix) : service,
    );
  }
  let changed = false;
  const next: Record<string, EveVercelService> = {};
  for (const [name, service] of Object.entries(services)) {
    const rewritten = isEveService(name, service) ? prefixService(service, prefix) : service;
    if (rewritten !== service) {
      changed = true;
    }
    next[name] = rewritten;
  }
  return changed ? next : services;
};

/**
 * Rewrites the default-agent `/eve/v1/*` Build Output routes so they match a
 * Next `basePath`. Idempotent: a second pass leaves an already-prefixed config
 * unchanged.
 */
export const prefixEveVercelOutputConfig = (
  config: EveVercelOutputConfig,
  prefix: string,
): EveVercelOutputConfig => {
  const routes =
    config.routes === undefined
      ? undefined
      : mapIfChanged(config.routes, (route) => withPrefixedSrc(route, prefix));
  const services = prefixServices(config.services, prefix);
  if (routes === config.routes && services === config.services) {
    return config;
  }
  return {
    ...config,
    ...(routes === undefined ? {} : { routes }),
    ...(services === undefined ? {} : { services }),
  };
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

const findClosestDirectoryWithFile = async (
  start: string,
  directoryName: string,
  fileName: string,
): Promise<string | undefined> => {
  let current = start;
  for (;;) {
    const directory = path.join(current, directoryName);
    // Parent walk: stop at the first directory that contains the marker file.
    // oxlint-disable-next-line eslint/no-await-in-loop
    if (await fileExists(path.join(directory, fileName))) {
      return directory;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
};

/**
 * Same lookup `withEve()` uses: a linked `.vercel` project, else an existing
 * Build Output directory, else `{nextRoot}/.vercel/output/config.json`.
 */
export const resolveEveVercelOutputConfigPath = async (nextRoot: string): Promise<string> => {
  const linked = await findClosestDirectoryWithFile(nextRoot, ".vercel", "project.json");
  const output = await findClosestDirectoryWithFile(nextRoot, "output", "builds.json");
  if (output !== undefined) {
    return path.join(output, CONFIG_FILE);
  }
  if (linked !== undefined) {
    return path.join(linked, "output", CONFIG_FILE);
  }
  return path.join(nextRoot, ".vercel", "output", CONFIG_FILE);
};

export const applyEvePublicRoutePrefix = async (input: {
  readonly nextRoot: string;
  readonly prefix: string;
}): Promise<ApplyEvePublicRoutePrefixResult> => {
  const configPath = await resolveEveVercelOutputConfigPath(input.nextRoot);
  if (!(await fileExists(configPath))) {
    return { status: "missing" };
  }
  const parsed: unknown = JSON.parse(await readFile(configPath, "utf-8"));
  if (!isRecord(parsed)) {
    throw new Error(`${configPath} is not a JSON object.`);
  }
  const current = parsed as EveVercelOutputConfig;
  const next = prefixEveVercelOutputConfig(current, input.prefix);
  if (next === current) {
    return { path: configPath, status: "unchanged" };
  }
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
  return { path: configPath, status: "written" };
};
