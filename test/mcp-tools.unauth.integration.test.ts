import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type TextContent = {
  type: "text";
  text: string;
};

function getTextContentFromToolResult(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result)) {
    throw new Error("Expected tool result with content array.");
  }

  const { content } = result as { content: unknown };
  if (!Array.isArray(content)) {
    throw new Error("Tool result content is not an array.");
  }

  const textItem = content.find((item): item is TextContent => {
    return Boolean(
      item &&
      typeof item === "object" &&
      "type" in item &&
      (item as { type?: unknown }).type === "text" &&
      "text" in item &&
      typeof (item as { text?: unknown }).text === "string"
    );
  });

  if (!textItem) {
    throw new Error("Expected text content in tool response.");
  }

  return textItem.text;
}

function parseToolJson<T>(responseText: string): T {
  const firstDoubleNewline = responseText.indexOf("\n\n");
  if (firstDoubleNewline < 0) {
    throw new Error(
      `Tool response was not in expected format: ${responseText}`
    );
  }

  return JSON.parse(responseText.slice(firstDoubleNewline + 2)) as T;
}

function envForServer(baseUrl: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  env.TEAMBLIND_BASE_URL = baseUrl;
  env.TEAMBLIND_COOKIE_HEADER = "";

  return env;
}

test("unauthenticated MCP tools are registered and callable", async () => {
  const receivedPaths: string[] = [];

  const mockServer = createServer((req, res) => {
    receivedPaths.push(req.url ?? "");

    const responseBody =
      "Search results for 'ai-agent' - Blind\n" +
      '{"articleType":"post","title":"Offer details from Seattle"}' +
      '{"articleType":"post","title":"Negotiation strategy at scale"}';

    res.writeHead(200, {
      "Content-Type": "text/x-component"
    });
    res.end(responseBody);
  });

  mockServer.listen(0, "127.0.0.1");
  await once(mockServer, "listening");

  const address = mockServer.address();
  assert.ok(
    address && typeof address === "object",
    "mock server address should be available"
  );

  const baseUrl = `http://127.0.0.1:${address.port}`;
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
    version: "0.1.0"
  });

  try {
    await client.connect(transport);

    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((tool) => tool.name);

    assert.ok(toolNames.includes("get_server_config"));
    assert.ok(toolNames.includes("search_rsc"));
    assert.ok(!toolNames.includes("current_user"));
    assert.ok(!toolNames.includes("encrypted_post"));

    const configResult = await client.callTool({ name: "get_server_config" });
    const configText = getTextContentFromToolResult(configResult);

    const runtimeInfo = parseToolJson<{
      baseUrl: string;
      hasCookieHeader: boolean;
      allowedEncryptedPaths: string[];
    }>(configText);

    assert.equal(runtimeInfo.baseUrl, baseUrl);
    assert.equal(runtimeInfo.hasCookieHeader, false);
    assert.ok(runtimeInfo.allowedEncryptedPaths.includes("/api/current-user"));

    const searchResult = await client.callTool({
      name: "search_rsc",
      arguments: {
        query: "ai-agent",
        rscToken: "test-rsc"
      }
    });
    const searchText = getTextContentFromToolResult(searchResult);

    const parsedSearch = parseToolJson<{
      status: number;
      ok: boolean;
      url: string;
      topPostTitles: string[];
      title?: string;
      raw: string;
    }>(searchText);

    assert.equal(parsedSearch.status, 200);
    assert.equal(parsedSearch.ok, true);
    assert.ok(parsedSearch.url.includes("/search/ai-agent?_rsc=test-rsc"));
    assert.deepEqual(parsedSearch.topPostTitles, [
      "Offer details from Seattle",
      "Negotiation strategy at scale"
    ]);
    assert.ok(
      parsedSearch.title?.includes("Search results for 'ai-agent' - Blind")
    );
    assert.ok(
      receivedPaths.some((requestPath) =>
        requestPath.includes("/search/ai-agent?_rsc=test-rsc")
      ),
      "mock server should receive the expected RSC search request"
    );
  } finally {
    await client.close();
    await mockServer.closeAllConnections();
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });
  }
});
