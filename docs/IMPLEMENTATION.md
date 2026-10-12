# 无双守关 V1 实现维护指南

更新：2026-10-11。V1可玩开发版已接入：十五武将、六十关配置、十二地图和六营已连接运行程序。真实手机、TapTap 宿主、生产美术音频与完整体验验收仍待完成。测试与仿真结果以 [交付检查记录](v1/delivery-checks.md) 的日期和范围为准，配置完整不等于所有队伍均已平衡。

## 启动与产物

使用 Node.js 20 或更新版本，无第三方运行依赖。在仓库根目录执行：

~~~powershell
npm run data:build
npm run dev
~~~

打开 `http://127.0.0.1:4173/` 进入 V1 主线，`/prototype.html` 进入保留的关羽单关原型。源 HTML 使用 ES modules，开发时通过服务器访问。`npm run build` 导出自包含 `dist/index.html` 与 `dist/prototype.html`，两页均可双击离线运行，不依赖远程图片、字体或音乐。

静态部署时将 **dist 目录内容** 放入站点发布根目录，保留相对路径和 `.nojekyll`；项目子路径也应验证两入口。`docs/v1/index.html` 是设计阅读器，如需公开文档须另包含文档产物。本地构建不会自动提交、推送、部署或申请平台审核。

## 代码职责

| 文件 | 维护边界 |
| --- | --- |
| `campaign-app.js` / `campaign.css` | 主线选关、编队、科技/铁匠铺/背包、培养、开箱/结算、设置、导入预览与战斗 UI |
| `campaign-state.js` | schema 3 存档及 schema 2 数值等价迁移、校验迁移、备份、培养扣款、首通/星差额/每日收益与幂等结算 |
| `v1-engine.js` | 配置战斗、路线、六营、敌兵与首领、十五技能、三人怒气与队列、campTech 开战快照与专属效果；不写 DOM 或永久奖励 |
| `skill-targeting.js` | 方向几何边界区间与圆覆盖扫描；选当前合法目标的最大覆盖，不消耗战斗随机源 |
| `v1-renderer.js` / `hero-portraits.js` | 十二地图主题、固定阵位角色轮廓、六营、技能视觉及程序 SVG 头像 |
| `combat-clock.js` / `tutorial.js` / `audio-system.js` | 固定时步、引导与 Web Audio；声音及反馈使用现实时间 |
| `app.js` / `game-engine.js` / `renderer.js` | 保留原型与可复用绘制基础；原型参数不等于主线参数 |
| `runtime-data.js` | 从设计 JSON 生成的运行配置，不手工编辑 |

当前版本为 `1.1.0-alpha.1` / `v1.1-alpha-20261011-r1`。四槽装备支持强化、普通白→蓝→紫→红升品、锻造、背包跨将换装和未穿戴分解；来源槽为空，替下物留在背包。金色仅十五件专武，只能从胜利箱取得，不能锻造或升金。专属物品匹配本人激活额外效果；不匹配仍计基础品质与强化。十五匹红色专属坐骑 S11 可锻造。每次胜利一箱、重复胜利也发、失败不发，无保底；材料每日前三次重复收益软限制不限制箱子。

实际 `CampaignStore` 接口为 `getTechnologyCost()` / `researchTechnology()` / `getBattleTechnology()`、`getInventory()`、`getForgeCost()` / `forgeEquipment()`、`equipEquipment()`、`salvageEquipment()`、现有 `upgradeEquipment()` / `promoteEquipment()`。先检查报价与门槛，再由一次状态事务扣款并保存，不能由 UI 独立改资源。战前通过 `getBattleTechnology()` 获取副本，以 `campTech` 传入 `V1Game`，装备按队伍描述符传入；引擎固定开战快照，后续研究与换装不回写当前战斗。

箱内抽取使用独立于战斗种子的随机源，在唯一胜利结算事务中生成物品、更新宝箱/统计账本并保存；揭示结果不再抽取。满仓仅回收本次新掉物。借将只在对应战斗有效，已有同名武将时使用自己的培养版本。每日材料收益仍采用本地日期软上限，不具备服务器防作弊能力。规则及全套数值表见 [成长扩展设计](v1/progression-design.md)。

2026-10-12 体验补丁：引擎 damage 事件携带实际扣血、目标 ID 与施放 ID，kill 事件携带死亡位置快照；Canvas 以真实事件合并跳字并绘制独立死亡表现，不能向引擎添加尸体或替代活兵。Audio 的战斗去重在 start 事件清空，防止重新挑战时复用敌兵 ID 导致无声。实际 ultimate 事件触发 CombatClock 的短现实时间慢动作，保留 1×/1.5×/2× 偏好和全体同步，排队请求不触发演出；减少动态关闭慢动作和强闪震。协战技能为右侧独立触控列，原武将阵位与技能原点不移动。

## 数据与新增内容

`docs/v1/data/balance.json` 的 `v1Baseline` 保存规则与培养参数，`docs/v1/data/levels.json` 保存章节、地图、关卡和波次。关卡生成器 `scripts/generate-level-design.mjs` 是剧情、地图及关卡生成逻辑来源。`scripts/build-runtime-data.mjs` 导出运行 JSON，`npm test` 的 pretest 和 `npm run build` 都会刷新它。`scripts/write-atomic.mjs` 先完整写入唯一临时文件再替换目标，供运行数据、静态资源及自包含 HTML 构建共用，避免并发构建读到半份文件。

新增内容沿用独立 `heroId`、`chapterId`、`levelId`、`mapId`、`growthTierId` 与军营 ID，不复用已发放 ID。新武将还须增加技能执行/自动目标规则、头像、Canvas 轮廓、解锁与验证；当前引擎按技能机制处理，不会只凭技能名称实现任意新技能。新地图须同步路径、营位、主题绘制与引用；波内人数已在生成阶段完成倍率，运行时不能重复放大。新章须审查 UI 中的势力名称与映射。

仅改规则不必自动升级存档 schema，改变存档含义须明确迁移。实际完整结构以 `campaign-state.js` 和 `exportSave()` 为准，不使用设计文档的节选 JSON 当作可导入存档。主线键为 `wushuang-guard-campaign-v2`，上一有效备份为其 `-backup` 键，旧原型键为 `wushuang-guard-v1`。未来版本只读保护、损坏档备份恢复及存储失败提示须保留。schema 2 的 white/green/blue/purple 映射到 white/blue/purple/red，品质数值等价、强化等级与原资源/关卡/编队/领奖账本/统计幂等保留，科技初始化为零，不追补旧宝箱；迁移前原数据保留备份。导入先验证并预览，再由玩家确认替换。

## 修改后的验证

~~~powershell
node docs/v1/data/validate-balance.mjs
npm run docs:progression
npm run docs:validate
npm test
npm run build
npm run docs:build
~~~

若明确修改派生算例，再运行 `node docs/v1/data/validate-balance.mjs --write-derived`。若修改数值影响波次、奖励或摘要，或修改关卡生成器，应先执行 `npm run docs:levels`，随后运行 npm run docs:progression 生成完整成长规则，再交叉校验、测试和构建。审查生成差异，防止只改产物后被下次生成覆盖。

规则与存档测试覆盖实际机制，界面集成在模拟 DOM/Canvas/AudioContext 中执行打包脚本，属于自动回归证据。本轮未执行浏览器或 localhost 界面测试。零科技推荐下限与科技成长连续账号审计分开报告，实际新账号的六十关连续培养与领奖审计见 [playable-audit.json](v1/data/playable-audit.json)：无重复刷关或材料注入，正常解锁，关羽/夏侯惇/曹操推荐下限与固定 mode6 建设策略；结果为六十关胜利及十五首领击杀。具体版本、资源和测试计数以交付记录为准，该结果不覆盖所有队伍或真人操作。

发布前另验证浏览器布局、真机触控/外放、首关引导、三技能队列、后台恢复、离线存储、导入导出及不同练度队伍；TapTap 还需要实际 SDK 和宿主能力测试。当前资产为原生 SVG、Canvas 与 WebAudio，精修素材仍待生产。素材新增时同步 [素材来源记录](ASSET_LICENSES.md)。

后续章节、武将、地图与成长段通过 manifest 扩展，不把六十关写成永久目录上限。新增内容须同步解锁、资源预算、技能行为、绘制和回归；存档语义变化须迁移，背包换装、跨将转移与随机掉落已实现，后续活动与可信服务器结算须独立设计和实现。
