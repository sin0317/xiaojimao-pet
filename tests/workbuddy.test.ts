import assert from "node:assert/strict";
import {
  applyWorkBuddyEvents,
  projectNameFromCwd,
  summarizeMessage,
  summarizeWorkBuddy,
  WORKBUDDY_DONE_TTL_MS,
  WORKBUDDY_NEEDS_INPUT_TTL_MS
} from "../src/shared/workbuddy";
import type { WorkBuddySession } from "../src/shared/workbuddy";

const T0 = 1_700_000_000_000;

function event(name: string, extra: Record<string, unknown> = {}, at = T0) {
  return {
    payload: { session_id: "s1", hook_event_name: name, cwd: "d:\\WorkBuddy\\PawPal", ...extra },
    at
  };
}

function sessionsOf(events: ReturnType<typeof event>[]): Record<string, WorkBuddySession> {
  return applyWorkBuddyEvents({}, events);
}

export const tests = [
  {
    name: "projectNameFromCwd takes the last path segment",
    run(): void {
      assert.equal(projectNameFromCwd("d:\\WorkBuddy\\PawPal"), "PawPal");
      assert.equal(projectNameFromCwd("/Users/sin/projects/pet/"), "pet");
      assert.equal(projectNameFromCwd(""), "");
    }
  },
  {
    name: "summarizeMessage strips markdown and truncates",
    run(): void {
      assert.equal(summarizeMessage("## 做了什么\n更多内容"), "做了什么");
      assert.equal(summarizeMessage("- 修好了桌宠"), "修好了桌宠");
      assert.equal(summarizeMessage("a".repeat(80)).length, 42);
    }
  },
  {
    name: "UserPromptSubmit marks the session running",
    run(): void {
      const sessions = sessionsOf([event("UserPromptSubmit", { prompt: "给桌宠加任务状态" })]);
      const session = sessions.s1;

      assert.equal(session.phase, "running");
      assert.equal(session.project, "PawPal");
      assert.equal(session.title, "给桌宠加任务状态");
    }
  },
  {
    name: "Stop marks the task done",
    run(): void {
      const sessions = sessionsOf([
        event("UserPromptSubmit", { prompt: "写代码" }, T0),
        event("Stop", { last_assistant_message: "搞定了" }, T0 + 1000)
      ]);

      assert.equal(sessions.s1.phase, "done");
      assert.equal(sessions.s1.title, "搞定了");
    }
  },
  {
    name: "asking a question keeps needsInput even if Stop follows",
    run(): void {
      const sessions = sessionsOf([
        event("UserPromptSubmit", { prompt: "改配色" }, T0),
        event("PreToolUse", { tool_name: "AskUserQuestion" }, T0 + 1000),
        event("Stop", { last_assistant_message: "选一个" }, T0 + 1200)
      ]);

      assert.equal(sessions.s1.phase, "needsInput");
      assert.equal(summarizeWorkBuddy(sessions, T0 + 2000).phase, "needsInput");
    }
  },
  {
    name: "next prompt clears the needsInput latch",
    run(): void {
      const sessions = sessionsOf([
        event("PreToolUse", { tool_name: "AskUserQuestion" }, T0),
        event("UserPromptSubmit", { prompt: "选第二个" }, T0 + 5000)
      ]);

      assert.equal(sessions.s1.needsInputAt, null);
      assert.equal(sessions.s1.phase, "running");
    }
  },
  {
    name: "needsInput wins over running in the aggregate",
    run(): void {
      const sessions = applyWorkBuddyEvents(
        {},
        [
          event("UserPromptSubmit", { prompt: "A" }, T0),
          { ...event("Notification", {}, T0 + 100), payload: { session_id: "s2", hook_event_name: "Notification" } },
          event("UserPromptSubmit", { prompt: "B" }, T0 + 200)
        ]
      );
      const status = summarizeWorkBuddy(sessions, T0 + 1000);

      assert.equal(status.phase, "needsInput");
      assert.equal(status.needsInputCount, 1);
      assert.equal(status.runningCount, 1);
      assert.equal(status.sessions.length, 2);
    }
  },
  {
    name: "SessionEnd removes the session",
    run(): void {
      const sessions = sessionsOf([event("UserPromptSubmit", { prompt: "A" }), event("SessionEnd", {}, T0 + 10)]);
      assert.equal(Object.keys(sessions).length, 0);
    }
  },
  {
    name: "needsInput expires after the TTL",
    run(): void {
      const sessions = sessionsOf([event("PreToolUse", { tool_name: "ExitPlanMode" }, T0)]);
      const status = summarizeWorkBuddy(sessions, T0 + WORKBUDDY_NEEDS_INPUT_TTL_MS + 1000);

      assert.notEqual(status.phase, "needsInput");
    }
  },
  {
    name: "done fades out after the done TTL",
    run(): void {
      const sessions = sessionsOf([event("Stop", {}, T0)]);
      assert.equal(summarizeWorkBuddy(sessions, T0 + 1000).phase, "done");
      assert.equal(summarizeWorkBuddy(sessions, T0 + WORKBUDDY_DONE_TTL_MS + 1000).phase, "idle");
    }
  }
];
