import { BALANCE } from './runtime-data.js';
import { equipmentIcon } from './equipment-art.js';
import { heroPortrait } from './hero-portraits.js';

const slots = { weapon:'武器', armor:'铠甲', command_token:'兵符', horse:'战马' };
const colors = { white:'#d9d6c3', blue:'#5fb2ff', purple:'#b98cff', red:'#ff6b57', gold:'#ffc940' };
const element = (tag, className, text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };

/** Shared, non-interactive equipment art; its containing button owns the action. */
export function gearTile(item, { size = 64, showOwner = true, showExclusive = true, owner = null, heroId = null, slot = null } = {}) {
  const tile = element('span', `gear-tile gear-tile-${[56,64,96].includes(size) ? size : 64}`);
  tile.setAttribute('role','img');
  if (!item) {
    tile.classList.add('is-empty'); tile.textContent = '＋';
    tile.setAttribute('aria-label',`${slots[slot] || '装备'}空槽，未装备`);
    return tile;
  }
  const definition = BALANCE.metaProgression.equipment.templates[item.templateId];
  const ownerId = typeof owner === 'string' ? owner : owner?.heroId || owner?.id || item.equippedHeroId;
  const wearer = ownerId ? BALANCE.heroes[ownerId]?.name || '武将' : null;
  const quality = BALANCE.metaProgression.equipment.qualityNames[item.quality] || '白';
  const exclusive = definition?.exclusiveHeroId && definition.exclusiveHeroId === (heroId || ownerId);
  tile.classList.add(`quality-${item.quality}`);
  tile.style.setProperty('--quality-color',colors[item.quality] || colors.white);
  tile.setAttribute('data-quality',item.quality);
  tile.setAttribute('aria-label',`${definition?.name || slots[item.slot] || '装备'}，${quality}色，强化等级 ${item.level || 0}，${wearer ? wearer + '穿戴中' : '闲置未穿戴'}${exclusive ? '，本人专属' : ''}`);
  const art = element('img','gear-tile-art'); art.alt = ''; art.src = equipmentIcon(item.templateId || `basic_${item.slot || slot || 'weapon'}`,item.quality);
  const level = element('span','gear-tile-level',`+${item.level || 0}`); level.setAttribute('aria-hidden','true');
  tile.append(art,level);
  if (showOwner && ownerId) {
    const badge = element('span','gear-tile-owner'), face = element('img',''); face.alt = ''; face.src = heroPortrait(ownerId);
    badge.setAttribute('aria-hidden','true'); badge.append(face); tile.append(badge);
  }
  if (showExclusive && exclusive) { const badge = element('span','gear-tile-exclusive','专'); badge.setAttribute('aria-hidden','true'); tile.append(badge); }
  return tile;
}
