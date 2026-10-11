import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'docs','v1');
await mkdir(path.join(directory,'data'),{recursive:true});
const balance=JSON.parse(await readFile(path.join(directory,'data','balance.json'),'utf8'));
const tiers=balance.v1Baseline.stageGrowthTiers;
const heroNames={cao_cao:'曹操',xiahou_dun:'夏侯惇',zhang_liao:'张辽',xu_chu:'许褚',sima_yi:'司马懿',liu_bei:'刘备',guan_yu:'关羽',zhang_fei:'张飞',zhao_yun:'赵云',zhuge_liang:'诸葛亮',sun_quan:'孙权',zhou_yu:'周瑜',lv_meng:'吕蒙',gan_ning:'甘宁',taishi_ci:'太史慈'};
const unlocks={wei_003:'xiahou_dun',wei_007:'xu_chu',wei_012:'zhang_liao',wei_017:'sima_yi',shu_001:'liu_bei',shu_003:'zhang_fei',shu_007:'zhao_yun',shu_012:'zhuge_liang',wu_001:'sun_quan',wu_003:'taishi_ci',wu_007:'gan_ning',wu_012:'zhou_yu',wu_017:'lv_meng'};
const towerUnlocks={wei_003:'catapult',wei_007:'crossbow',shu_001:'war_drum',wu_001:'fire_oil'};
const bossTemplates=['rammer','charger','banner_lord','guardian','siege_lord'];
const chapters=[
 {id:'wei',name:'魏篇',title:'以阵定北方',acts:['乡野起兵','兖州守土','官渡粮道','北境风雪','合肥坚城'],speakers:['曹操','夏侯惇','许褚','张辽','司马懿'],heroIds:['cao_cao','xiahou_dun','xu_chu','zhang_liao','sima_yi'],bossNames:['黄巾破寨者','濮阳疾行督骑','乌巢号令统领','北关坚壁守将','合肥围城统帅']},
 {id:'shu',name:'蜀篇',title:'以义护山河',acts:['乡野护民','长坂救援','蜀道开关','汉中争锋','荆州守望'],speakers:['刘备','张飞','赵云','诸葛亮','关羽'],heroIds:['liu_bei','zhang_fei','zhao_yun','zhuge_liang','guan_yu'],bossNames:['乡野破门渠帅','长坂追军督骑','葭萌双旗统领','汉水坚壁守将','荆州攻城统帅']},
 {id:'wu',name:'吴篇',title:'以水固江东',acts:['江东继业','江夏舟道','赤壁火阵','南郡水寨','濡须江垒'],speakers:['孙权','太史慈','甘宁','周瑜','吕蒙'],heroIds:['sun_quan','taishi_ci','gan_ning','zhou_yu','lv_meng'],bossNames:['江东破门寨主','江夏疾行舟师','赤壁双旗统领','南郡坚壁守将','濡须攻城统帅']},
];
const commonSlots=[[53,142],[367,142],[67,290],[353,290],[88,420],[332,420]];
const makeMap=(id,name,theme,paths,extraSlots=[],rule={id:'none',copy:'普通地形'})=>({id,name,theme,world:[420,600],paths:paths.map(points=>points.map(([x,y])=>({x,y}))),campSlots:[...commonSlots,...extraSlots].map(([x,y],slot)=>({slot,x,y})),heroSlots:[{...balance.v1Baseline.party.heroPositions.lead,role:'lead'},...[balance.v1Baseline.party.heroPositions.supportLeft,balance.v1Baseline.party.heroPositions.supportRight].map(position=>({...position,role:'support'}))],rule});
const maps=[
 makeMap('wei_gate','平原寨门','魏地黄土与寨栅',[[[100,-16],[95,150],[210,310],[210,530]],[[320,-16],[325,150],[210,310],[210,530]]]),
 makeMap('wei_river','官渡河堤','干河粮仓与长堤',[[[80,-16],[155,130],[120,280],[210,390],[210,530]],[[340,-16],[260,130],[300,280],[210,390],[210,530]]],[[210,210]],{id:'bank_cover',copy:'中央堤营投射物射程增加 10%，盾营控制范围不变',campModifier:{slot:6,projectileRangeMultiplier:1.1}}),
 makeMap('wei_pass','北境石关','灰岩雪线与拒马',[[[70,-16],[105,170],[190,270],[130,380],[210,480],[210,530]],[[350,-16],[310,120],[240,250],[290,400],[210,480],[210,530]]],[],{id:'cold_front',copy:'第 4 波来袭前预告雪骑，骑兵占比已写入该波，不额外加速'}),
 makeMap('wei_fort','合肥堡垒','青灰城墙与曲折道路',[[[70,-16],[130,130],[65,250],[170,350],[210,450],[210,530]],[[210,-16],[210,130],[260,260],[210,450],[210,530]],[[350,-16],[310,180],[355,300],[250,395],[210,450],[210,530]]],[[170,215],[260,360]],{id:'three_fronts',copy:'三路入口，波次偏路分配；首领路提前两秒标记'}),
 makeMap('shu_village','乡村驿道','草庐稻田与竹篱',[[[85,-16],[85,160],[140,270],[210,370],[210,530]],[[335,-16],[330,145],[280,280],[210,370],[210,530]]]),
 makeMap('shu_valley','荆州狭谷','竹林石壁与窄口',[[[70,-16],[120,170],[205,270],[175,360],[210,465],[210,530]],[[350,-16],[300,170],[215,270],[250,370],[210,465],[210,530]]],[],{id:'narrow_choke',copy:'两路在狭口较早汇合；聚怪来自路线与盾营，无额外自动减速'}),
 makeMap('shu_mountain','蜀道栈关','山栈木桥与悬崖',[[[80,-16],[140,125],[75,250],[170,375],[210,480],[210,530]],[[340,-16],[260,150],[330,260],[245,390],[210,480],[210,530]]],[[210,205]],{id:'high_ground',copy:'高台营位投石爆炸半径增加 10%，不叠加其他地图半径加成',campModifier:{slot:6,catapultRadiusMultiplier:1.1}}),
 makeMap('shu_river','汉水码头','江水浮桥与渡口',[[[60,-16],[95,170],[160,290],[210,440],[210,530]],[[210,-16],[210,160],[240,280],[210,440],[210,530]],[[360,-16],[320,190],[280,330],[210,440],[210,530]]],[[160,205],[264,395]],{id:'bridge_fronts',copy:'三桥合流，桥口依波次轮换增兵；固定路线始终可见'}),
 makeMap('wu_dock','江东水寨','木栈绳桩与蓝绿江水',[[[70,-16],[130,170],[150,310],[210,435],[210,530]],[[350,-16],[290,170],[270,310],[210,435],[210,530]]]),
 makeMap('wu_reeds','芦苇浅滩','沙滩芦苇与浅水',[[[60,-16],[115,135],[65,265],[165,360],[210,470],[210,530]],[[210,-16],[210,170],[240,300],[210,470],[210,530]],[[360,-16],[315,150],[350,280],[275,375],[210,470],[210,530]]],[[165,215]],{id:'reed_warning',copy:'芦苇只遮装饰层；敌兵始终有轮廓，骑兵增援提前五秒提示'}),
 makeMap('wu_fire','赤壁火岸','赤色营火与断船',[[[70,-16],[140,140],[95,280],[210,390],[210,530]],[[350,-16],[285,145],[325,275],[210,390],[210,530]]],[],{id:'tailwind',copy:'战前明示火油营灼烧伤害增加 10%，其他火技不受益',campModifier:{fireOilDotMultiplier:1.1}}),
 makeMap('wu_fort','濡须江垒','水门石垒与铁链',[[[65,-16],[110,130],[80,285],[155,370],[210,470],[210,530]],[[210,-16],[210,150],[235,280],[210,470],[210,530]],[[355,-16],[315,120],[350,285],[275,390],[210,470],[210,530]]],[[170,220],[270,380]],{id:'watergate_fronts',copy:'三水门固定开放，中央精锐、两翼兵潮；禁止战中突然改路'}),
];
// Each row specifies a playable situation plus its story consequence, not a historical assertion.
// name, map, enemy focus, tactical brief, opening line, resolution line.
const rows={
 wei:[
 ['乡野初阵','wei_gate','兵潮','完成军营与领衔无双教学','乡民尚未走远，先守住这条归乡路。','城门未破，今日先让百姓平安回家。'],
 ['双路粮车','wei_gate','偏路','左路先密集来袭，右路随后补兵','粮车分两路入营，莫把兵力全压在一侧。','粮秣入库，接下来才有久守的底气。'],
 ['夏侯拒马','wei_gate','骑袭','本关可带曹操协战，首通解锁投石营与夏侯惇','把敌骑留在拒马前，守住后便能开筑投石营。','夏侯惇加入英雄录，盾与石从此可以同阵。'],
 ['寨门不退','wei_gate','混编','第一幕首领，教学预警与清残兵','渠帅已到寨外。先断其兵潮，再破其攻势。','初阵已定，军师将第一张守关图收入卷中。'],
 ['兖州回援','wei_gate','甲阵','先清步兵，再持续处理重甲','甲兵掩在乡道，分不清敌我便看不清战机。','民舍得以保全，援军终于赶回营门。'],
 ['濮阳侧路','wei_river','偏路','右堤短路高压力，中央射程营位','敌兵绕堤而来，右侧的短路比旗影更危险。','粮仓仍在，迂回之敌只能空手退去。'],
 ['虎卫守仓','wei_river','远射','解锁弩营，学习轻精锐干扰','许褚愿守仓口，弩兵的压制就交给军师拆解。','虎卫入录，营中有了专破精锐的劲弩。'],
 ['濮阳破围','wei_river','骑袭','疾行首领冲刺前两秒预警','督骑要冲堤口。不要等到旗帜过桥才动刀。','围势已解，兖州这一页以完整粮仓收笔。'],
 ['官渡前哨','wei_river','兵潮','短间隙三兵团，重视无双覆盖','官渡军书送达，守住前哨才能看清粮道。','前哨旗号未灭，粮道消息终于通畅。'],
 ['白马岸线','wei_river','远射','上游箭阵与下游骑兵错峰','岸线上箭影密集，冲在最前的却是骑兵。','水岸守稳，箭阵失了掩护。'],
 ['乌巢粮道','wei_river','甲阵','节省军粮，留投石营处理重甲','粮道就是此役的命门，不必每营都升满。','半数军粮化作拒敌之阵，半数仍可迎接下一波。'],
 ['夜守乌巢','wei_fort','混编','号令首领召集零奖励护卫，解锁张辽','敌旗一举便有增援，先斩旗手，莫贪零散击破。','张辽入录，官渡卷记下了以阵截援的办法。'],
 ['北关长路','wei_pass','骑袭','首次长折路，控制衰减与骑速对照','北境道路漫长，快马却能把时间压得很短。','关前拒马连起，骑队再难直扑城下。'],
 ['雪线分营','wei_pass','偏路','两路交替，支援技能留给薄弱侧','雪光映出两路旗影，哪一路近城便先援哪一路。','雪线未动，军师把交替增援写成新阵谱。'],
 ['铁甲过隘','wei_pass','甲阵','强化对重甲收益，普通刀波仅清护兵','不要指望一刀连铁甲都扫尽，刀后还要有弩。','铁甲倒在第二道火力下，守阵终于有了层次。'],
 ['北关坚壁','wei_pass','混编','首领盾相减伤，学会延后协战技能','守将举盾时浪费无双，只会把下个战机让出去。','盾相已破，北境这一页留下了耐心。'],
 ['合肥军议','wei_fort','远射','司马懿入录，三路地图首次系统讲解','三门皆来敌。先看预警，再看哪座军营仍缺火力。','司马懿加入军议，三路守阵从此有人谋划。'],
 ['三门交锋','wei_fort','偏路','三路兵力不均，拒绝平均铺塔','中央敌少却多甲，两翼人多却易聚，不能一法同守。','三门俱在，各路各有合适的防线。'],
 ['城下换旗','wei_fort','混编','多类型错峰，验证三将技能顺序','旧旗落、新旗起，别把三次无双都留给同一团兵。','技能错开，城下的空隙被一一补上。'],
 ['合肥终阵','wei_fort','混编','章末攻城统帅，三将和营阵综合验收','围城统帅亲至，今日要让他知道何为守关。','北方卷合上，军师带着守阵经验转向蜀地山河。'],
 ],
 shu:[
 ['驿路迎民','shu_village','兵潮','刘备入录、解锁战鼓营，说明团队增益','百姓沿驿道而来，先把军阵搭在他们身后。','驿路安稳，刘备与战鼓营一同写入英雄录。'],
 ['竹篱两翼','shu_village','偏路','支援增益覆盖，左右敌潮分批','竹篱遮不住两翼来兵，让号令能照顾到薄弱一边。','两翼兵潮都退下去，队伍开始懂得彼此照应。'],
 ['桃园喝阵','shu_village','骑袭','张飞入录，体验击退控制与聚怪取舍','张飞愿守近关处，一声喝退却也会打散敌群。','猛喝有了合适的时机，张飞的阵位得以定下。'],
 ['乡道护送','shu_village','甲阵','首领配重甲，稳定清杂再集火','最后一队乡民还在道上，别为追杀渠帅拆了防线。','护送完成，蜀卷先记住了守城之外的人。'],
 ['新野双旗','shu_valley','旗阵','军旗手首次正式登场，周围提速不叠加','旗手让兵潮加快，先找旗，不要只数人。','双旗落地，敌军终于露出真实的步速。'],
 ['林口伏兵','shu_valley','远射','轻精锐干扰与弱塔受压，预警始终可见','林边有伏兵，但预警已先到营中，军师莫慌。','伏势被看穿，荆州狭口再无突然的空缺。'],
 ['子龙接应','shu_valley','骑袭','赵云入录，贯穿型无双对直列收益','赵云从侧路接应，这一枪最适合笔直的长列。','接应旗举起，英雄录添上了长枪的身影。'],
 ['长坂断后','shu_valley','混编','首领快攻，控制接续避免同时耗尽','追兵紧，路却窄。两次救险不能在同一刻交出去。','追军止步，长坂卷以完整城关收束。'],
 ['葭萌入关','shu_mountain','甲阵','首次高台投石位，装备培养引导复核','蜀道抬高了战场，也给巨石留出了好落点。','高台军阵落定，山路的压力开始转为机会。'],
 ['栈桥分守','shu_mountain','偏路','山路长短差，支援阵位调整','栈桥一长一短，看到远处人多不等于近处安全。','两桥相继清空，军师找到了不同路长的守法。'],
 ['山门重甲','shu_mountain','甲阵','二次成长选择，对重甲塔不可全换群攻','山门前满是甲光，纸面最大的范围未必最有用。','重甲散去，队伍学会了为最后几名精锐留火力。'],
 ['卧龙观阵','shu_mountain','旗阵','诸葛亮入录，首领增援召唤控制','诸葛亮指向旗阵：破的是敌人的节奏，不只是兵数。','卧龙入录，军师将增援间隙记成新策。'],
 ['汉水守渡','shu_river','远射','三桥中央精锐、两翼普通，范围塔定位','三座桥都通向城关，中央慢兵往往更难处理。','渡口守住，汉中军报得以安全送达。'],
 ['定军截援','shu_river','骑袭','中波先骑后甲，技能预留','援骑只为开路，真正的压力藏在它们后面。','援线截断，后队重甲失了突进机会。'],
 ['粮舟回航','shu_river','偏路','波次偏路轮换，保护城关耐久星级','粮舟正在回航，让每一路防线都能撑过换旗。','舟队回营，城关耐久成了这一页的勋记。'],
 ['汉中坚守','shu_river','混编','守将减伤相位+精锐，手动留技能','敌将举盾，护兵仍在。先扫护兵，再等盾落。','汉中局势稳下，协战的时机终于与领衔合拍。'],
 ['荆州秋风','shu_valley','旗阵','关羽剧情主场，可借将完整无双','风过荆州，关羽立于城关，今次由青龙刀领阵。','刀光落定，荆州卷重新看见聚敌的价值。'],
 ['两岸来兵','shu_river','偏路','三路交替全军压力，兵符抗扰选择','两岸旗号不同，扰阵却会同时落到营中。','军阵没有乱，装备的取舍也有了实战答案。'],
 ['孤城多将','shu_valley','混编','三将协战的救险顺序与演出队列','守孤城可以有三将，救急却仍要先分轻重。','三将各尽其用，最后一团残兵倒在营阵下。'],
 ['荆州守望','shu_river','混编','章末攻城统帅，关羽清杂与塔收尾','城下还有战旗，未清残兵之前，这一役就未结束。','蜀卷合上，军师记住的是完整守住的一方山河。'],
 ],
 wu:[
 ['江东继业','wu_dock','兵潮','孙权入录、解锁火油营，学习持续伤害','江东水寨初定，让守阵替后方争得整军时间。','水寨安稳，孙权将火油营交给军师调度。'],
 ['木栈迎潮','wu_dock','偏路','水寨长栈道，火油覆盖不能重叠浪费','栈道细长，火势留在必经处才有价值。','兵潮走不过火线，持续伤害有了自己的战机。'],
 ['太史弓阵','wu_dock','远射','太史慈入录，点杀精锐与弓营配合','太史慈盯住箭阵中的精锐，群攻之外也要有准头。','强弓入录，队伍多了一种收尾的办法。'],
 ['水寨立旗','wu_dock','甲阵','破门首领与持续火场，拒绝只等一次爆发','寨主慢，却有甲。刀波过后，火场还要留得住。','第一面水寨旗立起，江东卷从持续守阵起笔。'],
 ['江夏舟口','wu_reeds','攻城','攻城车首次登场，控制抗性与漏伤预告','舟口送来攻城车，慢并不代表可以最后才管。','车阵被拦，城关没有为迟疑付出代价。'],
 ['芦苇骑影','wu_reeds','骑袭','骑增援提前五秒预告，芦苇不遮敌轮廓','芦苇里骑影已显，五秒军报就是你的布阵时间。','疾骑停在浅滩，战场信息始终比伏势先到。'],
 ['锦帆箭雨','wu_reeds','偏路','甘宁入录，锁定箭雨区域并衔接易伤火力','锦帆箭雨落在密集处，军师还须让后续火力接上。','甘宁入录，短时箭雨与易伤标记共同打开了战机。'],
 ['江夏断舟','wu_reeds','混编','首领快攻与车队，协战需分担救险','督师快攻只是第一步，后面还有缓慢的攻城车。','快慢两势都被化解，舟道重归江东。'],
 ['赤壁筹火','wu_fire','旗阵','顺风火油加成战前可见，不加成英雄火技','岸风可助火油，但不能把每一种火技都当成同一种火。','火油落位，赤壁卷先把地形与技能分清。'],
 ['连营兵潮','wu_fire','兵潮','持续长队，瞬间与持续无双对照','敌军连成一线，一刀能清当下，火场能等后来。','长队断成数段，两种无双各自兑现了价值。'],
 ['风口甲船','wu_fire','攻城','车阵夹重甲，火油不替代弩营破甲','火势照亮甲船，真正收尾还得交给劲弩。','甲阵退去，军营之间没有谁能包办一切。'],
 ['周郎火阵','wu_fire','混编','周瑜入录，四秒火场与后续增援','周瑜挥手布火，别只看第一批敌人倒下的瞬间。','周瑜入录，英雄录添上了守住下一批敌人的火。'],
 ['南郡水门','wu_fort','远射','三水门与扰阵，战鼓位置管理','三门来箭，让号令照顾到最容易被扰乱的军营。','水门没有失序，军鼓在箭影里仍能传令。'],
 ['断桥换阵','wu_reeds','偏路','战前路线不同变体，战中不突然断路','桥图已在战前改过，敌军到来之后便不再藏规则。','新图守稳，军师将变化写进了下一卷的余量。'],
 ['江岸铁轮','wu_fort','攻城','两路车阵错峰，装备养成综合检查','铁轮压岸，只升群攻会把最后的难题留给城关。','车阵停下，培养终于化作稳固的守阵。'],
 ['南郡坚壁','wu_fort','混编','首领护盾和增援相邻，控制技能串联','盾势与援军接连而至，协战该接续，不该抢演出。','南郡卷收束，三将的配合已经有了秩序。'],
 ['白衣军议','wu_fort','旗阵','吕蒙入录，预判两条高压路线布下四处伏兵','吕蒙先看敌军将到哪里，再将伏兵置于必经之路。','吕蒙入录，提前布阵的谋策与当下清场的刀光同阵并行。'],
 ['濡须三潮','wu_fort','偏路','三水门每波偏侧不同，读预警而非背路线','三次潮头不会从同一门来，军师须看旗报而非记旧图。','三门都未失守，关卡变化成了思考而非惊吓。'],
 ['江垒合阵','wu_fort','混编','全兵种组合，三将手动或自动策略验收','十五名将已入录，今日选择哪三人，便守哪一种阵。','江垒战旗仍立，队伍的选择成为最后一关的伏笔。'],
 ['三卷归一','wu_fort','混编','终局攻城统帅，清残兵后播三国卷宗尾声','三卷汇成一阵，最后的敌将仍需军阵、将令与无双同力。','魏蜀吴三卷归一。英雄录留下空页，等待下一段山河。'],
 ],
};
const focusDescription={兵潮:'大量步兵，制造清场高潮',偏路:'两翼/三路错峰压力',骑袭:'快速骑兵与普通兵混编',甲阵:'重甲存活后的持续收尾',远射:'远射精锐干扰与塔覆盖',旗阵:'军旗手提速普通兵，优先断旗',攻城:'攻城车慢速高耐久高漏伤',混编:'多兵种组合与技能顺序'};
const enemyNames={infantry:'步',cavalry:'骑',armor:'甲',ranged:'弩',banner:'旗',siege:'车'};
function allocate(total,weights){
 const entries=Object.entries(weights).filter(([,weight])=>weight>0); const sum=entries.reduce((n,[,w])=>n+w,0);
 const units=Object.fromEntries(entries.map(([id,w])=>[id,Math.floor(total*w/sum)]));
 const ranking=entries.map(([id,w])=>[id,total*w/sum-units[id]]).sort((a,b)=>b[1]-a[1]);
 let extra=total-Object.values(units).reduce((a,b)=>a+b,0);
 for(let i=0;extra>0;i++,extra--)units[ranking[i%ranking.length][0]]++;
 return units;
}
function composition(focus,globalIndex,wave,waveCount){
 const weights={infantry:1}; const late=wave>Math.ceil(waveCount/3);
 if(globalIndex>=3&&late)weights.cavalry=focus==='骑袭'?.32:.12;
 if(globalIndex>=5&&late)weights.armor=focus==='甲阵'?.24:.10;
 if(globalIndex>=7&&wave>2)weights.ranged=focus==='远射'?.22:.06;
 if(globalIndex>=25&&late)weights.banner=focus==='旗阵'?.07:.025;
 if(globalIndex>=45&&wave>Math.ceil(waveCount/2))weights.siege=focus==='攻城'?.09:.035;
 if(focus==='兵潮')for(const id of Object.keys(weights))if(id!=='infantry')weights[id]*=.5;
 if(focus==='混编')weights.infantry=.82;
 return weights;
}
const baseCounts=[30,36,44,54,64,76,86,96,104,114];
const windows=[10,11,13,14,16,18,19,20,21,22];
const densityMultiplier=balance.v1Baseline.enemyDensity?.densityMultiplier??1.6;
const levels=[];
for(const [chapterIndex,chapter]of chapters.entries())for(const [rowIndex,row]of rows[chapter.id].entries()){
 const n=rowIndex+1,globalIndex=chapterIndex*20+n,id=`${chapter.id}_${String(n).padStart(3,'0')}`;
 const tier=tiers[Math.floor((globalIndex-1)/5)]; const actIndex=Math.floor(rowIndex/4);
 const map=maps.find(map=>map.id===row[1]); const boss=n%4===0;
 const waveCount=n<=2?6:boss?10:n>=13?9:8;
 const choiceAfterWaves=waveCount===6?[2,4]:waveCount===8?[2,4,6]:waveCount===9?[3,6]:[3,6,8];
 const partySize=globalIndex<=2?1:globalIndex<=8?2:3;
 const waves=Array.from({length:waveCount},(_,i)=>{
   const count=Math.round(baseCounts[i]*tier.countMultiplier*(1+((n-1)%4)*.025)*densityMultiplier);
   const units=allocate(count,composition(row[2],globalIndex,i+1,waveCount));
   const spawnWindowSec=windows[i]; const packAmounts=allocate(count,{a:.42,b:.33,c:.25});
   const unitGroups={a:{},b:{},c:{}};
   for(const [enemyId,total]of Object.entries(units)){
     const split=allocate(total,{a:packAmounts.a,b:packAmounts.b,c:packAmounts.c});
     for(const key of ['a','b','c'])if(split[key])unitGroups[key][enemyId]=split[key];
   }
   const lanes=map.paths.length===3 ? (row[2]==='偏路'?(i%2?[.2,.3,.5]:[.5,.3,.2]):[.35,.3,.35]) : (row[2]==='偏路'?(i%2?[.32,.68]:[.68,.32]):[.5,.5]);
   return {index:i+1,count,units,spawnWindowSec,packs:['a','b','c'].map((key,p)=>({startSec:Number((p*spawnWindowSec/3).toFixed(2)),durationSec:Number((spawnWindowSec/3*.8).toFixed(2)),units:unitGroups[key]})),laneDistribution:lanes,hpMultiplier:Number((1+.10*i/(waveCount-1)).toFixed(4)),speedMultiplier:1,rewardMultiplier:1,bossSpawn:boss&&i===waveCount-1?{templateId:bossTemplates[actIndex],name:chapter.bossNames[actIndex],hpMultiplier:[.75,.82,.90,1,1.12][actIndex],ignoreWaveHpMultiplier:true,spawnAtSec:spawnWindowSec+1,warningSec:2}:null};
 });
 const prior=globalIndex===1?'tutorial_available':n===1?`${chapters[chapterIndex-1].id}_020`:`${chapter.id}_${String(n-1).padStart(3,'0')}`;
 const battleHero=chapter.heroIds[actIndex];
 const firstReward={...tier.firstClearReward};if(boss)for(const key of Object.keys(firstReward))firstReward[key]=Math.floor(firstReward[key]*(balance.v1Baseline.metaProgression.actEndFirstClearRewardMultiplier??1.25));
 const level={id,chapterId:chapter.id,order:n,globalIndex,act:actIndex+1,name:row[0],mapId:row[1],routeVariant:row[2]==='偏路'?'alternating_pressure':'standard',focus:row[2],tacticalBrief:row[3],growthTierId:tier.id,difficultyProfileId:'normal',seed:2026101100+globalIndex,prerequisite:prior,recommendedHeroLevelRange:tier.recommendedHeroLevelRange,maxPartySize:partySize,startingFood:tier.startingFood,freeCamps:[{slot:4,type:'shield'},{slot:2,type:'archer'}],choiceAfterWaves,waves,countsAlreadyIncludeTier:true,hpMultipliersExcludeTier:true,storyGuest:boss?{heroId:battleHero,optional:true,level:tier.recommendedHeroLevelRange[0],equipmentPresetId:'chapter_guest_standard',occupiesPartySlot:true}:null,unlockHeroId:unlocks[id]||null,unlockCampType:towerUnlocks[id]||null,firstClearReward:firstReward,repeatReward:{...tier.dailyRepeatReward},rewardsExcludeSummons:true,stars:{one:'clear_with_castle_hp_above_zero',two:'clear_with_castle_hp_fraction_at_least_0.60',three:'clear_with_castle_hp_fraction_at_least_0.85'},targetCombatDurationSec:boss?[270,360]:[180,300],story:{mode:'fictional_wargame',opening:[{speaker:'军师',text:`${chapter.name}第${n}阵，${row[0]}。`},{speaker:chapter.speakers[actIndex],text:row[4]}],resolution:[{speaker:chapter.speakers[actIndex],text:row[5]}],failureLine:'阵势未成，先检查薄弱营位与无双的施放时机。',rewardLine:unlocks[id]?`${heroNames[unlocks[id]]}加入英雄录；获一次性追赶培养。`:boss?'此幕守阵已记入三国卷宗。':'新阵谱已解锁，可继续下一阵。'}};
 level.countsAlreadyIncludeDensity=true;
 level.generationFacts={densityMultiplier,inActCountMultiplier:1+((n-1)%4)*.025,spawnWindowMultiplier:1};
 level.stars.bonusRewardFractionPerNewStar=balance.v1Baseline.metaProgression.starsReward.bonusFractionOfBasePerNewStar;
 level.stars.bonusStars=[...balance.v1Baseline.metaProgression.starsReward.bonusStars];
 level.stars.rewardRounding='floor_per_currency_per_new_star';
 level.stars.rewardTracking='highest_rewarded_stars_per_level';
 if(level.storyGuest){
   level.storyGuest.skillLevel=tier.recommendedSkillLevelRange[0];
   level.storyGuest.equipment=Object.fromEntries(balance.v1Baseline.metaProgression.equipment.slots.map(slot=>[slot,slot==='weapon'?{quality:tier.recommendedMainWeaponQuality,level:tier.recommendedMainWeaponLevelRange[0]}:{quality:'white',level:0}]));
 }
 levels.push(level);
}
const data={schemaVersion:'1.0.0-design',status:'planned_content_not_loaded_by_prototype',contentVersion:'v1.0-design-20261011',updatedAt:'2026-10-11',scope:{chapters:3,levelsPerChapter:20,levels:60,mapTemplates:12,heroCount:15,maxPartySize:3},campaignOrder:['wei','shu','wu'],initialHeroIds:['cao_cao','guan_yu'],initialCampTypes:['shield','archer'],chapters:chapters.map(({id,name,title,acts,heroIds})=>({id,name,title,acts,heroIds,levelIds:levels.filter(l=>l.chapterId===id).map(l=>l.id)})),maps,levels,extension:{levelIdPattern:'<chapter_slug>_<three_or_more_digit_order>',existingIdsImmutable:true,additionalChaptersUseNewIds:true,maxLevelsNotHardcoded: true,mapReferencesById:true,oldStoryReplaysRetained:true}};
data.schemaVersion='1.0.0';
data.status='runtime_v1_alpha';
data.contentVersion='v1.1-alpha-20261011-r1';
data.generationFacts={densityMultiplier,baseWaveCounts:baseCounts,spawnWindowSec:windows,countRounding:'round_once_in_generator',runtimeCountMultiplier:1,realEnemiesOnly:true};
data.guestPresets={chapter_guest_standard:{description:'幕末可选借将；按本关成长段解析，显式值在storyGuest中保存，不生成永久物品',heroLevelSource:'recommendedHeroLevelRange[0]',skillLevelSource:'recommendedSkillLevelRange[0]',weaponQualitySource:'recommendedMainWeaponQuality',weaponLevelSource:'recommendedMainWeaponLevelRange[0]',otherEquipment:{quality:'white',level:0},occupiesPartySlot:true,persistToInventory:false}};
await writeFile(path.join(directory,'data','levels.json'),JSON.stringify(data,null,2)+'\n');
let md=`# 无双守关 V1 关卡与剧情设计\n\n版本 1.0 可玩开发版，更新日期 2026-10-11。正式主线为魏蜀吴三篇各 20 关，共 60 关，另保留关羽训练场。关卡以军师演武沙盘重演三方战役，将历史题材改编为可守关的架空战局；章节按势力组织，不作为真实历史 chronology 或真实战役结局的陈述。\n\n每关有独立名字、叙事起因、守阵目标、战术变化与收束。地图、波次和首通解锁以 [levels.json](data/levels.json) 为关卡事实源，数值段位引用 [balance.json](data/balance.json)。这些配置已接入 V1 可玩开发版；关羽单关原型独立保留于 prototype.html。运行与验收证据见交付检查记录，配置完整不代表所有队伍都已平衡。\n\n## 主线与英雄录\n\n军师接手三卷军书，先守魏地粮道，再沿蜀地山川护民，最后在吴地水岸学习火阵与多路守阵。每篇五幕、每幕四关；前三关建立战术问题，第四关让首领与兵潮共同验收。幕末对白可跳过，失败后直接重试，重复通关默认折叠对白。\n\n玩家初始拥有曹操与关羽。英雄录保存武将阵谱，允许跨势力搭配、已解锁武将参与其他时代卷宗；借将属于演武推演，不把跨时期人物解释为真实联军。前三国篇章依次解锁，章内按关序推进；过关即解锁下一关，不要求满星或指定付费武将。\n\n| 节点 | 解锁 | 对应教学 |\n| --- | --- | --- |\n| 首次战斗 / 训练场 | 关羽、曹操；盾营、弓营 | 守关、布阵、蓄怒、清场 |\n| 魏 3 | 夏侯惇、投石营、第二阵位 | 聚怪与范围伤害 |\n| 魏 7 | 许褚、弩营 | 精锐干扰与破甲 |\n| 魏 9 | 第三阵位 | 技能接续与队伍增益 |\n| 魏 12 / 17 | 张辽 / 司马懿 | 贯穿压阵 / 谋策减弱 |\n| 蜀 1 / 3 / 7 / 12 | 刘备、战鼓营 / 张飞 / 赵云 / 诸葛亮 | 团队号令、击退、贯穿、控制 |\n| 吴 1 / 3 / 7 / 12 / 17 | 孙权、火油营 / 太史慈 / 甘宁 / 周瑜 / 吕蒙 | 火场、点杀、突围、持续清场、精锐收尾 |\n\n新将一次性培养至解锁关推荐等级段下限，装备使用免费基础件；不重复赠送经验，重复首通或导入同存档不触发第二次奖励。幕末可选用免费剧情借将，借将占一个出战位，固定为本段下限等级及公共装备预设，不写入永久装备库存。\n\n## 地图母版与关卡差异\n\n地图为 420×600 逻辑世界，英雄在后方、城关终点在 y=530。12 母版每个含 2 或 3 条可见固定路径与 6 至 8 个营位，路径和营位完整坐标保存在关卡 JSON。地形主题与路线变化是独立字段：不能仅换背景色就宣称新地图。\n\n| 地图 ID | 母版 | 路线 / 营位 | 战术差异 |\n| --- | --- | --- | --- |\n`;
for(const map of maps)md+=`| ${map.id} | ${map.name} | ${map.paths.length} / ${map.campSlots.length} | ${map.rule.copy} |\n`;
md+=`\n地图加成只对字段中列出的军营生效，战前和营位说明要显示加成；每项单独 10%，不藏暗加成。局内路线固定，芦苇不能隐藏威胁轮廓。routeVariant 当前两种值只改变出兵偏侧，不改变道路坐标；追加真正道路变体必须提供新路径数据、同步底图、营位、碰撞与预警。\n\n## 波次与清关规则\n\n普通首两关 6 波；其他普通关 8 或 9 波，幕末 10 波。每波分三个显式兵团，兵团开始时间、持续时间与各兵种数量全部列入 JSON。当前波的实际敌人和非奖励召唤兵全部退场后再进入下一波；三选一暂停，不与新波叠加。\n\n各波的已解析人数已包含段位 countMultiplier，不再乘第二次。普通敌 HP = 兵种基础 HP × 段位 HP × 波内 HP × 难度 HP；精锐和首领还乘 1/2/3 人队伍系数 1/1.5/1.9。普通步兵不乘队伍 HP，以保持清场。首领另乘幕强度 0.75/0.82/0.90/1/1.12，不再乘波内 HP；速度及奖励按数值文档公式，地图图形不额外制造加成。\n\n军粮奖励对每名有奖敌兵仅一次。首领召唤的步兵奖励为 0、仍需清理，避免无限刷资源。胜利要求末波全部敌军退场且城关耐久大于 0；一星为通关，二星耐久至少 60%，三星至少 85%。星级附加资源只按历史最高星新增差额，重复三星不能再领首通奖励。常规关战斗时间目标 3 至 5 分钟，幕末目标 4.5 至 6 分钟；这是待仿真预算而非自动判胜计时器。\n\n| 敌兵首次教学 | 解锁关 | 教学重点 |\n| --- | --- | --- |\n| 步兵 | 魏 1 | 大量敌潮与清场收益 |\n| 骑兵 | 魏 3 | 速度与救险 |\n| 重甲 | 魏 5 | 不能依赖一刀解决全部敌军 |\n| 弩兵 | 魏 7 | 短暂干扰军营攻速，预警目标可见 |\n| 军旗手 | 蜀 5 | 半径内普通步兵提速，同类不叠加 |\n| 攻城车 | 吴 5 | 慢速高耐久、控制折减、高漏伤 |\n\n## 首领母型与剧情收束\n\n15 幕末统领复用五种母型。角色名称为架空军阵对手，敌将受控、减伤和召唤均有前兆，不能在尚未教学时隐形秒扣城关。真实三国武将作为玩家英雄录与叙事角色，章末失败不被写成英雄永久死亡。\n\n| 母型 | 特性 | 明示反制 |\n| --- | --- | --- |\n| rammer | 破门冲击，下一次漏伤增加 25%；两秒预警 | 清兵后集火，突破前用控制 |\n| charger | 提速 40%，持续四秒；两秒预警 | 保留近城技能和弩营 |\n| banner_lord | 每 15 秒召 6 步兵，最多两次，召唤无奖励 | 控制首领，无双扫护兵 |\n| guardian | 每 16 秒减伤 25%，持续四秒；两秒预警 | 等盾落后施放精锐技能 |\n| siege_lord | 每 18 秒扰两营，攻击间隔增加 15%三秒；两秒预警 | 利用其他营和协战补输出 |\n\n## 六十关总览\n\n`;
for(const chapter of chapters){md+=`### ${chapter.name} ${chapter.title}\n\n| 关卡 | 名称 | 地图 | 重点 | 波数 / 出战位 | 剧情与解锁 |\n| --- | --- | --- | --- | --- | --- |\n`;for(const l of levels.filter(l=>l.chapterId===chapter.id))md+=`| ${l.id} | ${l.name} | ${maps.find(m=>m.id===l.mapId).name} | ${l.tacticalBrief} | ${l.waves.length} / ${l.maxPartySize} | ${l.unlockHeroId?heroNames[l.unlockHeroId]+'入录':l.storyGuest?'幕末 '+l.waves.at(-1).bossSpawn.name:chapter.acts[l.act-1]} |\n`;md+='\n';}
md+=`## 逐关剧情与出兵规格\n\n表中的人数为有奖常规敌军，不含首领及其零奖励召唤兵。步/骑/甲/弩/旗/车分别表示步兵、骑兵、重甲、弩兵、军旗手、攻城车。波内 HP 倍率要与段位一次相乘，不能再次施加旧原型按波号增血。全部故事对白均为游戏原创演武对白。\n\n`;
for(const l of levels){md+=`### ${l.id} ${l.name}\n\n${l.story.opening.map(line=>`**${line.speaker}**：${line.text}`).join('\n\n')}\n\n战术目标：${l.tacticalBrief}。地图 ${l.mapId}；段位 ${l.growthTierId}，推荐等级 ${l.recommendedHeroLevelRange.join(' 至 ')}，最多 ${l.maxPartySize} 名武将，开局 ${l.startingFood} 军粮，免费盾营位 4 / 弓营位 2。强化选择在第 ${l.choiceAfterWaves.join('、')} 波后。${l.storyGuest?`剧情借将 ${heroNames[l.storyGuest.heroId]}，等级 ${l.storyGuest.level}，可选且占阵位。`:''}\n\n| 波 | 人数 | 编成 | 出兵窗秒 | 波内 HP |\n| --- | --- | --- | --- | --- |\n`;
 for(const wave of l.waves)md+=`| ${wave.index} | ${wave.count}${wave.bossSpawn?' + 首领 1':''} | ${Object.entries(wave.units).filter(([,n])=>n).map(([id,n])=>enemyNames[id]+n).join(' ')} | ${wave.spawnWindowSec} | ${wave.hpMultiplier} |\n`;
 md+=`\n**${l.story.resolution[0].speaker}**：${l.story.resolution[0].text}\n\n首通：经验册 ${l.firstClearReward.experience_book}、铜钱 ${l.firstClearReward.copper_coin}、精铁 ${l.firstClearReward.refined_iron}。${l.unlockHeroId?`解锁 ${heroNames[l.unlockHeroId]}，赠一次性追赶培养。`:''}${l.unlockCampType?`解锁军营 ${l.unlockCampType}。`:''}重复奖励与首次最高星差额按数值文档每日上限和幂等规则执行。\n\n`;
}
md+=`## 关卡验证与制作流程\n\n每次改关先改 JSON，再生成此文档，避免表格与实际出兵数分叉。以固定种子、推荐段下限培养、默认白/绿/蓝装备和 1/2/3 人队各自系数运行脚本，记录清兵密度、无双击破、首领 TTK、军粮消耗、漏兵、总时长、CPU 峰值；仿真之后再做真机盲玩。以下开发切片已完成并连接六十关主线，后续保留为增量回归与真实设备验收路线。指定解锁、培养和战术策略的自动通关证据见交付检查记录；仍需真实玩家与多种阵容验收。\n\n1. 先落地魏 1 至 4 纵向切片，验证一名/两名武将、首领预警与投石经济。\n2. 魏 5 至 20 完成 4 地图、三出战位、重甲/弩兵与培养闭环。\n3. 蜀 20 关增加团队增益、军旗手与山地/渡口，验证新将追赶。\n4. 吴 20 关增加火油/持续技能/攻城车与水寨，完成终局叙事。\n5. 所有解锁链、首通及星级差额奖励做幂等测试；低档手机峰值同屏预算 160 个敌军，临界状态以明确出兵排队保规则，不隐形丢敌。\n\n## 后续扩关契约\n\n追加新章使用新的 chapterId；旧 levelId、地图 ID、英雄 ID 不重编号或覆盖存档意义。每个新章可定义任意关数，列表读取 chapter.levelIds.length，不写死三个章节或二十按钮。追加第四章时保留现有三卷结局，增加独立序章和解锁条件。数值新段另加 S13 起的 profile，不能把老 S01 至 S12 原地抬高逼迫回流玩家。\n\n每次内容扩展同时提交地图路径、营位、波次、故事对白、奖励、资产 manifest、存档迁移、完整校验和回滚版本。事件关使用 eventId+levelId、有效期与内容版本，不覆盖常驻关；奖励通过一次性事件领取记录执行。运营与兼容要求见 [游戏开发设计](game-development.md) 的长期运营章节。\n`;
md=md.replace('真实历史 chronology','真实历史年表')
 .replace('各波的已解析人数已包含段位 countMultiplier，不再乘第二次。',`各波的已解析人数已包含段位 countMultiplier 和本轮敌潮密度 ${densityMultiplier} 倍，不再乘第二次；出兵窗不同比放长，因此增加的是真实在场敌军压力而非背景装饰兵。countsAlreadyIncludeDensity=true 和 generationFacts 用于防止运行时二次增兵。`)
 .replace('每波分三个显式兵团，兵团开始时间、持续时间与各兵种数量全部列入 JSON。','每波分三个显式兵团，兵团开始时间、持续时间与各兵种数量全部列入 JSON。按同屏真实敌军上限 160 设计容量，已到出兵时间但暂未入场的兵仍保留队列、继续阻止清波；界面分别显示在场和待入场，不删除或伪造敌人。')
 .replace('常规关战斗时间目标 3 至 5 分钟，幕末目标 4.5 至 6 分钟；','支持 1×、1.5×、2×战斗速度；暂停、布阵、战术选择与引导冻结不推进。首次教程以 1×教学，音乐、音高、提示文字使用现实时间；完整关卡时间仍以战斗秒统计。常规关战斗时间目标 3 至 5 分钟，幕末目标 4.5 至 6 分钟；')
 .replace('以固定种子、推荐段下限培养','新增密集敌潮与低伤控制塔后，必须对比同建塔主动施放/不施放无双的耐久、漏兵和时长，并检查清场后另一侧仍有压力；指定策略的六十关及无双对照已完成自动仿真，结果见交付检查记录；多种阵容和真人时机仍待验证。以固定种子、推荐段下限培养')
 .replace('| 魏 3 | 夏侯惇、投石营、第二阵位 | 聚怪与范围伤害 |','| 魏 2 通关 / 魏 3 入场 | 第二阵位，可用曹操协战 | 两将队列与个人怒气 |\n| 魏 3 通关 | 夏侯惇、投石营 | 聚怪与范围伤害 |')
 .replace('张辽 / 司马懿 | 贯穿压阵 / 谋策减弱','张辽 / 司马懿 | 贯穿压阵 / 延迟落雷与减速')
 .replace('火场、点杀、突围、持续清场、精锐收尾','火场、点杀、箭雨易伤、持续清场、预判伏兵')
 .replace('新将一次性培养至解锁关推荐等级段下限，装备使用免费基础件；','新将一次性培养至解锁段与账号最高已达段推荐等级下限的较大者（不超过 Lv30），另赠四件白装 Lv0 基础件；')
 .replace('固定为本段下限等级及公共装备预设','固定为本段下限武将/技能等级、主武器推荐下限品质与等级、其他三槽白装 Lv0；配置中有显式装备字段及公共预设 ID')
 .replace('星级附加资源只按历史最高星新增差额，重复三星不能再领首通奖励。','二星和三星各新增首通基础资源的 10%，逐币种逐星向下取整，只支付历史最高已领奖星新增差额；重复三星不能再领首通奖励。首次通关不占重复奖励次数，之后重打每日全账号前三次可另得小奖励。')
 .replace('| 弩兵 | 魏 7 |','| 扰阵弓手 | 魏 7 |')
 .replace('步/骑/甲/弩/旗/车分别表示步兵、骑兵、重甲、弩兵、军旗手、攻城车','步/骑/甲/弩/旗/车分别表示步兵、骑兵、重甲、扰阵弓手、军旗手、攻城车')
 .replace('每次改关先改 JSON，再生成此文档','每次改关先改 scripts/generate-level-design.mjs 的剧情、地图与编成来源，再生成关卡 JSON 与此文档')
 .replace('默认白/绿/蓝装备和 1/2/3 人队','主武器推荐下限品质/等级（其余三槽白装 Lv0）和 1/2/3 人队')
 .replace('版本 1.0 可玩开发版','版本 1.1 可玩开发版')
 .replace('## 首领母型与剧情收束','每次胜利（含重复通关）另获一个武器宝箱，失败没有宝箱；材料每日重复收益上限不限制宝箱。白/蓝/紫/红/金概率固定为 45%/30%/17.5%/5%/2.5%，在唯一胜利结算中抽取并保存，开箱仅揭示已保存结果。金专武不作为主线通关门槛。六类军营科技按已达关卡分段开放 Lv0–10，战前研究、开战固定快照；不会增加投石攻击频率或范围伤害目标上限。完整规则见 [科技与装备成长设计](progression-design.md)。\n\n## 首领母型与剧情收束')
 .replaceAll('重复奖励与首次最高星差额按数值文档每日上限和幂等规则执行。','重复材料收益按全账号每日前三次上限执行，最高星新增差额按幂等规则支付；每次胜利另获一个宝箱。');
await writeFile(path.join(directory,'level-design.md'),md,'utf8');
console.log(`Generated ${levels.length} levels, ${maps.length} map templates, ${levels.reduce((n,l)=>n+l.waves.length,0)} explicit waves.`);
