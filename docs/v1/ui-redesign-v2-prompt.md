# 实现任务：无双守关 UI 修正稿 v2

你要在一个已有的竖屏塔防网页游戏里，按设计稿实现三处界面改版：征战首页、武将详情、工坊。请先通读下面列出的文件，再动手。

## 项目背景

- 纯原生 JS（ES modules）+ CSS，没有框架，也没有第三方依赖。不要引入新依赖。
- `scripts/build.mjs` 会把游戏打包成离线单文件 `dist/index.html`。新增的 JS 模块或 CSS 文件必须加进 `build.mjs` 的 `profiles` 列表。
- 测试用 `node --test`，DOM 是模拟的（见 `tests/campaign-app.test.js` 里的 `boot()` 和 `Element` 实现）。模拟 DOM 只支持基础 API：`textContent`、`hidden`、`classList`、`style.setProperty`、`querySelectorAll`、`click`、`createElementNS`、`innerHTML`（解析很简单）。测试里的 `clickText` 只会点“可见”的按钮。
- 美术全部是本地 SVG data URI。`hero-portraits.js` 提供 `heroPortrait(id)`，`equipment-art.js` 提供 `equipmentIcon(templateId, quality)`，图标自带品质框、角花和菱形点。测试禁止 SVG 里出现 `href=`、`<script`、`onload=`、`<image`。
- 工作区里有大量未提交的改动，属于上一轮重构。不要回滚，也不要整体重写这些文件，在现有代码上增量修改。不要自行 commit。

## 必读文件

1. `docs/v1/ui-redesign-v2.html`：本次设计稿，以它为准。可以直接用浏览器打开，三块 360×740 样机都能操作。样式、尺寸、文案、动效可以照抄它的 CSS 和 JS 片段。
2. `docs/v1/ui-redesign.html`：上一版设计稿。色板、token、动效规范沿用这一版。
3. `index.html`：大厅 DOM 结构。
4. `campaign-app.js`：大厅逻辑，重点看以下函数：
   - `renderCampaign`、`renderMarch`、`marchPoint`、`renderLevelDetail`、`renderParty`、`heroPower`：征战首页
   - `openIntel`，以及长按逻辑（搜 `pointerdown` / `pressTarget`）
   - `showHero`、`showEquipmentPicker`、`statBar`、`openModal`：武将详情
   - `renderWorkshop`、`showSalvage`、`showBulkSalvage`、`gearIcon`：工坊
   - `renderLootResult`：结算掉落
5. `ui-v2.css`：当前样式层，token 定义在 `:root`。`campaign.css` 是更早的底层样式，里面有一些规则会和新样式冲突，比如 `.segmented button{min-height:44px}`。
6. `campaign-state.js`：存档和养成接口，例如 `getHero`、`getEquipmentUpgradeCost`、`upgradeEquipment`、`trainHero`、`trainSkill`、`getInventory`、`salvageEquipment`。
7. `v1-engine.js` 约第 119 行：装备数值公式（`qualityFixedBonuses` + `perLevelBonuses`）。数据在 `runtime-data.js` 的 `BALANCE.metaProgression.equipment`。

## 要实现的内容

### 一、征战首页（一屏，不滚动）

从上到下依次是：
1. 顶栏（不变）。
2. 关卡信息卡：
   - 顶行写“魏篇 · 第 N 阵 + 细进度条 + 已通关数/20”。
   - 第二行是关卡名，星级紧跟在关卡名后面。
   - 第三行是一行不换行的胶囊：波、将、帅（仅敌将关显示）、赏。
   - 卡片右上角放「关卡详情」按钮（地图图标 + 文字）。
3. 焦点地图，高度弹性，最小 150px：
   - 只画选中关和它的下一关。
   - 选中关 84px，带两圈错相涟漪和插旗。
   - 下一关 46px，压暗；如果是敌将关，用压暗的朱砂色“帅”。
   - 一段金线从左下进入选中关，再用虚线连向下一关，虚线继续淡出到右上。
   - 选中关下方用书法字写关名，再一行小字：“当前关 · 长按看情报”，已通关的关卡写“已通关 · 可再战”。
   - 右下角是小金点，加“已行 N 阵”。
   - 本章最后一关没有下一关时，显示“下一章 · 蜀篇 · 第 1 阵”。
4. 出战武将行（已经实现过：叠放头像 + 总战力 + 翠色整备方钮），保持不变。
5. 出阵主按钮 + 底部导航。

关卡详情弹层：
- 从底部弹出，包含章节标签（`#chapter-tabs` 移进来）、整章 20 节点的行军路线（现有 `renderMarch` 和 `#march-map` / `#level-grid` / `#march-route` 移进来）和图例。
- 点节点：选中该关，弹层收起，首页的卡片和焦点地图切到该关。
- 长按节点：打开战前情报（沿用 `openIntel`）。
- 焦点地图上长按当前关，同样打开战前情报。

情报入口：
- 首页上可见的「情报」药丸去掉。
- `#intel-button` 保留，用来照顾键盘和读屏用户：平时视觉隐藏，获得焦点时显示（`:focus-visible`）。
- 前三关在焦点地图上显示一次“长按看情报”的提示。

### 二、武将详情（一页，不滚动）

- 改成整页：在 `#lobby-modal` 上加 `is-page` 变体，全屏、无圆角、无拖拽把手、左上角是返回按钮。复用现有的 `openModal` / `closeModal` 和焦点管理，不要另起一套弹层系统。
- 标题栏：返回、武将名（书法字）、阵营色块、定位短语，以及右侧的 ‹ n / 总数 ›，用来在已拥有的武将之间翻页。
- 头顶是大号战力数字（宋体，金色渐变）。下面一行四个属性胶囊，不换行：
  - 攻击：普攻伤害 ×（1 + 武器加成）
  - 射程：基础射程 + 战马加成 + 专属加成
  - 攻速：普攻间隔
  - 守城：铠甲给全队的城关耐久加成 %
  - 数值必须用引擎的同一套公式计算，能复用引擎函数就复用，不要自造。
- 中间：立绘圆章约 176px，带阵营色光晕和旋转金环；下方是“Lv + 经验条 + 升级”小胶囊。左侧是武器、铠甲两格，右侧是兵符、战马两格。每格是 64px 的统一装备格（见第四部分），下面标槽位名。
- 点装备格：在页内弹出卡片，内容是图标、名称、品质、强化等级、一句效果（专属效果写在这里），以及三颗按钮：换装（`showEquipmentPicker`）、强化、升品（红色和金色时置灰）。原来的“专属装备与培养建议”折叠段落删除。
- 技能卡：
  - 左侧是 110×92 的预览，进入页面自动播放一次，可以点重播。需要按 15 名武将技能的真实形状各画一个示意：扇区横扫、圆形、直线冲锋、三连穿、延迟落雷、拉拢圈、地雷、箭雨、点杀等。形状参数在 `BALANCE.heroes[id].ultimate.shape`，`v1-renderer.js` 里有 15 种技能几何可以参考。
  - 右侧是技能名（书法、翠色）、5 颗菱形等级点、一句话说明和 2–3 个效果标签。
  - 数据里没有技能说明。请新建模块 `hero-skill-copy.js`（记得加进 `build.mjs`），按每个技能的实际参数为 15 名武将各写一句说明和标签，并在文件顶部注释“文案待审”。
- 底部有两颗次级按钮，并排放：「升级 Lv N+1」「技能 Lv N+1」，第二行小字写费用。再下面是一颗翠色主按钮「一键强化装备」：
  - 角标是可强化的格数，第二行小字是总费用。
  - 规则：默认选择最适合角色的装备并进行升级，尽量做到游戏的最优解，让玩家能够无脑玩游戏。按单价从低到高，每格 +1；资源不够就停下，提示“已强化 x / y 格”；满级的格子跳过；全部满级时置灰。
  - 动效：四格依次弹跳，每格飘出 +1，战力滚动上涨并飘出 +差值。
- 战力：统一成一个只用于展示的函数，覆盖等级、技能和四个装备格，首页和详情页共用。`campaign-app.js` 现有的 `heroPower` 只算了主武器，需要扩展。战力不影响战斗，也不写进存档。

### 三、工坊

- 修分段标签“文字偏下”的问题。根因是轨道 42px、内边距 4px，只剩 34px，而 `campaign.css` 给按钮设了 `min-height:44px`。修法：轨道改为 52px；按钮 `height:100%;min-height:0;display:grid;place-content:center;line-height:1`；背包数量做成右侧小角标。
- 背包工具栏合成一行：
  - 左边是分段筛选：“全部”加武器、铠甲、兵符、战马四个图标，每个带数量角标。
  - 右边是朱砂色小按钮「清理 N」，沿用 `showBulkSalvage`。
- 工具栏下面一行：左边写“N 件 · 闲置 M”，中间是品质色图例，右边是「ⓘ 掉率」按钮，点开后浮层显示掉率。原来的掉率 `<details>` 删除。
- 背包上限（4000）平时不显示。数量 ≥ 3900 时才出现朱砂提示。
- 背包列表改成四列等大装备格，名称一行省略显示，名称颜色用品质色。
- 底部常驻详情条：显示 56px 装备格、名称、品质、强化等级、效果，以及穿戴者或“闲置”。按钮有两种情况：
  - 已穿戴：显示「去换装」，打开对应武将详情。
  - 闲置且非专属：显示「穿戴」和「分解」，分解沿用 `showSalvage`。
- 科技改成单列等高行：进度环 + 书法字名称 + 宋体数字“Lv x / 10” + 每级效果 + 右侧研究按钮。所有“Lv”数字一律不用书法字体，因为书法字体子集里没有拉丁字母。
- 锻造区换成统一装备格（96px），布局可以参照设计稿简化。

### 四、统一装备格

写一个公共函数，例如 `gearTile(item, { size, showOwner, showExclusive })`，替换掉所有装备展示的地方：武将详情四格、换装选择列表、背包、背包详情条、锻造台、结算掉落（`renderLootResult`）。

- 图标用 `equipmentIcon`，它自带品质框。
- 格子上只叠三个固定位置的角标：右下是“+强化等级”（品质色描边），左上是穿戴者小头像，右上是“专”（金底），表示本人专属。
- 尺寸只有三档：96 / 64 / 56。
- 空格子是虚线框加“＋”。
- 每个格子都要有完整的 `aria-label`：名称、品质、强化等级、穿戴状态。

## 硬性约束

- 360×740 和 390×844 下，征战首页和武将详情页都不能出现纵向滚动（`#lobby-scroll` 的 `scrollHeight <= clientHeight`），也不能有横向溢出。
- 点击区域不小于 44px，可见文字不小于 12px（角标数字除外），对比度不低于现状。
- 所有动效都要遵守 `calm()`、`body.reduce-motion` 和 `prefers-reduced-motion`：减弱动态时去掉位移、涟漪、旋转、弹跳，只保留状态变化。
- 存档格式、养成规则、费用、战斗数值一律不改。
- 文案用简体中文，风格沿用现有文案和设计稿。

## 测试

现有测试依赖这些 id 和类名：
- `chapter-body`、`chapter-tabs`（3 个按钮）、`level-grid`（20 个按钮，恰好 1 个 `.is-current`）、`march-route`（2 条 path）、`map-preview`（2 条 path）
- `intel-button` / `level-intel` / `intel-title` / `intel-close`
- `party-slots` 下的按钮，以及其中的名字文本
- `hero-roster`（15 个按钮）
- 武将详情：`modal-title` 含武将名；`.gear-row` ×4；正文含“城关最大耐久”；`.training-action` ×2
- `technology-card` ×6、`forge-template`、`.equipment-card`、`.salvage-button`
- 结算相关的一组 `result-*` id

规则：
- 能保留的 id 和类名尽量保留，比如四个装备格同时带 `gear-row` 类、升级和技能按钮带 `training-action` 类。
- 如果设计确实需要改结构，比如章节标签移进弹层后测试要先打开弹层，就同步修改测试。每删一条断言，都要用等价的新断言替代。
- 为新行为补测试：焦点地图只渲染当前关和下一关；关卡详情弹层里选关会更新首页；一键强化装备的扣费、停止条件和满级置灰；战力函数覆盖四个装备格；背包筛选的数量角标；统一装备格的 `aria-label`。

## 验证（全部通过再交付）

1. `npm test`：全部通过。上一轮是 202 / 202，新增测试也要通过。
2. `npm run build`：成功，`dist/index.html` 离线可用。
3. `node scripts/playtest/audit.mjs v2-impl`：在真实无头 Chrome 里截图。检查 `docs/v1/playtest/v2-impl/report.json`：所有屏 `horizontalOverflow:false`，没有新增的小字和小点击区域，`errors` 为空。逐张看截图，和 `docs/v1/ui-redesign-v2.html` 的样机比对。另外再补截武将详情页和关卡详情弹层。
4. 交付时说明：
   - 改了哪些文件
   - 哪些测试断言改了、为什么改
   - 截图检查发现并修掉的问题
   - 15 条技能文案的位置，提醒需要人审
   - 没能验证的部分
