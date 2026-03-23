#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3";

import { getConfig } from "./config.js";
import {
  TeamBlindClient,
  getAllowedEncryptedPaths
} from "./teamblindClient.js";

const config = getConfig();
const client = new TeamBlindClient(config);

function asText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function jsonResult(summary: string, data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${summary}\n\n${asText(data)}`
      }
    ]
  };
}

function createMcpServer(): McpServer {
  const hasAuthCookie = Boolean(
    config.cookieHeader && config.cookieHeader.trim().length > 0
  );

  const server = new McpServer(
    {
      name: "teamblind-mcp",
      version: "0.1.0"
    },
    {
      capabilities: {
        logging: {}
      }
    }
  );

  if (hasAuthCookie) {
    const allowedEncryptedPaths = getAllowedEncryptedPaths();
    const allowedEncryptedPathSet = new Set<string>(allowedEncryptedPaths);

    server.registerTool(
      "current_user",
      {
        title: "Current User",
        description:
          "Fetches TeamBlind current-user state via the encrypted API."
      },
      async () => {
        const result = await client.encryptedPost("/api/current-user");
        return jsonResult("Fetched TeamBlind current-user state", result);
      }
    );

    server.registerTool(
      "current_user_company",
      {
        title: "Current User Company",
        description:
          "Fetches TeamBlind current-user/company state via the encrypted API."
      },
      async () => {
        const result = await client.encryptedPost("/api/current-user/company");
        return jsonResult(
          "Fetched TeamBlind current-user/company state",
          result
        );
      }
    );

    server.registerTool(
      "recent_channels",
      {
        title: "Recent Channels",
        description:
          "Fetches TeamBlind recent channel state via the encrypted API."
      },
      async () => {
        const result = await client.encryptedPost("/api/recent-channels");
        return jsonResult("Fetched TeamBlind recent channels", result);
      }
    );

    server.registerTool(
      "encrypted_post",
      {
        title: "Encrypted POST",
        description:
          "Sends a fresh encrypted POST request to an allowlisted TeamBlind endpoint using the same client crypto model found in the HAR.",
        inputSchema: z.object({
          path: z.enum([...allowedEncryptedPaths] as [string, ...string[]]),
          body: z.unknown().optional()
        })
      },
      async ({ path, body }: { path: string; body?: unknown }) => {
        if (!allowedEncryptedPathSet.has(path)) {
          throw new Error(`Path is not allowlisted: ${path}`);
        }

        const allowlistedPath = path as (typeof allowedEncryptedPaths)[number];

        const result = await client.encryptedPost(allowlistedPath, body ?? {});
        return jsonResult(
          `Fetched TeamBlind encrypted endpoint ${path}`,
          result
        );
      }
    );
  }

  server.registerTool(
    "search",
    {
      title: "Search",
      description:
        "Fetches TeamBlind search results through the Next.js RSC route and returns extracted post summaries.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe("Search term, for example 'ai-agent'.")
      })
    },
    async ({ query }: { query: string }) => {
      const result = await client.searchRsc(query);
      return jsonResult(`Fetched TeamBlind RSC search for ${query}`, result);
    }
  );

  server.registerTool(
    "fetch_post",
    {
      title: "Fetch Post",
      description:
        "Fetches a TeamBlind post by slug through the Next.js RSC route and returns extracted post details plus a comment preview.",
      inputSchema: z.object({
        slug: z
          .string()
          .min(1)
          .describe(
            "Post slug from search results, for example 'its-gone-dts-comment-on-rajeevs-blog-5oyd0omc'."
          )
      })
    },
    async ({ slug }: { slug: string }) => {
      const result = await client.fetchPostRsc(slug);
      return jsonResult(`Fetched TeamBlind post ${slug}`, result);
    }
  );

  return server;
}

async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("TeamBlind MCP stdio server is ready.");
}

main().catch((error) => {
  console.error("Failed to start TeamBlind MCP:", error);
  process.exit(1);
});
