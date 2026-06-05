import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_BASE_URL = "https://www.teamblind.com";
export const DEFAULT_USER_DATA_DIR = join(
  homedir(),
  ".config",
  "teamblind-mcp"
);
export const DEFAULT_PROFILE_DIR = join(DEFAULT_USER_DATA_DIR, "profile");
export const DEFAULT_COOKIES_FILE = join(DEFAULT_USER_DATA_DIR, "cookies.json");
export const DEFAULT_SOURCE_STATE_FILE = join(
  DEFAULT_USER_DATA_DIR,
  "source-state.json"
);

export const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
export const DEFAULT_TIMEOUT_MS = 15000;
export const DEFAULT_TOOL_TIMEOUT_SEC = 180;
export const DEFAULT_LOGIN_TIMEOUT_MS = 300_000;

export interface AppConfig {
  baseUrl: string;
  userDataDir: string;
  profileDir: string;
  cookiesFile: string;
  sourceStateFile: string;

  force: boolean;
  headless: boolean;
  timeoutMs: number;
  toolTimeoutSec: number;
  loginTimeoutMs: number;
  logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
  viewport: { width: number; height: number };
  userAgent: string;

  mode: "server" | "login" | "logout";
}

function parseArgs(): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (
      arg === "--login" ||
      arg === "--no-headless" ||
      arg === "--logout" ||
      arg === "--force"
    ) {
      result[arg.replace(/^--/, "")] = true;
    } else if (arg.startsWith("--")) {
      const key = arg.replace(/^--/, "");
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }

  return result;
}

function parseLogLevel(value: string): AppConfig["logLevel"] {
  const upper = value.toUpperCase();
  if (["DEBUG", "INFO", "WARN", "ERROR"].includes(upper)) {
    return upper as AppConfig["logLevel"];
  }
  return "ERROR";
}

export function getConfig(): AppConfig {
  const args = parseArgs();

  const mode: AppConfig["mode"] =
    args["login"] === true
      ? "login"
      : args["logout"] === true
        ? "logout"
        : "server";

  const headless =
    args["no-headless"] === true
      ? false
      : (process.env.HEADLESS ?? "true").toLowerCase() !== "false" &&
        (process.env.HEADLESS ?? "true").toLowerCase() !== "0";

  const rawLogLevel =
    (args["log-level"] as string | undefined) ?? process.env.LOG_LEVEL;

  const userDataDir =
    (args["user-data-dir"] as string | undefined) ??
    process.env.TEAMBLIND_USER_DATA_DIR ??
    DEFAULT_USER_DATA_DIR;

  const viewportRaw =
    (args["viewport"] as string | undefined) ?? process.env.VIEWPORT;
  let viewport = DEFAULT_VIEWPORT;
  if (viewportRaw) {
    const [w, h] = viewportRaw.split("x").map(Number);
    if (w && h) viewport = { width: w, height: h };
  }

  return {
    baseUrl:
      (args["base-url"] as string | undefined) ??
      process.env.TEAMBLIND_BASE_URL ??
      DEFAULT_BASE_URL,
    userDataDir,
    profileDir: join(userDataDir, "profile"),
    cookiesFile: join(userDataDir, "cookies.json"),
    sourceStateFile: join(userDataDir, "source-state.json"),

    force: args["force"] === true,
    headless: mode === "login" ? false : headless,
    timeoutMs: Number(
      args["timeout"] ?? process.env.TIMEOUT ?? DEFAULT_TIMEOUT_MS
    ),
    toolTimeoutSec: Number(
      args["tool-timeout"] ??
        process.env.TOOL_TIMEOUT ??
        DEFAULT_TOOL_TIMEOUT_SEC
    ),
    loginTimeoutMs:
      Number(
        args["login-timeout"] ??
          process.env.LOGIN_TIMEOUT ??
          DEFAULT_LOGIN_TIMEOUT_MS / 1000
      ) * 1000,
    logLevel: parseLogLevel(
      rawLogLevel ?? (mode === "server" ? "ERROR" : "INFO")
    ),
    viewport,
    userAgent:
      (args["user-agent"] as string | undefined) ??
      process.env.TEAMBLIND_USER_AGENT ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",

    mode
  };
}
