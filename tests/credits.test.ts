import assert from "node:assert/strict";
import {
  creditDaysLeft,
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
  }
];
