"use client";

import { useEffect } from "react";

import vocabulary from "@/lib/vocabulary.json";
import { REPO_URL, SITE_NAME, SITE_URL } from "@/lib/site-url";

/**
 * WebMCP: this page advertising itself as an MCP server to an agent driving the
 * browser. Renders nothing; it only registers tools.
 *
 * `navigator.modelContext` exists in no shipping browser today, so the guard
 * below is the normal path and this component is inert for every human visitor.
 * It is declared by module augmentation rather than an ambient `.d.ts` because
 * a `.d.ts` silently drops out of the TypeScript program and nothing fails
 * loudly when it does.
 */
interface ToolDefinition {
  description: string;
  execute: () => Promise<unknown>;
  inputSchema: Record<string, unknown>;
  name: string;
}

declare global {
  interface Navigator {
    modelContext?: {
      provideContext: (context: { tools: ToolDefinition[] }) => Promise<void>;
    };
  }
}

const EMPTY_INPUT = {
  additionalProperties: false,
  properties: {},
  type: "object",
} as const;

export const WebMcp = () => {
  useEffect(() => {
    const { modelContext } = navigator;

    if (!modelContext) {
      return;
    }

    const tools: ToolDefinition[] = [
      {
        description: `Get the ${SITE_NAME} parts vocabulary: every named mark the DSL can place with \`part\`, as SVG path data.`,
        execute: () =>
          Promise.resolve({
            count: vocabulary.length,
            parts: vocabulary.map((part) => ({
              d: part.d,
              name: part.name,
              note: part.note,
            })),
          }),
        inputSchema: EMPTY_INPUT,
        name: "get_vocabulary",
      },
      {
        description: `Get the ${SITE_NAME} status and where to read more. It is pre-release and not on npm yet.`,
        execute: () =>
          Promise.resolve({
            installable: false,
            repository: REPO_URL,
            status: "pre-release",
            url: SITE_URL,
          }),
        inputSchema: EMPTY_INPUT,
        name: "get_status",
      },
      {
        // One tool that acts on the page rather than reporting about it, which
        // is the thing WebMCP is actually for.
        description: `Scroll the ${SITE_NAME} page to the parts vocabulary grid.`,
        execute: () => {
          const target = document.querySelector("#vocabulary");
          target?.scrollIntoView({ behavior: "smooth" });
          return Promise.resolve({ scrolled: Boolean(target) });
        },
        inputSchema: EMPTY_INPUT,
        name: "open_vocabulary",
      },
    ];

    void modelContext.provideContext({ tools });
  }, []);

  return null;
};
