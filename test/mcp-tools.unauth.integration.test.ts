import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function envForServer(baseUrl: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  env.TEAMBLIND_BASE_URL = baseUrl;

  return env;
}

test("MCP server registers tools correctly", async () => {
  const baseUrl =
    process.env.TEAMBLIND_BASE_URL?.trim() || "https://www.teamblind.com";
  const indexPath = path.resolve(process.cwd(), "src/index.ts");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", indexPath],
    env: envForServer(baseUrl),
    cwd: process.cwd(),
    stderr: "pipe"
  });

  const client = new Client({
    name: "teamblind-test-client",
    version: "0.2.0"
  });

  try {
    await client.connect(transport);

    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((tool) => tool.name);

    assert.ok(toolNames.includes("search"), "search tool should be registered");
    assert.ok(
      toolNames.includes("fetch_post"),
      "fetch_post tool should be registered"
    );
    assert.ok(
      toolNames.includes("get_feed"),
      "get_feed tool should be registered"
    );
    assert.ok(
      toolNames.includes("list_my_companies"),
      "list_my_companies tool should be registered"
    );
    assert.ok(
      toolNames.includes("get_company_channel"),
      "get_company_channel tool should be registered"
    );
    assert.ok(
      toolNames.includes("close_session"),
      "close_session tool should be registered"
    );
  } finally {
    await transport.close();
  }
});
