# 无双守关文档入口

更新：2026-10-20。本地可玩开发版已完成剧情 60 关、15 武将、12 地图、6 类军营与肉鸽无尽 P0–P5；最新修复为三卡无滚动选卡界面和右下角图标锁。剧情军营上限 3 级，无尽上限 5 级；无尽 136 卡、4 羁绊、8 组合击，80 波后可继续。

接手优先读 [项目状态](../PROJECT-STATUS.txt)、[实现维护指南](../IMPLEMENTATION.md) 和 [交付检查](delivery-checks.md)。只需追溯关键历史时再看 [开发摘要](../DEVELOPMENT-HISTORY.txt)，不要从旧阶段计划推断当前待办。

| 文档 | 用途 |
| --- | --- |
| [无尽设计 v3](../roguelike-endless-design-v3.html) | 肉鸽与无尽规格；先读附录 A 名称勘误，已实现差异以项目状态及可运行曲线为准 |
| [曲线脚本](../data/endless-curve.mjs) | `node docs/data/endless-curve.mjs` 复现曲线 |
| [游戏开发设计](game-development.md) | 剧情基础系统、架构、存档与平台适配 |
| [美术与音频设计](art-design.md) | 原项目表现设计；无尽扩展看 v3 第 13 节 |
| [数值设计](balance-design.md) | 原项目技能、成长与剧情经济 |
| [关卡与剧情设计](level-design.md) | 生成的剧情 60 关地图、波次、奖励与解锁 |
| [成长扩展设计](progression-design.md) | 生成的科技、锻造、装备、胜利箱与迁移规则 |
| [素材来源记录](../ASSET_LICENSES.md) | 资源来源与程序绘制资产说明 |

数据事实源为 [balance.json](data/balance.json) 的 `v1Baseline` 和 [levels.json](data/levels.json)。**不要直接编辑 `runtime-data.js`**；改源后运行 `npm run data:build`。剧情关卡改动先检查生成器，完整命令与代码职责见实现维护指南。

根目录使用 Node.js >=20：`npm run dev` 访问 `http://127.0.0.1:4173/`，`npm test` 自动生成配置后运行测试，`npm run build` 生成双入口离线包。`npm run docs:build` 生成 [离线设计阅读器](index.html)，该阅读器以五份基础设计为内容，不代替最新状态入口。

最近完整测试 **486/486 通过，54 个文件**；[验证摘要](../verification/latest.json)、[完整日志](../verification/npm-test.log)。已做程序 SVG、模拟 DOM/Canvas/AudioContext 与指定短屏浏览器检查。仍待真人多构筑长局、真实手机、低端设备性能、听感和 TapTap 宿主验收；配置齐备及自动测试通过均不代表发行或全面平衡。
