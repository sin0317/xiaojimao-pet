import { app, net } from "electron";
import type { UpdateCheckResult } from "../shared/types";
import { compareVersions } from "../shared/versions";
import { APP_USER_AGENT, RELEASES_API_URL, RELEASES_URL } from "./config";

type GitHubReleasePayload = {
  tag_name?: unknown;
  html_url?: unknown;
  name?: unknown;
};

export function createInitialUpdateCheck(): UpdateCheckResult {
  return {
    status: "idle",
    currentVersion: app.getVersion(),
    latestVersion: null,
    releaseUrl: RELEASES_URL,
    checkedAt: null,
    error: null
  };
}

export function createCheckingUpdateCheck(current: UpdateCheckResult): UpdateCheckResult {
  return {
    ...current,
    status: "checking",
    currentVersion: app.getVersion(),
    checkedAt: Date.now(),
    error: null
  };
}

function isGitHubReleasePayload(value: unknown): value is GitHubReleasePayload {
  return typeof value === "object" && value !== null;
}

export async function checkGitHubReleasesForUpdates(
  current: UpdateCheckResult
): Promise<UpdateCheckResult> {
  try {
    const response = await net.fetch(RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `${APP_USER_AGENT}/${app.getVersion()}`
      }
    });

    // 仓库还没有正式发布过 Release 时 GitHub 返回 404，这不是错误
    if (response.status === 404) {
      return {
        status: "up-to-date",
        currentVersion: app.getVersion(),
        latestVersion: null,
        releaseUrl: RELEASES_URL,
        checkedAt: Date.now(),
        error: null
      };
    }

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!isGitHubReleasePayload(payload)) {
      throw new Error("Unexpected release response");
    }

    const latestVersion =
      typeof payload.tag_name === "string"
        ? payload.tag_name
        : typeof payload.name === "string"
          ? payload.name
          : "";

    if (!latestVersion) {
      throw new Error("Latest release has no version tag");
    }

    const releaseUrl = typeof payload.html_url === "string" ? payload.html_url : RELEASES_URL;
    const currentVersion = app.getVersion();
    return {
      status: compareVersions(latestVersion, currentVersion) > 0 ? "available" : "up-to-date",
      currentVersion,
      latestVersion,
      releaseUrl,
      checkedAt: Date.now(),
      error: null
    };
  } catch (error) {
    return {
      ...current,
      status: "error",
      currentVersion: app.getVersion(),
      checkedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
