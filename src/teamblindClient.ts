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
  topPosts: SearchPostSummary[];
};

export type FetchPostRscResult = {
  status: number;
  ok: boolean;
  slug: string;
  url: string;
  post?: PostSummary;
  commentsPreview: PostCommentSummary[];
  totalComments?: number;
};

export type TeamBlindChannelSummary = {
  id?: number;
  displayName?: string;
  groupName?: string;
  url?: string;
};

export type TeamBlindCompanySummary = {
  name?: string;
  urlAlias?: string;
  logoImgUrl?: string;
};

export type SearchPostSummary = {
  title: string;
  slug: string;
  content?: string;
  author?: string;
  authorCompany?: string;
  createdAt?: string;
  likeCount?: number;
  commentCount?: number;
  viewCount?: number;
  channel?: TeamBlindChannelSummary;
  company?: TeamBlindCompanySummary;
};

export type PostSummary = SearchPostSummary;

export type PostCommentSummary = {
  id: number;
  parentCommentId: number;
  author?: string;
  authorCompany?: string;
  createdAt?: string;
  writtenAt?: string;
  likeCount?: number;
  content?: string;
  isOp?: boolean;
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

function decodeJsonText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}

function extractStringField(
  snippet: string,
  field: string
): string | undefined {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = snippet.match(
    new RegExp(`"${escapedField}":"((?:\\\\.|[^"\\\\])*)"`)
  );

  return decodeJsonText(match?.[1]);
}

function extractNumberField(
  snippet: string,
  field: string
): number | undefined {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = snippet.match(new RegExp(`"${escapedField}":(\\d+)`));

  return match ? Number(match[1]) : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function extractChannelSummary(
  snippet: string
): TeamBlindChannelSummary | undefined {
  const marker = '"channelDetails":{';
  const startIndex = snippet.indexOf(marker);
  if (startIndex < 0) {
    return undefined;
  }

  const channelSnippet = snippet.slice(startIndex, startIndex + 600);
  const channel = compactObject({
    id: extractNumberField(channelSnippet, "channelId"),
    displayName: extractStringField(channelSnippet, "displayName"),
    groupName: extractStringField(channelSnippet, "groupName"),
    url: extractStringField(channelSnippet, "url")
  });

  return Object.keys(channel).length > 0 ? channel : undefined;
}

function extractCompanySummary(
  snippet: string
): TeamBlindCompanySummary | undefined {
  const marker = '"companyPage":{';
  const startIndex = snippet.indexOf(marker);
  if (startIndex < 0) {
    return undefined;
  }

  const companySnippet = snippet.slice(startIndex, startIndex + 400);
  const company = compactObject({
    name:
      extractStringField(snippet, "memberCompanyName") ??
      extractStringField(snippet, "companyName"),
    urlAlias: extractStringField(companySnippet, "urlAlias"),
    logoImgUrl: extractStringField(companySnippet, "logoImgUrl")
  });

  return Object.keys(company).length > 0 ? company : undefined;
}

function extractPostSummaryFromSnippet(
  snippet: string
): SearchPostSummary | undefined {
  const title = extractStringField(snippet, "title");
  const slug =
    extractStringField(snippet, "titleUrlPath")
      ?.replace(/^\/post\//, "")
      .replace(/^\/+|\/+$/g, "") ?? extractStringField(snippet, "alias");

  if (!title || !slug) {
    return undefined;
  }

  const summary = compactObject({
    title,
    slug,
    content:
      extractStringField(snippet, "content") ??
      extractStringField(snippet, "contentRaw"),
    author: extractStringField(snippet, "memberNickname"),
    authorCompany:
      extractStringField(snippet, "memberCompanyName") ??
      extractStringField(snippet, "companyName"),
    createdAt:
      extractStringField(snippet, "createdAt") ??
      extractStringField(snippet, "createDate"),
    likeCount: extractNumberField(snippet, "likeCnt"),
    commentCount: extractNumberField(snippet, "commentCnt"),
    viewCount: extractNumberField(snippet, "viewCnt"),
    channel: extractChannelSummary(snippet),
    company: extractCompanySummary(snippet)
  });

  return summary;
}

function extractPostSnippetBySlug(
  raw: string,
  slug: string
): string | undefined {
  const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`"titleUrlPath":"/post/${escapedSlug}"`),
    new RegExp(`"scheme":"/article/${escapedSlug}"`),
    new RegExp(`"alias":"${escapedSlug}"`),
    new RegExp(`"articleAlias":"${escapedSlug}"`)
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    if (!match || match.index === undefined) {
      continue;
    }

    const start = Math.max(0, match.index - 1200);
    const end = Math.min(raw.length, match.index + 6000);
    return raw.slice(start, end);
  }

  return undefined;
}

function extractTitleFromPostMetadata(raw: string): string | undefined {
  const headTitle = raw.match(
    /\["\$","title","0",\{"children":"((?:\\.|[^"\\])*) \| [^"]+ - Blind"\}\]/
  )?.[1];

  if (headTitle) {
    return decodeJsonText(headTitle);
  }

  const ogTitle = raw.match(
    /"property":"og:title","content":"((?:\\.|[^"\\])*) \| [^"]+ - Blind"/
  )?.[1];

  return decodeJsonText(ogTitle);
}

function extractContentFromPostMetadata(raw: string): string | undefined {
  const description = raw.match(
    /"name":"description","content":"((?:\\.|[^"\\])*)"/
  )?.[1];

  return decodeJsonText(description)?.trim();
}

function extractChannelFromPostMetadata(
  raw: string
): TeamBlindChannelSummary | undefined {
  const titleMatch = raw.match(
    /\["\$","title","0",\{"children":"(?:\\.|[^"\\])* \| ((?:\\.|[^"\\])*) - Blind"\}\]/
  );

  const displayName = decodeJsonText(titleMatch?.[1]);
  if (!displayName) {
    return undefined;
  }

  return { displayName };
}

function extractRootPostFromRaw(
  raw: string,
  slug: string
): PostSummary | undefined {
  const title = extractTitleFromPostMetadata(raw);
  const content = extractContentFromPostMetadata(raw);

  if (!title) {
    return undefined;
  }

  return compactObject({
    title,
    slug,
    content,
    author: extractStringField(raw, "originalAuthorNickname"),
    channel: extractChannelFromPostMetadata(raw)
  }) as PostSummary;
}

function extractCommentPreview(raw: string): PostCommentSummary[] {
  const results: PostCommentSummary[] = [];
  const commentRegex =
    /"id":(\d+),"parentCommentId":(\d+),"memberNickname":"((?:\\.|[^"\\])*)"[\s\S]*?"likeCnt":(\d+)[\s\S]*?"isOp":(true|false)[\s\S]*?"createDate":"((?:\\.|[^"\\])*)"[\s\S]*?"writedAt":"((?:\\.|[^"\\])*)"[\s\S]*?"companyName":"((?:\\.|[^"\\])*)"[\s\S]*?"contentRaw":"((?:\\.|[^"\\])*)"/g;

  for (const match of raw.matchAll(commentRegex)) {
    results.push(
      compactObject({
        id: Number(match[1]),
        parentCommentId: Number(match[2]),
        author: decodeJsonText(match[3]),
        likeCount: Number(match[4]),
        isOp: match[5] === "true",
        createdAt: decodeJsonText(match[6]),
        writtenAt: decodeJsonText(match[7]),
        authorCompany: decodeJsonText(match[8]),
        content: decodeJsonText(match[9])
      }) as PostCommentSummary
    );

    if (results.length >= 10) {
      break;
    }
  }

  return results;
}

const DEFAULT_RSC_TOKEN = "173bf";

function extractTopPostSummaries(raw: string): SearchPostSummary[] {
  const results: SearchPostSummary[] = [];
  const postMarkerRegex = /"articleType":"post"/g;
  const maxWindowLength = 3000;
  const maxResults = 10;

  for (const match of raw.matchAll(postMarkerRegex)) {
    if (results.length >= maxResults) {
      break;
    }

    const startIndex = match.index ?? 0;
    const snippet = raw.slice(startIndex, startIndex + maxWindowLength);
    const postSummary = extractPostSummaryFromSnippet(snippet);

    if (postSummary) {
      results.push(postSummary);
    }
  }

  return results;
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

  async searchRsc(query: string): Promise<SearchRscResult> {
    const encodedQuery = encodeURIComponent(query.trim());
    const url = buildUrl(
      this.config.baseUrl,
      `/search/${encodedQuery}?_rsc=${encodeURIComponent(DEFAULT_RSC_TOKEN)}`
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
    const topPosts = extractTopPostSummaries(raw);

    return {
      status: response.status,
      ok: response.ok,
      url: url.toString(),
      title,
      topPosts
    };
  }

  async fetchPostRsc(slug: string): Promise<FetchPostRscResult> {
    const normalizedSlug = slug.trim().replace(/^\/+|\/+$/g, "");
    const url = buildUrl(
      this.config.baseUrl,
      `/post/${encodeURIComponent(normalizedSlug)}?_rsc=${encodeURIComponent(DEFAULT_RSC_TOKEN)}`
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
    const postSnippet = extractPostSnippetBySlug(raw, normalizedSlug);
    const post =
      extractRootPostFromRaw(raw, normalizedSlug) ??
      (postSnippet ? extractPostSummaryFromSnippet(postSnippet) : undefined);
    const commentsPreview = extractCommentPreview(raw);
    const totalComments = extractNumberField(raw, "totalCount");

    return {
      status: response.status,
      ok: response.ok,
      slug: normalizedSlug,
      url: url.toString(),
      post,
      commentsPreview,
      totalComments
    };
  }
}
