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
    name: "登录 / 切号通知不改变任务状态，但会清掉残留的等选",
    run(): void {
      const sessions = sessionsOf([
        event("UserPromptSubmit", { prompt: "改配色" }, T0),
        event("Notification", { notification_type: "permission_request" }, T0 + 1000),
        event("Notification", { notification_type: "auth_success" }, T0 + 2000)
      ]);

      assert.equal(sessions.s1.needsInputAt, null, "切号后不该还挂着等你选");
      assert.equal(sessions.s1.phase, "running", "也不要把任务判成完成或空闲");
    }
  },
  {
    name: "idle_prompt 当作任务结束（Trae 掐断任务时不一定有 Stop）",
    run(): void {
      const sessions = sessionsOf([
        event("UserPromptSubmit", { prompt: "重构一下", agent: "Trae" }, T0),
        event("Notification", { notification_type: "idle_prompt", agent: "Trae" }, T0 + 5000)
      ]);

      assert.equal(sessions.s1.phase, "done");
      assert.equal(sessions.s1.needsInputAt, null);
      assert.equal(summarizeWorkBuddy(sessions, T0 + 6000).phase, "done");
    }
  },
  {
    name: "idle_prompt 不会盖掉「等你选」",
    run(): void {
      const sessions = sessionsOf([
        event("UserPromptSubmit", { prompt: "跑个命令" }, T0),
        event("Notification", { notification_type: "permission_prompt" }, T0 + 1000),
        event("Notification", { notification_type: "idle_prompt" }, T0 + 2000)
      ]);

      assert.notEqual(sessions.s1.needsInputAt, null, "问题还摆着，不能判成结束");
      assert.equal(summarizeWorkBuddy(sessions, T0 + 3000).phase, "needsInput");
    }
  },
  {
    name: "Trae 开新会话时，上一个没收到 Stop 的会话不再算任务中",
    run(): void {
      const sessions = applyWorkBuddyEvents({}, [
        event("SessionStart", { session_id: "old", agent: "Trae" }, T0),
        event("UserPromptSubmit", { session_id: "old", prompt: "旧任务", agent: "Trae" }, T0 + 1000),
        event("SessionStart", { session_id: "new", agent: "Trae" }, T0 + 5000)
      ]);

      assert.equal(sessions.old.phase, "done", "被切走的会话要判成结束");
      assert.equal(
        summarizeWorkBuddy(sessions, T0 + 6000).phase,
        "done",
        "不该再显示任务中（显示已完成是合理的）"
      );
    }
  },
  {
    name: "工具一跑就清掉等选状态（选完之后不应该还挂着）",
    run(): void {
      const sessions = sessionsOf([
        event("UserPromptSubmit", { prompt: "改配色" }, T0),
        event("Notification", { notification_type: "permission_request" }, T0 + 1000),
        event("PreToolUse", { tool_name: "AskUserQuestion" }, T0 + 2000),
        event("PostToolUse", { tool_name: "AskUserQuestion" }, T0 + 4000)
      ]);

      assert.equal(sessions.s1.needsInputAt, null);
      assert.equal(sessions.s1.phase, "running");
      assert.equal(summarizeWorkBuddy(sessions, T0 + 5000).phase, "running");
    }
  },
  {
    name: "答完过一会儿才 Stop，不该再算等你选",
    run(): void {
      const sessions = sessionsOf([
        event("Notification", { notification_type: "permission_request" }, T0),
        event("PostToolUse", { tool_name: "Bash" }, T0 + 3000),
        event("Stop", { last_assistant_message: "改好了" }, T0 + 200_000)
      ]);

      assert.equal(sessions.s1.phase, "done");
      assert.equal(summarizeWorkBuddy(sessions, T0 + 210_000).phase, "done");
    }
  },
  {
    name: "needsInput wins over running in the aggregate",
    run(): void {
      const sessions = applyWorkBuddyEvents(
        {},
        [
          event("UserPromptSubmit", { prompt: "A" }, T0),
          event("UserPromptSubmit", { prompt: "B" }, T0 + 200),
          {
            ...event("Notification", { notification_type: "permission_request" }, T0 + 500),
            payload: {
              session_id: "s2",
              hook_event_name: "Notification",
              notification_type: "permission_request"
            }
          }
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
    name: "session keeps the agent that produced the event",
    run(): void {
      const fromPayload = applyWorkBuddyEvents({}, [
        {
          payload: {
            session_id: "s1",
            hook_event_name: "UserPromptSubmit",
            cwd: "d:\\WorkBuddy\\PawPal",
            client: "WorkBuddy"
          },
          at: T0
        }
      ]);
      assert.equal(fromPayload.s1.agent, "WorkBuddy");

      const fromDir = applyWorkBuddyEvents({}, [
        {
          payload: { session_id: "s2", hook_event_name: "UserPromptSubmit", cwd: "d:\\proj" },
          at: T0,
          agent: "qoder"
        },
        {
          payload: { session_id: "s3", hook_event_name: "UserPromptSubmit", cwd: "d:\\proj" },
          at: T0,
          agent: "trae"
        }
      ]);
      assert.equal(fromDir.s2.agent, "Qoder");
      assert.equal(fromDir.s3.agent, "Trae");
    }
  },
  {
    name: "notification at task start does not count as needs-input",
    run(): void {
      // 任务刚开 300ms 的那条提示音，不能把状态带成「等你选」
      const sessions = applyWorkBuddyEvents({}, [
        {
          payload: { session_id: "s", hook_event_name: "UserPromptSubmit", cwd: "d:\\p", prompt: "改个 bug" },
          at: T0
        },
        {
          payload: { session_id: "s", hook_event_name: "Notification", cwd: "d:\\p", message: "任务已开始" },
          at: T0 + 300
        }
      ]);
      assert.equal(sessions.s.phase, "running");
      assert.equal(sessions.s.needsInputAt, null);
    }
  },
  {
    name: "notification mid-task still raises needs-input",
    run(): void {
      const sessions = applyWorkBuddyEvents({}, [
        {
          payload: { session_id: "s", hook_event_name: "UserPromptSubmit", cwd: "d:\\p", prompt: "改个 bug" },
          at: T0
        },
        {
          payload: {
            session_id: "s",
            hook_event_name: "Notification",
            cwd: "d:\\p",
            notification_type: "permission_request",
            message: "需要你确认是否运行命令"
          },
          at: T0 + 5000
        }
      ]);
      assert.equal(summarizeWorkBuddy(sessions, T0 + 6000).phase, "needsInput");
    }
  },
  {
    name: "notification with explicit type is honoured even when early",
    run(): void {
      const sessions = applyWorkBuddyEvents({}, [
        {
          payload: { session_id: "s", hook_event_name: "UserPromptSubmit", cwd: "d:\\p", prompt: "改个 bug" },
          at: T0
        },
        {
          payload: {
            session_id: "s",
            hook_event_name: "Notification",
            cwd: "d:\\p",
            notification_type: "permission_request"
          },
          at: T0 + 200
        }
      ]);
      assert.equal(summarizeWorkBuddy(sessions, T0 + 400).phase, "needsInput");
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
