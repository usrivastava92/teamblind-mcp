import assert from "node:assert/strict";
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

test("unauthenticated MCP tools are registered and callable against real TeamBlind", async () => {
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
    version: "0.1.0"
  });

  try {
    await client.connect(transport);

    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((tool) => tool.name);

    assert.ok(toolNames.includes("search"));
    assert.ok(toolNames.includes("fetch_post"));
    assert.ok(!toolNames.includes("get_server_config"));
    assert.ok(!toolNames.includes("current_user"));
    assert.ok(!toolNames.includes("encrypted_post"));

    const searchResult = await client.callTool({
      name: "search",
      arguments: {
        query: "ai-agent"
      }
    });
    const searchText = getTextContentFromToolResult(searchResult);

    const parsedSearch = parseToolJson<{
      status: number;
      ok: boolean;
      url: string;
      topPosts: Array<{
        title: string;
        slug: string;
        content?: string;
        commentCount?: number;
      }>;
      title?: string;
    }>(searchText);

    assert.equal(parsedSearch.ok, true);
    assert.ok(parsedSearch.status >= 200 && parsedSearch.status < 300);
    assert.ok(parsedSearch.url.includes("/search/ai-agent?_rsc=173bf"));
    assert.ok(parsedSearch.topPosts.length > 0);
    assert.ok(
      parsedSearch.topPosts.every(
        (post) => typeof post.title === "string" && post.title.length > 0
      )
    );
    assert.ok(
      parsedSearch.topPosts.every(
        (post) => typeof post.slug === "string" && post.slug.length > 0
      )
    );
    assert.ok(
      parsedSearch.topPosts.some((post) => typeof post.content === "string")
    );

    const firstPostWithSlug = parsedSearch.topPosts.find(
      (post) => typeof post.slug === "string" && post.slug.length > 0
    );
    assert.ok(firstPostWithSlug, "expected at least one post with slug");

    const fetchPostResult = await client.callTool({
      name: "fetch_post",
      arguments: {
        slug: firstPostWithSlug.slug
      }
    });
    const fetchPostText = getTextContentFromToolResult(fetchPostResult);

    const parsedPost = parseToolJson<{
      status: number;
      ok: boolean;
      slug: string;
      url: string;
      post?: {
        title: string;
        slug: string;
        content?: string;
      };
      commentsPreview: Array<{
        id: number;
        content?: string;
      }>;
      totalComments?: number;
    }>(fetchPostText);

    assert.equal(parsedPost.ok, true);
    assert.ok(parsedPost.status >= 200 && parsedPost.status < 300);
    assert.equal(parsedPost.slug, firstPostWithSlug.slug);
    assert.ok(
      parsedPost.url.includes(`/post/${firstPostWithSlug.slug}?_rsc=173bf`)
    );
    assert.equal(parsedPost.post?.slug, firstPostWithSlug.slug);
    assert.ok(typeof parsedPost.post?.title === "string");
    assert.ok(typeof parsedPost.post?.content === "string");
    assert.ok(Array.isArray(parsedPost.commentsPreview));
  } finally {
    await transport.close();
  }
});
