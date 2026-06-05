import type { Page } from "playwright";

import { debug, info, warn } from "./logger.js";

function formatTimeout(timeoutMs: number): string {
  const totalSeconds = Math.floor(timeoutMs / 1000);
  if (totalSeconds % 60 === 0) {
    const minutes = totalSeconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  return `${totalSeconds} second${totalSeconds === 1 ? "" : "s"}`;
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    const currentUrl = page.url();

    if (currentUrl.includes("/login") || currentUrl.includes("/auth")) {
      debug(`Auth barrier detected by URL: ${currentUrl}`);
      return false;
    }

    const loginSelectors = [
      'a[href*="/login"]',
      'button:has-text("Sign in")',
      'button:has-text("Log in")',
      'button:has-text("Continue with")',
      '[data-testid="login-button"]',
      '[class*="login"]'
    ];

    for (const selector of loginSelectors) {
      const el = await page.$(selector);
      if (el) {
        const visible = await el.isVisible().catch(() => false);
        if (visible) {
          debug(`Found visible login element: ${selector}`);
          return false;
        }
      }
    }

    const authIndicators = [
      '[class*="header"][class*="profile"]',
      '[class*="user"][class*="avatar"]',
      '[class*="nav"][class*="user"]',
      '[data-testid="user-menu"]',
      '[class*="myMenu"]',
      'button[class*="avatar"]',
      '[class*="gnb_my"]',
      'a[href*="/my"]',
      'img[alt*="profile" i]',
      '[class*="logged"]'
    ];

    for (const selector of authIndicators) {
      const el = await page.$(selector);
      if (el) {
        const visible = await el.isVisible().catch(() => false);
        if (visible) {
          debug(`Auth success indicator found: ${selector}`);
          return true;
        }
      }
    }

    const bodyText = await page.evaluate(() => document.body.innerText || "");
    const authPatterns = [
      "Sign in",
      "Log in",
      "Welcome back",
      "Continue with Google",
      "Continue with Apple",
      "Verify it's you"
    ];

    for (const pattern of authPatterns) {
      if (bodyText.includes(pattern)) {
        debug(`Auth barrier detected by text: "${pattern}"`);
        return false;
      }
    }

    return true;
  } catch (err) {
    warn(`Auth check error: ${String(err)}`);
    return false;
  }
}

export async function ensureAuthenticated(page: Page): Promise<void> {
  const loggedIn = await isLoggedIn(page);

  if (!loggedIn) {
    info(
      "Not authenticated. Run with --login first to create a persistent session."
    );
    throw new Error(
      "Not logged into TeamBlind. Please run: teamblind-mcp --login"
    );
  }

  debug("Session is authenticated");
}

export async function waitForLogin(
  page: Page,
  timeoutMs: number
): Promise<void> {
  info(
    `Waiting for login... Please sign in using the browser window (${formatTimeout(timeoutMs)} timeout).`
  );

  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const loggedIn = await isLoggedIn(page);

    if (loggedIn) {
      info("Login detected!");
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return;
    }
  }

  throw new Error(
    `Login timeout: No login detected within ${formatTimeout(timeoutMs)}.`
  );
}
