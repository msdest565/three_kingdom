# 无双守关素材来源记录

登记日期：2026-10-11。以下对应当前本地开发版实际使用的程序资源，供交付追溯；不代表已办理著作权登记、平台审核或商业发行权利清理。项目未设置一份对外开源许可，此表不另行授予代码或资源分发权。

| 资源 | 来源与源文件 | 当前使用方式 |
| --- | --- | --- |
| 十五位武将头像 | 本项目原创程序 SVG，`hero-portraits.js` | 本地 SVG data URI，按武器、服饰与轮廓区分；无外部图像引用 |
| 固定阵位武将、敌军、六营、技能效果 | 本项目原创 Canvas 绘制，`battle-sprites.js`、`v1-renderer.js`、`renderer.js`；造型来源 `hero-portraits.js` 的 `PORTRAIT` | 程序绘制按状态、帧与 DPR 缓存到离屏 canvas；无新增位图文件或远程资源 |
| 十二地图主题、道路、营位与装饰 | 本项目原创 Canvas 绘制，`v1-renderer.js`；路线数据见 `docs/v1/data/levels.json` | 根据本地配置绘制 |
| UI、图标与 favicon | 本项目编写的 HTML/CSS/SVG，入口与样式文件、`favicon.svg` | 自包含本地资源 |
| 战报分享卡（1080×1350） | 本项目原创 Canvas 绘制，`share-card.js`；武将头像复用 `hero-portraits.js` | 玩家本地生成并保存的 PNG，程序边框、阵营色与系统字体文字；无远程图片或字体 |
| 音效与循环音乐 | 本项目原创 Web Audio 合成，`audio-system.js` | 振荡器、噪声和程序节奏，含技能蓄势、怒气就绪、城门受击、连斩里程碑与各武将无双音色及菜单/战斗/首领场景配乐；无下载歌曲、影视配乐、采样库或录制配音 |
| 设计风格板 | 本项目可编辑 `docs/v1/art-style-board.svg` 及其 PNG 阅读输出 | 制作参考，未作为完整生产角色包 |
| 书法标题字体 Ma Shan Zheng（马善政毛笔楷书）Regular 2.001 | Copyright 2018 The MaShanZheng Project Authors（https://github.com/googlefonts/mashanzheng），作者 ZhongQi / 正启字库；取自 Google Fonts（fonts.gstatic.com），取得日期 2026-10-14 | SIL Open Font License 1.1，全文见 `assets/fonts/OFL.txt`。由 `scripts/build-font.py` 按界面实际用字子集化为 WOFF2，并内嵌为 `brush-font.css` 的 data URI；仅用于标题、按钮与战斗横幅。子集为修改版，未使用保留字体名对外单独分发，字体不单独出售 |

上述程序资源由本次开发协作编写生成，源工程即对应代码或 SVG；没有引用外部角色照片、商用角色素材包或远程图片。除上表登记的 OFL 书法字体外，正文仍使用浏览器系统字体栈。文档中的官方说明链接用于资料引用，不是运行素材依赖。

后续引入图片、字体、音乐、配音、外包或 AI 辅助位图时，逐项补充资源 ID、作者/供应方、来源 URL 或合同、取得日期、原许可文本、修改与分发条件、署名要求及授权证明。精修立绘、逐帧动画图集和录制配乐尚未生产，本记录不作为未来素材的授权证明。
