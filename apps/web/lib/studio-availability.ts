/** The Studio remains available to the local foundry but is not deployed publicly. */
export const studioAvailable = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.VERCEL !== "1";

export const isStudioPath = (pathname: string): boolean =>
  pathname === "/studio" ||
  pathname.startsWith("/studio/") ||
  pathname === "/api/studio" ||
  pathname.startsWith("/api/studio/");
