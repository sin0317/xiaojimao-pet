import assert from "node:assert/strict";
import { groupTaskChips } from "../src/shared/taskChips";
import type { WorkBuddySession } from "../src/shared/workbuddy";

const T0 = 1_700_000_000_000;

function session(overrides: Partial<WorkBuddySession> & { id: string }): WorkBuddySession {
  return {
    phase: "running",
    agent: "WorkBuddy",
    project: "PawPal",
    title: "",
    updatedAt: T0,
    needsInputAt: null,
    ...overrides
  };
}

export const tests = [
  {
    name: "chip: 完成一条任务后不再算进「任务中 ×N」",
    run(): void {
      const chips = groupTaskChips([
        session({ id: "a", phase: "running", updatedAt: T0 + 500 }),
        session({ id: "b", phase: "done", updatedAt: T0 })
      ]);

      assert.equal(chips.length, 1);
      assert.equal(chips[0].phase, "running");
      assert.equal(chips[0].count, 1);
    }
  },
  {
    name: "chip: 两条都在跑才算 ×2",
    run(): void {
      const chips = groupTaskChips([
        session({ id: "a", updatedAt: T0 + 500 }),
        session({ id: "b", updatedAt: T0 })
      ]);

      assert.equal(chips[0].count, 2);
    }
  },
  {
    name: "chip: 全部完成时显示已完成 ×N",
    run(): void {
      const chips = groupTaskChips([
        session({ id: "a", phase: "done", updatedAt: T0 + 500 }),
        session({ id: "b", phase: "done", updatedAt: T0 })
      ]);

      assert.equal(chips[0].phase, "done");
      assert.equal(chips[0].count, 2);
    }
  },
  {
    name: "chip: 等你选优先于任务中",
    run(): void {
      const chips = groupTaskChips([
        session({ id: "a", phase: "running", updatedAt: T0 + 900 }),
        session({ id: "b", phase: "needsInput", updatedAt: T0 })
      ]);

      assert.equal(chips[0].phase, "needsInput");
      assert.equal(chips[0].count, 1);
    }
  },
  {
    name: "chip: 不同 agent 各一张，最多 3 张",
    run(): void {
      const chips = groupTaskChips([
        session({ id: "a", agent: "WorkBuddy" }),
        session({ id: "b", agent: "Qoder CN" }),
        session({ id: "c", agent: "Trae" }),
        session({ id: "d", agent: "Qoder" })
      ]);

      assert.equal(chips.length, 3);
      assert.deepEqual(
        chips.map((chip) => chip.agent),
        ["WorkBuddy", "Qoder CN", "Trae"]
      );
    }
  }
];
