/** Battle time is scaled; rendering, input feedback and audio keep wall-clock time. */
export const SPEEDS = Object.freeze([1, 1.5, 2]);
export const SPEED_STORAGE_KEY = 'wushuang-guard-combat-speed';

export function normalizeSpeed(value) {
  return SPEEDS.includes(value) ? value : 1;
}

export function nextSpeed(value) {
  return SPEEDS[(SPEEDS.indexOf(normalizeSpeed(value)) + 1) % SPEEDS.length];
}

export function readSpeedPreference(storage) {
  try {
    const saved = JSON.parse((storage ?? globalThis.localStorage)?.getItem(SPEED_STORAGE_KEY) ?? 'null');
    return normalizeSpeed(saved);
  } catch {
    return 1;
  }
}

export function saveSpeedPreference(value, storage) {
  const speed = normalizeSpeed(value);
  try {
    (storage ?? globalThis.localStorage)?.setItem(SPEED_STORAGE_KEY, JSON.stringify(speed));
  } catch { /* Disabled browser storage does not block speed controls. */ }
  return speed;
}

export class CombatClock {
  constructor({ stepSec = 1 / 60, maxFrameSec = 0.1 } = {}) {
    this.stepSec = Number.isFinite(stepSec) && stepSec > 0 ? Math.min(stepSec, 1 / 60) : 1 / 60;
    this.maxFrameSec = Number.isFinite(maxFrameSec) && maxFrameSec > 0 ? maxFrameSec : 0.1;
    this.accumulator = 0;
    this.impactRemaining = 0;
    this.impactFactor = 1;
    this.impactTriggered = false;
  }

  reset() { this.accumulator = 0; this.impactRemaining = 0; this.impactFactor = 1; this.impactTriggered = false; }

  triggerImpact(durationSec = 0.35, factor = 0.25) {
    if (!Number.isFinite(durationSec) || durationSec <= 0 || !Number.isFinite(factor)) return;
    this.impactRemaining = Math.max(this.impactRemaining, durationSec);
    this.impactFactor = Math.min(this.impactFactor, Math.max(0, Math.min(1, factor)));
    this.impactTriggered = true;
  }

  clearImpact() { this.impactRemaining = 0; this.impactFactor = 1; this.impactTriggered = false; }

  advance(realDt, speed, canAdvance, update) {
    if (!canAdvance() || !Number.isFinite(realDt) || realDt < 0) {
      this.reset();
      return 0;
    }
    // Long frames are bounded without leaving debt to replay after a pause or tab switch.
    const boundedDt = Math.min(realDt, this.maxFrameSec);
    const impactTime = Math.min(boundedDt, this.impactRemaining);
    const frameFactor = boundedDt > 0 ? (impactTime * this.impactFactor + boundedDt - impactTime) / boundedDt : 1;
    this.impactRemaining = Math.max(0, this.impactRemaining - boundedDt);
    if (!this.impactRemaining) this.impactFactor = 1;
    this.accumulator += boundedDt * normalizeSpeed(speed) * frameFactor;
    // Triggers raised between RAF calls are already represented by the frame
    // rate above. Only triggers raised by an update callback interrupt this loop.
    this.impactTriggered = false;
    let steps = 0;
    while (this.accumulator + 1e-10 >= this.stepSec) {
      if (!canAdvance()) { this.reset(); break; }
      this.accumulator = Math.max(0, this.accumulator - this.stepSec);
      update(this.stepSec);
      steps++;
      // An impact can be triggered by an automatic cast inside update(). Do not
      // spend the rest of this frame's already-scaled accumulator at the old rate.
      if (this.impactTriggered) { this.impactTriggered = false; this.resetAccumulator(); break; }
      if (!canAdvance()) { this.reset(); break; }
    }
    return steps;
  }

  resetAccumulator() { this.accumulator = 0; }
}
