// Presentation-only discovery history. Campaign saves and battle state are untouched.
const KEY = 'wushuang-guard-hero-art-seen-v1';
export class HeroNameCards {
  constructor({storage=null,now=()=>performance.now()}={}) {
    this.storage=storage;this.now=now;this.cards=new Map();this.seen=new Set();
    try { const ids=JSON.parse(storage?.getItem(KEY)||'[]');if(Array.isArray(ids))this.seen=new Set(ids.filter(id=>typeof id==='string')); } catch {}
  }
  discover(ids) {
    let changed=false;
    for(const id of ids) if(!this.seen.has(id)){this.seen.add(id);this.cards.set(id,{fadeAt:this.now()+3000,end:this.now()+3300});changed=true;}
    if(changed)try{this.storage?.setItem(KEY,JSON.stringify([...this.seen]));}catch{}
  }
  show(id) { this.cards.set(id,{fadeAt:this.now()+1700,end:this.now()+2000}); }
  clear() { this.cards.clear(); }
  visible(reducedMotion=false) {
    const now=this.now(),out=new Map();
    for(const [id,card] of this.cards){
      if(now>=card.end){this.cards.delete(id);continue;}
      const alpha=reducedMotion?1:Math.min(1,(card.end-now)/(card.end-card.fadeAt));
      out.set(id,alpha);
    }
    return out;
  }
}
