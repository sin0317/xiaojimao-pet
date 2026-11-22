/**
 * Qoder 设备授权（浏览器选账号）+ 积分查询。
 *
 * 流程（逆向自官方 CLI，社区包 waygate-qoder 已生产验证）：
 *  1. 本地生成 PKCE：verifier → challenge = base64url(sha256(verifier))，nonce 随机
 *  2. 打开 https://qoder.cn/device/selectAccounts?challenge=…&nonce=…&machine_id=…&client_id=…
 *  3. GET https://openapi.qoder.com.cn/api/v1/deviceToken/poll?nonce=…&verifier=…
 *     未授权返回 404（不是错误），成功返回 {token, refresh_token, user_id}
 *  4. GET /sash/api/v2/me/usage（Bearer + cosy-clienttype: 10 + UA Qoder）取套餐与资源包
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parseQoderUsage, type WorkBuddyCredits } from "../shared/credits";

const OPENAPI_BASE = "https://openapi.qoder.com.cn";
const WEB_BASE = "https://qoder.cn";
const CLIENT_ID = "e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb";
const CLIENT_TYPE = "10";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 180_000;

export type QoderDeviceSession = {
  codeVerifier: string;
  nonce: string;
  machineId: string;
  authUrl: string;
};

export type QoderAccount = {
  token: string;
  refreshToken: string | null;
  uid: string | null;
  name: string | null;
  expiresAt: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function epochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 第一步：拼出授权链接 */
export function createDeviceSession(machineId: string): QoderDeviceSession {
  const codeVerifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
  const nonce = randomUUID();

  const query = new URLSearchParams({
    challenge,
    challenge_method: "S256",
    nonce,
    machine_id: machineId,
    client_id: CLIENT_ID
  });

  return {
    codeVerifier,
    nonce,
    machineId,
    authUrl: `${WEB_BASE}/device/selectAccounts?${query.toString()}`
  };
}

/** 轮询一次：404 表示还没授权，200 且带 token 才算成功 */
export async function pollDeviceToken(
  session: QoderDeviceSession
): Promise<{ status: "pending" } | { status: "ready"; account: QoderAccount }> {
  const query = new URLSearchParams({
    nonce: session.nonce,
    verifier: session.codeVerifier,
    challenge_method: "S256"
  });

  const response = await fetch(`${OPENAPI_BASE}/api/v1/deviceToken/poll?${query.toString()}`, {
    headers: { accept: "application/json", "user-agent": "qoder/pawpal" }
  });
  if (response.status === 404) return { status: "pending" };
  if (!response.ok) return { status: "pending" };

  const body = asRecord(await response.json());
  const token = asText(body?.token);
  if (!token) return { status: "pending" };

  const expiresIn = typeof body?.expires_in === "number" ? body.expires_in : null;
  return {
    status: "ready",
    account: {
      token,
      refreshToken: asText(body?.refresh_token) || null,
      uid: asText(body?.user_id) || null,
      name: asText(body?.user_name) || null,
      expiresAt: epochMs(body?.expires_at) ?? (expiresIn ? Date.now() + expiresIn * 1000 : null)
    }
  };
}

export async function waitForDeviceLogin(
  session: QoderDeviceSession,
  isAborted: () => boolean
): Promise<QoderAccount | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isAborted()) return null;
    const result = await pollDeviceToken(session).catch(() => ({ status: "pending" as const }));
    if (result.status === "ready") return result.account;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return null;
}

/** 真实余额：套餐内 + 资源包 + 组织资源包 */
export async function fetchQoderCredits(token: string): Promise<WorkBuddyCredits | null> {
  const response = await fetch(`${OPENAPI_BASE}/sash/api/v2/me/usage`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "user-agent": "Qoder",
      "cosy-clienttype": CLIENT_TYPE
    }
  });
  if (!response.ok) throw new Error(`Qoder 用量接口 HTTP ${response.status}`);
  return parseQoderUsage(await response.json());
}

export function newMachineId(): string {
  return `pawpal-${randomUUID()}`;
}
