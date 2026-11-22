import { useEffect, useRef, useState } from "react";
import type { JSX, PointerEvent } from "react";
import { i18n, resolveLanguage } from "../../../shared/i18n";
import type { PetState, SpeechBubble } from "../../../shared/types";
import type { WorkBuddyPhase, WorkBuddyStatus } from "../../../shared/workbuddy";
import { computeWork, formatCountdown, type WorkSnapshot } from "../../../shared/workClock";
import { getPetAsset, getPetAssetVariantCount } from "../assets";
import { useNow, useSnapshot } from "../hooks";
import { pointInElementHitbox } from "../petHitbox";

type DragRef = {
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
};

const CONTINUOUS_ASSET_STATES = new Set<PetState>(["idle", "focusGuard"]);
const CONTINUOUS_ASSET_ROTATION_MS = 15 * 60 * 1000;
const DRAG_START_DISTANCE_PX = 10;
const PET_BUTTON_SELECTOR = ".pet-button";
const BUBBLE_INTERACTIVE_SELECTOR = ".speech-bubble";
const TASK_BADGE_SELECTOR = ".task-badge";

function randomVariant(count: number, previous?: number): number {
  if (count <= 1) return 0;
  let next = Math.floor(Math.random() * count);
  if (previous !== undefined && next === previous) {
    next = (next + 1) % count;
  }
  return next;
}

function formatFocusCountdown(endsAt: number | null, now: number): string {
  const remainingSeconds = Math.max(0, Math.ceil(((endsAt ?? now) - now) / 1000));
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

type WorkClockCopy = ReturnType<typeof i18n>["settings"];
type WorkClockView = { label: string; value: string };

function formatMoney(value: number): string {
  return `¥${value.toFixed(2)}`;
}

function workBadgeView(work: WorkSnapshot, nowMs: number, labels: WorkClockCopy): WorkClockView {
  switch (work.state) {
    case "rest":
      return { label: labels.workStateRest, value: "☕" };
    case "before":
      return {
        label: labels.workDistanceToStart,
        value: formatCountdown(Math.max(0, (work.startMs - nowMs) / 1000))
      };
    case "lunch":
      return { label: labels.workStateLunch, value: formatCountdown(work.remainingSeconds) };
    case "after":
      return {
        label: work.checkedOut ? labels.workCheckedOut : labels.workStateAfter,
        value: "🎉"
      };
    default:
      return { label: labels.workDistanceToEnd, value: formatCountdown(work.remainingSeconds) };
  }
}

type WorkBuddyBadge = {
  phase: WorkBuddyPhase;
  label: string;
  project: string;
  title: string;
  count: number;
};

function workBuddyBadgeView(
  status: WorkBuddyStatus,
  labels: WorkClockCopy
): WorkBuddyBadge | null {
  if (status.phase === "idle") return null;

  const label =
    status.phase === "running"
      ? labels.workBuddyPhaseRunning
      : status.phase === "needsInput"
        ? labels.workBuddyPhaseNeedsInput
        : labels.workBuddyPhaseDone;
  const primary =
    status.sessions.find((session) => session.phase === status.phase) ?? status.sessions[0];
  const count =
    status.phase === "needsInput"
      ? status.needsInputCount
      : status.phase === "running"
        ? status.runningCount
        : 0;

  return {
    phase: status.phase,
    label,
    project: primary?.project ?? "",
    title: primary?.title ?? "",
    count
  };
}

export function PetView(): JSX.Element {
  const snapshot = useSnapshot();
  const now = useNow(1000);
  const [bubble, setBubble] = useState<SpeechBubble | null>(null);
  const [assetVariant, setAssetVariant] = useState(0);
  const [assetReplayKey, setAssetReplayKey] = useState(0);
  const [stateSignal, setStateSignal] = useState(0);
  const dragRef = useRef<DragRef | null>(null);
  const mouseInteractiveRef = useRef<boolean | null>(null);
  const lastMousePointRef = useRef<{ x: number; y: number } | null>(null);
  const bubbleVisibleRef = useRef(false);
  const labels = i18n(resolveLanguage(snapshot.settings.language)).settings;
  const work = snapshot.settings.workClockEnabled
    ? computeWork(snapshot.settings, new Date(now))
    : null;
  const workClock = work ? workBadgeView(work, now, labels) : null;
  const workBuddy = snapshot.settings.workBuddyEnabled
    ? workBuddyBadgeView(snapshot.workBuddy, labels)
    : null;

  useEffect(() => {
    const offBubble = window.pawpal.onShowBubble(setBubble);
    const offHide = window.pawpal.onHideBubble(() => setBubble(null));
    const offPetState = window.pawpal.onPetState(() => setStateSignal((current) => current + 1));
    return () => {
      offBubble();
      offHide();
      offPetState();
    };
  }, []);

  const state = snapshot.petState;
  const altText = `PawPal ${state}`;
  const facingClass = snapshot.petFacing === "left" ? "facing-left" : "facing-right";
  const appearanceId = snapshot.settings.petAppearanceId;
  const customAppearance = snapshot.settings.customPetAppearance;
  const asset = getPetAsset(appearanceId, state, assetVariant, assetReplayKey, customAppearance);

  function finishPointerDrag(clicked: boolean): void {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.dragging) {
      window.pawpal.petDragStop();
      return;
    }
    if (clicked) window.pawpal.petClicked();
  }

  function setMouseInteractive(interactive: boolean): void {
    if (mouseInteractiveRef.current === interactive) return;
    mouseInteractiveRef.current = interactive;
    window.pawpal.setMouseInteractive(interactive);
  }

  function updateMouseInteractivity(point: { x: number; y: number } | null): void {
    if (dragRef.current) {
      setMouseInteractive(true);
      return;
    }

    if (!point) {
      setMouseInteractive(false);
      return;
    }

    const target = document.elementFromPoint(point.x, point.y);
    if (!(target instanceof Element)) {
      setMouseInteractive(false);
      return;
    }

    const petButton = target.closest(PET_BUTTON_SELECTOR);
    const isOnPet = petButton ? pointInElementHitbox(point, petButton) : false;
    const isOnBubble =
      bubbleVisibleRef.current && Boolean(target.closest(BUBBLE_INTERACTIVE_SELECTOR));
    const isOnTaskBadge = Boolean(target.closest(TASK_BADGE_SELECTOR));

    setMouseInteractive(isOnPet || isOnBubble || isOnTaskBadge);
  }

  useEffect(() => {
    const variantCount = getPetAssetVariantCount(appearanceId, state, customAppearance);
    setAssetVariant(randomVariant(variantCount));
    setAssetReplayKey(0);
    if (!CONTINUOUS_ASSET_STATES.has(state) || variantCount <= 1) return;
    const timer = window.setInterval(() => {
      setAssetVariant((current) => randomVariant(variantCount, current));
    }, CONTINUOUS_ASSET_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [appearanceId, customAppearance, state, stateSignal]);

  useEffect(() => {
    if (!asset.replayIntervalMs) return;
    const timer = window.setInterval(() => {
      setAssetReplayKey((current) => current + 1);
    }, asset.replayIntervalMs);
    return () => window.clearInterval(timer);
  }, [asset.replayIntervalMs]);

  useEffect(() => {
    const cancelActiveDrag = (): void => finishPointerDrag(false);
    const trackMouse = (event: MouseEvent): void => {
      const point = { x: event.clientX, y: event.clientY };
      lastMousePointRef.current = point;
      updateMouseInteractivity(point);
    };
    const clearMouse = (): void => {
      lastMousePointRef.current = null;
      updateMouseInteractivity(null);
    };

    setMouseInteractive(false);
    window.addEventListener("mousemove", trackMouse);
    window.addEventListener("mouseleave", clearMouse);
    window.addEventListener("pointerup", cancelActiveDrag);
    window.addEventListener("pointercancel", cancelActiveDrag);
    window.addEventListener("blur", cancelActiveDrag);
    return () => {
      window.removeEventListener("mousemove", trackMouse);
      window.removeEventListener("mouseleave", clearMouse);
      window.removeEventListener("pointerup", cancelActiveDrag);
      window.removeEventListener("pointercancel", cancelActiveDrag);
      window.removeEventListener("blur", cancelActiveDrag);
      window.pawpal.setMouseInteractive(true);
    };
  }, []);

  useEffect(() => {
    bubbleVisibleRef.current = Boolean(bubble);
    updateMouseInteractivity(lastMousePointRef.current);
  }, [bubble]);

  function startPointer(event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false
    };
  }

  function movePointer(event: PointerEvent<HTMLButtonElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.dragging && distance > DRAG_START_DISTANCE_PX) {
      drag.dragging = true;
      window.pawpal.petDragStart({ offsetX: drag.startX, offsetY: drag.startY });
    }
  }

  function stopPointer(event: PointerEvent<HTMLButtonElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const shouldReleaseCapture = event.currentTarget.hasPointerCapture(event.pointerId);
    finishPointerDrag(true);
    if (shouldReleaseCapture) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function cancelPointer(event: PointerEvent<HTMLButtonElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    finishPointerDrag(false);
  }

  return (
    <main
      className={`pet-shell${workBuddy ? " has-task-badge" : ""}`}
      aria-label="PawPal desktop pet"
      onContextMenu={(event) => {
        event.preventDefault();
        window.pawpal.petContextMenu();
      }}
    >
      {bubble ? (
        <section className="speech-bubble">
          <p>{bubble.message}</p>
          {bubble.actions?.length ? (
            <div className="bubble-actions">
              {bubble.actions.map((action) => (
                <button
                  className={`bubble-button ${action.kind ?? "secondary"}`}
                  key={action.id}
                  onClick={() => window.pawpal.bubbleAction(action.id)}
                  type="button"
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {snapshot.focusActive ? (
        <div className="focus-badge">
          <span>{labels.focus}</span>
          <strong>{formatFocusCountdown(snapshot.timers.focusEndsAt, now)}</strong>
        </div>
      ) : null}

      {workClock ? (
        <div className={`work-badge${snapshot.focusActive ? " shifted" : ""}`}>
          <div className="work-badge__row">
            <span>{workClock.label}</span>
            <strong>{workClock.value}</strong>
          </div>
          {work && work.earned !== null && !snapshot.settings.hideEarnings ? (
            <em>
              {labels.workTodayEarned} {formatMoney(work.earned)}
            </em>
          ) : null}
        </div>
      ) : null}

      {workBuddy ? (
        <button
          className={`task-badge task-badge--${workBuddy.phase}`}
          onClick={() => window.pawpal.showWorkBuddyStatus()}
          title={workBuddy.title || workBuddy.label}
          type="button"
        >
          <span className="task-badge__dot" aria-hidden="true" />
          <span className="task-badge__text">
            <span className="task-badge__label">
              {workBuddy.label}
              {workBuddy.count > 1 ? <em>×{workBuddy.count}</em> : null}
            </span>
            {workBuddy.project ? (
              <span className="task-badge__project">{workBuddy.project}</span>
            ) : null}
          </span>
        </button>
      ) : null}

      <div className={`pet-stage${workBuddy ? ` task-${workBuddy.phase}` : ""}`}>
        <button
          className={`pet-button state-${state} ${facingClass} ${
            asset.isPlaceholder ? "placeholder-asset" : ""
          }`}
          onPointerCancel={cancelPointer}
          onPointerDown={startPointer}
          onLostPointerCapture={() => finishPointerDrag(false)}
          onPointerMove={movePointer}
          onPointerUp={stopPointer}
          type="button"
        >
          <img draggable={false} src={asset.src} alt={altText} />
        </button>
      </div>
    </main>
  );
}
