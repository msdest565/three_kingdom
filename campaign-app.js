import { BALANCE, CONTENT } from './runtime-data.js';
import { CampaignStore } from './campaign-state.js';
import { V1Game } from './v1-engine.js';
import { V1Renderer } from './v1-renderer.js';
import { heroPortrait, heroSilhouette, HERO_ART } from './hero-portraits.js';
import { gearTile } from './gear-tile.js';
import { AudioSystem } from './audio-system.js';
import { TutorialController } from './tutorial.js';
import { CombatClock, nextSpeed } from './combat-clock.js';
import { Telemetry, ComboTracker, battleHighlight, defeatAdvice, nextObjective, shareText, encodeChallenge, decodeChallenge, challengeSetup, challengeReasons, publicChallengeUrl, BUILD_ID } from './experience.js';
import { renderShareCard, canvasBlob } from './share-card.js';
import { displayHeroPower, heroCombatStats, equipmentPreparation, runEquipmentPreparation } from './hero-presentation.js';
import { HERO_SKILL_COPY, skillPreviewSvg } from './hero-skill-copy.js';

const $ = id => document.getElementById(id);
const make = (tag, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
const button = (text, className, action) => { const node = make('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node; };
const portrait = (id, className = '') => { const node = make('img', '', className); node.src = heroPortrait(id); node.alt = BALANCE.heroes[id]?.name || '武将'; return node; };
const heroName = id => BALANCE.heroes[id]?.name || '武将';
const factionOf = id => HERO_ART[id]?.faction || 'shu';
const FACTION_COLOR = { wei:'#6fa8ff', shu:'#4fd68f', wu:'#ff8a4c' };
const QUALITY_COLOR = { white:'#d9d6c3', blue:'#5fb2ff', purple:'#b98cff', red:'#ff6b57', gold:'#ffc940' };
// ===== V2 feedback helpers: DOM-only, skipped under reduced motion, never touch game state =====
const calm = () => renderer.reducedMotion;
const rectOf = node => node?.getBoundingClientRect?.() || null;
function fxBurst(node, color = '#ffe7a6', count = 14) {
  const r = rectOf(node); if (!r || calm() || !document.body) return;
  for (let i = 0; i < count; i++) {
    const dot = make('i','','burst-dot'), a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 50;
    dot.style.left = r.left + r.width / 2 + 'px'; dot.style.top = r.top + r.height / 2 + 'px';
    dot.style.setProperty('--dx',Math.cos(a) * d + 'px'); dot.style.setProperty('--dy',Math.sin(a) * d + 'px'); dot.style.setProperty('--c',color);
    document.body.append(dot); setTimeout(() => dot.remove(),760);
  }
}
function fxFloat(node, text, color) {
  const r = rectOf(node); if (!r || calm() || !document.body) return;
  const label = make('div',text,'float-num'); label.style.left = r.left + r.width / 2 + 'px'; label.style.top = r.top - 6 + 'px'; if (color) label.style.color = color;
  document.body.append(label); setTimeout(() => label.remove(),1150);
}
function replayClass(node, name) { if (!node) return; node.classList.remove(name); void node.offsetWidth; node.classList.add(name); }
// Count-ups are driven by the main frame loop (no extra RAF chain). Text holds the true final value
// until the animation actually starts, so the DOM is always truthful when read.
const counters = [];
function countUp(node, to, { from = 0, delay = 0, duration = 900 } = {}) {
  const final = Math.round(to); node.textContent = String(final);
  for (let i = counters.length - 1; i >= 0; i--) if (counters[i].node === node) counters.splice(i,1);
  if (calm() || final === from) return;
  const start = performance.now() + delay; counters.push({ node, from, to:final, start, end:start + duration });
}
function tickCounters(now) {
  for (let i = counters.length - 1; i >= 0; i--) {
    const c = counters[i]; if (now < c.start) continue;
    const k = Math.min(1,(now - c.start) / (c.end - c.start)), e = 1 - Math.pow(1 - k,3);
    c.node.textContent = String(Math.round(c.from + (c.to - c.from) * e)); if (k >= 1) counters.splice(i,1);
  }
}
function finishCounters() { for (const c of counters.splice(0)) c.node.textContent = String(c.to); }
const factionNames = { wei:'魏', shu:'蜀', wu:'吴' };
const slotNames = { weapon:'武器', armor:'铠甲', command_token:'兵符', horse:'战马' };
const qualityNames = BALANCE.metaProgression.equipment.qualityNames;
const equipmentDefinitions = BALANCE.metaProgression.equipment.templates;
const itemName = item => equipmentDefinitions[item?.templateId]?.name || slotNames[item?.slot] || '装备';
const itemCopy = item => `${itemName(item)} · ${qualityNames[item.quality]}色 · 强化 Lv${item.level}`;
const lootRatesCopy = Object.entries(BALANCE.loot.qualityWeights).map(([quality,weight]) => `${qualityNames[quality]} ${weight / BALANCE.loot.weightScale * 100}%`).join(' · ');
const campGlyphs = { shield:'盾', archer:'弓', crossbow:'弩', catapult:'石', fire_oil:'火', war_drum:'鼓' };
const campCopy = { shield:'减速聚敌', archer:'连续迎击', crossbow:'破甲收尾', catapult:'低频碎石减速', fire_oil:'持续灼烧留敌', war_drum:'范围军阵增益' };
const gearCopy = { weapon:'增强本人普攻与无双伤害', armor:'提高全队城关最大耐久', command_token:'增强全队军营伤害', horse:'扩大本人普攻射程' };
const reasons = { insufficient_resources:'培养资源不足', hero_level_required:'请先提升武将等级', tier_required:'推进主线后开放', progress_required:'推进主线后开放科技', camp_locked:'先通过主线开放此军营', max_technology_level:'科技已满级', equipped_item:'请先将装备卸下或换装', equipment_equipped:'已穿戴装备不可分解', inventory_full:'装备背包已满，请手动分解闲置行装', gold_forge_forbidden:'金色专属武器仅由胜利装备箱掉落', max_level:'武将已达等级上限', max_skill_level:'技能已满级', max_equipment_level:'装备已满级', max_equipment_quality:'装备已达最高可升品质', hero_not_owned:'先通过主线解锁这名武将', level_locked:'先通关上一阵', save_read_only:'存档版本较新，请使用更新版本打开', invalid_json:'存档文本格式不正确', import_too_large:'存档文件过大', already_settled:'本局奖励已经领取', invalid_party:'编队必须使用已拥有且不重复的武将' };
function reason(result) { return reasons[result?.reason] || (/\p{Script=Han}/u.test(result?.reason || '') ? result.reason : '操作未完成，请检查条件后重试'); }
const resourcesCopy = value => [value?.experience_book ? `${value.experience_book} 册` : '', value?.copper_coin ? `${value.copper_coin} 铜` : '', value?.refined_iron ? `${value.refined_iron} 铁` : ''].filter(Boolean).join(' · ') || '无额外资源';
const starsCopy = n => '★'.repeat(n) + '☆'.repeat(3 - n);
const formatTime = seconds => `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(Math.floor(seconds % 60)).padStart(2,'0')}`;

const WEAPON_TIMBRES = {
  crescent:{frequency:250,endFrequency:62,duration:.13,volume:.042,noiseDuration:.14,noiseVolume:.065,cutoff:1700}, axe:{frequency:190,endFrequency:52,duration:.15,volume:.046,noiseDuration:.12,noiseVolume:.07,cutoff:1200},
  saber:{frequency:290,endFrequency:80,duration:.11,volume:.04,noiseDuration:.11,noiseVolume:.06,cutoff:2100}, serpent:{frequency:230,endFrequency:70,duration:.12,volume:.044,noiseDuration:.1,noiseVolume:.055,cutoff:1500},
  spear:{frequency:520,endFrequency:180,duration:.08,volume:.034,noiseDuration:.07,noiseVolume:.05,cutoff:3200}, hook:{frequency:430,endFrequency:150,duration:.09,volume:.036,noiseDuration:.08,noiseVolume:.05,cutoff:2700},
  halberds:{frequency:380,endFrequency:120,duration:.1,volume:.036,noiseDuration:.09,noiseVolume:.05,cutoff:2400}, knives:{frequency:640,endFrequency:260,duration:.06,volume:.03,noiseDuration:.05,noiseVolume:.045,cutoff:3800},
  sword:{frequency:470,endFrequency:240,duration:.1,volume:.032,noiseDuration:.06,noiseVolume:.04,cutoff:3000}, swords:{frequency:500,endFrequency:250,duration:.1,volume:.032,noiseDuration:.07,noiseVolume:.042,cutoff:3100},
  seal:{frequency:330,endFrequency:300,duration:.16,volume:.03,noiseDuration:.04,noiseVolume:.02,cutoff:2200}, bow:{frequency:610,endFrequency:400,duration:.09,volume:.03,noiseDuration:.04,noiseVolume:.03,cutoff:3400},
  fan:{frequency:360,endFrequency:330,duration:.14,volume:.022,noiseDuration:.16,noiseVolume:.04,cutoff:2600}, 'curved-fan':{frequency:300,endFrequency:240,duration:.15,volume:.022,noiseDuration:.17,noiseVolume:.04,cutoff:2300},
  'fire-fan':{frequency:280,endFrequency:200,duration:.15,volume:.026,noiseDuration:.18,noiseVolume:.05,cutoff:1900},
};
const safeStorage = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })();
const telemetry = new Telemetry({ storage: safeStorage });
const combo = new ComboTracker();
const store = new CampaignStore();
const sound = new AudioSystem({ ...store.state.settings, timbres: {
  camps: {
    crossbow:{frequency:760,endFrequency:140,duration:.10,volume:.045,noiseDuration:.07,noiseVolume:.028,cutoff:2500,interval:.12},
    fire_oil:{frequency:190,endFrequency:80,duration:.15,volume:.030,noiseDuration:.22,noiseVolume:.041,cutoff:900,interval:.30},
    war_drum:{frequency:85,endFrequency:42,duration:.20,volume:.055,noiseDuration:.07,noiseVolume:.01,cutoff:750,interval:.6},
  },
  // Hero timbre follows the weapon family: heavy blades low and metallic, spears bright, fans airy, bows plucked.
  heroes:Object.fromEntries(Object.keys(BALANCE.heroes).map(id => [id,WEAPON_TIMBRES[HERO_ART[id]?.gear] || WEAPON_TIMBRES.sword]))
} });
const tutorial = new TutorialController({ flow: 'v1' });
const combatClock = new CombatClock();
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const renderer = new V1Renderer($('battle-canvas'),{ reducedMotion:store.state.settings.reducedMotion || motionPreference.matches });
renderer.releaseLabel = false; // the DOM cut-in names the hero and skill; the canvas keeps the battlefield clear
let game = null;
let mode = 'lobby';
let selectedLevelId = CONTENT.levels.find(level => store.isLevelUnlocked(level.id) && !store.state.levels[level.id]?.cleared)?.id || CONTENT.levels.at(-1).id;
let selectedChapter = store.getLevel(selectedLevelId).chapterId;
let selectedSlot = -1;
let formationCursor = -1;
let battleId = null;
let settlement = null;
let lootRevealed = false;
let inventorySlot = 'all';
let inventoryItemId = null;
let forgeTemplateId = 'basic_weapon';
let forceGuide = false;
let storyVisible = false;
let pageSuspended = false;
let previousState = '';
let choicesKey = '';
let commandsKey = '';
let tutorialKey = '';
let audioActive = null;
let last = performance.now();
let elapsedUi = 0;
let choiceRevealRemaining = 0;
let choiceRevealFrame = null;
let toastTimer, bannerTimer, burstTimer;
let modalFocus = null;
const commandNodes = new Map();
let challenge = null;          // decoded friend challenge for the current battle, or null for campaign play
let battleWallStart = 0, battleFrozenMs = 0, unusedRageSec = 0, battleDeployed = false, battleCast = false;
let previousRecord = null, lastCutin = -Infinity, cutinTimer = null, tutorialDismissTimer = null;
let frameSamples = [], frameWindow = 0;
let detailLevelId = null, pauseIcon = null, pipsKey = '', lastHp = null, resultSessions = 0, resultTimers = [], intelReturn = null, suppressClick = false, heroFx = null, forgeFx = null, techFx = null, lootJustOpened = false;
const firstRun = { deploy: false, ultimate: false };

function toast(text) { $('toast').textContent = text; $('toast').classList.add('is-visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('is-visible'),2000); }
function banner(text, boss = false) { $('wave-banner').textContent = text; $('wave-banner').classList.toggle('is-boss',boss); $('wave-banner').classList.remove('is-visible'); void $('wave-banner').offsetWidth; $('wave-banner').classList.add('is-visible'); clearTimeout(bannerTimer); bannerTimer = setTimeout(() => $('wave-banner').classList.remove('is-visible'),1800); }
function resetClock() { combatClock.resetAccumulator(); last = performance.now(); }
function notify(result, success) { if (result?.ok) { if (success) toast(success); if (result.persisted === false) toast(store.persistenceWarning); } else toast(reason(result)); return result?.ok; }
function bind(id, action) { $(id).addEventListener('click',event => { void sound.unlock(); sound.click(); action(event); }); }
// One primary action per screen: the battle button only lives on the campaign tab.
function showTab(id) { $('nav-pill').style.setProperty('--tab',String(['campaign','heroes','workshop','settings'].indexOf(id))); for (const name of ['campaign','heroes','workshop','settings']) { $(name + '-screen').hidden = name !== id; $(name + '-tab').classList.toggle('is-active',name === id); $(name + '-tab').setAttribute('aria-pressed',String(name === id)); } $('lobby-action').hidden = id !== 'campaign'; if (id === 'workshop') renderWorkshop(); $('lobby-scroll').scrollTop = 0; }
let workshopPanel = 'tech';
function showWorkshopPanel(id) { workshopPanel = id; document.querySelector('.segmented')?.style.setProperty('--seg',String(['tech','forge','bag'].indexOf(id))); for (const name of ['tech','forge','bag']) { $('ws-panel-' + name).hidden = name !== id; $('ws-tab-' + name).classList.toggle('is-active',name === id); $('ws-tab-' + name).setAttribute('aria-pressed',String(name === id)); } $('lobby-scroll').scrollTop = 0; }
const chip = (glyph, label, className = '') => { const node = make('li','',className); node.append(make('i',glyph),make('span',label)); return node; };
const currentLevelId = () => CONTENT.levels.find(level => store.isLevelUnlocked(level.id) && !store.state.levels[level.id]?.cleared)?.id;

// ===== One-tap preparation: spend the player's attention on battle, not menus =====
// Uses only existing store operations, so costs, rules and save format are unchanged.
const QUALITY_RANK = { white:0, blue:1, purple:2, red:3, gold:4 };
const gearScore = (item, heroId) => item ? QUALITY_RANK[item.quality] * 100 + item.level + (item.exclusiveHeroId === heroId ? 50 : 0) : -1;
const partyIds = () => [store.state.party.lead, ...store.state.party.supports].filter(id => store.state.heroes[id]);
function gearUpgrades() {
  const moves = []; const claimed = new Set();
  for (const id of partyIds()) for (const slot of BALANCE.metaProgression.equipment.slots) {
    const current = store.getHero(id).equipment[slot];
    // Only idle items are used; gear worn by other heroes is never taken away silently.
    const best = store.getInventory({slot}).filter(item => !item.equippedHeroId && !claimed.has(item.itemInstanceId)).sort((a,b) => gearScore(b,id) - gearScore(a,id))[0];
    if (best && gearScore(best,id) > gearScore(current,id)) { claimed.add(best.itemInstanceId); moves.push({heroId:id,item:best}); }
  }
  return moves;
}
function trainingOptions() {
  const options = [];
  for (const id of partyIds()) {
    options.push([store.getTrainingCost(id),() => store.trainHero(id)],[store.getSkillCost(id),() => store.trainSkill(id)]);
    if (store.getHero(id).equipment.weapon) options.push([store.getEquipmentUpgradeCost(id,'weapon'),() => store.upgradeEquipment(id,'weapon')]);
  }
  return options.filter(([quote]) => canBuy(quote));
}
const hasPrepareWork = () => !store.readOnly && (gearUpgrades().length > 0 || trainingOptions().length > 0);
function runPrepare() {
  let equipped = 0, trained = 0;
  for (const move of gearUpgrades()) if (store.equipEquipment(move.heroId,move.item.itemInstanceId).ok) equipped++;
  // Cheapest affordable step first spreads growth evenly across the party.
  for (let guard = 0; guard < 400; guard++) {
    const options = trainingOptions().sort(([a],[b]) => (a.cost.copper_coin + a.cost.refined_iron * 10) - (b.cost.copper_coin + b.cost.refined_iron * 10));
    if (!options.length || !options[0][1]().ok) break;
    trained++;
  }
  return { equipped, trained };
}
function showPrepare() {
  const body = openModal('一键整备');
  const moves = gearUpgrades(), steps = trainingOptions().length;
  body.append(make('p',moves.length ? `换上 ${moves.length} 件更好的闲置装备` : '装备已是最佳','modal-note'));
  body.append(make('p',steps ? `用现有资源升级出战武将（等级、技能、主武器）\n持有：${resourcesCopy(store.state.resources)}` : '资源暂不足以继续培养','modal-note'));
  const actions = make('div','','modal-actions');
  const confirm = button('确认整备','',() => { const result = runPrepare(); closeModal(); renderCampaign(); fxBurst($('prepare-button'),'#7ff0c4',18); if (result.trained) fxFloat($('prepare-button'),`升级 ×${result.trained}`); sound.handleEvent({type:'upgrade'}); toast(result.equipped || result.trained ? `整备完成 · 换装 ${result.equipped} · 升级 ${result.trained}` : '已是最佳状态'); });
  confirm.disabled = !moves.length && !steps;
  actions.append(button('取消','',closeModal),confirm); body.append(actions);
}

// Idle, non-exclusive white/blue gear is clutter once anything better exists.
const salvageCandidates = () => store.getInventory().filter(item => !item.equippedHeroId && !item.exclusiveHeroId && ['white','blue'].includes(item.quality));
function showBulkSalvage() {
  const items = salvageCandidates(); const body = openModal('清理闲置装备');
  const total = {}; for (const item of items) for (const [key,value] of Object.entries(BALANCE.metaProgression.equipment.salvage.byQuality[item.quality])) total[key] = (total[key] || 0) + value;
  body.append(make('p',`分解 ${items.length} 件未穿戴的白、蓝装备\n获得 ${resourcesCopy(total)}`,'modal-note'),make('p','专属装备、紫色及以上和已穿戴装备不受影响。强化投入不返还。','modal-note'));
  const actions = make('div','','modal-actions');
  const confirm = button('确认分解','is-danger',() => { let count = 0; for (const item of items) if (store.salvageEquipment(item.itemInstanceId).ok) count++; closeModal(); renderCampaign(); toast(`已分解 ${count} 件`); });
  confirm.disabled = !items.length || store.readOnly;
  actions.append(button('保留','',closeModal),confirm); body.append(actions);
}
function renderShortcuts() {
  const work = store.readOnly ? 0 : gearUpgrades().length + trainingOptions().length;
  $('prepare-button').classList.toggle('has-upgrade',work > 0); $('prepare-button').disabled = store.readOnly;
  let badge = $('prepare-button').querySelector('.up-count');
  if (work && !badge) { badge = make('span','','up-count'); badge.setAttribute('aria-hidden','true'); $('prepare-button').append(badge); }
  if (badge) { if (work) badge.textContent = String(Math.min(99,work)); else badge.remove(); }
  const count = salvageCandidates().length; $('bulk-salvage-count').textContent = count ? String(Math.min(99,count)) : ''; $('bulk-salvage').disabled = !count || store.readOnly;
  $('bulk-salvage').setAttribute('aria-label',count ? `清理闲置白蓝装备，可清理 ${count} 件` : '清理闲置白蓝装备，暂无可清理');
}

// ===== Kill streak: rules live in ComboTracker (combat-time window, see experience.js) =====
function resetCombo() { combo.reset(); $('combo-counter').classList.remove('is-visible','is-hot','is-blaze'); }
function bumpCombo(time) {
  const { count, milestone } = combo.kill(time);
  if (milestone) sound.handleEvent({type:'combo',count});
  syncCombo(time); if (count >= 5) replayClass($('combo-counter'),'is-kick');
}
function syncCombo(time = game?.time) {
  const count = combo.current(time), node = $('combo-counter');
  node.classList.toggle('is-visible',count >= 5);
  if (count >= 5) $('combo-count').textContent = String(count);
  node.classList.toggle('is-hot',count >= 20 && count < 50); node.classList.toggle('is-blaze',count >= 50);
}

// ===== Peerless cut-in: portrait + skill name; compact when casts chain so repeats never slow the battle =====
function showCutin(event) {
  const hero = game?.heroes.find(h => h.id === event.heroId); if (!hero) return;
  const now = performance.now(), chained = now - lastCutin < 4000; lastCutin = now;
  const node = $('skill-cutin');
  $('cutin-portrait').src = heroPortrait(hero.id); $('cutin-hero').textContent = hero.name; $('cutin-skill').textContent = hero.definition.ultimate.name;
  node.dataset.faction = factionOf(hero.id); node.style.setProperty('--cut',FACTION_COLOR[factionOf(hero.id)]);
  node.classList.toggle('is-compact',chained || hero.role !== 'lead');
  node.classList.remove('is-visible'); void node.offsetWidth; node.classList.add('is-visible');
  $('battle-announcer').textContent = `${hero.name}发动${hero.definition.ultimate.name}`;
  clearTimeout(cutinTimer); cutinTimer = setTimeout(() => node.classList.remove('is-visible'),chained ? 650 : 1000);
}
function openModal(title, { page = false } = {}) {
  if ($('lobby-modal').hidden) modalFocus = document.activeElement;
  $('modal-title').textContent = title;
  for (const node of $('lobby-modal').querySelectorAll('.hero-heading-meta,.hero-pager')) node.remove();
  $('modal-body').replaceChildren(); $('modal-body').className = page ? 'hero-detail-body' : '';
  $('lobby-modal').classList.toggle('is-page',page); document.body.classList.toggle('has-hero-page',page);
  $('modal-close').textContent = page ? '‹' : '×'; $('modal-close').setAttribute('aria-label',page ? '返回武将列表' : '关闭窗口');
  $('lobby-modal').hidden = false; $('modal-close').focus(); resetClock(); return $('modal-body');
}
function closeModal() {
  $('lobby-modal').hidden = true; $('lobby-modal').classList.remove('is-page'); document.body.classList.remove('has-hero-page');
  $('modal-body').replaceChildren();
  const returnTo = modalFocus && document.body.contains(modalFocus) ? modalFocus : mode === 'lobby' ? document.querySelector('.lobby-nav')?.querySelector('[aria-pressed="true"]') : $('pause-button');
  returnTo?.focus?.(); modalFocus = null; resetClock();
}
function syncResources() { $('books-value').textContent = store.state.resources.experience_book; $('coins-value').textContent = store.state.resources.copper_coin; $('iron-value').textContent = store.state.resources.refined_iron; }

// Shared display-only strength includes levels, skills and all four equipment slots.
function heroPower(id) { return displayHeroPower(store.getHero(id)); }
let shownPower = null;
function renderParty() {
  const ids = [store.state.party.lead,...store.state.party.supports];
  const max = store.getMaxPartySize();
  $('party-slots').replaceChildren();
  // Stacked medallions: lead in front, supports tucked behind. Tap any medallion to adjust that slot.
  for (let index = 0; index < BALANCE.party.maxHeroes; index++) {
    const id = ids[index];
    const locked = index >= max;
    const node = button('',`party-med ${index === 0 ? 'is-lead' : ''} ${locked ? 'is-locked' : ''} ${id && !locked ? 'faction-' + factionOf(id) : 'is-empty'}`,() => { if (locked) { toast(index === 1 ? '通关魏篇第二关后开放协战' : '进入魏篇第九关开放第三阵位'); return; } showPartyPicker(index); });
    node.style.setProperty('--i',String(index));
    if (id && !locked) node.append(portrait(id),make('span',String(store.state.heroes[id].level),'lv-badge'),make('span',heroName(id),'sr-only'));
    else node.append(make('span',locked ? '锁' : '＋','med-glyph'));
    node.setAttribute('aria-label',locked ? `${index === 1 ? '协战' : '第三'}阵位尚未开放` : `${index === 0 ? '领衔' : '协战'}：${id ? `${heroName(id)} Lv${store.state.heroes[id].level}${index ? store.state.party.autoSkills[id] ? '，自动技能' : '，手动技能' : ''}` : '未选择'}，点击调整`);
    $('party-slots').append(node);
  }
  const power = ids.slice(0,max).filter(id => store.state.heroes[id]).reduce((sum,id) => sum + heroPower(id),0);
  countUp($('party-power'),power,{from:shownPower ?? power}); shownPower = power;
  $('party-unlock-note').textContent = `${Math.min(ids.filter(Boolean).length,max)} / ${max} 将`;
  $('party-section').classList.toggle('is-solo',max === 1);
  renderShortcuts();
  $('lead-portrait').src = heroPortrait(ids[0]); $('lead-portrait').alt = `领衔武将${heroName(ids[0])}`;
}

function drawMapPreview(map) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 -20 420 620'); svg.setAttribute('role','img'); svg.setAttribute('aria-label',map.name + '路线与营位');
  const add = (tag,attrs) => { const node = document.createElementNS(svg.namespaceURI,tag); for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,String(value)); svg.append(node); };
  for (const points of map.paths) { const d = points.map((p,index) => (index ? 'L' : 'M') + p.x + ' ' + p.y).join(' '); add('path',{d,fill:'none',stroke:'#d5c595','stroke-width':30,'stroke-linejoin':'round'}); }
  for (const slot of map.campSlots) add('circle',{cx:slot.x,cy:slot.y,r:17,fill:'#243e30',stroke:'#e1c185','stroke-width':4});
  add('rect',{x:152,y:510,width:116,height:25,fill:'#203933'});
  for (const pos of map.heroSlots) add('circle',{cx:pos.x,cy:pos.y,r:13,fill:'#9bcd99'});
  $('map-preview').replaceChildren(svg);
}

function renderLevelDetail() {
  const level = store.getLevel(selectedLevelId); const map = CONTENT.maps.find(m => m.id === level.mapId); const tier = BALANCE.stageGrowthTiers.find(t => t.id === level.growthTierId);
  const progress = store.state.levels[level.id]; const unlocked = store.isLevelUnlocked(level.id);
  const boss = level.waves.some(w => w.bossSpawn); const party = store.getPartyForLevel(level.id);
  const recommended = tier.recommendedHeroLevelRange[0]; const leadLevel = store.state.heroes[store.state.party.lead]?.level || 1;
  $('level-act').textContent = `${factionNames[level.chapterId]}篇 · 第 ${level.order} 阵`;
  $('selected-level-name').textContent = level.name;
  const earned = progress?.highestRewardedStars || 0;
  $('selected-level-stars').replaceChildren(...[0,1,2].map(i => i < earned ? make('b','★') : make('span','★')));
  $('selected-level-stars').setAttribute('aria-label',`${earned} 星`);
  $('level-brief').textContent = level.tacticalBrief; $('intel-title').textContent = level.name;
  $('intel-button').dataset.hint = '';
  if (detailLevelId !== level.id) { if (detailLevelId && !calm()) replayClass($('level-detail'),'is-swap'); detailLevelId = level.id; }
  // Glanceable facts: length, readiness, threat and reward. Everything else lives in 战前情报.
  const chips = [chip('波',`${level.waves.length} 波`),chip('将',`Lv ${recommended}`,leadLevel < recommended ? 'is-warn' : '')];
  if (boss) chips.push(chip('帅','敌将','is-boss'));
  chips.push(chip('赏',progress?.cleared ? '已首通' : resourcesCopy(level.firstClearReward)));
  $('mission-chips').replaceChildren(...chips);
  $('level-map-rule').textContent = `${map.name}：${map.rule.copy}`;
  $('level-recommendation').textContent = `建议：武将 Lv${recommended} · 技能 Lv${tier.recommendedSkillLevelRange[0]} · ${qualityNames[tier.recommendedMainWeaponQuality]}武器 Lv${tier.recommendedMainWeaponLevelRange[0]}`;
  $('level-rewards').textContent = '首通：' + resourcesCopy(level.firstClearReward);
  drawMapPreview(map);
  $('party-level-note').textContent = unlocked ? `本阵最多 ${level.maxPartySize} 将${party.length > 1 ? '，精锐耐久随人数提高' : ''}` : '';
  $('guest-option').hidden = !level.storyGuest || !unlocked;
  if (level.storyGuest) { $('guest-copy').textContent = `借将：${heroName(level.storyGuest.heroId)} Lv${level.storyGuest.level}（占一个阵位）`; $('guest-checkbox').checked = Boolean(store.state.guestSelections[level.id]); }
  $('campaign-start').disabled = !unlocked || store.readOnly;
  $('start-label').textContent = !unlocked ? '未开放' : progress?.cleared ? '再战' : '出阵';
  $('start-sub').textContent = unlocked ? `${party.map(h => heroName(h.heroId) + (h.guest ? '（借）' : '')).join(' · ')} 出战` : `${factionNames[level.chapterId]}篇第 ${level.order} 阵`;
  renderFocus(level);
}

// The home map deliberately shows only the selected stage and its immediate successor.
function renderFocus(level) {
  const chapter = CONTENT.chapters.find(c => c.id === level.chapterId), at = chapter.levelIds.indexOf(level.id);
  const next = store.getLevel(chapter.levelIds[at + 1]), progress = store.state.levels[level.id];
  const ns = 'http://www.w3.org/2000/svg', paths = [];
  for (const [name,d] of [['done','M-4 96 C10 90 16 52 30 48'],['todo','M30 48 C48 48 57 29 78 24 S100 8 113 3']]) {
    const path = document.createElementNS(ns,'path'); path.setAttribute('class',name); path.setAttribute('d',d); path.setAttribute('vector-effect','non-scaling-stroke'); paths.push(path);
  }
  $('focus-route').replaceChildren(...paths);
  const nodes = $('focus-nodes'); nodes.replaceChildren();
  const stageNode = (stage, nextStage) => {
    const boss = stage.waves.some(w => w.bossSpawn), cleared = store.state.levels[stage.id]?.cleared;
    const node = button(boss ? '帅' : String(stage.order),`focus-node ${nextStage ? 'is-next' : 'is-selected'}${boss ? ' is-boss' : ''}`,() => {
      if (suppressClick) return;
      if (nextStage) { selectedLevelId = stage.id; renderCampaign(); }
      else openIntel(stage.id);
    });
    node.dataset.levelId = stage.id;
    node.setAttribute('aria-label',`${nextStage ? '下一关' : '当前关'}：${stage.name}，第 ${stage.order} 阵${boss ? '，敌将关' : ''}，${cleared ? '已通关，可再战' : store.isLevelUnlocked(stage.id) ? '可挑战' : '未开放'}${nextStage ? '，点击选关' : '，长按查看战前情报'}`);
    nodes.append(node);
  };
  stageNode(level,false);
  const label = make('div','','focus-label is-selected'); label.append(make('strong',level.name));
  const showHint = level.globalIndex <= 3 && !intelHintSeen;
  const hint = make('small',progress?.cleared ? '已通关 · 可再战' : '当前关 · 长按看情报');
  if (showHint && !progress?.cleared) { intelHintSeen = true; hint.classList.add('is-intel-hint'); setTimeout(() => hint.classList.remove('is-intel-hint'),6000); }
  label.append(hint);
  nodes.append(label);
  const nextLabel = make('div','','focus-label is-next');
  if (next) { stageNode(next,true); nextLabel.append(make('span',`下一关 · ${next.name}`),make('small',next.waves.some(w => w.bossSpawn) ? '敌将关' : `第 ${next.order} 阵`)); }
  else {
    nextLabel.classList.add('is-chapter-end');
    const nextChapter = CONTENT.chapters[CONTENT.chapters.indexOf(chapter) + 1];
    nextLabel.append(make('span',nextChapter ? '下一章' : '三国终章'),make('small',nextChapter ? `${factionNames[nextChapter.id]}篇 · 第 1 阵` : '六十阵 · 征途圆满'));
  }
  nodes.append(nextLabel);
  const done = chapter.levelIds.filter(id => store.state.levels[id]?.cleared).length;
  $('focus-trail').textContent = `已行 ${done} 阵`;
  $('focus-map').setAttribute('aria-label',`${level.name}${next ? `与下一关${next.name}` : '，本章最后一阵'}`);
}

function renderCampaign() {
  syncResources(); renderParty();
  const cleared = Object.values(store.state.levels).filter(l => l.cleared).length;
  $('campaign-progress').textContent = `${cleared} / ${CONTENT.levels.length} 阵`;
  $('lobby-view').classList.toggle('is-fresh',cleared === 0);
  $('workshop-tab').classList.toggle('has-news',cleared > 0 && store.state.inventory.some(item => !item.equippedHeroId));
  $('chapter-tabs').replaceChildren();
  for (const chapter of CONTENT.chapters) { const opened = chapter.levelIds.some(id => store.isLevelUnlocked(id)); const tab = button(`${factionNames[chapter.id]}篇`,`${chapter.id === selectedChapter ? 'is-active' : ''} ${opened ? '' : 'is-locked'}`,() => { selectedChapter = chapter.id; selectedLevelId = chapter.levelIds.find(id => store.isLevelUnlocked(id) && !store.state.levels[id]?.cleared) || chapter.levelIds[0]; renderCampaign(); }); tab.setAttribute('aria-pressed',String(chapter.id === selectedChapter)); $('chapter-tabs').append(tab); }
  const chapter = CONTENT.chapters.find(c => c.id === selectedChapter);
  const done = chapter.levelIds.filter(id => store.state.levels[id]?.cleared).length;
  $('chapter-title').textContent = `${factionNames[chapter.id]}篇 · ${chapter.title}`;
  $('chapter-progress').textContent = `${done} / ${chapter.levelIds.length}`;
  $('chapter-meter').style.width = `${done / chapter.levelIds.length * 100}%`;
  renderMarch(chapter);
  renderLevelDetail(); renderRoster(); renderSettings(); renderWorkshop();
}

// ===== March map: a winding route through the chapter's 20 stages (bottom → top, snaking rows of 4) =====
const MARCH_COLS = [14, 38, 62, 86];
function marchPoint(index, count) {
  const rows = Math.ceil(count / 4), row = Math.floor(index / 4), col = index % 4;
  const x = MARCH_COLS[row % 2 ? 3 - col : col] + (col % 2 ? 2.5 : -2.5);
  const y = 87.5 - row * (78 / Math.max(1,rows - 1));
  return { x, y };
}
function marchPath(points) {
  if (!points.length) return '';
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) { const a = points[i - 1], b = points[i]; d += a.y === b.y ? ` L${b.x} ${b.y}` : ` C${a.x + (a.x > 50 ? 9 : -9)} ${a.y} ${b.x + (b.x > 50 ? 9 : -9)} ${b.y} ${b.x} ${b.y}`; }
  return d;
}
function renderMarch(chapter) {
  const ids = chapter.levelIds, current = currentLevelId(), points = ids.map((_,i) => marchPoint(i,ids.length));
  const reached = Math.max(0,...ids.map((id,i) => store.state.levels[id]?.cleared || id === current ? i : 0));
  const svg = $('march-route'); svg.setAttribute('viewBox','0 0 100 100'); svg.setAttribute('preserveAspectRatio','none');
  const ns = 'http://www.w3.org/2000/svg', route = (cls, pts) => { const path = document.createElementNS(ns,'path'); path.setAttribute('d',marchPath(pts)); path.setAttribute('class',cls); path.setAttribute('vector-effect','non-scaling-stroke'); return path; };
  svg.replaceChildren(route('todo',points),route('done',points.slice(0,reached + 1)));
  $('level-grid').replaceChildren();
  ids.forEach((id, i) => {
    const level = store.getLevel(id), unlocked = store.isLevelUnlocked(id), stars = store.state.levels[id]?.highestRewardedStars || 0, boss = level.waves.some(w => w.bossSpawn);
    const node = button('',`level-card ${id === selectedLevelId ? 'is-selected' : ''} ${id === current ? 'is-current' : ''} ${unlocked ? '' : 'is-locked'} ${boss ? 'is-boss' : ''}`,() => { if (suppressClick) return; selectedLevelId = id; renderCampaign(); closeRoute(); });
    node.dataset.levelId = id; node.style.setProperty('--x',points[i].x + '%'); node.style.setProperty('--y',points[i].y + '%');
    node.append(make('span',boss ? '帅' : String(level.order),'level-number'),make('span',level.name,'level-name'),make('span',stars ? '★'.repeat(stars) : '','level-stars'));
    node.setAttribute('aria-label',`第${level.order}关 ${level.name}${boss ? '，敌将关' : ''}，${unlocked ? stars ? `${stars}星` : '可挑战' : '待解锁'}。长按查看战前情报`);
    $('level-grid').append(node);
  });
  let flag = $('march-map').querySelector('.march-flag');
  if (!flag) { flag = make('span','','march-flag'); flag.setAttribute('aria-hidden','true'); flag.innerHTML = '<svg viewBox="0 0 30 40"><path d="M3 2V40" stroke="#f1e4c3" stroke-width="2.5"/><path d="M4 3h23l-5 8 5 8H4z" fill="#e2493b"/></svg>'; $('march-map').append(flag); }
  const at = ids.indexOf(selectedLevelId); flag.hidden = at < 0;
  if (at >= 0) { flag.style.setProperty('--x',points[at].x + '%'); flag.style.setProperty('--y',points[at].y + '%'); }
}

function renderRoster() {
  $('hero-roster').replaceChildren();
  Object.entries(BALANCE.heroes).forEach(([id,definition], index) => {
    const owned = store.state.heroes[id]; const included = [store.state.party.lead,...store.state.party.supports].includes(id);
    const unlock = BALANCE.metaProgression.heroUnlocks.find(u => u.heroId === id); const unlockLevel = unlock ? store.getLevel(unlock.levelId) : null;
    const node = button('',`hero-card faction-${factionOf(id)} ${owned ? '' : 'is-locked'} ${included ? 'is-in-party' : ''}`,() => { if (owned) showHero(id); else toast(unlockLevel ? `通关${factionNames[unlockLevel.chapterId]}篇第${unlockLevel.order}关「${unlockLevel.name}」解锁` : '主线解锁这名武将'); });
    node.style.setProperty('--i',String(index));
    const art = make('img'); art.alt = ''; art.src = owned ? heroPortrait(id) : heroSilhouette(id);
    node.append(art,make('span',factionNames[factionOf(id)],'faction-tag'));
    if (owned) {
      const pips = make('span','','pips'); pips.setAttribute('aria-hidden','true');
      const maxSkill = BALANCE.metaProgression.skillLevel?.max || 5;
      for (let i = 0; i < Math.min(5,maxSkill); i++) pips.append(make('i','',i < Math.ceil(owned.skillLevel / maxSkill * 5) ? 'on' : ''));
      node.append(make('span',String(owned.level),'lv-badge'),make('strong',definition.name),pips);
    } else node.append(make('strong',definition.name),make('small',unlockLevel ? `${factionNames[unlockLevel.chapterId]} ${unlockLevel.order} 解锁` : '主线解锁'));
    node.setAttribute('aria-label',owned ? `${definition.name}，${factionNames[factionOf(id)]}，Lv${owned.level}，技能 Lv${owned.skillLevel}，${definition.ultimate.name}${included ? '，出战中' : ''}` : `${definition.name}，未解锁`);
    $('hero-roster').append(node);
  });
  $('hero-owned-count').textContent = `${Object.keys(store.state.heroes).length} / ${Object.keys(BALANCE.heroes).length}`;
}

function showPartyPicker(index) {
  const body = openModal(index === 0 ? '选择领衔武将' : '选择协战武将');
  body.append(make('p',index === 0 ? '领衔：手动施放，开局 40 怒气。' : '协战：独立怒气，可设为自动。','modal-note'));
  const current = [store.state.party.lead,...store.state.party.supports];
  const grid = make('div','','modal-roster');
  for (const id of Object.keys(store.state.heroes)) { const pick = button('',current[index] === id ? 'is-chosen' : '',() => { const ids = [store.state.party.lead,...store.state.party.supports]; const other = ids.indexOf(id); if (other >= 0) { [ids[index],ids[other]] = [ids[other],ids[index]]; } else ids[Math.min(index,ids.length)] = id; if (notify(store.setParty(ids.filter(Boolean)),'将令已调整')) { closeModal(); renderCampaign(); } }); pick.append(portrait(id),make('span',heroName(id))); grid.append(pick); } body.append(grid);
  if (index > 0 && current[index]) { const id = current[index]; body.append(button(store.state.party.autoSkills[id] ? '自动技能：开（点按关闭）' : '自动技能：关（点按开启）', 'auto-toggle',() => { const flags = {[id]:!store.state.party.autoSkills[id]}; if (notify(store.setParty(current,flags),'协战将令已更新')) { closeModal(); renderCampaign(); } })); body.append(button('移出编队','auto-toggle',() => { if (notify(store.setParty(current.filter((_,i) => i !== index)),'已调整出战')) { closeModal(); renderCampaign(); } })); }
}

function canBuy(quote) { return quote?.ok && !store.readOnly && Object.entries(quote.cost || {}).every(([key,cost]) => store.state.resources[key] >= cost); }
function quoteCopy(quote) {
  if (quote.reason === 'hero_level_required') return `需要武将 Lv${quote.requiredHeroLevel}`;
  if (quote.reason === 'tier_required') return `主线 ${quote.requiredTier} 开放`;
  if (quote.reason === 'progress_required') return `主线第 ${quote.requiredGlobalIndex} 阵开放`;
  if (quote.reason === 'level_required') return `主线第 ${quote.requiredGlobalIndex} 阵开放`;
  if (!quote.ok) return reason(quote);
  const missing = Object.fromEntries(Object.entries(quote.cost || {}).map(([key,cost]) => [key,Math.max(0,cost - store.state.resources[key])]));
  const shortage = Object.values(missing).some(value => value > 0) ? ' · 缺 ' + resourcesCopy(missing) : '';
  return resourcesCopy(quote.cost) + shortage;
}
function signatureCopy(item, heroId = item.equippedHeroId) {
  const template = equipmentDefinitions[item.templateId];
  if (!template?.exclusiveHeroId) return gearCopy[item.slot];
  const active = heroId === template.exclusiveHeroId;
  return `${heroName(template.exclusiveHeroId)}专属 · ${active ? '本人效果已激活' : '本人效果未激活'}：${template.effectDescription}。任何武将均可穿戴。`;
}
function showEquipmentPicker(heroId, slot) {
  const body = openModal(`${heroName(heroId)} · 选择${slotNames[slot]}`);
  body.append(make('p','换下的装备回到背包；从他人处转移会空出原槽。','modal-note'));
  const items = store.getInventory({slot});
  for (const item of items) {
    const current = item.equippedHeroId === heroId;
    const row = make('div','',`equipment-card quality-${item.quality}`);
    row.classList.add('equipment-picker-card');
    row.append(gearTile(item,{size:64,heroId,owner:item.equippedHeroId}),make('strong',itemCopy(item)),make('small',(current ? '' : '换装后：') + signatureCopy(item,heroId)),make('small',current ? '本将正在穿戴' : item.equippedHeroId ? `${heroName(item.equippedHeroId)}正在穿戴 · 可转移` : '背包待用'));
    const pick = button(current ? '已穿戴' : item.equippedHeroId ? `转移给${heroName(heroId)}` : '换装','equipment-pick',() => { if (notify(store.equipEquipment(heroId,item.itemInstanceId),'行装已调整')) { renderCampaign(); showHero(heroId); } });
    pick.disabled = current || store.readOnly; row.append(pick); body.append(row);
  }
  if (!items.length) body.append(make('p','此槽暂无装备，可在工坊锻造。','modal-note'));
  body.append(button('← 返回','auto-toggle',() => showHero(heroId)));
}
function showSalvage(item) {
  const body = openModal('分解闲置装备');
  body.append(make('p',itemCopy(item),'modal-note'),make('p',`分解后获得：${resourcesCopy(BALANCE.metaProgression.equipment.salvage.byQuality[item.quality])}。强化投入不返还。`,'modal-note'));
  if (equipmentDefinitions[item.templateId]?.exclusiveHeroId) body.append(make('p',signatureCopy(item),'modal-note'));
  const actions = make('div','','modal-actions');
  const confirm = button('确认分解','is-danger',() => { if (notify(store.salvageEquipment(item.itemInstanceId),'行装已分解')) { closeModal(); renderCampaign(); } });
  confirm.disabled = Boolean(item.equippedHeroId) || store.readOnly;
  actions.append(button('保留装备','',closeModal),confirm); body.append(actions);
}
function renderWorkshop() {
  $('technology-list').replaceChildren();
  const RING = 2 * Math.PI * 27;
  for (const [campId,definition] of Object.entries(BALANCE.technology.camps)) {
    const level = store.state.technology[campId]; const quote = store.getTechnologyCost(campId); const bonuses = definition.perLevelBonuses;
    const locked = !quote.ok && ['camp_locked','progress_required','level_required','tier_required'].includes(quote.reason);
    const row = make('div','',`technology-card ${locked ? 'is-locked' : ''} ${techFx === campId ? 'is-pop' : ''}`);
    const ring = make('span','','tech-ring'); ring.setAttribute('aria-hidden','true');
    ring.innerHTML = `<svg viewBox="0 0 64 64"><circle class="bg" cx="32" cy="32" r="27"/><circle class="fg" cx="32" cy="32" r="27" stroke-dasharray="${RING.toFixed(2)}" stroke-dashoffset="${(RING * (1 - level / definition.levelMax)).toFixed(2)}"/></svg>`;
    ring.append(make('span',campGlyphs[campId] || definition.name[0],'tech-core'));
    const copy = make('div','','tech-copy');
    const delta = make('span','','tech-delta'); for (const text of [bonuses.damage ? `伤害 +${Number((bonuses.damage * 100).toFixed(1))}%` : '', `范围 +${bonuses.range}`, bonuses.auraDamage ? `军阵 +${Number((bonuses.auraDamage * 100).toFixed(1))}%` : '']) if (text) delta.append(make('span',text));
    copy.append(make('strong',definition.name),make('span',`Lv ${level} / ${definition.levelMax}`,'tech-level'),make('small','每级效果'),delta);
    const research = button('','workshop-action',() => { if (notify(store.researchTechnology(campId),'军营科技已精进')) { techFx = campId; renderCampaign(); techFx = null; const card = $('technology-list').querySelectorAll('.technology-card')[Object.keys(BALANCE.technology.camps).indexOf(campId)]; fxBurst(card?.querySelector?.('.tech-ring'),'#ffe7a6',16); fxFloat(card?.querySelector?.('.tech-ring'),`Lv${store.state.technology[campId]}`,'#ffe7a6'); } });
    research.append(make('span',level >= definition.levelMax ? '已满级' : '研究'),make('small',quoteCopy(quote))); research.disabled = !canBuy(quote);
    row.append(ring,copy,research); $('technology-list').append(row);
  }
  $('forge-list').replaceChildren();
  const forgeDef = equipmentDefinitions[forgeTemplateId];
  const forgeQuality = forgeFx || forgeDef.forgeQualities.at(-1) || 'white';
  const stage = make('div','',`forge-stage quality-${forgeQuality}`);
  const forgeArt = gearTile({templateId:forgeTemplateId,slot:forgeDef.slot,quality:forgeQuality,level:BALANCE.metaProgression.equipment.forging.levelAtForge},{size:96,showOwner:false,showExclusive:false});
  const forgeCopy = make('div','','forge-stage-copy'); forgeCopy.append(make('strong',forgeDef.name),make('p',`${slotNames[forgeDef.slot]} · ${gearCopy[forgeDef.slot]}`),make('p','白 → 蓝 → 紫 → 红'));
  stage.append(forgeArt,forgeCopy); $('forge-list').append(stage);
  if (forgeFx && !calm()) { replayClass(forgeArt,'is-pop'); fxBurst(forgeArt,QUALITY_COLOR[forgeQuality],22); }
  const label = make('label','锻造行装','forge-label'); label.setAttribute('for','forge-template');
  const select = make('select','','forge-select'); select.id = 'forge-template'; select.setAttribute('aria-label','选择锻造装备');
  for (const definition of Object.values(equipmentDefinitions).filter(template => template.forgeQualities.length)) { const option = make('option',`${definition.name} · ${definition.exclusiveHeroId ? heroName(definition.exclusiveHeroId) + '专属' : slotNames[definition.slot]}`); option.value = definition.id; select.append(option); }
  select.value = forgeTemplateId; select.addEventListener('change',() => { forgeTemplateId = select.value; renderWorkshop(); });
  $('forge-list').append(label,select);
  const definition = equipmentDefinitions[forgeTemplateId];
  if (definition.exclusiveHeroId) $('forge-list').append(make('p',`${heroName(definition.exclusiveHeroId)}本人穿戴：${definition.effectDescription}；任何武将均可穿戴。`,'quiet-note'));
  const forgeActions = make('div','','forge-actions');
  for (const quality of definition.forgeQualities) { const quote = store.getForgeCost(forgeTemplateId,quality); const forge = button('',`workshop-action quality-${quality}`,() => { if (notify(store.forgeEquipment(forgeTemplateId,quality),`${definition.name}已入背包`)) { forgeFx = quality; renderCampaign(); forgeFx = null; } }); forge.append(make('strong',`锻造${qualityNames[quality]}色`),make('small',quoteCopy(quote))); forge.disabled = !canBuy(quote); forgeActions.append(forge); }
  $('forge-list').append(forgeActions);
  const inventory = store.getInventory();
  $('inventory-filters').replaceChildren();
  const slotPaths = { weapon:'M5 19 19 5M14 5h5v5M4 15l5 5', armor:'M5 4 9 2c0 4 6 4 6 0l4 2 3 5-4 2v10H6V11L2 9z', command_token:'M7 3h10v18H7zM10 7h4M10 11h4M10 15h4', horse:'m6 21 1-8 6-7 1-4 4 4 3 4-2 3-5-1-1 9M6 21h11' };
  for (const slot of ['all',...BALANCE.metaProgression.equipment.slots]) {
    const count = slot === 'all' ? inventory.length : inventory.filter(item => item.slot === slot).length;
    const label = slot === 'all' ? '全部' : slotNames[slot];
    const filter = button('',inventorySlot === slot ? 'is-active' : '',() => { inventorySlot = slot; renderWorkshop(); });
    filter.setAttribute('data-slot',slot); filter.setAttribute('aria-label',`${label}，${count} 件`); filter.setAttribute('aria-pressed',String(inventorySlot === slot));
    if (slot === 'all') filter.append(make('span',label));
    else { const icon = make('span','','filter-icon'); icon.setAttribute('aria-hidden','true'); icon.innerHTML = `<svg viewBox="0 0 24 24"><path d="${slotPaths[slot]}"/></svg>`; filter.append(icon); }
    const badge = make('b',String(count),'filter-count'); badge.setAttribute('aria-hidden','true'); filter.append(badge); $('inventory-filters').append(filter);
  }
  const items = inventory.filter(item => inventorySlot === 'all' || item.slot === inventorySlot);
  $('inventory-count').textContent = String(inventory.length);
  $('inventory-meta').textContent = `${inventory.length} 件 · 闲置 ${inventory.filter(item => !item.equippedHeroId).length}`;
  $('inventory-capacity').hidden = inventory.length < 3900;
  $('inventory-capacity').textContent = inventory.length >= 3900 ? `背包将满：${inventory.length} / 4000，请清理闲置装备` : '';
  if (!items.some(item => item.itemInstanceId === inventoryItemId)) inventoryItemId = items[0]?.itemInstanceId || null;
  $('inventory-list').replaceChildren();
  items.forEach(item => {
    const row = button('',`equipment-card quality-${item.quality}`,() => { inventoryItemId = item.itemInstanceId; renderInventoryDetail(); });
    row.setAttribute('data-item-id',item.itemInstanceId);
    const tile = gearTile(item); row.setAttribute('aria-label',tile.getAttribute('aria-label')); row.append(tile,make('strong',itemName(item))); $('inventory-list').append(row);
  });
  if (!items.length) $('inventory-list').append(make('p','暂无装备。胜利箱与锻造可获得。','quiet-note'));
  renderInventoryDetail();
}
function renderInventoryDetail() {
  const item = store.getInventory().find(gear => gear.itemInstanceId === inventoryItemId), detail = $('inventory-detail'); detail.replaceChildren();
  for (const row of $('inventory-list').querySelectorAll('.equipment-card')) { const selected = row.getAttribute('data-item-id') === inventoryItemId; row.classList.toggle('is-selected',selected); row.setAttribute('aria-pressed',String(selected)); }
  if (!item) { detail.append(make('p','选择装备查看详情','quiet-note')); return; }
  detail.className = `inventory-detail quality-${item.quality}`;
  const copy = make('div','','inventory-detail-copy');
  copy.append(make('strong',itemName(item)),make('span',`${qualityNames[item.quality]}色 · 强化 Lv ${item.level}`),make('p',signatureCopy(item)),make('span',item.equippedHeroId ? `${heroName(item.equippedHeroId)}穿戴中` : '闲置'));
  const actions = make('div','','inventory-detail-actions');
  if (item.equippedHeroId) actions.append(button('去换装','',() => showHero(item.equippedHeroId)));
  else {
    const equip = button('穿戴','',() => showInventoryEquip(item)); equip.disabled = store.readOnly; actions.append(equip);
    if (!item.exclusiveHeroId) { const salvage = button('分解','salvage-button',() => showSalvage(item)); salvage.disabled = store.readOnly; actions.append(salvage); }
  }
  detail.append(gearTile(item,{size:56,showOwner:false,showExclusive:false}),copy,actions);
}
function showInventoryEquip(item) {
  const body = openModal('选择穿戴武将'); body.append(make('p',itemCopy(item),'modal-note'));
  const roster = make('div','','modal-roster');
  for (const id of Object.keys(store.state.heroes)) {
    const pick = button('','',() => { if (notify(store.equipEquipment(id,item.itemInstanceId),'行装已调整')) { closeModal(); renderCampaign(); } });
    pick.append(portrait(id),make('span',heroName(id))); pick.disabled = store.readOnly; roster.append(pick);
  }
  body.append(roster);
}
function showLootRates() {
  const body = openModal('胜利箱掉率');
  const rates = make('p',lootRatesCopy,'modal-note'); rates.id = 'workshop-loot-rates';
  body.append(make('p','每次胜利 1 箱，失败不掉落。结果在结算时保存。','modal-note'),rates,make('p','金色为武将专属武器。任何武将都能穿戴，本人穿戴另有专属效果。','modal-note'));
}
function statBar(label, value, max, text) { const row = make('div','','statbar'); const bar = make('span','','bar'); const fill = make('i'); fill.style.setProperty('--w',`${Math.max(4,Math.min(100,value / max * 100))}%`); bar.append(fill); row.append(make('span',label),bar,make('b',text)); return row; }
function showHero(id, keepModal = false) {
  const hero = store.getHero(id); if (!hero) return;
  const body = openModal(heroName(id),{page:true});
  const copy = HERO_SKILL_COPY[id], stats = heroCombatStats(hero), owned = Object.keys(store.state.heroes), current = owned.indexOf(id);
  body.classList.add(`faction-${factionOf(id)}`); body.dataset.heroId = id;
  const heading = $('modal-title').parentElement, meta = make('div','','hero-heading-meta');
  meta.append(make('span',factionNames[factionOf(id)],`hero-faction faction-${factionOf(id)}`),make('span',copy.role,'hero-role'));
  const pager = make('div','','hero-pager');
  const previous = button('‹','hero-page-arrow',() => showHero(owned[(current-1+owned.length)%owned.length])); previous.setAttribute('aria-label','上一位已拥有武将');
  const next = button('›','hero-page-arrow',() => showHero(owned[(current+1)%owned.length])); next.setAttribute('aria-label','下一位已拥有武将');
  previous.disabled = next.disabled = owned.length < 2;
  pager.append(previous,make('span',`${current+1} / ${owned.length}`),next); heading.append(meta,pager);
  const power = make('div','','hero-power-block'), powerNumber = make('b',String(heroPower(id))); powerNumber.id = 'hero-power';
  power.append(make('small','战力'),powerNumber);
  const attributes = make('div','','hero-attributes'), number = value => Number(value.toFixed(2)).toString();
  for (const [key,label,value,detail] of [
    ['attack','攻击',number(stats.attack),'本人普攻伤害，含等级、武器与本人专属加成'],
    ['range','射程',number(stats.range),'普攻射程，含战马与本人专属加成'],
    ['interval','攻速',`${number(stats.interval)}秒`,'普攻间隔'],
    ['gate','守城',`${number(stats.gate*100)}%`,'本将装备提供的全队城关最大耐久加成'],
  ]) {
    const attr = make('span','','hero-attribute'); attr.dataset.stat = key; attr.setAttribute('aria-label',`${detail}：${value}`);
    attr.append(make('span',label),make('b',value)); attributes.append(attr);
  }
  power.append(attributes,make('span','守城：本将装备为全队提供城关最大耐久加成','sr-only')); body.append(power);

  const train = key => {
    const before = heroPower(id), result = key === 'level' ? store.trainHero(id) : store.trainSkill(id);
    if (!notify(result,'培养完成')) return;
    renderCampaign(); showHero(id,true); animateHeroChange(id,before,[]);
  };
  const stage = make('div','','hero-detail-stage'), left = make('div','','hero-gear-column'), right = make('div','','hero-gear-column');
  for (const slot of BALANCE.metaProgression.equipment.slots) {
    const gear = hero.equipment[slot], row = button('','gear-row hero-gear-slot',() => showHeroGear(id,slot));
    row.id = `hero-gear-${slot}`; row.dataset.slot = slot; row.setAttribute('aria-label',`${slotNames[slot]}：${gear ? itemCopy(gear) : '未装备'}，查看换装与强化`);
    row.append(gearTile(gear,{size:64,showOwner:true,heroId:id,owner:gear ? id : null,slot}),make('span',slotNames[slot],'hero-slot-name'));
    (['weapon','armor'].includes(slot) ? left : right).append(row);
  }
  const figure = make('div','','hero-detail-figure'), face = portrait(id,'hero-detail-portrait'); figure.append(face);
  const levelPill = button('','hero-level-pill',() => train('level')), trainQuote = store.getTrainingCost(id), xp = make('span','','hero-xp'), xpFill = make('i');
  xpFill.style.width = `${trainQuote.ok ? Math.min(100,hero.xp/trainQuote.xpNeeded*100) : 100}%`; xp.append(xpFill);
  levelPill.append(make('span',`Lv ${hero.level}`),xp,make('em',trainQuote.ok ? '升级' : '满级')); levelPill.disabled = !canBuy(trainQuote);
  levelPill.setAttribute('aria-label',`武将 Lv ${hero.level}，经验 ${hero.xp}，${quoteCopy(trainQuote)}`); figure.append(levelPill);
  stage.append(left,figure,right); body.append(stage);

  const skill = make('section','','hero-skill-card'), preview = button('','hero-skill-preview',() => { if (!calm()) replayClass(preview,'is-playing'); });
  preview.id = 'hero-skill-preview'; preview.dataset.shape = BALANCE.heroes[id].ultimate.shape; preview.setAttribute('aria-label',`重播${BALANCE.heroes[id].ultimate.name}技能预览`);
  preview.append(skillPreviewSvg(id),make('span','↻ 重播','hero-skill-replay')); if (!calm()) preview.classList.add('is-playing');
  const skillCopy = make('div','','hero-skill-copy'), title = make('strong',BALANCE.heroes[id].ultimate.name), pips = make('span','','hero-skill-pips');
  pips.setAttribute('aria-label',`技能 ${hero.skillLevel} / ${BALANCE.metaProgression.skillLevel.max} 级`);
  for (let i=0;i<5;i++) pips.append(make('i','',i<hero.skillLevel ? 'is-on' : ''));
  const tags = make('div','','hero-skill-tags'); for (const tag of copy.tags) tags.append(make('span',tag));
  skillCopy.append(title,pips,make('p',copy.description),tags); skill.append(preview,skillCopy); body.append(skill);

  const actions = make('div','','hero-training-actions');
  for (const [key,label,quote,level] of [['level','升级',trainQuote,hero.level],['skill','技能',store.getSkillCost(id),hero.skillLevel]]) {
    const node = button('','training-action',() => train(key));
    node.append(make('strong',quote.targetLevel ? `${label} Lv ${quote.targetLevel}` : `${label}已满级 Lv ${level}`),make('small',quoteCopy(quote))); node.disabled = !canBuy(quote); actions.append(node);
  }
  const plan = equipmentPreparation(store,id), all = button('','hero-upgrade-all',() => {
    const before = heroPower(id), result = runEquipmentPreparation(store,id);
    renderCampaign(); showHero(id,true); animateHeroChange(id,before,result.upgraded);
    if (result.upgraded.length) sound.handleEvent({type:'upgrade'});
    toast(`已强化 ${result.upgraded.length} / ${result.count} 格${result.equipped ? ` · 已适配 ${result.equipped} 件` : ''}`);
  });
  all.id = 'hero-upgrade-all'; all.disabled = store.readOnly || !plan.count;
  all.append(make('strong','一键强化装备'),make('small',plan.count ? `${plan.moves.length ? '先适配 · ' : ''}${resourcesCopy(plan.cost)}` : '四格装备已满级或暂无装备'),make('span',String(plan.count),'hero-upgrade-count'));
  all.setAttribute('aria-label',`一键强化装备，先适配闲置装备，再按费用升序各强化一级，可强化 ${plan.count} 格，总计 ${resourcesCopy(plan.cost)}`);
  actions.append(all); body.append(actions);
  const popover = make('section','','hero-gear-popover'); popover.id = 'hero-gear-popover'; popover.hidden = true; popover.setAttribute('role','dialog'); popover.setAttribute('aria-label','装备操作'); body.append(popover);
}

function animateHeroChange(id, before, slots) {
  const after = heroPower(id), power = $('hero-power');
  countUp(power,after,{from:before,duration:650}); if (after > before) fxFloat(power,`+${after-before}`,'#7ff0c4');
  if (calm()) return;
  slots.forEach((slot,index) => { const node = $(`hero-gear-${slot}`); setTimeout(() => {
    if ($('modal-body').dataset.heroId !== id || $('lobby-modal').hidden || calm()) return;
    replayClass(node,'is-upgraded'); fxFloat(node,'+1',QUALITY_COLOR[store.getHero(id).equipment[slot]?.quality]);
  },index*120); });
}

function showHeroGear(id, slot) {
  const gear = store.getHero(id).equipment[slot], popover = $('hero-gear-popover');
  popover.replaceChildren(); popover.hidden = false; popover.dataset.slot = slot; popover.className = `hero-gear-popover ${gear ? 'quality-'+gear.quality : ''}`;
  const close = button('×','hero-gear-popover-close',closeHeroGear); close.setAttribute('aria-label','收起装备操作');
  const info = make('div','','hero-gear-popover-copy'); info.append(make('strong',gear ? itemName(gear) : `${slotNames[slot]} · 未装备`),make('span',gear ? `${qualityNames[gear.quality]}色 · 强化 Lv ${gear.level}` : '选择一件行装'));
  const description = make('p',gear ? signatureCopy(gear,id) : gearCopy[slot]);
  popover.append(gearTile(gear,{size:64,heroId:id,owner:gear ? id : null,slot}),info,close,description);
  const actions = make('div','','hero-gear-popover-actions'), equip = button('换装','gear-equip',() => showEquipmentPicker(id,slot)); equip.disabled = store.readOnly; actions.append(equip);
  for (const [label,quote,action] of [
    ['强化',store.getEquipmentUpgradeCost(id,slot),() => store.upgradeEquipment(id,slot)],
    ['升品',store.getEquipmentPromotionCost(id,slot),() => store.promoteEquipment(id,slot)],
  ]) {
    const node = button('','',() => { const before = heroPower(id); if (!notify(action(),label==='强化' ? '行装已强化' : '行装已升品')) return;
      renderCampaign(); showHero(id,true); animateHeroChange(id,before,[slot]); showHeroGear(id,slot);
    });
    const cappedQuality = label==='升品' && ['red','gold'].includes(gear?.quality);
    node.append(make('span',label),make('small',!gear ? '请先换装' : cappedQuality ? '品质已满' : quoteCopy(quote)));
    node.disabled = !gear || cappedQuality || !canBuy(quote); actions.append(node);
  }
  popover.append(actions); close.focus?.();
}
function closeHeroGear() { const popover = $('hero-gear-popover'); if (!popover) return; popover.hidden = true; $(`hero-gear-${popover.dataset.slot}`)?.focus?.(); }

function renderSettings() {
  const s = store.state.settings;
  for (const [id,key,label] of [['setting-music','musicEnabled','音乐'],['setting-sfx','sfxEnabled','音效'],['setting-motion','reducedMotion','减弱动态']]) { $(id).textContent = `${label}：${s[key] ? '开启' : '关闭'}`; $(id).setAttribute('aria-pressed',String(s[key])); }
  $('setting-speed').textContent = `默认速度：${s.speed}×`;
  for (const [id,key] of [['music-volume','musicVolume'],['sfx-volume','sfxVolume']]) { const value = Math.round((s[key] ?? 0.8) * 100); $(id).value = String(value); $(id + '-value').textContent = String(value); $(id).disabled = store.readOnly; }
  $('storage-status').textContent = store.persistenceWarning || (store.readOnly ? '检测到较新版本存档，已保留原文件；请在更新版本打开。' : '已自动保存在本浏览器。');
  sound.setPreferences(s); renderer.reducedMotion = s.reducedMotion || motionPreference.matches; document.body?.classList?.toggle('reduce-motion',renderer.reducedMotion);
}
function changeSetting(key,value) { notify(store.setSetting(key,value)); renderSettings(); if (key === 'reducedMotion' && renderer.reducedMotion) combatClock.clearImpact(); if (mode === 'battle') syncBattle(true); }

function showExport() {
  const body = openModal('导出存档');
  const recovery = store.exportRecoverySave();
  const preserveOriginal = (store.readOnly || store.preserveUnreadableSave) && recovery !== null;
  const note = make('p',preserveOriginal ? '当前导出的是保留的原始存档。请保存这份备份，再进行恢复；文本可能来自较新版本或已损坏。' : '将文本保存为文件，或复制到其他设备后导入。','modal-note'); body.append(note);
  const input = make('textarea','','save-text'); input.value = preserveOriginal ? recovery : store.exportSave(); input.readOnly = true; input.setAttribute('aria-label',preserveOriginal ? '保留的原始存档文本' : '存档文本'); body.append(input);
  const actions = make('div','','modal-actions'); actions.append(button('选中存档文本','',() => { input.focus(); input.select?.(); toast('文本已选中，可复制保存'); }));
  actions.append(button('下载存档','',() => { const blob = new Blob([input.value],{type:'application/json'}); const url = URL.createObjectURL(blob); const link = make('a'); link.href = url; link.download = `无双守关-${new Date().toISOString().slice(0,10)}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000); })); body.append(actions);
  if (preserveOriginal && !store.readOnly) body.append(button('改为导出本次临时进度','auto-toggle',() => { input.value = store.exportSave(); note.textContent = '现在显示本次页面中可玩的临时进度。原始存档仍保留在浏览器，请先保留其备份。'; }));
}
function showImport() {
  const body = openModal('导入存档'); body.append(make('p','粘贴存档文本或选择文件。先检查内容，再确认替换当前进度；无效存档不会覆盖现有进度。','modal-note'));
  const file = make('input'); file.type = 'file'; file.accept = '.json,application/json'; file.setAttribute('aria-label','选择存档文件'); body.append(file);
  const input = make('textarea','','save-text'); input.setAttribute('aria-label','待导入存档文本'); body.append(input);
  const preview = make('p','','import-preview'); preview.hidden = true; body.append(preview);
  const feedback = make('p','','modal-feedback'); body.append(feedback);
  const actions = make('div','','modal-actions'); let checkedText = null;
  const confirm = button('确认替换当前存档','',() => { if (checkedText !== input.value) { feedback.textContent = '内容已变化，请重新检查。'; confirm.disabled = true; return; } const result = store.importSave(input.value); if (!result.ok) { feedback.textContent = reason(result); return; } selectedLevelId = CONTENT.levels.find(l => store.isLevelUnlocked(l.id) && !store.state.levels[l.id]?.cleared)?.id || CONTENT.levels.at(-1).id; selectedChapter = store.getLevel(selectedLevelId).chapterId; closeModal(); renderCampaign(); toast('存档已导入'); }); confirm.disabled = true;
  actions.append(button('检查存档内容','',() => { const result = store.previewImport(input.value); confirm.disabled = !result.ok; if (!result.ok) { preview.hidden = true; feedback.textContent = reason(result); checkedText = null; return; } checkedText = input.value; preview.hidden = false; preview.textContent = `${result.summary.ownedHeroes} 名武将 · ${result.summary.clearedLevels} 关已通\n${resourcesCopy(result.summary.resources)}`; feedback.textContent = '确认后将替换当前浏览器中的进度。'; }),confirm); body.append(actions);
  input.addEventListener('input',() => { confirm.disabled = true; checkedText = null; });
  file.addEventListener('change',async () => { const selected = file.files?.[0]; if (!selected) return; if (selected.size > 2_000_000) { feedback.textContent = '存档文件过大'; return; } try { input.value = await selected.text(); confirm.disabled = true; checkedText = null; feedback.textContent = '文件已载入，请检查存档。'; } catch { feedback.textContent = '文件读取失败，请重新选择。'; } });
}

// ===== Battle result sharing: explicit choice, real values, graceful fallbacks =====
async function showShare() {
  if (!game || !['won','lost'].includes(game.state)) return;
  telemetry.log('share_click',{levelId:game.level.id,challenge:Boolean(challenge)});
  const won = game.state === 'won', stars = settlement?.stars || game.stars, highlight = currentHighlight(), heroId = game.heroes[0].id;
  // Only a normalised challenge run carries a comparable target; a campaign run shares a fresh challenge without one.
  const code = encodeChallenge({levelId:game.level.id,heroes:game.heroes.map(h => h.id),target:challenge ? {burst:game.bestBurst,kills:game.kills,hp:game.hp / game.maxHp * 100} : null});
  const url = publicChallengeUrl(code);
  const text = shareText({level:game.level,heroId,highlight,stars,won,challengeCode:code,url});
  const body = openModal('晒战绩');
  const preview = make('div','','share-preview'); preview.append(make('p','正在绘制战报…','modal-note')); body.append(preview);
  body.append(make('p',url ? '好友点链接即可同阵挑战。' : '在线链接待正式发布后配置。好友可在「设置 → 好友挑战」输入下方挑战码。','modal-note'));
  const codeBox = make('textarea','','save-text share-text'); codeBox.value = text; codeBox.readOnly = true; codeBox.setAttribute('aria-label','战报文字与挑战码'); body.append(codeBox);
  const status = make('p','','modal-feedback'); status.setAttribute('aria-live','polite');
  const actions = make('div','','modal-actions share-actions'); body.append(actions, status);
  const done = (type, data = {}) => { telemetry.log(type,{levelId:game?.level.id,...data}); };
  let blob = null;
  const copy = button('复制文字','',async () => {
    try { await navigator.clipboard.writeText(text); status.textContent = '已复制，可粘贴到聊天'; done('share_complete',{method:'copy'}); }
    catch { codeBox.focus(); codeBox.select?.(); status.textContent = '无法自动复制，文字已选中，请手动复制'; done('share_fail',{method:'copy'}); }
  });
  const save = button('保存图片','',() => {
    if (!blob) { status.textContent = '此浏览器无法生成图片，请改用复制文字'; done('share_fail',{method:'download'}); return; }
    const href = URL.createObjectURL(blob); const link = make('a'); link.href = href; link.download = `无双守关-${game.level.id}-${highlight.value}.png`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(href),1500);
    status.textContent = '图片已保存'; done('share_complete',{method:'download'});
  });
  const native = button('分享','share-primary',async () => {
    try {
      const file = blob && typeof File === 'function' ? new File([blob],'wushuang.png',{type:'image/png'}) : null;
      const payload = file && navigator.canShare?.({files:[file]}) ? {files:[file],text} : {text};
      await navigator.share(payload); status.textContent = '已交给系统分享'; done('share_complete',{method:'native',withImage:Boolean(payload.files)});
    } catch (error) { if (error?.name === 'AbortError') { status.textContent = '已取消分享'; done('share_cancel',{method:'native'}); } else { status.textContent = '系统分享不可用，可保存图片或复制文字'; done('share_fail',{method:'native'}); } }
  });
  native.hidden = typeof navigator.share !== 'function';
  actions.append(native,save,copy);
  try {
    const canvas = await renderShareCard({heroId,stageLabel:`${factionNames[game.level.chapterId]}篇 · 第 ${game.level.order} 阵 · ${game.level.name}`,levelName:game.level.name,highlight,stars,won,
      stats:[['击破',game.kills],['无双',game.stats.ultimateCasts],['连斩',combo.best]],challenge:challenge ? '同阵同配置 · 你能扫多少？' : '同一阵，你能扫多少？',footer:`无双守关 V1 · ${BUILD_ID} · 本地单机成绩`});
    blob = await canvasBlob(canvas);
    const src = typeof canvas.toDataURL === 'function' ? canvas.toDataURL('image/png') : '';
    preview.replaceChildren(); if (src) { const image = make('img','','share-image'); image.src = src; image.alt = `战报：${highlight.label} ${highlight.value}${highlight.unit}`; preview.append(image); }
    else preview.append(make('p','图片预览不可用，仍可复制文字','modal-note'));
  } catch { preview.replaceChildren(make('p','图片生成失败，仍可复制文字','modal-note')); }
}

function startChallenge(decoded, source) {
  telemetry.log('challenge_open',{source,levelId:decoded.levelId,hasTarget:Boolean(decoded.target)});
  closeModal(); enterBattle(decoded.levelId,false,{friend:decoded});
}
function showChallengeEntry(prefill = '') {
  const body = openModal('好友挑战');
  body.append(make('p','粘贴好友发来的挑战码或链接。挑战固定关卡、随机种子、版本和阵容，养成统一为该阵建议配置，不发奖励、不改存档。','modal-note'));
  const input = make('textarea','','save-text'); input.setAttribute('aria-label','挑战码'); input.value = typeof prefill === 'string' ? prefill : ''; body.append(input);
  const feedback = make('p','','modal-feedback'); const actions = make('div','','modal-actions');
  actions.append(button('取消','',closeModal),button('检查并开始','',() => { const decoded = decodeChallenge(input.value); if (!decoded.ok) { feedback.textContent = challengeReasons[decoded.reason] || '挑战码无效'; telemetry.log('challenge_invalid',{source:'manual',reason:decoded.reason}); return; } startChallenge(decoded,'manual'); }));
  body.append(actions,feedback);
}
function openChallengeFromLink() {
  const hash = globalThis.location?.hash || ''; if (!hash.includes('challenge=')) return;
  const decoded = decodeChallenge(hash);
  if (!decoded.ok) { telemetry.log('challenge_invalid',{source:'link',reason:decoded.reason}); toast(challengeReasons[decoded.reason] || '挑战链接无效'); return; }
  const body = openModal('好友向你发起挑战');
  for (const line of challengeLines(decoded)) body.append(make('p',`${line.speaker}：${line.text}`,'modal-note'));
  const actions = make('div','','modal-actions'); actions.append(button('稍后','',closeModal),button(`挑战 ${factionNames[decoded.level.chapterId]}${decoded.level.order}「${decoded.level.name}」`,'',() => startChallenge(decoded,'link'))); body.append(actions);
}

function showTelemetry() {
  const body = openModal('本地体验记录');
  const summary = telemetry.summary();
  body.append(make('p','记录只保存在本浏览器，不会上传。用于试玩观察首屏、首次布阵、首次无双、结算与分享按钮。系统分享完成只表示分享面板返回成功，无法得知好友是否打开。','modal-note'));
  body.append(make('p',`本次会话：进入战斗 ${summary.toBattleEntryMs ?? '—'} ms · 首次布阵 ${summary.toFirstDeployMs ?? '—'} ms · 首次无双 ${summary.toFirstUltimateMs ?? '—'} ms（均自首屏可交互起算，含阅读与引导停留）\n战斗 ${summary.battles} · 重试 ${summary.retries} · 点击分享 ${summary.shareClicks} · 分享完成 ${summary.shareCompleted}`,'import-preview'));
  const log = make('textarea','','save-text'); log.readOnly = true; log.value = telemetry.events.slice(-60).map(e => JSON.stringify(e)).join('\n'); log.setAttribute('aria-label','事件记录'); body.append(log);
  const actions = make('div','','modal-actions');
  actions.append(button('下载记录','',() => { const blob = new Blob([JSON.stringify(telemetry.events,null,1)],{type:'application/json'}); const href = URL.createObjectURL(blob); const link = make('a'); link.href = href; link.download = 'wushuang-telemetry.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(href),1000); }),button('清空','',() => { telemetry.clear(); showTelemetry(); }));
  body.append(actions);
}

// ===== Adaptive visual budget: decorations go first, gameplay readability never changes =====
function samplePerformance(realDt) {
  if (!(realDt > 0) || realDt > 0.5) return;
  frameSamples.push(realDt); frameWindow += realDt;
  if (frameWindow < 2) return;
  const average = frameSamples.reduce((a, b) => a + b, 0) / frameSamples.length;
  if (average > 1 / 40 && renderer.quality !== 'low') renderer.quality = 'low';
  else if (average < 1 / 55 && renderer.quality === 'low') renderer.quality = 'high';
  diagnostics.fps = Math.round(1 / average); diagnostics.quality = renderer.quality; diagnostics.samples.push(diagnostics.fps); if (diagnostics.samples.length > 120) diagnostics.samples.shift();
  frameSamples = []; frameWindow = 0;
}
const diagnostics = { fps: null, quality: 'high', samples: [] };

function handleBattleEvent(event) {
  tutorial.handleEvent(event); sound.handleEvent(event);
  if (event.type === 'kill' && mode === 'battle') bumpCombo(event.time);
  if (['build','upgrade'].includes(event.type) && !battleDeployed) { battleDeployed = true; telemetry.log('first_deploy',{levelId:game?.level.id,combatSec:+(event.time ?? 0).toFixed(1),wallMs:Math.round(performance.now() - battleWallStart),accountFirst:!firstRun.deploy}); firstRun.deploy = true; }
  if (event.type === 'ultimate' && mode === 'battle') { showCutin(event); if (!battleCast) { battleCast = true; telemetry.log('first_ultimate',{levelId:game?.level.id,heroId:event.heroId,combatSec:+(event.time ?? 0).toFixed(1),wallMs:Math.round(performance.now() - battleWallStart),accountFirst:!firstRun.ultimate}); firstRun.ultimate = true; } }
  if (mode === 'battle' && !document.hidden && !pageSuspended && ['damage','kill','ultimate','burst'].includes(event.type)) {
    if (renderer.handleEvent) renderer.handleEvent(event);
    else if (['ultimate','burst'].includes(event.type)) renderer.flashUltimate(event.type === 'burst' ? {...event,type:'burst'} : event);
  }
  if (event.type === 'wave') banner(event.boss ? '敌将压境' : `第 ${event.wave} 波 · 敌军来袭`,Boolean(event.boss));
  else if (event.type === 'bossWarning') banner(event.name ? `${event.name}即将入阵` : '敌将将至 · 准备无双',true);
  else if (event.type === 'reinforcementWarning') banner(`${event.name} · ${event.seconds}秒后入阵`);
  else if (event.type === 'choice') { choiceRevealRemaining = 1; choiceRevealFrame = last; choicesKey = ''; $('upgrade-choices').replaceChildren(); }
  else if (event.type === 'ultimate') { if (!renderer.reducedMotion && mode === 'battle' && !document.hidden && !pageSuspended) combatClock.triggerImpact(0.35,0.25); }
  else if (event.type === 'burst') { const kills = Math.max(0,Math.floor(Number(event.burstKills ?? event.kills) || 0)); const skillName = BALANCE.heroes[event.heroId]?.ultimate.name || '无双破阵'; $('burst-label').textContent = kills ? `${skillName} · ${heroName(event.heroId)} 击破 ` : skillName; $('burst-kills').textContent = kills ? String(kills) : ''; $('burst-kills').hidden = kills === 0; $('burst-number').classList.add('is-visible'); clearTimeout(burstTimer); burstTimer = setTimeout(() => $('burst-number').classList.remove('is-visible'),1300); }
  else if (event.type === 'skillQueued' && event.queuePosition > 1) toast(`${event.name}已待命 · 技能依次施放`);
  else if (event.type === 'tactic') toast(event.upgrade?.name || event.name || '战术已强化');
  else if (['win','lose'].includes(event.type) && game && !settlement && !challenge) { previousRecord = store.state.levels[game.level.id] ? { ...store.state.levels[game.level.id] } : null; settlement = store.settleBattle({ battleId,levelId:game.level.id,won:event.type === 'win',hp:Math.max(0,game.hp),maxHp:game.maxHp,kills:game.kills,bestBurst:game.bestBurst,time:game.time,casts:game.stats.ultimateCasts }); if (!settlement.ok) toast(reason(settlement)); }
}

function enterBattle(levelId = selectedLevelId, guide = false, { friend = null, retry = false } = {}) {
  // A friend challenge uses a normalised loadout and never touches the save or rewards.
  if (friend) {
    const setup = challengeSetup(friend.levelId, friend.heroes);
    resetBattleState(levelId = friend.levelId); challenge = friend; battleId = null;
    game = new V1Game({levelId,party:setup.party,unlockedCamps:setup.unlockedCamps,campTech:setup.campTech,onEvent:handleBattleEvent});
  } else {
    if (!store.isLevelUnlocked(levelId)) { toast('先通关上一阵'); return; }
    const party = store.getPartyForLevel(levelId); if (!party.length || store.readOnly) { toast('当前存档无法开始战斗'); return; }
    battleId = store.createBattleId(); if (!battleId) { toast('暂时无法开始新局，请先导出存档备份'); return; }
    resetBattleState(levelId); challenge = null; selectedChapter = store.getLevel(levelId).chapterId;
    game = new V1Game({levelId,party,unlockedCamps:store.state.unlockedCamps,campTech:store.getBattleTechnology(),onEvent:handleBattleEvent});
  }
  telemetry.log(retry ? 'retry' : 'battle_entry',{levelId,challenge:Boolean(friend),guide:Boolean(guide || store.state.settings.tutorialVersion < 1)});
  mode = 'battle'; forceGuide = !friend && (guide || store.state.settings.tutorialVersion < 1); tutorial.reset(false); storyVisible = Boolean(friend) || !store.state.levels[levelId]?.cleared; renderer.resetFeedback?.(); combatClock.clearImpact();
  $('lobby-view').hidden = true; $('battle-view').hidden = false; $('battle-level-title').textContent = `${factionNames[game.level.chapterId]} ${game.level.order} · ${game.level.name}`; $('battle-seal').textContent = factionNames[game.level.chapterId];
  renderer.flash = null; renderer.bladeTrails = []; renderer.setMap(game.map); renderer.resize(); previousState = ''; choicesKey = ''; commandsKey = ''; tutorialKey = ''; commandNodes.clear();
  $('burst-number').classList.remove('is-visible'); clearTimeout(burstTimer); $('wave-banner').classList.remove('is-visible');
  $('story-title').textContent = game.level.name; $('story-kicker').textContent = friend ? '好友挑战 · 同阵同配置' : `${factionNames[game.level.chapterId]}篇 · 第${game.level.act}幕`;
  $('story-lines').replaceChildren();
  const lines = friend ? challengeLines(friend) : game.level.story.opening;
  // On a first run the story sheet doubles as the tutorial's "what am I defending" step: one tap, not two.
  if (forceGuide && !friend) lines.push({speaker:'军令',text:`守住下方城关。敌军沿道路压来，先布军阵聚敌，再用${game.heroes[0].name}一刀横扫。`});
  for (const line of lines) { const p = make('p'); p.append(make('strong',line.speaker),make('span',line.text)); $('story-lines').append(p); }
  $('story-start').textContent = friend ? '开始挑战' : forceGuide ? '布阵迎敌' : '迎敌守关'; $('story-skip').hidden = Boolean(friend);
  $('story-overlay').classList.toggle('is-sheet',true);
  resetClock(); void sound.unlock(); sound.setScene('battle'); if (!storyVisible) beginCombat(); syncBattle(true);
}
function resetBattleState(levelId) {
  resetCombo(); selectedLevelId = levelId; settlement = null; lootRevealed = false; selectedSlot = -1; formationCursor = -1; choiceRevealRemaining = 0; choiceRevealFrame = null;
  battleWallStart = performance.now(); battleFrozenMs = 0; unusedRageSec = 0; battleDeployed = false; battleCast = false; previousRecord = null; lastCutin = -Infinity;
  clearTimeout(cutinTimer); clearTimeout(tutorialDismissTimer); $('skill-cutin').classList.remove('is-visible');
  pauseIcon = null; pipsKey = ''; lastHp = null; for (const t of resultTimers.splice(0)) clearTimeout(t); finishCounters(); $('result-overlay').classList.remove('is-seq'); renderer.consumeUiEvents?.();
}
function challengeLines(friend) {
  const setup = challengeSetup(friend.levelId, friend.heroes), hero = setup.party[0];
  const lines = [{speaker:'规则',text:`${friend.heroes.map(heroName).join('、')}出战，统一 Lv${hero.level} · 技能 Lv${hero.skillLevel} · ${qualityNames[hero.equipment.weapon.quality]}武器 Lv${hero.equipment.weapon.level}，军营科技 0。养成不带入，人人同一起点。`},{speaker:'说明',text:'本地好友对比，不发奖励、不改存档、没有全网排行。'}];
  if (friend.target) lines.unshift({speaker:'好友战绩',text:`最佳横扫 ${friend.target.burst} 人 · 共击破 ${friend.target.kills} 人 · 城关 ${friend.target.hp}%`});
  return lines;
}
function beginCombat() {
  if (!game || game.state !== 'ready') return;
  storyVisible = false; $('story-skip').hidden = false;
  // A first run already read the goal on the story sheet, so the guide opens directly on the real slot.
  tutorial.reset(forceGuide, { startAt: forceGuide && !store.state.levels[game.level.id]?.cleared ? 'deploy' : 'intro' });
  game.start(); resetClock(); syncBattle(true);
}
function returnHome() {
  mode = 'lobby'; selectedSlot = -1; tutorial.skip(); storyVisible = false; choiceRevealRemaining = 0; choiceRevealFrame = null; renderer.resetFeedback?.(); combatClock.clearImpact(); resetCombo();
  clearTimeout(cutinTimer); clearTimeout(tutorialDismissTimer); $('skill-cutin').classList.remove('is-visible'); $('burst-number').classList.remove('is-visible');
  if (challenge) { challenge = null; try { if (globalThis.location?.hash?.includes('challenge=')) history.replaceState(null,'',location.pathname + location.search); } catch { /* file:// may refuse */ } }
  $('battle-view').hidden = true; $('lobby-view').hidden = false; closeModal(); sound.setScene('menu'); resetClock(); renderCampaign();
}
/** Empty slot closest to where the lanes converge: the spot that teaches "gather here". */
function guideSlot() {
  if (!game) return -1;
  const open = game.map.campSlots.filter(s => !game.camps.some(c => c.slot === s.slot)); if (!open.length) return -1;
  const merge = game.map.paths.map(path => path.at(-2) ?? path.at(-1))[0] ?? { x:210, y:330 };
  return open.reduce((best, s) => Math.hypot(s.x - merge.x, s.y - merge.y) < Math.hypot(best.x - merge.x, best.y - merge.y) ? s : best).slot;
}
function anchorCamp(slot) {
  const panel = $('camp-panel'), stage = panel.parentElement, canvas = $('battle-canvas');
  const pos = game?.map.campSlots.find(s => s.slot === slot), sr = rectOf(stage), cr = rectOf(canvas);
  if (!pos || !sr || !cr || !sr.width) { panel.classList.remove('is-anchored'); return; }
  const x = cr.left - sr.left + pos.x / 420 * cr.width, y = cr.top - sr.top + pos.y / 600 * cr.height;
  const half = Math.min(160,(sr.width - 24) / 2), left = Math.max(12 + half,Math.min(sr.width - 12 - half,x));
  panel.style.setProperty('--cx',`${left}px`); panel.style.setProperty('--cy',`${y}px`); panel.style.setProperty('--shift','-50%');
  panel.classList.add('is-anchored'); panel.classList.toggle('is-below',y < sr.height * .42);
}
function closeCamp() { selectedSlot = -1; $('camp-panel').hidden = true; resetClock(); if (game) syncBattle(); }
function openCamp(slot) {
  if (!game || game.state !== 'playing' || storyVisible) return;
  selectedSlot = slot; formationCursor = slot; resetClock(); $('camp-panel').hidden = false; anchorCamp(slot);
  const camp = game.camps.find(c => c.slot === slot); $('camp-index-label').textContent = `第 ${slot + 1} 营位`; $('camp-title').textContent = camp ? `${BALANCE.camps[camp.type].name} · ${camp.level}级` : '部署军阵'; $('camp-options').replaceChildren();
  const modifier = game.map.rule.campModifier; $('camp-note').textContent = `布阵时战斗暂停${modifier?.slot === slot ? ' · ' + game.map.rule.copy : ''}`;
  if (camp) { const cost = game.getUpgradeCost(slot); if (cost === null) $('camp-options').append(make('div','军阵已满级','max-level')); else { const node = button('','camp-option upgrade-camp',() => { if (notify(game.upgrade(slot),'军阵已升级')) closeCamp(); }); node.append(make('strong',`升级至 ${camp.level + 1} 级`),make('small',`${cost} 军粮 · 强化${campCopy[camp.type]}`)); node.disabled = game.food < cost; $('camp-options').append(node); } }
  else for (const type of game.availableCamps) { const def = BALANCE.camps[type]; const node = button('','camp-option',() => { if (notify(game.build(slot,type),`${def.name}已部署`)) closeCamp(); }); node.append(make('span',campGlyphs[type],'camp-glyph'),make('strong',def.name),make('small',campCopy[type]),make('span',`${def.buildCost} 军粮`,'camp-cost')); node.disabled = game.food < def.buildCost; $('camp-options').append(node); }
  syncBattle();
}
function cycleCamp() { if (!game) return; const slots = game.map.campSlots; const previous = slots.findIndex(s => s.slot === formationCursor); const empty = slots.slice(previous + 1).find(s => !game.camps.some(c => c.slot === s.slot)) || slots.find(s => !game.camps.some(c => c.slot === s.slot)); openCamp(empty?.slot ?? slots[(previous + 1) % slots.length].slot); }
function cast(id = game?.heroes[0]?.id) {
  if (!game || game.state !== 'playing') return; closeCamp(); resetClock(); void sound.unlock();
  // Instant tap acknowledgement on the real button, before the engine's windup/queue resolves.
  const ui = commandNodes.get(id); if (ui) { ui.node.classList.remove('is-pressed'); void ui.node.offsetWidth; ui.node.classList.add('is-pressed'); setTimeout(() => ui.node.classList.remove('is-pressed'),260); }
  const result = game.castUltimate(id); if (!result.ok) toast(result.reason); syncBattle();
}
function finishTutorial(skipped = false) {
  if (!tutorial.active) return;
  const step = tutorial.step; tutorial.skip(); clearTimeout(tutorialDismissTimer);
  store.setSetting('tutorialVersion',1); store.setSetting('tutorialCompleted',!skipped); closeCamp();
  telemetry.log(skipped ? 'tutorial_skip' : 'tutorial_complete',{step,combatSec:+(game?.time ?? 0).toFixed(1),wallMs:Math.round(performance.now() - battleWallStart)});
  toast(skipped ? '已跳过引导 · 设置里可重看' : '已学会守关 · 以无双破阵'); syncBattle(true);
}

function renderCommands() {
  const key = game.heroes.map(h => h.id).join('|'); if (key === commandsKey) return; commandsKey = key; $('hero-commands').replaceChildren(); $('lead-command').replaceChildren(); commandNodes.clear();
  for (const [index,hero] of game.heroes.entries()) { const lead = index === 0; const node = button('',`hero-command ${lead ? 'is-lead' : 'is-support'}`,() => cast(hero.id)); node.setAttribute('aria-label',`${hero.name} · ${hero.definition.ultimate.name} · 无双技能`); node.setAttribute('title',`${hero.name} · ${hero.definition.ultimate.name}`); const fill = make('span','','rage-fill'); fill.setAttribute('aria-hidden','true'); const copy = make('span','','skill-copy'); const name = make('strong',`${hero.name} · ${hero.definition.ultimate.name}`); const sub = make('small'); const state = make('span','','skill-state'); copy.append(name,sub); node.append(fill,portrait(hero.id),copy,state); (lead ? $('lead-command') : $('hero-commands')).append(node); commandNodes.set(hero.id,{node,fill,sub,state}); }
}
function renderChoices() { const key = game.upgrades.map(t => t.id).join('|'); if (key === choicesKey) return; choicesKey = key; $('upgrade-choices').replaceChildren(); for (const choice of game.upgrades) { const node = button('','upgrade-choice',() => { if (choiceRevealRemaining > 0 || $('choice-overlay').hidden) return; notify(game.selectUpgrade(choice.id),'战术已整备'); resetClock(); syncBattle(true); }); node.append(make('strong',choice.name),make('span',choice.description || tacticCopy(choice.id))); $('upgrade-choices').append(node); } }
function tacticCopy(id) { const def = BALANCE.tactics[id]; if (def?.camp) return `${BALANCE.camps[def.camp].name} · 强化${campCopy[def.camp]}`; if (def?.hero) return `${heroName(def.hero)} · 强化无双`; return '强化阵势'; }
const ADVICE_ROUTE = { training:['heroes','养','去培养'], rage:['heroes','怒','去培养'], cast:['heroes','技','去培养'], boss:['heroes','帅','去培养'], armor:['workshop','弩','去工坊'], cavalry:['workshop','盾','去工坊'], upgrade:['workshop','营','去工坊'], food:['retry','粮','再战'], general:['retry','阵','再战'] };
function renderLootResult() {
  const loot = settlement?.ok && game.state === 'won' ? settlement.loot : null;
  $('result-loot').hidden = !loot?.item; $('result-loot-item').hidden = !lootRevealed;
  const chest = $('result-open-box').querySelector('.chest'); chest?.classList.toggle('is-idle',!lootRevealed); chest?.classList.toggle('is-open',lootRevealed);
  $('result-open-box').disabled = lootRevealed; $('result-open-box').querySelector('small').textContent = lootRevealed ? '已开启' : '点击开启';
  $('result-loot-rates').textContent = `每次胜利 1 箱 · 失败不掉落\n${lootRatesCopy}\n金色专属武器仅由装备箱掉落`;
  if (loot?.item) {
    const box = $('result-loot-item'); box.className = `result-loot-item quality-${loot.item.quality}`; $('result-open-box').className = `chest-button quality-${loot.item.quality}`;
    box.replaceChildren(gearTile(loot.item,{size:96,showOwner:false,showExclusive:false}),make('strong',itemCopy(loot.item)),make('span',signatureCopy(loot.item)),make('span',loot.salvaged ? '背包已满，已转为：' + resourcesCopy(loot.salvageResources) : '已存入背包'));
    if (lootJustOpened) { lootJustOpened = false; fxBurst($('result-open-box').querySelector('.chest'),QUALITY_COLOR[loot.item.quality],loot.item.quality === 'gold' ? 30 : 20); }
  }
}
function currentHighlight() { return battleHighlight(game,{bestCombo:combo.best,previous:challenge ? null : previousRecord}); }
function renderResult() {
  renderLootResult(); const won = game.state === 'won'; const stars = settlement?.stars || game.stars;
  const quick = resultSessions++ > 0, k = calm() ? 0 : quick ? .48 : 1; for (const t of resultTimers.splice(0)) clearTimeout(t);
  $('result-overlay').classList.toggle('is-lost',!won);
  $('result-kicker').textContent = challenge ? `好友挑战 · ${factionNames[game.level.chapterId]}篇 · ${game.level.name}` : `${factionNames[game.level.chapterId]}篇 · ${game.level.name}`;
  $('result-title').textContent = won ? '守住了' : '城破';
  $('result-stars').replaceChildren(...(won ? [0,1,2].map(i => make('i','',i < stars ? '' : 'is-off')) : [])); $('result-stars').setAttribute('aria-label',won ? `${stars} 星` : '');
  // 1. One authentic standout stat.
  const highlight = currentHighlight();
  $('result-highlight-label').textContent = highlight.label; if (Number.isFinite(Number(highlight.value))) countUp($('result-highlight-value'),Number(highlight.value),{delay:1350 * k,duration:900}); else $('result-highlight-value').textContent = String(highlight.value); $('result-highlight-unit').textContent = highlight.unit; $('result-highlight-record').hidden = !highlight.record;
  // 2. Defeat: one recommendation tied to what actually happened in this battle.
  const advice = won ? null : defeatAdvice(game,{level:game.level,heroLevel:game.heroes[0].level,unusedRageSec});
  $('result-advice').hidden = !advice; $('result-advice').replaceChildren();
  if (advice) {
    const [target,glyph,go] = ADVICE_ROUTE[advice.id] || ADVICE_ROUTE.general;
    const card = button('','advice-card',() => { if (target === 'retry') enterBattle(game.level.id,false,{retry:true}); else { returnHome(); showTab(target); } });
    card.append(make('span',glyph,'advice-glyph'),make('span',advice.text),make('b',go)); $('result-advice').append(card);
  }
  // 3. Challenge comparison is a local friend comparison, never a ranking.
  const target = challenge?.target;
  $('result-challenge').hidden = !challenge;
  $('result-challenge').textContent = !challenge ? '' : target ? `好友：横扫 ${target.burst} · 击破 ${target.kills}\n你：横扫 ${game.bestBurst} · 击破 ${game.kills}${game.bestBurst > target.burst ? ' · 横扫胜出' : game.bestBurst === target.burst ? ' · 横扫打平' : ''}` : '同阵同配置挑战完成，可把成绩发给好友比一比。';
  [['result-kills',game.kills],['result-burst',game.bestBurst],['result-casts',game.stats.ultimateCasts],['result-combo',combo.best]].forEach(([id,value],i) => countUp($(id),value,{delay:(1800 + i * 80) * k,duration:700}));
  syncResultResources(won && !challenge && settlement?.ok ? settlement.rewards : null,k);
  $('result-rewards').textContent = challenge ? '好友挑战不发奖励，存档保持不变' : won ? settlement?.ok ? `获得 ${resourcesCopy(settlement.rewards)}` : '奖励尚未记录，请导出存档备份' : '未扣除任何资源';
  const objective = challenge ? null : nextObjective({level:game.level,stars,won,isUnlocked:id => store.isLevelUnlocked(id)});
  $('result-next').textContent = objective && won ? objective.text : ''; $('result-next').hidden = !objective || !won;
  $('result-share').hidden = !won && !challenge;
  $('retry-button').hidden = !won && !challenge ? true : false;
  const wallSec = (performance.now() - battleWallStart) / 1000;
  telemetry.log('battle_result',{levelId:game.level.id,won,stars:won ? stars : 0,kills:game.kills,bestBurst:game.bestBurst,bestCombo:combo.best,casts:game.stats.ultimateCasts,combatSec:+game.time.toFixed(1),wallSec:+wallSec.toFixed(1),frozenSec:+(battleFrozenMs / 1000).toFixed(1),highlight:highlight.id,advice:advice?.id ?? null,challenge:Boolean(challenge)});
  const notes = []; for (const id of settlement?.unlockedHeroes || []) notes.push(`${heroName(id)}加入英雄录 · 首次等级追赶`); for (const id of settlement?.unlockedCamps || []) notes.push(`${BALANCE.camps[id].name}已开放`); if (won && game.level.id === 'wei_002') notes.push('第二阵位已开放 · 可让曹操协战'); if (won && game.level.id === 'wei_008') notes.push('第三阵位已开放'); if (store.persistenceWarning) notes.push(store.persistenceWarning); if (challenge) notes.length = 0; $('result-unlocks').textContent = notes.join('\n');
  const next = CONTENT.levels.find(l => l.globalIndex === game.level.globalIndex + 1);
  // On a loss the primary action becomes "fight again", so retrying is one obvious tap.
  replayClass($('result-overlay'),'is-seq'); $('result-overlay').classList.toggle('is-quick',quick);
  if (!won && !challenge) { $('next-level').hidden = false; $('next-level').textContent = '再战此阵'; $('next-level').dataset.action = 'retry'; }
  else { $('next-level').textContent = '下一阵'; $('next-level').dataset.action = 'next'; $('next-level').hidden = challenge || !won || !next || !store.isLevelUnlocked(next.id); }
}
// Result chips start at the pre-reward totals; coins fly in as the rewards line appears, then the chips count up.
function syncResultResources(rewards, k) {
  for (const chip of $('result-res').querySelectorAll('.res')) {
    const key = chip.dataset.res, total = store.state.resources[key] ?? 0, gain = rewards?.[key] || 0, value = chip.querySelector('strong');
    value.textContent = String(total - gain);
    if (!gain) { value.textContent = String(total); continue; }
    if (calm()) { value.textContent = String(total); continue; }
    resultTimers.push(setTimeout(() => { flyCoins($('result-rewards'),chip,Math.min(6,2 + Math.ceil(gain / 300))); resultTimers.push(setTimeout(() => { replayClass(chip,'is-bump'); countUp(value,total,{from:total - gain,duration:600}); },700)); },2200 * k + 200));
  }
}
function flyCoins(fromNode, toNode, count) {
  const a = rectOf(fromNode), b = rectOf(toNode); if (!a || !b || calm() || !document.body) return;
  for (let i = 0; i < count; i++) {
    const coin = make('i','','coin-flyer'), x = a.left + a.width / 2, y = a.top + a.height / 2;
    coin.style.left = x + 'px'; coin.style.top = y + 'px';
    coin.style.setProperty('--tx',b.left + b.width / 2 - x + 'px'); coin.style.setProperty('--ty',b.top + b.height / 2 - y + 'px');
    coin.style.setProperty('--wob',Math.random() * 80 - 40 + 'px'); coin.style.setProperty('--delay',i * .06 + 's');
    document.body.append(coin); setTimeout(() => coin.remove(),800 + i * 60);
  }
}
function skipResult() {
  if (!$('result-overlay').classList.contains('is-seq')) return;
  $('result-overlay').classList.remove('is-seq'); finishCounters();
  for (const t of resultTimers.splice(0)) clearTimeout(t);
  for (const chip of $('result-res').querySelectorAll('.res')) chip.querySelector('strong').textContent = String(store.state.resources[chip.dataset.res] ?? 0);
}
const PAUSE_ICON = '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" rx="1"/><rect x="8.5" y="1" width="3.5" height="12" rx="1"/></svg>', PLAY_ICON = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9.5-5.5z"/></svg>';
function syncBattle(force = false) {
  if (!game || mode !== 'battle') return;
  const changed = force || previousState !== game.state; if (changed) resetClock();
  $('story-overlay').hidden = !storyVisible;
  $('pause-overlay').hidden = game.state !== 'paused'; $('choice-overlay').hidden = game.state !== 'choosing' || choiceRevealRemaining > 1e-8; $('result-overlay').hidden = !['won','lost'].includes(game.state); $('camp-panel').hidden = selectedSlot < 0;
  const ended = ['won','lost'].includes(game.state); $('battle-view').classList.toggle('is-result',ended);
  if (pauseIcon !== (game.state === 'paused')) { pauseIcon = game.state === 'paused'; $('pause-button').innerHTML = pauseIcon ? PLAY_ICON : PAUSE_ICON; $('pause-button').setAttribute('aria-label',pauseIcon ? '继续战斗' : '暂停战斗'); }
  $('hp-lag').style.width = `${Math.max(0,game.hp / game.maxHp * 100)}%`;
  const pips = `${game.wave}/${game.waveCount}`; if (pips !== pipsKey) { pipsKey = pips; $('wave-pips').replaceChildren(...game.level.waves.map((w,i) => make('i','',`${i + 1 < game.wave ? 'is-done' : i + 1 === game.wave ? 'is-now' : ''} ${w.bossSpawn ? 'is-boss' : ''}`))); }
  $('pause-button').disabled = !['playing','paused'].includes(game.state); $('formation-button').disabled = game.state !== 'playing'; $('hp-value').textContent = `${Math.ceil(game.hp)} / ${game.maxHp}`; $('hp-fill').style.width = `${Math.max(0,game.hp / game.maxHp * 100)}%`; $('hp-fill').parentElement.setAttribute('aria-valuenow',String(Math.ceil(game.hp))); $('hp-fill').parentElement.setAttribute('aria-valuemax',String(game.maxHp)); $('battle-view').classList.toggle('is-critical',game.hp / game.maxHp < .3);
  $('food-value').textContent = Math.floor(game.food); $('enemy-count').textContent = game.activeEnemyCount; $('pending-count').textContent = `待入 ${game.pendingEnemyCount}`; $('enemy-pressure').setAttribute('aria-label',`在场敌军${game.activeEnemyCount}人，本波待入场${game.pendingEnemyCount}人`); $('enemy-pressure').classList.toggle('is-dense',game.activeEnemyCount >= 35);
  $('wave-label').textContent = `第 ${Math.max(1,game.wave)} / ${game.waveCount} 波`; $('time-value').textContent = formatTime(game.time); $('field-hint').textContent = `${game.map.name} · ${game.map.rule.copy}`; $('field-hint').classList.toggle('is-quiet',game.time > 6);
  const speed = tutorial.active ? 1 : store.state.settings.speed; $('speed-button').textContent = speed + '×'; $('speed-button').disabled = tutorial.active || ended; $('speed-button').setAttribute('aria-label',tutorial.active ? '教学期间固定一倍速' : `当前${speed}倍速，点按切换`);
  $('threat-indicator').hidden = game.activeEnemyCount < 35 || tutorial.active || selectedSlot >= 0 || game.state !== 'playing'; $('threat-indicator').textContent = game.activeEnemyCount >= 70 ? '大军压境 · 准备无双' : '敌潮汇聚';
  for (const [id,key] of [['music-button','musicEnabled'],['sound-button','sfxEnabled']]) { $(id).classList.toggle('is-muted',!store.state.settings[key]); $(id).textContent = (key === 'musicEnabled' ? '音乐 ' : '音效 ') + (store.state.settings[key] ? '开' : '关'); $(id).setAttribute('aria-pressed',String(store.state.settings[key])); }
  renderCommands();
  for (const hero of game.heroes) { const ui = commandNodes.get(hero.id); const canCast = game.state === 'playing' && hero.rage >= 100 - 1e-8 && hero.rageRecovery <= 1e-8 && !hero.reserved;
    // Ready cue fires on the transition only, for heroes the player casts by hand.
    if (canCast && !ui.wasReady && !hero.auto) { sound.handleEvent({type:'rageReady',heroId:hero.id}); ui.node.classList.remove('just-ready'); void ui.node.offsetWidth; ui.node.classList.add('just-ready'); }
    ui.wasReady = canCast; ui.fill.style.width = Math.min(100,hero.rage) + '%'; ui.node.disabled = !canCast; ui.node.classList.toggle('is-ready',canCast); ui.sub.textContent = hero.reserved ? '技能排队中' : hero.rageRecovery > 0 ? `冷却 ${Math.ceil(hero.rageRecovery)} 秒` : canCast ? `可击 ${hero.target?.count || 0} 人` : `怒气 ${Math.floor(hero.rage)}%`; ui.state.textContent = hero.reserved ? '队列' : hero.rageRecovery > 0 ? '冷却' : canCast ? '就绪' : hero.auto ? '自动' : hero.role === 'lead' ? '领衔' : '协战'; ui.node.setAttribute('aria-label',`${hero.name} · ${hero.definition.ultimate.name} · ${hero.reserved ? '技能排队中' : hero.rageRecovery > 0 ? `冷却 ${Math.ceil(hero.rageRecovery)} 秒` : canCast ? '可施放' : `蓄怒 ${Math.floor(hero.rage)} / 100`}`); }
  // The burst step hides the coach entirely so nothing covers the sweep.
  const guideVisible = tutorial.active && tutorial.step !== 'burst' && game.state === 'playing' && selectedSlot < 0 && !storyVisible; $('tutorial-card').hidden = !guideVisible; const view = guideVisible ? tutorial.view : null; const guideKey = `${guideVisible}/${tutorial.step}/${tutorial.burstKills}`;
  if (guideKey !== tutorialKey && view) { $('tutorial-card').dataset.step = tutorial.step; $('tutorial-progress').textContent = `学习守关 · ${view.number} / 4`; $('tutorial-title').textContent = view.title; $('tutorial-copy').textContent = view.copy.replaceAll('关羽',game.heroes[0].name); $('tutorial-action').textContent = view.action; $('tutorial-action').hidden = !view.action; $('tutorial-status').textContent = tutorial.freezesBattle ? '战斗已暂停 · 操作后继续' : '实战中 · 军阵自动迎敌'; } tutorialKey = guideKey; $('field-hint').hidden = guideVisible;
  const leadUi = commandNodes.get(game.heroes[0].id); leadUi?.node.classList.toggle('is-tutorial-target',tutorial.step === 'ultimate');
  $('formation-button').classList.toggle('is-tutorial-target',tutorial.step === 'deploy' && selectedSlot < 0);
  syncCombo();
  if (game.state === 'choosing' && choiceRevealRemaining <= 1e-8) renderChoices(); if (changed && ['won','lost'].includes(game.state)) renderResult(); previousState = game.state;
  syncAudio();
}
function syncAudio() { const active = !document.hidden && !pageSuspended; if (active !== audioActive) { audioActive = active; sound.setActive(active); } if (mode === 'lobby') sound.setScene('menu'); else sound.setScene(game?.state === 'playing' || game?.state === 'choosing' && choiceRevealRemaining > 1e-8 ? game.enemies.some(e => e.type === 'boss') ? 'boss' : 'battle' : game?.state === 'ready' ? 'pause' : game?.state || 'menu'); }
function advanceChoiceReveal(realDt, now) {
  if (mode !== 'battle' || game?.state !== 'choosing') { choiceRevealRemaining = 0; choiceRevealFrame = null; return; }
  const visible = !document.hidden && !pageSuspended && !storyVisible && !tutorial.freezesBattle && $('lobby-modal').hidden;
  if (visible && choiceRevealRemaining > 0 && choiceRevealFrame !== now) {
    choiceRevealRemaining = Math.max(0, choiceRevealRemaining - Math.min(.1, Math.max(0, realDt)));
    if (choiceRevealRemaining <= 1e-8) { choiceRevealRemaining = 0; syncBattle(); }
  }
  choiceRevealFrame = now;
}
function consumeCues() {
  for (const cue of renderer.consumeUiEvents?.() || []) {
    if (cue.type === 'gateHit') { const flash = $('gate-flash'); flash.classList.add('is-on'); setTimeout(() => flash.classList.remove('is-on'),calm() ? 0 : 140); replayClass(document.querySelector('.castle-stat'),'is-hit'); }
    else if (cue.type === 'waveClear' && !cue.final) banner(`第 ${cue.wave} 波 · 肃清`);
  }
}
function playGate() { if (calm()) return; replayClass($('gate-transition'),'is-run'); }
function togglePause() { if (!game || !['playing','paused'].includes(game.state)) return; selectedSlot = -1; game.state === 'paused' ? game.resume() : game.pause(); resetClock(); syncBattle(true); }
function battleCanAdvance() { return mode === 'battle' && game?.state === 'playing' && selectedSlot < 0 && !storyVisible && !tutorial.freezesBattle && !document.hidden && !pageSuspended && $('lobby-modal').hidden; }

for (const id of ['campaign','heroes','workshop','settings']) bind(id + '-tab',() => showTab(id));
bind('campaign-start',() => { enterBattle(); if (mode === 'battle') playGate(); }); bind('modal-close',closeModal);
bind('setting-music',() => changeSetting('musicEnabled',!store.state.settings.musicEnabled)); bind('setting-sfx',() => changeSetting('sfxEnabled',!store.state.settings.sfxEnabled)); bind('setting-motion',() => changeSetting('reducedMotion',!store.state.settings.reducedMotion)); bind('setting-speed',() => changeSetting('speed',nextSpeed(store.state.settings.speed)));
bind('setting-guide',() => enterBattle(CONTENT.levels[0].id,true)); bind('save-export',showExport); bind('save-import',showImport);
$('guest-checkbox').addEventListener('change',() => { notify(store.setGuest(selectedLevelId,$('guest-checkbox').checked)); renderLevelDetail(); });
bind('story-start',beginCombat); bind('story-skip',beginCombat); bind('pause-button',togglePause); bind('resume-button',() => { game?.resume(); syncBattle(true); }); bind('restart-paused',() => enterBattle(game.level.id,false,{friend:challenge,retry:true})); bind('retry-button',() => enterBattle(game.level.id,false,{friend:challenge,retry:true})); bind('result-home',() => { returnHome(); showTab('campaign'); });
for (const id of ['tech','forge','bag']) bind('ws-tab-' + id,() => showWorkshopPanel(id));
bind('prepare-button',showPrepare); bind('bulk-salvage',showBulkSalvage); bind('loot-rates-button',showLootRates);
bind('leave-battle',() => { const body = openModal('结束本次演武？'); body.append(make('p','本局没有奖励，已有进度都会保留。','modal-note')); const actions = make('div','','modal-actions'); actions.append(button('继续守关','',() => { closeModal(); game.resume(); syncBattle(true); }),button('返回军帐','',returnHome)); body.append(actions); });
bind('next-level',() => { if ($('next-level').dataset.action === 'retry') { enterBattle(game.level.id,false,{retry:true}); return; } const next = CONTENT.levels.find(l => l.globalIndex === game.level.globalIndex + 1); if (next) { enterBattle(next.id); playGate(); } });
bind('result-share',showShare); bind('challenge-enter',showChallengeEntry); bind('telemetry-view',showTelemetry);
// Route and intel retain keyboard access and return focus to the control that opened them.
let routeReturn = null, intelHintSeen = false;
function openRoute() {
  routeReturn = document.activeElement; $('route-sheet').hidden = false; $('route-button').setAttribute('aria-expanded','true'); $('route-close').focus?.(); void sound.unlock();
}
function closeRoute() {
  $('route-sheet').hidden = true; $('route-button').setAttribute('aria-expanded','false'); (routeReturn || $('route-button')).focus?.(); routeReturn = null;
}
bind('route-button',openRoute); bind('route-close',closeRoute);
$('route-sheet').addEventListener('click',event => { if (event.target === $('route-sheet')) closeRoute(); });
for (const sheet of [$('route-sheet'),$('level-intel'),$('lobby-modal')]) sheet.addEventListener('keydown',event => {
  if (event.key !== 'Tab' && event.code !== 'Tab') return;
  const popover = $('hero-gear-popover');
  const scope = sheet === $('lobby-modal') && popover && !popover.hidden ? popover : sheet;
  const controls = [...scope.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(node => {
    if (node.disabled || node.getAttribute('tabindex') === '-1') return false;
    for (let parent = node; parent; parent = parent.parentElement) if (parent.hidden) return false;
    return true;
  });
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus?.(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus?.(); }
});
// Long-press a stage node (right-click on desktop); a focus-visible button is available to keyboard users.
function openIntel(levelId = selectedLevelId) {
  const fromKeyboardEntry = document.activeElement === $('intel-button');
  intelHintSeen = true;
  if (levelId !== selectedLevelId) { selectedLevelId = levelId; selectedChapter = store.getLevel(levelId).chapterId; renderCampaign(); }
  renderFocus(store.getLevel(selectedLevelId));
  intelReturn = $('route-sheet').hidden ? fromKeyboardEntry ? $('intel-button') : $('focus-nodes').querySelector('.is-selected') : $('route-close');
  $('level-intel').hidden = false; $('intel-close').focus?.(); void sound.unlock();
}
function closeIntel() { $('level-intel').hidden = true; intelReturn?.focus?.(); intelReturn = null; }
bind('intel-button',() => openIntel()); bind('intel-close',closeIntel);
$('level-intel').addEventListener('click',event => { if (event.target === $('level-intel')) closeIntel(); });
let pressTimer = null, pressNode = null, pressOrigin = null;
const pressTarget = event => event.target?.closest?.('.level-card') || event.target?.closest?.('.focus-node.is-selected');
const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; pressNode?.classList.remove('is-pressing'); pressNode = null; };
for (const host of [$('level-grid'),$('focus-map')]) {
  host.addEventListener('pointerdown',event => { const node = pressTarget(event); if (!node || event.button > 0) return; cancelPress(); pressNode = node; pressOrigin = { x:event.clientX, y:event.clientY }; node.classList.add('is-pressing');
    pressTimer = setTimeout(() => { const id = node.dataset?.levelId || selectedLevelId; cancelPress(); suppressClick = true; setTimeout(() => { suppressClick = false; },700); openIntel(id); },450); });
  host.addEventListener('pointermove',event => { if (pressOrigin && Math.hypot(event.clientX - pressOrigin.x,event.clientY - pressOrigin.y) > 12) cancelPress(); });
  for (const type of ['pointerup','pointercancel','pointerleave']) host.addEventListener(type,cancelPress);
  host.addEventListener('contextmenu',event => { const node = pressTarget(event); if (!node) return; event.preventDefault(); cancelPress(); openIntel(node.dataset?.levelId || selectedLevelId); });
}
$('result-overlay').addEventListener('click',event => { if (!event.target?.closest?.('button,summary,a')) skipResult(); });
bind('result-open-box',() => { if (settlement?.ok && settlement.loot?.item && !lootRevealed) { lootRevealed = true; lootJustOpened = true; renderLootResult(); } });
bind('formation-button',cycleCamp); bind('close-camp',closeCamp); bind('speed-button',() => { if (!tutorial.active) { changeSetting('speed',nextSpeed(store.state.settings.speed)); resetClock(); } }); bind('music-button',() => changeSetting('musicEnabled',!store.state.settings.musicEnabled)); bind('sound-button',() => changeSetting('sfxEnabled',!store.state.settings.sfxEnabled));
bind('tutorial-skip',() => finishTutorial(true)); bind('tutorial-action',() => { if (tutorial.step === 'intro') { tutorial.advance(); syncBattle(); } else if (tutorial.step === 'deploy') { const slot = guideSlot(); slot >= 0 ? openCamp(slot) : cycleCamp(); } else if (tutorial.step === 'ultimate') cast(); else if (tutorial.step === 'complete') finishTutorial(); });
$('battle-canvas').addEventListener('pointerup',event => { if (mode !== 'battle') return; const slot = renderer.hitTest(event.clientX,event.clientY); if (slot >= 0) { void sound.unlock(); openCamp(slot); } else if (selectedSlot >= 0) closeCamp(); });
document.addEventListener('keydown',event => { if (event.code === 'Escape') { if (!$('level-intel').hidden) closeIntel(); else if (!$('route-sheet').hidden) closeRoute(); else if (!$('lobby-modal').hidden && $('hero-gear-popover') && !$('hero-gear-popover').hidden) closeHeroGear(); else if (!$('lobby-modal').hidden) closeModal(); else if (selectedSlot >= 0) closeCamp(); else if (mode === 'battle') togglePause(); event.preventDefault(); } else if (mode === 'battle' && event.code === 'KeyP') { togglePause(); event.preventDefault(); } else if (mode === 'battle' && event.code === 'Space' && !/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) { cast(); event.preventDefault(); } });
document.addEventListener('visibilitychange',() => { resetClock(); if (document.hidden && game?.state === 'playing') { selectedSlot = -1; game.pause(); } syncAudio(); syncBattle(true); });
window.addEventListener('pagehide',() => { pageSuspended = true; resetClock(); if (game?.state === 'playing') game.pause(); sound.setActive(false); audioActive = false; store.save(); });
window.addEventListener('pageshow',() => { pageSuspended = false; resetClock(); audioActive = null; syncAudio(); syncBattle(true); }); window.addEventListener('resize',() => renderer.resize()); motionPreference.addEventListener('change',() => { renderer.reducedMotion = store.state.settings.reducedMotion || motionPreference.matches; if (renderer.reducedMotion) combatClock.clearImpact(); });

function frame(now) {
  const realDt = Math.max(0,(now-last) / 1000); last = now;
  try {
    combatClock.advance(realDt,tutorial.active ? 1 : store.state.settings.speed,battleCanAdvance,step => { game.update(step); tutorial.update({state:game.state,rage:game.rage,maxRage:100,enemyCount:game.activeEnemyCount}); });
    advanceChoiceReveal(realDt, now); tickCounters(now);
    if (mode === 'battle' && game) {
      tutorial.update({state:game.state,rage:game.rage,maxRage:100,enemyCount:game.activeEnemyCount});
      const visible = !document.hidden && !pageSuspended;
      // The completion line no longer freezes combat; it dismisses itself after a few visible seconds.
      if (visible && game.state === 'playing' && tutorial.tick(realDt)) finishTutorial();
      if (visible && game.state === 'playing') {
        if (!battleCanAdvance()) battleFrozenMs += Math.min(100, realDt * 1000);
        else if (game.heroes[0].rage >= 100 - 1e-8 && game.heroes[0].rageRecovery <= 1e-8 && !game.heroes[0].reserved && game.activeEnemyCount > 0) unusedRageSec += Math.min(.1,realDt) * (tutorial.active ? 1 : store.state.settings.speed);
      }
      renderer.draw(game,{selectedSlot,guideSlot:tutorial.step === 'deploy' ? guideSlot() : -1,realDt:Math.min(.1,realDt)}); consumeCues(); elapsedUi += Math.min(.1,realDt); if (elapsedUi >= .08) { syncBattle(); elapsedUi = 0; }
      samplePerformance(realDt);
    }
    else syncAudio();
  } catch (error) { $('fatal-message').hidden = false; $('fatal-message').textContent = '战场暂时无法继续。当前进度保留在军帐存档中，请刷新后再试。'; console.error(error); return; }
  requestAnimationFrame(frame);
}
for (const [id,key] of [['music-volume','musicVolume'],['sfx-volume','sfxVolume']]) {
  // input previews live; change persists once, so dragging does not rewrite the save on every pixel.
  $(id).addEventListener('input',() => { const value = Number($(id).value) / 100; $(id + '-value').textContent = $(id).value; sound.setPreferences({[key]:value}); });
  $(id).addEventListener('change',() => { void sound.unlock(); notify(store.setSetting(key,Number($(id).value) / 100)); renderSettings(); if (key === 'sfxVolume') sound.click(); });
}
// Portrait lock: a short landscape viewport pauses combat behind a "rotate back" sheet.
const landscape = window.matchMedia('(orientation: landscape) and (max-height: 500px)');
function syncOrientation() { document.body?.classList?.toggle('is-landscape-short',landscape.matches); if (landscape.matches && game?.state === 'playing') { selectedSlot = -1; game.pause(); syncBattle(true); } }
landscape.addEventListener?.('change',syncOrientation);

renderCampaign(); showWorkshopPanel(workshopPanel); $('nav-pill').style.setProperty('--tab','0'); syncAudio(); syncOrientation(); requestAnimationFrame(frame);
telemetry.log('first_interactive',{returning:Object.values(store.state.levels).some(l => l.cleared),cleared:Object.values(store.state.levels).filter(l => l.cleared).length,build:BUILD_ID});
openChallengeFromLink();
// Local playtest observation only (?debug): read-only access for the browser audit harness.
try { if (/[?&]debug\b/.test(globalThis.location?.search || '')) globalThis.__wushuang = { store, telemetry, renderer, diagnostics, get game() { return game; }, get combo() { return combo; } }; } catch { /* no location */ }
