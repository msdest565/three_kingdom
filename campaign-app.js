import { BALANCE, CONTENT } from './runtime-data.js';
import { CampaignStore } from './campaign-state.js';
import { V1Game } from './v1-engine.js';
import { V1Renderer } from './v1-renderer.js';
import { heroPortrait, HERO_ART } from './hero-portraits.js';
import { AudioSystem } from './audio-system.js';
import { TutorialController } from './tutorial.js';
import { CombatClock, nextSpeed } from './combat-clock.js';

const $ = id => document.getElementById(id);
const make = (tag, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
const button = (text, className, action) => { const node = make('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node; };
const portrait = (id, className = '') => { const node = make('img', '', className); node.src = heroPortrait(id); node.alt = BALANCE.heroes[id]?.name || '武将'; return node; };
const heroName = id => BALANCE.heroes[id]?.name || '武将';
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

const store = new CampaignStore();
const sound = new AudioSystem({ ...store.state.settings, timbres: {
  camps: {
    crossbow:{frequency:760,endFrequency:140,duration:.10,volume:.045,noiseDuration:.07,noiseVolume:.028,cutoff:2500,interval:.12},
    fire_oil:{frequency:190,endFrequency:80,duration:.15,volume:.030,noiseDuration:.22,noiseVolume:.041,cutoff:900,interval:.30},
    war_drum:{frequency:85,endFrequency:42,duration:.20,volume:.055,noiseDuration:.07,noiseVolume:.01,cutoff:750,interval:.6},
  },
  heroes:Object.fromEntries(Object.keys(BALANCE.heroes).map((id,index) => [id,{frequency:240 + index * 24,endFrequency:70 + index * 5,cutoff:1200 + index * 90,volume:.028}]))
} });
const tutorial = new TutorialController();
const combatClock = new CombatClock();
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const renderer = new V1Renderer($('battle-canvas'),{ reducedMotion:store.state.settings.reducedMotion || motionPreference.matches });
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
let toastTimer, bannerTimer, burstTimer;
let modalFocus = null;
const commandNodes = new Map();

function toast(text) { $('toast').textContent = text; $('toast').classList.add('is-visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('is-visible'),2000); }
function banner(text) { $('wave-banner').textContent = text; $('wave-banner').classList.add('is-visible'); clearTimeout(bannerTimer); bannerTimer = setTimeout(() => $('wave-banner').classList.remove('is-visible'),1800); }
function resetClock() { combatClock.resetAccumulator(); last = performance.now(); }
function notify(result, success) { if (result?.ok) { if (success) toast(success); if (result.persisted === false) toast(store.persistenceWarning); } else toast(reason(result)); return result?.ok; }
function bind(id, action) { $(id).addEventListener('click',event => { void sound.unlock(); sound.click(); action(event); }); }
function showTab(id) { for (const name of ['campaign','heroes','workshop','settings']) { $(name + '-screen').hidden = name !== id; $(name + '-tab').classList.toggle('is-active',name === id); $(name + '-tab').setAttribute('aria-pressed',String(name === id)); } if (id === 'workshop') renderWorkshop(); $('lobby-scroll').scrollTop = 0; }
function openModal(title) { modalFocus = document.activeElement; $('modal-title').textContent = title; $('modal-body').replaceChildren(); $('lobby-modal').hidden = false; $('modal-close').focus(); resetClock(); return $('modal-body'); }
function closeModal() { $('lobby-modal').hidden = true; $('modal-body').replaceChildren(); modalFocus?.focus?.(); resetClock(); }
function syncResources() { $('books-value').textContent = store.state.resources.experience_book; $('coins-value').textContent = store.state.resources.copper_coin; $('iron-value').textContent = store.state.resources.refined_iron; }

function renderParty() {
  const ids = [store.state.party.lead,...store.state.party.supports];
  const max = store.getMaxPartySize();
  $('party-slots').replaceChildren();
  for (let index = 0; index < BALANCE.party.maxHeroes; index++) {
    const id = ids[index];
    const locked = index >= max;
    const node = button('',`party-slot ${index === 0 ? 'is-lead' : ''} ${locked ? 'is-locked' : ''}`,() => { if (locked) { toast(index === 1 ? '通关魏篇第二关后开放协战' : '进入魏篇第九关开放第三阵位'); return; } showPartyPicker(index); });
    node.append(make('span',index === 0 ? '领衔' : '协战','slot-role'));
    if (id && !locked) { node.append(portrait(id),make('strong',heroName(id)),make('small',`Lv${store.state.heroes[id].level}${index ? store.state.party.autoSkills[id] ? ' · 自动技能' : ' · 手动技能' : ' · 手动将令'}`)); }
    else node.append(make('strong',locked ? '待开阵位' : '＋'),make('small',locked ? index === 1 ? '魏 3 开放' : '魏 9 开放' : '选择协战武将'));
    node.setAttribute('aria-label',locked ? '尚未开放阵位' : `${index === 0 ? '领衔' : '协战'}：${id ? heroName(id) : '未选择'}，点击调整`);
    $('party-slots').append(node);
  }
  $('party-unlock-note').textContent = max === 1 ? '魏篇第三关开放协战' : max === 2 ? '魏篇第九关开放第三阵位' : '三将同阵 · 协战可自动';
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
  $('level-act').textContent = `${factionNames[level.chapterId]}篇 · 第${level.act}幕 · 第${level.order}阵`;
  $('selected-level-name').textContent = level.name;
  $('selected-level-stars').textContent = starsCopy(progress?.highestRewardedStars || 0);
  $('level-brief').textContent = level.tacticalBrief;
  $('level-recommendation').textContent = `${level.waves.length} 波 · 建议 Lv${tier.recommendedHeroLevelRange[0]} / 技能 Lv${tier.recommendedSkillLevelRange[0]} · ${qualityNames[tier.recommendedMainWeaponQuality]}武器 Lv${tier.recommendedMainWeaponLevelRange[0]}`;
  $('level-map-rule').textContent = map.name + ' · ' + map.rule.copy;
  $('level-rewards').textContent = '首通：' + resourcesCopy(level.firstClearReward);
  drawMapPreview(map);
  const party = store.getPartyForLevel(level.id);
  $('party-level-note').textContent = !unlocked ? '先通关上一阵，再迎接这场演武。' : `本阵最多 ${level.maxPartySize} 将 · 当前${party.map(h => heroName(h.heroId) + (h.guest ? '（借将）' : '')).join('、')}。${party.length > 1 ? '精锐耐久随出战人数调整，普通兵保持清潮手感。' : ''}`;
  $('guest-option').hidden = !level.storyGuest || !unlocked;
  if (level.storyGuest) { $('guest-copy').textContent = `剧情借将：${heroName(level.storyGuest.heroId)} Lv${level.storyGuest.level}（占一个阵位；满编时替换末位）`; $('guest-checkbox').checked = Boolean(store.state.guestSelections[level.id]); }
  $('campaign-start').disabled = !unlocked || store.readOnly;
  $('campaign-start').textContent = unlocked ? progress?.cleared ? '重演此阵 ↗' : '出阵守关 ↗' : '通关前阵后开放';
}

function renderCampaign() {
  syncResources(); renderParty();
  const cleared = Object.values(store.state.levels).filter(l => l.cleared).length;
  $('campaign-progress').textContent = `${cleared} / ${CONTENT.levels.length} 阵已守 · ${Object.keys(store.state.heroes).length} 名将入录`;
  $('chapter-tabs').replaceChildren();
  for (const chapter of CONTENT.chapters) { const opened = chapter.levelIds.some(id => store.isLevelUnlocked(id)); const tab = button(`${factionNames[chapter.id]}篇`,`${chapter.id === selectedChapter ? 'is-active' : ''} ${opened ? '' : 'is-locked'}`,() => { selectedChapter = chapter.id; selectedLevelId = chapter.levelIds.find(id => store.isLevelUnlocked(id) && !store.state.levels[id]?.cleared) || chapter.levelIds[0]; renderCampaign(); }); tab.setAttribute('aria-pressed',String(chapter.id === selectedChapter)); $('chapter-tabs').append(tab); }
  const chapter = CONTENT.chapters.find(c => c.id === selectedChapter);
  $('chapter-title').textContent = `${factionNames[chapter.id]}篇 · ${chapter.title}`;
  $('chapter-progress').textContent = `${chapter.levelIds.filter(id => store.state.levels[id]?.cleared).length} / ${chapter.levelIds.length}`;
  $('level-grid').replaceChildren();
  for (const id of chapter.levelIds) { const level = store.getLevel(id); const unlocked = store.isLevelUnlocked(id); const stars = store.state.levels[id]?.highestRewardedStars || 0; const boss = level.waves.some(w => w.bossSpawn); const node = button('',`level-card ${id === selectedLevelId ? 'is-selected' : ''} ${unlocked ? '' : 'is-locked'} ${boss ? 'is-boss' : ''}`,() => { selectedLevelId = id; renderCampaign(); }); node.append(make('span',String(level.order).padStart(2,'0'),'level-number'),make('span',level.name,'level-name'),make('span',stars ? '★'.repeat(stars) : unlocked ? boss ? '幕末敌将' : '可挑战' : '待解锁','level-stars')); node.setAttribute('aria-label',`第${level.order}关 ${level.name}，${unlocked ? stars ? `${stars}星` : '可挑战' : '待解锁'}`); $('level-grid').append(node); }
  renderLevelDetail(); renderRoster(); renderSettings(); renderWorkshop();
}

function renderRoster() {
  $('hero-roster').replaceChildren();
  for (const [id,definition] of Object.entries(BALANCE.heroes)) { const owned = store.state.heroes[id]; const included = [store.state.party.lead,...store.state.party.supports].includes(id); const node = button('',`hero-card ${owned ? '' : 'is-locked'} ${included ? 'is-in-party' : ''}`,() => { if (owned) showHero(id); else { const unlock = BALANCE.metaProgression.heroUnlocks.find(u => u.heroId === id); const level = store.getLevel(unlock?.levelId); toast(level ? `通关${factionNames[level.chapterId]}篇第${level.order}关「${level.name}」解锁` : '主线解锁这名武将'); } }); node.append(portrait(id),make('strong',definition.name),make('span',`${factionNames[HERO_ART[id].faction]} · ${definition.ultimate.name}`,'faction-tag'),make('small',owned ? `Lv${owned.level} / 技能 Lv${owned.skillLevel}` : '主线首通解锁')); $('hero-roster').append(node); }
  $('hero-owned-count').textContent = `${Object.keys(store.state.heroes).length} / ${Object.keys(BALANCE.heroes).length}`;
}

function showPartyPicker(index) {
  const body = openModal(index === 0 ? '选择领衔武将' : '选择协战武将');
  body.append(make('p',index === 0 ? '领衔手动施放，开局拥有 40 怒气。' : '协战有独立怒气。可全手动，或开启本将自动技能。','modal-note'));
  const current = [store.state.party.lead,...store.state.party.supports];
  const grid = make('div','','modal-roster');
  for (const id of Object.keys(store.state.heroes)) { const pick = button('',current[index] === id ? 'is-chosen' : '',() => { const ids = [store.state.party.lead,...store.state.party.supports]; const other = ids.indexOf(id); if (other >= 0) { [ids[index],ids[other]] = [ids[other],ids[index]]; } else ids[Math.min(index,ids.length)] = id; if (notify(store.setParty(ids.filter(Boolean)),'将令已调整')) { closeModal(); renderCampaign(); } }); pick.append(portrait(id),make('span',heroName(id))); grid.append(pick); } body.append(grid);
  if (index > 0 && current[index]) { const id = current[index]; body.append(button(store.state.party.autoSkills[id] ? '自动技能：开启 · 点按改为手动' : '自动技能：关闭 · 点按开启', 'auto-toggle',() => { const flags = {[id]:!store.state.party.autoSkills[id]}; if (notify(store.setParty(current,flags),'协战将令已更新')) { closeModal(); renderCampaign(); } })); body.append(button('取消这名协战','auto-toggle',() => { if (notify(store.setParty(current.filter((_,i) => i !== index)),'已调整出战')) { closeModal(); renderCampaign(); } })); }
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
  body.append(make('p','同槽行装可以换装或从其他武将转移。被换装备留在背包，转移来源的该槽将空置。','modal-note'));
  const items = store.getInventory({slot});
  for (const item of items) {
    const current = item.equippedHeroId === heroId;
    const row = make('div','',`equipment-card quality-${item.quality}`);
    row.append(make('strong',itemCopy(item)),make('small',(current ? '' : '换装后：') + signatureCopy(item,heroId)),make('small',current ? '本将正在穿戴' : item.equippedHeroId ? `${heroName(item.equippedHeroId)}正在穿戴 · 可转移` : '背包待用'));
    const pick = button(current ? '已穿戴' : item.equippedHeroId ? `转移给${heroName(heroId)}` : '换装','equipment-pick',() => { if (notify(store.equipEquipment(heroId,item.itemInstanceId),'行装已调整')) { renderCampaign(); showHero(heroId); } });
    pick.disabled = current || store.readOnly; row.append(pick); body.append(row);
  }
  if (!items.length) body.append(make('p','此槽暂无行装，可前往铁匠铺锻造。','modal-note'));
  body.append(button('返回武将详情','auto-toggle',() => showHero(heroId)));
}
function showSalvage(item) {
  const body = openModal('分解闲置装备');
  body.append(make('p',itemCopy(item),'modal-note'),make('p',`分解后获得：${resourcesCopy(BALANCE.metaProgression.equipment.salvage.byQuality[item.quality])}。强化投入不返还。`,'modal-note'));
  if (equipmentDefinitions[item.templateId]?.exclusiveHeroId) body.append(make('p',signatureCopy(item),'modal-note'));
  const actions = make('div','','modal-actions');
  const confirm = button('确认分解','',() => { if (notify(store.salvageEquipment(item.itemInstanceId),'行装已分解')) { closeModal(); renderCampaign(); } });
  confirm.disabled = Boolean(item.equippedHeroId) || store.readOnly;
  actions.append(button('保留装备','',closeModal),confirm); body.append(actions);
}
function renderWorkshop() {
  $('workshop-loot-rates').textContent = lootRatesCopy;
  $('technology-list').replaceChildren();
  for (const [campId,definition] of Object.entries(BALANCE.technology.camps)) {
    const level = store.state.technology[campId]; const quote = store.getTechnologyCost(campId); const bonuses = definition.perLevelBonuses;
    const effects = [bonuses.damage ? `伤害 +${Number((level * bonuses.damage * 100).toFixed(1))}%` : '', `范围 +${level * bonuses.range}`, bonuses.auraDamage ? `军阵增伤 +${Number((level * bonuses.auraDamage * 100).toFixed(1))}%` : ''].filter(Boolean).join(' · ');
    const row = make('div','','technology-card'); const copy = make('div');
    copy.append(make('strong',`${definition.name} · 科技 Lv${level}/${definition.levelMax}`),make('small',effects));
    copy.append(make('small','每级：' + [bonuses.damage ? `伤害 +${bonuses.damage * 100}%` : '',`范围 +${bonuses.range}`,bonuses.auraDamage ? `军阵增伤 +${bonuses.auraDamage * 100}%` : ''].filter(Boolean).join(' · ')));
    const research = button('','workshop-action',() => { if (notify(store.researchTechnology(campId),'军营科技已精进')) renderCampaign(); });
    research.append(make('span',quote.ok ? `研究 → Lv${quote.targetLevel}` : '研究'),make('small',quoteCopy(quote))); research.disabled = !canBuy(quote);
    row.append(copy,research); $('technology-list').append(row);
  }
  $('forge-list').replaceChildren();
  const label = make('label','锻造行装','forge-label'); label.setAttribute('for','forge-template');
  const select = make('select','','forge-select'); select.id = 'forge-template'; select.setAttribute('aria-label','选择锻造装备');
  for (const definition of Object.values(equipmentDefinitions).filter(template => template.forgeQualities.length)) { const option = make('option',`${definition.name} · ${definition.exclusiveHeroId ? heroName(definition.exclusiveHeroId) + '专属' : slotNames[definition.slot]}`); option.value = definition.id; select.append(option); }
  select.value = forgeTemplateId; select.addEventListener('change',() => { forgeTemplateId = select.value; renderWorkshop(); });
  $('forge-list').append(label,select);
  const definition = equipmentDefinitions[forgeTemplateId];
  if (definition.exclusiveHeroId) $('forge-list').append(make('p',`${heroName(definition.exclusiveHeroId)}本人穿戴：${definition.effectDescription}；任何武将均可穿戴。`,'quiet-note'));
  const forgeActions = make('div','','forge-actions');
  for (const quality of definition.forgeQualities) { const quote = store.getForgeCost(forgeTemplateId,quality); const forge = button('',`workshop-action quality-${quality}`,() => { if (notify(store.forgeEquipment(forgeTemplateId,quality),`${definition.name}已入背包`)) renderCampaign(); }); forge.append(make('strong',`锻造${qualityNames[quality]}色`),make('small',quoteCopy(quote))); forge.disabled = !canBuy(quote); forgeActions.append(forge); }
  $('forge-list').append(forgeActions);
  $('inventory-filters').replaceChildren();
  for (const slot of ['all',...BALANCE.metaProgression.equipment.slots]) { const filter = button(slot === 'all' ? '全部' : slotNames[slot],inventorySlot === slot ? 'is-active' : '',() => { inventorySlot = slot; renderWorkshop(); }); filter.setAttribute('aria-pressed',String(inventorySlot === slot)); $('inventory-filters').append(filter); }
  const items = store.getInventory(inventorySlot === 'all' ? {} : {slot:inventorySlot});
  $('inventory-count').textContent = `${store.state.inventory.length} 件 · ${store.state.inventory.filter(item => !item.equippedHeroId).length} 件闲置`;
  $('inventory-list').replaceChildren();
  for (const item of items) { const row = make('div','',`equipment-card quality-${item.quality}`); row.append(make('strong',itemCopy(item)),make('small',signatureCopy(item)),make('small',item.equippedHeroId ? `${heroName(item.equippedHeroId)}正在穿戴` : '背包待用 · 可在武将详情换装')); if (!item.equippedHeroId) { const salvage = button('分解','salvage-button',() => showSalvage(item)); salvage.disabled = store.readOnly; row.append(salvage); } $('inventory-list').append(row); }
  if (!items.length) $('inventory-list').append(make('p','此槽暂无装备。胜利装备箱与铁匠铺为你补充行装。','quiet-note'));
}
function showHero(id, keepModal = false) {
  const hero = store.getHero(id); if (!hero) return;
  const body = keepModal ? $('modal-body') : openModal(heroName(id) + ' · 培养与行装'); body.replaceChildren();
  const summary = make('div','','modal-hero-summary'); const copy = make('div'); copy.append(make('h3',BALANCE.heroes[id].ultimate.name),make('p',`武将 Lv${hero.level} / 技能 Lv${hero.skillLevel}\n${hero.equipment.weapon ? qualityNames[hero.equipment.weapon.quality] + '色武器 Lv' + hero.equipment.weapon.level : ''}`)); summary.append(portrait(id),copy); body.append(summary);
  const actions = make('div','','training-actions');
  for (const [title,quote,action] of [['提升等级',store.getTrainingCost(id),() => store.trainHero(id)],['强化技能',store.getSkillCost(id),() => store.trainSkill(id)]]) { const node = button('','training-action',() => { const result = action(); notify(result,'培养完成'); renderCampaign(); showHero(id,true); }); node.append(make('strong',quote.ok ? `${title} → Lv${quote.targetLevel}` : title),make('small',quoteCopy(quote))); node.disabled = !canBuy(quote); actions.append(node); } body.append(actions);
  for (const slot of BALANCE.metaProgression.equipment.slots) {
    const gear = hero.equipment[slot]; const row = make('div','',`gear-row ${gear ? 'quality-' + gear.quality : 'is-empty'}`); const info = make('div','','gear-copy');
    info.append(make('strong',gear ? itemCopy(gear) : `${slotNames[slot]} · 未装备`),make('small',gear ? signatureCopy(gear,id) : gearCopy[slot])); row.append(info);
    const actions = make('div','','gear-actions'); const equip = button('选择' + slotNames[slot],'gear-equip',() => showEquipmentPicker(id,slot)); equip.disabled = store.readOnly; actions.append(equip);
    if (gear) {
      const operations = [['强化',store.getEquipmentUpgradeCost(id,slot),() => store.upgradeEquipment(id,slot)]];
      if (!['red','gold'].includes(gear.quality)) operations.push(['升品',store.getEquipmentPromotionCost(id,slot),() => store.promoteEquipment(id,slot)]);
      for (const [title,quote,action] of operations) { const node = button('','',() => { notify(action(),'行装已强化'); renderCampaign(); showHero(id,true); }); node.append(make('span',title),make('small',quoteCopy(quote))); node.disabled = !canBuy(quote); actions.append(node); }
    }
    row.append(actions); body.append(row);
  }
  const signatures = Object.values(equipmentDefinitions).filter(template => template.exclusiveHeroId === id);
  body.append(make('p',signatures.map(template => `${template.name}（${qualityNames[template.quality]}色${slotNames[template.slot]}）：${template.effectDescription}`).join('\n'),'modal-note signature-catalog'));
  body.append(make('p','当前可用：' + resourcesCopy(store.state.resources),'modal-note'));
  body.append(make('p','优先培养三位主力与主武器。铠甲、兵符和战马可按需要加强；控制时间、处决与回怒不随装备提高。','modal-note'));
}

function renderSettings() {
  const s = store.state.settings;
  for (const [id,key,label] of [['setting-music','musicEnabled','音乐'],['setting-sfx','sfxEnabled','音效'],['setting-motion','reducedMotion','减弱动态']]) { $(id).textContent = `${label}：${s[key] ? '开启' : '关闭'}`; $(id).setAttribute('aria-pressed',String(s[key])); }
  $('setting-speed').textContent = `默认速度：${s.speed}×`;
  $('storage-status').textContent = store.persistenceWarning || (store.readOnly ? '检测到较新版本存档，已保留原文件；请在更新版本打开。' : '存档已在本地保存；可导出备份。');
  sound.setPreferences(s); renderer.reducedMotion = s.reducedMotion || motionPreference.matches;
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

function handleBattleEvent(event) {
  tutorial.handleEvent(event); sound.handleEvent(event);
  if (mode === 'battle' && !document.hidden && !pageSuspended && ['damage','kill','ultimate','burst'].includes(event.type)) {
    if (renderer.handleEvent) renderer.handleEvent(event);
    else if (['ultimate','burst'].includes(event.type)) renderer.flashUltimate(event.type === 'burst' ? {...event,type:'burst'} : event);
  }
  if (event.type === 'wave') banner(event.boss ? '敌将压境 · 注意军报' : `第 ${event.wave} 波 · 敌潮来袭`);
  else if (event.type === 'bossWarning') banner(event.name ? `${event.name}即将入阵` : '敌将将至 · 准备无双');
  else if (event.type === 'reinforcementWarning') banner(`${event.name} · ${event.seconds}秒后入阵`);
  else if (event.type === 'ultimate') { if (!renderer.reducedMotion && mode === 'battle' && !document.hidden && !pageSuspended) combatClock.triggerImpact(0.35,0.25); }
  else if (event.type === 'burst') { const kills = Math.max(0,Math.floor(Number(event.burstKills ?? event.kills) || 0)); const skillName = BALANCE.heroes[event.heroId]?.ultimate.name || '无双破阵'; $('burst-label').textContent = kills ? `${skillName} · ${heroName(event.heroId)} 击破 ` : skillName; $('burst-kills').textContent = kills ? String(kills) : ''; $('burst-kills').hidden = kills === 0; $('burst-number').classList.add('is-visible'); clearTimeout(burstTimer); burstTimer = setTimeout(() => $('burst-number').classList.remove('is-visible'),1300); }
  else if (event.type === 'skillQueued' && event.queuePosition > 1) toast(`${event.name}已待命 · 技能依次施放`);
  else if (event.type === 'tactic') toast(event.upgrade?.name || event.name || '战术已强化');
  else if (['win','lose'].includes(event.type) && game && !settlement) { settlement = store.settleBattle({ battleId,levelId:game.level.id,won:event.type === 'win',hp:Math.max(0,game.hp),maxHp:game.maxHp,kills:game.kills,bestBurst:game.bestBurst,time:game.time,casts:game.stats.ultimateCasts }); if (!settlement.ok) toast(reason(settlement)); }
}

function enterBattle(levelId = selectedLevelId, guide = false) {
  if (!store.isLevelUnlocked(levelId)) { toast('先通关上一阵'); return; }
  const party = store.getPartyForLevel(levelId); if (!party.length || store.readOnly) { toast('当前存档无法开始战斗'); return; }
  battleId = store.createBattleId(); if (!battleId) { toast('暂时无法开始新局，请先导出存档备份'); return; }
  selectedLevelId = levelId; selectedChapter = store.getLevel(levelId).chapterId; settlement = null; lootRevealed = false; selectedSlot = -1; formationCursor = -1;
  game = new V1Game({levelId,party,unlockedCamps:store.state.unlockedCamps,campTech:store.getBattleTechnology(),onEvent:handleBattleEvent});
  mode = 'battle'; forceGuide = guide || store.state.settings.tutorialVersion < 1; tutorial.reset(false); storyVisible = !store.state.levels[levelId]?.cleared; renderer.resetFeedback?.(); combatClock.clearImpact();
  $('lobby-view').hidden = true; $('battle-view').hidden = false; $('battle-level-title').textContent = `${factionNames[game.level.chapterId]} ${game.level.order} · ${game.level.name}`; $('battle-seal').textContent = factionNames[game.level.chapterId];
  renderer.flash = null; renderer.bladeTrails = []; renderer.setMap(game.map); renderer.resize(); previousState = ''; choicesKey = ''; commandsKey = ''; tutorialKey = ''; commandNodes.clear();
  $('burst-number').classList.remove('is-visible'); clearTimeout(burstTimer); $('wave-banner').classList.remove('is-visible');
  $('story-title').textContent = game.level.name; $('story-kicker').textContent = `${factionNames[game.level.chapterId]}篇 · 第${game.level.act}幕`;
  $('story-lines').replaceChildren(); for (const line of game.level.story.opening) { const p = make('p'); p.append(make('strong',line.speaker),make('span',line.text)); $('story-lines').append(p); }
  resetClock(); void sound.unlock(); sound.setScene('battle'); if (!storyVisible) beginCombat(); syncBattle(true);
}
function beginCombat() { if (!game || game.state !== 'ready') return; storyVisible = false; tutorial.reset(forceGuide); game.start(); resetClock(); syncBattle(true); }
function returnHome() { mode = 'lobby'; selectedSlot = -1; tutorial.skip(); storyVisible = false; renderer.resetFeedback?.(); combatClock.clearImpact(); $('burst-number').classList.remove('is-visible'); $('battle-view').hidden = true; $('lobby-view').hidden = false; closeModal(); sound.setScene('menu'); resetClock(); renderCampaign(); }
function closeCamp() { selectedSlot = -1; $('camp-panel').hidden = true; resetClock(); if (game) syncBattle(); }
function openCamp(slot) {
  if (!game || game.state !== 'playing' || storyVisible) return;
  selectedSlot = slot; formationCursor = slot; resetClock(); $('camp-panel').hidden = false;
  const camp = game.camps.find(c => c.slot === slot); $('camp-index-label').textContent = `第 ${slot + 1} 营位`; $('camp-title').textContent = camp ? `${BALANCE.camps[camp.type].name} · ${camp.level}级` : '部署军阵'; $('camp-options').replaceChildren();
  const modifier = game.map.rule.campModifier; $('camp-note').textContent = `布阵时战斗暂停${modifier?.slot === slot ? ' · ' + game.map.rule.copy : ''}`;
  if (camp) { const cost = game.getUpgradeCost(slot); if (cost === null) $('camp-options').append(make('div','军阵已满级','max-level')); else { const node = button('','camp-option upgrade-camp',() => { if (notify(game.upgrade(slot),'军阵已升级')) closeCamp(); }); node.append(make('strong',`升级至 ${camp.level + 1} 级`),make('small',`${cost} 军粮 · 强化${campCopy[camp.type]}`)); node.disabled = game.food < cost; $('camp-options').append(node); } }
  else for (const type of game.availableCamps) { const def = BALANCE.camps[type]; const node = button('','camp-option',() => { if (notify(game.build(slot,type),`${def.name}已部署`)) closeCamp(); }); node.append(make('span',campGlyphs[type],'camp-glyph'),make('strong',def.name),make('small',campCopy[type]),make('span',`${def.buildCost} 军粮`,'camp-cost')); node.disabled = game.food < def.buildCost; $('camp-options').append(node); }
  syncBattle();
}
function cycleCamp() { if (!game) return; const slots = game.map.campSlots; const previous = slots.findIndex(s => s.slot === formationCursor); const empty = slots.slice(previous + 1).find(s => !game.camps.some(c => c.slot === s.slot)) || slots.find(s => !game.camps.some(c => c.slot === s.slot)); openCamp(empty?.slot ?? slots[(previous + 1) % slots.length].slot); }
function cast(id = game?.heroes[0]?.id) { if (!game || game.state !== 'playing') return; closeCamp(); resetClock(); void sound.unlock(); const result = game.castUltimate(id); if (!result.ok) toast(result.reason); syncBattle(); }
function finishTutorial(skipped = false) { tutorial.skip(); store.setSetting('tutorialVersion',1); store.setSetting('tutorialCompleted',!skipped); closeCamp(); toast(skipped ? '已跳过引导 · 继续守关' : '已学会守关 · 以无双破阵'); syncBattle(true); }

function renderCommands() {
  const key = game.heroes.map(h => h.id).join('|'); if (key === commandsKey) return; commandsKey = key; $('hero-commands').replaceChildren(); $('lead-command').replaceChildren(); commandNodes.clear();
  for (const [index,hero] of game.heroes.entries()) { const lead = index === 0; const node = button('',`hero-command ${lead ? 'is-lead' : 'is-support'}`,() => cast(hero.id)); node.setAttribute('aria-label',`${hero.name} · ${hero.definition.ultimate.name} · 无双技能`); node.setAttribute('title',`${hero.name} · ${hero.definition.ultimate.name}`); const fill = make('span','','rage-fill'); fill.setAttribute('aria-hidden','true'); const copy = make('span','','skill-copy'); const name = make('strong',`${hero.name} · ${hero.definition.ultimate.name}`); const sub = make('small'); const state = make('span','','skill-state'); copy.append(name,sub); node.append(fill,portrait(hero.id),copy,state); (lead ? $('lead-command') : $('hero-commands')).append(node); commandNodes.set(hero.id,{node,fill,sub,state}); }
}
function renderChoices() { const key = game.upgrades.map(t => t.id).join('|'); if (key === choicesKey) return; choicesKey = key; $('upgrade-choices').replaceChildren(); for (const choice of game.upgrades) { const node = button('','upgrade-choice',() => { notify(game.selectUpgrade(choice.id),'战术已整备'); resetClock(); syncBattle(true); }); node.append(make('strong',choice.name),make('span',choice.description || tacticCopy(choice.id))); $('upgrade-choices').append(node); } }
function tacticCopy(id) { const def = BALANCE.tactics[id]; if (def?.camp) return `${BALANCE.camps[def.camp].name} · 强化${campCopy[def.camp]}，本局有效`; if (def?.hero) return `${heroName(def.hero)} · 强化无双，本局有效`; return '强化本局阵势'; }
function renderLootResult() {
  const loot = settlement?.ok && game.state === 'won' ? settlement.loot : null;
  $('result-loot').hidden = !loot?.item; $('result-open-box').hidden = lootRevealed; $('result-loot-item').hidden = !lootRevealed;
  $('result-loot-rates').textContent = `每次胜利 1 箱 · 失败不掉落\n${lootRatesCopy}\n金色专属武器仅由装备箱掉落`;
  if (loot?.item) { $('result-loot-item').textContent = `${itemCopy(loot.item)}\n${signatureCopy(loot.item)}\n${loot.salvaged ? '背包已满，本次新掉落已转换：' + resourcesCopy(loot.salvageResources) : '已存入装备背包 · 前往英雄录换装'}`; $('result-loot-item').className = `quality-${loot.item.quality}`; }
}
function renderResult() { renderLootResult(); const won = game.state === 'won'; $('result-kicker').textContent = `${factionNames[game.level.chapterId]}篇 · ${game.level.name}`; $('result-title').textContent = won ? '此阵，守住了。' : '整军，再来。'; $('result-stars').textContent = won ? starsCopy(settlement?.stars || game.stars) : '再战可破'; $('result-copy').textContent = won ? game.level.story.resolution.map(l => l.text).join(' ') : game.level.story.failureLine; $('result-kills').textContent = game.kills; $('result-burst').textContent = game.bestBurst; $('result-casts').textContent = game.stats.ultimateCasts; $('result-rewards').textContent = won ? settlement?.ok ? `获得：${resourcesCopy(settlement.rewards)}` : '奖励尚未记录，请导出存档备份' : '本次未扣除局外培养资源'; const notes = []; for (const id of settlement?.unlockedHeroes || []) notes.push(`${heroName(id)}加入英雄录 · 首次等级追赶`); for (const id of settlement?.unlockedCamps || []) notes.push(`${BALANCE.camps[id].name}已开放`); if (won && game.level.id === 'wei_002') notes.push('第二阵位已开放 · 可让曹操协战'); if (won && game.level.id === 'wei_008') notes.push('第三阵位已开放'); if (store.persistenceWarning) notes.push(store.persistenceWarning); $('result-unlocks').textContent = notes.join('\n'); const next = CONTENT.levels.find(l => l.globalIndex === game.level.globalIndex + 1); $('next-level').hidden = !won || !next || !store.isLevelUnlocked(next.id); }
function syncBattle(force = false) {
  if (!game || mode !== 'battle') return;
  const changed = force || previousState !== game.state; if (changed) resetClock();
  $('story-overlay').hidden = !storyVisible;
  $('pause-overlay').hidden = game.state !== 'paused'; $('choice-overlay').hidden = game.state !== 'choosing'; $('result-overlay').hidden = !['won','lost'].includes(game.state); $('camp-panel').hidden = selectedSlot < 0;
  $('pause-button').disabled = !['playing','paused'].includes(game.state); $('formation-button').disabled = game.state !== 'playing'; $('hp-value').textContent = `${Math.ceil(game.hp)} / ${game.maxHp}`; $('hp-fill').style.width = `${Math.max(0,game.hp / game.maxHp * 100)}%`; $('hp-fill').parentElement.setAttribute('aria-valuenow',String(Math.ceil(game.hp))); $('hp-fill').parentElement.setAttribute('aria-valuemax',String(game.maxHp)); $('battle-view').classList.toggle('is-critical',game.hp / game.maxHp < .3);
  $('food-value').textContent = Math.floor(game.food); $('enemy-count').textContent = game.activeEnemyCount; $('pending-count').textContent = `本波待入场 ${game.pendingEnemyCount}`; $('enemy-pressure').setAttribute('aria-label',`在场敌军${game.activeEnemyCount}人，本波待入场${game.pendingEnemyCount}人`); $('enemy-pressure').classList.toggle('is-dense',game.activeEnemyCount >= 35);
  $('wave-label').textContent = `第 ${Math.max(1,game.wave)} / ${game.waveCount} 波`; $('time-value').textContent = formatTime(game.time); $('field-hint').textContent = `${game.map.name} · ${game.map.rule.copy}`;
  const speed = tutorial.active ? 1 : store.state.settings.speed; $('speed-button').textContent = speed + '×'; $('speed-button').disabled = tutorial.active; $('speed-button').setAttribute('aria-label',tutorial.active ? '教学期间固定一倍速' : `当前${speed}倍速，点按切换`);
  $('threat-indicator').hidden = game.activeEnemyCount < 35 || tutorial.active || selectedSlot >= 0 || game.state !== 'playing'; $('threat-indicator').textContent = game.activeEnemyCount >= 70 ? '大军压境 · 准备无双' : '敌潮汇聚';
  for (const [id,key] of [['music-button','musicEnabled'],['sound-button','sfxEnabled']]) { $(id).classList.toggle('is-muted',!store.state.settings[key]); $(id).setAttribute('aria-pressed',String(store.state.settings[key])); }
  renderCommands();
  for (const hero of game.heroes) { const ui = commandNodes.get(hero.id); const canCast = game.state === 'playing' && hero.rage >= 100 - 1e-8 && hero.rageRecovery <= 1e-8 && !hero.reserved; ui.fill.style.width = Math.min(100,hero.rage) + '%'; ui.node.disabled = !canCast; ui.node.classList.toggle('is-ready',canCast); ui.sub.textContent = hero.reserved ? '技能排队中' : hero.rageRecovery > 0 ? `冷却 ${Math.ceil(hero.rageRecovery)} 秒` : canCast ? `预计覆盖 ${hero.target?.count || 0} 人` : `蓄怒 ${Math.floor(hero.rage)} / 100`; ui.state.textContent = hero.reserved ? '队列' : hero.rageRecovery > 0 ? '冷却' : canCast ? '就绪' : hero.auto ? '自动' : hero.role === 'lead' ? '领衔' : '协战'; ui.node.setAttribute('aria-label',`${hero.name} · ${hero.definition.ultimate.name} · ${hero.reserved ? '技能排队中' : hero.rageRecovery > 0 ? `冷却 ${Math.ceil(hero.rageRecovery)} 秒` : canCast ? '可施放' : `蓄怒 ${Math.floor(hero.rage)} / 100`}`); }
  const guideVisible = tutorial.active && game.state === 'playing' && selectedSlot < 0 && !storyVisible; $('tutorial-card').hidden = !guideVisible; const view = guideVisible ? tutorial.view : null; const guideKey = `${guideVisible}/${tutorial.step}/${tutorial.burstKills}`;
  if (guideKey !== tutorialKey && view) { $('tutorial-progress').textContent = `学习守关 · ${view.number} / 4`; $('tutorial-title').textContent = view.title; $('tutorial-copy').textContent = view.copy.replaceAll('关羽',game.heroes[0].name).replace('投石营轰击成群敌军。','投石营降低敌速，为无双留出空间。'); $('tutorial-action').textContent = view.action; $('tutorial-action').hidden = !view.action; $('tutorial-status').textContent = tutorial.freezesBattle ? '战斗已暂停 · 操作后继续' : '实战中 · 军阵自动迎敌'; } tutorialKey = guideKey; $('field-hint').hidden = guideVisible;
  if (game.state === 'choosing') renderChoices(); if (changed && ['won','lost'].includes(game.state)) renderResult(); previousState = game.state;
  syncAudio();
}
function syncAudio() { const active = !document.hidden && !pageSuspended; if (active !== audioActive) { audioActive = active; sound.setActive(active); } if (mode === 'lobby') sound.setScene('menu'); else sound.setScene(game?.state === 'playing' ? game.enemies.some(e => e.type === 'boss') ? 'boss' : 'battle' : game?.state === 'ready' ? 'pause' : game?.state || 'menu'); }
function togglePause() { if (!game || !['playing','paused'].includes(game.state)) return; selectedSlot = -1; game.state === 'paused' ? game.resume() : game.pause(); resetClock(); syncBattle(true); }
function battleCanAdvance() { return mode === 'battle' && game?.state === 'playing' && selectedSlot < 0 && !storyVisible && !tutorial.freezesBattle && !document.hidden && !pageSuspended && $('lobby-modal').hidden; }

for (const id of ['campaign','heroes','workshop','settings']) bind(id + '-tab',() => showTab(id));
bind('result-open-box',() => { if (settlement?.ok && settlement.loot?.item) { lootRevealed = true; renderResult(); } });
bind('campaign-start',() => enterBattle()); bind('modal-close',closeModal);
bind('setting-music',() => changeSetting('musicEnabled',!store.state.settings.musicEnabled)); bind('setting-sfx',() => changeSetting('sfxEnabled',!store.state.settings.sfxEnabled)); bind('setting-motion',() => changeSetting('reducedMotion',!store.state.settings.reducedMotion)); bind('setting-speed',() => changeSetting('speed',nextSpeed(store.state.settings.speed)));
bind('setting-guide',() => enterBattle(CONTENT.levels[0].id,true)); bind('save-export',showExport); bind('save-import',showImport);
$('guest-checkbox').addEventListener('change',() => { notify(store.setGuest(selectedLevelId,$('guest-checkbox').checked)); renderLevelDetail(); });
bind('story-start',beginCombat); bind('story-skip',beginCombat); bind('pause-button',togglePause); bind('resume-button',() => { game?.resume(); syncBattle(true); }); bind('restart-paused',() => enterBattle(game.level.id)); bind('retry-button',() => enterBattle(game.level.id)); bind('result-home',returnHome);
bind('leave-battle',() => { const body = openModal('结束本次演武？'); body.append(make('p','本局尚未完成的战斗不会获得奖励，已培养的武将与已完成的主线进度会保留。','modal-note')); const actions = make('div','','modal-actions'); actions.append(button('继续守关','',() => { closeModal(); game.resume(); syncBattle(true); }),button('返回军帐','',returnHome)); body.append(actions); });
bind('next-level',() => { const next = CONTENT.levels.find(l => l.globalIndex === game.level.globalIndex + 1); if (next) { returnHome(); selectedLevelId = next.id; selectedChapter = next.chapterId; renderCampaign(); } });
bind('formation-button',cycleCamp); bind('close-camp',closeCamp); bind('speed-button',() => { if (!tutorial.active) { changeSetting('speed',nextSpeed(store.state.settings.speed)); resetClock(); } }); bind('music-button',() => changeSetting('musicEnabled',!store.state.settings.musicEnabled)); bind('sound-button',() => changeSetting('sfxEnabled',!store.state.settings.sfxEnabled));
bind('tutorial-skip',() => finishTutorial(true)); bind('tutorial-action',() => { if (tutorial.step === 'intro') { tutorial.advance(); syncBattle(); } else if (tutorial.step === 'deploy') cycleCamp(); else if (tutorial.step === 'ultimate') cast(); else if (tutorial.step === 'complete') finishTutorial(); });
$('battle-canvas').addEventListener('pointerup',event => { if (mode !== 'battle') return; const slot = renderer.hitTest(event.clientX,event.clientY); if (slot >= 0) { void sound.unlock(); openCamp(slot); } else if (selectedSlot >= 0) closeCamp(); });
document.addEventListener('keydown',event => { if (event.code === 'Escape') { if (!$('lobby-modal').hidden) closeModal(); else if (selectedSlot >= 0) closeCamp(); else if (mode === 'battle') togglePause(); event.preventDefault(); } else if (mode === 'battle' && event.code === 'KeyP') { togglePause(); event.preventDefault(); } else if (mode === 'battle' && event.code === 'Space' && !/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) { cast(); event.preventDefault(); } });
document.addEventListener('visibilitychange',() => { resetClock(); if (document.hidden && game?.state === 'playing') { selectedSlot = -1; game.pause(); } syncAudio(); syncBattle(true); });
window.addEventListener('pagehide',() => { pageSuspended = true; resetClock(); if (game?.state === 'playing') game.pause(); sound.setActive(false); audioActive = false; store.save(); });
window.addEventListener('pageshow',() => { pageSuspended = false; resetClock(); audioActive = null; syncAudio(); syncBattle(true); }); window.addEventListener('resize',() => renderer.resize()); motionPreference.addEventListener('change',() => { renderer.reducedMotion = store.state.settings.reducedMotion || motionPreference.matches; if (renderer.reducedMotion) combatClock.clearImpact(); });

function frame(now) {
  const realDt = Math.max(0,(now-last) / 1000); last = now;
  try {
    combatClock.advance(realDt,tutorial.active ? 1 : store.state.settings.speed,battleCanAdvance,step => { game.update(step); tutorial.update({state:game.state,rage:game.rage,maxRage:100,enemyCount:game.activeEnemyCount}); });
    if (mode === 'battle' && game) { tutorial.update({state:game.state,rage:game.rage,maxRage:100,enemyCount:game.activeEnemyCount}); renderer.draw(game,{selectedSlot,realDt:Math.min(.1,realDt)}); elapsedUi += Math.min(.1,realDt); if (elapsedUi >= .08) { syncBattle(); elapsedUi = 0; } }
    else syncAudio();
  } catch (error) { $('fatal-message').hidden = false; $('fatal-message').textContent = '战场暂时无法继续。当前进度保留在军帐存档中，请刷新后再试。'; console.error(error); return; }
  requestAnimationFrame(frame);
}
renderCampaign(); syncAudio(); requestAnimationFrame(frame);
