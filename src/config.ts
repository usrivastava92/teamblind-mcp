const DEFAULT_BASE_URL = "https://www.teamblind.com";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

const TEAMBLIND_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBITANBgkqhkiG9w0BAQEFAAOCAQ4AMIIBCQKCAQBOBw7Q2T0Wmb/qNPuNbk+f
ZWRbKgBwikJa2vJ5Ht+quwhLbvpUVOKwlNM93huIzkM5wWTRoVpLmczfCt3CyxBd
eU5PxY8JhXxHch/h41e/AgKXrOPFDJuH5T2V++Zw21ArC6rk3YFScNH9xOa0YXfY
x2RQxLM7hD7Bzy5mtxN5nqULxDhYWTeZT6aQw9Wii/0HBoePqgW77TpXcgQxJ5AP
bQQ7QlGdAFMWgjhFWret7cffGrd2lFn5RCgMU316UKf2CTkB4orcsiqCYJ76+LZJ
jLT7kk0ZWYk8Xnn7uwpiCMVipOmZS7cmX3MWiRhbQqkw1UGi2SWn2Ov7plwgx9CB
AgMBAAE=
-----END PUBLIC KEY-----`;

export type TeamBlindConfig = {
  baseUrl: string;
  cookieHeader?: string;
  userAgent: string;
  rsaPublicKey: string;
};

export function getConfig(): TeamBlindConfig {
  const rawCookieHeader =
    process.env.TEAMBLIND_COOKIE_HEADER ?? process.env.TEAMBLIND_COOKIE;
  const normalizedCookieHeader = rawCookieHeader?.trim();

  return {
    baseUrl: process.env.TEAMBLIND_BASE_URL?.trim() || DEFAULT_BASE_URL,
    cookieHeader:
      normalizedCookieHeader && normalizedCookieHeader.length > 0
        ? normalizedCookieHeader
        : undefined,
    userAgent: process.env.TEAMBLIND_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
    rsaPublicKey:
      process.env.TEAMBLIND_RSA_PUBLIC_KEY?.trim() || TEAMBLIND_PUBLIC_KEY
  };
}
