import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://unpkg.com/three@0.161.0/examples/jsm/loaders/GLTFLoader.js";

const ROOM_STORAGE_KEY = "ida_room_id";
const WALL_MARGIN_CM = 5;
const AUTO_SNAP_THRESHOLD_CM = 18;
const ROTATION_STEP_DEG = 15;
const CM_TO_M = 0.01;

const query = new URLSearchParams(window.location.search);

const roomMetaEl = document.getElementById("room-meta");
const statusChipEl = document.getElementById("status-chip");
const warningBoxEl = document.getElementById("warning-box");
const selectionInfoEl = document.getElementById("selection-info");
const productsListEl = document.getElementById("products-list");
const skuInputEl = document.getElementById("sku-input");
const addSkuBtn = document.getElementById("add-sku-btn");
const rotateLeftBtn = document.getElementById("rotate-left-btn");
const rotateRightBtn = document.getElementById("rotate-right-btn");
const snapWallBtn = document.getElementById("snap-wall-btn");
const floorCanvas = document.getElementById("floor-canvas");
const sceneHost = document.getElementById("scene-3d");

const ctx = floorCanvas.getContext("2d");
const gltfLoader = new GLTFLoader();

const state = {
  room: null,
  roomId: "",
  products: [],
  selectedId: null,
  dragging: null,
  three: null
};

const COLORS = ["#d58f5f", "#4ea5d9", "#8fd36f", "#d77ece", "#f2be54", "#6dd3c3", "#d96b72"];

const normalizeForMatch = (value) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const degToRad = (deg) => (deg * Math.PI) / 180;

const setChip = (text, kind = "default") => {
  statusChipEl.textContent = text;
  statusChipEl.className = "tag";
  if (kind === "ok") statusChipEl.classList.add("ok");
  if (kind === "warn") statusChipEl.classList.add("warn");
  if (kind === "err") statusChipEl.classList.add("err");
};

const setWarning = (message, kind = "warn") => {
  warningBoxEl.textContent = message;
  warningBoxEl.className = "status-box";
  if (kind === "warn") warningBoxEl.classList.add("warn");
  if (kind === "err") warningBoxEl.classList.add("err");
};

const clearWarning = () => setWarning("Hoiatused kuvatakse siin.");

const currentSelectedProduct = () => state.products.find((product) => product.id === state.selectedId) ?? null;

const getHalfExtentsCm = (product, rotationDeg = product.rotationDeg) => {
  const theta = degToRad(rotationDeg);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const hx = Math.abs(cos) * (product.w / 2) + Math.abs(sin) * (product.d / 2);
  const hz = Math.abs(sin) * (product.w / 2) + Math.abs(cos) * (product.d / 2);
  return { hx, hz };
};

const getAABB = (product, pose = product) => {
  const { hx, hz } = getHalfExtentsCm(product, pose.rotationDeg);
  return {
    minX: pose.x - hx,
    maxX: pose.x + hx,
    minZ: pose.z - hz,
    maxZ: pose.z + hz
  };
};

const intersectsAABB = (a, b) => !(a.maxX <= b.minX || a.minX >= b.maxX || a.maxZ <= b.minZ || a.minZ >= b.maxZ);

const isWithinRoom = (product, pose) => {
  if (!state.room) return false;
  const { hx, hz } = getHalfExtentsCm(product, pose.rotationDeg);
  return (
    pose.x - hx >= WALL_MARGIN_CM &&
    pose.x + hx <= state.room.width_cm - WALL_MARGIN_CM &&
    pose.z - hz >= WALL_MARGIN_CM &&
    pose.z + hz <= state.room.length_cm - WALL_MARGIN_CM
  );
};

const collidesWithObstacles = (product, pose) => {
  if (!state.room) return false;
  const itemBox = getAABB(product, pose);
  return (state.room.obstacles ?? []).some((obstacle) => {
    const halfW = obstacle.width_cm / 2;
    const halfD = obstacle.depth_cm / 2;
    const obstacleBox = {
      minX: obstacle.x_cm - halfW,
      maxX: obstacle.x_cm + halfW,
      minZ: obstacle.z_cm - halfD,
      maxZ: obstacle.z_cm + halfD
    };
    return intersectsAABB(itemBox, obstacleBox);
  });
};

const collidesWithOtherProducts = (product, pose) => {
  const itemBox = getAABB(product, pose);
  return state.products.some((other) => {
    if (other.id === product.id) return false;
    return intersectsAABB(itemBox, getAABB(other, other));
  });
};

const canPlace = (product, pose) =>
  isWithinRoom(product, pose) && !collidesWithObstacles(product, pose) && !collidesWithOtherProducts(product, pose);

const clampPoseInsideRoom = (product, pose) => {
  const { hx, hz } = getHalfExtentsCm(product, pose.rotationDeg);
  const minX = WALL_MARGIN_CM + hx;
  const maxX = state.room.width_cm - WALL_MARGIN_CM - hx;
  const minZ = WALL_MARGIN_CM + hz;
  const maxZ = state.room.length_cm - WALL_MARGIN_CM - hz;
  return {
    ...pose,
    x: Math.min(maxX, Math.max(minX, pose.x)),
    z: Math.min(maxZ, Math.max(minZ, pose.z))
  };
};

const wallRotationDeg = (wall) => {
  if (wall === "north") return 180;
  if (wall === "east") return -90;
  if (wall === "south") return 0;
  return 90;
};

const buildWallCandidate = (product, wall, fraction) => {
  const rotationDeg = wallRotationDeg(wall);
  const extents = getHalfExtentsCm(product, rotationDeg);

  if (wall === "north" || wall === "south") {
    const minX = WALL_MARGIN_CM + extents.hx;
    const maxX = state.room.width_cm - WALL_MARGIN_CM - extents.hx;
    if (minX > maxX) return null;
    return {
      x: minX + (maxX - minX) * fraction,
      z: wall === "north" ? WALL_MARGIN_CM + extents.hz : state.room.length_cm - WALL_MARGIN_CM - extents.hz,
      rotationDeg
    };
  }

  const minZ = WALL_MARGIN_CM + extents.hz;
  const maxZ = state.room.length_cm - WALL_MARGIN_CM - extents.hz;
  if (minZ > maxZ) return null;
  return {
    x: wall === "west" ? WALL_MARGIN_CM + extents.hx : state.room.width_cm - WALL_MARGIN_CM - extents.hx,
    z: minZ + (maxZ - minZ) * fraction,
    rotationDeg
  };
};

const autoplacePose = (product) => {
  const fractions = [0.5, 0.18, 0.82];
  const walls = ["north", "east", "south", "west"];

  for (const wall of walls) {
    for (const fraction of fractions) {
      const candidate = buildWallCandidate(product, wall, fraction);
      if (!candidate) continue;
      if (canPlace(product, candidate)) {
        return { pose: candidate, warning: "" };
      }
    }
  }

  const centerPose = {
    x: state.room.width_cm / 2,
    z: state.room.length_cm / 2,
    rotationDeg: 0
  };
  if (canPlace(product, centerPose)) {
    return {
      pose: centerPose,
      warning: `Toodet "${product.name}" ei saanud seina äärde paigutada. Paigutasin ruumi keskele.`
    };
  }

  return {
    pose: clampPoseInsideRoom(product, centerPose),
    warning: `Toode "${product.name}" ei mahu praeguste mõõtudega mugavalt ruumi.`
  };
};

const nearestWallForPose = (product, pose) => {
  const { hx, hz } = getHalfExtentsCm(product, pose.rotationDeg);
  const distances = [
    { wall: "north", distance: Math.abs(pose.z - (WALL_MARGIN_CM + hz)) },
    { wall: "south", distance: Math.abs(pose.z - (state.room.length_cm - WALL_MARGIN_CM - hz)) },
    { wall: "west", distance: Math.abs(pose.x - (WALL_MARGIN_CM + hx)) },
    { wall: "east", distance: Math.abs(pose.x - (state.room.width_cm - WALL_MARGIN_CM - hx)) }
  ];
  distances.sort((a, b) => a.distance - b.distance);
  return distances[0];
};

const snapPoseToWall = (product, pose) => {
  const { wall } = nearestWallForPose(product, pose);
  const extents = getHalfExtentsCm(product, pose.rotationDeg);
  if (wall === "north") return { ...pose, z: WALL_MARGIN_CM + extents.hz };
  if (wall === "south") return { ...pose, z: state.room.length_cm - WALL_MARGIN_CM - extents.hz };
  if (wall === "west") return { ...pose, x: WALL_MARGIN_CM + extents.hx };
  return { ...pose, x: state.room.width_cm - WALL_MARGIN_CM - extents.hx };
};

const maybeAutoSnap = (product, pose) => {
  const nearest = nearestWallForPose(product, pose);
  if (nearest.distance > AUTO_SNAP_THRESHOLD_CM) return pose;
  return snapPoseToWall(product, pose);
};

const pickColor = (index) => COLORS[index % COLORS.length];

const toThreePosition = (xCm, zCm) => ({
  x: (xCm - state.room.width_cm / 2) * CM_TO_M,
  z: (zCm - state.room.length_cm / 2) * CM_TO_M
});

const syncMeshTransform = (product) => {
  if (!product.mesh) return;
  const pos = toThreePosition(product.x, product.z);
  product.mesh.position.set(pos.x, 0, pos.z);
  product.mesh.rotation.y = degToRad(product.rotationDeg);
};

const createFallbackMesh = (product) => {
  const geometry = new THREE.BoxGeometry(product.w * CM_TO_M, product.h * CM_TO_M, product.d * CM_TO_M);
  const material = new THREE.MeshStandardMaterial({
    color: product.color,
    roughness: 0.75,
    metalness: 0.08
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = (product.h * CM_TO_M) / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

const fitModelToProductDimensions = (model, product) => {
  const target = new THREE.Vector3(product.w * CM_TO_M, product.h * CM_TO_M, product.d * CM_TO_M);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());

  if (size.x <= 0.0001 || size.y <= 0.0001 || size.z <= 0.0001) {
    return;
  }

  model.scale.multiply(new THREE.Vector3(target.x / size.x, target.y / size.y, target.z / size.z));

  const scaledBox = new THREE.Box3().setFromObject(model);
  const center = scaledBox.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= scaledBox.min.y;
};

const createProductGroup = async (product) => {
  const group = new THREE.Group();
  group.userData.productId = product.id;
  group.add(createFallbackMesh(product));

  if (product.model_glb_url) {
    try {
      const gltf = await gltfLoader.loadAsync(product.model_glb_url);
      const modelRoot = gltf.scene;
      fitModelToProductDimensions(modelRoot, product);
      while (group.children.length > 0) group.remove(group.children[0]);
      group.add(modelRoot);
    } catch (error) {
      console.warn("[simulator] GLB load failed, using fallback mesh:", error);
      setWarning(`3D mudelit ei saanud laadida tootele "${product.name}", kasutan varukujundit.`, "warn");
    }
  }

  return group;
};

const ensureThreeScene = () => {
  if (state.three) return state.three;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(sceneHost.clientWidth || 520, sceneHost.clientHeight || 360);
  renderer.shadowMap.enabled = true;
  sceneHost.innerHTML = "";
  sceneHost.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1115);

  const camera = new THREE.PerspectiveCamera(52, (sceneHost.clientWidth || 520) / (sceneHost.clientHeight || 360), 0.01, 150);
  camera.position.set(2.8, 3.2, 3.2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.06;
  controls.target.set(0, 0.5, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  const sun = new THREE.DirectionalLight(0xfff6e8, 0.86);
  sun.position.set(4, 6, 3);
  sun.castShadow = true;

  scene.add(ambient);
  scene.add(sun);

  const roomGroup = new THREE.Group();
  const productsGroup = new THREE.Group();
  scene.add(roomGroup);
  scene.add(productsGroup);

  state.three = { renderer, scene, camera, controls, roomGroup, productsGroup };

  const animate = () => {
    if (!state.three) return;
    state.three.controls.update();
    state.three.renderer.render(state.three.scene, state.three.camera);
    requestAnimationFrame(animate);
  };
  animate();

  return state.three;
};

const renderRoomMeshes = () => {
  if (!state.room) return;
  const three = ensureThreeScene();
  const { roomGroup } = three;

  while (roomGroup.children.length > 0) roomGroup.remove(roomGroup.children[0]);

  const roomWidth = state.room.width_cm * CM_TO_M;
  const roomDepth = state.room.length_cm * CM_TO_M;
  const roomHeight = (state.room.height_cm || 260) * CM_TO_M;
  const wallThickness = 0.03;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(roomWidth, roomDepth),
    new THREE.MeshStandardMaterial({ color: 0x242c38, roughness: 0.95, metalness: 0.04 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  roomGroup.add(floor);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x4b4f58, roughness: 0.88, metalness: 0.05 });
  const northWall = new THREE.Mesh(new THREE.BoxGeometry(roomWidth, roomHeight, wallThickness), wallMaterial);
  northWall.position.set(0, roomHeight / 2, -roomDepth / 2);
  const southWall = northWall.clone();
  southWall.position.z = roomDepth / 2;

  const westWall = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, roomHeight, roomDepth), wallMaterial);
  westWall.position.set(-roomWidth / 2, roomHeight / 2, 0);
  const eastWall = westWall.clone();
  eastWall.position.x = roomWidth / 2;

  roomGroup.add(northWall, southWall, westWall, eastWall);

  const obstacleMaterial = new THREE.MeshStandardMaterial({ color: 0x8f4f4f, roughness: 0.65, metalness: 0.08 });
  for (const obstacle of state.room.obstacles ?? []) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(obstacle.width_cm * CM_TO_M, (obstacle.height_cm || 60) * CM_TO_M, obstacle.depth_cm * CM_TO_M),
      obstacleMaterial
    );
    const pos = toThreePosition(obstacle.x_cm, obstacle.z_cm);
    mesh.position.set(pos.x, ((obstacle.height_cm || 60) * CM_TO_M) / 2, pos.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    roomGroup.add(mesh);
  }
};

const addProductToScene = async (product) => {
  const three = ensureThreeScene();
  const group = await createProductGroup(product);
  product.mesh = group;
  syncMeshTransform(product);
  three.productsGroup.add(group);
};

const removeProductFromScene = (productId) => {
  const three = ensureThreeScene();
  const toRemove = three.productsGroup.children.find((child) => child.userData.productId === productId);
  if (toRemove) {
    three.productsGroup.remove(toRemove);
  }
};

const updateSelectionInfo = () => {
  const selected = currentSelectedProduct();
  if (!selected) {
    selectionInfoEl.textContent = "Vali toode 2D vaates.";
    return;
  }
  selectionInfoEl.textContent = `${selected.name} · ${selected.w}×${selected.d}×${selected.h} cm · pööre ${selected.rotationDeg}°`;
};

const renderProductList = () => {
  productsListEl.innerHTML = "";
  if (!state.products.length) {
    productsListEl.innerHTML = '<div class="hint">Tooteid pole veel lisatud.</div>';
    updateSelectionInfo();
    return;
  }

  for (const product of state.products) {
    const row = document.createElement("div");
    row.className = `product-row${state.selectedId === product.id ? " active" : ""}`;
    row.innerHTML = `
      <div>
        <div class="product-name">${product.name}</div>
        <div class="product-meta">${product.sku} · ${Math.round(product.x)}cm, ${Math.round(product.z)}cm</div>
      </div>
      <div class="toolbar">
        <button type="button" class="btn ghost" data-action="select">Vali</button>
        <button type="button" class="btn ghost" data-action="remove">X</button>
      </div>
    `;
    row.querySelector('[data-action="select"]')?.addEventListener("click", () => {
      state.selectedId = product.id;
      renderProductList();
      render2D();
      updateSelectionInfo();
    });
    row.querySelector('[data-action="remove"]')?.addEventListener("click", () => {
      removeProductFromScene(product.id);
      state.products = state.products.filter((item) => item.id !== product.id);
      if (state.selectedId === product.id) {
        state.selectedId = state.products[0]?.id ?? null;
      }
      renderProductList();
      render2D();
      clearWarning();
    });
    productsListEl.appendChild(row);
  }
  updateSelectionInfo();
};

const getCanvasTransform = () => {
  const pad = 26;
  const width = floorCanvas.width;
  const height = floorCanvas.height;
  const scale = Math.min((width - pad * 2) / state.room.width_cm, (height - pad * 2) / state.room.length_cm);
  const originX = pad;
  const originY = pad;
  return { pad, width, height, scale, originX, originY };
};

const cmToCanvas = (xCm, zCm, t) => ({
  x: t.originX + xCm * t.scale,
  y: t.originY + zCm * t.scale
});

const canvasToCm = (xPx, yPx, t) => ({
  x: (xPx - t.originX) / t.scale,
  z: (yPx - t.originY) / t.scale
});

const drawRotatedRect = (x, y, w, h, angleRad, fill, stroke, lineWidth = 1.4) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angleRad);
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

const render2D = () => {
  if (!state.room) return;

  const displayWidth = Math.max(420, floorCanvas.clientWidth || 420);
  const displayHeight = Math.max(320, floorCanvas.clientHeight || 320);
  if (floorCanvas.width !== Math.round(displayWidth * window.devicePixelRatio) || floorCanvas.height !== Math.round(displayHeight * window.devicePixelRatio)) {
    floorCanvas.width = Math.round(displayWidth * window.devicePixelRatio);
    floorCanvas.height = Math.round(displayHeight * window.devicePixelRatio);
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  ctx.clearRect(0, 0, floorCanvas.clientWidth, floorCanvas.clientHeight);
  ctx.fillStyle = "#121824";
  ctx.fillRect(0, 0, floorCanvas.clientWidth, floorCanvas.clientHeight);

  const t = getCanvasTransform();
  const roomW = state.room.width_cm * t.scale;
  const roomD = state.room.length_cm * t.scale;

  ctx.fillStyle = "#1a2330";
  ctx.strokeStyle = "#9aa5b6";
  ctx.lineWidth = 2;
  ctx.fillRect(t.originX, t.originY, roomW, roomD);
  ctx.strokeRect(t.originX, t.originY, roomW, roomD);

  for (const opening of state.room.openings ?? []) {
    if (opening.type !== "door") continue;
    const doorColor = "#e6a66d";
    ctx.fillStyle = doorColor;
    if (opening.wall === "north" || opening.wall === "south") {
      const x = t.originX + opening.offset_cm * t.scale;
      const y = opening.wall === "north" ? t.originY - 3 : t.originY + roomD - 3;
      ctx.fillRect(x, y, opening.width_cm * t.scale, 6);
    } else {
      const x = opening.wall === "west" ? t.originX - 3 : t.originX + roomW - 3;
      const y = t.originY + opening.offset_cm * t.scale;
      ctx.fillRect(x, y, 6, opening.width_cm * t.scale);
    }
  }

  for (const obstacle of state.room.obstacles ?? []) {
    const c = cmToCanvas(obstacle.x_cm, obstacle.z_cm, t);
    drawRotatedRect(
      c.x,
      c.y,
      obstacle.width_cm * t.scale,
      obstacle.depth_cm * t.scale,
      0,
      "rgba(255, 93, 93, 0.28)",
      "rgba(255, 136, 136, 0.95)",
      1.2
    );
  }

  for (const product of state.products) {
    const c = cmToCanvas(product.x, product.z, t);
    const selected = state.selectedId === product.id;
    drawRotatedRect(
      c.x,
      c.y,
      product.w * t.scale,
      product.d * t.scale,
      degToRad(product.rotationDeg),
      selected ? "rgba(214, 147, 97, 0.66)" : "rgba(110, 188, 255, 0.42)",
      selected ? "#ffd9b8" : "#8fd4ff",
      selected ? 2 : 1.4
    );

    ctx.fillStyle = "#f0f4fb";
    ctx.font = "12px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(product.name.slice(0, 22), c.x, c.y + 4);
  }

  ctx.fillStyle = "#a8b4c6";
  ctx.font = "12px Segoe UI";
  ctx.textAlign = "left";
  ctx.fillText(`Ruum: ${state.room.width_cm} × ${state.room.length_cm} cm`, 10, floorCanvas.clientHeight - 12);
};

const pointInsideProduct = (product, xCm, zCm) => {
  const dx = xCm - product.x;
  const dz = zCm - product.z;
  const theta = degToRad(-product.rotationDeg);
  const localX = dx * Math.cos(theta) - dz * Math.sin(theta);
  const localZ = dx * Math.sin(theta) + dz * Math.cos(theta);
  return Math.abs(localX) <= product.w / 2 && Math.abs(localZ) <= product.d / 2;
};

const pickProductAt = (xCm, zCm) => {
  for (let i = state.products.length - 1; i >= 0; i -= 1) {
    if (pointInsideProduct(state.products[i], xCm, zCm)) return state.products[i];
  }
  return null;
};

const applyPose = (product, pose) => {
  product.x = pose.x;
  product.z = pose.z;
  product.rotationDeg = ((pose.rotationDeg % 360) + 360) % 360;
  syncMeshTransform(product);
};

floorCanvas.addEventListener("pointerdown", (event) => {
  if (!state.room) return;
  const rect = floorCanvas.getBoundingClientRect();
  const t = getCanvasTransform();
  const point = canvasToCm(event.clientX - rect.left, event.clientY - rect.top, t);
  const picked = pickProductAt(point.x, point.z);
  if (!picked) return;

  state.selectedId = picked.id;
  state.dragging = {
    productId: picked.id,
    offsetX: picked.x - point.x,
    offsetZ: picked.z - point.z
  };
  renderProductList();
  render2D();
  updateSelectionInfo();
  floorCanvas.setPointerCapture(event.pointerId);
});

floorCanvas.addEventListener("pointermove", (event) => {
  if (!state.dragging || !state.room) return;
  const product = state.products.find((item) => item.id === state.dragging.productId);
  if (!product) return;

  const rect = floorCanvas.getBoundingClientRect();
  const t = getCanvasTransform();
  const point = canvasToCm(event.clientX - rect.left, event.clientY - rect.top, t);

  let pose = {
    x: point.x + state.dragging.offsetX,
    z: point.z + state.dragging.offsetZ,
    rotationDeg: product.rotationDeg
  };
  pose = maybeAutoSnap(product, pose);
  pose = clampPoseInsideRoom(product, pose);

  if (canPlace(product, pose)) {
    applyPose(product, pose);
    render2D();
    renderProductList();
    clearWarning();
  } else {
    setWarning("Kokkupõrge või ruumist väljumine. Toode jäi viimasesse sobivasse punkti.", "err");
  }
});

floorCanvas.addEventListener("pointerup", (event) => {
  if (state.dragging) {
    state.dragging = null;
    floorCanvas.releasePointerCapture(event.pointerId);
  }
});

const rotateSelected = (deltaDeg) => {
  const selected = currentSelectedProduct();
  if (!selected) return;
  const nextPose = {
    x: selected.x,
    z: selected.z,
    rotationDeg: selected.rotationDeg + deltaDeg
  };
  if (canPlace(selected, nextPose)) {
    applyPose(selected, nextPose);
    render2D();
    renderProductList();
    clearWarning();
  } else {
    setWarning("Pööramine tekitaks kokkupõrke. Proovi toodet enne nihutada.", "err");
  }
};

const snapSelectedToWall = () => {
  const selected = currentSelectedProduct();
  if (!selected) return;
  const snapped = snapPoseToWall(selected, selected);
  const pose = clampPoseInsideRoom(selected, snapped);
  if (canPlace(selected, pose)) {
    applyPose(selected, pose);
    render2D();
    renderProductList();
    clearWarning();
  } else {
    setWarning("Seina äärde snap ei õnnestunud: ruumis on takistus või teine toode ees.", "err");
  }
};

const fetchRoom = async (roomId) => {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
  if (!response.ok) {
    throw new Error("Ruumi ei leitud. Ava /room ja loo uus ruum.");
  }
  return response.json();
};

const fetchProductMeta = async (sku) => {
  const response = await fetch(`/api/products/${encodeURIComponent(sku)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "Toote meta laadimine ebaõnnestus");
  }
  return payload;
};

const addProductBySku = async (skuInput) => {
  const sku = String(skuInput ?? "").trim();
  if (!sku) return;
  setChip("Laen toodet...", "warn");

  try {
    const meta = await fetchProductMeta(sku);
    const product = {
      id: `item_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      sku: meta.sku || sku,
      name: meta.name || sku,
      category: meta.category || "generic",
      w: toNumber(meta?.dimensions_cm?.w, 100),
      d: toNumber(meta?.dimensions_cm?.d, 60),
      h: toNumber(meta?.dimensions_cm?.h, 90),
      model_glb_url: typeof meta.model_glb_url === "string" ? meta.model_glb_url : null,
      x: state.room.width_cm / 2,
      z: state.room.length_cm / 2,
      rotationDeg: 0,
      mesh: null,
      color: pickColor(state.products.length)
    };

    const placed = autoplacePose(product);
    applyPose(product, placed.pose);
    state.products.push(product);
    state.selectedId = product.id;
    await addProductToScene(product);

    renderProductList();
    render2D();
    updateSelectionInfo();

    if (placed.warning) setWarning(placed.warning, "warn");
    else clearWarning();

    setChip("Toode lisatud", "ok");
  } catch (error) {
    console.error("[simulator] add product failed:", error);
    setChip("Viga", "err");
    setWarning(error instanceof Error ? error.message : "Toote lisamine ebaõnnestus", "err");
  }
};

const updateRoomMeta = () => {
  if (!state.room) return;
  roomMetaEl.textContent = `roomId: ${state.roomId} · ${state.room.width_cm}×${state.room.length_cm}cm · kõrgus ${state.room.height_cm || 260}cm`;
};

const initializeRoom = async () => {
  const fromQuery = query.get("roomId")?.trim() ?? "";
  const fromStorage = localStorage.getItem(ROOM_STORAGE_KEY)?.trim() ?? "";
  state.roomId = fromQuery || fromStorage;
  if (!state.roomId) {
    throw new Error("roomId puudub. Ava /room ja loo ruum.");
  }

  localStorage.setItem(ROOM_STORAGE_KEY, state.roomId);
  state.room = await fetchRoom(state.roomId);
  updateRoomMeta();
  renderRoomMeshes();
  render2D();
  clearWarning();
};

const attachEvents = () => {
  addSkuBtn.addEventListener("click", () => addProductBySku(skuInputEl.value));
  skuInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addProductBySku(skuInputEl.value);
    }
  });
  rotateLeftBtn.addEventListener("click", () => rotateSelected(-ROTATION_STEP_DEG));
  rotateRightBtn.addEventListener("click", () => rotateSelected(ROTATION_STEP_DEG));
  snapWallBtn.addEventListener("click", () => snapSelectedToWall());

  window.addEventListener("resize", () => {
    if (!state.room) return;
    render2D();
    if (state.three) {
      const width = sceneHost.clientWidth || 520;
      const height = sceneHost.clientHeight || 360;
      state.three.camera.aspect = width / height;
      state.three.camera.updateProjectionMatrix();
      state.three.renderer.setSize(width, height);
    }
  });
};

const bootstrap = async () => {
  setChip("Laen...", "warn");
  attachEvents();

  try {
    await initializeRoom();
    setChip("Valmis", "ok");
    const deepSku = query.get("sku")?.trim();
    if (deepSku) {
      skuInputEl.value = deepSku;
      await addProductBySku(deepSku);
    }
  } catch (error) {
    console.error("[simulator] init failed:", error);
    setChip("Viga", "err");
    setWarning(error instanceof Error ? error.message : "Simulaatori avamine ebaõnnestus", "err");
    roomMetaEl.innerHTML = 'Ruumi ei saanud laadida. <a href="/room">Loo uus tuba</a>.';
  }
};

bootstrap();
