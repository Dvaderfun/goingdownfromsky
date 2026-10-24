import * as CANNON from 'cannon-es';

export const RAGDOLL_STEP = 1 / 120;
const UP = new CANNON.Vec3(0, 1, 0);
const number = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const vec = (point) => new CANNON.Vec3(...point);

/** Landing-only physics. Coordinates use the same Y-up street as RainScene. */
export class RagdollPhysics {
  constructor() {
    this.active = false;
    this.simulating = false;
    this.disposed = false;
    this.time = 0;
    this.accumulator = 0;
    this.contacts = 0;
    this.firstContactTime = -1;
    this.settled = false;
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -15, 0), allowSleep: true });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.solver.iterations = 24;
    this.world.solver.tolerance = 0.0001;
    const surface = new CANNON.Material('wet-sidewalk');
    const bodyMaterial = new CANNON.Material('raincoat');
    this.world.addContactMaterial(new CANNON.ContactMaterial(surface, bodyMaterial, {
      friction: 0.72, restitution: 0.12,
      contactEquationStiffness: 5e6, contactEquationRelaxation: 4,
      frictionEquationStiffness: 5e6, frictionEquationRelaxation: 4,
    }));
    this.floor = new CANNON.Body({ mass: 0, material: surface, collisionFilterGroup: 1, collisionFilterMask: 2 });
    this.floor.addShape(new CANNON.Plane());
    this.floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(this.floor);
    this.parts = [];
    this.byName = new Map();
    this.constraints = [];
    this.contactListener = (event) => {
      if (!this.active || event.body !== this.floor) return;
      this.contacts++;
      if (this.firstContactTime < 0) this.firstContactTime = this.time;
    };

    this.addPart('torso', 7.4, [0.84, 0.69, 0.70], [0, 0.14, 0], bodyMaterial);
    this.addPart('pelvis', 4.6, [0.96, 0.40, 0.70], [0, -0.38, 0], bodyMaterial);
    this.addPart('head', 2.2, [0.45, 0.45, 0.45], [0, 0.85, 0.03], bodyMaterial, true);
    this.joint('spine', 'torso', 'pelvis', [0, -0.18, 0], 0.25, 0.16);
    this.joint('neck', 'torso', 'head', [0, 0.51, 0.025], 0.50, 0.35);

    for (const side of [-1, 1]) {
      const name = side < 0 ? 'left' : 'right';
      const shoulder = [side * 0.35, 0.29, 0];
      const elbow = [side * 0.76, 0.40, -0.045];
      const wrist = [side * 1.10, 0.47, 0.025];
      const hip = [side * 0.22, -0.49, 0];
      const knee = [side * 0.29, -0.89, -0.07];
      const ankle = [side * 0.34, -1.29, 0.025];
      this.addSegment(`${name}UpperArm`, 1.05, 0.125, shoulder, elbow, bodyMaterial);
      this.addSegment(`${name}Forearm`, 0.85, 0.115, elbow, wrist, bodyMaterial);
      this.addSegment(`${name}Thigh`, 2.05, 0.115, hip, knee, bodyMaterial);
      this.addSegment(`${name}Shin`, 1.65, 0.125, knee, ankle, bodyMaterial);
      this.addPart(`${name}Foot`, 0.8, [0.27, 0.22, 0.40], [side * 0.34, -1.38, 0.14], bodyMaterial);
      this.joint(`${name}Shoulder`, 'torso', `${name}UpperArm`, shoulder, 1.15, 0.75);
      this.joint(`${name}Elbow`, `${name}UpperArm`, `${name}Forearm`, elbow, 1.12, 0.12);
      this.joint(`${name}Hip`, 'pelvis', `${name}Thigh`, hip, 0.82, 0.38);
      this.joint(`${name}Knee`, `${name}Thigh`, `${name}Shin`, knee, 0.95, 0.08);
      this.joint(`${name}Ankle`, `${name}Shin`, `${name}Foot`, ankle, 0.48, 0.22);
    }
    this.reset();
  }

  addPart(name, mass, size, position, material, sphere = false, orientation = new CANNON.Quaternion()) {
    const body = new CANNON.Body({
      mass, material, linearDamping: 0.26, angularDamping: 0.65,
      // Self collision is unnecessary for this brief small rig and avoids coat/limb jitter.
      collisionFilterGroup: 2, collisionFilterMask: 1,
      allowSleep: true, sleepSpeedLimit: 0.16, sleepTimeLimit: 0.65,
    });
    body.addShape(sphere ? new CANNON.Sphere(size[0]) : new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)));
    body.addEventListener('collide', this.contactListener);
    this.world.addBody(body);
    const part = { name, body, size, restPosition: vec(position), restQuaternion: orientation.clone() };
    this.parts.push(part);
    this.byName.set(name, part);
    body.position.copy(part.restPosition);
    body.quaternion.copy(part.restQuaternion);
    return part;
  }

  addSegment(name, mass, radius, start, end, material) {
    const a = vec(start);
    const b = vec(end);
    const direction = a.vsub(b);
    const length = direction.length();
    direction.normalize();
    const orientation = new CANNON.Quaternion().setFromVectors(UP, direction);
    const position = a.vadd(b).scale(0.5);
    return this.addPart(name, mass, [radius * 2, length, radius * 2], position.toArray(), material, false, orientation);
  }

  joint(name, parentName, childName, pivot, angle, twistAngle) {
    const parent = this.byName.get(parentName);
    const child = this.byName.get(childName);
    const point = vec(pivot);
    const axis = child.restQuaternion.vmult(UP);
    const constraint = new CANNON.ConeTwistConstraint(parent.body, child.body, {
      pivotA: parent.restQuaternion.conjugate().vmult(point.vsub(parent.restPosition)),
      pivotB: child.restQuaternion.conjugate().vmult(point.vsub(child.restPosition)),
      axisA: parent.restQuaternion.conjugate().vmult(axis), axisB: UP,
      angle, twistAngle, maxForce: 18000, collideConnected: false,
    });
    constraint.name = name;
    for (const equation of constraint.equations) equation.setSpookParams(8e6, 5, RAGDOLL_STEP);
    this.constraints.push(constraint);
    this.world.addConstraint(constraint);
  }

  begin({ x = 0, ground = 1.2, velocity = 0 } = {}) {
    if (this.disposed) return;
    this.reset();
    this.active = this.simulating = true;
    const roll = number(velocity) < -0.5 ? -0.29 : 0.29;
    const tilt = new CANNON.Quaternion().setFromEuler(0.40, -0.12, roll, 'XYZ');
    const origin = new CANNON.Vec3(number(x), number(ground, 1.2) + 0.24 + 1.54, 3);
    this.floor.position.y = number(ground, 1.2) + 0.24;
    this.floor.aabbNeedsUpdate = true;
    for (const part of this.parts) {
      tilt.vmult(part.restPosition, part.body.position);
      part.body.position.vadd(origin, part.body.position);
      tilt.mult(part.restQuaternion, part.body.quaternion);
      part.body.velocity.set(clamp(number(velocity) * 0.14, -1.8, 1.8), -7.4, 0.85);
      part.body.angularVelocity.set(1.15, 0.12, roll * -2.5);
      this.synchronize(part.body);
      part.body.wakeUp();
    }
    // A tilted boot can be lower than the nominal rig origin. Spawn above contact,
    // including at either edge, rather than letting the solver repair penetration.
    const lowest = Math.min(...this.parts.map(({ body }) => {
      body.updateAABB();
      return body.aabb.lowerBound.y;
    }));
    const lift = this.floor.position.y + 0.16 - lowest;
    for (const { body } of this.parts) {
      body.position.y += lift;
      this.synchronize(body);
    }
    this.world.broadphase.dirty = true;
  }

  synchronize(body) {
    body.previousPosition.copy(body.position);
    body.interpolatedPosition.copy(body.position);
    body.initPosition.copy(body.position);
    body.previousQuaternion.copy(body.quaternion);
    body.interpolatedQuaternion.copy(body.quaternion);
    body.initQuaternion.copy(body.quaternion);
    body.updateInertiaWorld(true);
    body.aabbNeedsUpdate = true;
  }

  step(dt) {
    if (!this.active || !this.simulating || this.disposed) return;
    this.accumulator += clamp(number(dt), 0, 0.08);
    let substeps = 0;
    while (this.accumulator + 1e-9 >= RAGDOLL_STEP && substeps++ < 10) {
      this.world.step(RAGDOLL_STEP);
      this.accumulator -= RAGDOLL_STEP;
      this.time += RAGDOLL_STEP;
    }
    const sleeping = this.parts.every(({ body }) => body.sleepState === CANNON.Body.SLEEPING);
    // The final pose persists, but a completed landing never consumes more physics time.
    if (sleeping || this.time >= 4.8) {
      this.settled = true;
      this.simulating = false;
      for (const { body } of this.parts) body.sleep();
    }
  }

  reset() {
    if (this.disposed) return;
    this.active = this.simulating = this.settled = false;
    this.time = this.accumulator = this.contacts = 0;
    this.firstContactTime = -1;
    this.floor.position.setZero();
    this.synchronize(this.floor);
    for (const part of this.parts) {
      const body = part.body;
      body.position.copy(part.restPosition);
      body.quaternion.copy(part.restQuaternion);
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.force.setZero();
      body.torque.setZero();
      body.vlambda.setZero();
      body.wlambda.setZero();
      body.sleep();
      this.synchronize(body);
    }
    this.world.contacts.length = 0;
    this.world.frictionEquations.length = 0;
    this.world.collisionMatrix.reset();
    this.world.collisionMatrixPrevious.reset();
    this.world.bodyOverlapKeeper.current.length = 0;
    this.world.bodyOverlapKeeper.previous.length = 0;
    this.world.shapeOverlapKeeper.current.length = 0;
    this.world.shapeOverlapKeeper.previous.length = 0;
    this.world.time = this.world.stepnumber = this.world.accumulator = 0;
    this.world.broadphase.dirty = true;
  }

  dispose() {
    if (this.disposed) return;
    this.reset();
    for (const constraint of this.constraints) this.world.removeConstraint(constraint);
    for (const { body } of this.parts) {
      body.removeEventListener('collide', this.contactListener);
      this.world.removeBody(body);
    }
    this.world.removeBody(this.floor);
    this.disposed = true;
  }
}
