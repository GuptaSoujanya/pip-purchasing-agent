import assert from "node:assert/strict";
import { test } from "node:test";
import { CatmullRomCurve3, Vector3 } from "three";
import {
  advanceWorldClock,
  wrapWorldRoutePhase,
} from "../src/components/purchasing-world";

const route = new CatmullRomCurve3([
  new Vector3(-3.8, -1.48, -6.12),
  new Vector3(0.45, 0.5, -16),
  new Vector3(4.7, -1.48, -24.568),
]);
function assertValidRoutePoint(phase: number) {
  assert.ok(Number.isFinite(phase) && phase >= 0 && phase < 1);
  const point = route.getPointAt(phase);
  assert.ok([point.x, point.y, point.z].every(Number.isFinite));
}

test("the first RAF can precede its scheduling timestamp without breaking Three.js route sampling", () => {
  const clock = advanceWorldClock(0, 1000.4, 1000);
  assert.equal(clock.elapsed, 0);
  assertValidRoutePoint(wrapWorldRoutePhase(clock.elapsed * 0.035));
  const following = advanceWorldClock(clock.elapsed, clock.timestamp, 1016);
  assert.equal(following.elapsed, 0.016);
  assertValidRoutePoint(wrapWorldRoutePhase(following.elapsed * 0.035));
});

test("non-finite clocks and route phases recover to valid Three.js positions", () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    const badNow = advanceWorldClock(1, 1000, invalid);
    assert.equal(badNow.elapsed, 1);
    assert.equal(badNow.timestamp, 1000);
    const recovered = advanceWorldClock(invalid, invalid, 1016);
    assert.equal(recovered.elapsed, 0);
    assert.equal(recovered.timestamp, 1016);
    assertValidRoutePoint(wrapWorldRoutePhase(invalid));
  }
  assertValidRoutePoint(wrapWorldRoutePhase(-0.002));
  assertValidRoutePoint(wrapWorldRoutePhase(-2.25));
  assertValidRoutePoint(wrapWorldRoutePhase(1.25));
});

test("pausing freezes elapsed time and long idle gaps cannot jump the route", () => {
  const paused = advanceWorldClock(4, 1000, 9000, true);
  assert.equal(paused.elapsed, 4);
  const resumed = advanceWorldClock(paused.elapsed, paused.timestamp, 9016);
  assert.equal(resumed.elapsed, 4.016);
  assert.equal(advanceWorldClock(0, 0, 60_000).elapsed, 0.05);
  assertValidRoutePoint(wrapWorldRoutePhase(resumed.elapsed * 0.035));
});
