import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page
} from "playwright";

import type { AppConfig } from "./config.js";
import { info, debug, warn, error as logError } from "./logger.js";

interface CookieExport {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>;
}

async function ensureBrowsersInstalled(): Promise<void> {
  const execPath = chromium.executablePath();
  if (existsSync(execPath)) return;

  info(`Chromium not found at ${execPath}. Installing...`);
  try {
    execSync("npx --yes playwright install chromium", {
      stdio: "inherit",
      timeout: 120_000
    });
  } catch (err) {
    logError(`Failed to install Chromium: ${String(err)}`);
  }
}

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private _page: Page | null = null;
  private _isAuthenticated = false;

  constructor(private readonly config: AppConfig) {}

  get page(): Page {
    if (!this._page) {
      throw new Error("Browser page not initialized. Call start() first.");
    }
    return this._page;
  }

  get isAuthenticated(): boolean {
    return this._isAuthenticated;
  }

  setAuthenticated(value: boolean): void {
    this._isAuthenticated = value;
  }

  async start(): Promise<void> {
    await ensureBrowsersInstalled();

    const { profileDir, headless, viewport, timeoutMs } = this.config;

    mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    mkdirSync(dirname(this.config.cookiesFile), {
      recursive: true,
      mode: 0o700
    });

    const args = [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-infobars",
      "--disable-dev-shm-usage",
      "--disable-web-security",
      "--ignore-certificate-errors"
    ];

    if (this.config.userAgent) {
      args.push(`--user-agent=${this.config.userAgent}`);
    }

    debug(
      `Launching persistent context: headless=${headless}, profile=${profileDir}`
    );

    this.context = await chromium.launchPersistentContext(profileDir, {
      headless,
      args,
      viewport,
      locale: "en-US",
      timezoneId: "America/Los_Angeles",
      userAgent: this.config.userAgent || undefined,
      bypassCSP: true
    });

    this.context.setDefaultTimeout(timeoutMs);
    this.context.setDefaultNavigationTimeout(timeoutMs);

    await this.context.addInitScript("window.__name = function() {}");

    const pages = this.context.pages();
    if (pages.length > 0) {
      this._page = pages[0];
    } else {
      this._page = await this.context.newPage();
    }

    await this._page.evaluate("window.__name = function() {}");
    await this._page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5]
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"]
      });
      (window as unknown as Record<string, unknown>).chrome = {
        runtime: {}
      };
      (window as unknown as Record<string, unknown>).__name = () => {};
    });

    this._page.setDefaultTimeout(timeoutMs);
    this._page.setDefaultNavigationTimeout(timeoutMs);

    debug("Browser context initialized");
  }

  async close(): Promise<void> {
    try {
      if (this._page) {
        this._page = null;
      }
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      this.browser = null;
      this._isAuthenticated = false;
      info("Browser session closed");
    } catch (err) {
      warn(`Error closing browser: ${String(err)}`);
    }
  }

  async exportCookies(filePath: string): Promise<void> {
    if (!this.context) {
      throw new Error("No browser context to export cookies from");
    }

    const rawCookies = await this.context.cookies();
    const filtered = rawCookies.filter(
      (c) =>
        c.domain.includes("teamblind.com") || c.domain.includes("blind.com")
    );

    const data: CookieExport = {
      cookies: filtered.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite
      }))
    };

    writeFileSync(filePath, JSON.stringify(data, null, 2), {
      mode: 0o600
    });

    debug(`Exported ${data.cookies.length} cookies to ${filePath}`);
  }

  async importCookies(filePath: string): Promise<void> {
    if (!this.context) {
      throw new Error("No browser context to import cookies into");
    }

    if (!existsSync(filePath)) {
      debug(`No cookie file at ${filePath}, skipping import`);
      return;
    }

    const raw = readFileSync(filePath, "utf-8");
    const data: CookieExport = JSON.parse(raw);

    if (!data.cookies || data.cookies.length === 0) {
      debug("Cookie file is empty");
      return;
    }

    await this.context.addCookies(
      data.cookies.map((c) => ({
        ...c,
        expires: c.expires ?? -1
      }))
    );

    debug(`Imported ${data.cookies.length} cookies from ${filePath}`);
  }
}

let browserManager: BrowserManager | null = null;
let closingBrowser = false;

export function getBrowserManager(): BrowserManager {
  if (!browserManager) {
    throw new Error("BrowserManager not set. Call setBrowserManager() first.");
  }
  return browserManager;
}

export function setBrowserManager(manager: BrowserManager): void {
  browserManager = manager;
  closingBrowser = false;
}

export async function closeBrowser(): Promise<void> {
  if (!browserManager || closingBrowser) return;
  closingBrowser = true;
  const mgr = browserManager;
  browserManager = null;
  await mgr.close();
}

export async function getOrCreatePage(): Promise<Page> {
  return getBrowserManager().page;
}
