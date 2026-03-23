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

  server.registerTool(
    "get_server_config",
    {
      title: "TeamBlind Server Config",
      description:
        "Returns TeamBlind MCP runtime configuration and which encrypted endpoints are currently allowlisted."
    },
    async () => {
      const runtimeInfo = client.getRuntimeInfo();
      return jsonResult("TeamBlind MCP runtime configuration", runtimeInfo);
    }
  );

  if (hasAuthCookie) {
    const allowedEncryptedPaths = getAllowedEncryptedPaths();

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
      "tc_summary",
      {
        title: "TC Summary",
        description:
          "Fetches the ad-targeting TC summary endpoint observed in the HAR."
      },
      async () => {
        const result = await client.encryptedPost(
          "/api/ad-targeting/tc-summary"
        );
        return jsonResult("Fetched TeamBlind tc-summary", result);
      }
    );

    server.registerTool(
      "review_history",
      {
        title: "Review History",
        description:
          "Fetches the ad-targeting review-history endpoint observed in the HAR."
      },
      async () => {
        const result = await client.encryptedPost(
          "/api/ad-targeting/review-history"
        );
        return jsonResult("Fetched TeamBlind review-history", result);
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
      async ({ path, body }) => {
        if (!allowedEncryptedPaths.includes(path)) {
          throw new Error(`Path is not allowlisted: ${path}`);
        }

        const result = await client.encryptedPost(path, body ?? {});
        return jsonResult(
          `Fetched TeamBlind encrypted endpoint ${path}`,
          result
        );
      }
    );
  }

  server.registerTool(
    "search_rsc",
    {
      title: "Search RSC",
      description:
        "Fetches TeamBlind search results through the Next.js RSC route and returns the raw payload plus extracted post titles.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe("Search term, for example 'ai-agent'."),
        rscToken: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Optional _rsc token. Defaults to the observed working token from the HAR."
          )
      })
    },
    async ({ query, rscToken }) => {
      const result = await client.searchRsc(query, rscToken);
      return jsonResult(`Fetched TeamBlind RSC search for ${query}`, result);
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
