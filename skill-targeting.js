// Maximum live-target circle coverage, including each unit's collision radius.
// Sweep intersection intervals on every feasible-circle boundary: O(N² log N),
// rather than checking every pair intersection against the whole army (O(N³)).
const TAU = Math.PI * 2;
const EPS = 1e-8;
const normalize = angle => (angle % TAU + TAU) % TAU;

// Optional center constraints: a reachable disk and excluded disks around earlier
// casts. Their boundaries participate in the same exact sweep; filtering enemy
// centers alone would miss optima on a reach/spacing boundary.
export function maximumCircleCoverage(units, radius, fallback, scoreFor, constraints = {}) {
  const boundaries = [];
  if (constraints.origin && Number.isFinite(constraints.maxDistance)) boundaries.push({ ...constraints.origin, radius: constraints.maxDistance, inside: true });
  for (const point of constraints.avoid || []) boundaries.push({ ...point, radius: constraints.minGap, inside: false });
  if (!units.length && !boundaries.length) return { ...fallback, count: 0 };
  const entries = units.map(unit => ({ x: unit.x, y: unit.y, radius: radius + (unit.radius || 0), score: scoreFor(unit) }));
  const center = entries.length ? entries.reduce((sum, e) => ({ x: sum.x + e.x / entries.length, y: sum.y + e.y / entries.length }), { x: 0, y: 0 }) : fallback;
  let best = { ...fallback, count: -1, score: -Infinity, distance: Infinity };
  const consider = (x, y, count, score) => {
    if (boundaries.some(boundary => boundary.inside ? Math.hypot(x-boundary.x,y-boundary.y) > boundary.radius+EPS : Math.hypot(x-boundary.x,y-boundary.y) < boundary.radius-EPS)) return;
    const distance = (x - center.x) ** 2 + (y - center.y) ** 2;
    if (count > best.count || count === best.count && (score > best.score + EPS || Math.abs(score - best.score) <= EPS && distance < best.distance - EPS)) {
      best = { x, y, count, score, distance };
    }
  };
  const evaluate = point => {
    let count = 0, score = 0;
    for (const e of entries) if (Math.hypot(point.x - e.x, point.y - e.y) <= e.radius + EPS) { count++; score += e.score; }
    consider(point.x, point.y, count, score);
  };
  // Natural interior centers keep sparse/full-cover casts visually on the army.
  evaluate(center); evaluate(fallback);
  for (const e of entries) evaluate(e);
  for (const anchor of [...entries, ...boundaries]) {
    let count = entries.includes(anchor) ? 1 : 0, score = anchor.score || 0;
    const events = [];
    for (const other of entries) {
      if (other === anchor) continue;
      const dx = other.x - anchor.x, dy = other.y - anchor.y, distance = Math.hypot(dx, dy);
      if (distance + anchor.radius <= other.radius + EPS) { count++; score += other.score; continue; }
      if (distance < EPS || distance > anchor.radius + other.radius + EPS || distance + other.radius < anchor.radius - EPS) continue;
      const cosine = Math.max(-1, Math.min(1, (distance ** 2 + anchor.radius ** 2 - other.radius ** 2) / (2 * distance * anchor.radius)));
      const half = Math.acos(cosine), direction = Math.atan2(dy, dx);
      const start = normalize(direction - half), end = normalize(direction + half);
      if (start > end) { count++; score += other.score; }
      events.push({ angle: start, delta: 1, score: other.score }, { angle: end, delta: -1, score: other.score });
    }
    // A legal interval may start/end at a constraint even when target membership
    // does not change. Evaluate all these intersections without changing scores.
    for (const boundary of boundaries) {
      if (boundary === anchor) continue;
      const dx=boundary.x-anchor.x, dy=boundary.y-anchor.y, distance=Math.hypot(dx,dy);
      if (distance < EPS || distance > anchor.radius+boundary.radius+EPS || distance < Math.abs(anchor.radius-boundary.radius)-EPS) continue;
      const half=Math.acos(Math.max(-1,Math.min(1,(distance**2+anchor.radius**2-boundary.radius**2)/(2*distance*anchor.radius))));
      const direction=Math.atan2(dy,dx);
      events.push({angle:normalize(direction-half),delta:0,score:0},{angle:normalize(direction+half),delta:0,score:0});
    }
    const pointAt = angle => ({ x: anchor.x + anchor.radius * Math.cos(angle), y: anchor.y + anchor.radius * Math.sin(angle) });
    const initial = pointAt(0); consider(initial.x, initial.y, count, score);
    events.sort((a, b) => a.angle - b.angle || b.delta - a.delta);
    for (let i = 0; i < events.length;) {
      const angle = events[i].angle; let end = i + 1;
      while (end < events.length && Math.abs(events[end].angle - angle) <= EPS) end++;
      // Closed shape boundaries include starting AND ending intervals at the event.
      for (let j = i; j < end; j++) if (events[j].delta > 0) { count++; score += events[j].score; }
      const point = pointAt(angle); consider(point.x, point.y, count, score);
      for (let j = i; j < end; j++) if (events[j].delta < 0) { count--; score -= events[j].score; }
      i = end;
    }
  }
  return { x: best.x, y: best.y, count: best.count };
}

// Greedy maximum new coverage; earlier hits are removed from scoring, while
// circle spacing is a true geometric constraint, not a post-selection nudge.
export function maximumSeparatedCircleCoverage(units, radius, count, minGap, fallback, scoreFor) {
  const circles = []; let remaining = [...units];
  for (let i=0;i<count;i++) {
    const point = maximumCircleCoverage(remaining,radius,fallback,scoreFor,{avoid:circles,minGap});
    circles.push({x:point.x,y:point.y,radius});
    remaining=remaining.filter(unit => Math.hypot(unit.x-point.x,unit.y-point.y) > radius+(unit.radius||0)+EPS);
  }
  return circles;
}

// Every change in rectangle/cone membership occurs at a geometric boundary.
// Build each unit's legal angular intervals, then sweep their overlap counts.
// This avoids both left-first ties and gaps between a fixed set of aim samples.
export function maximumDirectionalCoverage(units, origin, shape, base, scoreFor, inside) {
  const min = shape.angleMinRad ?? -Math.PI * .7, max = shape.angleMaxRad ?? -Math.PI * .3;
  const forward = Math.max(min, Math.min(max, -Math.PI / 2));
  const events = [];
  const probe = { ...base, angle: forward };
  const contains = (unit, angle) => { probe.angle = angle; return inside(unit, probe); };
  let best = { angle: forward, count: -1, score: -Infinity, interior: false };
  const consider = (angle, count, score, interior = false) => {
    if (count > best.count || count === best.count && (score > best.score + EPS || Math.abs(score - best.score) <= EPS &&
      (interior && !best.interior || interior === best.interior && Math.abs(angle - forward) < Math.abs(best.angle - forward) - EPS))) best = { angle, count, score, interior };
  };
  let forwardCount = 0, forwardScore = 0;
  for (const unit of units) {
    const score = scoreFor(unit);
    if (contains(unit, forward)) { forwardCount++; forwardScore += score; }
    const dx = unit.x - origin.x, dy = unit.y - origin.y, distance = Math.hypot(dx, dy);
    const radius = unit.radius || 0, polar = Math.atan2(dy, dx), angles = [min, max];
    const add = angle => {
      for (const turn of [-TAU, 0, TAU]) {
        const candidate = angle + turn;
        if (candidate >= min - EPS && candidate <= max + EPS) angles.push(Math.max(min, Math.min(max, candidate)));
      }
    };
    if (distance > EPS) {
      const back = Math.acos(Math.max(-1, Math.min(1, -radius / distance)));
      add(polar - back); add(polar + back);
      if (shape.shape === 'frontal_cone') {
        const half = shape.angleDegrees * Math.PI / 360;
        const correction = Math.asin(Math.min(1, radius * Math.cos(half) / distance));
        for (const delta of [half + correction, half + Math.PI - correction]) { add(polar - delta); add(polar + delta); }
        const side = Math.asin(Math.min(1, radius / distance));
        for (const delta of [side, Math.PI - side, Math.PI / 2]) { add(polar - delta); add(polar + delta); }
      } else {
        const side = Math.asin(Math.min(1, (base.width / 2 + radius) / distance));
        for (const delta of [side, Math.PI - side]) { add(polar - delta); add(polar + delta); }
        if (distance > base.length + radius) {
          const front = Math.acos(Math.min(1, (base.length + radius) / distance));
          add(polar - front); add(polar + front);
        }
      }
    }
    angles.sort((a, b) => a - b);
    const boundaries = angles.filter((angle, i) => !i || Math.abs(angle - angles[i - 1]) > 1e-12);
    const intervals = [];
    for (let i = 1; i < boundaries.length; i++) {
      const start = boundaries[i - 1], end = boundaries[i];
      if (!contains(unit, (start + end) / 2)) continue;
      if (intervals.length && Math.abs(intervals.at(-1).end - start) < 1e-12) intervals.at(-1).end = end;
      else intervals.push({ start, end });
    }
    for (const angle of boundaries) if (contains(unit, angle) && !intervals.some(v => angle >= v.start - 1e-12 && angle <= v.end + 1e-12)) intervals.push({ start: angle, end: angle });
    for (const interval of intervals) events.push({ angle: interval.start, delta: 1, score }, { angle: interval.end, delta: -1, score });
  }
  consider(forward, forwardCount, forwardScore, true);
  events.sort((a, b) => a.angle - b.angle || b.delta - a.delta);
  let count = 0, score = 0;
  for (let i = 0; i < events.length;) {
    const angle = events[i].angle; let end = i + 1;
    while (end < events.length && Math.abs(events[end].angle - angle) < 1e-12) end++;
    for (let j = i; j < end; j++) if (events[j].delta > 0) { count++; score += events[j].score; }
    consider(angle, count, score);
    for (let j = i; j < end; j++) if (events[j].delta < 0) { count--; score -= events[j].score; }
    if (end < events.length && events[end].angle - angle > EPS) {
      // Keep an equally productive cast slightly inside its winning interval;
      // grazing a moving unit at a boundary is fragile before a blade arrives.
      const next = events[end].angle, margin = Math.min(.03, (next - angle) / 2);
      const safe = Math.max(angle + margin, Math.min(next - margin, forward));
      consider(safe, count, score, true);
    }
    i = end;
  }
  return { angle: best.angle, count: best.count };
}
