/**
 * Guided play is presentation state; it never grants rage, food or combat bonuses.
 * One task at a time, always pointing at a real tappable object:
 *   intro   (replay only; on a first run the story overlay is the intro) → freezes
 *   deploy  camp panel on a highlighted real slot                         → freezes
 *   gather  live combat, coach bar only                                   → runs
 *   ultimate the real lead button pulses                                  → freezes until cast
 *   burst   card hidden so the sweep is unobstructed                      → runs
 *   complete short result line, auto-dismissed                            → runs
 */
export const TUTORIAL_COMPLETE_SEC = 3.5;
// The preserved prototype (app.js) keeps the original card flow; the V1 campaign opts into flow:'v1'.
const LEGACY_VIEWS = {
  intro: {number:1,title:'守住下方城关',copy:'敌军从上方两路来袭。城关耐久归零就会失守；先布好军阵，再用关羽横扫敌潮。',action:'开始布阵',target:'hp'},
  deploy: {number:2,title:'亲手部署一座军营',copy:'点击「布阵」或空营位，花 60 军粮建造军营。盾营聚敌，弓营迎击，投石营轰击成群敌军。',action:'选择空营位',target:'formation'},
  gather: {number:3,title:'让敌潮聚起来',copy:'军阵会自动攻击。交战时怒气更快积累；等无双就绪，再一刀破阵。',action:'',target:'rage'},
  ultimate: {number:4,title:'点按无双，一刀横扫',copy:'怒气已经蓄满！点按底部金色按钮，关羽会朝最密集的敌群挥刀。',action:'释放无双',target:'ultimate'},
  burst: {number:4,title:'青龙刀，破阵！',copy:'刀波正在推进，看看这一刀击破了多少敌军。',action:'',target:''},
};
export class TutorialController {
  constructor({ flow = 'legacy' } = {}) { this.flow = flow; this.reset(false); }
  reset(enabled = true, { startAt = 'intro' } = {}) {
    this.step = enabled ? (['intro', 'deploy'].includes(startAt) ? startAt : 'intro') : 'off';
    this.burstKills = 0;
    this.completeElapsed = 0;
    return this.step;
  }
  get active() { return this.step !== 'off'; }
  get freezesBattle() { return (this.flow === 'v1' ? ['intro','deploy','ultimate'] : ['intro','deploy','ultimate','complete']).includes(this.step); }
  advance() {
    if (this.step === 'intro') this.step = 'deploy';
    else if (this.step === 'complete') this.step = 'off';
    return this.step;
  }
  skip() { this.step = 'off'; }
  handleEvent(event) {
    if (!this.active) return;
    if (this.step === 'deploy' && ['build','upgrade'].includes(event.type)) this.step = 'gather';
    else if (this.step === 'ultimate' && event.type === 'ultimate') this.step = 'burst';
    else if (this.step === 'burst' && event.type === 'burst') {
      this.burstKills = event.kills ?? event.count ?? 0;
      this.step = 'complete'; this.completeElapsed = 0;
    }
    else if (['win','lose'].includes(event.type)) this.step = 'off';
  }
  update({state, rage, maxRage = 100, enemyCount = 0}) {
    if (this.step === 'gather' && state === 'playing' && rage >= maxRage && enemyCount > 0) this.step = 'ultimate';
  }
  /** Real (wall) seconds; returns true once the completion line has been shown long enough. */
  tick(realDt) {
    if (this.step !== 'complete' || this.flow !== 'v1') return false;
    this.completeElapsed += Math.max(0, Math.min(0.1, realDt || 0));
    return this.completeElapsed >= TUTORIAL_COMPLETE_SEC;
  }
  get view() {
    if (this.flow !== 'v1') {
      const legacy = { ...LEGACY_VIEWS, complete: {number:4,title:this.burstKills > 0 ? `这一刀，横扫 ${this.burstKills} 人` : '你已学会无双横扫',copy:'击破敌军可获得军粮，继续补营或升级。精锐可能挺过刀波，要靠军阵收尾。现在开始独自守关吧。',action:'继续守关',target:''} };
      return legacy[this.step] || null;
    }
    const views = {
      intro: {number:1,title:'守住下方城关',copy:'敌军沿道路从上方压来。先布军阵聚敌，再用关羽一刀横扫。',action:'开始布阵',target:'field'},
      deploy: {number:1,title:'在发光的营位布一座军营',copy:'弓营远射，盾营减速聚敌。花 60 军粮，选一个。',action:'选择空营位',target:'slot'},
      gather: {number:2,title:'等敌潮聚起来',copy:'军阵自动迎敌，交战时怒气更快。底部金条蓄满就能出手。',action:'',target:'rage'},
      ultimate: {number:3,title:'点按金色无双',copy:'怒气已满，敌群就在刀前。点按下方关羽，横扫这一片。',action:'',target:'ultimate'},
      burst: {number:3,title:'',copy:'',action:'',target:''},
      complete: {number:4,title:this.burstKills > 0 ? `这一刀，横扫 ${this.burstKills} 人` : '你已学会无双横扫',copy:'击破得军粮，可继续补营或升级。精锐可能挺过刀波，交给军阵收尾。',action:'知道了',target:''},
    };
    return views[this.step] || null;
  }
}
