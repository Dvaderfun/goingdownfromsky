import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RagdollPhysics } from './ragdoll.js';

const PALETTE = {
  ink: 0x171329, wall: 0x423552, side: 0x2a233a, edge: 0x75617f,
  yellow: 0xe8ff64, butter: 0xfff7a6, coral: 0xff836e, pink: 0xff63a6,
  lilac: 0xbfa1ff, cyan: 0x9ee9dd, skin: 0xf5a88c, hair: 0x211c32,
};
const DISTRICTS = [
  { wall: 0x423552, side: 0x2a233a, edge: 0x83718b, fog: 0x302840, sky: 0x252339, warm: 0xffb36e, cool: 0x859bd1, sign: 0xff8baa, text: 'ТИХО', sleeve: 0x7568a1, longSleeve: 0xb6888b, hunterSleeve: 0x426f71 },
  { wall: 0x603e4a, side: 0x352532, edge: 0xa77d82, fog: 0x422c3b, sky: 0x281d32, warm: 0xffaa75, cool: 0xc392df, sign: 0xff957c, text: 'ЧУЖІ', sleeve: 0x986273, longSleeve: 0xb49b6d, hunterSleeve: 0x507c76 },
  { wall: 0x2d4d57, side: 0x20343f, edge: 0x799b9e, fog: 0x263c45, sky: 0x192b38, warm: 0xffd7a0, cool: 0x79d9d0, sign: 0x9ee9dd, text: 'ДУЄ', sleeve: 0x628e99, longSleeve: 0xb3977c, hunterSleeve: 0x568c70 },
  { wall: 0x33354f, side: 0x24253d, edge: 0x80799b, fog: 0x292b43, sky: 0x1d2138, warm: 0xffb878, cool: 0xa49bed, sign: 0xff63a6, text: 'НЕ СПИ', sleeve: 0x84739f, longSleeve: 0xb47a8e, hunterSleeve: 0x477e83 },
  { wall: 0x5c5d73, side: 0x383d54, edge: 0xaca8be, fog: 0x3c465b, sky: 0x2b3b51, warm: 0xffe4b8, cool: 0xb4dfea, sign: 0xc6f2ed, text: 'ХМАРИ', sleeve: 0x999ab6, longSleeve: 0xc3a798, hunterSleeve: 0x62908c },
];
const RESIDENT_WIDTHS = [1, 1.08, 0.97, 1.12, 1.02];
const COLUMNS = [-6, -3, 0, 3, 6];
const ROWS = 13;
const HAZARD_POOL = 24;
const PICKUP_POOL = 28;
const TAU = Math.PI * 2;
const INTRO_DURATION = 3.2;
const clamp = THREE.MathUtils.clamp;
const smooth = (value) => value * value * (3 - 2 * value);
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const inIntro = (state) => state.mode === 'intro' || state.mode === 'paused' && state.resumeMode === 'intro';
const introTime = (state) => clamp(finite(state.introTime, finite(state.introProgress) * INTRO_DURATION), 0, INTRO_DURATION);
const random = (seed) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
};

const FinishShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
  vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 offset = (vUv - 0.5) * vec2(1.02, 0.84);
      float vignette = 1.0 - smoothstep(0.16, 0.76, length(offset)) * 0.31;
      color.rgb *= vignette;
      color.rgb += (hash(vUv * 1700.0 + floor(time * 12.0)) - 0.5) * 0.008;
      gl_FragColor = color;
    }`,
};

/** Procedural artwork and simulation-independent view of the falling arcade. */
export class RainScene {
  constructor(container) {
    this.container = container;
    this.disposed = false;
    this.resources = new Set();
    this.materials = new Map();
    this.temp = new THREE.Object3D();
    this.vector = new THREE.Vector3();
    this.vectorB = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.playPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -3);
    this.hit = new THREE.Vector3();
    this.mode = 'menu';
    this.modeTime = 0;
    this.cameraOffset = -8.8;
    this.displayTime = 0;
    this.lastDistance = 0;
    this.landingX = 0;
    this.district = -1;
    this.captureHighlight = null;
    this.introPose = {
      active: false, time: 0, stage: 'complete', roofSurfaceY: -0.275, roofEdgeZ: 2.8,
      feet: [new THREE.Vector3(), new THREE.Vector3()], grounded: false, playerPosition: new THREE.Vector3(),
    };
    this.introFootCorner = new THREE.Vector3();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(0x241f36, 1);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.renderer.domElement.className = 'rain-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x302840, 0.008);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 220);
    this.camera.position.set(-8.8, 4.3, 35);
    this.camera.lookAt(-8.8, 1.2, 3);

    this.geometry = {
      box: this.keep(new THREE.BoxGeometry(1, 1, 1)),
      plane: this.keep(new THREE.PlaneGeometry(1, 1)),
      sphere: this.keep(new THREE.SphereGeometry(1, 14, 10)),
      cylinder: this.keep(new THREE.CylinderGeometry(1, 1, 1, 10)),
      capsule: this.keep(new THREE.CapsuleGeometry(0.5, 0.5, 3, 8)),
      ring: this.keep(new THREE.TorusGeometry(1, 0.024, 5, 64)),
      crystal: this.keep(new THREE.OctahedronGeometry(0.28, 0)),
    };

    this.createLighting();
    this.createSky();
    this.createCity();
    this.createBuilding();
    this.createPlayer();
    this.createHands();
    this.createPickups();
    this.createRain();
    this.createFlightEffects();
    this.createGround();
    this.createLanding();
    this.createHardLanding();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(800, 600), 0.48, 0.52, 0.88);
    this.composer.addPass(this.bloom);
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
    this.composer.addPass(new OutputPass());
    this.resize();
    this.updateDistrict({ district: 0 });
  }

  keep(resource) {
    this.resources.add(resource);
    return resource;
  }

  material(name, options) {
    if (!this.materials.has(name)) {
      const material = this.keep(new THREE.MeshStandardMaterial({ roughness: 0.68, metalness: 0.07, ...options }));
      this.materials.set(name, material);
    }
    return this.materials.get(name);
  }

  basic(name, color, opacity = 1) {
    if (!this.materials.has(name)) {
      this.materials.set(name, this.keep(new THREE.MeshBasicMaterial({
        color, transparent: opacity < 1, opacity, depthWrite: opacity === 1, toneMapped: false,
      })));
    }
    return this.materials.get(name);
  }

  mesh(parent, geometry, material, position = [0, 0, 0], scale = [1, 1, 1]) {
    const mesh = new THREE.Mesh(typeof geometry === 'string' ? this.geometry[geometry] : geometry, material);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    parent.add(mesh);
    return mesh;
  }

  createLighting() {
    this.scene.add(new THREE.HemisphereLight(0xc3a8ff, 0x362341, 0.95));
    this.keyLight = new THREE.DirectionalLight(0xffe9cc, 2.45);
    this.keyLight.position.set(-8, 16, 17);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    Object.assign(this.keyLight.shadow.camera, { left: -13, right: 13, top: 17, bottom: -17, near: 1, far: 70 });
    this.keyLight.shadow.bias = -0.001;
    this.keyLight.shadow.normalBias = 0.035;
    this.scene.add(this.keyLight);
    this.rimLight = new THREE.DirectionalLight(0xa79aff, 2.1);
    this.rimLight.position.set(13, 5, -5);
    this.scene.add(this.rimLight);
    this.playerLight = new THREE.PointLight(PALETTE.yellow, 3, 7, 1.8);
    this.playerLight.position.set(0, 2, 5);
    this.scene.add(this.playerLight);
    this.facadeLight = new THREE.PointLight(PALETTE.coral, 80, 36, 2);
    this.facadeLight.position.set(11, 9, 7);
    this.scene.add(this.facadeLight);
    this.sideLight = new THREE.PointLight(0x8283f8, 100, 38, 2);
    this.sideLight.position.set(-12, -7, 8);
    this.scene.add(this.sideLight);
  }

  createSky() {
    const shader = this.keep(new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { topColor: { value: new THREE.Color(0x252339) }, bottomColor: { value: new THREE.Color(0x69516d) } },
      vertexShader: `varying vec3 vPosition; void main(){ vPosition = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; varying vec3 vPosition;
        void main(){ float h = smoothstep(-60.0,90.0,vPosition.y); vec3 c = mix(bottomColor, topColor, h);
        float glow = exp(-length(vPosition.xy - vec2(35.0,12.0)) * 0.015); c += vec3(0.10,0.025,0.075)*glow; gl_FragColor=vec4(c,1.0); }`,
    }));
    this.skyMaterial = shader;
    this.mesh(this.scene, this.keep(new THREE.SphereGeometry(140, 24, 16)), shader);
    const moon = this.mesh(this.scene, 'sphere', this.basic('moon', 0xf3dab4), [-38, 28, -85], [5.3, 5.3, 1]);
    moon.renderOrder = -1;
    const haloCanvas = document.createElement('canvas');
    haloCanvas.width = haloCanvas.height = 128;
    const ctx = haloCanvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(245,209,169,0.3)');
    gradient.addColorStop(0.3, 'rgba(242,195,169,0.12)');
    gradient.addColorStop(1, 'rgba(242,195,169,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const haloMaterial = this.keep(new THREE.SpriteMaterial({ map: this.keep(new THREE.CanvasTexture(haloCanvas)), transparent: true, depthWrite: false, color: 0xffd8bb }));
    const halo = new THREE.Sprite(haloMaterial);
    halo.position.copy(moon.position);
    halo.position.z += 0.5;
    halo.scale.set(30, 30, 1);
    this.scene.add(halo);
    this.clouds = [];
    const cloudMaterial = this.keep(new THREE.SpriteMaterial({ map: haloMaterial.map, color: 0x9a82b9, transparent: true, opacity: 0.28, depthWrite: false }));
    for (let i = 0; i < 11; i++) {
      const cloud = new THREE.Sprite(cloudMaterial);
      cloud.position.set((random(i + 8) - 0.5) * 170, random(i + 14) * 50 - 15, -70 - random(i + 44) * 30);
      cloud.scale.set(35 + random(i + 29) * 45, 8 + random(i) * 8, 1);
      cloud.userData.originX = cloud.position.x;
      this.clouds.push(cloud);
      this.scene.add(cloud);
    }
  }

  createCity() {
    this.city = new THREE.Group();
    this.scene.add(this.city);
    const silhouettes = this.material('city-silhouette', { color: 0x302c46, roughness: 1, metalness: 0 });
    const middle = this.material('city-mid', { color: 0x4a3c59, roughness: 1, metalness: 0 });
    const near = this.material('city-near', { color: 0x343049, roughness: 0.85 });
    const windowMaterial = this.basic('city-windows', 0xc7a8db, 0.28);
    const windowRects = [];
    for (let i = 0; i < 30; i++) {
      const layer = i % 3;
      const x = (i < 15 ? -1 : 1) * (15 + random(i + 3) * 65);
      const width = 4 + random(i + 2) * 7;
      const height = 15 + random(i + 7) * 38;
      const z = -14 - layer * 16 - random(i + 10) * 8;
      const base = -19 - random(i + 70) * 15;
      this.mesh(this.city, 'box', [near, middle, silhouettes][layer], [x, base + height * 0.5, z], [width, height, 5 + random(i) * 5]);
      this.mesh(this.city, 'box', silhouettes, [x, base + height + 0.5, z], [width + 0.3, 0.5, 6]);
      if (i % 4 === 0) {
        this.mesh(this.city, 'cylinder', this.material('antenna', { color: 0x776786 }), [x, base + height + 2, z], [0.04, 3, 0.04]);
        this.mesh(this.city, 'sphere', this.basic('antenna-tip', PALETTE.coral), [x, base + height + 3.6, z], [0.12, 0.12, 0.12]);
      }
      const countX = Math.floor(width / 1.4);
      const countY = Math.floor(height / 2.6);
      for (let row = 0; row < countY; row++) {
        for (let column = 0; column < countX; column++) {
          if (random(i * 913 + row * 41 + column * 71) < 0.51) continue;
          windowRects.push({ x: x - width / 2 + 0.8 + column * 1.4, y: base + 1.2 + row * 2.6, z: z + 4.6, seed: i + row });
        }
      }
    }
    const windows = new THREE.InstancedMesh(this.geometry.plane, windowMaterial, windowRects.length);
    this.keep(windows);
    for (let i = 0; i < windowRects.length; i++) {
      const rectangle = windowRects[i];
      this.temp.position.set(rectangle.x, rectangle.y, rectangle.z);
      this.temp.scale.set(0.34, 0.68, 1);
      this.temp.updateMatrix();
      windows.setMatrixAt(i, this.temp.matrix);
      windows.setColorAt(i, new THREE.Color(random(rectangle.seed) > 0.5 ? 0xffd99c : 0xbda6ff));
    }
    this.city.add(windows);
    // A slender neighboring tower gives the street a recognizable silhouette.
    this.neighbor = new THREE.Group();
    this.neighbor.position.set(-18, 0, -8);
    this.scene.add(this.neighbor);
    this.mesh(this.neighbor, 'box', this.material('neighbor', { color: 0x242238 }), [0, 0, 0], [5, 105, 9]);
    for (let i = -9; i < 10; i++) {
      this.mesh(this.neighbor, 'box', this.material('neighbor-ledges', { color: 0x514660 }), [0, i * 5.5, 4.6], [5.4, 0.22, 0.5]);
      this.mesh(this.neighbor, 'plane', this.basic('neighbor-lit', 0xcf9aad, 0.34), [-0.8, i * 5.5 + 1.8, 4.55], [0.85, 2.2, 1]);
      this.mesh(this.neighbor, 'plane', this.basic('neighbor-lit-two', 0xf0d29a, 0.17), [1.2, i * 5.5 + 1.8, 4.55], [0.85, 2.2, 1]);
    }
    this.districtSign = this.createSign(this.neighbor, DISTRICTS[0].text, 3.7, 14, 5.2, 1.8, 6.8, DISTRICTS[0].sign);
    this.districtSignTextures = [this.districtSign.material.map, ...DISTRICTS.slice(1).map(district => this.createSignTexture(district.text))];
  }

  createSignTexture(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 768;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 3;
    ctx.strokeRect(13, 13, 230, 742);
    ctx.font = '800 88px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const letters = text.replace(/\n/g, ' ').split('');
    const lineHeight = Math.min(105, 630 / letters.length);
    letters.forEach((letter, i) => ctx.fillText(letter, 128, 70 + i * lineHeight));
    const texture = this.keep(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  createSign(parent, text, x, y, z, width, height, color) {
    const texture = this.createSignTexture(text);
    const background = this.mesh(parent, 'box', this.material('sign-backing', { color: 0x231b35, metalness: 0.4 }), [x, y, z - 0.11], [width + 0.18, height + 0.18, 0.2]);
    background.castShadow = true;
    const material = this.keep(new THREE.MeshBasicMaterial({ map: texture, color, transparent: true, toneMapped: false, depthWrite: false }));
    const sign = this.mesh(parent, 'plane', material, [x, y, z + 0.02], [width, height, 1]);
    this.mesh(parent, 'box', this.material('sign-bracket', { color: PALETTE.edge }), [x - width / 2, y, z - 0.7], [0.15, 0.14, 1.5]);
    return sign;
  }

  updateDistrict(state) {
    const fallback = (Math.max(1, Math.floor(finite(state.level, 1))) - 1) % DISTRICTS.length;
    const district = clamp(Math.floor(finite(state.district, fallback)), 0, DISTRICTS.length - 1);
    if (this.district === district) return;
    this.district = district;
    const palette = this.districtPalette = DISTRICTS[district];
    for (const [name, color] of [
      ['wall', palette.wall], ['wall-edge', palette.side], ['facade-pilaster', palette.wall],
      ['floor-band', palette.wall], ['window-frame', palette.edge], ['window-sill', palette.edge],
      ['occupied-window-jamb', palette.edge], ['occupied-window-interior', palette.side],
      ['curtain', palette.wall], ['neighbor', palette.side], ['neighbor-ledges', palette.wall],
      ['hand-sleeve', palette.sleeve], ['long-sleeve', palette.longSleeve], ['hunter-sleeve', palette.hunterSleeve],
      ['window-person-hat', palette.sleeve], ['window-person-scarf', palette.edge],
    ]) this.materials.get(name).color.set(color);
    this.materials.get('occupied-window-interior').emissive.set(palette.wall);
    this.scene.fog.color.set(palette.fog);
    this.renderer.setClearColor(palette.sky, 1);
    this.skyMaterial.uniforms.topColor.value.set(palette.sky);
    this.skyMaterial.uniforms.bottomColor.value.set(palette.fog);
    this.rimLight.color.set(palette.cool);
    this.facadeLight.color.set(palette.sign);
    this.sideLight.color.set(palette.cool);
    this.districtSign.material.map = this.districtSignTextures[district];
    this.districtSign.material.color.set(palette.sign);
    this.lastArchitectureRow = NaN;
  }

  architecturePart(geometry, material, count, specification) {
    const mesh = new THREE.InstancedMesh(this.geometry[geometry], material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.keep(mesh);
    this.scene.add(mesh);
    this.architecture.push({ mesh, ...specification });
    return mesh;
  }

  createBuilding() {
    this.architecture = [];
    this.facadeVerticals = [];
    this.facadeHardware = [];
    const wallMaterial = this.material('wall', { color: PALETTE.wall, roughness: 0.87, metalness: 0.12 });
    this.wall = this.mesh(this.scene, 'box', wallMaterial, [0, 0, -2.2], [19.8, 160, 4.3]);
    this.wall.receiveShadow = true;
    this.wallSides = [];
    const edge = this.material('wall-edge', { color: PALETTE.side, metalness: 0.3 });
    for (const x of [-9.72, 9.72]) {
      this.wallSides.push(this.mesh(this.scene, 'box', edge, [x, 0, 0.14], [0.46, 160, 0.55]));
      this.facadeVerticals.push(this.mesh(this.scene, 'box', this.material('vertical-brass', { color: 0x887465, metalness: 0.55 }), [x + (x < 0 ? 0.42 : -0.42), 0, 0.21], [0.035, 160, 0.1]));
    }
    this.facadeVerticals.push(...this.wallSides);
    for (const x of [-7.53, -4.5, -1.5, 1.5, 4.5, 7.53]) {
      this.facadeVerticals.push(this.mesh(this.scene, 'box', this.material('facade-pilaster', { color: 0x493b5a }), [x, 0, 0.08], [0.18, 160, 0.15]));
      this.facadeVerticals.push(this.mesh(this.scene, 'box', this.material('facade-pilaster-shadow', { color: 0x31283f }), [x - 0.13, 0, 0.025], [0.055, 160, 0.05]));
    }
    const count = ROWS * COLUMNS.length;
    const frame = this.material('window-frame', { color: 0x83718b, metalness: 0.36, roughness: 0.52 });
    const recess = this.material('window-recess', { color: 0x191a2c, roughness: 0.9 });
    const glass = this.material('window-glass', { color: 0x60566c, metalness: 0.55, roughness: 0.23 });
    const sill = this.material('window-sill', { color: 0x786779, roughness: 0.72 });
    const curtain = this.material('curtain', { color: 0x6d596f, emissive: 0x9c7580, emissiveIntensity: 0.17, roughness: 1 });
    this.architecturePart('box', recess, count, { x: 0, y: 0, z: 0.07, scale: [2.21, 3.92, 0.1] });
    this.glassInstances = this.architecturePart('plane', glass, count, { x: 0, y: 0, z: 0.14, scale: [1.92, 3.64, 1] });
    const windowCanvas = document.createElement('canvas');
    windowCanvas.width = 64;
    windowCanvas.height = 128;
    const windowContext = windowCanvas.getContext('2d');
    const interiorGradient = windowContext.createLinearGradient(0, 0, 0, 128);
    interiorGradient.addColorStop(0, 'rgba(255,255,255,0.17)');
    interiorGradient.addColorStop(0.45, 'rgba(255,255,255,0.6)');
    interiorGradient.addColorStop(1, 'rgba(255,255,255,0.94)');
    windowContext.fillStyle = interiorGradient;
    windowContext.fillRect(0, 0, 64, 128);
    const interiorMap = this.keep(new THREE.CanvasTexture(windowCanvas));
    interiorMap.colorSpace = THREE.SRGBColorSpace;
    const interiorMaterial = this.keep(new THREE.MeshBasicMaterial({ color: 0xffffff, map: interiorMap, transparent: true, opacity: 0.78, depthWrite: false, toneMapped: false }));
    this.windowGlowInstances = this.architecturePart('plane', interiorMaterial, count, { x: 0, y: 0, z: 0.145, scale: [1.91, 3.63, 1] });
    this.windowGlowInstances.receiveShadow = false;
    for (const x of [-1.02, 1.02]) {
      this.architecturePart('box', frame, count, { x, y: 0, z: 0.23, scale: [0.105, 3.88, 0.22] });
    }
    for (const y of [-1.87, 1.87]) {
      this.architecturePart('box', frame, count, { x: 0, y, z: 0.23, scale: [2.16, 0.095, 0.22] });
    }
    this.architecturePart('box', frame, count, { x: 0, y: 0, z: 0.25, scale: [0.058, 3.77, 0.12] });
    this.architecturePart('box', frame, count, { x: 0, y: 0.13, z: 0.26, scale: [2, 0.06, 0.12] });
    this.architecturePart('box', sill, count, { x: 0, y: -2.02, z: 0.43, scale: [2.35, 0.18, 0.86] });
    this.architecturePart('box', this.material('sill-shadow', { color: 0x322b43 }), count, { x: 0, y: -2.18, z: 0.05, scale: [2.3, 0.18, 0.12] });
    this.architecturePart('plane', curtain, count, { x: -0.57, y: 0.15, z: 0.15, scale: [0.56, 3.28, 1], curtain: true });
    this.architecturePart('plane', this.basic('window-reflection', 0xcdc0e7, 0.1), count, { x: 0.59, y: 0.05, z: 0.18, scale: [0.13, 3.4, 1], reflection: true });
    this.architecturePart('box', this.material('ac-shell', { color: 0x9a8994, roughness: 0.8 }), count, { x: 0.72, y: -2.55, z: 0.7, scale: [0.79, 0.53, 0.65], ac: true });
    this.architecturePart('box', this.material('ac-grill', { color: 0x494254 }), count, { x: 0.72, y: -2.54, z: 1.04, scale: [0.6, 0.29, 0.025], ac: true });
    this.architecturePart('cylinder', this.material('ac-fan', { color: 0x6d6374, metalness: 0.4 }), count, { x: 0.72, y: -2.54, z: 1.07, scale: [0.13, 0.025, 0.13], rotationX: Math.PI / 2, ac: true });
    this.architecturePart('box', this.material('floor-band', { color: 0x51405c, roughness: 0.8 }), ROWS, { floor: true, x: 0, y: -4.55, z: 0.22, scale: [19.5, 0.27, 0.55] });
    this.architecturePart('box', this.material('floor-shadow', { color: 0x30263d }), ROWS, { floor: true, x: 0, y: -4.8, z: 0.04, scale: [19.3, 0.1, 0.13] });
    this.architecturePart('box', this.material('floor-topline', { color: 0x7f6880, metalness: 0.3 }), ROWS, { floor: true, x: 0, y: -4.36, z: 0.5, scale: [19.5, 0.025, 0.075] });
    this.instanceColor = new THREE.Color();
    this.lastArchitectureRow = NaN;
    this.createSign(this.scene, 'RAIN', 9.94, 11, 0.95, 1.24, 7.9, PALETTE.yellow);
    // Conduit pipes, angled drain hardware, and high-rise safety ladder.
    const pipe = this.material('drain-pipe', { color: 0x6d5d76, metalness: 0.61, roughness: 0.5 });
    for (const x of [-8.78, 8.78]) {
      this.facadeVerticals.push(this.mesh(this.scene, 'cylinder', pipe, [x, 0, 0.28], [0.065, 160, 0.065]));
      for (let i = -12; i <= 12; i++) this.facadeHardware.push(this.mesh(this.scene, 'box', pipe, [x, i * 6, 0.2], [0.25, 0.07, 0.3]));
    }
    this.roof = new THREE.Group();
    this.scene.add(this.roof);
    const roofSlab = this.mesh(this.roof, 'box', sill, [0, 0, 0], [20.6, 0.65, 5.6]);
    roofSlab.receiveShadow = true;
    // The bright front lip and paving joints make the departure edge legible
    // from the opening's oblique camera, even on a narrow phone screen.
    this.mesh(this.roof, 'box', this.material('roof-lip', { color: 0xac969b, roughness: 0.38, metalness: 0.27 }), [0, 0.345, 2.765], [20.6, 0.04, 0.07]);
    const roofJoint = this.material('roof-paving-joint', { color: 0x5a4b60, roughness: 0.9 });
    for (const x of [-8, -4, 4, 8]) this.mesh(this.roof, 'box', roofJoint, [x, 0.329, 1.13], [0.018, 0.007, 3.2]);
    this.mesh(this.roof, 'box', roofJoint, [0, 0.329, 0.9], [20.2, 0.007, 0.018]);
    this.mesh(this.roof, 'box', edge, [0, 0.7, -0.3], [19.7, 0.75, 0.35]);
    this.mesh(this.roof, 'box', this.material('roof-tank', { color: 0x53495f }), [5.7, 2.1, -2], [3.1, 2.6, 2.5]);
    const aerial = this.mesh(this.roof, 'cylinder', pipe, [-6.6, 3, -1.6], [0.07, 5, 0.07]);
    aerial.rotation.z = -0.06;
    this.mesh(this.roof, 'box', pipe, [-6.6, 4.3, -1.6], [3.2, 0.055, 0.08]);
  }

  updateBuilding(state) {
    const palette = this.districtPalette;
    const distance = state.mode === 'menu' ? 24 + Math.sin(this.displayTime * 0.12) * 0.18 : state.distance || 0;
    const offset = distance % 10;
    const absoluteRow = Math.floor(distance / 10);
    const ground = 1.2 + (state.distance || 0) - (state.height || 100);
    const groundNear = state.mode !== 'menu' && ground > -42;
    const transition = smooth(clamp((introTime(state) - 2.5) / 0.7, 0, 1));
    const roofY = inIntro(state) ? THREE.MathUtils.lerp(-0.6, 9.7, transition) : state.mode === 'menu' ? 9.7 : 9.7 + finite(state.distance);
    const wallTop = Math.min(80, roofY - 0.3);
    for (const part of this.architecture) {
      const columns = part.floor ? 1 : COLUMNS.length;
      for (let row = 0; row < ROWS; row++) {
        const rowY = 1.2 + offset + (row - 6) * 10;
        for (let column = 0; column < columns; column++) {
          const index = row * columns + column;
          const seed = (row - 6 - absoluteRow) * 107 + column * 47 + 19;
          let visible = (!groundNear || rowY > ground + 1.8) && rowY + part.y + part.scale[1] / 2 < wallTop;
          if (part.ac) visible &&= random(seed + 18) > 0.65;
          if (part.curtain) visible &&= random(seed + 22) > 0.28;
          this.temp.position.set((part.floor ? 0 : COLUMNS[column]) + part.x, rowY + part.y, part.z);
          this.temp.rotation.set(part.rotationX || 0, 0, part.reflection ? -0.11 : 0);
          this.temp.scale.set(...part.scale);
          if (!visible) this.temp.scale.set(0, 0, 0);
          this.temp.updateMatrix();
          part.mesh.setMatrixAt(index, this.temp.matrix);
          if ((part.mesh === this.glassInstances || part.mesh === this.windowGlowInstances) && absoluteRow !== this.lastArchitectureRow) {
            const lit = random(seed) > 0.4;
            const warm = random(seed + 12) > 0.26;
            if (part.mesh === this.windowGlowInstances) {
              this.instanceColor.set(lit ? (warm ? palette.warm : palette.cool) : palette.side);
              this.instanceColor.multiplyScalar(lit ? 0.75 + random(seed + 9) * 0.4 : 0.22);
            } else this.instanceColor.set(lit ? (warm ? palette.warm : palette.cool) : palette.side);
            part.mesh.setColorAt(index, this.instanceColor);
          }
        }
      }
      part.mesh.instanceMatrix.needsUpdate = true;
    }
    if (absoluteRow !== this.lastArchitectureRow) {
      this.glassInstances.instanceColor.needsUpdate = true;
      this.windowGlowInstances.instanceColor.needsUpdate = true;
      this.lastArchitectureRow = absoluteRow;
    }
    const wallBottom = groundNear ? ground : -80;
    const wallHeight = Math.max(0.1, wallTop - wallBottom);
    this.wall.position.y = wallBottom + wallHeight / 2;
    this.wall.scale.y = wallHeight;
    for (const edge of this.facadeVerticals) {
      edge.position.y = this.wall.position.y;
      edge.scale.y = wallHeight;
    }
    for (const detail of this.facadeHardware) detail.visible = detail.position.y > wallBottom && detail.position.y < wallTop;
    // The roof stays still through the standing, approach and jump shots.
    // Only the final camera handover raises it into the flight coordinates.
    this.roof.position.y = roofY;
    this.roof.visible = this.roof.position.y < 35;
    this.city.position.y = state.mode === 'menu' ? 0 : Math.min(distance * 0.12, 26);
    this.neighbor.position.y = (distance * 0.4) % 5.5;
    return ground;
  }

  createPlayer() {
    const coat = this.material('coat', { color: 0xd9e83b, emissive: 0x6d7214, emissiveIntensity: 0.08, roughness: 0.67, metalness: 0.02 });
    const coatEdge = this.material('coat-edge', { color: 0xc7d84f, roughness: 0.58 });
    const hair = this.material('hair', { color: PALETTE.hair, roughness: 0.65 });
    const skin = this.material('skin', { color: PALETTE.skin, roughness: 0.71 });
    const boots = this.material('boots', { color: 0x211e33, roughness: 0.39, metalness: 0.15 });
    const detail = this.material('coat-detail', { color: 0x414331, roughness: 0.65 });
    const scarf = this.material('scarf', { color: PALETTE.coral, emissive: 0xab291f, emissiveIntensity: 0.05 });
    this.player = new THREE.Group();
    this.scene.add(this.player);
    this.body = new THREE.Group();
    this.player.add(this.body);
    const torsoGeo = this.keep(new THREE.CylinderGeometry(0.37, 0.58, 1.09, 10, 1));
    const torso = this.mesh(this.body, torsoGeo, coat, [0, -0.06, 0], [1, 1, 0.66]);
    torso.castShadow = true;
    this.hem = this.mesh(this.body, this.keep(new THREE.CylinderGeometry(0.53, 0.59, 0.16, 10)), coatEdge, [0, -0.58, 0], [1, 1, 0.68]);
    this.mesh(this.body, 'box', coatEdge, [0.03, -0.09, 0.265], [0.035, 0.86, 0.028]);
    for (let i = 0; i < 3; i++) this.mesh(this.body, 'sphere', detail, [0.11, 0.17 - i * 0.22, 0.286], [0.034, 0.034, 0.017]);
    for (const side of [-1, 1]) {
      const pocket = this.mesh(this.body, 'box', coatEdge, [side * 0.3, -0.34, 0.29], [0.2, 0.055, 0.04]);
      pocket.rotation.z = side * -0.17;
    }
    const collar = this.mesh(this.body, 'sphere', coatEdge, [0, 0.4, 0], [0.43, 0.17, 0.3]);
    collar.castShadow = true;
    this.head = new THREE.Group();
    this.head.position.set(0, 0.77, 0.03);
    this.head.scale.setScalar(1.07);
    this.body.add(this.head);
    this.mesh(this.head, 'sphere', coat, [0, -0.03, -0.14], [0.46, 0.5, 0.32]);
    this.mesh(this.head, 'sphere', skin, [0, 0.01, 0.1], [0.31, 0.35, 0.24]);
    this.mesh(this.head, 'sphere', hair, [0, 0.14, 0.06], [0.35, 0.32, 0.27]);
    this.mesh(this.head, 'sphere', skin, [0, -0.03, 0.19], [0.27, 0.27, 0.17]);
    for (const side of [-1, 1]) {
      const fringe = this.mesh(this.head, 'sphere', hair, [side * 0.15, 0.2, 0.27], [0.21, 0.14, 0.08]);
      fringe.rotation.z = side * 0.36;
      this.mesh(this.head, 'sphere', hair, [side * 0.28, 0.03, 0.11], [0.095, 0.3, 0.17]);
      this.mesh(this.head, 'sphere', this.material('eyes', { color: 0x32253d }), [side * 0.09, 0, 0.347], [0.028, 0.045, 0.02]);
      this.mesh(this.head, 'sphere', this.material('cheeks', { color: 0xe98081 }), [side * 0.17, -0.095, 0.325], [0.055, 0.023, 0.01]);
    }
    this.mesh(this.head, 'sphere', skin, [0.008, -0.053, 0.365], [0.04, 0.04, 0.028]);
    const mouth = this.mesh(this.head, 'box', this.material('mouth', { color: 0x8e414f }), [0, -0.155, 0.345], [0.075, 0.019, 0.015]);
    mouth.rotation.z = -0.07;
    this.ponytail = new THREE.Group();
    this.ponytail.position.set(0.21, 0.31, -0.14);
    this.head.add(this.ponytail);
    this.mesh(this.ponytail, 'sphere', scarf, [0, 0.12, 0], [0.13, 0.06, 0.11]);
    for (let i = 0; i < 4; i++) {
      const strand = this.mesh(this.ponytail, 'sphere', hair, [0.08 + Math.sin(i * 0.8) * 0.1, 0.16 + i * 0.085, -i * 0.025], [0.14 - i * 0.025, 0.145, 0.085]);
      strand.rotation.z = 0.2 - i * 0.17;
    }
    this.arms = [];
    this.legs = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.32, 0.29, 0);
      this.body.add(arm);
      this.mesh(arm, 'capsule', coat, [0, -0.24, 0], [0.27, 0.58, 0.24]);
      this.mesh(arm, 'cylinder', coatEdge, [0, -0.47, 0], [0.135, 0.1, 0.13]);
      this.mesh(arm, 'sphere', skin, [0, -0.6, 0.025], [0.13, 0.18, 0.1]);
      this.mesh(arm, 'capsule', skin, [side * 0.13, -0.57, 0.03], [0.05, 0.11, 0.055]).rotation.z = side * -0.7;
      this.arms.push({ group: arm, side });
      const leg = new THREE.Group();
      leg.position.set(side * 0.22, -0.5, 0);
      this.body.add(leg);
      this.mesh(leg, 'capsule', this.material('stockings', { color: 0x52506c }), [0, -0.25, -0.015], [0.21, 0.56, 0.18]);
      this.mesh(leg, 'capsule', boots, [0, -0.64, 0], [0.24, 0.5, 0.23]);
      this.mesh(leg, 'sphere', boots, [0.015, -0.85, 0.11], [0.145, 0.13, 0.25]);
      const sole = this.mesh(leg, 'box', this.material('boot-soles', { color: 0x988195, roughness: 0.8 }), [0.01, -0.97, 0.11], [0.29, 0.052, 0.42]);
      sole.name = side < 0 ? 'player-left-sole' : 'player-right-sole';
      this.legs.push({ group: leg, side, sole });
    }
    this.mesh(this.body, 'sphere', scarf, [0, 0.46, 0.05], [0.35, 0.12, 0.28]);
    this.scarf = new THREE.Group();
    this.scarf.position.set(-0.18, 0.5, -0.03);
    this.body.add(this.scarf);
    this.scarfPieces = [];
    for (let i = 0; i < 5; i++) {
      const piece = this.mesh(this.scarf, 'box', scarf, [-0.08 - i * 0.075, 0.08 + i * 0.18, -0.03 * i], [0.2 - i * 0.018, 0.25, 0.045]);
      this.scarfPieces.push(piece);
    }
    this.body.traverse((object) => { if (object.isMesh) object.castShadow = true; });

    // A painted contact shadow anchors the character to the facade without UI.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(10,6,22,0.6)');
    gradient.addColorStop(1, 'rgba(10,6,22,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    this.shadow = this.mesh(this.scene, 'plane', this.keep(new THREE.MeshBasicMaterial({ map: this.keep(new THREE.CanvasTexture(canvas)), transparent: true, depthWrite: false })), [0, 1, 0.36], [3.2, 4, 1]);
    this.trail = [];
    for (let i = 0; i < 9; i++) {
      const material = this.keep(new THREE.MeshBasicMaterial({ color: PALETTE.yellow, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      const particle = this.mesh(this.scene, 'box', material, [0, 0, 3], [0, 0, 0]);
      particle.userData.x = 0;
      particle.userData.y = 1.2;
      particle.userData.distance = 0;
      particle.userData.age = 1;
      this.trail.push(particle);
    }
    this.trailClock = 0;
  }

  updatePlayer(state, dt) {
    if (inIntro(state)) {
      this.updateIntroPlayer(state);
      return;
    }
    this.introPose.active = false;
    const t = this.displayTime;
    const menu = state.mode === 'menu';
    const x = Number.isFinite(state.x) ? state.x : 0;
    const velocity = finite(state.velocity);
    const dash = state.dashTimer > 0;
    const launch = clamp(finite(state.launchProgress, 1), 0, 1);
    const flight = smooth(launch);
    const intensity = menu ? 0.22 : clamp(finite(state.fallIntensity, 0.45), 0, 1);
    const flutter = 1 + intensity * 0.9;
    const near = clamp(finite(state.nearTimer) / 0.25, 0, 1);
    const cinematic = ['impact', 'result'].includes(state.mode) && state.outcome === 'win';
    const caught = state.mode === 'caught' || (state.mode === 'result' && state.outcome === 'caught');
    this.player.position.set(x, 1.2 + (menu ? Math.sin(t * 1.4) * 0.14 : 0), 3);
    this.player.rotation.x = this.player.rotation.y = 0;
    this.player.rotation.z = THREE.MathUtils.damp(this.player.rotation.z, clamp(-velocity * 0.022, -0.4, 0.4) + (menu ? -0.15 + Math.sin(t) * 0.035 : 0), 8, dt);
    this.body.rotation.x = menu ? -0.06 : -0.04 - Math.sin(launch * Math.PI) * 0.16;
    this.body.rotation.y = clamp(velocity * 0.009, -0.16, 0.16);
    this.head.rotation.z = Math.sin(t * 1.8) * 0.035;
    this.head.rotation.x = -0.07 + Math.sin(t * 1.4) * 0.025;
    for (const arm of this.arms) {
      arm.group.rotation.z = arm.side * (THREE.MathUtils.lerp(0.18, 1.66, menu ? 1 : flight) + Math.sin(t * 3.1 * flutter + arm.side) * 0.12) - velocity * 0.012;
      arm.group.rotation.x = -0.22 + Math.sin(t * 2.3 * flutter + arm.side) * 0.1;
      if (caught) arm.group.rotation.z = arm.side * 2.6;
    }
    for (const leg of this.legs) {
      leg.group.rotation.z = leg.side * (0.3 + Math.sin(t * 2.8 * flutter + leg.side * 1.4) * 0.13) * (menu ? 1 : 0.4 + flight * 0.6) + velocity * 0.018;
      leg.group.rotation.x = Math.sin(t * 2.2 * flutter + leg.side) * 0.16 - Math.sin(launch * Math.PI) * 0.28;
    }
    this.ponytail.rotation.z = -0.28 + Math.sin(t * 4.1 * flutter) * (0.12 + intensity * 0.14) + velocity * 0.021;
    this.ponytail.rotation.x = -intensity * 0.32 + Math.sin(t * 3.3) * 0.1;
    this.hem.rotation.z = Math.sin(t * 5 * flutter) * (0.035 + intensity * 0.035);
    this.hem.scale.x = 1 + intensity * 0.07 + Math.sin(t * 4.5 * flutter) * 0.045;
    for (let i = 0; i < this.scarfPieces.length; i++) {
      const piece = this.scarfPieces[i];
      piece.position.x = -0.08 - i * 0.08 + Math.sin(t * 4.3 * flutter - i * 0.65) * i * (0.035 + intensity * 0.025) - velocity * i * 0.005;
      piece.position.y = 0.08 + i * (0.18 + intensity * 0.025);
      piece.position.z = -0.03 * i + Math.cos(t * 3.1 * flutter - i * 0.8) * i * 0.03;
      piece.rotation.z = -0.35 + Math.cos(t * 4.3 * flutter - i * 0.65) * 0.27;
    }
    const scale = cinematic ? (state.mode === 'result' ? 0 : Math.max(0.01, 1 - smooth(clamp(this.modeTime / 0.75, 0, 1)))) : 1;
    this.player.scale.setScalar(scale * (menu ? 1.35 : 1));
    this.player.visible = scale > 0.02;
    this.shadow.position.set(x + 0.3, this.player.position.y - 0.3, 0.38);
    this.shadow.rotation.set(0, 0, 0);
    this.shadow.scale.set(3.2, 4, 1);
    this.shadow.visible = this.player.visible;
    this.playerLight.position.set(x - 0.8, this.player.position.y + 0.9, 5.4);
    this.playerLight.intensity = dash ? 7 : 3 + near * 3 + clamp(finite(state.pickupTimer) / 0.35, 0, 1) * 2;
    this.trailClock += dt;
    for (const particle of this.trail) particle.userData.age = Math.min(1, particle.userData.age + dt);
    if (this.trailClock > 0.026 && (dash || state.slow) && !menu && !cinematic && !caught) {
      this.trailClock = 0;
      for (let i = this.trail.length - 1; i > 0; i--) {
        Object.assign(this.trail[i].userData, this.trail[i - 1].userData);
      }
      this.trail[0].userData.x = x;
      this.trail[0].userData.y = this.player.position.y;
      this.trail[0].userData.distance = finite(state.distance);
      this.trail[0].userData.age = 0;
      this.trail[0].userData.dash = dash;
    }
    for (let i = 0; i < this.trail.length; i++) {
      const particle = this.trail[i];
      const life = Math.max(0, 1 - particle.userData.age / 0.32);
      particle.visible = life > 0 && !cinematic && !menu && !caught;
      particle.position.set(particle.userData.x, particle.userData.y + finite(state.distance) - particle.userData.distance, 2.92);
      const size = life * (particle.userData.dash ? 0.16 : 0.085);
      particle.scale.set(size, life * (particle.userData.dash ? 0.95 : 0.45), 0.025);
      particle.rotation.z = clamp(-velocity * 0.018, -0.35, 0.35);
      particle.material.opacity = life * (particle.userData.dash ? 0.23 : 0.11);
    }
  }

  updateIntroPlayer(state) {
    const t = introTime(state);
    const approach = clamp((t - 0.8) / 0.9, 0, 1);
    const jump = clamp((t - 1.7) / 0.8, 0, 1);
    const airborne = smooth(clamp((jump - 0.14) / 0.86, 0, 1));
    const transition = smooth(clamp((t - 2.5) / 0.7, 0, 1));
    const grounded = t < 1.812;
    const breath = state.reducedMotion ? 0 : Math.sin(t * 2.8) * 0.018;
    const anticipation = t >= 1.7 && jump < 0.14 ? Math.sin(jump / 0.14 * Math.PI) : 0;
    const stride = t < 1.7 ? Math.sin(approach * Math.PI * 2) * Math.sin(approach * Math.PI) : 0;
    const arc = Math.sin(airborne * Math.PI);
    const endFlight = smooth(clamp((jump - 0.75) / 0.25, 0, 1));
    const z = t < 1.7 ? 1.5 + smooth(approach) * 0.95
      : THREE.MathUtils.lerp(2.45 + airborne * 1.1, 3, transition);
    const y = grounded ? 1.221 : THREE.MathUtils.lerp(1.221 + arc * 0.54 - airborne * 0.571, 1.2, transition);

    this.player.position.set(0, y, z);
    this.player.rotation.set(0, 0, 0);
    this.player.scale.setScalar(1);
    this.player.visible = true;
    this.body.rotation.set(anticipation * 0.10 - airborne * 0.21 * (1 - transition), 0.18 * (1 - airborne), 0);
    this.head.rotation.set(0.035 + smooth(approach) * 0.055 - airborne * 0.16, 0, breath);
    for (const arm of this.arms) {
      arm.group.rotation.z = arm.side * (0.12 + airborne * 1.54 + breath * 0.7);
      arm.group.rotation.x = -stride * arm.side * 0.26 - anticipation * 0.32 - airborne * 0.22;
    }
    for (const leg of this.legs) {
      leg.group.rotation.z = leg.side * airborne * (0.18 + endFlight * 0.12);
      leg.group.rotation.x = stride * leg.side * 0.28 - anticipation * 0.28
        + airborne * (leg.side < 0 ? -0.23 : 0.16) * (1 - transition);
    }
    this.ponytail.rotation.set(-airborne * 0.26, 0, -0.10 + breath * 2 - airborne * 0.18);
    this.hem.rotation.z = breath * (0.4 + airborne);
    this.hem.scale.x = 1 + airborne * 0.065;
    for (let i = 0; i < this.scarfPieces.length; i++) {
      const piece = this.scarfPieces[i];
      piece.position.set(-0.08 - i * 0.055 + breath * i, THREE.MathUtils.lerp(-i * 0.16, 0.08 + i * 0.2, airborne), -0.03 * i - airborne * i * 0.035);
      piece.rotation.z = THREE.MathUtils.lerp(-0.18, -0.35, airborne) + breath * i;
    }

    // Grounding comes from the actual boot geometry, including the approach
    // stride and takeoff lean, rather than from a hand-tuned floating offset.
    this.player.updateMatrixWorld(true);
    if (grounded) {
      let lowest = Infinity;
      for (const leg of this.legs) {
        for (const x of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
          this.introFootCorner.set(x, -0.5, z);
          leg.sole.localToWorld(this.introFootCorner);
          lowest = Math.min(lowest, this.introFootCorner.y);
        }
      }
      this.player.position.y += this.roof.position.y + 0.325 - lowest;
      this.player.updateMatrixWorld(true);
    }
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i];
      const foot = this.introPose.feet[i];
      foot.set(0, -0.5, 0);
      leg.sole.localToWorld(foot);
    }
    Object.assign(this.introPose, {
      active: true, time: t,
      stage: t < 0.8 ? 'roof' : t < 1.7 ? 'approach' : t < 2.5 ? 'jump' : t < INTRO_DURATION ? 'transition' : 'complete',
      roofSurfaceY: this.roof.position.y + 0.325, roofEdgeZ: 2.8, grounded,
    });
    this.introPose.playerPosition.copy(this.player.position);
    this.shadow.visible = grounded;
    this.shadow.position.set(0, this.roof.position.y + 0.33, this.player.position.z + 0.08);
    this.shadow.rotation.set(-Math.PI / 2, 0, 0);
    this.shadow.scale.set(1.8, 1.05, 1);
    this.playerLight.position.set(-1.2, this.player.position.y + 1.7, this.player.position.z + 2.6);
    this.playerLight.intensity = 3.2;
    this.trailClock = 0;
    for (const particle of this.trail) {
      particle.visible = false;
      particle.userData.age = 1;
    }
  }

  updateIntroCamera(state) {
    const t = introTime(state);
    const jump = smooth(clamp((t - 1.7) / 0.8, 0, 1));
    const transition = smooth(clamp((t - 2.5) / 0.7, 0, 1));
    // A three-quarter roof shot shows the front edge below the shoes and
    // enough city beyond it to communicate height before the leap.
    const viewHeight = Math.max(6.4, 4.1 / this.aspect);
    const distance = viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.vectorB.set(0, THREE.MathUtils.lerp(0.95, 0.9, jump), THREE.MathUtils.lerp(1.78, 3.1, jump));
    this.vector.set(-0.36 + jump * 0.09, 0.33 - jump * 0.05, 0.87).normalize().multiplyScalar(distance).add(this.vectorB);
    this.camera.position.copy(this.vector).lerp(this.direction.set(0, 4.2, this.cameraZ), transition);
    this.vectorB.lerp(this.direction.set(0, 1.2, 3), transition);
    this.camera.lookAt(this.vectorB);
    this.camera.updateMatrixWorld();
  }

  createHands() {
    this.hands = [];
    const sleeve = this.material('hand-sleeve', { color: 0x7568a1, roughness: 0.74 });
    const longSleeve = this.material('long-sleeve', { color: 0xb6888b, roughness: 0.74 });
    const hunterSleeve = this.material('hunter-sleeve', { color: 0x426f71, roughness: 0.7 });
    const skin = this.material('hand-glove', { color: 0xf1b498, roughness: 0.77, metalness: 0 });
    const nails = this.material('hand-nails', { color: 0xe8b29e, roughness: 0.64, metalness: 0 });
    const hair = this.material('window-person-hair', { color: 0x352b39, roughness: 0.9, metalness: 0 });
    const features = this.material('window-person-features', { color: 0x57404a, roughness: 0.9, metalness: 0 });
    const trousers = this.material('window-person-trousers', { color: 0x3b344b, roughness: 0.95, metalness: 0 });
    const interior = this.material('occupied-window-interior', { color: 0x30263e, emissive: 0x423147, emissiveIntensity: 0.24, roughness: 1, metalness: 0 });
    const jamb = this.material('occupied-window-jamb', { color: 0x786b83, roughness: 0.65, metalness: 0.22 });
    const cuff = this.material('hand-cuff', { color: 0xbba2cb, roughness: 0.84 });
    const hunterCuff = this.material('hunter-cuff', { color: PALETTE.coral, emissive: 0x6f271c, emissiveIntensity: 0.18 });
    const hatMaterial = this.material('window-person-hat', { color: 0x7568a1, roughness: 0.92 });
    const scarfMaterial = this.material('window-person-scarf', { color: 0xbba2cb, roughness: 0.85 });
    const torsoGeometry = this.keep(new THREE.CylinderGeometry(0.55, 0.45, 1.42, 12));
    const reticleGeometry = this.keep(new THREE.BufferGeometry());
    // Four open corners are a target cue, distinct from a collectible ring.
    reticleGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.62, 0.35, 0, -0.62, 0.62, 0, -0.62, 0.62, 0, -0.35, 0.62, 0,
      0.35, 0.62, 0, 0.62, 0.62, 0, 0.62, 0.62, 0, 0.62, 0.35, 0,
      0.62, -0.35, 0, 0.62, -0.62, 0, 0.62, -0.62, 0, 0.35, -0.62, 0,
      -0.35, -0.62, 0, -0.62, -0.62, 0, -0.62, -0.62, 0, -0.62, -0.35, 0,
    ], 3));
    for (let i = 0; i < HAZARD_POOL; i++) {
      const group = new THREE.Group();
      group.visible = false;
      this.scene.add(group);
      group.name = 'occupied-window';
      const opening = new THREE.Group();
      opening.name = 'open-window-frame';
      group.add(opening);
      // This inset covers only the glass, curtain and closed sash inside the
      // existing frame. A shallow foreground frame keeps the resident inside
      // an open window instead of floating in front of opaque glass.
      this.mesh(opening, 'plane', interior, [0, 0, 0.36], [1.94, 3.64, 1]);
      for (const side of [-1, 1]) {
        this.mesh(opening, 'box', jamb, [side * 1.01, 0, 0.57], [0.10, 3.77, 0.40]);
        this.mesh(opening, 'box', interior, [side * 0.92, 0, 0.47], [0.07, 3.59, 0.21]);
      }
      this.mesh(opening, 'box', jamb, [0, 1.86, 0.57], [2.14, 0.09, 0.40]);
      this.mesh(opening, 'box', jamb, [0, -1.88, 0.65], [2.16, 0.12, 0.41]);

      const person = new THREE.Group();
      person.name = 'window-person';
      group.add(person);
      const torso = this.mesh(person, torsoGeometry, sleeve, [0, -0.40, 0.43], [1, 1, 0.48]);
      torso.name = 'window-person-torso';
      torso.castShadow = true;
      const waist = this.mesh(person, 'sphere', trousers, [0, -1.24, 0.40], [0.43, 0.34, 0.21]);
      const seam = this.mesh(person, 'box', cuff, [0, -0.4, 0.705], [0.025, 1.21, 0.015]);
      const collar = this.mesh(person, 'sphere', cuff, [0, 0.32, 0.46], [0.27, 0.09, 0.19]);
      const neck = this.mesh(person, 'cylinder', skin, [0, 0.57, 0.44], [0.12, 0.31, 0.12]);
      neck.name = 'window-person-neck';
      const head = new THREE.Group();
      head.name = 'window-person-head';
      head.position.set(0, 0.99, 0.44);
      person.add(head);
      this.mesh(head, 'sphere', skin, [0, 0, 0], [0.255, 0.35, 0.205]);
      const hairCrown = this.mesh(head, 'sphere', hair, [0, 0.17, -0.035], [0.272, 0.235, 0.213]);
      this.mesh(head, 'sphere', hair, [-0.10, 0.23, 0.10], [0.18, 0.09, 0.14]).rotation.z = 0.24;
      for (const side of [-1, 1]) {
        this.mesh(head, 'sphere', skin, [side * 0.245, -0.015, 0], [0.048, 0.083, 0.05]);
        this.mesh(head, 'sphere', features, [side * 0.087, 0.015, 0.191], [0.020, 0.016, 0.014]);
        const eyebrow = this.mesh(head, 'box', hair, [side * 0.083, 0.075, 0.187], [0.076, 0.015, 0.014]);
        eyebrow.rotation.z = side * -0.17;
      }
      this.mesh(head, 'sphere', skin, [0, -0.044, 0.214], [0.047, 0.070, 0.055]);
      this.mesh(head, 'box', features, [0, -0.157, 0.18], [0.065, 0.012, 0.012]);
      const headwear = this.mesh(head, 'sphere', hatMaterial, [0, 0.23, -0.035], [0.30, 0.20, 0.23]);
      const brim = this.mesh(head, 'box', hatMaterial, [0, 0.16, 0.13], [0.61, 0.045, 0.32]);
      const sideHair = [-1, 1].map(side => this.mesh(head, 'sphere', hair, [side * 0.24, -0.035, -0.01], [0.10, 0.30, 0.18]));
      const scarf = this.mesh(person, 'sphere', scarfMaterial, [0, 0.38, 0.56], [0.34, 0.12, 0.21]);

      const arms = [];
      for (const side of [-1, 1]) {
        const shoulder = this.mesh(person, 'sphere', sleeve, [side * 0.51, 0.24, 0.48], [0.17, 0.19, 0.17]);
        shoulder.name = side < 0 ? 'left-shoulder' : 'right-shoulder';
        const upper = this.mesh(person, 'cylinder', sleeve);
        const lower = this.mesh(person, 'cylinder', sleeve);
        const elbow = this.mesh(person, 'sphere', sleeve, [0, 0, 0], [0.135, 0.135, 0.135]);
        const wrist = this.mesh(person, 'sphere', skin, [0, 0, 0], [0.095, 0.10, 0.09]);
        const cuffMesh = this.mesh(person, 'cylinder', cuff);
        for (const mesh of [shoulder, upper, lower, elbow]) mesh.castShadow = true;
        const palm = new THREE.Group();
        palm.name = side < 0 ? 'left-hand' : 'right-hand';
        person.add(palm);
        const palmMesh = this.mesh(palm, 'sphere', skin, [0, 0, 0], [0.22, 0.27, 0.105]);
        palmMesh.castShadow = true;
        const fingers = [];
        for (let finger = 0; finger < 4; finger++) {
          const digit = new THREE.Group();
          // Index finger starts beside the inward-facing thumb. Mirroring
          // positions, rather than negative scale, preserves handedness.
          digit.position.set(-side * (0.128 - finger * 0.085), 0.205, 0.012);
          palm.add(digit);
          const length = [0.265, 0.32, 0.30, 0.235][finger];
          this.mesh(digit, 'capsule', skin, [0, length * 0.22, 0], [0.066, length * 0.42, 0.060]);
          const end = new THREE.Group();
          end.position.y = length * 0.49;
          digit.add(end);
          this.mesh(end, 'capsule', skin, [0, length * 0.22, 0], [0.058, length * 0.35, 0.054]);
          this.mesh(end, 'sphere', nails, [0, length * 0.30, 0.025], [0.021, 0.036, 0.008]);
          fingers.push({ group: digit, end, finger });
        }
        const thumb = new THREE.Group();
        thumb.position.set(-side * 0.19, -0.075, 0.025);
        thumb.rotation.z = side * 0.85;
        palm.add(thumb);
        this.mesh(thumb, 'capsule', skin, [0, 0.065, 0], [0.092, 0.15, 0.085]);
        const crease = this.mesh(palm, 'box', this.material('palm-crease', { color: 0xc38b7e, roughness: 0.9 }), [0, 0.015, 0.104], [0.18, 0.008, 0.004]);
        crease.rotation.z = side * 0.23;
        arms.push({ side, shoulder, upper, lower, elbow, wrist, cuff: cuffMesh, palm, palmMesh, fingers, thumb,
          shoulderPoint: shoulder.position, elbowPoint: new THREE.Vector3(), wristPoint: new THREE.Vector3() });
      }
      const warningMaterial = this.keep(new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      const warning = this.mesh(group, this.geometry.ring, warningMaterial);
      const halo = this.mesh(group, 'plane', this.keep(new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })), [0, 0, 0.3], [2.1, 3.74, 1]);
      const light = this.mesh(group, 'box', warningMaterial, [0, 0, 0], [2.12, 0.07, 0.11]);
      const hazardMarker = this.mesh(group, this.geometry.ring, warningMaterial, [0, 0, 3], [0.78, 0.78, 1]);
      const targetMaterial = this.keep(new THREE.LineBasicMaterial({ color: PALETTE.coral, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      const target = new THREE.LineSegments(reticleGeometry, targetMaterial);
      target.visible = false;
      group.add(target);
      this.hands.push({ group, person, opening, torso, waist, seam, collar, neck, head, hairCrown, headwear, brim, sideHair, scarf, arms, caught: false, catchCenter: new THREE.Vector3(),
        warning, warningMaterial, halo, light, hazardMarker, target, targetMaterial, sleeve, longSleeve, hunterSleeve, hunterCuff });
    }
    this.menuHands = [
      { id: -1, phase: -1, baseX: -6, x: -5.55, y: -2.8, type: 'grab', warning: 1, active: true, passed: false },
      { id: -2, phase: -2, baseX: 3, x: 2.3, y: 7.2, type: 'sweep', warning: 0.88, active: true, passed: false },
      { id: -3, phase: -3, baseX: 6, x: 5.6, y: -8.8, type: 'long', warning: 0.7, active: false, passed: false },
    ];
    this.wristOffset = new THREE.Vector3();
  }

  segment(mesh, start, end, width) {
    this.direction.subVectors(end, start);
    const length = this.direction.length();
    mesh.position.copy(start).addScaledVector(this.direction, 0.5);
    mesh.quaternion.setFromUnitVectors(this.up, length > 0.000001 ? this.direction.divideScalar(length) : this.up);
    mesh.scale.set(width, Math.max(0.001, length), width);
  }

  updateHands(state) {
    this.captureHighlight = state.mode === 'caught' ? state.caughtBy?.id ?? null : null;
    for (const hand of this.hands) hand.caught = false;
    if (inIntro(state)) {
      for (const hand of this.hands) hand.group.visible = false;
      return;
    }
    const menu = state.mode === 'menu';
    const hazards = menu ? this.menuHands : state.hazards || [];
    const t = this.displayTime;
    if (menu) {
      const rowY = 1.2 + (24 + Math.sin(t * 0.12) * 0.18) % 10;
      this.menuHands[0].y = rowY - 10;
      this.menuHands[1].y = rowY;
      this.menuHands[2].y = rowY - 10;
    }
    let slot = 0;
    for (const hazard of hazards) {
      if (slot >= this.hands.length) break;
      if (!Number.isFinite(hazard.x) || !Number.isFinite(hazard.y) || !Number.isFinite(hazard.baseX)) continue;
      if (hazard.y > 33 || hazard.y < -39 || hazard.warning <= 0 && !hazard.active) continue;
      const hand = this.hands[slot++];
      hand.group.visible = true;
      hand.caught = this.captureHighlight !== null && hazard.id === this.captureHighlight;
      hand.person.position.set(hazard.baseX, hazard.y, 0);
      hand.opening.position.set(hazard.baseX, hazard.y, 0);
      hand.catchCenter.set(hazard.x, hazard.y, 3);
      // Gameplay IDs are opaque strings; animation uses the numeric phase.
      const phase = finite(hazard.phase);
      const hunter = hazard.type === 'hunter';
      const locked = hunter && (hazard.locked || hazard.stage === 'locked' || hazard.stage === 'reaching');
      const amount = hazard.active ? 1 : smooth(clamp(finite(hazard.warning), 0, 1));
      const anticipation = Math.min(0.2, amount * 0.22);
      const extension = hazard.passed
        ? 1 - smooth(clamp((hazard.y - (1.2 + 1.15)) / 4.2, 0, 1))
        : hazard.active ? 1 : hunter && locked ? 0.34 : anticipation;
      const forearmMaterial = hunter ? hand.hunterSleeve : hazard.type === 'long' ? hand.longSleeve : hand.sleeve;
      hand.torso.material = forearmMaterial;
      hand.torso.position.z = 0.43 + extension * 0.08;
      hand.torso.rotation.x = extension * 0.09;
      hand.waist.position.z = 0.40 + extension * 0.02;
      hand.seam.position.z = 0.705 + extension * 0.04;
      hand.collar.position.z = 0.46 + extension * 0.10;
      hand.neck.position.z = 0.44 + extension * 0.12;
      hand.head.position.z = 0.44 + extension * 0.12;
      hand.head.rotation.set(-0.05 - extension * 0.08, clamp((hazard.x - hazard.baseX) * 0.18, -0.28, 0.28), 0);
      hand.torso.scale.x = RESIDENT_WIDTHS[this.district];
      hand.head.scale.set(1 + (this.district === 2 ? 0.06 : 0), this.district === 4 ? 1.08 : 1, 1);
      hand.hairCrown.scale.set(this.district === 2 ? 0.30 : 0.272, this.district === 4 ? 0.29 : 0.235, 0.213);
      hand.headwear.visible = this.district === 1 || this.district === 3;
      hand.brim.visible = this.district === 1;
      for (const hair of hand.sideHair) hair.visible = this.district === 2;
      hand.scarf.visible = this.district === 2 || this.district === 4;
      hand.scarf.position.z = 0.56 + extension * 0.10;
      // Both hands belong to this resident. Their active midpoint is the
      // actual gameplay catch center; neither hand is an invisible proxy.
      const centerX = (hazard.x - hazard.baseX) * extension;
      const spread = THREE.MathUtils.lerp(0.67, hazard.type === 'long' ? 0.40 : 0.30, extension);
      const palmZ = THREE.MathUtils.lerp(0.80, 3, extension);
      for (const arm of hand.arms) {
        const side = arm.side;
        arm.shoulder.material = arm.upper.material = arm.lower.material = arm.elbow.material = forearmMaterial;
        arm.cuff.material = hunter ? hand.hunterCuff : this.materials.get('hand-cuff');
        arm.shoulder.position.set(side * 0.51, 0.24, 0.48 + extension * 0.12);
        arm.palm.position.set(centerX + side * spread, 0, palmZ);
        arm.palm.rotation.set(-0.08 - (1 - extension) * 0.15, side * 0.13, side * 0.08);
        arm.palm.scale.setScalar(1);
        arm.elbowPoint.set(centerX * 0.40 + side * (0.68 + extension * 0.12), -0.51 + extension * 0.16, 0.62 + extension * 1.03);
        this.wristOffset.set(0, -0.23, -0.035).applyEuler(arm.palm.rotation);
        arm.wristPoint.copy(arm.palm.position).add(this.wristOffset);
        this.segment(arm.upper, arm.shoulderPoint, arm.elbowPoint, 0.145);
        this.segment(arm.lower, arm.elbowPoint, arm.wristPoint, 0.105);
        arm.elbow.position.copy(arm.elbowPoint);
        arm.wrist.position.copy(arm.wristPoint);
        this.vector.copy(arm.wristPoint).lerp(arm.elbowPoint, 0.13);
        this.segment(arm.cuff, this.vector, arm.wristPoint, 0.117);
        for (const finger of arm.fingers) {
          const open = !hazard.active && !hazard.passed;
          finger.group.rotation.z = side * (finger.finger - 1.5) * 0.035;
          finger.group.rotation.x = open ? -0.13 : -0.34;
          finger.end.rotation.x = open ? -0.22 : -0.80;
          finger.end.rotation.z = open ? 0 : side * 0.24;
        }
        arm.thumb.rotation.x = hazard.active ? -0.32 : -0.12;
        arm.thumb.rotation.z = side * (hazard.active ? 0.62 : 0.85);
      }
      const pulse = state.reducedMotion ? 1 : 0.77 + Math.sin(t * 6 + phase) * 0.23;
      hand.warningMaterial.color.set(hunter ? locked ? PALETTE.coral : PALETTE.cyan : hazard.active ? PALETTE.pink : PALETTE.yellow);
      hand.warningMaterial.opacity = hazard.passed ? 0.1 : (hazard.active ? 0.48 : 0.72 * amount * pulse);
      hand.warning.position.set(hazard.baseX, hazard.y, 0.80);
      hand.warning.scale.set(0.77, 1.47, 1);
      hand.light.position.set(hazard.baseX, hazard.y - 1.82, 0.88);
      hand.halo.position.set(hazard.baseX, hazard.y, 0.37);
      hand.halo.material.color.copy(hand.warningMaterial.color);
      hand.halo.material.opacity = hazard.active ? 0.06 : 0.035 * amount;
      hand.hazardMarker.visible = !hazard.passed && hazard.active;
      hand.hazardMarker.position.set(hazard.x, hazard.y, 2.82);
      hand.hazardMarker.scale.setScalar(0.75 + (1 - pulse) * 0.035);
      hand.target.visible = hunter && !hazard.passed && !hazard.active;
      hand.target.position.set(finite(hazard.targetX, hazard.x), hazard.y, 3.06);
      hand.target.scale.setScalar(locked ? 1 : 0.88 + (1 - pulse) * 0.08);
      hand.targetMaterial.color.set(locked ? PALETTE.coral : PALETTE.cyan);
      hand.targetMaterial.opacity = locked ? 0.94 : amount * 0.57;
      if (this.captureHighlight !== null) {
        if (hand.caught) {
          const fade = 1 - smooth(clamp(this.modeTime / 0.85, 0, 1));
          hand.warningMaterial.color.set(PALETTE.coral);
          hand.warningMaterial.opacity = 0.45 + fade * 0.45;
          hand.warning.scale.set(0.79 + fade * 0.035, 1.50 + fade * 0.035, 1);
          hand.halo.material.color.set(PALETTE.coral);
          hand.halo.material.opacity = 0.09 + fade * 0.12;
          hand.target.visible = fade > 0;
          hand.target.position.set(hazard.baseX, hazard.y, 0.88);
          hand.target.scale.set(1.55 + fade * 0.05, 2.75 + fade * 0.05, 1);
          hand.targetMaterial.color.set(PALETTE.coral);
          hand.targetMaterial.opacity = fade * 0.9;
        } else {
          hand.warningMaterial.opacity *= 0.18;
          hand.halo.material.opacity *= 0.18;
          hand.hazardMarker.visible = false;
          hand.target.visible = false;
        }
      }
    }
    for (; slot < this.hands.length; slot++) this.hands[slot].group.visible = false;
  }

  createPickups() {
    this.pickups = [];
    const crystal = this.material('crystal', { color: PALETTE.cyan, emissive: PALETTE.cyan, emissiveIntensity: 1.3, roughness: 0.14, metalness: 0.33, transparent: true, opacity: 0.94 });
    const riskCrystal = this.material('risk-crystal', { color: PALETTE.coral, emissive: PALETTE.coral, emissiveIntensity: 1.55, roughness: 0.14, metalness: 0.33, transparent: true, opacity: 0.94 });
    const riskRing = this.keep(new THREE.BufferGeometry());
    riskRing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.66, 0, 0.55, 0, 0, 0, -0.66, 0, -0.55, 0, 0], 3));
    const riskRingMaterial = this.keep(new THREE.LineBasicMaterial({ color: PALETTE.coral, transparent: true, opacity: 0.72, depthWrite: false, toneMapped: false }));
    for (let i = 0; i < PICKUP_POOL; i++) {
      const group = new THREE.Group();
      group.visible = false;
      this.scene.add(group);
      const gem = this.mesh(group, 'crystal', crystal);
      gem.scale.y = 1.55;
      const ring = this.mesh(group, this.geometry.ring, this.basic('pickup-ring', PALETTE.cyan, 0.37), [0, 0, -0.1], [0.5, 0.5, 0.5]);
      const diamond = new THREE.LineLoop(riskRing, riskRingMaterial);
      diamond.position.z = -0.08;
      diamond.visible = false;
      group.add(diamond);
      this.pickups.push({ group, gem, ring, diamond, crystal, riskCrystal });
    }
  }

  updatePickups(state) {
    if (inIntro(state)) {
      for (const pickup of this.pickups) pickup.group.visible = false;
      return;
    }
    const pickups = state.pickups || [];
    let slot = 0;
    for (const pickup of pickups) {
      if (slot >= this.pickups.length) break;
      if (!Number.isFinite(pickup.x) || !Number.isFinite(pickup.y)) continue;
      if (pickup.collected || pickup.y < -38 || pickup.y > 30) continue;
      const view = this.pickups[slot++];
      view.group.visible = true;
      view.group.position.set(pickup.x, pickup.y, 3);
      const phase = finite(pickup.at) * 0.37;
      view.gem.material = pickup.risk ? view.riskCrystal : view.crystal;
      view.gem.scale.y = pickup.risk ? 1.7 : 1.55;
      view.gem.rotation.y = this.displayTime * 1.3 + phase;
      view.gem.rotation.z = Math.sin(this.displayTime * 1.4 + phase) * 0.09;
      const pulse = 1 + Math.sin(this.displayTime * 3.6 + phase) * 0.1;
      view.ring.scale.setScalar(pulse * 0.48);
      view.ring.visible = !pickup.risk;
      view.diamond.visible = Boolean(pickup.risk);
      view.diamond.scale.setScalar(pulse);
    }
    for (; slot < this.pickups.length; slot++) this.pickups[slot].group.visible = false;
  }

  createRain() {
    this.rainCount = 900;
    this.rainData = new Float32Array(this.rainCount * 5);
    this.rainPositions = new Float32Array(this.rainCount * 6);
    for (let i = 0; i < this.rainCount; i++) {
      const index = i * 5;
      this.rainData[index] = (random(i + 881) - 0.5) * 90;
      this.rainData[index + 1] = (random(i + 182) - 0.5) * 85;
      this.rainData[index + 2] = 3.5 + random(i + 61) * 20;
      this.rainData[index + 3] = 0.32 + random(i + 123) * 0.83;
      this.rainData[index + 4] = 6 + random(i + 12) * 8;
    }
    const geometry = this.keep(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(geometry, this.keep(new THREE.LineBasicMaterial({ color: 0xd3c6e7, transparent: true, opacity: 0.27, depthWrite: false, toneMapped: false })));
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
    const particles = new Float32Array(100 * 3);
    for (let i = 0; i < 100; i++) {
      particles[i * 3] = (random(i + 512) - 0.5) * 70;
      particles[i * 3 + 1] = (random(i + 891) - 0.5) * 70;
      particles[i * 3 + 2] = -8 + random(i + 21) * 18;
    }
    const particleGeometry = this.keep(new THREE.BufferGeometry());
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particles, 3));
    this.mist = new THREE.Points(particleGeometry, this.keep(new THREE.PointsMaterial({ color: PALETTE.lilac, size: 0.055, transparent: true, opacity: 0.32, depthWrite: false })));
    this.scene.add(this.mist);
  }

  updateRain(state, dt) {
    const playing = state.mode === 'playing' || state.mode === 'paused' && state.resumeMode !== 'intro';
    const intensity = playing ? clamp(finite(state.fallIntensity, 0.45), 0, 1) : 0.2;
    const fallSpeed = Math.max(0, finite(state.fallSpeed, finite(state.speed, 12)));
    const speed = playing ? (0.7 + intensity * 1.2 + fallSpeed * 0.035) * (state.slow ? 0.38 : 1) : 1;
    const wind = finite(state.wind) * 0.08 + finite(state.velocity) * 0.012;
    const length = 1 + intensity * 1.65 + (state.dashTimer > 0 ? 0.35 : 0);
    for (let i = 0; i < this.rainCount; i++) {
      const data = i * 5;
      const position = i * 6;
      this.rainData[data + 1] -= this.rainData[data + 4] * dt * speed;
      this.rainData[data] += (0.7 + wind) * dt;
      if (this.rainData[data + 1] < -42) this.rainData[data + 1] += 85;
      if (this.rainData[data] > 45) this.rainData[data] -= 90;
      this.rainPositions[position] = this.rainData[data];
      this.rainPositions[position + 1] = this.rainData[data + 1];
      this.rainPositions[position + 2] = this.rainData[data + 2];
      this.rainPositions[position + 3] = this.rainData[data] - (0.08 + wind * 0.09) * length;
      this.rainPositions[position + 4] = this.rainData[data + 1] + this.rainData[data + 3] * length;
      this.rainPositions[position + 5] = this.rainData[data + 2];
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.mist.position.y = Math.sin(this.displayTime * 0.05) * 3;
    this.rain.material.opacity = state.slow ? 0.16 : 0.21 + intensity * 0.05;
    for (let i = 0; i < this.clouds.length; i++) this.clouds[i].position.x = this.clouds[i].userData.originX + Math.sin(this.displayTime * 0.018 + i) * 5;
  }

  createFlightEffects() {
    this.speedStreakCount = 22;
    this.speedStreakDistance = 0;
    this.speedStreakPositions = new Float32Array(this.speedStreakCount * 6);
    const geometry = this.keep(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(this.speedStreakPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.speedStreaks = new THREE.LineSegments(geometry, this.keep(new THREE.LineBasicMaterial({ color: PALETTE.butter, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })));
    this.speedStreaks.frustumCulled = false;
    this.scene.add(this.speedStreaks);
    const material = this.keep(new THREE.MeshBasicMaterial({ color: PALETTE.yellow, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    this.nearRing = this.mesh(this.scene, this.geometry.ring, material, [0, 1.2, 3.18]);
    this.nearRing.visible = false;
  }

  updateFlightEffects(state, dt) {
    const playing = state.mode === 'playing' || state.mode === 'paused' && state.resumeMode !== 'intro';
    const intensity = clamp(finite(state.fallIntensity, 0.45), 0, 1);
    const speed = Math.max(0, finite(state.fallSpeed, finite(state.speed, 12))) * (state.slow ? 0.38 : 1);
    this.speedStreakDistance = (this.speedStreakDistance + (speed + 16) * dt) % 70;
    this.speedStreaks.visible = playing && !state.reducedMotion && finite(state.launchProgress, 1) > 0.8;
    this.speedStreaks.material.opacity = 0.025 + intensity * 0.09;
    for (let i = 0; i < this.speedStreakCount; i++) {
      const index = i * 6;
      const x = (i % 2 ? 1 : -1) * (7.4 + random(i + 637) * 5.8);
      const y = ((random(i + 173) * 70 + this.speedStreakDistance) % 70) - 35;
      const length = 0.9 + random(i + 432) * (1.2 + intensity * 2.2);
      this.speedStreakPositions[index] = this.speedStreakPositions[index + 3] = x;
      this.speedStreakPositions[index + 1] = y;
      this.speedStreakPositions[index + 4] = y - length;
      this.speedStreakPositions[index + 2] = this.speedStreakPositions[index + 5] = 4.2;
    }
    this.speedStreaks.geometry.attributes.position.needsUpdate = true;
    const near = clamp(finite(state.nearTimer) / 0.25, 0, 1);
    this.nearRing.visible = playing && near > 0;
    this.nearRing.position.set(finite(state.x), 1.2, 3.18);
    const age = 1 - near;
    this.nearRing.scale.setScalar(0.85 + (1 - (1 - age) ** 3) * (state.reducedMotion ? 0.18 : 0.52));
    this.nearRing.material.opacity = near * 0.62;
  }

  createGround() {
    this.ground = new THREE.Group();
    this.ground.visible = false;
    this.scene.add(this.ground);
    const wet = this.material('wet-asphalt', { color: 0x282439, roughness: 0.16, metalness: 0.62 });
    const street = this.mesh(this.ground, 'plane', wet, [0, 0, 40], [180, 140, 1]);
    street.rotation.x = -Math.PI / 2;
    street.receiveShadow = true;
    const sidewalk = this.mesh(this.ground, 'box', this.material('wet-sidewalk', { color: 0x65576a, roughness: 0.26, metalness: 0.27 }), [0, 0.12, 3.5], [36, 0.24, 8]);
    sidewalk.receiveShadow = true;
    const marking = this.material('road-marking', { color: 0xe0d6aa, roughness: 0.44 });
    for (let i = -8; i <= 8; i++) this.mesh(this.ground, 'box', marking, [i * 4.5, 0.025, 15], [2.4, 0.01, 0.17]);
    for (let i = -2; i < 3; i++) this.mesh(this.ground, 'box', marking, [-13, 0.025, 11 + i * 1.7], [4.1, 0.01, 0.65]);
    const puddle = this.basic('puddle', 0xa18bb4, 0.16);
    for (let i = 0; i < 17; i++) {
      const mesh = this.mesh(this.ground, 'sphere', puddle, [(random(i + 671) - 0.5) * 42, 0.023, 9 + random(i + 17) * 25], [1.2 + random(i) * 2, 0.014, 0.8 + random(i + 4)]);
      mesh.rotation.y = random(i) * TAU;
    }
    const curb = this.material('curb', { color: 0x847183, roughness: 0.5 });
    for (let i = -11; i <= 11; i++) this.mesh(this.ground, 'box', curb, [i * 1.6, 0.1, 7.4], [1.52, 0.18, 0.26]);
    this.mesh(this.ground, 'box', this.material('door', { color: 0x1c1b30, metalness: 0.5 }), [0, 2, 0.23], [2.3, 4, 0.4]);
    this.mesh(this.ground, 'box', this.material('door-frame', { color: 0x8d7381, metalness: 0.4 }), [0, 4, 0.48], [2.5, 0.17, 0.45]);
    this.mesh(this.ground, 'box', this.basic('door-strip', PALETTE.yellow, 0.8), [0, 3.67, 0.5], [1.74, 0.065, 0.04]);
  }

  createLanding() {
    this.landing = new THREE.Group();
    this.landing.visible = false;
    this.scene.add(this.landing);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,235,1)');
    gradient.addColorStop(0.14, 'rgba(246,255,151,0.8)');
    gradient.addColorStop(0.5, 'rgba(255,179,127,0.24)');
    gradient.addColorStop(1, 'rgba(255,179,127,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const flashMaterial = this.keep(new THREE.MeshBasicMaterial({ map: this.keep(new THREE.CanvasTexture(canvas)), transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    this.landingFlash = this.mesh(this.landing, 'plane', flashMaterial, [0, 0, 0.2]);
    this.landingRings = [];
    for (let i = 0; i < 4; i++) {
      const material = this.keep(new THREE.MeshBasicMaterial({ color: i % 2 ? PALETTE.lilac : PALETTE.yellow, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      const ring = this.mesh(this.landing, this.geometry.ring, material, [0, 0, -0.01 * i]);
      this.landingRings.push(ring);
    }
    this.landingParticles = [];
    for (let i = 0; i < 34; i++) {
      const material = this.keep(new THREE.MeshBasicMaterial({ color: i % 3 ? PALETTE.yellow : PALETTE.coral, transparent: true, opacity: 1, depthWrite: false, toneMapped: false }));
      const particle = this.mesh(this.landing, i % 2 ? 'crystal' : 'box', material, [0, 0, 0]);
      this.landingParticles.push(particle);
    }
    this.landingGlow = new THREE.PointLight(PALETTE.yellow, 0, 20, 2);
    this.landing.add(this.landingGlow);
  }

  updateLanding(state, ground) {
    const visible = state.outcome === 'win' && ['impact', 'result'].includes(state.mode);
    this.landing.visible = visible;
    this.ground.visible = state.mode !== 'menu' && ground > -42;
    this.ground.position.y = ground;
    if (!visible) return;
    const t = this.mode === 'result' ? 1.05 + this.modeTime : this.modeTime;
    this.landing.position.set(this.landingX, 1.2, 3.05);
    const flash = Math.exp(-t * 10);
    this.landingFlash.scale.setScalar((state.reducedMotion ? 3.2 : 4.8) + (1 - flash) * 5.2);
    this.landingFlash.material.opacity = flash * (state.reducedMotion ? 0.3 : 0.84);
    for (let i = 0; i < this.landingRings.length; i++) {
      const ring = this.landingRings[i];
      const age = Math.max(0, t - i * 0.085);
      ring.visible = t >= i * 0.085;
      ring.scale.setScalar(0.25 + (1 - Math.exp(-age * 3.1)) * (4.8 + i * 1.1));
      ring.material.opacity = Math.max(0, 1 - age / 1.45) * (state.reducedMotion ? 0.45 : 0.88);
    }
    for (let i = 0; i < this.landingParticles.length; i++) {
      const particle = this.landingParticles[i];
      const angle = random(i + 129) * TAU;
      const speed = 2 + random(i + 118) * 5;
      const distance = (1 - Math.exp(-t * 1.6)) * speed;
      particle.position.set(Math.cos(angle) * distance, Math.sin(angle) * distance - Math.max(0, t - 0.5) ** 2 * 1.8, random(i + 74) * 0.5);
      particle.rotation.set(t * 2 + i, t * 1.1 + i, t * 2.4);
      const scale = (i % 2 ? 0.5 : 0.09) * Math.max(0, 1 - t / 2.1);
      particle.scale.set(scale, scale * (i % 2 ? 1 : 3), scale);
      particle.material.opacity = Math.max(0, 1 - t / 2);
    }
    this.landingGlow.intensity = Math.max(0, 1 - t / 1.8) * 55;
  }

  createHardLanding() {
    this.ragdoll = new RagdollPhysics();
    const group = new THREE.Group();
    group.visible = false;
    this.scene.add(group);
    this.hardLanding = { group, active: false, age: 0, parts: [], particles: [], stains: [], bloodStart: -1, origin: new THREE.Vector3() };
    const coat = this.materials.get('coat');
    const edge = this.materials.get('coat-edge');
    const skin = this.materials.get('skin');
    const boots = this.materials.get('boots');
    const stockings = this.materials.get('stockings');
    for (const part of this.ragdoll.parts) {
      const mesh = new THREE.Group();
      group.add(mesh);
      if (part.name === 'torso') {
        // Share the original artwork, not a second simplified character skin.
        for (const object of this.body.children) {
          if (!object.isMesh || object === this.hem) continue;
          const clone = object.clone();
          clone.position.y -= part.restPosition.y;
          mesh.add(clone);
        }
        const scarf = this.scarf.clone(true);
        scarf.position.y -= part.restPosition.y;
        // The scarf loses its airborne lift with the body at impact.
        for (let i = 0; i < scarf.children.length; i++) {
          scarf.children[i].position.set(-0.07 - i * 0.08, -i * 0.13, -0.02);
          scarf.children[i].rotation.z = -0.4;
        }
        mesh.add(scarf);
      } else if (part.name === 'pelvis') {
        const hem = this.hem.clone();
        hem.position.y -= part.restPosition.y;
        mesh.add(hem);
        this.mesh(mesh, 'capsule', edge, [0, 0.035, 0], [0.68, 0.24, 0.45]);
      } else if (part.name === 'head') {
        const head = this.head.clone(true);
        head.position.set(0, -0.08, 0);
        mesh.add(head);
      } else if (part.name.endsWith('Foot')) {
        const original = this.legs[part.name.startsWith('left') ? 0 : 1].group;
        for (const object of original.children.slice(2)) {
          const clone = object.clone();
          clone.position.sub(new THREE.Vector3(0, -0.88, 0.14));
          mesh.add(clone);
        }
      } else {
        const length = part.size[1];
        const arm = part.name.includes('Arm') || part.name.includes('Forearm');
        const forearm = part.name.includes('Forearm');
        this.mesh(mesh, 'capsule', arm ? coat : part.name.endsWith('Shin') ? boots : stockings,
          [0, 0, 0], [arm ? forearm ? 0.23 : 0.27 : 0.23, length / 1.5, arm ? 0.24 : 0.21]);
        if (forearm) {
          this.mesh(mesh, 'cylinder', edge, [0, -length * 0.35, 0], [0.128, 0.085, 0.123]);
          this.mesh(mesh, 'sphere', skin, [0, -length * 0.5 - 0.07, 0.02], [0.13, 0.15, 0.1]);
          const side = part.name.startsWith('left') ? -1 : 1;
          this.mesh(mesh, 'capsule', skin, [side * 0.115, -length * 0.5 - 0.055, 0.035], [0.05, 0.09, 0.055]).rotation.z = side * -0.7;
        }
      }
      mesh.traverse((object) => { if (object.isMesh) object.castShadow = true; });
      this.hardLanding.parts.push({ name: part.name, body: part.body, mesh });
    }

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.beginPath();
    // Irregular edges and small separated droplets, rather than a rectangular decal.
    for (let i = 0; i < 36; i++) {
      const angle = i / 36 * TAU;
      const radius = 33 + random(i + 204) * 13;
      const x = 64 + Math.cos(angle) * radius;
      const y = 64 + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 12; i++) {
      const angle = random(i + 760) * TAU;
      const radius = 48 + random(i + 401) * 10;
      ctx.beginPath();
      ctx.ellipse(64 + Math.cos(angle) * radius, 64 + Math.sin(angle) * radius, 1.3 + random(i + 270) * 3.1, 1.4 + random(i + 826) * 2.2, angle, 0, TAU);
      ctx.fill();
    }
    const map = this.keep(new THREE.CanvasTexture(canvas));
    const stainMaterial = this.keep(new THREE.MeshStandardMaterial({
      map, color: 0xa51632, emissive: 0x240108, emissiveIntensity: 0.2,
      roughness: 0.24, metalness: 0.08, transparent: true, opacity: 0,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    const dropMaterial = this.material('blood-drop', { color: 0xab1630, roughness: 0.25, metalness: 0.13 });
    for (let i = 0; i < 35; i++) {
      const stain = this.mesh(group, 'plane', this.keep(stainMaterial.clone()));
      stain.rotation.x = -Math.PI / 2;
      stain.visible = false;
      this.hardLanding.stains.push(stain);
      if (i < 32) {
        const particle = this.mesh(group, 'sphere', dropMaterial);
        particle.visible = false;
        const angle = random(i + 301) * TAU;
        const speed = 0.75 + random(i + 693) * 2.7;
        particle.userData.velocity = new THREE.Vector3(Math.cos(angle) * speed, 1.5 + random(i + 550) * 2.4, Math.sin(angle) * speed);
        particle.userData.size = 0.035 + random(i + 187) * 0.04;
        this.hardLanding.particles.push(particle);
      }
    }
    const flashMaterial = this.keep(this.landingFlash.material.clone());
    this.hardLanding.flash = this.mesh(group, 'plane', flashMaterial);
    this.hardLanding.glow = new THREE.PointLight(PALETTE.coral, 0, 9, 2);
    group.add(this.hardLanding.glow);
  }

  resetHardLanding() {
    const hard = this.hardLanding;
    if (!hard.active && !this.ragdoll.active) return;
    hard.active = hard.group.visible = false;
    hard.age = 0;
    hard.bloodStart = -1;
    hard.origin.set(0, 0, 0);
    hard.flash.material.opacity = 0;
    hard.glow.intensity = 0;
    for (const particle of hard.particles) {
      particle.visible = false;
      particle.position.set(0, 0, 0);
      particle.scale.setScalar(0);
    }
    for (const stain of hard.stains) {
      stain.visible = false;
      stain.material.opacity = 0;
      stain.position.set(0, 0, 0);
      stain.rotation.set(-Math.PI / 2, 0, 0);
      stain.scale.setScalar(0);
    }
    this.ragdoll.reset();
    for (const part of hard.parts) {
      part.mesh.position.set(0, 0, 0);
      part.mesh.quaternion.identity();
    }
  }

  updateHardLanding(state, ground, dt) {
    const hard = this.hardLanding;
    if (!hard.active) {
      this.ragdoll.begin({ x: finite(state.x), ground, velocity: finite(state.velocity) });
      hard.active = hard.group.visible = true;
      hard.age = 0;
      hard.bloodStart = -1;
    }
    hard.age += dt;
    this.ragdoll.step(dt);
    this.landing.visible = false;
    this.player.visible = this.shadow.visible = false;
    this.ground.visible = true;
    this.ground.position.y = ground;
    for (const part of hard.parts) {
      part.mesh.position.copy(part.body.position);
      part.mesh.quaternion.copy(part.body.quaternion);
    }
    const floor = this.ragdoll.floor.position.y;
    const torso = this.ragdoll.byName.get('torso').body;
    if (hard.bloodStart < 0 && this.ragdoll.firstContactTime >= 0) {
      hard.bloodStart = hard.age;
      hard.origin.set(torso.position.x, floor + 0.014, 3.45);
    }
    if (hard.bloodStart >= 0) {
      const age = Math.max(0, hard.age - hard.bloodStart);
      for (let i = 0; i < hard.particles.length; i++) {
        const particle = hard.particles[i];
        const t = Math.max(0, age - i * 0.002);
        const velocity = particle.userData.velocity;
        const fallTime = (velocity.y + Math.sqrt(velocity.y ** 2 + 2 * 12 * 0.14)) / 12;
        const flightTime = Math.min(t, fallTime);
        particle.visible = t < fallTime && age >= i * 0.002;
        particle.position.set(hard.origin.x + velocity.x * flightTime, floor + 0.14 + velocity.y * flightTime - 6 * flightTime * flightTime, hard.origin.z + velocity.z * flightTime);
        const scale = particle.userData.size;
        particle.scale.set(scale, scale * 1.65, scale);
        const stain = hard.stains[i];
        stain.visible = t >= fallTime;
        stain.position.set(hard.origin.x + velocity.x * fallTime, floor + 0.014 + i * 0.00015, hard.origin.z + velocity.z * fallTime);
        stain.rotation.z = random(i + 743) * TAU;
        const spread = scale * (2.6 + random(i + 922) * 2.6);
        stain.scale.set(spread * 1.45, spread, 1);
        stain.material.opacity = stain.visible ? 0.9 : 0;
      }
      for (let i = 32; i < hard.stains.length; i++) {
        const stain = hard.stains[i];
        const spread = (0.40 + (i - 32) * 0.25) * (0.35 + 0.65 * smooth(clamp(age / 0.55, 0, 1)));
        stain.visible = true;
        stain.position.set(hard.origin.x + (i - 33) * 0.19, floor + 0.020 + i * 0.00015, hard.origin.z + (i - 32) * 0.22);
        stain.rotation.z = i * 1.3;
        stain.scale.set(spread * 1.4, spread, 1);
        stain.material.opacity = 0.90;
      }
    }
    const flash = Math.exp(-hard.age * 20);
    hard.flash.position.set(finite(state.x), ground + 0.85, 3.2);
    hard.flash.scale.setScalar(state.reducedMotion ? 2.4 : 4.5);
    hard.flash.material.opacity = flash * (state.reducedMotion ? 0.12 : 0.72);
    hard.glow.position.set(torso.position.x, floor + 1.3, 4.8);
    hard.glow.intensity = flash * (state.reducedMotion ? 7 : 22);
    this.playerLight.position.set(torso.position.x - 1.8, floor + 3.4, 5.7);
    this.playerLight.intensity = 4.2;

    const framing = state.reducedMotion ? 1 : smooth(clamp(hard.age / 0.65, 0, 1));
    const viewHeight = Math.max(8.2, 6.1 / this.aspect);
    const cameraZ = 3 + viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.camera.position.lerp(this.vector.set(this.landingX + 0.35, floor + 8.6, cameraZ), framing);
    this.vectorB.set(this.cameraOffset, 1.2, 3).lerp(this.vector.set(this.landingX, floor + 0.35, 3.6), framing);
    this.camera.lookAt(this.vectorB);
    if (!state.reducedMotion) this.camera.rotateZ(Math.sin(Math.min(hard.age, 0.6) / 0.6 * Math.PI) * -0.035);
    this.camera.updateMatrixWorld();
  }

  resize() {
    if (this.disposed) return;
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, rect.width || window.innerWidth);
    this.height = Math.max(1, rect.height || window.innerHeight);
    this.aspect = this.width / this.height;
    this.camera.aspect = this.aspect;
    // All five lanes stay in frame, including the ±7.1 world-unit edge lanes.
    this.viewHeight = Math.max(24, 19.4 / this.aspect);
    this.cameraZ = 3 + this.viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
    this.composer.setSize(this.width, this.height);
  }

  screenToWorld(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.ray.intersectPlane(this.playPlane, this.hit) ? this.hit.x : 0;
  }

  update(state, dt) {
    if (this.disposed) return;
    dt = Math.min(Math.max(finite(dt), 0), 0.05);
    this.updateDistrict(state);
    if (finite(state.distance) < this.lastDistance || (state.mode === 'playing' && !['playing', 'paused'].includes(this.mode))) {
      for (const particle of this.trail) particle.userData.age = 1;
      this.trailClock = 0;
      this.speedStreakDistance = 0;
    }
    this.lastDistance = finite(state.distance);
    if (state.mode !== this.mode) {
      if (this.mode === 'menu' && ['playing', 'intro'].includes(state.mode)) this.cameraOffset = 0;
      this.mode = state.mode;
      this.modeTime = 0;
      if (state.mode === 'impact') this.landingX = state.x || 0;
    } else if (state.mode !== 'paused') this.modeTime += dt;
    const paused = state.mode === 'paused';
    const motionDt = paused ? 0 : dt * (state.reducedMotion ? 0.3 : 1);
    this.displayTime += motionDt;
    const menu = state.mode === 'menu';
    const menuOffset = this.aspect > 1.05 ? -8.8 : -1.1;
    this.cameraOffset = inIntro(state) ? 0 : THREE.MathUtils.damp(this.cameraOffset, menu ? menuOffset : 0, state.reducedMotion ? 20 : 5.2, paused ? 0 : dt);
    const shake = state.reducedMotion || state.mode === 'caught' || state.mode === 'result' && state.outcome === 'caught' ? 0 : (state.shake || 0) * 0.08;
    this.camera.position.set(this.cameraOffset + Math.sin(this.displayTime * 59) * shake, 4.2 + Math.cos(this.displayTime * 63) * shake, this.cameraZ);
    this.camera.lookAt(this.cameraOffset, 1.2, 3);
    this.camera.updateMatrixWorld();
    const ground = this.updateBuilding(state);
    this.updatePlayer(state, motionDt);
    if (inIntro(state)) this.updateIntroCamera(state);
    this.updateHands(state);
    this.updatePickups(state);
    this.updateRain(state, motionDt);
    this.updateFlightEffects(state, motionDt);
    const hardImpact = state.runImpactMode === 'hard' && state.outcome === 'win' && ['impact', 'result'].includes(state.mode);
    if (hardImpact) this.updateHardLanding(state, ground, dt);
    else {
      this.resetHardLanding();
      this.updateLanding(state, ground);
    }
    const impactBloom = state.mode === 'impact' ? Math.exp(-this.modeTime * 7) * (state.reducedMotion ? 0.1 : 0.38) : 0;
    this.bloom.strength = THREE.MathUtils.damp(this.bloom.strength, (state.slow ? 0.62 : 0.48) + impactBloom, state.mode === 'impact' ? 14 : 3, dt);
    this.finish.uniforms.time.value = state.reducedMotion ? 0 : this.displayTime;
    this.renderer.info.reset();
    this.composer.render();
  }

  dispose() {
    if (this.disposed) return;
    this.resetHardLanding();
    this.disposed = true;
    this.ragdoll.dispose();
    for (const pass of this.composer.passes) pass.dispose?.();
    this.composer.dispose();
    for (const resource of this.resources) resource.dispose?.();
    this.resources.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
