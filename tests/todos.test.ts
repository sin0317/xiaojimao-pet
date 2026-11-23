import assert from "node:assert/strict";
import {
  COMPLETED_KEEP_MS,
  OVERDUE_GRACE_MS,
  composeRemindAt,
  describeRemindAt,
  dueTodos,
  nextReminderAt,
  pendingCount,
  splitRemindAt,
  visibleTodos,
  type TodoItem
} from "../src/shared/todos";

const NOW = new Date(2026, 10, 23, 10, 0, 0, 0).getTime();
const HOUR = 60 * 60 * 1000;

function todo(overrides: Partial<TodoItem> & { id: string }): TodoItem {
  return {
    title: "提交报告",
    remindAt: NOW + HOUR,
    done: false,
    doneAt: null,
    createdAt: NOW - HOUR,
    notifiedAt: null,
    ...overrides
  };
}

export const tests = [
  {
    name: "todo: composeRemindAt 拼出本地时间",
    run(): void {
      const stamp = composeRemindAt("2026-11-25", "14:30");
      assert.equal(stamp, new Date(2026, 10, 25, 14, 30, 0, 0).getTime());
      assert.equal(composeRemindAt("2026-02-31", "09:00"), null, "2 月 31 日应判无效");
      assert.equal(composeRemindAt("2026-11-25", "25:00"), null);
      assert.equal(composeRemindAt("", ""), null);
    }
  },
  {
    name: "todo: splitRemindAt 与 composeRemindAt 可逆",
    run(): void {
      const stamp = new Date(2026, 10, 25, 14, 30).getTime();
      const parts = splitRemindAt(stamp);
      assert.deepEqual(parts, { date: "2026-11-25", time: "14:30" });
      assert.equal(composeRemindAt(parts.date, parts.time), stamp);
    }
  },
  {
    name: "todo: 到点且没提醒过的才会触发",
    run(): void {
      const list = [
        todo({ id: "due", remindAt: NOW - 60_000 }),
        todo({ id: "future", remindAt: NOW + HOUR }),
        todo({ id: "notified", remindAt: NOW - 60_000, notifiedAt: NOW - 30_000 }),
        todo({ id: "done", remindAt: NOW - 60_000, done: true })
      ];
      assert.deepEqual(
        dueTodos(list, NOW).map((item) => item.id),
        ["due"]
      );
    }
  },
  {
    name: "todo: 过期太久的（超过宽限）不再补提醒",
    run(): void {
      const list = [todo({ id: "old", remindAt: NOW - OVERDUE_GRACE_MS - 1000 })];
      assert.equal(dueTodos(list, NOW).length, 0);
    }
  },
  {
    name: "todo: nextReminderAt 只算未来的未完成项",
    run(): void {
      const list = [
        todo({ id: "a", remindAt: NOW + 2 * HOUR }),
        todo({ id: "b", remindAt: NOW + HOUR }),
        todo({ id: "c", remindAt: NOW - HOUR }),
        todo({ id: "d", remindAt: NOW + 3 * HOUR, done: true })
      ];
      assert.equal(nextReminderAt(list, NOW), NOW + HOUR);
      assert.equal(nextReminderAt([], NOW), null);
    }
  },
  {
    name: "todo: 排序把未完成放前面，按时间升序",
    run(): void {
      const list = [
        todo({ id: "done-late", done: true, doneAt: NOW, remindAt: NOW - 5 * HOUR }),
        todo({ id: "open-late", remindAt: NOW + 3 * HOUR }),
        todo({ id: "open-soon", remindAt: NOW + HOUR })
      ];
      assert.deepEqual(
        visibleTodos(list, NOW).map((item) => item.id),
        ["open-soon", "open-late", "done-late"]
      );
    }
  },
  {
    name: "todo: 完成很久的自动从列表消失",
    run(): void {
      const list = [
        todo({ id: "fresh", done: true, doneAt: NOW - 1000 }),
        todo({ id: "stale", done: true, doneAt: NOW - COMPLETED_KEEP_MS - 1000 })
      ];
      assert.deepEqual(
        visibleTodos(list, NOW).map((item) => item.id),
        ["fresh"]
      );
    }
  },
  {
    name: "todo: pendingCount 只数未完成",
    run(): void {
      assert.equal(pendingCount([todo({ id: "a" }), todo({ id: "b", done: true })]), 1);
    }
  },
  {
    name: "todo: 时间描述分今天/明天/周几/具体日期",
    run(): void {
      const at = (day: number, hour: number, minute = 0): number =>
        new Date(2026, 10, day, hour, minute).getTime();

      assert.equal(describeRemindAt(at(23, 14, 5), NOW, "zh-CN"), "今天 14:05");
      assert.equal(describeRemindAt(at(24, 9), NOW, "zh-CN"), "明天 09:00");
      assert.equal(describeRemindAt(at(25, 18), NOW, "zh-CN"), "周三 18:00");
      assert.equal(describeRemindAt(at(30, 10), NOW, "zh-CN"), "11/30 10:00");
      assert.equal(describeRemindAt(at(23, 14), NOW, "en"), "Today 14:00");
    }
  }
];
