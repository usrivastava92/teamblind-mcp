import type { AppConfig } from "./config.js";

let currentLogLevel: AppConfig["logLevel"] = "ERROR";

const LEVELS: Record<AppConfig["logLevel"], number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

export function setLogLevel(level: AppConfig["logLevel"]): void {
  currentLogLevel = level;
}

function shouldLog(level: AppConfig["logLevel"]): boolean {
  return LEVELS[level] >= LEVELS[currentLogLevel];
}

function formatMessage(level: string, message: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] [${level}] ${message}`;
}

export function debug(message: string): void {
  if (shouldLog("DEBUG")) console.error(formatMessage("DEBUG", message));
}

export function info(message: string): void {
  if (shouldLog("INFO")) console.error(formatMessage("INFO", message));
}

export function warn(message: string): void {
  if (shouldLog("WARN")) console.error(formatMessage("WARN", message));
}

export function error(message: string): void {
  if (shouldLog("ERROR")) console.error(formatMessage("ERROR", message));
}
