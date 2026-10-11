import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(root,'docs','v1');
const sources=[['game','开发设计','game-development.md'],['art','美术与音频','art-design.md'],['balance','数值设计','balance-design.md'],['levels','关卡与剧情','level-design.md'],['growth','科技与装备','progression-design.md']];
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const markdownFiles=new Map(sources.map(([id,,file])=>[file,id]));
const safeHref=href=>/^(https?:\/\/|[a-zA-Z0-9_.#/-])/.test(href)&&!href.includes(':')||/^https?:\/\//.test(href);
function inline(text){
  const pieces=[];
  text=text.replace(/`([^`]+)`/g,(_,code)=>`\u0000${pieces.push('<code>'+escape(code)+'</code>')-1}\u0000`);
  text=escape(text).replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_,label,encoded)=>{
    const href=encoded.replace(/&amp;/g,'&');
    const file=href.split('#')[0];
    const doc=markdownFiles.get(file);
    if(doc)return `<a href="#${doc}" data-doc="${doc}">${label}</a>`;
    return safeHref(href)?`<a href="${escape(href)}"${/^https?:/.test(href)?' target="_blank" rel="noopener noreferrer"':''}>${label}</a>`:label;
  }).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  return text.replace(/\u0000(\d+)\u0000/g,(_,number)=>pieces[Number(number)]);
}
function cells(line){
  const result=[];let word='',inCode=false;
  for(const character of line.trim().replace(/^\|/,'').replace(/\|$/,'')){
    if(character==='`')inCode=!inCode;
    if(character==='|'&&!inCode){result.push(word.trim());word='';}else word+=character;
  }
  result.push(word.trim());return result;
}
function renderMarkdown(source,id){
  const lines=source.replace(/\r/g,'').split('\n'),html=[],toc=[],blocks=[];let i=0,n=0;
  const block=(tag,content,plain)=>{
    const key=`${id}-block-${++n}`;html.push(`<${tag} id="${key}">${content}</${tag}>`);
    if(plain)blocks.push({id:key,doc:id,text:plain});return key;
  };
  while(i<lines.length){
    const line=lines[i];if(!line.trim()){i++;continue;}
    const fence=line.match(/^\s*(```|~~~)(\w*)/);
    if(fence){const code=[];i++;while(i<lines.length&&!lines[i].trim().startsWith(fence[1]))code.push(lines[i++]);i++;block('pre',`<code>${escape(code.join('\n'))}</code>`);continue;}
    const heading=line.match(/^(#{1,6})\s+(.+)/);
    if(heading){const key=block(`h${heading[1].length}`,inline(heading[2]),heading[2]);if(heading[1].length<=3)toc.push({id:key,text:heading[2],depth:heading[1].length});i++;continue;}
    if(line.trim().startsWith('|')&&/^\s*\|?\s*:?-+/.test(lines[i+1]||'')){
      const header=cells(line);i+=2;const rows=[];
      while(i<lines.length&&lines[i].trim().startsWith('|'))rows.push(cells(lines[i++]));
      const key=`${id}-block-${++n}`;
      html.push(`<div class="table-wrap" id="${key}"><table><thead><tr>${header.map(cell=>`<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      for(const row of rows)blocks.push({id:key,doc:id,text:row.join(' · ')});continue;
    }
    const list=line.match(/^\s*(?:([-*])|\d+[.)])\s+(.+)/);
    if(list){const ordered=!list[1],items=[];while(i<lines.length&&/^\s*(?:[-*]|\d+[.)])\s+/.test(lines[i]))items.push(lines[i++].replace(/^\s*(?:[-*]|\d+[.)])\s+/,''));block(ordered?'ol':'ul',items.map(item=>`<li>${inline(item)}</li>`).join(''),items.join(' · '));continue;}
    const paragraph=[];
    while(i<lines.length&&lines[i].trim()&&!/^(#{1,6}\s|\s*(?:~~~|```|[-*]\s|\d+[.)]\s)|\s*\|)/.test(lines[i]))paragraph.push(lines[i++]);
    if(!paragraph.length)paragraph.push(lines[i++]);
    block('p',inline(paragraph.join(' ')),paragraph.join(' '));
  }
  return {html:html.join('\n'),toc,blocks};
}

const results=await Promise.all(sources.map(async([id,title,file])=>({id,title,file,...renderMarkdown(await readFile(path.join(dir,file),'utf8'),id)})));
const campaign=JSON.parse(await readFile(path.join(dir,'data','levels.json'),'utf8'));
const balance=JSON.parse(await readFile(path.join(dir,'data','balance.json'),'utf8'));
const board=(await readFile(path.join(dir,'art-style-board.svg'),'utf8')).replace(/<\?xml[^>]*\?>/g,'');
if(/<script\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/)/i.test(board))throw new Error('Style board must have no scripts or external resources');
const data={docs:results.map(({id,title,file,toc,blocks})=>({id,title,file,toc,blocks})),maps:campaign.maps,levels:campaign.levels.map(({id,chapterId,name,mapId,tacticalBrief,growthTierId,maxPartySize,unlockHeroId,waves,story})=>({id,chapterId,name,mapId,tacticalBrief,growthTierId,maxPartySize,unlockHeroId,count:waves.reduce((sum,wave)=>sum+wave.count,0),waveCount:waves.length,story:story.opening.map(line=>line.text).join(' ')})),heroes:Object.fromEntries(Object.entries(balance.v1Baseline.heroes).map(([id,hero])=>[id,hero.name])),updated:'2026-10-11'};
const json=JSON.stringify(data).replace(/</g,'\\u003c');
const html=`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>无双守关 · V1 设计文档</title>
<style>
:root{color-scheme:light;--ink:#203933;--green:#276b57;--gold:#b08a46;--paper:#f7f3e9;--muted:#66736a}*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--paper);font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;line-height:1.8}button,input,select{font:inherit}button,a,select{touch-action:manipulation}a{color:#246750;text-underline-offset:3px}button{cursor:pointer}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #b58c39;outline-offset:3px}[hidden]{display:none!important}
header{position:sticky;top:0;z-index:5;background:#203933;color:#f5ebcf;box-shadow:0 3px 15px #20393322}.bar{max-width:1460px;margin:auto;padding:16px 28px;display:flex;gap:20px;align-items:center;justify-content:space-between}.brand{font-size:22px;letter-spacing:2px;font-weight:700}.brand small{font-weight:400;font-size:12px;letter-spacing:1px;margin-left:12px;color:#d1c7aa}.search{display:flex;align-items:center;gap:10px}.search input{width:250px;min-height:44px;border:1px solid #526f63;border-radius:7px;background:#fffaf0;padding:6px 12px}.print{min-height:44px;padding:6px 15px;border:1px solid #a09b78;background:transparent;color:inherit;border-radius:7px}
nav{display:flex;max-width:1460px;margin:auto;gap:4px;padding:0 28px 10px;overflow-x:auto}nav button{white-space:nowrap;min-height:44px;border:0;color:#e8e1cc;padding:8px 17px;background:transparent;border-radius:7px}nav button[aria-pressed="true"]{background:#eedfb3;color:#203933}main{max-width:1460px;margin:auto;padding:28px;display:grid;grid-template-columns:242px minmax(0,1fr);gap:30px}aside{position:sticky;top:160px;align-self:start;max-height:calc(100vh - 185px);overflow:auto;font-size:13px;padding-right:14px}aside a{display:block;padding:5px 8px;border-radius:4px;text-decoration:none;line-height:1.5}aside a:hover{background:#e9e3d4}aside .indent{padding-left:20px;font-size:12px}.status{font-size:12px;border-left:3px solid var(--gold);padding:10px 12px;margin-bottom:18px;background:#eee8d9}.source{font-size:13px;margin:0 0 18px;color:var(--muted)}.sheet{max-width:1080px;background:#fffdf7;border:1px solid #e1dbca;border-radius:12px;padding:36px 42px;box-shadow:0 8px 30px #20393308;overflow-wrap:anywhere}h1{font-size:28px;line-height:1.5;margin-top:0}h2{font-size:22px;margin-top:42px;padding-bottom:8px;border-bottom:1px solid #dcd4bf}h3{font-size:17px;margin-top:26px;color:#276b57}p{margin:14px 0}li{margin:7px 0}.table-wrap{overflow:auto;margin:22px 0;border:1px solid #e1d9c7;border-radius:7px}table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.6}th{background:#e9e7da;color:#203933;font-weight:700;text-align:left;white-space:nowrap}th,td{padding:11px 12px;border-bottom:1px solid #e1dbc9;vertical-align:top}tr:last-child td{border-bottom:0}tr:nth-child(even){background:#f8f6ee}code{font-family:Consolas,monospace;font-size:.9em;background:#ecece2;border-radius:3px;padding:1px 4px}pre{background:#edf0e8;padding:20px;border-radius:8px;overflow:auto;font-size:13px;line-height:1.6}pre code{padding:0;background:none}.board{max-width:960px;margin:auto}.board svg{width:100%;height:auto}.map-layout{display:grid;grid-template-columns:minmax(230px,350px) minmax(0,1fr);gap:28px;margin-top:24px}.map{background:#849478;border-radius:12px;overflow:hidden}.map svg{display:block;width:100%;height:auto}.filters{display:flex;gap:12px;flex-wrap:wrap}select{max-width:100%;min-height:44px;border:1px solid #c5bca6;border-radius:7px;background:#fffdf7;color:var(--ink);padding:6px 10px}.badge{display:inline-block;padding:3px 9px;background:#e7ede0;border-radius:4px;font-size:13px;margin:0 8px 8px 0}.search-results{margin-bottom:24px}.result{display:block;text-align:left;width:100%;padding:14px 17px;border:1px solid #dad3c1;background:#fffdf7;border-radius:6px;margin-bottom:8px;color:var(--ink)}.result small{color:#66736a;display:block}.flash{animation:flash 2s ease-out}@keyframes flash{from{background:#efda8d}to{background:transparent}}footer{text-align:center;font-size:12px;color:#778076;padding:25px}
article [id]{scroll-margin-top:160px}
@media(max-width:900px){main{grid-template-columns:1fr;padding:18px}aside{position:static;max-height:190px;border-bottom:1px solid #d5cfbc;padding-bottom:14px}aside a{display:inline-block;max-width:300px}.sheet{padding:25px}.bar{padding:12px 18px}.brand small{display:block;margin-left:0}nav{padding:0 12px 8px}.search input{width:190px}.print{display:none}}
@media(max-width:540px){.bar{display:block}.search{margin-top:10px}.search input{width:100%}.search{width:100%}main{padding:12px;gap:16px}.sheet{padding:20px 16px}h1{font-size:23px}h2{font-size:20px}.map-layout{grid-template-columns:1fr}.map{max-width:300px;margin:auto;width:100%}aside{max-height:130px}.brand small{display:inline-block;margin-left:8px;font-size:10px}.status{margin-bottom:8px}.source{font-size:12px}th,td{padding:9px 10px}}
@media(max-width:540px){article [id]{scroll-margin-top:200px}}
@media print{header,aside,footer,.source,.search-results,.filters{display:none}body{background:white}main{display:block;padding:0}.sheet{border:0;box-shadow:none;padding:0;max-width:none}.table-wrap{overflow:visible}table{font-size:10px}h2,h3{break-after:avoid}tr{break-inside:avoid}a{color:inherit;text-decoration:none}}
@media(prefers-reduced-motion:reduce){.flash{animation:none;background:#f0e4b9}}
</style></head><body>
<header><div class="bar"><div class="brand">无双守关 <small>V1 可玩开发版文档 · 2026.10.11</small></div><div class="search"><label for="search" hidden>搜索五份文档</label><input id="search" type="search" aria-label="搜索五份文档" placeholder="搜索武将、装备、关卡…"><button class="print" id="print">打印当前文档</button></div></div><nav aria-label="设计内容">${sources.map(([id,title])=>`<button data-view="${id}" aria-pressed="false">${title}</button>`).join('')}<button data-view="maps" aria-pressed="false">关卡地图预览</button><button data-view="board" aria-pressed="false">美术风格板</button></nav></header>
<main><aside><div class="status">可玩开发版：15 将 · 60 关 · 12 地图 · 6 军营<br>最多三将 · 科技 · 锻造 · 专属装备 · 宝箱<br>引导 · 1× / 1.5× / 2× · WebAudio<br>原生 SVG / Canvas 素材；精修资源待生产<br>自动验证范围见交付记录；手机与 TapTap 未验收</div><div id="toc" aria-label="当前文档目录"></div></aside><div><div id="search-results" class="search-results" hidden aria-live="polite"></div>${results.map(doc=>`<article id="view-${doc.id}" class="sheet" hidden><div class="source">源文件：<a href="${doc.file}">${doc.file}</a> · 配置已接入 V1；目标与实测范围以交付记录为准</div>${doc.html}</article>`).join('')}
<article id="view-maps" class="sheet" hidden><h1>六十关 · 地图与故事预览</h1><p>十二个地图母版有实际路线与营位差异，已接入 V1 主线。选择关卡查看运行配置的地图、故事和波次摘要；本页为离线配置预览，实际通关证据与验收限制见交付记录。</p><div class="filters"><select id="chapter-select" aria-label="选择章节"><option value="wei">魏篇 · 以阵定北方</option><option value="shu">蜀篇 · 以义护山河</option><option value="wu">吴篇 · 以水固江东</option></select><select id="level-select" aria-label="选择关卡"></select></div><div class="map-layout"><div class="map" id="map-svg"></div><div id="map-copy"></div></div><p class="source">营位显示 1–8，配置 slot 从 0 起；后方领衔与两协战为位置参考，出战人数由该关限制。路线上颜色用于辨路，不表示额外地形加成。</p><p><a href="#levels" data-doc="levels">打开六十关逐关剧情与波次</a> · <a href="data/levels.json">原始关卡 JSON</a></p></article>
<article id="view-board" class="sheet" hidden><h1>美术方向 · 生产参考</h1><p>墨绿与金赭、三国武将轮廓、三将底栏、无双反馈与地图主题。风格板用于确定资源方向，精修美术仍待生产。</p><div class="board">${board}</div><p><a href="art-style-board.svg">可编辑 SVG</a> · <a href="art-style-board.png">PNG 风格板</a> · <a href="#art" data-doc="art">查看完整生产规范</a></p></article></div></main><footer>离线阅读器 · 无外部依赖 · 内容来源于同目录 Markdown 与设计数据 · 不上传输入</footer>
<script id="design-data" type="application/json">${json}</script>
<script>
const data=JSON.parse(document.getElementById('design-data').textContent);
const docNames=Object.fromEntries(data.docs.map(doc=>[doc.id,doc.title]));
let current='game';
function show(id,scroll=true){
  const anchorDoc=data.docs.find(doc=>id.startsWith(doc.id+'-block-')&&document.getElementById(id));
  const anchor=anchorDoc?id:null;if(anchorDoc)id=anchorDoc.id;
  if(!document.getElementById('view-'+id))id='game';current=id;
  document.querySelectorAll('article.sheet').forEach(article=>article.hidden=article.id!=='view-'+id);
  document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===id)));
  const toc=document.getElementById('toc');toc.replaceChildren();
  const doc=data.docs.find(doc=>doc.id===id);
  for(const heading of doc?.toc||[]){const link=document.createElement('a');link.href='#'+heading.id;link.textContent=heading.text;if(heading.depth===3)link.className='indent';link.onclick=event=>{event.preventDefault();show(heading.id,false);};toc.append(link);}
  history.replaceState(null,'','#'+(anchor||id));if(anchor)document.getElementById(anchor).scrollIntoView({block:'start'});else if(scroll)window.scrollTo(0,0);
}
window.addEventListener('hashchange',()=>show(location.hash.slice(1)||'game',false));
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>show(button.dataset.view));
document.querySelectorAll('[data-doc]').forEach(link=>link.onclick=event=>{event.preventDefault();show(link.dataset.doc);});
document.getElementById('print').onclick=()=>window.print();
const search=document.getElementById('search'),results=document.getElementById('search-results');
search.addEventListener('input',()=>{
  results.replaceChildren();const query=search.value.trim().toLocaleLowerCase();results.hidden=!query;if(!query)return;
  const matches=data.docs.flatMap(doc=>doc.blocks).filter(block=>block.text.toLocaleLowerCase().includes(query));
  const info=document.createElement('p');info.textContent='匹配 '+matches.length+' 条，显示前 24 条';results.append(info);
  for(const match of matches.slice(0,24)){
    const button=document.createElement('button');button.className='result';const label=document.createElement('small');label.textContent=docNames[match.doc];button.append(label);
    const index=match.text.toLocaleLowerCase().indexOf(query);button.append(document.createTextNode((index>40?'…':'')+match.text.slice(Math.max(0,index-40),index+140)));
    button.onclick=()=>{search.value='';results.hidden=true;show(match.id,false);const target=document.getElementById(match.id);target.scrollIntoView({block:'center'});target.classList.remove('flash');void target.offsetWidth;target.classList.add('flash');};results.append(button);
  }
});
const chapterSelect=document.getElementById('chapter-select'),levelSelect=document.getElementById('level-select');
const colors=['#d4e7b8','#e8cc89','#94dbd7'];
function renderMap(){
  const level=data.levels.find(level=>level.id===levelSelect.value),map=data.maps.find(map=>map.id===level.mapId);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 -20 420 620');svg.setAttribute('role','img');svg.setAttribute('aria-label',map.name+'路线与营位');
  const element=(name,attributes,text)=>{const node=document.createElementNS(svg.namespaceURI,name);Object.entries(attributes).forEach(([key,value])=>node.setAttribute(key,String(value)));if(text)node.textContent=text;svg.append(node);return node;};
  element('rect',{x:0,y:-20,width:420,height:620,fill:'#839272'});
  map.paths.forEach((points,index)=>{const path=points.map((point,i)=>(i?'L':'M')+point.x+' '+point.y).join(' ');element('path',{d:path,fill:'none',stroke:'#486951','stroke-width':38,'stroke-linejoin':'round'});element('path',{d:path,fill:'none',stroke:colors[index],'stroke-width':25,'stroke-linejoin':'round'});element('text',{x:points[0].x,y:27,fill:'#203933','font-size':18,'font-weight':'bold','text-anchor':'middle'},'入口'+(index+1));});
  map.campSlots.forEach(slot=>{element('circle',{cx:slot.x,cy:slot.y,r:26,fill:'#203933',stroke:'#e4c27a','stroke-width':3});element('text',{x:slot.x,y:slot.y+7,fill:'#eedfb3','font-size':20,'text-anchor':'middle'},String(slot.slot+1));});
  element('rect',{x:152,y:510,width:116,height:25,rx:4,fill:'#203933'});element('text',{x:210,y:529,fill:'#eedfb3','font-size':16,'text-anchor':'middle'},'城关');
  map.heroSlots.forEach((hero,index)=>{element('circle',{cx:hero.x,cy:hero.y+10,r:index?19:22,fill:'#276b57',stroke:'#e4c27a','stroke-width':2});element('text',{x:hero.x,y:hero.y+16,fill:'#fff4ce','font-size':14,'text-anchor':'middle'},index?'协':'领');});
  document.getElementById('map-svg').replaceChildren(svg);
  const copy=document.getElementById('map-copy');copy.replaceChildren();const title=document.createElement('h2');title.textContent=level.id+' '+level.name;title.style.marginTop='0';copy.append(title);
  for(const value of [map.name,map.paths.length+'条路 / '+map.campSlots.length+'营位',level.growthTierId+' / 最多'+level.maxPartySize+'将',level.waveCount+'波 / 常规敌兵'+level.count]){const badge=document.createElement('span');badge.className='badge';badge.textContent=value;copy.append(badge);}
  for(const value of ['战术目标：'+level.tacticalBrief,'地图规则：'+map.rule.copy,'开场剧情：'+level.story,level.unlockHeroId?'首通解锁：'+data.heroes[level.unlockHeroId]:'首通推进英雄录与下一关']){const paragraph=document.createElement('p');paragraph.textContent=value;copy.append(paragraph);}
}
function updateLevels(){levelSelect.replaceChildren();data.levels.filter(level=>level.chapterId===chapterSelect.value).forEach(level=>{const option=document.createElement('option');option.value=level.id;option.textContent=level.id+' '+level.name;levelSelect.append(option);});renderMap();}
chapterSelect.onchange=updateLevels;levelSelect.onchange=renderMap;updateLevels();show(location.hash.slice(1)||'game',false);
</script></body></html>`;
await writeFile(path.join(dir,'index.html'),html,'utf8');
console.log(`Built offline design reader: ${sources.length} documents, ${data.levels.length} levels, ${data.maps.length} maps, ${Math.round(Buffer.byteLength(html)/1024)} KB.`);
