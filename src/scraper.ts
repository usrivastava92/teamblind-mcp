import type { Page } from "playwright";

import type { AppConfig } from "./config.js";
import { debug, warn } from "./logger.js";

export interface PostSummary {
  title: string;
  slug: string;
  content?: string;
  author?: string;
  authorCompany?: string;
  createdAt?: string;
  likeCount?: number;
  commentCount?: number;
  viewCount?: number;
  channel?: { displayName?: string; groupName?: string };
  company?: { name?: string; urlAlias?: string };
}

export interface CommentSummary {
  id?: string;
  author?: string;
  authorCompany?: string;
  createdAt?: string;
  likeCount?: number;
  content?: string;
  isOp?: boolean;
}

export interface SearchResult {
  url: string;
  query: string;
  totalResults?: number;
  posts: PostSummary[];
}

export interface PostResult {
  url: string;
  slug: string;
  post?: PostSummary;
  comments: CommentSummary[];
  totalComments?: number;
}

export interface FeedResult {
  url: string;
  posts: PostSummary[];
}

export interface ChannelResult {
  url: string;
  company: string;
  posts: PostSummary[];
}

export interface CompanyListResult {
  url: string;
  companies: Array<{ name: string; alias: string }>;
}

export async function extractSearchResults(
  page: Page,
  config: AppConfig,
  query: string
): Promise<SearchResult> {
  const encodedQuery = encodeURIComponent(query.trim());
  const url = `${config.baseUrl}/search/${encodedQuery}`;

  debug(`Navigating to search: ${url}`);
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: config.timeoutMs
  });

  await page
    .waitForLoadState("networkidle", { timeout: config.timeoutMs })
    .catch(() => {
      debug("Network idle timeout - continuing anyway");
    });

  await page.waitForTimeout(2000);

  const posts = await extractPostsFromPage(page);

  return {
    url: page.url(),
    query,
    posts
  };
}

export async function extractPost(
  page: Page,
  config: AppConfig,
  slug: string
): Promise<PostResult> {
  const normalizedSlug = slug.trim().replace(/^\/+|\/+$/g, "");
  const url = `${config.baseUrl}/post/${encodeURIComponent(normalizedSlug)}`;

  debug(`Navigating to post: ${url}`);
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: config.timeoutMs
  });

  await page
    .waitForLoadState("networkidle", { timeout: config.timeoutMs })
    .catch(() => {
      debug("Network idle timeout - continuing anyway");
    });

  await page.waitForTimeout(2000);

  const post = await extractMainPost(page);
  const { comments, totalComments } = await extractComments(page);

  return {
    url: page.url(),
    slug: normalizedSlug,
    post,
    comments,
    totalComments
  };
}

export async function extractFeed(
  page: Page,
  config: AppConfig
): Promise<FeedResult> {
  debug(`Navigating to feed: ${config.baseUrl}/`);
  await page.goto(`${config.baseUrl}/`, {
    waitUntil: "domcontentloaded",
    timeout: config.timeoutMs
  });

  await page
    .waitForLoadState("networkidle", { timeout: config.timeoutMs })
    .catch(() => {
      debug("Network idle timeout - continuing anyway");
    });

  await page.waitForTimeout(2000);

  const posts = await extractPostsFromPage(page);

  return {
    url: page.url(),
    posts
  };
}

async function extractPostsFromPage(page: Page): Promise<PostSummary[]> {
  try {
    const posts = await page.evaluate(() => {
      const results: Array<Record<string, unknown>> = [];

      const postElements = document.querySelectorAll(
        '[class*="article"], [class*="post"], [class*="card"], [data-testid*="post"], [data-testid*="article"], [class*="feed-item"]'
      );

      if (postElements.length === 0) {
        const articles = document.querySelectorAll("article");
        articles.forEach((article) => extractPostFromElement(article, results));
      } else {
        postElements.forEach((el) => extractPostFromElement(el, results));
      }

      if (results.length === 0) {
        const bodyText = document.body.innerText || "";
        const rscData = bodyText;

        const postRegex = /"titleUrlPath":"\/post\/([^"]+)"/g;
        const titleRegex = /"title":"((?:\\.|[^"\\])*)"/g;
        const contentRegex = /"content(?:Raw)?":"((?:\\.|[^"\\])*)"/g;
        const authorRegex = /"memberNickname":"((?:\\.|[^"\\])*)"/g;
        const companyRegex =
          /"(?:memberCompanyName|companyName)":"((?:\\.|[^"\\])*)"/g;

        let match;
        const slugs: string[] = [];
        while ((match = postRegex.exec(rscData)) !== null) {
          if (!slugs.includes(match[1])) slugs.push(match[1]);
        }

        const titles: string[] = [];
        while ((match = titleRegex.exec(rscData)) !== null) {
          const decoded = tryDecodeJsonString(match[1]);
          if (decoded && !titles.includes(decoded)) titles.push(decoded);
        }

        const contents: string[] = [];
        while ((match = contentRegex.exec(rscData)) !== null) {
          const decoded = tryDecodeJsonString(match[1]);
          if (decoded && !contents.includes(decoded)) contents.push(decoded);
        }

        const authors: string[] = [];
        while ((match = authorRegex.exec(rscData)) !== null) {
          const decoded = tryDecodeJsonString(match[1]);
          if (decoded && !authors.includes(decoded)) authors.push(decoded);
        }

        const companies: string[] = [];
        while ((match = companyRegex.exec(rscData)) !== null) {
          const decoded = tryDecodeJsonString(match[1]);
          if (decoded && !companies.includes(decoded)) companies.push(decoded);
        }

        for (let i = 0; i < Math.min(slugs.length, 20); i++) {
          results.push({
            title: titles[i] || "",
            slug: slugs[i] || "",
            author: authors[i],
            authorCompany: companies[i],
            content: contents[i]
          });
        }
      }

      return results;

      function tryDecodeJsonString(s: string): string {
        try {
          return JSON.parse(`"${s}"`);
        } catch {
          return s
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\t/g, "\t")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\");
        }
      }

      function extractPostFromElement(
        el: Element,
        results: Array<Record<string, unknown>>
      ): void {
        const titleEl =
          el.querySelector("h1, h2, h3, h4, [class*='title']") ||
          el.querySelector("a[href*='/post/']");
        const linkEl = el.querySelector("a[href*='/post/']");
        const authorEl = el.querySelector(
          "[class*='author'], [class*='nickname'], [class*='user']"
        );
        const companyEl = el.querySelector("[class*='company']");
        const contentEl = el.querySelector(
          "[class*='content'], [class*='body'], [class*='text'], p"
        );
        const likeEl = el.querySelector("[class*='like'], [class*='upvote']");
        const commentEl = el.querySelector("[class*='comment']");
        const viewEl = el.querySelector("[class*='view']");

        const href = linkEl?.getAttribute("href") || "";
        const slugMatch = href.match(/\/post\/([^/?]+)/);
        const slug = slugMatch ? slugMatch[1] : "";

        const title = titleEl?.textContent?.trim() || "";

        if (!slug && !title) return;

        const likeText = likeEl?.textContent?.trim() || "";
        const commentText = commentEl?.textContent?.trim() || "";
        const viewText = viewEl?.textContent?.trim() || "";

        results.push({
          title,
          slug,
          content: contentEl?.textContent?.trim()?.slice(0, 1000),
          author: authorEl?.textContent?.trim(),
          authorCompany: companyEl?.textContent?.trim(),
          likeCount: parseNumber(likeText),
          commentCount: parseNumber(commentText),
          viewCount: parseNumber(viewText)
        });
      }

      function parseNumber(text: string): number | undefined {
        const match = text.match(/[\d,]+/);
        if (!match) return undefined;
        return parseInt(match[0].replace(/,/g, ""), 10);
      }
    });

    return posts.map(maybePostSummary);
  } catch (err) {
    warn(`Error extracting posts: ${String(err)}`);
    return [];
  }
}

async function extractMainPost(page: Page): Promise<PostSummary | undefined> {
  try {
    const post = await page.evaluate(() => {
      const article = document.querySelector(
        "article, [class*='article'], [class*='post-detail'], main"
      );

      const titleEl = article?.querySelector("h1, h2, h3, [class*='title']");
      const authorEl = article?.querySelector(
        "[class*='author'], [class*='nickname'], [class*='user']"
      );
      const companyEl = article?.querySelector("[class*='company']");
      const contentEl = article?.querySelector(
        "[class*='content'], [class*='body'], [class*='text']"
      );
      const likeEl = article?.querySelector(
        "[class*='like'], [class*='upvote']"
      );
      const commentEl = article?.querySelector("[class*='comment-count']");
      const viewEl = article?.querySelector("[class*='view']");
      const timeEl = article?.querySelector(
        "time, [class*='date'], [class*='time']"
      );

      if (!article && !titleEl) {
        const headTitle = document.querySelector("title");
        const ogTitle = document.querySelector('meta[property="og:title"]');
        const ogDesc = document.querySelector(
          'meta[property="og:description"]'
        );
        const titleText =
          headTitle?.textContent?.split(" | ")[0]?.trim() ||
          ogTitle?.getAttribute("content")?.split(" | ")[0]?.trim() ||
          "";

        return {
          title: titleText,
          slug: window.location.pathname
            .replace(/^\/post\//, "")
            .replace(/\/$/, ""),
          content: ogDesc?.getAttribute("content")?.trim(),
          author: "",
          authorCompany: "",
          createdAt: "",
          likeCount: 0,
          commentCount: 0,
          viewCount: 0
        };
      }

      const title =
        titleEl?.textContent?.trim() ||
        document.title.split(" | ")[0]?.trim() ||
        "";

      return {
        title,
        slug: window.location.pathname
          .replace(/^\/post\//, "")
          .replace(/\/$/, ""),
        content: contentEl?.textContent?.trim()?.slice(0, 5000),
        author: authorEl?.textContent?.trim(),
        authorCompany: companyEl?.textContent?.trim(),
        createdAt:
          timeEl?.getAttribute("datetime") || timeEl?.textContent?.trim(),
        likeCount: parseNumberFromText(likeEl?.textContent || ""),
        commentCount: parseNumberFromText(commentEl?.textContent || ""),
        viewCount: parseNumberFromText(viewEl?.textContent || "")
      };

      function parseNumberFromText(text: string): number | undefined {
        const match = text.match(/[\d,]+/);
        if (!match) return undefined;
        return parseInt(match[0].replace(/,/g, ""), 10);
      }
    });

    return maybePostSummary(post);
  } catch (err) {
    warn(`Error extracting main post: ${String(err)}`);
    return undefined;
  }
}

async function extractComments(page: Page): Promise<{
  comments: CommentSummary[];
  totalComments?: number;
}> {
  try {
    const result = await page.evaluate(() => {
      const comments: Array<Record<string, unknown>> = [];

      const commentElements = document.querySelectorAll(
        '[class*="comment"], [class*="reply"], [data-testid*="comment"]'
      );

      commentElements.forEach((el) => {
        const authorEl = el.querySelector(
          "[class*='author'], [class*='nickname'], [class*='user']"
        );
        const companyEl = el.querySelector("[class*='company']");
        const contentEl = el.querySelector(
          "[class*='content'], [class*='body'], [class*='text'], p"
        );
        const timeEl = el.querySelector(
          "time, [class*='date'], [class*='time']"
        );
        const likeEl = el.querySelector("[class*='like'], [class*='upvote']");
        const opBadge = el.querySelector(
          "[class*='op'], [class*='author-badge']"
        );

        const commentText = contentEl?.textContent?.trim();
        if (!commentText || commentText.length < 2) return;

        comments.push({
          author: authorEl?.textContent?.trim(),
          authorCompany: companyEl?.textContent?.trim(),
          content: commentText.slice(0, 3000),
          createdAt:
            timeEl?.getAttribute("datetime") || timeEl?.textContent?.trim(),
          likeCount: parseNumberFromText(likeEl?.textContent || ""),
          isOp: !!opBadge
        });
      });

      if (comments.length === 0) {
        const bodyText = document.body.innerText || "";
        const commentRegex =
          /"memberNickname":"((?:\\.|[^"\\])*)"[\s\S]*?"contentRaw":"((?:\\.|[^"\\])*)"/g;
        let match;
        while ((match = commentRegex.exec(bodyText)) !== null) {
          const author = tryDecodeJsonString(match[1]);
          const content = tryDecodeJsonString(match[2]);
          if (author || content) {
            comments.push({ author, content });
          }
          if (comments.length >= 20) break;
        }
      }

      let totalComments: number | undefined;
      const countEl = document.querySelector(
        "[class*='comment-count'], [class*='total-comment']"
      );
      const countText = countEl?.textContent || "";
      const countMatch = countText.match(/[\d,]+/);
      if (countMatch) {
        totalComments = parseInt(countMatch[0].replace(/,/g, ""), 10);
      }

      return { comments, totalComments };

      function tryDecodeJsonString(s: string): string {
        try {
          return JSON.parse(`"${s}"`);
        } catch {
          return s.replace(/\\"/g, '"');
        }
      }

      function parseNumberFromText(text: string): number | undefined {
        const match = text.match(/[\d,]+/);
        if (!match) return undefined;
        return parseInt(match[0].replace(/,/g, ""), 10);
      }
    });

    return {
      comments: result.comments.slice(0, 20) as CommentSummary[],
      totalComments: result.totalComments
    };
  } catch (err) {
    warn(`Error extracting comments: ${String(err)}`);
    return { comments: [] };
  }
}

function maybePostSummary(raw: Record<string, unknown>): PostSummary {
  return {
    title: String(raw.title || ""),
    slug: String(raw.slug || ""),
    content: raw.content ? String(raw.content) : undefined,
    author: raw.author ? String(raw.author) : undefined,
    authorCompany: raw.authorCompany ? String(raw.authorCompany) : undefined,
    createdAt: raw.createdAt ? String(raw.createdAt) : undefined,
    likeCount: raw.likeCount != null ? Number(raw.likeCount) : undefined,
    commentCount:
      raw.commentCount != null ? Number(raw.commentCount) : undefined,
    viewCount: raw.viewCount != null ? Number(raw.viewCount) : undefined
  };
}

export async function extractCompanyChannel(
  page: Page,
  config: AppConfig,
  company: string
): Promise<ChannelResult> {
  const normalizedCompany = company.trim().replace(/^\/+|\/+$/g, "");
  const url = `${config.baseUrl}/private/${encodeURIComponent(normalizedCompany)}`;

  debug(`Navigating to company channel: ${url}`);
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: config.timeoutMs
  });

  await page
    .waitForLoadState("networkidle", { timeout: config.timeoutMs })
    .catch(() => {
      debug("Network idle timeout - continuing anyway");
    });

  await page.waitForTimeout(2000);

  const posts = await extractPostsFromPage(page);

  return {
    url: page.url(),
    company: normalizedCompany,
    posts
  };
}

export async function extractCompanyChannels(
  page: Page
): Promise<CompanyListResult> {
  const companies = await page.evaluate(() => {
    const seen = new Set<string>();
    const results: Array<{ name: string; alias: string }> = [];

    function add(name: string, alias: string) {
      const key = alias.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ name: name || alias, alias });
      }
    }

    const allLinks = document.querySelectorAll("a[href]");
    for (const link of allLinks) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/\/private\/([^/?]+)/);
      if (match) {
        const linkText = link.textContent?.trim() || "";
        add(linkText, match[1]);
      }
    }

    const allElements = document.querySelectorAll(
      '[class*="company"], [class*="channel"], [class*="group"], li, button, [role="listitem"], [role="option"], nav *'
    );
    for (const el of allElements) {
      const text = el.textContent?.trim() || "";
      const privMatch = el.innerHTML?.match(/\/private\/([^"'\s?]+)/);
      if (privMatch) {
        add(text.slice(0, 60), privMatch[1]);
      }
    }
    for (const el of allElements) {
      const text = el.textContent?.trim() || "";
      const link = el.querySelector("a[href]");
      if (link) continue;

      const privMatch = el.innerHTML?.match(/\/private\/([^"'\s?]+)/);
      if (privMatch) {
        add(text.slice(0, 60), privMatch[1]);
      }
    }

    if (results.length === 0) {
      const rscPayloads = document.querySelectorAll(
        'script[type="application/json"], script[type="text/x-component"]'
      );
      for (const script of rscPayloads) {
        const text = script.textContent || "";
        const regex =
          /"companyName":"((?:\\.|[^"\\])*)"[\s\S]*?"urlAlias":"((?:\\.|[^"\\])*)"/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
          try {
            add(JSON.parse(`"${match[1]}"`), JSON.parse(`"${match[2]}"`));
          } catch {
            add(match[1], match[2]);
          }
        }
      }
    }

    if (results.length === 0) {
      const bodyText = document.body.innerText || "";
      const rscRegex =
        /"companyName":"((?:\\.|[^"\\])*)"[\s\S]{0,200}?"urlAlias":"((?:\\.|[^"\\])*)"/g;
      let match;
      while ((match = rscRegex.exec(bodyText)) !== null) {
        try {
          add(JSON.parse(`"${match[1]}"`), JSON.parse(`"${match[2]}"`));
        } catch {
          add(match[1], match[2]);
        }
      }
    }

    if (results.length === 0) {
      const bodyText = document.body.innerText || "";
      const simpleRegex = /\/private\/([A-Za-z0-9_-]+)/g;
      let match;
      while ((match = simpleRegex.exec(bodyText)) !== null) {
        const alias = match[1];
        if (!seen.has(alias.toLowerCase())) {
          add(alias, alias);
        }
      }
    }

    return results.slice(0, 50);
  });

  return {
    url: page.url(),
    companies
  };
}

export async function scrollFeed(page: Page, scrollCount = 3): Promise<void> {
  for (let i = 0; i < scrollCount; i++) {
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1500);
  }
}
