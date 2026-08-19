import { sha256, skills } from "@/lib/agent-skills";
import { siteConfig, SITE_URL } from "@/lib/site-url";

// Built once, served from the CDN. This is also what makes `node:crypto` in
// lib/agent-skills.ts acceptable: it runs at build time, not per request.
export const dynamic = "force-static";

export const GET = () => {
  const body = {
    $schema:
      "https://raw.githubusercontent.com/cloudflare/agent-skills-discovery-rfc/main/schemas/v0.2.0/index.json",
    publisher: siteConfig.author,
    skills: skills.map((skill) => ({
      description: skill.description,
      name: skill.name,
      // The hash is taken from the same constant the route below serves, so
      // the index cannot describe a body that is not the one delivered.
      sha256: sha256(skill.body),
      type: "instructions",
      url: `${SITE_URL}/.well-known/agent-skills/${skill.name}/SKILL.md`,
    })),
    version: "0.2.0",
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
};
