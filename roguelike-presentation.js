/** Presentation seconds are advanced explicitly by the app, never by combat speed or draw(). */
export const ROGUELIKE_COMBO_TIMING = Object.freeze({hold:.25,title:.6,settle:1.1,total:1.4});
const style = (fromColor,toColor,shake,motif) => Object.freeze({fromColor,toColor,shake,motif});
export const ROGUELIKE_COMBO_STYLES = Object.freeze({
  combo_east_wind:style('#70cdb6','#e85c43',.35,'windFire'),
  combo_righteous_sky:style('#e9c46a','#4ed6a2',.45,'crossBlades'),
  combo_changban_guard:style('#dc6451','#e6edf5',.40,'roarSpears'),
  combo_thunder_rain:style('#8c6cbb','#6acbbb',.40,'thunderArrows'),
  combo_tiger_command:style('#9a7250','#4a7896',.45,'flagRings'),
  combo_divine_cavalry:style('#e4eaf0','#7d8b91',.35,'arrowCharge'),
  combo_chibi_fire:style('#53a58c','#e65b3d',.45,'tideFire'),
  combo_one_eye_tiger:style('#d4a45e','#9b7958',.50,'impactCone'),
});
const EPS = 1e-8;
const finite = (value,fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = value => Math.max(0,Math.min(1,value));
const snapshot = value => value && typeof value === 'object' ? structuredClone(value) : null;

export class RoguelikePresentation {
  constructor() { this.reset(); }
  reset() { this.time = 0; this.serial = 0; this.combo = null; this.effects = []; this.damageHistory = []; this.damageTotals = []; }
  get holdRemaining() { return this.combo ? Math.max(0,ROGUELIKE_COMBO_TIMING.hold - this.combo.age) : 0; }
  get phase() {
    const age = this.combo?.age; return age == null ? null : age < .25 - EPS ? 'hold' : age < .6 - EPS ? 'dual' : age < 1.1 - EPS ? 'title' : 'settle';
  }
  handleEvent(event = {}) {
    if (event.type === 'damage' && event.amount > 0 && Number.isFinite(event.amount) && /^ultimate_/.test(event.source || '')) {
      const damage = {enemyId:event.enemyId,heroId:event.heroId || event.source.slice(9),amount:event.amount,x:finite(event.x,210),y:finite(event.y,300),at:this.time};
      this.damageHistory.push(damage); if (this.damageHistory.length > 64) this.damageHistory.shift();
      const bucket = this.damageTotals.find(value => value.at === this.time && value.heroId === damage.heroId);
      if (bucket) bucket.amount += damage.amount; else this.damageTotals.push({at:this.time,heroId:damage.heroId,amount:damage.amount});
      if (this.damageTotals.length > 64) this.damageTotals.shift();
      if (this.combo && [this.combo.fromHeroId,this.combo.toHeroId].includes(damage.heroId)) this._addDamage(damage);
    }
    if (event.presentation !== 'roguelike') return false;
    if (event.type === 'heroCombo' && ROGUELIKE_COMBO_STYLES[event.comboId]) {
      this.combo = {sequence:++this.serial,comboId:event.comboId,name:String(event.name || '合击'),fromHeroId:event.fromHeroId,toHeroId:event.toHeroId,
        target:snapshot(event.target),fromTarget:snapshot(event.fromTarget),fromUltimate:snapshot(event.fromUltimate),toUltimate:snapshot(event.toUltimate),age:0,style:ROGUELIKE_COMBO_STYLES[event.comboId],damage:0,recipients:[]};
      for (const damage of this.damageTotals) if (this.time - damage.at <= .1 + EPS && [event.fromHeroId,event.toHeroId].includes(damage.heroId)) this.combo.damage += damage.amount;
      for (const damage of this.damageHistory) if (this.time - damage.at <= .1 + EPS && [event.fromHeroId,event.toHeroId].includes(damage.heroId)) this._addDamage(damage,false);
      return true;
    }
    if (event.type === 'heal' && Number.isFinite(event.heal) && event.heal > 0) {
      this.effects.push({kind:'heal',amount:event.heal,x:finite(event.x,210),y:finite(event.y,540),age:0,life:.9});
    } else if (event.type === 'campLevel5' || event.type === 'upgrade' && event.camp?.level === 5) {
      const camp = event.camp || event;
      this.effects.push({kind:'campLevel5',slot:camp.slot,campType:camp.type,x:finite(camp.x,210),y:finite(camp.y,300),level:5,age:0,life:.9});
    } else return false;
    if (this.effects.length > 24) this.effects.splice(0,this.effects.length - 24);
    return true;
  }
  _addDamage(damage,includeTotal = true) {
    if (includeTotal) this.combo.damage += damage.amount;
    const recipient = this.combo.recipients.find(value => value.enemyId === damage.enemyId);
    if (recipient) { recipient.amount += damage.amount; recipient.x = damage.x; recipient.y = damage.y; }
    else if (this.combo.recipients.length < 8) this.combo.recipients.push({...damage});
  }
  tick(realDt,{active = true} = {}) {
    if (!active || !Number.isFinite(realDt) || realDt <= 0) return;
    this.time += realDt;
    if (this.combo) { this.combo.age += realDt; if (this.combo.age >= ROGUELIKE_COMBO_TIMING.total - EPS) this.combo = null; }
    for (const effect of this.effects) effect.age += realDt;
    this.effects = this.effects.filter(effect => effect.age < effect.life);
    this.damageHistory = this.damageHistory.filter(damage => this.time - damage.at <= .1 + EPS);
    this.damageTotals = this.damageTotals.filter(damage => this.time - damage.at <= .1 + EPS);
  }
  camera(reducedMotion = false) {
    const combo = this.combo; if (reducedMotion || !combo) return {x:0,y:0,strength:0};
    const pulse = (start,life,scale) => { const age = combo.age - start; return age >= 0 && age < life ? (1 - age / life) ** 1.6 * scale : 0; };
    const strength = 6 * combo.style.shake / .5 * Math.max(pulse(.6,.38,1),pulse(1.1,.3,.65));
    return {x:Math.sin(combo.age * 118) * strength,y:Math.cos(combo.age * 91) * strength * .7,strength};
  }
  view(reducedMotion = false) {
    const combo = this.combo;
    return {holdRemaining:this.holdRemaining,phase:this.phase,combo:combo ? {...combo,phase:this.phase,silhouette:this.phase === 'hold',dualVisible:combo.age >= .25 - EPS && combo.age < 1.1 - EPS,
      titleVisible:reducedMotion || combo.age >= .6 - EPS && combo.age < 1.1 - EPS,settling:combo.age >= 1.1 - EPS,
      progress:clamp((combo.age - .25) / .85)} : null,effects:this.effects.map(effect => ({...effect})),camera:this.camera(reducedMotion)};
  }
}
