import { Game, CAMP_TYPES } from './game-engine.js';
import { Renderer } from './renderer.js';
import { AudioSystem } from './audio-system.js';
import { TutorialController } from './tutorial.js';
import { CombatClock, readSpeedPreference, saveSpeedPreference, nextSpeed } from './combat-clock.js';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries([
  'battle-canvas','hp-value','hp-fill','food-value','wave-label','time-value','sound-button','music-button','pause-button','speed-button',
  'enemy-count','pending-count','enemy-pressure','threat-indicator',
  'intro-overlay','start-button','pause-overlay','resume-button','restart-paused','choice-overlay','upgrade-choices',
  'result-overlay','result-title','result-copy','result-kicker','result-kills','result-burst','result-casts','record-note','retry-button',
  'camp-panel','camp-title','camp-index-label','camp-options','close-camp','formation-button','command-hint',
  'ultimate-button','rage-fill','rage-label','ultimate-state','toast','wave-banner','burst-number','field-hint','fatal-message',
  'tutorial-card','tutorial-progress','tutorial-title','tutorial-copy','tutorial-status','tutorial-action','tutorial-skip','learn-button','relearn-button'
].map(id => [id, $(id)]));
const names = ['左前营位','右前营位','左中营位','右中营位','左后营位','右后营位'];
const glyphs = { shield:'盾', archer:'弓', catapult:'石' };
const recordKey = 'wushuang-guard-v1';
let record = {bestBurst:0,bestKills:0,wins:0,musicEnabled:true,sfxEnabled:true,tutorialVersion:0,tutorialCompleted:false};
try {
  const saved = JSON.parse(localStorage.getItem(recordKey) || 'null');
  if (saved && typeof saved === 'object') {
    for (const key of ['bestBurst','bestKills','wins']) if (Number.isFinite(saved[key]) && saved[key] >= 0) record[key] = saved[key];
    if (typeof saved.sound === 'boolean') record.musicEnabled = record.sfxEnabled = saved.sound;
    for (const key of ['musicEnabled','sfxEnabled','tutorialCompleted']) if (typeof saved[key] === 'boolean') record[key] = saved[key];
    if (saved.tutorialVersion === 1) record.tutorialVersion = 1;
  }
} catch { /* Browser storage is optional. */ }
const saveRecord = () => { try { localStorage.setItem(recordKey, JSON.stringify(record)); } catch { /* Storage may be disabled. */ } };

const sound = new AudioSystem({musicEnabled:record.musicEnabled,sfxEnabled:record.sfxEnabled});
const tutorial = new TutorialController();
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const renderer = new Renderer(ui['battle-canvas'], {reducedMotion:reduceMotion.matches});
let selectedSlot = -1;
let formationCursor = 2;
let previousState = null;
let choicesKey = '';
let toastTimer, bannerTimer, burstTimer;
let elapsedUi = 0;
let tutorialKey = '';
let audioActive = null;
let preferredSpeed = readSpeedPreference();
const combatClock = new CombatClock();
let pageSuspended = false;
let last = performance.now();

const effectiveSpeed = () => tutorial.active ? 1 : preferredSpeed;
const battleCanAdvance = () => game.state === 'playing' && selectedSlot < 0 && !tutorial.freezesBattle && !document.hidden && !pageSuspended;
function resetCombatClock() {
  combatClock.reset();
  last = performance.now();
}

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('is-visible'),1900);
}
function banner(text) {
  ui['wave-banner'].textContent = text;
  ui['wave-banner'].classList.add('is-visible');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => ui['wave-banner'].classList.remove('is-visible'),1800);
}

const game = new Game({onEvent(event) {
  tutorial.handleEvent(event);
  sound.handleEvent(event);
  if (event.type === 'ultimate') {
    renderer.flashUltimate(event);
  } else if (event.type === 'burst') {
    const count = event.kills ?? event.count ?? 0;
    ui['burst-number'].textContent = count ? `横扫 ${count}` : '刀锋破阵';
    ui['burst-number'].classList.add('is-visible');
    clearTimeout(burstTimer);
    burstTimer = setTimeout(() => ui['burst-number'].classList.remove('is-visible'),1200);
  } else if (event.type === 'wave') {
    banner(event.boss ? '敌将压境' : `第 ${event.wave} 波 · 来袭`);
  } else if (event.type === 'tactic') {
    toast(`战术已强化 · ${event.upgrade.name}`);
  } else if (event.type === 'win' || event.type === 'lose') {
    record.bestBurst = Math.max(record.bestBurst,game.bestBurst);
    record.bestKills = Math.max(record.bestKills,game.kills);
    if (event.type === 'win') record.wins++;
    saveRecord();
  }
}});

function startBattle(forceTutorial = false) {
  selectedSlot = -1;
  formationCursor = 2;
  sound.unlock();
  game.reset();
  tutorial.reset(forceTutorial === true || record.tutorialVersion < 1);
  resetCombatClock();
  tutorialKey = '';
  sound.setScene('battle');
  game.start();
  previousState = null;
  choicesKey = '';
  ui['burst-number'].classList.remove('is-visible');
  ui['field-hint'].classList.remove('is-quiet');
  if (!tutorial.active) toast('已部署盾营和弓营 · 点营位补齐防线');
  syncUI(true);
}

function closeCamp() {
  selectedSlot = -1;
  resetCombatClock();
  ui['camp-panel'].hidden = true;
  syncUI();
}
function openCamp(slot) {
  if (game.state !== 'playing') return;
  selectedSlot = slot;
  resetCombatClock();
  formationCursor = slot;
  const camp = game.camps[slot];
  ui['camp-panel'].hidden = false;
  ui['camp-index-label'].textContent = names[slot];
  ui['camp-title'].textContent = camp ? `${CAMP_TYPES[camp.type].name} · ${camp.level}级` : '部署军阵';
  ui['camp-options'].replaceChildren();
  if (camp) {
    const cost = game.getUpgradeCost(slot);
    if (cost === null) {
      const label = document.createElement('div');
      label.className = 'max-level'; label.textContent = '军阵已满级 · 守住这条战线';
      ui['camp-options'].append(label);
    } else {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'camp-option upgrade-camp';
      button.disabled = game.food < cost;
      const title = document.createElement('strong'); title.textContent = `升级至 ${camp.level + 1} 级`;
      const subtitle = document.createElement('small'); subtitle.textContent = `${cost} 军粮 · 提升攻击与攻速`;
      button.append(title,subtitle);
      button.addEventListener('click', () => {
        const result = game.upgrade(slot);
        if (result.ok) { toast(`${CAMP_TYPES[camp.type].name}升至 ${camp.level} 级`); closeCamp(); }
        else toast(result.reason);
      });
      ui['camp-options'].append(button);
    }
  } else {
    for (const [type,data] of Object.entries(CAMP_TYPES)) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'camp-option'; button.disabled = game.food < data.cost;
      const glyph = document.createElement('span'); glyph.className = 'camp-glyph'; glyph.textContent = glyphs[type]; glyph.setAttribute('aria-hidden','true');
      const name = document.createElement('strong'); name.textContent = data.name;
      const detail = document.createElement('small'); detail.textContent = {shield:'拦敌聚怪',archer:'远程齐射',catapult:'范围轰击'}[type];
      const cost = document.createElement('span'); cost.className = 'camp-cost'; cost.textContent = `${data.cost} 军粮`;
      button.append(glyph,name,detail,cost);
      button.addEventListener('click', () => {
        const result = game.build(slot,type);
        if (result.ok) { toast(`${data.name}已部署`); closeCamp(); }
        else toast(result.reason);
      });
      ui['camp-options'].append(button);
    }
  }
  syncUI();
}

function renderChoices() {
  const key = game.upgradeChoices.map(choice => choice.id).join('|');
  if (key === choicesKey) return;
  choicesKey = key;
  ui['upgrade-choices'].replaceChildren();
  for (const choice of game.upgradeChoices) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'upgrade-choice';
    const name = document.createElement('strong'); name.textContent = choice.name;
    const description = document.createElement('span'); description.textContent = choice.description;
    button.append(name,description);
    button.addEventListener('click', () => {
      const result = game.selectUpgrade(choice.id);
      if (!result.ok) toast(result.reason);
      resetCombatClock();
      syncUI(true);
    });
    ui['upgrade-choices'].append(button);
  }
}

function syncUI(force = false) {
  const state = game.state;
  const changed = force || state !== previousState;
  if (changed) resetCombatClock();
  if (state !== 'playing') selectedSlot = -1;
  ui['intro-overlay'].hidden = state !== 'ready';
  ui['pause-overlay'].hidden = state !== 'paused';
  ui['choice-overlay'].hidden = state !== 'choosing';
  ui['result-overlay'].hidden = state !== 'won' && state !== 'lost';
  ui['camp-panel'].hidden = selectedSlot < 0;
  ui['pause-button'].disabled = !['playing','paused'].includes(state);
  ui['pause-button'].setAttribute('aria-label',state === 'paused' ? '继续战斗' : '暂停战斗');
  ui['formation-button'].disabled = state !== 'playing';
  ui['hp-value'].textContent = `${Math.ceil(game.hp)} / ${game.maxHp}`;
  ui['hp-fill'].style.width = `${Math.max(0,game.hp / game.maxHp * 100)}%`;
  ui['hp-fill'].parentElement.setAttribute('aria-valuenow',String(Math.max(0,Math.ceil(game.hp))));
  document.querySelector('.game-shell').classList.toggle('is-critical',game.hp <= 30);
  ui['food-value'].textContent = String(Math.floor(game.food));
  const enemyCount = game.activeEnemyCount ?? game.enemies.filter(enemy => enemy.hp > 0 && !enemy.escaped).length;
  const pendingCount = game.pendingEnemyCount ?? game._spawnQueue?.length ?? 0;
  ui['enemy-count'].textContent = String(enemyCount);
  ui['pending-count'].textContent = `本波待入场 ${pendingCount}`;
  ui['enemy-pressure'].setAttribute('aria-label',`在场敌军 ${enemyCount} 人，本波待入场 ${pendingCount} 人`);
  const pressure = state === 'playing' && enemyCount >= 35;
  ui['enemy-pressure'].classList.toggle('is-dense',pressure);
  ui['threat-indicator'].hidden = !pressure || tutorial.active || selectedSlot >= 0;
  ui['threat-indicator'].textContent = enemyCount >= 70 ? '大军压境 · 准备无双' : '敌潮汇聚';
  const speed = effectiveSpeed();
  ui['speed-button'].textContent = `${speed}×`;
  ui['speed-button'].disabled = tutorial.active;
  ui['speed-button'].dataset.speed = String(speed);
  ui['speed-button'].setAttribute('aria-label',tutorial.active ? `教学期间固定 1 倍速，结束后恢复 ${preferredSpeed} 倍速` : `当前 ${speed} 倍速，点击切换到 ${nextSpeed(preferredSpeed)} 倍速`);
  ui['speed-button'].setAttribute('title',tutorial.active ? `引导固定 1× · 结束恢复 ${preferredSpeed}×` : '战斗速度：1× → 1.5× → 2×');
  ui['wave-label'].textContent = state === 'ready' ? '准备迎战' : `第 ${game.wave} / ${game.waveCount} 波`;
  const seconds = Math.floor(game.time);
  ui['time-value'].textContent = `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  const rage = Math.min(100,Math.floor(game.rage));
  const ready = rage >= game.maxRage && state === 'playing';
  ui['rage-fill'].style.width = `${rage}%`;
  ui['rage-label'].textContent = ready ? `刀波就绪 · 预计覆盖 ${game.ultimateTarget?.count || 0} 人` : game.rageRecovery > 0 ? `收势 ${Math.ceil(game.rageRecovery)} 秒 · 蓄怒 ${rage} / 100` : `蓄怒 ${rage} / 100`;
  ui['ultimate-button'].disabled = !ready;
  ui['ultimate-button'].classList.toggle('is-ready',ready);
  ui['ultimate-button'].setAttribute('aria-label',ready ? '释放关羽武圣无双，自动攻击密集敌群' : `关羽武圣无双，蓄怒 ${rage} / 100`);
  ui['ultimate-state'].textContent = ready ? '点按横扫' : state === 'paused' ? '暂停' : state === 'choosing' ? '整军' : '蓄势';
  ui['command-hint'].textContent = selectedSlot >= 0 ? '布阵中 · 战斗已暂停' : ready ? '敌潮已聚，正是破阵之时' : game.food >= 60 && state === 'playing' ? `有 ${Math.floor(game.food)} 军粮 · 可建造或升级` : '怒气就绪后，点按主将横扫敌军';
  if (game.time > 12) ui['field-hint'].classList.add('is-quiet');
  if (state === 'choosing') renderChoices();
  syncTutorial();
  const scene = state === 'playing' ? (selectedSlot >= 0 || tutorial.freezesBattle ? 'choosing' : game.wave === game.waveCount ? 'boss' : 'battle') : state === 'ready' ? 'menu' : state === 'paused' ? 'pause' : state === 'choosing' ? 'choosing' : 'result';
  sound.setScene(scene);
  const active = !document.hidden && !pageSuspended && state !== 'paused';
  if (active !== audioActive) { audioActive = active; sound.setActive(active); }
  if (changed && (state === 'won' || state === 'lost')) {
    ui['result-title'].textContent = state === 'won' ? '城关，守住了。' : '来日，再战。';
    ui['result-kicker'].textContent = state === 'won' ? '武圣守关 · 大获全胜' : `第 ${game.wave} 波 · 防线失守`;
    ui['result-copy'].textContent = state === 'won' ? '敌潮已退，青龙偃月仍在。' : '补齐两路军阵，把无双留给密集敌潮。';
    ui['result-kills'].textContent = String(game.kills);
    ui['result-burst'].textContent = String(game.bestBurst);
    ui['result-casts'].textContent = String(game.stats?.casts || 0);
    ui['record-note'].textContent = `你的最佳横扫纪录 · ${record.bestBurst} 人`;
  }
  if (changed) {
    if (state === 'choosing') ui['upgrade-choices'].querySelector('button')?.focus({preventScroll:true});
    if (state === 'paused') ui['resume-button'].focus({preventScroll:true});
    if (state === 'won' || state === 'lost') ui['retry-button'].focus({preventScroll:true});
  }
  previousState = state;
}

function syncTutorial() {
  const visible = tutorial.active && game.state === 'playing' && selectedSlot < 0;
  ui['tutorial-card'].hidden = !visible;
  const view = visible ? tutorial.view : null;
  const key = `${visible}/${tutorial.step}/${tutorial.burstKills}`;
  if (key !== tutorialKey && view) {
    ui['tutorial-card'].dataset.step = tutorial.step;
    ui['tutorial-progress'].textContent = `学习守关 · ${view.number} / 4`;
    ui['tutorial-title'].textContent = view.title;
    ui['tutorial-copy'].textContent = view.copy;
    ui['tutorial-action'].textContent = view.action;
    ui['tutorial-action'].hidden = !view.action;
    ui['tutorial-status'].textContent = tutorial.freezesBattle ? '战斗已暂停 · 操作后继续' : '实战中 · 军阵自动迎敌';
  }
  tutorialKey = key;
  ui['hp-fill'].parentElement.classList.toggle('is-tutorial-target',view?.target === 'hp');
  ui['formation-button'].classList.toggle('is-tutorial-target',view?.target === 'formation');
  ui['ultimate-button'].classList.toggle('is-tutorial-target',['rage','ultimate'].includes(view?.target));
  ui['field-hint'].hidden = visible;
}

function finishTutorial(skipped = false) {
  tutorial.skip();
  record.tutorialVersion = 1;
  record.tutorialCompleted = !skipped;
  saveRecord();
  closeCamp();
  const restored = preferredSpeed !== 1 ? ` · 已恢复 ${preferredSpeed}×` : '';
  toast((skipped ? '引导已跳过' : '已学会守关') + restored + ' · 暂停菜单可重开学习');
}

function cast() {
  if (game.state !== 'playing') return;
  closeCamp();
  sound.unlock();
  const result = game.castUltimate();
  if (!result.ok) toast(result.reason);
  syncUI();
}
function togglePause() {
  closeCamp();
  if (game.state === 'paused') game.resume();
  else if (game.state === 'playing') game.pause();
  syncUI(true);
}

ui['start-button'].addEventListener('click',() => startBattle());
ui['retry-button'].addEventListener('click',() => startBattle());
ui['restart-paused'].addEventListener('click',() => startBattle());
ui['learn-button'].addEventListener('click',() => startBattle(true));
ui['relearn-button'].addEventListener('click',() => startBattle(true));
ui['tutorial-skip'].addEventListener('click',() => { sound.click(); finishTutorial(true); });
ui['tutorial-action'].addEventListener('click',() => {
  sound.unlock(); sound.click();
  if (tutorial.step === 'intro') { tutorial.advance(); syncUI(); }
  else if (tutorial.step === 'deploy') {
    const empty = game.camps.findIndex((camp,index) => !camp && index >= 3);
    openCamp(empty >= 0 ? empty : game.camps.findIndex(camp => !camp));
  }
  else if (tutorial.step === 'ultimate') cast();
  else if (tutorial.step === 'complete') finishTutorial();
});
ui['resume-button'].addEventListener('click',() => { game.resume(); syncUI(true); });
ui['pause-button'].addEventListener('click',togglePause);
ui['ultimate-button'].addEventListener('click',cast);
ui['close-camp'].addEventListener('click',closeCamp);
ui['formation-button'].addEventListener('click',() => openCamp((formationCursor + 1) % 6));
ui['battle-canvas'].addEventListener('pointerup',event => {
  const slot = renderer.hitTest(event.clientX,event.clientY);
  if (slot >= 0) { sound.unlock(); openCamp(slot); }
  else if (selectedSlot >= 0) closeCamp();
});
ui['sound-button'].addEventListener('click',() => {
  record.sfxEnabled = !record.sfxEnabled;
  sound.setPreferences(record);
  if (record.sfxEnabled) { sound.unlock(); sound.click(); }
  updateSound(); saveRecord();
});
ui['music-button'].addEventListener('click',() => {
  record.musicEnabled = !record.musicEnabled;
  sound.setPreferences(record);
  if (record.musicEnabled) sound.unlock();
  updateSound(); saveRecord();
});
ui['speed-button'].addEventListener('click',() => {
  if (tutorial.active) return;
  preferredSpeed = saveSpeedPreference(nextSpeed(preferredSpeed));
  resetCombatClock();
  sound.click();
  toast(`战斗速度 ${preferredSpeed}× · 音乐与音效保持原速`);
  syncUI();
});
function updateSound() {
  for (const [id,key,name] of [['sound-button','sfxEnabled','音效'],['music-button','musicEnabled','音乐']]) {
    ui[id].classList.toggle('is-muted',!record[key]);
    ui[id].setAttribute('aria-pressed',String(record[key]));
    ui[id].setAttribute('aria-label',record[key] ? `关闭${name}` : `开启${name}`);
  }
}
document.addEventListener('keydown',event => {
  if (event.code === 'Escape') {
    if (selectedSlot >= 0) closeCamp(); else if (['playing','paused'].includes(game.state)) togglePause();
    event.preventDefault();
  } else if (event.code === 'KeyP' && ['playing','paused'].includes(game.state)) {
    togglePause(); event.preventDefault();
  } else if (event.code === 'Space' && !/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) {
    if (game.state === 'playing') cast(); event.preventDefault();
  }
});
document.addEventListener('visibilitychange',() => {
  resetCombatClock();
  if (document.hidden && game.state === 'playing') { selectedSlot = -1; game.pause(); syncUI(true); }
  else syncUI();
});
window.addEventListener('pagehide',() => { pageSuspended = true; resetCombatClock(); audioActive = false; sound.setActive(false); });
window.addEventListener('pageshow',() => { pageSuspended = false; resetCombatClock(); audioActive = null; syncUI(true); });
window.addEventListener('resize',() => renderer.resize());
reduceMotion.addEventListener('change',event => { renderer.reducedMotion = event.matches; });

function frame(now) {
  const dt = Math.max(0,(now-last)/1000);
  last = now;
  try {
    combatClock.advance(dt,effectiveSpeed(),battleCanAdvance,step => {
      game.update(step);
      tutorial.update({state:game.state,rage:game.rage,maxRage:game.maxRage,enemyCount:game.enemies.length});
    });
    tutorial.update({state:game.state,rage:game.rage,maxRage:game.maxRage,enemyCount:game.enemies.length});
    renderer.render(game,{selectedSlot});
    elapsedUi += Math.min(.1,dt);
    if (elapsedUi >= .08) { syncUI(); elapsedUi = 0; }
  } catch (error) {
    ui['fatal-message'].hidden = false;
    ui['fatal-message'].textContent = '战场暂时无法加载，请刷新页面后再试。';
    console.error(error);
    return;
  }
  requestAnimationFrame(frame);
}
updateSound();
syncUI(true);
requestAnimationFrame(frame);
