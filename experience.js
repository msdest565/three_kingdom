/**
 * Player-experience logic that sits beside the engine: local telemetry, kill-streak rules,
 * result highlights, defeat advice, next objectives, share text and local challenge codes.
 * Everything here reads real engine/store values and never changes combat or rewards.
 */
import { BALANCE, CONTENT } from './runtime-data.js';

export const TELEMETRY_KEY = 'wushuang-guard-telemetry-v1';
export const TELEMETRY_LIMIT = 300;
export const COMBO_WINDOW_SEC = 2.5;
export const COMBO_MILESTONES = Object.freeze([20, 50, 100]);
export const CHALLENGE_VERSION = 1;
export const BUILD_ID = `${CONTENT.contentVersion}`;
const heroName = id => BALANCE.heroes[id]?.name || '武将';
const factionNames = { wei: '魏', shu: '蜀', wu: '吴' };

// ===== Local telemetry: inspectable in Settings, never transmitted =====
export class Telemetry {
  constructor({ storage = null, now = () => Date.now(), clock = () => (globalThis.performance?.now?.() ?? 0) } = {}) {
    this.storage = storage; this.now = now; this.clock = clock;
    this.session = Math.floor(now() / 1000).toString(36);
    this.firsts = new Set();
    this.events = this._read();
  }
  _read() {
    try { const value = JSON.parse(this.storage?.getItem(TELEMETRY_KEY) || '[]'); return Array.isArray(value) ? value.slice(-TELEMETRY_LIMIT) : []; } catch { return []; }
  }
  _write() { try { this.storage?.setItem(TELEMETRY_KEY, JSON.stringify(this.events.slice(-TELEMETRY_LIMIT))); } catch { /* Telemetry is optional. */ } }
  /** `once` names an event that is only logged the first time in this browser session. */
  log(type, data = {}, { once = false } = {}) {
    if (once) { if (this.firsts.has(type)) return null; this.firsts.add(type); }
    const entry = { type, at: new Date(this.now()).toISOString(), ms: Math.round(this.clock()), session: this.session, ...data };
    this.events.push(entry); if (this.events.length > TELEMETRY_LIMIT) this.events.splice(0, this.events.length - TELEMETRY_LIMIT);
    this._write(); return entry;
  }
  sessionEvents() { return this.events.filter(e => e.session === this.session); }
  clear() { this.events = []; this._write(); }
  /** Funnel summary for the current session: first-screen → battle → deploy → Peerless → result. */
  summary() {
    const list = this.sessionEvents(); const first = type => list.find(e => e.type === type);
    const base = first('first_interactive')?.ms;
    const delta = type => { const e = first(type); return e && Number.isFinite(base) ? Math.round(e.ms - base) : null; };
    return { firstInteractiveMs: base ?? null, toBattleEntryMs: delta('battle_entry'), toFirstDeployMs: delta('first_deploy'), toFirstUltimateMs: delta('first_ultimate'),
      battles: list.filter(e => e.type === 'battle_result').length, retries: list.filter(e => e.type === 'retry').length,
      shareClicks: list.filter(e => e.type === 'share_click').length, shareCompleted: list.filter(e => e.type === 'share_complete').length };
  }
}

// ===== Kill streak (连斩) =====
// Rule: consecutive kills in COMBAT seconds. A kill within 2.5 combat-seconds of the previous kill extends the
// streak; otherwise a new streak begins at 1. Because the window is measured in engine time, pause, camp
// deployment, tactic choice, tutorial freezes and background suspension do not break or extend a streak, and
// 1×/1.5×/2× produce the same streaks for the same battle. New battle, retry and exit reset it.
export class ComboTracker {
  constructor(window = COMBO_WINDOW_SEC) { this.window = window; this.reset(); }
  reset() { this.count = 0; this.best = 0; this.lastKillAt = -Infinity; this.milestone = 0; }
  kill(time) {
    if (!Number.isFinite(time)) return { count: this.count, milestone: null };
    this.count = time - this.lastKillAt <= this.window + 1e-9 ? this.count + 1 : 1;
    this.lastKillAt = time; this.best = Math.max(this.best, this.count);
    const reached = COMBO_MILESTONES.includes(this.count) ? this.count : null;
    return { count: this.count, milestone: reached };
  }
  /** Live streak at combat time `time`; 0 once the window has lapsed. */
  current(time) { return Number.isFinite(time) && time - this.lastKillAt <= this.window + 1e-9 ? this.count : 0; }
}

// ===== Result highlight: one real standout stat =====
export function battleHighlight(game, { bestCombo = 0, previous = null } = {}) {
  const won = game.state === 'won';
  const bosses = game.stats?.killsByType?.boss || 0;
  const hpFraction = game.maxHp > 0 ? game.hp / game.maxHp : 0;
  const candidates = [];
  if (game.bestBurst >= 10) candidates.push({ id: 'burst', score: game.bestBurst * 2, value: game.bestBurst, label: '一记无双击破', unit: '人', record: previous ? game.bestBurst > (previous.bestBurst || 0) : false });
  if (bestCombo >= 20) candidates.push({ id: 'combo', score: bestCombo * 1.2, value: bestCombo, label: '最高连斩', unit: '人', record: false });
  if (won && bosses > 0) candidates.push({ id: 'boss', score: 1e6, value: bosses, label: '斩落敌将', unit: '名', record: false });
  if (won && hpFraction >= 0.999) candidates.push({ id: 'flawless', score: 180, value: 100, label: '城关完好', unit: '%', record: false });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || { id: 'kills', score: 0, value: game.kills, label: won ? '共击破' : '本局击破', unit: '人', record: false };
}

// ===== Defeat advice: one actionable suggestion from real battle facts =====
export function defeatAdvice(game, { level, heroLevel = 1, unusedRageSec = 0, bestCombo = 0 } = {}) {
  const escapes = game.stats?.escapesByType || {};
  const camps = game.camps || [];
  const emptySlots = (game.map?.campSlots?.length || 0) - camps.length;
  const tier = BALANCE.stageGrowthTiers.find(t => t.id === level?.growthTierId);
  const recommended = tier?.recommendedHeroLevelRange?.[0] || 1;
  const has = type => game.availableCamps?.includes?.(type) ?? game.unlockedCamps?.includes?.(type);
  const facts = { escapes, emptySlots, food: Math.floor(game.food || 0), casts: game.stats?.ultimateCasts || 0, wave: game.wave, waves: game.waveCount, unusedRageSec: Math.round(unusedRageSec) };
  const pick = (id, text) => ({ id, text, facts });
  if ((escapes.boss || 0) > 0) return pick('boss', `敌将突破城门。下次在敌将出现前留住满怒，敌将入射程再放无双${has('crossbow') ? '，并在城门前补一座弩营破甲' : ''}。`);
  if (unusedRageSec >= 12) return pick('rage', `本局无双蓄满后闲置了约 ${Math.round(unusedRageSec)} 秒。敌潮聚在路口时就出手，冷却 6 秒后还能再放。`);
  if ((escapes.armor || 0) + (escapes.siege || 0) >= 2) return pick('armor', `${(escapes.armor || 0) + (escapes.siege || 0)} 名重甲/攻城兵突破。${has('crossbow') ? '在城门前建弩营专破重甲' : '把弓营升到 2 级以上集中射击'}，无双留给它们。`);
  if ((escapes.cavalry || 0) >= 3) return pick('cavalry', `${escapes.cavalry} 名骑兵冲过防线。骑兵很快，盾营放在两路汇合处减速，再用弓营收割。`);
  if (emptySlots > 0 && facts.food >= 60) return pick('food', `战败时还有 ${facts.food} 军粮、${emptySlots} 个空营位未用。军粮够 60 就补营，空营不会帮你守关。`);
  if (camps.length && camps.every(c => c.level === 1) && (game.stats?.totalFoodEarned || 0) >= 120) return pick('upgrade', '所有军营仍是 1 级。点按已建军营可升级，2 级以上的射速和范围明显提升。');
  if (heroLevel < recommended) return pick('training', `领衔武将 Lv${heroLevel}，低于本阵建议的 Lv${recommended}。回军帐用「一键整备」提升等级与技能。`);
  if (facts.casts <= 1) return pick('cast', '本局只放了一次无双。无双是破阵主力，怒气满了就在敌群最密时出手。');
  return pick('general', `撑到第 ${facts.wave} / ${facts.waves} 波。试着把盾营放在两路汇合处，让敌潮在无双射程内聚成一团。`);
}

// ===== Next objective after a result =====
export function nextObjective({ level, stars = 0, won = false, isUnlocked = () => true }) {
  const next = CONTENT.levels.find(l => l.globalIndex === level.globalIndex + 1);
  const unlocks = [];
  if (next?.unlockHeroId) unlocks.push(`可解锁${heroName(next.unlockHeroId)}`);
  if (next?.unlockCampType) unlocks.push(`开放${BALANCE.camps[next.unlockCampType]?.name || '新军营'}`);
  if (next && next.maxPartySize > level.maxPartySize) unlocks.push(`可带 ${next.maxPartySize} 将`);
  if (!won) return { kind: 'retry', text: `再战「${level.name}」` };
  if (stars < 3) return { kind: 'stars', text: `城关保持 85% 以上可得三星${next ? ` · 或前往「${next.name}」` : ''}` };
  if (!next) return { kind: 'done', text: '本版主线已全部完成' };
  return { kind: 'next', text: `下一阵「${next.name}」${unlocks.length ? ' · ' + unlocks.join(' · ') : ''}`, locked: !isUnlocked(next.id) };
}

// ===== Share text: built only from authentic run values =====
export function shareText({ level, heroId, highlight, stars, won, challengeCode = null, url = null }) {
  const stage = `${factionNames[level.chapterId]}篇第${level.order}阵「${level.name}」`;
  const head = won ? `我在《无双守关》${stage}用${heroName(heroId)}的「${BALANCE.heroes[heroId]?.ultimate?.name || '无双'}」` : `我在《无双守关》${stage}`;
  const stat = `${highlight.label} ${highlight.value}${highlight.unit}`;
  const tail = won ? `${'★'.repeat(stars)}守住了城关。` : '惜败一阵。';
  const challenge = challengeCode ? `\n同阵挑战码：${challengeCode}${url ? `\n${url}` : '\n（在游戏「设置 → 好友挑战」输入）'}` : '';
  return `${head}${stat}，${tail}你能扫多少？${challenge}`;
}

// ===== Local same-challenge codes =====
// A challenge fixes stage, battle seed, build, hero roster and a normalised loadout (the stage tier's recommended
// minimum level/skill/weapon, other gear white Lv0, camp technology 0, camps unlocked by the main line before that
// stage). Veteran progression never enters a challenge. There is no server: results are a local/friend comparison.
const base64url = text => { const bytes = new TextEncoder().encode(text); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromBase64url = text => { const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); };
function checksum(text) { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return (h >>> 0).toString(36).slice(-4).padStart(4, '0'); }

export function encodeChallenge({ levelId, heroes, target = null, build = BUILD_ID }) {
  const level = CONTENT.levels.find(l => l.id === levelId); if (!level) throw new Error('unknown_level');
  const payload = { v: CHALLENGE_VERSION, b: build, l: levelId, s: level.seed, h: heroes.slice(0, level.maxPartySize) };
  if (target && Number.isInteger(target.burst) && Number.isInteger(target.kills)) payload.t = { burst: target.burst, kills: target.kills, hp: Math.round(target.hp ?? 0) };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${checksum(body)}`;
}

export function decodeChallenge(code, { build = BUILD_ID } = {}) {
  const fail = reason => ({ ok: false, reason });
  if (typeof code !== 'string' || code.length > 600) return fail('invalid');
  const trimmed = code.trim().replace(/^.*[#&?]challenge=/, '').replace(/[&#].*$/, '');
  const [body, sum] = trimmed.split('.');
  if (!body || !sum || checksum(body) !== sum) return fail('corrupt');
  let payload; try { payload = JSON.parse(fromBase64url(body)); } catch { return fail('corrupt'); }
  if (!payload || typeof payload !== 'object') return fail('corrupt');
  if (payload.v !== CHALLENGE_VERSION) return fail('version');
  if (payload.b !== build) return fail('build');
  const level = CONTENT.levels.find(l => l.id === payload.l);
  if (!level || payload.s !== level.seed) return fail('level');
  const heroes = Array.isArray(payload.h) ? payload.h : [];
  if (!heroes.length || heroes.length > level.maxPartySize || new Set(heroes).size !== heroes.length || heroes.some(id => !BALANCE.heroes[id])) return fail('heroes');
  const t = payload.t;
  const target = t && Number.isInteger(t.burst) && Number.isInteger(t.kills) && t.burst >= 0 && t.kills >= t.burst && t.kills < 100000 ? { burst: t.burst, kills: t.kills, hp: Math.max(0, Math.min(100, Number(t.hp) || 0)) } : null;
  return { ok: true, levelId: level.id, level, seed: payload.s, heroes, target, build: payload.b };
}

/** Normalised challenge party and camps; identical for every player who opens the same code. */
export function challengeSetup(levelId, heroes) {
  const level = CONTENT.levels.find(l => l.id === levelId);
  const tier = BALANCE.stageGrowthTiers.find(t => t.id === level.growthTierId);
  const party = heroes.slice(0, level.maxPartySize).map((heroId, index) => ({ heroId, level: tier.recommendedHeroLevelRange[0], skillLevel: tier.recommendedSkillLevelRange[0], auto: index > 0,
    equipment: { weapon: { level: tier.recommendedMainWeaponLevelRange[0], quality: tier.recommendedMainWeaponQuality } } }));
  const camps = [...BALANCE.chapterTowerUnlock.initial, ...['wei', 'shu', 'wu'].flatMap(chapter => BALANCE.chapterTowerUnlock[chapter])
    .filter(u => CONTENT.levels.find(l => l.id === u.levelId)?.globalIndex < level.globalIndex).map(u => u.campId)];
  return { level, party, unlockedCamps: [...new Set(camps)], campTech: {} };
}

export const challengeReasons = { invalid: '挑战码格式不正确', corrupt: '挑战码不完整或已损坏，请让好友重新复制', version: '挑战码来自不同版本的挑战规则', build: '挑战码来自不同游戏版本，双方版本一致才能公平比较', level: '挑战码中的关卡不存在于本版本', heroes: '挑战码中的武将阵容无效' };

/** A link is only offered on a real public origin; localhost and file:// produce a code-only share. */
export function publicChallengeUrl(code, location = globalThis.location) {
  try {
    if (!location || !/^https?:$/.test(location.protocol)) return null;
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname)) return null;
    return `${location.origin}${location.pathname}#challenge=${code}`;
  } catch { return null; }
}
