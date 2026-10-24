import test from 'node:test';
import assert from 'node:assert/strict';
import { RagdollPhysics, RAGDOLL_STEP } from '../src/ragdoll.js';

function advance(ragdoll, duration, frame = 1 / 60) {
  for (let elapsed = 0; elapsed + 1e-8 < duration; elapsed += frame) ragdoll.step(Math.min(frame, duration - elapsed));
}

const snapshot = (ragdoll) => ragdoll.parts.map(({ body }) => [...body.position.toArray(), ...body.quaternion.toArray(), ...body.velocity.toArray()]);
const motion = (ragdoll) => ragdoll.parts.reduce((total, { body }) => total + body.velocity.lengthSquared() + body.angularVelocity.lengthSquared() * 0.05, 0);

function finiteConnected(ragdoll) {
  for (const { name, body } of ragdoll.parts) {
    assert.ok([...body.position.toArray(), ...body.quaternion.toArray(), ...body.velocity.toArray(), ...body.angularVelocity.toArray()].every(Number.isFinite), name);
    assert.ok(Math.abs(Math.hypot(...body.quaternion.toArray()) - 1) < 0.001, `${name} normalized quaternion`);
    body.updateAABB();
    assert.ok(body.aabb.lowerBound.y >= ragdoll.floor.position.y - 0.065, `${name} stays above the street contact plane`);
  }
  for (const joint of ragdoll.constraints) {
    const a = joint.bodyA.pointToWorldFrame(joint.pivotA);
    const b = joint.bodyB.pointToWorldFrame(joint.pivotB);
    assert.ok(a.distanceTo(b) < 0.065, `${joint.name} remains attached: ${a.distanceTo(b)}`);
  }
}

test('landing rig is an intact articulated body and sleeps without an active landing', () => {
  const ragdoll = new RagdollPhysics();
  assert.equal(ragdoll.parts.length, 13);
  assert.equal(ragdoll.constraints.length, 12);
  assert.equal(ragdoll.world.bodies.length, 14);
  const before = snapshot(ragdoll);
  advance(ragdoll, 2);
  assert.deepEqual(snapshot(ragdoll), before);
  assert.equal(ragdoll.time, 0);
  assert.equal(ragdoll.contacts, 0);
  ragdoll.dispose();
});

test('street contact folds the falling rig and dissipates motion into a stable pose', () => {
  const ragdoll = new RagdollPhysics();
  ragdoll.begin({ x: -6.4, velocity: -8, ground: 1.2 });
  const startingHead = ragdoll.byName.get('head').body.position.clone();
  const startingTorso = ragdoll.byName.get('torso').body.quaternion.clone();
  for (const { body } of ragdoll.parts) {
    body.updateAABB();
    assert.ok(body.aabb.lowerBound.y >= ragdoll.floor.position.y + 0.15, 'spawn does not penetrate the floor');
  }
  advance(ragdoll, 0.05);
  finiteConnected(ragdoll);
  assert.ok(ragdoll.contacts > 0);
  assert.ok(ragdoll.firstContactTime >= 0 && ragdoll.firstContactTime < 0.05);
  advance(ragdoll, 0.75);
  finiteConnected(ragdoll);
  const earlyMotion = motion(ragdoll);
  const torso = ragdoll.byName.get('torso').body;
  assert.ok(ragdoll.byName.get('head').body.position.y < startingHead.y - 1.1, 'the body physically falls');
  const alignment = torso.quaternion.toArray().reduce((sum, value, index) => sum + value * startingTorso.toArray()[index], 0);
  assert.ok(Math.abs(alignment) < 0.96, 'the torso tumbles instead of retaining flight pose');
  advance(ragdoll, 2.8);
  finiteConnected(ragdoll);
  assert.ok(motion(ragdoll) < earlyMotion * 0.4, 'friction and damping dissipate the initial movement');
  advance(ragdoll, 2);
  assert.equal(ragdoll.settled, true);
  assert.equal(ragdoll.simulating, false);
  const settled = snapshot(ragdoll);
  const settledTime = ragdoll.time;
  advance(ragdoll, 8);
  assert.deepEqual(snapshot(ragdoll), settled);
  assert.equal(ragdoll.time, settledTime);
  ragdoll.dispose();
});

test('fixed physics steps produce the same contact pose across display frame rates', () => {
  const slow = new RagdollPhysics();
  const fast = new RagdollPhysics();
  slow.begin({ x: 4.2, velocity: 7 });
  fast.begin({ x: 4.2, velocity: 7 });
  advance(slow, 3.6, 0.05);
  advance(fast, 3.6, RAGDOLL_STEP);
  assert.ok(Math.abs(slow.time - fast.time) < 1e-8);
  assert.equal(slow.contacts, fast.contacts);
  for (let i = 0; i < slow.parts.length; i++) {
    assert.ok(slow.parts[i].body.position.distanceTo(fast.parts[i].body.position) < 1e-7);
  }
  slow.dispose();
  fast.dispose();
});

test('retry clears velocities and contact history and repeats a fresh physical landing', () => {
  const ragdoll = new RagdollPhysics();
  ragdoll.begin({ x: 1.4, velocity: 2 });
  advance(ragdoll, 0.8);
  const first = snapshot(ragdoll);
  const contacts = ragdoll.contacts;
  ragdoll.reset();
  assert.equal(ragdoll.active, false);
  assert.equal(ragdoll.contacts, 0);
  assert.equal(ragdoll.firstContactTime, -1);
  assert.equal(ragdoll.world.contacts.length, 0);
  for (const { body } of ragdoll.parts) {
    assert.equal(body.velocity.lengthSquared(), 0);
    assert.equal(body.angularVelocity.lengthSquared(), 0);
  }
  ragdoll.begin({ x: 1.4, velocity: 2 });
  advance(ragdoll, 0.8);
  assert.equal(ragdoll.contacts, contacts);
  for (let i = 0; i < first.length; i++) {
    for (let j = 0; j < first[i].length; j++) assert.ok(Math.abs(first[i][j] - snapshot(ragdoll)[i][j]) < 1e-7);
  }
  ragdoll.dispose();
});

test('invalid frame inputs stay finite and disposal removes all bodies and joints', () => {
  const ragdoll = new RagdollPhysics();
  ragdoll.begin({ x: NaN, ground: Infinity, velocity: NaN });
  for (const frame of [NaN, -1, Infinity, 999]) ragdoll.step(frame);
  finiteConnected(ragdoll);
  assert.ok(ragdoll.time <= 0.081);
  ragdoll.dispose();
  assert.equal(ragdoll.disposed, true);
  assert.equal(ragdoll.world.bodies.length, 0);
  assert.equal(ragdoll.world.constraints.length, 0);
  assert.equal(ragdoll.active, false);
  ragdoll.step(0.05);
  ragdoll.begin();
  ragdoll.dispose();
  assert.equal(ragdoll.world.bodies.length, 0);
});
