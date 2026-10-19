import { campUpgradeState } from './camp-upgrade-rules.js';
const EPS = 1e-8;
const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const alive = e => e.hp > 0 && !e.escaped;

export function campWaveStarted(game) {
  for (const camp of game.camps) campUpgradeState(camp).waveKills = 0;
}

export function campUltimateStarted(game) {
  for (const drum of game.camps) {
    const e = game._campEffects(drum);
    if (e.ultimateAuraDurationSec) campUpgradeState(drum).empoweredUntil = game.time + e.ultimateAuraDurationSec;
  }
}

export function campKilledEnemy(game, camp) {
  const state = campUpgradeState(camp), e = game._campEffects(camp);
  state.waveKills++;
  if (e.killNextAttackDamageBonus) state.nextAttackStacks = Math.min(e.killNextAttackMaxStacks, state.nextAttackStacks + 1);
}

export function consumeCampAttackBonus(game, camp) {
  const state = campUpgradeState(camp), e = game._campEffects(camp);
  const bonus = state.nextAttackStacks * (e.killNextAttackDamageBonus || 0);
  state.nextAttackStacks = 0; return bonus;
}

export function campIncomingMultiplier(game, enemy, sourceCamp = null) {
  let multiplier = 1;
  if (sourceCamp && sourceCamp.type !== 'shield') {
    const bonus = Math.max(0, ...game.camps.filter(c => c.type === 'shield' && dist(c,enemy) <= c.range + enemy.radius).map(c => game._campEffects(c).otherCampIncomingDamageBonus || 0));
    multiplier *= 1 + bonus;
  }
  const oilBonus = Math.max(0, ...game.camps.filter(c => c.type === 'fire_oil').flatMap(c => oilFields(c).filter(f => dist(f,enemy) <= f.radius + enemy.radius).map(() => game._campEffects(c).fieldIncomingDamageBonus || 0)));
  return multiplier * (1 + oilBonus);
}

export function campShieldControl(game, camp, enemy) {
  const e = game._campEffects(camp);
  if (e.rootDurationSec && game.time + EPS >= (enemy.nextCampRootAt || 0)) {
    const duration = e.rootDurationSec * (game.enemyControlFraction(enemy));
    enemy.stunRemaining = Math.max(enemy.stunRemaining, duration);
    enemy.campRootRemaining = Math.max(enemy.campRootRemaining || 0, duration);
    enemy.nextCampRootAt = game.time + e.rootCooldownPerEnemySec;
    game._emit('campRoot', { slot:camp.slot, enemyId:enemy.id, duration });
  }
}

export function oilFields(camp) { return camp.fields || (camp.field ? [camp.field] : []); }

export function createOilField(game, camp, point, radius, duration) {
  const e = game._campEffects(camp), maximum = e.maxFieldsPerCampOverride || 1;
  if (maximum === 1) {
    if (camp.field) Object.assign(camp.field, { ...point, radius, remaining:duration });
    else camp.field = { ...point, radius, remaining:duration, tick:.75 };
    const visual = game.effects.find(effect => effect.type === 'oil' && effect.campSlot === camp.slot);
    const values = { type:'oil', campSlot:camp.slot, ...point, radius, life:duration, age:0, time:0 };
    if (visual) Object.assign(visual,values); else game.effects.push(values);
    return;
  }
  const fields = camp.fields ||= camp.field ? [camp.field] : [];
  for (const current of fields) if (!current.fieldId) {
    current.fieldId = ++game._campFieldSerial;
    const visual = game.effects.find(effect => effect.type === 'oil' && effect.campSlot === camp.slot && !effect.fieldId);
    if (visual) visual.fieldId = current.fieldId;
  }
  const field = { ...point, radius, remaining:duration, tick:fields[0]?.tick ?? .75, fieldId:++game._campFieldSerial };
  if (fields.length >= maximum) {
    const oldest = fields.shift();
    game.effects = game.effects.filter(effect => !(effect.type === 'oil' && effect.campSlot === camp.slot && effect.fieldId === oldest.fieldId));
  }
  fields.push(field); camp.field = fields.at(-1);
  game.effects.push({ type:'oil', campSlot:camp.slot, fieldId:field.fieldId, ...point, radius, life:duration, age:0, time:0 });
}

export function createCatapultFire(game, camp, point, radius) {
  const e = game._campEffects(camp); if (!e.impactFireDamagePerSec) return;
  const field = { camp, ...point, radius, remaining:e.impactFireDurationSec, tick:e.impactFireTickSec,
    tickSec:e.impactFireTickSec, damage:e.impactFireDamagePerSec * e.impactFireTickSec };
  game._campFireFields.push(field);
  game.effects.push({ type:'campZone', kind:'catapultFire', campSlot:camp.slot, ...point, radius,
    life:e.impactFireDurationSec, age:0, time:0 });
}

export function updateCampFireFields(game, dt) {
  for (const field of game._campFireFields) {
    const active = Math.min(dt, field.remaining); field.remaining -= dt; field.tick -= active;
    while (field.tick <= EPS) {
      field.tick += field.tickSec;
      for (const enemy of game.enemies) if (alive(enemy) && dist(enemy,field) <= field.radius + enemy.radius) game._campHit(field.camp, enemy, game._campDamage(field.camp,enemy,field.damage,{dot:true}), 'catapult_fire');
    }
  }
  game._campFireFields = game._campFireFields.filter(field => field.remaining > EPS);
}

