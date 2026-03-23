import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { AppConfig } from "./config.js";
import { BrowserManager } from "./browser.js";
import { waitForLogin } from "./auth.js";
import { info, warn, debug } from "./logger.js";

export async function interactiveLogin(config: AppConfig): Promise<void> {
  info("Opening browser for TeamBlind login...");

  const loginConfig: AppConfig = {
    ...config,
    headless: false,
    mode: "login"
  };

  const browser = new BrowserManager(loginConfig);

  try {
    await browser.start();

    await browser.page.goto(`${config.baseUrl}/`, {
      waitUntil: "domcontentloaded",
      timeout: config.timeoutMs
    });

    const loginButton = await browser.page.$(
      'a[href*="/login"], button:has-text("Sign in"), button:has-text("Log in"), a:has-text("Sign in"), a:has-text("Log in")'
    );

    if (loginButton) {
      info("Clicking login button...");
      await loginButton.click().catch(() => {
        debug("Click failed, navigating to login page directly");
      });
    } else {
      await browser.page.goto(`${config.baseUrl}/login`, {
        waitUntil: "domcontentloaded",
        timeout: config.timeoutMs
      });
    }

    await browser.page.waitForLoadState("domcontentloaded");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await waitForLogin(browser.page, config.loginTimeoutMs);

    await new Promise((resolve) => setTimeout(resolve, 2000));

    await browser.exportCookies(config.cookiesFile);

    const sourceState = {
      runtime: `${process.platform}-${process.arch}`,
      loginAt: new Date().toISOString(),
      baseUrl: config.baseUrl
    };

    const stateDir = dirname(config.sourceStateFile);
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      config.sourceStateFile,
      JSON.stringify(sourceState, null, 2),
      {
        mode: 0o600
      }
    );

    info("Login successful! Session saved. You can now use the MCP server.");
    info(`Profile stored at: ${config.profileDir}`);
  } finally {
    await browser.close();
  }
}

export function clearAuthState(config: AppConfig): void {
  info("Clearing stored authentication state...");

  const paths: string[] = [];

  if (existsSync(config.profileDir)) {
    paths.push(config.profileDir);
  }
  if (existsSync(config.cookiesFile)) {
    paths.push(config.cookiesFile);
  }
  if (existsSync(config.sourceStateFile)) {
    paths.push(config.sourceStateFile);
  }

  if (paths.length === 0) {
    info("No stored auth state found.");
    return;
  }

  for (const p of paths) {
    try {
      rmSync(p, { recursive: true, force: true });
      debug(`Removed: ${p}`);
    } catch (err) {
      warn(`Failed to remove ${p}: ${String(err)}`);
    }
  }

  info("Authentication state cleared. Run --login to create a new session.");
}

export function hasAuthState(config: AppConfig): boolean {
  const hasProfile =
    existsSync(config.profileDir) &&
    existsSync(config.cookiesFile) &&
    existsSync(config.sourceStateFile);

  if (!hasProfile) {
    return false;
  }

  try {
    const cookiesRaw = readFileSync(config.cookiesFile, "utf-8");
    const cookies = JSON.parse(cookiesRaw);
    return Array.isArray(cookies.cookies) && cookies.cookies.length > 0;
  } catch {
    return false;
  }
}
