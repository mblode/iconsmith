import type { NextRequest } from "next/server";

import { clientIp, rateLimit } from "@/lib/request-guards";
import { generateStudioResponse } from "@/lib/studio/generate";
import { studioRequestSchema } from "@/lib/studio/types";
import type { StudioResponse } from "@/lib/studio/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export const POST = async (req: NextRequest): Promise<Response> => {
  const ip = await clientIp();
  if (!rateLimit(`studio:${ip}`, 40, Date.now())) {
    const body: StudioResponse = {
      kind: "error",
      text: "Too many draws from this address. Try again in an hour.",
    };
    return Response.json(body, { status: 429 });
  }

  let input: unknown;
  try {
    input = await req.json();
  } catch {
    const body: StudioResponse = { kind: "error", text: "I could not read that message." };
    return Response.json(body, { status: 400 });
  }

  const parsed = studioRequestSchema.safeParse(input);
  if (!parsed.success) {
    const body: StudioResponse = {
      kind: "error",
      text: "That studio request was invalid. Keep the brief under 2,000 characters and attach no more than four files.",
    };
    return Response.json(body, { status: 400 });
  }

  try {
    return Response.json(await generateStudioResponse(parsed.data));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The drawer failed.";
    const body: StudioResponse = { kind: "error", text: message };
    return Response.json(body, { status: 500 });
  }
};
