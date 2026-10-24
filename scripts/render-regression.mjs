import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'artifacts');
const url = process.env.RENDER_TEST_URL || 'http://127.0.0.1:5173';
const reportOnly = process.argv.includes('--report-only');
const label = process.argv.find(arg => arg.startsWith('--label='))?.slice(8) || 'regression';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [];
const samples = [];
let server;
let browser;

await mkdir(output, { recursive: true });

try {
  try {
    await fetch(url);
  } catch {
    const port = new URL(url).port || '5173';
    server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', port, '--strictPort'], {
      cwd: root, windowsHide: true, stdio: 'ignore',
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { ready = (await fetch(url)).ok; } catch {}
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, 'Vite server becomes available');
  }

  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
  for (const viewport of [
    { name: 'desktop', width: 960, height: 640, dpr: 1 },
    { name: 'portrait', width: 390, height: 844, dpr: 2 },
  ]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.dpr });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    // An isolated scene has no live game loop or debug-state mutation.
    await page.route('**/__render-regression', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><style>html,body,#test{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block}</style></head><body><div id="test"></div></body></html>',
    }));
    await page.goto(`${url}/__render-regression`);
    await page.evaluate(async () => {
      const [{ RainScene }, { RainGame, PLAYER_Y, LANES }] = await Promise.all([import('/src/scene.js'), import('/src/game.js')]);
      const scene = new RainScene(document.getElementById('test'));
      const Vector3 = scene.vector.constructor;
      const Quaternion = scene.temp.quaternion.constructor;
      const resourceCount = scene.resources.size;
      const actorPool = scene.hands.map(actor => ({ actor, group: actor.group, person: actor.person, arms: actor.arms?.slice() }));
      const hardPool = scene.hardLanding;
      const hardParts = hardPool?.parts.slice();
      const hardStains = hardPool?.stains.slice();
      const hardParticles = hardPool?.particles.slice();
      const physicsBodies = scene.ragdoll?.world.bodies.slice();
      const physicsConstraints = scene.ragdoll?.constraints.slice();
      let sceneObjectCount = 0;
      scene.scene.traverse(() => sceneObjectCount++);
      const game = new RainGame();
      game.start(5, 1234567, { skipIntro: true });
      const authored = new RainGame();
      const authoredSnapshots = new Map();
      const lastActivePalms = new Map();
      let impactStartJoints = null;

      function authoredState(distance) {
        if (authoredSnapshots.has(distance)) return structuredClone(authoredSnapshots.get(distance));
        authored.start(1, 20261023, { skipIntro: true });
        // Follow the promised safe route using the real simulation, including
        // launch acceleration, authored waves, tracking and target locking.
        for (let frame = 0; frame < 3000 && authored.state.distance < distance && authored.state.mode === 'playing'; frame++) {
          const wave = authored.waves.find(wave => wave.at >= authored.state.distance - 2) || authored.waves.at(-1);
          authored.point(wave ? LANES[wave.safeLane] : 0);
          authored.update(1 / 60);
        }
        authoredSnapshots.set(distance, structuredClone(authored.state));
        return structuredClone(authored.state);
      }

      const worldPosition = object => object.getWorldPosition(new Vector3());
      const isDescendant = (object, ancestor) => {
        for (let parent = object; parent; parent = parent.parent) if (parent === ancestor) return true;
        return false;
      };
      const segmentEnds = mesh => [-0.5, 0.5].map(y => mesh.localToWorld(new Vector3(0, y, 0)));
      const connects = (mesh, start, end) => {
        const endpoints = segmentEnds(mesh);
        return Math.min(endpoints[0].distanceTo(start) + endpoints[1].distanceTo(end), endpoints[1].distanceTo(start) + endpoints[0].distanceTo(end)) < 0.00001;
      };
      const near = (a, b) => Math.abs(a - b) < 0.00001;
      const palmBounds = palm => {
        let min = Infinity;
        let max = -Infinity;
        const point = new Vector3();
        palm.traverseVisible(node => {
          const position = node.geometry?.attributes.position;
          if (!position) return;
          for (let vertex = 0; vertex < position.count; vertex++) {
            point.fromBufferAttribute(position, vertex).applyMatrix4(node.matrixWorld);
            min = Math.min(min, point.x);
            max = Math.max(max, point.x);
          }
        });
        return { min, max };
      };

      window.renderSample = ({ mode = 'playing', resumeMode = 'playing', distance = 60, dash = false, slow = false, outcome = null, frames = 1, dt = 0.05, impactMode = 'arcade', runImpactMode = impactMode, reducedMotion = false, launchProgress = 1, nearTimer = 0, pickupTimer = 0, fallIntensity = 0.5, fixture = null, authoredDistance = null, expectHunterStage = null, expectedPhysicsTime = null, expectContact = false, introTime = null, skipIntro = false }) => {
        let state = authoredDistance === null ? structuredClone(game.state) : authoredState(authoredDistance);
        if (introTime !== null) {
          const introGame = new RainGame({ saved: { impactMode, reducedMotion } });
          introGame.start(1, 20261023);
          for (let remaining = introTime; remaining > 0.000001; remaining -= 0.02) introGame.update(Math.min(0.02, remaining));
          if (skipIntro) introGame.skipIntro();
          state = structuredClone(introGame.state);
          if (mode !== 'paused') mode = state.mode;
          else resumeMode = 'intro';
          distance = state.distance;
          launchProgress = state.launchProgress;
          fallIntensity = 0;
        }
        const intro = mode === 'intro' || mode === 'paused' && resumeMode === 'intro';
        const authoredMode = state.mode;
        if (authoredDistance !== null) distance = state.distance;
        Object.assign(state, {
          mode, resumeMode, distance, progress: distance / state.height, x: introTime !== null ? state.x : authoredDistance === null ? 1.4 : state.x, velocity: dash ? 22 : state.velocity,
          dashTimer: dash ? 0.2 : 0, slow, outcome, impactMode, runImpactMode, reducedMotion, shake: 0,
          launchProgress, nearTimer, pickupTimer, fallIntensity,
          fallSpeed: state.fallSpeed || state.speed,
        });
        if (authoredDistance === null) {
          for (const hazard of state.hazards) {
            hazard.y = PLAYER_Y + distance - hazard.at;
            hazard.warning = Math.max(0, Math.min(1, (hazard.y + 11) / 6.5));
            hazard.passed = hazard.y > PLAYER_Y + 1.15;
            hazard.active = hazard.y > -4.5 && hazard.y < 4.8 && !hazard.passed;
            if (hazard.type === 'hunter') {
              hazard.locked = hazard.y >= -7.2;
              hazard.stage = hazard.passed ? 'passed' : hazard.active ? 'reaching' : hazard.locked ? 'locked' : 'tracking';
              hazard.targetX = hazard.x;
            }
          }
          for (const pickup of state.pickups) {
            pickup.y = PLAYER_Y + distance - pickup.at;
            pickup.passed = pickup.y > PLAYER_Y + 1.2;
          }
        }
        if (fixture?.startsWith('hunter')) {
          const stage = fixture.slice(7);
          const y = stage === 'tracking' ? -8.4 : stage === 'locked' ? -5.8 : -0.7;
          state.hazards = [{ id: 'opaque-hunter-id', phase: 1.31, at: PLAYER_Y + distance - y, baseX: 0, x: 0.95, targetX: 0.95, y, type: 'hunter', warning: 0.94, active: stage === 'reaching', locked: stage !== 'tracking', stage, passed: false }];
          state.pickups = [{ id: 'opaque-risk-id', at: PLAYER_Y + distance - (y + 3.4), x: 2.4, y: y + 3.4, collected: false, risk: true }];
        } else if (fixture?.startsWith('pair-')) {
          const [type, stage] = fixture.slice(5).split(':');
          const retract = stage?.startsWith('retract');
          const passY = PLAYER_Y + 1.15;
          const y = stage === 'telegraph' ? -5.8 : stage === 'last-active' ? passY - 0.00001 : stage === 'retract-start' ? passY + 0.00001 : stage === 'retract-finish' ? passY + 4.2 : retract ? 3 : PLAYER_Y;
          // Keep the authored window row aligned with the façade. Move the
          // heroine aside for an unobstructed anatomy screenshot, except caught.
          state.distance = distance = 60 + y - PLAYER_Y;
          state.progress = distance / state.height;
          state.pickups = [];
          state.x = mode === 'caught' ? 0.95 : 3.8;
          state.hazards = type === 'empty' ? [] : [{
            id: 'one-window-two-arms', phase: 1.31, at: 60, baseX: 0, x: 0.95, targetX: 0.95,
            y,
            type, warning: retract ? 0.9 : 0.94,
            active: stage !== 'telegraph' && !retract,
            locked: type === 'hunter', stage: retract ? 'passed' : stage === 'telegraph' ? 'locked' : 'reaching',
            passed: retract,
          }];
        } else if (fixture === 'pickups') {
          state.hazards = [];
          state.pickups = [
            { id: 'normal-drop-id', at: 57, x: -1.7, y: -1.2, collected: false, risk: false },
            { id: 'risk-drop-id', at: 63, x: 3.7, y: -1.2, collected: false, risk: true },
          ];
        }
        let pausedCamera = null;
        let pausedPlayer = null;
        let pausedRoof = null;
        const pauseFailures = [];
        for (let frame = 0; frame < frames; frame++) {
          scene.update(state, dt);
          if (intro && mode === 'paused') {
            const camera = [...scene.camera.position.toArray(), ...scene.camera.quaternion.toArray()];
            const player = [...scene.player.position.toArray(), ...scene.player.quaternion.toArray()];
            const roof = scene.roof.position.toArray();
            if (pausedCamera && (camera.some((value, axis) => !near(value, pausedCamera[axis])) || player.some((value, axis) => !near(value, pausedPlayer[axis])) || roof.some((value, axis) => !near(value, pausedRoof[axis])))) pauseFailures.push('paused intro keeps the exact camera, character and rooftop pose');
            pausedCamera = camera;
            pausedPlayer = player;
            pausedRoof = roof;
          }
        }

        const nonFiniteObjects = [];
        let nonFiniteGeometryCount = 0;
        scene.scene.traverseVisible(object => {
          const values = [...object.matrixWorld.elements, ...object.position.toArray(), ...object.quaternion.toArray(), ...object.rotation.toArray().slice(0, 3), ...object.scale.toArray()];
          const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
          for (const material of materials) {
            values.push(material.opacity);
            if (material.color) values.push(...material.color.toArray());
          }
          if (values.some(value => !Number.isFinite(value))) nonFiniteObjects.push({ type: object.type, material: materials[0]?.type, opacity: materials[0]?.opacity });
          const vertices = object.geometry?.attributes.position?.array;
          if (vertices?.some(value => !Number.isFinite(value))) nonFiniteGeometryCount++;
        });
        const visualFailures = [...pauseFailures];
        if (scene.resources.size !== resourceCount) visualFailures.push('repeated render effects keep the resource pool bounded');
        const hardWin = runImpactMode === 'hard' && outcome === 'win' && ['impact', 'result'].includes(mode);
        const effectiveVisible = object => {
          for (let node = object; node; node = node.parent) if (!node.visible) return false;
          return true;
        };
        const hard = scene.hardLanding;
        const ragdoll = scene.ragdoll;
        let hardLanding = null;
        if (!hard || !ragdoll) {
          visualFailures.push('scene exposes the real hard landing physics and pooled visuals');
        } else {
          if (hard !== hardPool || hard.parts.length !== hardParts.length || hard.parts.some((part, index) => part !== hardParts[index]) || hard.stains.length !== hardStains.length || hard.stains.some((stain, index) => stain !== hardStains[index]) || hard.particles.length !== hardParticles.length || hard.particles.some((particle, index) => particle !== hardParticles[index]) || ragdoll.world.bodies.length !== physicsBodies.length || ragdoll.world.bodies.some((body, index) => body !== physicsBodies[index]) || ragdoll.constraints.length !== physicsConstraints.length || ragdoll.constraints.some((joint, index) => joint !== physicsConstraints[index])) visualFailures.push('hard landing bodies, joints, parts and blood reuse their original pools');
          const parts = hard.parts.map(part => {
            const body = part.body;
            const position = [body.position.x, body.position.y, body.position.z];
            const quaternion = [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w];
            const velocity = [body.velocity.x, body.velocity.y, body.velocity.z];
            const angularVelocity = [body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z];
            const meshPosition = worldPosition(part.mesh).toArray();
            const meshQuaternion = part.mesh.getWorldQuaternion(new Quaternion()).toArray();
            let visibleMeshes = 0;
            part.mesh.traverseVisible(node => { if (node.isMesh && node.geometry?.attributes.position && node.material.opacity > 0.05 && node.scale.x !== 0 && node.scale.y !== 0 && node.scale.z !== 0) visibleMeshes++; });
            if ([...position, ...quaternion, ...velocity, ...angularVelocity, ...meshPosition, ...meshQuaternion].some(value => !Number.isFinite(value))) visualFailures.push(`${part.name}: ragdoll body and visible mesh stay finite`);
            if (Math.abs(Math.hypot(...quaternion) - 1) > 0.0001) visualFailures.push(`${part.name}: physical orientation remains normalized`);
            if (hardWin && (!effectiveVisible(part.mesh) || !visibleMeshes || Math.hypot(...meshPosition.map((value, axis) => value - position[axis])) > 0.0001 || Math.abs(meshQuaternion.reduce((dot, value, axis) => dot + value * quaternion[axis], 0)) < 0.9999)) visualFailures.push(`${part.name}: visible body follows its real position and orientation`);
            body.updateAABB();
            const projected = worldPosition(part.mesh).project(scene.camera).toArray();
            return { name: part.name, position, quaternion, velocity, angularVelocity, meshPosition, meshQuaternion, projected, visible: effectiveVisible(part.mesh), visibleMeshes, lowerY: body.aabb.lowerBound.y };
          });
          const joints = ragdoll.constraints.map(joint => {
            const a = joint.bodyA.pointToWorldFrame(joint.pivotA);
            const b = joint.bodyB.pointToWorldFrame(joint.pivotB);
            const relative = new Quaternion(joint.bodyA.quaternion.x, joint.bodyA.quaternion.y, joint.bodyA.quaternion.z, joint.bodyA.quaternion.w).invert().multiply(new Quaternion(joint.bodyB.quaternion.x, joint.bodyB.quaternion.y, joint.bodyB.quaternion.z, joint.bodyB.quaternion.w));
            return { gap: a.distanceTo(b), relative: relative.toArray() };
          });
          const visibleStains = hard.stains.filter(stain => effectiveVisible(stain) && stain.material.opacity > 0.05 && stain.scale.x > 0 && stain.scale.y > 0);
          const projectedStains = visibleStains.map(stain => {
            const center = worldPosition(stain).project(scene.camera);
            const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
            const positions = stain.geometry?.attributes.position;
            for (let vertex = 0; vertex < (positions?.count || 0); vertex++) {
              const point = new Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(stain.matrixWorld).project(scene.camera);
              bounds.minX = Math.min(bounds.minX, point.x); bounds.maxX = Math.max(bounds.maxX, point.x);
              bounds.minY = Math.min(bounds.minY, point.y); bounds.maxY = Math.max(bounds.maxY, point.y);
            }
            return { center: center.toArray(), pixelArea: (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY) * scene.width * scene.height / 4, opacity: stain.material.opacity };
          });
          const visibleParticles = hard.particles.filter(particle => effectiveVisible(particle) && particle.material.opacity > 0.05);
          if (hardWin) {
            if (!hard.active || !ragdoll.active || !effectiveVisible(hard.group) || effectiveVisible(scene.player)) visualFailures.push('hard win replaces the flight heroine with the active physical body');
            if (parts.some(part => Math.abs(part.projected[0]) >= 1 || Math.abs(part.projected[1]) >= 1 || part.projected[2] <= -1 || part.projected[2] >= 1)) visualFailures.push('the hard landing camera keeps the whole body inside desktop and portrait frames');
            if (scene.landing.visible) visualFailures.push('hard win has its own impact instead of the arcade landing rings');
            if (parts.length < 11 || joints.length < 10 || joints.some(joint => !Number.isFinite(joint.gap) || joint.gap > 0.5)) visualFailures.push('a connected full-body ragdoll retains finite joints during impact');
            if (expectedPhysicsTime !== null && Math.abs(hard.age - expectedPhysicsTime) > 0.00001) visualFailures.push('hard landing advances cumulatively at full real time, including reduced motion and result');
            if (!impactStartJoints) impactStartJoints = joints.map(joint => new Quaternion(...joint.relative));
            const jointMotion = joints.map((joint, index) => new Quaternion(...joint.relative).angleTo(impactStartJoints[index]));
            if (expectContact && (ragdoll.firstContactTime < 0 || ragdoll.contacts <= 0 || !visibleStains.length || !projectedStains.some(stain => Math.abs(stain.center[0]) < 1 && Math.abs(stain.center[1]) < 1 && stain.center[2] > -1 && stain.center[2] < 1 && stain.pixelArea > 4) || !jointMotion.some(angle => angle > 0.04))) visualFailures.push('physical floor contact bends joints and leaves visible blood inside the camera');
            if (expectedPhysicsTime >= 3.6 && (parts.some(part => part.lowerY < ragdoll.floor.position.y - 0.12) || joints.some(joint => joint.gap > 0.12) || !ragdoll.settled && parts.some(part => Math.hypot(...part.velocity) > 0.6 || Math.hypot(...part.angularVelocity) > 2))) visualFailures.push('the intact physical body settles on the street with connected limbs');
            hardLanding = { active: hard.active, simulating: ragdoll.simulating, time: ragdoll.time, age: hard.age, contacts: ragdoll.contacts, firstContactTime: ragdoll.firstContactTime, settled: ragdoll.settled, floorY: ragdoll.floor.position.y, parts, joints, jointMotion, visibleStains: visibleStains.length, projectedStains, visibleParticles: visibleParticles.length };
          } else {
            impactStartJoints = null;
            if (hard.active || ragdoll.active || ragdoll.simulating || ragdoll.time !== 0 || ragdoll.contacts !== 0 || effectiveVisible(hard.group) || visibleStains.length || visibleParticles.length) visualFailures.push('arcade, menu, flight and caught keep ragdoll physics and blood inactive');
            if (!intro && (!near(scene.camera.position.z, scene.cameraZ) || !near(scene.camera.position.y, 4.2))) visualFailures.push('retry, menu, arcade and caught restore the standard camera');
            hardLanding = { active: hard.active, simulating: ragdoll.simulating, time: ragdoll.time, age: hard.age, contacts: ragdoll.contacts, visibleStains: visibleStains.length, visibleParticles: visibleParticles.length };
          }
        }
        if (runImpactMode === 'arcade' && outcome === 'win' && ['impact', 'result'].includes(mode)) {
          const t = mode === 'result' ? 1.05 + scene.modeTime : scene.modeTime;
          const flash = Math.exp(-t * 10);
          if (!scene.landing.visible || !near(scene.landing.position.y, PLAYER_Y) || !near(scene.landingFlash.material.opacity, flash * (reducedMotion ? 0.3 : 0.84)) || !near(scene.landingGlow.intensity, Math.max(0, 1 - t / 1.8) * 55) || scene.landingRings.some((ring, index) => ring.visible !== (t >= index * 0.085) || !near(ring.material.opacity, Math.max(0, 1 - Math.max(0, t - index * 0.085) / 1.45) * (reducedMotion ? 0.45 : 0.88)))) visualFailures.push('arcade preserves the original glow, flash and four rain rings');
        }
        let currentObjectCount = 0;
        scene.scene.traverse(() => currentObjectCount++);
        if (currentObjectCount !== sceneObjectCount || actorPool.some((initial, index) => {
          const actor = scene.hands[index];
          return actor !== initial.actor || actor.group !== initial.group || actor.person !== initial.person || actor.arms?.some((arm, side) => arm !== initial.arms?.[side]);
        })) visualFailures.push('window people and both arms reuse their original scene nodes');
        if (authoredDistance !== null && authoredMode !== 'playing') visualFailures.push('seeded safe route remains playable');
        if (mode === 'playing' && launchProgress === 1 && scene.player.position.y !== PLAYER_Y) visualFailures.push('flight player matches simulation y');
        // Legacy launch-progress fixtures remain covered, but playing now starts
        // after the rooftop intro and must never replay its ledge animation.
        if (mode === 'playing' && !near(scene.roof.position.y, 9.7 + distance)) visualFailures.push('flight keeps the roof above the player without replaying the intro ledge');
        if (nearTimer > 0 && mode === 'playing' && !scene.nearRing.visible) visualFailures.push('near miss feedback appears');
        if (!near(scene.renderer.getPixelRatio(), Math.min(window.devicePixelRatio, 1.65))) visualFailures.push('DPR follows the renderer quality cap');
        if (scene.renderer.domElement.width !== Math.floor(scene.width * scene.renderer.getPixelRatio()) || scene.renderer.domElement.height !== Math.floor(scene.height * scene.renderer.getPixelRatio())) visualFailures.push('framebuffer tracks DPR and resize');
        if (!intro && mode !== 'menu' && ['playing', 'paused', 'caught'].includes(mode)) {
          for (const x of [LANES[0], LANES.at(-1)]) {
            const projected = new Vector3(x, PLAYER_Y, 3).project(scene.camera);
            if (!Number.isFinite(projected.x) || Math.abs(projected.x) >= 1 || Math.abs(projected.y) >= 1) visualFailures.push('both edge lanes fit in the camera after portrait or resize');
          }
        }
        const visibleHazards = (intro ? [] : mode === 'menu' ? scene.menuHands : state.hazards).filter(hazard => Number.isFinite(hazard.x) && Number.isFinite(hazard.y) && Number.isFinite(hazard.baseX) && hazard.y >= -39 && hazard.y <= 33 && (hazard.warning > 0 || hazard.active)).slice(0, scene.hands.length);
        const visibleActors = scene.hands.filter(actor => actor.group.visible);
        const pairedActors = [];
        if (visibleActors.length !== visibleHazards.length) visualFailures.push('each visible hazard owns exactly one window person');
        if (fixture === 'pair-empty' && visibleActors.length) visualFailures.push('empty hazard state hides the whole person and both arms');
        for (let index = 0; index < visibleActors.length; index++) {
          const actor = visibleActors[index];
          const hazard = visibleHazards[index];
          const prefix = `window ${index} (${hazard?.type})`;
          if (!actor.person || actor.arms?.length !== 2 || !actor.head || !actor.torso || !actor.catchCenter) {
            visualFailures.push(`${prefix}: one person has one head, one torso and exactly two arms`);
            continue;
          }
          const left = actor.arms.find(arm => arm.side === -1);
          const right = actor.arms.find(arm => arm.side === 1);
          if (!left || !right) {
            visualFailures.push(`${prefix}: arms have distinct mirrored sides`);
            continue;
          }
          const heads = [];
          const torsos = [];
          actor.person.traverse(node => {
            if (node.name === 'window-person-head') heads.push(node);
            if (node.name === 'window-person-torso') torsos.push(node);
          });
          if (heads.length !== 1 || heads[0] !== actor.head || torsos.length !== 1 || torsos[0] !== actor.torso || !isDescendant(actor.person, actor.group)) visualFailures.push(`${prefix}: both limbs share one visible owner inside this window`);
          if (!actor.head.visible || !actor.torso.visible || !actor.person.visible) visualFailures.push(`${prefix}: head and torso are visible with the hands`);
          const palmPositions = actor.arms.map(arm => worldPosition(arm.palm));
          const average = palmPositions[0].clone().add(palmPositions[1]).multiplyScalar(0.5);
          if ([...average.toArray(), ...actor.catchCenter.toArray()].some(value => !Number.isFinite(value))) visualFailures.push(`${prefix}: grasp center stays finite`);
          if (hazard.active && (!near(average.x, hazard.x) || !near(average.y, hazard.y) || !near(average.z, 3) || !near(actor.catchCenter.x, hazard.x) || !near(actor.catchCenter.y, hazard.y) || !near(actor.catchCenter.z, 3))) visualFailures.push(`${prefix}: world-space midpoint of both palms matches the single collision center`);
          const firstPassed = hazard.passed && hazard.y < PLAYER_Y + 1.15 + 0.001;
          if (!hazard.active && !firstPassed && average.z >= 3 - 0.00001) visualFailures.push(`${prefix}: telegraph and retract keep both palms nearer the window`);
          if (fixture?.endsWith(':last-active')) lastActivePalms.set(hazard.type, palmPositions.map(point => point.clone()));
          if (fixture?.endsWith(':retract-start')) {
            const previous = lastActivePalms.get(hazard.type);
            if (!previous || !near(average.z, 3) || palmPositions.some((point, side) => Math.hypot(point.x - previous[side].x, point.z - previous[side].z) > 0.02)) visualFailures.push(`${prefix}: first passed frame continues the active reach without snapping to the window`);
          }
          if (fixture?.endsWith(':retract-finish') && (average.z >= 1 || !near(average.x, hazard.baseX))) visualFailures.push(`${prefix}: completed retraction brings both palms back to their owner`);
          if (hazard.type !== 'hunter' && actor.target.visible || hazard.passed && actor.target.visible) visualFailures.push(`${prefix}: pooled normal or passed people hide the hunter target`);
          if (!near(left.thumb.position.x, -right.thumb.position.x) || left.thumb.position.x <= 0 || right.thumb.position.x >= 0 || !near(left.thumb.rotation.z, -right.thumb.rotation.z)) visualFailures.push(`${prefix}: thumbs mirror inward across the two palms`);
          for (const arm of actor.arms) {
            const limbNodes = [arm.shoulder, arm.upper, arm.lower, arm.elbow, arm.wrist, arm.cuff, arm.palm, arm.palmMesh, arm.thumb];
            if (limbNodes.some(node => !node || !isDescendant(node, actor.person))) visualFailures.push(`${prefix}: shoulder through fingertips belongs to the same person`);
            if (arm.fingers?.length !== 4 || arm.fingers.some(finger => !isDescendant(finger.group, arm.palm) || !isDescendant(finger.end, finger.group))) visualFailures.push(`${prefix}: each palm has four joined fingers and a thumb`);
            if (arm.upper.material !== actor.torso.material || arm.lower.material !== actor.torso.material || arm.shoulder.material !== actor.torso.material) visualFailures.push(`${prefix}: both sleeves match their owner's torso`);
            const shoulder = actor.person.localToWorld(arm.shoulderPoint.clone());
            const elbow = actor.person.localToWorld(arm.elbowPoint.clone());
            const wrist = actor.person.localToWorld(arm.wristPoint.clone());
            if (!connects(arm.upper, shoulder, elbow) || !connects(arm.lower, elbow, wrist) || worldPosition(arm.elbow).distanceTo(elbow) > 0.00001 || worldPosition(arm.wrist).distanceTo(wrist) > 0.00001) visualFailures.push(`${prefix}: upper arm and forearm meet at shoulder, elbow and wrist`);
            if (worldPosition(arm.palm).distanceTo(wrist) > 0.4 || Math.min(...segmentEnds(arm.cuff).map(endpoint => endpoint.distanceTo(wrist))) > 0.00001) visualFailures.push(`${prefix}: cuff and wrist connect to the palm`);
            const bounds = palmBounds(arm.palm);
            const envelope = hazard.type === 'long' ? 0.7 : 0.55;
            if (hazard.active && (bounds.min < hazard.x - envelope - 0.025 || bounds.max > hazard.x + envelope + 0.025)) visualFailures.push(`${prefix}: visible palms stay inside the existing collision envelope`);
          }
          for (let finger = 0; finger < 4; finger++) {
            const a = left.fingers[finger]?.group.position;
            const b = right.fingers[finger]?.group.position;
            if (!a || !b || !near(a.x, -b.x) || !near(a.y, b.y) || !near(a.z, b.z)) visualFailures.push(`${prefix}: finger placement mirrors anatomically`);
          }
          pairedActors.push({ id: hazard.id, type: hazard.type, stage: hazard.stage, active: hazard.active, palms: palmPositions.map(point => point.toArray()), midpoint: average.toArray(), catchCenter: actor.catchCenter.toArray(), owner: actor.person.uuid, head: worldPosition(actor.head).toArray(), torso: worldPosition(actor.torso).toArray() });
        }
        if (fixture?.startsWith('hunter')) {
          const hazard = state.hazards[0];
          const hand = scene.hands.find(hand => hand.group.visible);
          if (hazard.active) {
            const center = hand?.arms?.length === 2 ? worldPosition(hand.arms[0].palm).add(worldPosition(hand.arms[1].palm)).multiplyScalar(0.5) : null;
            if (!center || !near(center.x, hazard.x) || !near(center.y, hazard.y) || !near(center.z, 3)) visualFailures.push('hunter paired palms match exact collision coordinates');
          } else if (!hand?.target.visible || hand.target.position.x !== hazard.targetX || hand.target.position.y !== hazard.y) visualFailures.push('hunter reticle marks actual frozen target');
        }
        if (expectHunterStage) {
          const index = visibleHazards.findIndex(hazard => hazard.type === 'hunter' && hazard.stage === expectHunterStage);
          const hazard = visibleHazards[index];
          const hand = scene.hands[index];
          if (!hazard || !Number.isFinite(hazard.phase) || !hazard.locked || hazard.x !== hazard.targetX) visualFailures.push('authored hunter exists with finite phase and frozen target in expected stage');
          if (!hand?.target.visible || hand.target.position.x !== hazard?.targetX || hand.target.position.y !== hazard?.y) visualFailures.push('authored locked hunter reticle matches simulation target');
        }
        if (fixture === 'pickups') {
          const visible = scene.pickups.filter(pickup => pickup.group.visible);
          if (!visible.some(pickup => pickup.diamond.visible && pickup.gem.material === pickup.riskCrystal) || !visible.some(pickup => pickup.ring.visible && pickup.gem.material === pickup.crystal)) visualFailures.push('risk and normal drops have distinct shapes and materials');
        }

        let introPose = null;
        if (intro) {
          const pose = scene.introPose;
          if (!pose?.active || pose.stage !== state.introStage || !near(pose.time, state.introTime)) visualFailures.push('rooftop presentation follows the real simulation intro stage and time');
          if (!effectiveVisible(scene.roof) || !effectiveVisible(scene.player) || scene.ground.visible || visibleActors.length || scene.pickups.some(pickup => pickup.group.visible)) visualFailures.push('intro shows the rooftop and heroine while keeping street, traps and drops hidden');
          const feet = (pose?.feet || []).map(point => point.toArray());
          const soleBottoms = scene.legs.map(leg => {
            let bottom = Infinity;
            const vertices = leg.sole?.geometry.attributes.position;
            for (let vertex = 0; vertex < (vertices?.count || 0); vertex++) bottom = Math.min(bottom, new Vector3().fromBufferAttribute(vertices, vertex).applyMatrix4(leg.sole.matrixWorld).y);
            return bottom;
          });
          if (feet.length !== 2 || feet.flat().some(value => !Number.isFinite(value)) || !Number.isFinite(pose?.roofSurfaceY) || !Number.isFinite(pose?.roofEdgeZ)) visualFailures.push('intro reports both actual finite boot soles and the physical rooftop edge');
          if (state.introStage === 'roof' && (!pose?.grounded || feet.some(point => Math.abs(point[1] - pose.roofSurfaceY) > 0.002))) visualFailures.push('both boots start grounded on the rooftop surface');
          if (state.introStage === 'approach' && (!pose?.grounded || !soleBottoms.some(bottom => Math.abs(bottom - pose.roofSurfaceY) < 0.002))) visualFailures.push('approach leaves a planted boot on the roof instead of floating');
          if (state.introStage === 'jump' && state.introTime > 2.4 && scene.player.position.z <= pose?.roofEdgeZ) visualFailures.push('the jump carries the heroine beyond the front roof edge');
          const projectedPlayer = worldPosition(scene.player).project(scene.camera).toArray();
          const projectedEdge = new Vector3(0, pose?.roofSurfaceY, pose?.roofEdgeZ).project(scene.camera).toArray();
          if (Math.abs(projectedPlayer[0]) > 0.85 || Math.abs(projectedPlayer[1]) > 0.85 || projectedPlayer[2] <= -1 || projectedPlayer[2] >= 1) visualFailures.push('intro camera keeps the heroine clearly inside the desktop and portrait frame');
          if (['roof', 'approach'].includes(state.introStage) && (Math.abs(projectedEdge[0]) >= 1 || Math.abs(projectedEdge[1]) >= 1 || projectedEdge[2] <= -1 || projectedEdge[2] >= 1)) visualFailures.push('the roof edge stays visible before takeoff at every tested aspect ratio');
          introPose = { stage: pose?.stage, time: pose?.time, feet, soleBottoms, grounded: pose?.grounded, roofSurfaceY: pose?.roofSurfaceY, roofEdgeZ: pose?.roofEdgeZ, projectedPlayer, projectedEdge, roofPosition: scene.roof.position.toArray() };
        }
        if (skipIntro && (!near(scene.player.position.x, 0) || !near(scene.player.position.y, PLAYER_Y) || !near(scene.player.position.z, 3) || !near(scene.camera.position.x, 0) || !near(scene.camera.position.y, 4.2) || !near(scene.camera.position.z, scene.cameraZ) || scene.introPose?.active)) visualFailures.push('skipping intro immediately restores the exact normal player and camera coordinates');

        // Read the final framebuffer synchronously before the browser clears it.
        const gl = scene.renderer.getContext();
        const width = gl.drawingBufferWidth;
        const height = gl.drawingBufferHeight;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const columns = new Uint32Array(width);
        const stack = new Int32Array(width + 1);
        let blackPixels = 0;
        let largest = { area: 0, width: 0, height: 0 };
        // Largest contiguous black rectangle: dark artwork can have isolated
        // black pixels, while broken compositing covers a large solid region.
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4;
            const black = pixels[offset] <= 2 && pixels[offset + 1] <= 2 && pixels[offset + 2] <= 2;
            columns[x] = black ? columns[x] + 1 : 0;
            if (black) blackPixels++;
          }
          let top = -1;
          for (let x = 0; x <= width; x++) {
            const current = x === width ? 0 : columns[x];
            while (top >= 0 && columns[stack[top]] > current) {
              const rectangleHeight = columns[stack[top--]];
              const rectangleWidth = x - (top >= 0 ? stack[top] : -1) - 1;
              const area = rectangleHeight * rectangleWidth;
              if (area > largest.area) largest = { area, width: rectangleWidth, height: rectangleHeight };
            }
            stack[++top] = x;
          }
        }
        return {
          mode, distance, dash, slow, outcome, impactMode, runImpactMode, frames, dt, width, height,
          blackPixels, blackRatio: blackPixels / (width * height), largest,
          glError: gl.getError(), rendererPixelRatio: scene.renderer.getPixelRatio(), nonFiniteObjects, nonFiniteGeometryCount, visualFailures,
          launchProgress, nearTimer, fixture, authoredDistance, authoredMode, expectHunterStage,
          playerPosition: scene.player.position.toArray(), visibleHunters: state.hazards.filter(hazard => hazard.type === 'hunter' && hazard.warning > 0).map(hazard => hazard.stage),
          hunterStates: state.hazards.filter(hazard => hazard.type === 'hunter' && hazard.warning > 0).map(hazard => ({ stage: hazard.stage, phase: hazard.phase, x: hazard.x, y: hazard.y, targetX: hazard.targetX, locked: hazard.locked })),
          resourceCount: scene.resources.size, drawCalls: scene.renderer.info.render.calls,
          pairedActors, hardLanding, introPose, introTime, resumeMode, skipIntro, cameraPosition: scene.camera.position.toArray(), cameraQuaternion: scene.camera.quaternion.toArray(),
        };
      };
      window.disposeRenderSample = () => {
        scene.dispose();
        return { sceneDisposed: scene.disposed, physicsDisposed: scene.ragdoll.disposed, physicsActive: scene.ragdoll.active, bodies: scene.ragdoll.world.bodies.length, joints: scene.ragdoll.world.constraints.length, canvasConnected: scene.renderer.domElement.isConnected };
      };
      window.resizeRenderSample = () => scene.resize();
      window.renderHeight = game.state.height;
    });
    const height = await page.evaluate(() => window.renderHeight);
    const cases = [
      { name: 'menu', mode: 'menu', distance: 0 },
      { name: 'early', distance: 0 },
      { name: 'hands', distance: 60 },
      { name: 'dash', distance: 74, dash: true },
      { name: 'focus', distance: 104, slow: true },
      { name: 'late', distance: height - 50 },
      { name: 'ground-30', distance: height - 30 },
      { name: 'ground-10', distance: height - 10 },
      { name: 'ground-3', distance: height - 3 },
      { name: 'impact-start', distance: height, mode: 'impact', outcome: 'win' },
      { name: 'impact-bloom', distance: height, mode: 'impact', outcome: 'win', frames: 5 },
      { name: 'result-win', distance: height, mode: 'result', outcome: 'win' },
      { name: 'retry', distance: 60 },
      { name: 'caught', distance: 60, mode: 'caught', outcome: 'caught' },
      { name: 'result-caught', distance: 60, mode: 'result', outcome: 'caught' },
      { name: 'reduced-motion', distance: 74, dash: true, reducedMotion: true },
      { name: 'launch-ledge', distance: 0, launchProgress: 0, fallIntensity: 0 },
      { name: 'launch-arc', distance: 1.4, launchProgress: 0.42, fallIntensity: 0.18 },
      { name: 'launch-flight', distance: 5.7, launchProgress: 1, fallIntensity: 0.32 },
      { name: 'hunter-tracking', distance: 66, fixture: 'hunter-tracking' },
      { name: 'hunter-locked', distance: 68, fixture: 'hunter-locked' },
      { name: 'hunter-reaching', distance: 72, fixture: 'hunter-reaching' },
      { name: 'risk-normal-drops', distance: 63, fixture: 'pickups' },
      { name: 'near-miss', distance: 86, nearTimer: 0.24, frames: 2 },
      { name: 'pickup-feedback', distance: 86, pickupTimer: 0.3 },
      { name: 'fast-rain', distance: height - 34, fallIntensity: 1 },
      { name: 'authored-wave-one', authoredDistance: 34 },
      { name: 'authored-hunter', authoredDistance: 84, expectHunterStage: 'locked' },
      { name: 'authored-risk-wave', authoredDistance: 110 },
      { name: 'authored-finale', authoredDistance: 164, fallIntensity: 1 },
      { name: 'paired-normal-reaching', distance: 60, fixture: 'pair-grab:reaching' },
      { name: 'paired-long-reaching', distance: 60, fixture: 'pair-long:reaching' },
      { name: 'paired-hunter-reaching', distance: 60, fixture: 'pair-hunter:reaching' },
      { name: 'paired-normal-telegraph', distance: 60, fixture: 'pair-grab:telegraph' },
      { name: 'paired-hunter-telegraph', distance: 60, fixture: 'pair-hunter:telegraph' },
      { name: 'paired-normal-last-active', distance: 60, fixture: 'pair-grab:last-active' },
      { name: 'paired-normal-retract-start', distance: 60, fixture: 'pair-grab:retract-start' },
      { name: 'paired-normal-retract', distance: 60, fixture: 'pair-grab:retract' },
      { name: 'paired-normal-retract-finish', distance: 60, fixture: 'pair-grab:retract-finish' },
      { name: 'paired-hunter-last-active', distance: 60, fixture: 'pair-hunter:last-active' },
      { name: 'paired-hunter-retract-start', distance: 60, fixture: 'pair-hunter:retract-start' },
      { name: 'paired-hunter-retract', distance: 60, fixture: 'pair-hunter:retract' },
      { name: 'paired-hunter-retract-finish', distance: 60, fixture: 'pair-hunter:retract-finish' },
      { name: 'paired-hidden-pool', distance: 60, fixture: 'pair-empty' },
      { name: 'paired-normal-reused-slot', distance: 60, fixture: 'pair-grab:reaching' },
      { name: 'paired-caught', distance: 60, mode: 'caught', outcome: 'caught', fixture: 'pair-grab:reaching' },
      { name: 'paired-paused', distance: 60, mode: 'paused', fixture: 'pair-grab:reaching' },
      { name: 'paired-menu-reused-slots', mode: 'menu', distance: 0 },
    ];
    for (const scenario of cases.map(scenario => ({ impactMode: 'arcade', runImpactMode: 'arcade', ...scenario }))) {
      const sample = await page.evaluate(scenario => window.renderSample(scenario), scenario);
      sample.name = `${viewport.name}-${scenario.name}`;
      samples.push(sample);
      await page.screenshot({ path: path.join(output, `render-${label}-${sample.name}.png`) });
      console.log(`${sample.name}: black ${(sample.blackRatio * 100).toFixed(2)}%; largest ${sample.largest.width}x${sample.largest.height}; GL ${sample.glError}`);
    }
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await page.evaluate(() => window.resizeRenderSample());
    const resized = await page.evaluate(() => window.renderSample({ distance: 74, dash: true, slow: true, impactMode: 'arcade', runImpactMode: 'arcade' }));
    resized.name = `${viewport.name}-resized`;
    samples.push(resized);
    await page.screenshot({ path: path.join(output, `render-${label}-${resized.name}.png`) });
    // Preserve all 98 arcade captures above. Hard sequences continue the same
    // body over real frames; subsequent snapshots never respawn it in impact.
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => window.resizeRenderSample());
    const introCases = [
      { name: 'roof', introTime: 0 },
      { name: 'approach', introTime: 1.2 },
      { name: 'jump', introTime: 2.45 },
      { name: 'transition', introTime: 2.9 },
      { name: 'transition-end', introTime: 3.199 },
      { name: 'paused', introTime: 1.2, mode: 'paused', frames: 6 },
      { name: 'hard-roof', introTime: 0, impactMode: 'hard', runImpactMode: 'hard' },
      { name: 'reduced-roof', introTime: 0, reducedMotion: true, frames: 6 },
      { name: 'skip-roof', introTime: 0, skipIntro: true },
      { name: 'skip-jump', introTime: 2.45, skipIntro: true },
    ];
    for (const scenario of introCases) {
      const sample = await page.evaluate(scenario => window.renderSample(scenario), scenario);
      sample.name = `${viewport.name}-intro-${scenario.name}`;
      sample.suite = 'intro';
      samples.push(sample);
      await page.screenshot({ path: path.join(output, `render-${label}-${sample.name}.png`) });
      console.log(`${sample.name}: stage ${sample.introPose?.stage || 'complete'}; GL ${sample.glError}`);
    }
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await page.evaluate(() => window.resizeRenderSample());
    const resizedIntro = await page.evaluate(() => window.renderSample({ introTime: 0 }));
    resizedIntro.name = `${viewport.name}-intro-resized`;
    resizedIntro.suite = 'intro';
    samples.push(resizedIntro);
    await page.screenshot({ path: path.join(output, `render-${label}-${resizedIntro.name}.png`) });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => window.resizeRenderSample());
    const hardCases = [
      { name: 'flight', distance: height - 3 },
      { name: 'impact-start', mode: 'impact', outcome: 'win', distance: height, expectedPhysicsTime: 0.05 },
      { name: 'impact-mid', mode: 'impact', outcome: 'win', distance: height, frames: 15, expectedPhysicsTime: 0.8, expectContact: true },
      { name: 'impact-settled', mode: 'impact', outcome: 'win', distance: height, frames: 56, expectedPhysicsTime: 3.6, expectContact: true },
      { name: 'result', mode: 'result', outcome: 'win', distance: height, frames: 4, impactMode: 'arcade', runImpactMode: 'hard', expectedPhysicsTime: 3.8, expectContact: true },
      { name: 'caught-cleanup', mode: 'caught', outcome: 'caught', distance: 60, fixture: 'pair-grab:reaching' },
      { name: 'result-caught', mode: 'result', outcome: 'caught', distance: 60 },
      { name: 'retry-arcade', distance: 0, impactMode: 'arcade', runImpactMode: 'arcade' },
      { name: 'arcade-impact', mode: 'impact', outcome: 'win', distance: height, frames: 5, impactMode: 'arcade', runImpactMode: 'arcade' },
      { name: 'menu-cleanup', mode: 'menu', distance: 0 },
      { name: 'reduced-flight', distance: height - 3, reducedMotion: true },
      { name: 'reduced-impact-start', mode: 'impact', outcome: 'win', distance: height, reducedMotion: true, expectedPhysicsTime: 0.05 },
      { name: 'reduced-impact-mid', mode: 'impact', outcome: 'win', distance: height, reducedMotion: true, frames: 15, expectedPhysicsTime: 0.8, expectContact: true },
      { name: 'reduced-impact-settled', mode: 'impact', outcome: 'win', distance: height, reducedMotion: true, frames: 56, expectedPhysicsTime: 3.6, expectContact: true },
      { name: 'reduced-result', mode: 'result', outcome: 'win', distance: height, reducedMotion: true, expectedPhysicsTime: 3.65, expectContact: true },
      { name: 'fine-step-flight', distance: height - 3 },
      { name: 'fine-step-impact-start', mode: 'impact', outcome: 'win', distance: height, dt: 1 / 60, expectedPhysicsTime: 1 / 60 },
      { name: 'fine-step-impact-mid', mode: 'impact', outcome: 'win', distance: height, dt: 1 / 60, frames: 47, expectedPhysicsTime: 0.8, expectContact: true },
      { name: 'fine-step-impact-settled', mode: 'impact', outcome: 'win', distance: height, dt: 1 / 60, frames: 168, expectedPhysicsTime: 3.6, expectContact: true },
      ...Array.from({ length: 3 }, (_, index) => [
        { name: `pool-cycle-${index + 1}-flight`, distance: 0 },
        { name: `pool-cycle-${index + 1}-impact`, mode: 'impact', outcome: 'win', distance: height, frames: 4, expectedPhysicsTime: 0.2 },
        { name: `pool-cycle-${index + 1}-menu`, mode: 'menu', distance: 0 },
      ]).flat(),
    ];
    const hardSnapshots = new Map();
    for (const scenario of hardCases.map(scenario => ({ impactMode: 'hard', runImpactMode: 'hard', ...scenario }))) {
      const sample = await page.evaluate(scenario => window.renderSample(scenario), scenario);
      sample.name = `${viewport.name}-hard-${scenario.name}`;
      sample.suite = 'hard';
      if (scenario.name.startsWith('fine-step-impact-') && ['mid', 'settled'].includes(scenario.name.split('-').at(-1))) {
        const baseline = hardSnapshots.get(scenario.name.replace('fine-step-', ''));
        if (!baseline?.hardLanding || !sample.hardLanding) sample.visualFailures.push('both fixed-step trajectories expose the physical snapshots');
        else if (sample.hardLanding.parts.some((part, index) => Math.hypot(...part.position.map((value, axis) => value - baseline.hardLanding.parts[index].position[axis])) > 0.12)) sample.visualFailures.push('real physics reaches the same trajectory under 0.05 and 1/60 second render steps');
      }
      hardSnapshots.set(scenario.name, sample);
      samples.push(sample);
      await page.screenshot({ path: path.join(output, `render-hard-${label}-${sample.name}.png`) });
      console.log(`${sample.name}: age ${sample.hardLanding?.age?.toFixed(3)}; contacts ${sample.hardLanding?.contacts}; stains ${sample.hardLanding?.visibleStains}; GL ${sample.glError}`);
    }
    const introCleanup = await page.evaluate(() => window.renderSample({ introTime: 0, impactMode: 'hard', runImpactMode: 'hard' }));
    introCleanup.name = `${viewport.name}-intro-hard-retry-cleanup`;
    introCleanup.suite = 'intro';
    samples.push(introCleanup);
    await page.screenshot({ path: path.join(output, `render-${label}-${introCleanup.name}.png`) });
    const disposed = await page.evaluate(() => window.disposeRenderSample());
    if (!disposed.sceneDisposed || !disposed.physicsDisposed || disposed.physicsActive || disposed.bodies || disposed.joints || disposed.canvasConnected) errors.push(`${viewport.name}: disposing the scene removes the physics bodies, joints and canvas`);
    await context.close();
  }
  assert.equal(samples.filter(sample => !sample.suite).length, 98, 'All 98 original arcade render cases remain explicit defaults');
  assert.equal(samples.filter(sample => sample.suite === 'hard').length, 56, 'All 56 existing hard landing render cases remain covered');
  assert.equal(samples.filter(sample => sample.suite === 'intro').length, 24, 'Intro stages, pause, skip, hard cleanup, reduced motion and resize cover both DPRs');
  const failures = samples.filter(sample => sample.glError !== 0 || sample.nonFiniteObjects.length || sample.nonFiniteGeometryCount || sample.visualFailures.length || (sample.largest.width >= 32 && sample.largest.height >= 32));
  await writeFile(path.join(output, `render-${label}-report.json`), JSON.stringify({ passed: !failures.length && !errors.length, errors, failures: failures.map(sample => sample.name), samples }, null, 2));
  await writeFile(path.join(output, `render-hard-${label}-report.json`), JSON.stringify({ passed: !failures.some(sample => sample.suite === 'hard') && !errors.length, errors, failures: failures.filter(sample => sample.suite === 'hard').map(sample => sample.name), samples: samples.filter(sample => sample.suite === 'hard') }, null, 2));
  if (!reportOnly) {
    assert.deepEqual(errors, [], 'No browser or shader errors');
    assert.deepEqual(failures.map(sample => sample.name), [], 'All visible transforms and material values are finite; no large black rectangles or WebGL errors across scene transitions and resolutions');
  }
  console.log(`Render checks ${failures.length || errors.length ? 'failed' : 'passed'}: ${samples.length} deterministic samples. Report: artifacts/render-${label}-report.json`);
} finally {
  await browser?.close();
  server?.kill();
}
