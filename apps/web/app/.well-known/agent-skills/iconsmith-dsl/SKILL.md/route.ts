import { dslSkill } from "@/lib/agent-skills";

export const dynamic = "force-static";

export const GET = () => 
  new Response(dslSkill, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/markdown; charset=utf-8",
    },
  })
;
