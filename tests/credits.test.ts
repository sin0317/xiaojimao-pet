import assert from "node:assert/strict";
import {
  creditDaysLeft,
  normalizeTimestampMs,
  parseQoderUsage,
  parseResourceSummary,
  creditReminderKey,
  defaultCreditAlert,
  isCreditDueSoon,
  resolveExpiryMs
} from "../src/shared/credits";

const TODAY = new Date(2026, 10, 22, 10, 30); // 2026-11-22

export const tests = [
  {
    name: "credit: 按 expiresOn 算剩余天数",
    run(): void {
      const alert = { ...defaultCreditAlert("workbuddy"), expiresOn: "2026-11-30", enabled: true };
      assert.equal(creditDaysLeft(alert, TODAY), 8);
      assert.equal(isCreditDueSoon(alert, TODAY), false);
    }
  },
  {
    name: "credit: 当天到期也算到期",
    run(): void {
      const alert = { ...defaultCreditAlert("trae"), expiresOn: "2026-11-22", enabled: true };
      assert.equal(creditDaysLeft(alert, TODAY), 0);
      assert.equal(isCreditDueSoon(alert, TODAY), true);
    }
  },
  {
    name: "credit: 已过期不提醒",
    run(): void {
      const alert = { ...defaultCreditAlert("trae"), expiresOn: "2026-11-01", enabled: true };
      assert.equal(creditDaysLeft(alert, TODAY) !== null && creditDaysLeft(alert, TODAY)! < 0, true);
      assert.equal(isCreditDueSoon(alert, TODAY), false);
      assert.equal(creditReminderKey(alert, TODAY), null);
    }
  },
  {
    name: "credit: 每月重置日算到本月",
    run(): void {
      const alert = { ...defaultCreditAlert("qoder"), resetDay: 25 };
      const ms = resolveExpiryMs(alert, TODAY);
      assert.ok(ms);
      assert.equal(new Date(ms).getDate(), 25);
      assert.equal(new Date(ms).getMonth(), 10);
    }
  },
  {
    name: "credit: 本月重置日已过就顺延到下月",
    run(): void {
      const alert = { ...defaultCreditAlert("qoder"), resetDay: 5 };
      const ms = resolveExpiryMs(alert, TODAY);
      assert.ok(ms);
      assert.equal(new Date(ms).getMonth(), 11);
      assert.equal(new Date(ms).getDate(), 5);
    }
  },
  {
    name: "credit: 31 号在小月按月末算",
    run(): void {
      const february = new Date(2026, 1, 10);
      const alert = { ...defaultCreditAlert("qoder"), resetDay: 31 };
      const ms = resolveExpiryMs(alert, february);
      assert.ok(ms);
      assert.equal(new Date(ms).getMonth(), 1);
      assert.equal(new Date(ms).getDate(), 28);
    }
  },
  {
    name: "credit: 提醒 key 一天只出一次",
    run(): void {
      const alert = { ...defaultCreditAlert("workbuddy"), expiresOn: "2026-11-24", enabled: true };
      const first = creditReminderKey(alert, TODAY);
      const sameDay = creditReminderKey(alert, new Date(2026, 10, 22, 23, 59));
      const nextDay = creditReminderKey(alert, new Date(2026, 10, 23, 9, 0));
      assert.ok(first);
      assert.equal(first, sameDay);
      assert.notEqual(first, nextDay);
    }
  },
  {
    name: "credit: 关掉开关就不提醒",
    run(): void {
      const alert = { ...defaultCreditAlert("workbuddy"), expiresOn: "2026-11-23", enabled: false };
      assert.equal(creditReminderKey(alert, TODAY), null);
    }
  },
  {
    name: "credits-api: 解析余额与到期（Pascal 字段）",
    run(): void {
      const parsed = parseResourceSummary({
        code: 0,
        data: {
          CycleRemainCapacity: 2328.29,
          CycleTotalCapacity: 4485,
          CycleCapacityUsedPrecise: 2156.71,
          CycleEndTime: "2026-11-30 23:59:59"
        }
      });
      assert.ok(parsed);
      assert.equal(parsed.remaining, 2328);
      assert.equal(parsed.total, 4485);
      assert.ok(parsed.expiresAt);
      assert.equal(new Date(parsed.expiresAt).getDate(), 30);
    }
  },
  {
    name: "credits-api: 缺总量时用余+用补",
    run(): void {
      const parsed = parseResourceSummary({
        data: { CapacityRemain: 10, CapacityUsed: 5 }
      });
      assert.ok(parsed);
      assert.equal(parsed.remaining, 10);
      assert.equal(parsed.total, 15);
    }
  },
  {
    name: "credits-api: DeductionEndTime 是占位值时改用周期结束",
    run(): void {
      const parsed = parseResourceSummary({
        data: {
          CapacityRemain: 100,
          DeductionEndTime: "2049-12-31 23:59:59",
          CycleEndTime: "2026-12-05 00:00:00"
        }
      });
      assert.ok(parsed?.expiresAt);
      assert.equal(new Date(parsed.expiresAt).getMonth(), 11);
    }
  },
  {
    name: "credits-api: 完全解析不出来时返回 null",
    run(): void {
      assert.equal(parseResourceSummary({ data: { foo: "bar" } }), null);
      assert.equal(parseResourceSummary(null), null);
    }
  },
  {
    name: "credits-api: 秒级时间戳归一化成毫秒",
    run(): void {
      assert.equal(normalizeTimestampMs(1_800_000_000), 1_800_000_000_000);
      assert.equal(normalizeTimestampMs(1_800_000_000_000), 1_800_000_000_000);
      assert.equal(normalizeTimestampMs("2026-11-30"), new Date("2026-11-30").getTime());
    }
  },
  {
    name: "qoder: 套餐 + 资源包相加，到期取最近",
    run(): void {
      const parsed = parseQoderUsage({
        qoderUsage: {
          userQuota: { total: 2000, used: 500, remaining: 1500, expireAt: "2026-12-31" },
          addOnQuota: { total: 700, used: 100, remaining: 600, expireAt: "2026-12-10" },
          orgResourcePackage: null
        }
      });
      assert.ok(parsed);
      assert.equal(parsed.remaining, 2100);
      assert.ok(parsed.expiresAt);
      assert.equal(new Date(parsed.expiresAt!).getDate(), 10);
    }
  },
  {
    name: "qoder: 没有 remaining 时用 total-used 推",
    run(): void {
      const parsed = parseQoderUsage({ qoderUsage: { userQuota: { total: 100, used: 30 } } });
      assert.ok(parsed);
      assert.equal(parsed.remaining, 70);
      assert.equal(parsed.expiresAt, null);
    }
  },
  {
    name: "qoder: 空返回是 null",
    run(): void {
      assert.equal(parseQoderUsage({}), null);
      assert.equal(parseQoderUsage(null), null);
    }
  }
];
