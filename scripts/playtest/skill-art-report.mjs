// Build a local review record from completed checks; no runtime asset depends on it.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeAtomic} from '../write-atomic.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=path.join(root,'docs/v1/playtest/skill-art');
const json=name=>readFile(path.join(out,name),'utf8').then(JSON.parse);
const [campaign,performance,art,browser,offline,tests]=await Promise.all([
  json('campaign-comparison.json'),json('render-performance.json'),json('art-fixtures-report.json'),json('report.json'),json('offline-report.json'),readFile(path.join(out,'tests.log'),'utf8')
]);
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const files={
  '技能规则与数据':['docs/v1/data/balance.json','runtime-data.js','skill-targeting.js','v1-engine.js'],
  '战场美术与姓名交互':['hero-portraits.js','battle-sprites.js','v1-renderer.js','hero-name-cards.js','campaign-app.js','battle-art.css'],
  '详情文案、字体与打包':['hero-skill-copy.js','hero-detail.css','assets/fonts/brush-subset.woff2','brush-font.css','index.html','scripts/build.mjs'],
  '同步文档':['docs/v1/art-design.md','docs/v1/balance-design.md','docs/v1/game-development.md','docs/v1/progression-design.md','docs/v1/index.html','docs/ASSET_LICENSES.md','docs/v1/data/playable-audit.json'],
  '测试':['tests/v1-engine.test.js','tests/skill-targeting.test.js','tests/v1-renderer.test.js','tests/design-data.test.js','tests/campaign-app.test.js','tests/v1-skills-redesign.test.js','tests/battle-sprites.test.js','tests/hero-name-cards.test.js','tests/hero-skill-copy.test.js'],
  '可复现验收脚本':['scripts/playtest/compare-skill-campaign.mjs','scripts/playtest/renderer-benchmark.html','scripts/playtest/renderer-benchmark.mjs','scripts/playtest/skill-art-fixtures.html','scripts/playtest/skill-art-fixtures.mjs','scripts/playtest/skill-art-offline.mjs','scripts/playtest/skill-art-report.mjs']
};
const assertionChanges=[
  '单圆三角覆盖测试改用夏侯惇、曹操、诸葛亮；周瑜火带、甘宁箭雨带及司马懿三圆以新增专项测试补足，仍验证最优圆心可位于敌人之间。',
  '司马懿圆形人数优先断言由单圆总覆盖变为三圆总覆盖；保留首雷优先覆盖两士兵的断言，并增加去重计分与圆心间距检查。',
  'skill-targeting 的固定本体圆断言改为夏侯惇可达跳点、曹操全图投旗、刘备/孙权固定城门；原三矢不同目标断言保留。',
  'v1-engine 的固定本体圆断言同样迁移为新选点策略；司马懿施放后锁定世界坐标的检查保留。',
  '周瑜不受地图修正的半径断言改为火带宽度与长度，另验证连营火势只增加宽度24；16跳上限保持。',
  '五首领互异的绘图断言由主画布路径迁移到 drawImage 引用的离屏缓存路径；补充确实使用缓存的断言，仍要求五种绘图互异。',
  '原伤害标签精确文本断言改为逐个标签独立绘制核对同样三段真实数值；新增同时绘制的密度避让测试，确认事件与受击闪光记录不丢失，仅不绘制重叠文字。'
];
const fixes=[
  '修正许褚渲染轮廓/裁剪遗留70°默认值，实际读取75°定义。',
  '许褚命中后的锤头改为朝前下保持，再收回，避免已造成伤害却仍像举锤蓄力。',
  '伤害标签按敌人去重并限制同屏密度，避免连续跳伤数字叠成66、遮住令旗/火船/箭雨；实际受击闪光与伤害事件保持。',
  '移除正好悬在关羽头顶的城门“关”字装饰，避免误认为角色头顶标记。',
  '曹操冲击后仅保留旗帜计时；孙权浪头结束后仅保留水障，避免六秒增益被看成持续伤害。',
  '专项夹具先等入场淡入完成再施放/减速，密潮图呈现存活兵群；夹具只用于画面复核，正式浏览器审计仍走实际UI。',
  '补入书法字体缺少的“拔、才”，并把引导跳过文字提升到12 CSS px。',
  '详情示意图的范围外敌人保持静态，不再统一闪成受击色。'
];
const scope=[
  '保留原伤害、斩杀条件、击退、增益、怒气及每敌命中上限；夏侯惇仅按已确认决定在跳出0.9秒内暂停普攻。',
  '刘备与孙权伤害前沿分别在0.6/0.4秒结束；许褚保持即时伤害。样机中的延后起步、延后回血/砸地按用户硬约束处理，演出不添加伤害延迟。',
  '曹操旗与孙权水障从施放起共6秒，与即时生效增益同时结束。夏侯惇沿原道路击退，不增加样机示意中的径向控制规则。',
  '司马懿0.3秒指画是施法出手，1秒才落雷，动作锁仍0.9秒；吕蒙0秒布雷，命中由敌人接近触发。其他即时技能与前锋在首帧进入出手姿势。',
  '内置浏览器工具拒绝打开本地file协议设计稿；已直接读取两份完整HTML及绘图/动作源码，对照实机截图。没有把源码阅读声称为浏览器播放验收。',
  '文案待审：hero-skill-copy.js 顶部标记及八条 description/tags；五个新技能名同时写入balance数据与元数据。',
  '未验证真实手机/TapTap宿主的GPU帧率、内存与触屏手感。性能报告仅为本机无头Chrome同步Canvas绘制耗时。60关固定策略核心为关羽/夏侯惇/曹操，其他重做技能由专项测试覆盖。'
];
const ids=['xiahou_dun','cao_cao','liu_bei','sun_quan','zhou_yu','sima_yi','xu_chu','gan_ning'];
const names=['夏侯惇·拔矢破军','曹操·魏武号令','刘备·仁德援军','孙权·江东潮壁','周瑜·赤壁火船','司马懿·三才幽雷','许褚·虎痴撼地','甘宁·锦帆夜袭'];
const pictures=[...ids.map((id,i)=>[`skill-${id}.png`,names[i]]),...['shield','archer','crossbow','catapult','fire_oil','war_drum'].map((id,i)=>[`camp-${id}-close.png`,['盾营','弓营','弩营','投石营','火油营','战鼓营'][i]]),['party-three-wall-close.png','三人编队城墙特写'],['crowd-stage-one.png','第一关盾营减速后密潮'],['skill-reduced-motion.png','减弱动态无双']];
const violations=browser.layout.filter(x=>x.smallCount||x.targetCount||x.horizontalOverflow);
const passed=tests.match(/ℹ pass (\d+)/)?.[1]??'待核验',failed=tests.match(/ℹ fail (\d+)/)?.[1]??'待核验';
const tableRows=campaign.rows.map(r=>`<tr><td>${esc(r.levelId)}</td><td>${esc(r.beforeState)} → ${esc(r.afterState)}</td><td>${r.beforeHp}/${r.beforeMaxHp} → ${r.afterHp}/${r.afterMaxHp}</td><td>${r.beforeTime} → ${r.afterTime}</td><td>${r.beforeCasts} → ${r.afterCasts}</td></tr>`).join('');
const list=items=>'<ul>'+items.map(x=>`<li>${esc(x)}</li>`).join('')+'</ul>';
const beforeMs=performance.versions.before.meanMs.toFixed(2),afterMs=performance.versions.after.meanMs.toFixed(2);
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>无双守关·技能与战场美术验收</title>
<style>body{margin:0;background:#10251d;color:#e9e4d4;font:16px/1.75 system-ui}main{max-width:1100px;margin:auto;padding:28px}h1,h2{color:#f1d18d}a{color:#9ee3c9}table{width:100%;border-collapse:collapse;font-size:14px}td,th{border-bottom:1px solid #45614f;padding:7px;text-align:left}li{margin:8px 0}code{overflow-wrap:anywhere}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}figure{margin:0;padding:12px;background:#1b3428;border-radius:12px}img{display:block;width:100%;height:auto}figcaption{margin-bottom:8px}.muted{color:#b6c3b7}details{margin:18px 0}summary{cursor:pointer;font-weight:700}p{max-width:78ch}</style>
<main><h1>无双守关·技能与战场美术验收</h1><p>八名武将技能、十五将造型动作、六营与敌兵列位已接入。没有新增运行依赖、远程素材或位图资产。构建、测试和截图记录保留在本目录。</p>
<h2>验证结果</h2><ul><li>npm test：${passed}通过，${failed}失败。<a href="tests.log">完整日志</a></li><li>docs:validate、build通过；断网Chrome已打开离线战斗。<a href="docs-validation.log">文档校验</a> · <a href="build.log">构建日志</a> · <a href="offline-report.json">离线检查</a></li><li>真实Chrome页面审计：${browser.errors.length}错误，${violations.length}处小字/小点击/溢出记录。<a href="report.json">report.json</a></li><li>17组专项画面；${art.cacheBounds?.checked??0}个实际栅格化精灵帧通过透明边界检查。<a href="art-fixtures-report.json">专项报告</a></li><li>160敌兵、六营、三将、DPR2：缓存预热后平均绘制CPU ${beforeMs}ms → ${afterMs}ms，约降低${Math.round((1-performance.ratio)*100)}%。<a href="render-performance.json">对照基准</a></li></ul>
<h2>60关改动前后</h2><p>${campaign.beforeWins}/60 → ${campaign.afterWins}/60通关；58关耐久相同。蜀12：89 → 85；吴19：86 → 100。无胜转败，也没有失败转为碾压。逐关结果保留，范围没有为追平旧结果而缩回。</p><p><a href="campaign-before.json">原始改前记录</a> · <a href="campaign-after.json">原始改后记录</a> · <a href="campaign-comparison.csv">60关CSV对照</a></p><details><summary>展开全部60关（时间为战斗秒）</summary><table><thead><tr><th>关卡</th><th>胜负</th><th>剩余耐久</th><th>时间</th><th>全队施放</th></tr></thead><tbody>${tableRows}</tbody></table></details>
<h2>既有测试断言的等价迁移</h2>${list(assertionChanges)}<p>原shape种类至少12的要求保留；没有删除对应保障。新增测试另覆盖范围内外、时序、次数、基线数值、姓名卡、缓存及渲染只读。</p>
<h2>截图发现并修正</h2>${list(fixes)}
<h2>设计差异、待审与验证边界</h2>${list(scope)}
<h2>文件变更</h2>${Object.entries(files).map(([name,paths])=>`<details><summary>${name}</summary><ul>${paths.map(p=>`<li><a href="../../../../${esc(p)}"><code>${esc(p)}</code></a></li>`).join('')}</ul></details>`).join('')}<p class="muted">本目录保存截图、验收日志、改前模块快照及数据对比。用户原有设计稿和其他未提交文件均保留。</p>
<h2>关键画面</h2><div class="gallery">${pictures.map(([src,label])=>`<figure><figcaption>${esc(label)}</figcaption><a href="${src}"><img loading="lazy" src="${src}" alt="${esc(label)}"></a></figure>`).join('')}</div></main></html>`;
await writeAtomic(path.join(out,'index.html'),html);
console.log('Review record: docs/v1/playtest/skill-art/index.html');
