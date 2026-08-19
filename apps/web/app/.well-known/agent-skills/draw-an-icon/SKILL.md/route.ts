import { drawSkill } from "@/lib/agent-skills";

export const dynamic = "force-static";

export const GET = () => 
  new Response(drawSkill, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/markdown; charset=utf-8",
    },
  })
;
