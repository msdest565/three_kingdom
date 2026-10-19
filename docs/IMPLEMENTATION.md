# 无双守关实现维护指南

更新：2026-10-20。剧情主线与肉鸽无尽 P0–P5、选卡短屏修复均已实现。当前功能与待验事项以 [项目状态](PROJECT-STATUS.txt) 为准，阶段记录集中在 [开发摘要](DEVELOPMENT-HISTORY.txt)，验证范围见 [交付检查](v1/delivery-checks.md)。本地开发版尚未完成真实手机、TapTap 宿主与真人长局平衡验收。

## 启动与生成链

使用 Node.js >=20（最近验证为 24.21.0），原生 JavaScript + ES Modules，无第三方运行依赖。在仓库根目录执行：

~~~powershell
npm run data:build
npm run dev
~~~

`http://127.0.0.1:4173/` 是主游戏，`/prototype.html` 是保留的关羽单关原型。`npm run build` 生成自包含的 `dist/index.html` 与 `dist/prototype.html`；本地构建不包含提交、部署或平台审核。

**`runtime-data.js` 是生成物，禁止直接编辑。** 数值源是 `docs/v1/data/balance.json` 的 `v1Baseline`，内容源是 `docs/v1/data/levels.json`；修改源 JSON 后运行 `npm run data:build`。`npm test` 的 `pretest` 及 `npm run build` 也会重新生成。

剧情关卡和关卡文档由 `scripts/generate-level-design.mjs` 生成；改剧情、地图或生成规则时修改生成器，再执行 `npm run docs:levels`，不要只改随后会被覆盖的表格。仅维护文字时可用 `npm run docs:levels -- --docs-only`，避免重写关卡 JSON。成长文档由 `npm run docs:progression` 从数值源生成。`npm run docs:build` 生成文档阅读器；生成产物不能代替源文件。

## 代码地图

| 文件 | 维护边界 |
| --- | --- |
| `campaign-app.js` / `campaign.css` / `index.html` | 主游戏界面、编队、成长、结算、设置、选择卡片与事件接线 |
| `campaign-state.js` | schema 3 存档、schema 2 等价迁移、成长事务、奖励账本、备份/导入与跨标签冲突保护 |
| `v1-engine.js` | `reset()` 建立战斗状态和模式分支；营地、敌人、技能、伤害、波次与事件，不写 DOM 或永久奖励 |
| `endless-rules.js` / `roguelike-system.js` | 无尽程序波次、锚点、抽卡、重复获取、递减与属性聚合 |
| `hero-upgrade-*.js` / `camp-upgrade-*.js` / `synergy-*.js` | 武将专属、军营专精、羁绊与真实命中合击 |
| `endless-milestones.js` / `endless-telemetry.js` | 永久里程碑与本地调参记录；资源写入仍经 `CampaignStore` |
| `v1-renderer.js` / `roguelike-presentation.js` / `roguelike-presentation.css` | Canvas 与无尽演出；显式现实时间时钟，不在绘制中推进战斗 |
| `equipment-art.js` / `tactic-art.js` / `hero-portraits.js` / `battle-sprites.js` | 本地程序 SVG、卡面、头像和战斗精灵 |
| `audio-system.js` / `combat-clock.js` | WebAudio、限流/声部/压低音乐、固定战斗步长与现实时间反馈 |
| `app.js` / `game-engine.js` / `renderer.js` | 保留原型与绘制基础，参数不等于主游戏 |

## 必须保持的契约

- 剧情为 60 关、军营最高 3 级。无尽通过 `V1Game.reset()` 中的 `options.mode === 'endless'` 隔离，军营最高 5 级，L1–L3 原值不变。80 波是设计目标与奖励档位，城关不破可继续。
- 无尽实际目录为 136 卡：属性 26、军营 42、武将 60、羁绊 8；四羁绊、八组合击。保留原 22 战术稳定 ID，不把无尽增强回灌剧情或修改全局默认值。
- `BALANCE.tactics` 只有 48 项；无尽 `game.tacticDefinitions` 是 104 项兼容视图，`game.tacticCatalog` 才是 136 项完整目录。查卡用 `game.tacticDefinition(id)`，重复次数用 `tacticCounts`，不能只看 `tactics` Set。
- 美术统一入口 `equipmentIcon(...)`；`EQUIPMENT_ART_IDS` 仍是 34 个装备 ID，136 张卡遍历 `TACTIC_ART_IDS`，61 个主题符号遍历 `TACTIC_SYMBOL_IDS`。
- 新动效消费 `renderer.reducedMotion`、系统偏好及 `body.reduce-motion`；移除位移/旋转/缩放/震动，保留锁定、稀有度、合击名号、受击与数值信息。选卡三张卡和底部操作须完整可见，不恢复滚动或用裁切隐藏信息。
- 新音效/演出用 `presentation: 'roguelike'` 标记。`heroCombo` 是双将合击，`combo` 是连斩；`CombatClock.triggerImpact(durationSec, factor)` 控制时间反馈，不是镜头振幅。
- 使用 [无尽设计 v3](roguelike-endless-design-v3.html) 附录 A 的修正名称。曲线以 `docs/data/endless-curve.mjs` 的函数和输出为依据；已知差异见项目状态，不凭旧正文反改实现。
- 存档仍为 schema 3，主键 `wushuang-guard-campaign-v2`。成长、装备、里程碑奖励经 Store 事务处理，保留防重、收据、回滚及 `stale_save_revision`；不要由 UI 直接增资源。无尽调参使用独立本地键，旧日志格式不改。

## 修改后的验证

~~~powershell
node docs/v1/data/validate-balance.mjs
npm run docs:validate
node docs/data/endless-curve.mjs
npm test
npm run build
~~~

全量 `npm test` 包含六十关固定策略仿真，通常需 5–8 分钟。不得删改已有断言以取得通过；按改动新增有效覆盖。文档/生成器改动另执行适用的 `docs:levels`、`docs:progression`、`docs:build`，明确要重算派生算例时才用 `validate-balance.mjs --write-derived`，并审查生成差异。

最近完整基线为 **486/486，54 个测试文件**，证据入口为 [verification/latest.json](verification/latest.json) 与 [完整日志](verification/npm-test.log)。真实浏览器已检查卡面与短屏选卡；这不代表自然打通 80 波、真实手机、主观听感或平台发行已验收。浏览器 QA 使用独立内存存档，不覆盖用户真实进度。素材增补同步 [素材来源记录](ASSET_LICENSES.md)。工作区含未提交与未跟踪实现，交接须保留完整工作区，不能仅复制 Git HEAD。
