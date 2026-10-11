import test from 'node:test';
import assert from 'node:assert/strict';
import { TutorialController } from '../tutorial.js';

test('tutorial requires a real deployment, full rage with enemies and a completed burst', () => {
  const guide = new TutorialController();
  assert.equal(guide.active,false);
  guide.reset();
  assert.equal(guide.freezesBattle,true);
  guide.advance();
  assert.equal(guide.step,'deploy');
  guide.handleEvent({type:'attack'});
  assert.equal(guide.step,'deploy');
  guide.handleEvent({type:'build'});
  assert.equal(guide.step,'gather');
  assert.equal(guide.freezesBattle,false);
  guide.update({state:'playing',rage:99,enemyCount:20});
  assert.equal(guide.step,'gather');
  guide.update({state:'paused',rage:100,enemyCount:20});
  guide.update({state:'playing',rage:100,enemyCount:0});
  assert.equal(guide.step,'gather');
  guide.update({state:'playing',rage:100,enemyCount:20});
  assert.equal(guide.step,'ultimate');
  assert.equal(guide.freezesBattle,true);
  guide.handleEvent({type:'ultimate'});
  assert.equal(guide.freezesBattle,false);
  guide.handleEvent({type:'burst',kills:27});
  assert.equal(guide.step,'complete');
  assert.match(guide.view.title,/27/);
  assert.equal(guide.freezesBattle,true);
  guide.advance();
  assert.equal(guide.active,false);
});

test('skip and replay are independent from combat; upgrading an existing camp avoids a guide dead end', () => {
  const guide = new TutorialController();
  for (const step of ['intro','deploy','gather','ultimate','burst','complete']) {
    guide.step = step;
    guide.skip();
    assert.equal(guide.active,false);
    assert.equal(guide.freezesBattle,false);
  }
  guide.reset(); guide.advance();
  guide.handleEvent({type:'upgrade'});
  assert.equal(guide.step,'gather');
  guide.handleEvent({type:'lose'});
  assert.equal(guide.active,false);
  guide.reset();
  assert.equal(guide.step,'intro');
  assert.equal(guide.burstKills,0);
});
