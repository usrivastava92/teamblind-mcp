#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3";

import { getConfig } from "./config.js";
import { setLogLevel, info, debug, error } from "./logger.js";
import {
  BrowserManager,
  setBrowserManager,
  closeBrowser,
  getBrowserManager
} from "./browser.js";
import { isLoggedIn } from "./auth.js";
import { clearAuthState, hasAuthState, interactiveLogin } from "./setup.js";
import {
  extractSearchResults,
  extractPost,
  extractFeed,
  extractCompanyChannel,
  extractCompanyChannels,
  scrollFeed
} from "./scraper.js";

const config = getConfig();
setLogLevel(config.logLevel);

let toolLock = Promise.resolve();

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

async function getReadyPage(): Promise<{
  page: import("playwright").Page;
  browser: BrowserManager;
}> {
  const browser = getBrowserManager();
  const page = browser.page;

  await page.evaluate("window.__name = function() {}");

  const url = page.url();
  if (!url || url === "about:blank") {
    debug("Page is blank, navigating to base URL");
    await page.goto(config.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.timeoutMs
    });
    await page.waitForTimeout(2000);
  }

  const loggedIn = await isLoggedIn(page);
  browser.setAuthenticated(loggedIn);

  if (!loggedIn) {
    throw new Error(
      "Not logged into TeamBlind. Please run: teamblind-mcp --login"
    );
  }

  return { page, browser };
}

function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "teamblind-mcp",
      version: "0.2.0"
    },
    {
      capabilities: {
        logging: {}
      }
    }
  );

  server.registerTool(
    "search",
    {
      title: "Search TeamBlind",
      description:
        "Search TeamBlind for posts matching a query. Returns extracted post summaries including title, author, company, content preview, and stats.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Search term, for example 'layoffs'.")
      })
    },
    async ({ query }: { query: string }) => {
      const prev = toolLock;
      let release: () => void;
      toolLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await prev;

        const { page } = await getReadyPage();
        const result = await extractSearchResults(page, config, query);
        return jsonResult(
          `Search results for "${query}": found ${result.posts.length} posts`,
          result
        );
      } finally {
        release!();
      }
    }
  );

  server.registerTool(
    "fetch_post",
    {
      title: "Fetch TeamBlind Post",
      description:
        "Fetch a TeamBlind post by its slug (the unique identifier in the URL). Returns post details and comments.",
      inputSchema: z.object({
        slug: z
          .string()
          .min(1)
          .describe(
            'Post slug from search results or URL, e.g. "layoffs-at-big-tech-abc123".'
          )
      })
    },
    async ({ slug }: { slug: string }) => {
      const prev = toolLock;
      let release: () => void;
      toolLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await prev;

        const { page } = await getReadyPage();
        const result = await extractPost(page, config, slug);
        return jsonResult(`Fetched post "${slug}"`, result);
      } finally {
        release!();
      }
    }
  );

  server.registerTool(
    "get_feed",
    {
      title: "Get TeamBlind Feed",
      description:
        "Get recent posts from the authenticated user's TeamBlind home feed. Scrolls to load more content.",
      inputSchema: z.object({
        scrollCount: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(3)
          .describe("Number of times to scroll to load more feed items (1-10).")
      })
    },
    async ({ scrollCount }: { scrollCount: number }) => {
      const prev = toolLock;
      let release: () => void;
      toolLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await prev;

        const { page } = await getReadyPage();
        await scrollFeed(page, scrollCount);
        const result = await extractFeed(page, config);
        return jsonResult(`Feed: found ${result.posts.length} posts`, result);
      } finally {
        release!();
      }
    }
  );

  server.registerTool(
    "list_my_companies",
    {
      title: "List My Companies",
      description:
        "List company private channels you have access to on TeamBlind. Returns company names and aliases."
    },
    async () => {
      const prev = toolLock;
      let release: () => void;
      toolLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await prev;

        const { page } = await getReadyPage();
        const result = await extractCompanyChannels(page);
        return jsonResult(`Found ${result.companies.length} companies`, result);
      } finally {
        release!();
      }
    }
  );

  server.registerTool(
    "get_company_channel",
    {
      title: "Get Company Channel Posts",
      description:
        "Get posts from a company's private channel on TeamBlind. Requires being authenticated as an employee of that company. Use the company alias (e.g. 'Google') from list_my_companies.",
      inputSchema: z.object({
        company: z
          .string()
          .min(1)
          .describe(
            'Company alias from list_my_companies, e.g. "Google" or "Meta".'
          ),
        scrollCount: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(3)
          .describe("Number of times to scroll to load more posts (1-10).")
      })
    },
    async ({
      company,
      scrollCount
    }: {
      company: string;
      scrollCount: number;
    }) => {
      const prev = toolLock;
      let release: () => void;
      toolLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await prev;

        const { page } = await getReadyPage();
        await page.goto(
          `${config.baseUrl}/private/${encodeURIComponent(company.trim())}`,
          {
            waitUntil: "domcontentloaded",
            timeout: config.timeoutMs
          }
        );
        await page
          .waitForLoadState("networkidle", { timeout: config.timeoutMs })
          .catch(() => {});
        await page.waitForTimeout(2000);

        await scrollFeed(page, scrollCount);
        const result = await extractCompanyChannel(page, config, company);
        return jsonResult(
          `Channel "${company}": found ${result.posts.length} posts`,
          result
        );
      } finally {
        release!();
      }
    }
  );

  server.registerTool(
    "close_session",
    {
      title: "Close Browser Session",
      description:
        "Close the browser session and clean up resources. Saves cookies before closing."
    },
    async () => {
      const prev = toolLock;
      let release: () => void;
      toolLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await prev;
        await closeBrowser();
        return jsonResult("Session closed", { closed: true });
      } finally {
        release!();
      }
    }
  );

  return server;
}

async function startMCP(): Promise<void> {
  if (!hasAuthState(config)) {
    error("No authentication state found. Please run: teamblind-mcp --login");
    process.exit(1);
  }

  info("Starting TeamBlind MCP server...");
  info(`Profile: ${config.profileDir}`);

  const browser = new BrowserManager(config);
  await browser.start();

  setBrowserManager(browser);

  let cleaningUp = false;
  const cleanup = async (signal: string) => {
    if (cleaningUp) return;
    cleaningUp = true;
    debug(`Shutting down on ${signal}...`);
    await closeBrowser();
    process.exit(0);
  };

  process.on("SIGINT", () => cleanup("SIGINT"));
  process.on("SIGTERM", () => cleanup("SIGTERM"));
  process.on("SIGHUP", () => cleanup("SIGHUP"));
  process.on("exit", () => {
    if (!cleaningUp) {
      closeBrowser().catch(() => {});
    }
  });
  process.on("uncaughtException", async (err) => {
    error(`Crash: ${String(err)}`);
    await cleanup("uncaughtException");
  });
  process.on("unhandledRejection", async (reason) => {
    error(`Unhandled rejection: ${String(reason)}`);
    await cleanup("unhandledRejection");
  });

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("TeamBlind MCP stdio server is ready.");
}

async function main(): Promise<void> {
  if (config.mode === "login") {
    if (config.force) {
      info("Force login requested. Clearing stored authentication state...");
      clearAuthState(config);
    }

    await interactiveLogin(config);
    return;
  }

  if (config.mode === "logout") {
    clearAuthState(config);
    return;
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    const hasArgs = process.argv.slice(2).length > 0;
    if (!hasArgs) {
      console.error("TeamBlind MCP Server v0.2.0");
      console.error("");
      console.error("Usage:");
      console.error(
        "  teamblind-mcp --login     Interactive login (opens browser)"
      );
      console.error("  teamblind-mcp --login --force");
      console.error(
        "                           Clear saved session before logging in"
      );
      console.error("  teamblind-mcp --logout    Clear stored authentication");
      console.error("  teamblind-mcp [--no-headless] [--log-level DEBUG]");
      console.error("                           Start MCP server (stdio)");
      process.exit(0);
    }
  }

  await startMCP();
}

main().catch((err) => {
  error(`Fatal error: ${String(err)}`);
  process.exit(1);
});
