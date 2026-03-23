import { constants, publicEncrypt, randomBytes } from "node:crypto";

import sjcl from "sjcl";

import type { TeamBlindConfig } from "./config.js";

const DEFAULT_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9"
} as const;

const ALLOWED_ENCRYPTED_PATHS = [
  "/api/current-user",
  "/api/current-user/company",
  "/api/recent-channels",
  "/api/recent-channels/add",
  "/api/company/company-page-basic",
  "/api/company/company-page-suggestion",
  "/api/company/company-review-suggestion",
  "/api/company/merged-company-list",
  "/api/notifications",
  "/api/jobs",
  "/api/jobs/bookmarks",
  "/api/jobs/suggestions/search-bar",
  "/api/jobs/suggestions/location",
  "/api/jobs/suggestions/company",
  "/api/jobs/suggestions/skill",
  "/api/ad-targeting/tc-summary",
  "/api/ad-targeting/review-history",
  "/api/report-options/company-review"
] as const;

export type AllowedEncryptedPath = (typeof ALLOWED_ENCRYPTED_PATHS)[number];

export type EncryptedRequestResult = {
  status: number;
  ok: boolean;
  endpoint: string;
  requestBody: unknown;
  decrypted: unknown;
  encryptedResponse: string;
};

export type SearchRscResult = {
  status: number;
  ok: boolean;
  url: string;
  title?: string;
  topPostTitles: string[];
  raw: string;
};

export function getAllowedEncryptedPaths(): readonly AllowedEncryptedPath[] {
  return ALLOWED_ENCRYPTED_PATHS;
}

function ensureAllowedPath(path: string): asserts path is AllowedEncryptedPath {
  const normalized = path.split("?")[0];
  if (!ALLOWED_ENCRYPTED_PATHS.includes(normalized as AllowedEncryptedPath)) {
    throw new Error(`Path is not allowlisted: ${path}`);
  }
}

function buildUrl(baseUrl: string, path: string): URL {
  return new URL(path, baseUrl);
}

function generateSymmetricKey(): string {
  return randomBytes(32).toString("hex");
}

function encryptClientKey(publicKey: string, symmetricKey: string): string {
  const encrypted = publicEncrypt(
    {
      key: publicKey,
      padding: constants.RSA_PKCS1_PADDING
    },
    Buffer.from(symmetricKey, "utf8")
  );

  return encrypted.toString("base64");
}

function decodeEncryptedResponse(rawText: string): string {
  const parsed = JSON.parse(rawText);
  if (typeof parsed !== "string") {
    throw new Error("Expected encrypted response payload to be a JSON string.");
  }

  return parsed;
}

function parseMaybeJson(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
}

function excerpt(value: string, length = 500): string {
  return value.length <= length ? value : `${value.slice(0, length)}...`;
}

export class TeamBlindClient {
  constructor(private readonly config: TeamBlindConfig) {}

  getRuntimeInfo() {
    return {
      baseUrl: this.config.baseUrl,
      hasCookieHeader: Boolean(this.config.cookieHeader),
      userAgent: this.config.userAgent,
      allowedEncryptedPaths: [...ALLOWED_ENCRYPTED_PATHS]
    };
  }

  async encryptedPost(
    path: string,
    body: unknown = {}
  ): Promise<EncryptedRequestResult> {
    ensureAllowedPath(path);

    const endpoint = buildUrl(this.config.baseUrl, path).toString();
    const symmetricKey = generateSymmetricKey();
    const payload = sjcl.encrypt(symmetricKey, JSON.stringify(body ?? {}));
    const encClientKey = encryptClientKey(
      this.config.rsaPublicKey,
      symmetricKey
    );

    const headers = new Headers({
      ...DEFAULT_HEADERS,
      "Content-Type": "text/plain;charset=UTF-8",
      Origin: this.config.baseUrl,
      Referer: `${this.config.baseUrl}/`,
      "User-Agent": this.config.userAgent
    });

    if (this.config.cookieHeader) {
      headers.set("Cookie", this.config.cookieHeader);
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ payload, encClientKey })
    });

    const rawText = await response.text();

    if (!response.ok) {
      throw new Error(
        `TeamBlind returned ${response.status} for ${path}: ${excerpt(rawText)}`
      );
    }

    const encryptedResponse = decodeEncryptedResponse(rawText);
    const decryptedText = sjcl.decrypt(symmetricKey, encryptedResponse);

    return {
      status: response.status,
      ok: response.ok,
      endpoint,
      requestBody: body,
      decrypted: parseMaybeJson(decryptedText),
      encryptedResponse
    };
  }

  async searchRsc(query: string, rscToken = "173bf"): Promise<SearchRscResult> {
    const encodedQuery = encodeURIComponent(query.trim());
    const url = buildUrl(
      this.config.baseUrl,
      `/search/${encodedQuery}?_rsc=${encodeURIComponent(rscToken)}`
    );

    const headers = new Headers({
      Accept: "text/x-component",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: `${this.config.baseUrl}/`,
      "User-Agent": this.config.userAgent,
      "Next-Url": "/",
      Rsc: "1"
    });

    if (this.config.cookieHeader) {
      headers.set("Cookie", this.config.cookieHeader);
    }

    const response = await fetch(url, {
      method: "GET",
      headers
    });

    const raw = await response.text();
    const title = raw.match(/Search results for '([^']+)' - Blind/)?.[0];
    const topPostTitles = Array.from(
      raw.matchAll(/"articleType":"post".*?"title":"([^"]+)"/gs)
    )
      .slice(0, 10)
      .map((match) => match[1])
      .filter((value): value is string => Boolean(value));

    return {
      status: response.status,
      ok: response.ok,
      url: url.toString(),
      title,
      topPostTitles,
      raw
    };
  }
}
