import {
  API_BASE, ACTIVE_PROJECT_STORAGE_KEY, fetchJson,
  readLocalCartLines, writeLocalCartLines, computeDimensions, clamp
} from "./shared.js";
import { createScene3DEditor } from "./scene-editor-3d.js";
import { createHistoryStore } from "./history-store.js";
import { createDrawerManager } from "./layout/drawer-manager.js";
import { createRoomsPanel } from "./panels/rooms-panel.js";
import { createRoomEditPanel } from "./panels/room-edit-panel.js";
import { createCatalogPanelV4 } from "./panels/catalog-panel.js";
import { createCartPanel } from "./panels/cart-panel.js";
import { createDetailsPanel } from "./panels/details-panel.js";
import { createFloatingToolbar } from "./canvas/floating-toolbar.js";

// ── Constants ──────────────────────────────────────────────────
const CM_TO_M = 0.01;
const WALL_MARGIN_CM = 8;
const GRID_CM = 5;
const ROTATION_STEP_DEG = 15;
const OPENING_CLEARANCE_CM = 25;

// ── State ──────────────────────────────────────────────────────
const state = {
  projects: [],
  activeProjectId: "",
  activeProject: null,
  roomShell: null,
  objects: [],
  selectedId: null,
  selectedCatalogProduct: null,
  mode: "furnish",   // "furnish" | "edit-room"
  moveMode: false,
  rotateMode: false,
  elevateMode: false,
  dirty: false
};

// ── DOM refs ──────────────────────────────────────────────────
const roomNameEl    = document.getElementById("room-name");
const roomDimsEl    = document.getElementById("room-dims");
const modeEditBtn   = document.getElementById("mode-edit");
const modeFurnishBtn = document.getElementById("mode-furnish");
const undoBtn         = document.getElementById("undo-btn");
const redoBtn         = document.getElementById("redo-btn");
const clearSceneBtn   = document.getElementById("clear-scene-btn");
const saveBtn         = document.getElementById("save-btn");
const cartCountEl   = document.getElementById("cart-count");
const cartTotalEl   = document.getElementById("cart-total");
const cartPillBtn   = document.getElementById("cart-pill");
const statusDotEl   = document.getElementById("status-dot");
const statusTextEl  = document.getElementById("status-text");
const scene3dHost   = document.getElementById("scene-3d");
const canvasWrap    = document.getElementById("canvas-wrap");
const floatingTbEl  = document.getElementById("floating-toolbar");
const moveHintEl    = document.getElementById("move-hint");
const hoverTooltipEl = document.getElementById("hover-tooltip");

const leftPanelEl  = document.getElementById("left-panel");
const rightPanelEl = document.getElementById("right-panel");
const panelRoomsEl    = document.getElementById("panel-rooms");
const panelCatalogEl  = document.getElementById("panel-catalog");
const panelRoomEditEl = document.getElementById("panel-room-edit");
const panelCartEl     = document.getElementById("panel-cart");
const panelDetailsEl  = document.getElementById("panel-details");

// ── Auto-save ──────────────────────────────────────────────────
let autoSaveTimer = null;
const scheduleAutoSave = () => {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (state.dirty && state.activeProject) {
      void saveScene();
    }
  }, 2500);
};

// ── Utilities ──────────────────────────────────────────────────
const setStatus = (msg, kind = "default") => {
  statusTextEl.textContent = msg;
  statusDotEl.className = "status-dot";
  if (kind === "ok")   statusDotEl.classList.add("ok");
  if (kind === "warn") statusDotEl.classList.add("warn");
  if (kind === "err")  statusDotEl.classList.add("err");
};

const cloneObjects = (objects) =>
  objects.map((o) => ({ ...o, dims_cm: { ...o.dims_cm }, pose: { ...o.pose }, attach: o.attach ? { ...o.attach } : undefined }));

const roundGrid = (v) => Math.round(v / GRID_CM) * GRID_CM;

const setButtonLoading = (button, loading, loadingText = "Salvestan...") => {
  if (!button) return;
  const originalText = button.dataset.originalText || button.textContent || "";
  if (!button.dataset.originalText) {
    button.dataset.originalText = originalText;
  }

  if (loading) {
    button.disabled = true;
    button.classList.add("is-loading");
    button.innerHTML = `<span class="btn-inline-spinner" aria-hidden="true"></span><span>${loadingText}</span>`;
    return;
  }

  button.disabled = false;
  button.classList.remove("is-loading");
  button.textContent = button.dataset.originalText || originalText;
};

const itemRect = (item) => {
  const hw = item.dims_cm.w / 2, hd = item.dims_cm.d / 2;
  return { minX: item.pose.x_cm - hw, maxX: item.pose.x_cm + hw, minZ: item.pose.z_cm - hd, maxZ: item.pose.z_cm + hd };
};

const overlaps = (a, b) => !(a.maxX <= b.minX || a.minX >= b.maxX || a.maxZ <= b.minZ || a.minZ >= b.maxZ);

const findFreePos = (dims, room, existingObjects) => {
  const cols = Math.max(1, Math.floor((room.width_cm - WALL_MARGIN_CM * 2) / GRID_CM));
  const rows = Math.max(1, Math.floor((room.length_cm - WALL_MARGIN_CM * 2) / GRID_CM));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = WALL_MARGIN_CM + dims.w / 2 + c * GRID_CM;
      const z = WALL_MARGIN_CM + dims.d / 2 + r * GRID_CM;
      if (x + dims.w / 2 > room.width_cm - WALL_MARGIN_CM) continue;
      if (z + dims.d / 2 > room.length_cm - WALL_MARGIN_CM) continue;
      const candidate = { dims_cm: dims, pose: { x_cm: x, z_cm: z, rotation_deg: 0 } };
      const rect = itemRect(candidate);
      if (!existingObjects.some((o) => overlaps(itemRect(o), rect))) return { x_cm: x, z_cm: z };
    }
  }
  return { x_cm: room.width_cm / 2, z_cm: room.length_cm / 2 };
};

const SCENE_OBJECT_DEFAULT_DIMS = {
  sofa: { w: 220, d: 95, h: 85 },
  cornersofa: { w: 270, d: 170, h: 85 },
  sofabed: { w: 210, d: 100, h: 90 },
  chaiselongue: { w: 90, d: 200, h: 85 },
  sunlounger: { w: 75, d: 200, h: 80 },
  armchair: { w: 85, d: 90, h: 90 },
  bed: { w: 180, d: 210, h: 95 },
  table: { w: 160, d: 90, h: 75 },
  roundtable: { w: 110, d: 110, h: 75 },
  coffeetable: { w: 120, d: 70, h: 45 },
  sidetable: { w: 50, d: 50, h: 55 },
  consoletable: { w: 120, d: 35, h: 80 },
  chair: { w: 55, d: 55, h: 90 },
  barstool: { w: 45, d: 45, h: 110 },
  officechair: { w: 60, d: 60, h: 115 },
  ottoman: { w: 80, d: 80, h: 45 },
  bench: { w: 120, d: 40, h: 45 },
  shelf: { w: 90, d: 35, h: 190 },
  cabinet: { w: 100, d: 45, h: 120 },
  dresser: { w: 100, d: 50, h: 90 },
  tvunit: { w: 160, d: 45, h: 55 },
  wardrobe: { w: 120, d: 60, h: 210 },
  vitrinecabinet: { w: 90, d: 45, h: 180 },
  lamp: { w: 40, d: 40, h: 150 },
  pendantlamp: { w: 40, d: 40, h: 200 },
  tablelamp: { w: 35, d: 35, h: 55 },
  rug: { w: 200, d: 300, h: 2 },
  mirror: { w: 60, d: 5, h: 150 },
  nightstand: { w: 50, d: 40, h: 60 },
  generic: { w: 100, d: 60, h: 90 }
};

const normalizeProductText = (...values) =>
  values
    .flat()
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const clampSceneDimension = (value, min, max) => Math.min(max, Math.max(min, value));

const inferSceneObjectType = (product) => {
  const text = normalizeProductText(
    product?.title,
    product?.handle,
    product?.sku,
    product?.id,
    product?.categoryNames,
    product?.categorySlugs,
    product?.categories
  );

  if (/paevitus|lamamistool|sunlounger/.test(text)) return "sunlounger";
  if (/nurgadiivan|nurga diivan|l diivan/.test(text)) return "cornersofa";
  if (/diivanvoodi|diivan voodi|sofabed/.test(text)) return "sofabed";
  if (/lamamis/.test(text)) return "chaiselongue";
  if (/diivan|sohva/.test(text)) return "sofa";
  if (/tugitool|armchair/.test(text)) return "armchair";
  if (/voodi/.test(text)) return "bed";
  if (/diivanilaud|kohvilaud|sohvalaud/.test(text)) return "coffeetable";
  if (/abilaud|korvallaud|sidetable/.test(text)) return "sidetable";
  if (/konsool|konsoollaud/.test(text)) return "consoletable";
  if (/(^| )o\d{2,3}( |$)|ø|ummargune/.test(text)) return "roundtable";
  if (/soogilaud|laud/.test(text)) return "table";
  if (/baaritool|baartool/.test(text)) return "barstool";
  if (/kontoritool/.test(text)) return "officechair";
  if (/tool|chair/.test(text)) return "chair";
  if (/tumba|puf/.test(text)) return "ottoman";
  if (/pink|bench/.test(text)) return "bench";
  if (/vitriin/.test(text)) return "vitrinecabinet";
  if (/tvkapp|tv kapp|telerialus/.test(text)) return "tvunit";
  if (/riidekapp|garderoob/.test(text)) return "wardrobe";
  if (/kummut/.test(text)) return "dresser";
  if (/riiul/.test(text)) return "shelf";
  if (/kapp/.test(text)) return "cabinet";
  if (/laualamp|lauavalgusti/.test(text)) return "tablelamp";
  if (/rippvalgusti|laevalgusti|luhter|luuster/.test(text)) return "pendantlamp";
  if (/lamp|valgusti/.test(text)) return "lamp";
  if (/vaip/.test(text)) return "rug";
  if (/peegel/.test(text)) return "mirror";
  if (/ookapp|oo kapp|nightstand/.test(text)) return "nightstand";
  return "generic";
};

const inferSceneObjectDims = (product, type) => {
  const fallback = SCENE_OBJECT_DEFAULT_DIMS[type] ?? SCENE_OBJECT_DEFAULT_DIMS.generic;
  const text = [product?.title, product?.handle, product?.sku, product?.id].filter(Boolean).join(" ");
  const match = text.match(/(\d{2,3})\s*[x×]\s*(\d{2,3})(?:\s*[x×]\s*(\d{2,3}))?/i);

  if (!match) return { ...fallback };

  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = Number(match[3] ?? Number.NaN);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return { ...fallback };

  if (Number.isFinite(third)) {
    return {
      w: clampSceneDimension(first, 25, 500),
      d: clampSceneDimension(second, 20, 400),
      h: clampSceneDimension(third, 10, 320)
    };
  }

  return {
    w: clampSceneDimension(first, 25, 500),
    d: clampSceneDimension(second, 20, 400),
    h: fallback.h
  };
};

const countImportedCopies = (baseKey) =>
  state.objects.reduce((total, object) => (
    object.source === "cart" && String(object.source_key ?? "").startsWith(`${baseKey}:`) ? total + 1 : total
  ), 0);

const buildLocalSceneObject = (productLike, options = {}) => {
  const room = state.activeProject?.dimensions;
  if (!room) return null;

  const baseKey = String(
    options.baseKey ??
    productLike?.handle ??
    productLike?.sku ??
    productLike?.variantId ??
    productLike?.id ??
    productLike?.title ??
    ""
  ).trim();

  if (!baseKey) return null;

  const objectType = inferSceneObjectType(productLike);
  const dims = inferSceneObjectDims(productLike, objectType);
  const objectIndex = Number(options.index ?? 1);
  const existingObjects = Array.isArray(options.existingObjects) ? options.existingObjects : state.objects;
  const pos = findFreePos(dims, room, existingObjects);

  return {
    id: `cart_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    source: "cart",
    source_key: `${baseKey}:${objectIndex}`,
    title: String(productLike?.title ?? baseKey),
    type: objectType,
    sku: String(productLike?.handle ?? productLike?.sku ?? productLike?.id ?? baseKey),
    dims_cm: dims,
    pose: { x_cm: pos.x_cm, z_cm: pos.z_cm, rotation_deg: 0 },
    attach: { snap: "none" },
    clearance_cm: 8,
    locked: false,
    movable: true,
    deletable: true,
    color: "#c89a5b"
  };
};

const appendSceneObjects = (objects, successMessage) => {
  if (!objects.length) return false;
  pushHistory();
  const nextObjects = [...state.objects, ...objects];
  state.objects = nextObjects;
  if (state.activeProject) {
    state.activeProject = {
      ...state.activeProject,
      scene: {
        ...(state.activeProject.scene ?? {}),
        objects: nextObjects
      }
    };
  }
  state.selectedId = objects[objects.length - 1].id;
  scene3d.setSelectedId(state.selectedId);
  state.dirty = true;
  scheduleAutoSave();
  renderScene();
  updateUndoRedo();
  updateFloatingToolbar();
  setStatus(successMessage, "ok");
  return true;
};

// ── History ────────────────────────────────────────────────────
const history = createHistoryStore(50);

const pushHistory = () => history.push(state.objects);

const updateUndoRedo = () => {
  undoBtn.disabled = !history.canUndo();
  redoBtn.disabled = !history.canRedo();
};

// ── 3D Scene ───────────────────────────────────────────────────
const scene3d = createScene3DEditor({
  hostEl: scene3dHost,
  getRoomShell: () => state.roomShell,
  getRoomDimensions: () => state.activeProject?.dimensions ?? state.roomShell?.dimensions ?? null,
  getRoomType: () => state.activeProject?.room_type ?? "indoor",
  getObjects: () => state.objects,
  onSelect: (objectId) => selectObject(objectId)
});

scene3d.onHover((objectId, clientX, clientY) => {
  if (!objectId) {
    hoverTooltipEl.hidden = true;
    return;
  }
  const obj = state.objects.find((o) => o.id === objectId);
  if (!obj) { hoverTooltipEl.hidden = true; return; }
  hoverTooltipEl.textContent = obj.name ?? obj.title ?? obj.sku ?? objectId;
  hoverTooltipEl.style.left = `${clientX}px`;
  hoverTooltipEl.style.top = `${clientY}px`;
  hoverTooltipEl.hidden = false;
});

scene3d.onFloorClick((worldX, worldZ) => {
  if (!state.selectedId || !state.moveMode) return;
  const room = state.activeProject?.dimensions;
  if (!room) return;

  const obj = state.objects.find((o) => o.id === state.selectedId);
  if (!obj) return;

  // Convert Three.js world coords to cm, then clamp so object stays inside walls
  const rawX = worldX / CM_TO_M + room.width_cm / 2;
  const rawZ = worldZ / CM_TO_M + room.length_cm / 2;
  const { x_cm, z_cm } = wallClampCm(obj, roundGrid(rawX), roundGrid(rawZ), room);

  if (checkCollision(state.selectedId, x_cm, z_cm)) {
    setStatus("Toode ei mahu sinna — teised esemed on ees", "warn");
    return;
  }

  pushHistory();
  state.objects = state.objects.map((o) =>
    o.id === state.selectedId ? { ...o, pose: { ...o.pose, x_cm, z_cm } } : o
  );
  state.dirty = true; scheduleAutoSave();
  exitMoveMode();
  renderScene();
  updateUndoRedo();
});

// ── Real-time drag ──────────────────────────────────────────────
scene3d.onDrag((objectId, worldX, worldZ) => {
  hoverTooltipEl.hidden = true; // hide while dragging
  const room = state.activeProject?.dimensions;
  if (!room || !objectId) return;
  const obj = state.objects.find((o) => o.id === objectId);
  if (obj && !obj.locked) {
    const rawX = worldX / CM_TO_M + room.width_cm / 2;
    const rawZ = worldZ / CM_TO_M + room.length_cm / 2;
    const { x_cm, z_cm } = wallClampCm(obj, rawX, rawZ, room);
    obj.pose.x_cm = x_cm;
    obj.pose.z_cm = z_cm;
    scene3d.renderObjects();
    if (state.selectedId === objectId) updateFloatingToolbar();
  }
});

scene3d.onDragEnd(() => {
  if (state.selectedId) {
    pushHistory();
    state.dirty = true; scheduleAutoSave();
    updateUndoRedo();
  }
});

const renderRoom = () => {
  if (!state.activeProject) return;
  scene3d.renderRoom();
};

const renderScene = () => {
  scene3d.renderObjects();
  if (state.selectedId) {
    scene3d.highlight(state.selectedId);
    updateFloatingToolbar();
  }
};

// ── Floating toolbar ───────────────────────────────────────────
const floatingToolbar = createFloatingToolbar({
  hostEl: canvasWrap,
  toolbarEl: floatingTbEl,
  onMove: () => {
    if (!state.selectedId) return;
    const obj = state.objects.find((o) => o.id === state.selectedId);
    if (obj?.locked) { setStatus("Objekt on lukustatud", "warn"); return; }
    enterMoveMode();
  },
  onRotate: () => {
    if (!state.selectedId) return;
    const obj = state.objects.find((o) => o.id === state.selectedId);
    if (obj?.locked) { setStatus("Objekt on lukustatud", "warn"); return; }
    if (state.rotateMode) { exitRotateMode(); } else { enterRotateMode(); }
  },
  onElevate: () => {
    if (!state.selectedId) return;
    const obj = state.objects.find((o) => o.id === state.selectedId);
    if (obj?.locked) { setStatus("Objekt on lukustatud", "warn"); return; }
    if (state.elevateMode) { exitElevateMode(); } else { enterElevateMode(); }
  },
  onDuplicate: () => {
    if (!state.selectedId) return;
    const obj = state.objects.find((o) => o.id === state.selectedId);
    if (!obj || !obj.deletable) return;
    const room = state.activeProject?.dimensions;
    if (!room) return;
    const pos = findFreePos(obj.dims_cm, room, state.objects);
    const newObj = {
      ...obj,
      id: `obj_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      pose: { ...obj.pose, x_cm: pos.x_cm, z_cm: pos.z_cm }
    };
    pushHistory();
    state.objects = [...state.objects, newObj];
    state.dirty = true; scheduleAutoSave();
    renderScene();
    updateUndoRedo();
  },
  onDelete: () => {
    if (!state.selectedId) return;
    const obj = state.objects.find((o) => o.id === state.selectedId);
    if (!obj?.deletable) { setStatus("Seda objekti ei saa kustutada", "warn"); return; }
    if (obj.locked) { setStatus("Objekt on lukustatud – ava lukk enne kustutamist", "warn"); return; }
    pushHistory();
    state.objects = state.objects.filter((o) => o.id !== state.selectedId);
    state.selectedId = null;
    floatingToolbar.hide();
    state.dirty = true; scheduleAutoSave();
    renderScene();
    updateUndoRedo();
  },
  onLock: () => {
    if (!state.selectedId) return;
    pushHistory();
    state.objects = state.objects.map((o) =>
      o.id === state.selectedId ? { ...o, locked: !o.locked } : o
    );
    const obj = state.objects.find((o) => o.id === state.selectedId);
    floatingToolbar.show(state.selectedId, obj?.locked ?? false);
    state.dirty = true; scheduleAutoSave();
    updateUndoRedo();
  }
});

floatingToolbar.setGetScreenPos((id) => scene3d.getObjectScreenPos(id));

const updateFloatingToolbar = () => {
  if (!state.selectedId) { floatingToolbar.hide(); return; }
  const obj = state.objects.find((o) => o.id === state.selectedId);
  floatingToolbar.show(state.selectedId, obj?.locked ?? false);
};

const selectObject = (objectId) => {
  if (state.moveMode || state.rotateMode || state.elevateMode) return;
  state.selectedId = objectId;
  scene3d.setSelectedId(objectId);
  if (objectId) {
    onboarding?.notify("scene:select-object");
  }
  if (objectId) {
    scene3d.highlight(objectId);
    updateFloatingToolbar();
  } else {
    scene3d.highlight(null);
    floatingToolbar.hide();
  }
};

const enterMoveMode = () => {
  state.moveMode = true;
  scene3d.setMoveMode(true);
  moveHintEl.hidden = false;
  floatingTbEl.querySelector("#ftb-move")?.classList.add("active");
};

const exitMoveMode = () => {
  state.moveMode = false;
  scene3d.setMoveMode(false);
  moveHintEl.hidden = true;
};

// ── Rotate mode (drag to rotate) ───────────────────────────────
let _rotDragStartX = null;
let _rotDragStartDeg = null;
let _rotDragActive = false;
let _rotHistoryPushed = false;

const enterRotateMode = () => {
  exitMoveMode();
  state.rotateMode = true;
  scene3d.setRotateMode(true);
  moveHintEl.textContent = "Lohista vasakule / paremale, et pöörata. Esc = välju";
  moveHintEl.hidden = false;
  floatingTbEl.querySelector("#ftb-rotate")?.classList.add("active");
};

const exitRotateMode = () => {
  state.rotateMode = false;
  scene3d.setRotateMode(false);
  moveHintEl.hidden = true;
  moveHintEl.textContent = "Kliki põrandale, kuhu soovid objekti paigutada";
  floatingTbEl.querySelector("#ftb-rotate")?.classList.remove("active");
  _rotDragActive = false;
  _rotHistoryPushed = false;
};

canvasWrap.addEventListener("pointerdown", (e) => {
  if (!state.rotateMode || !state.selectedId) return;
  const obj = state.objects.find((o) => o.id === state.selectedId);
  if (!obj || obj.locked) return;
  e.preventDefault();
  e.stopPropagation();
  _rotDragStartX = e.clientX;
  _rotDragStartDeg = obj.pose.rotation_deg;
  _rotDragActive = true;
  _rotHistoryPushed = false;
  try { canvasWrap.setPointerCapture(e.pointerId); } catch {}
}, { capture: true });

canvasWrap.addEventListener("pointermove", (e) => {
  if (!_rotDragActive || !state.rotateMode || !state.selectedId) return;
  if (!_rotHistoryPushed) { pushHistory(); _rotHistoryPushed = true; }
  const delta = e.clientX - _rotDragStartX;
  const newDeg = ((_rotDragStartDeg + delta * 0.5) % 360 + 360) % 360;
  state.objects = state.objects.map((o) =>
    o.id === state.selectedId ? { ...o, pose: { ...o.pose, rotation_deg: newDeg } } : o
  );
  state.dirty = true;
  renderScene();
}, { capture: true });

canvasWrap.addEventListener("pointerup", () => {
  if (!_rotDragActive) return;
  _rotDragActive = false;
  if (_rotHistoryPushed) { scheduleAutoSave(); updateUndoRedo(); }
}, { capture: true });

// ── Elevate mode (drag up/down to change object height) ────────
let _elvDragStartY = null;
let _elvDragStartElevation = null;
let _elvDragActive = false;
let _elvHistoryPushed = false;

const enterElevateMode = () => {
  exitMoveMode(); exitRotateMode();
  state.elevateMode = true;
  canvasWrap.style.cursor = "ns-resize";
  moveHintEl.textContent = "Lohista üles / alla, et muuta kõrgust. Esc = välju";
  moveHintEl.hidden = false;
  floatingTbEl.querySelector("#ftb-elevate")?.classList.add("active");
};

const exitElevateMode = () => {
  state.elevateMode = false;
  canvasWrap.style.cursor = "";
  moveHintEl.hidden = true;
  floatingTbEl.querySelector("#ftb-elevate")?.classList.remove("active");
  _elvDragActive = false;
  _elvHistoryPushed = false;
};

canvasWrap.addEventListener("pointerdown", (e) => {
  if (!state.elevateMode || !state.selectedId) return;
  const obj = state.objects.find((o) => o.id === state.selectedId);
  if (!obj || obj.locked) return;
  e.preventDefault(); e.stopPropagation();
  _elvDragStartY = e.clientY;
  _elvDragStartElevation = obj.pose.elevation_cm ?? 0;
  _elvDragActive = true;
  _elvHistoryPushed = false;
  try { canvasWrap.setPointerCapture(e.pointerId); } catch {}
}, { capture: true });

canvasWrap.addEventListener("pointermove", (e) => {
  if (!_elvDragActive || !state.elevateMode || !state.selectedId) return;
  if (!_elvHistoryPushed) { pushHistory(); _elvHistoryPushed = true; }
  const delta = _elvDragStartY - e.clientY; // up = positive
  const obj = state.objects.find((o) => o.id === state.selectedId);
  const roomH = state.activeProject?.dimensions?.height_cm ?? 300;
  const maxElev = Math.max(0, roomH - (obj?.dims_cm.h ?? 0));
  const newElev = clamp(Math.round(_elvDragStartElevation + delta * 0.8), 0, maxElev);
  state.objects = state.objects.map((o) =>
    o.id === state.selectedId ? { ...o, pose: { ...o.pose, elevation_cm: newElev } } : o
  );
  state.dirty = true;
  renderScene();
  const elev = state.objects.find((o) => o.id === state.selectedId)?.pose.elevation_cm ?? 0;
  setStatus(`Kõrgus: ${elev} cm`, "default");
}, { capture: true });

canvasWrap.addEventListener("pointerup", (e) => {
  if (!_elvDragActive) return;
  _elvDragActive = false;
  if (_elvHistoryPushed) { scheduleAutoSave(); updateUndoRedo(); }
}, { capture: true });

// ── Collision & bounds helpers ──────────────────────────────────

// Axis-aligned bounding box of a rotated object (in cm)
const objectAABB = (obj, overrideX, overrideZ) => {
  const cx = overrideX ?? obj.pose.x_cm;
  const cz = overrideZ ?? obj.pose.z_cm;
  const θ = ((obj.pose.rotation_deg ?? 0) * Math.PI) / 180;
  const hw = obj.dims_cm.w / 2;
  const hd = obj.dims_cm.d / 2;
  return {
    cx, cz,
    hw: Math.abs(hw * Math.cos(θ)) + Math.abs(hd * Math.sin(θ)),
    hd: Math.abs(hw * Math.sin(θ)) + Math.abs(hd * Math.cos(θ))
  };
};

// Clamp object center so its AABB stays inside room walls
// Outdoor rooms: 0 cm gap (objects can reach deck edge flush)
// Indoor rooms: 2 cm gap (keeps objects from clipping walls)
const wallClampCm = (obj, rawX, rawZ, room) => {
  const isOutdoor = (state.activeProject?.room_type ?? "indoor") === "outdoor";
  const WALL_GAP = isOutdoor ? 0 : 2;
  const aabb = objectAABB(obj, rawX, rawZ);
  return {
    x_cm: clamp(rawX, aabb.hw + WALL_GAP, room.width_cm  - aabb.hw - WALL_GAP),
    z_cm: clamp(rawZ, aabb.hd + WALL_GAP, room.length_cm - aabb.hd - WALL_GAP)
  };
};

// True if moving object would overlap any other object (2 cm tolerance gap)
const checkCollision = (movingId, newX, newZ) => {
  const moving = state.objects.find((o) => o.id === movingId);
  if (!moving) return false;
  const a = objectAABB(moving, newX, newZ);
  const GAP = 2;
  for (const other of state.objects) {
    if (other.id === movingId) continue;
    const b = objectAABB(other);
    if (Math.abs(a.cx - b.cx) < a.hw + b.hw + GAP &&
        Math.abs(a.cz - b.cz) < a.hd + b.hd + GAP) return true;
  }
  return false;
};

// ── Drawer ─────────────────────────────────────────────────────
const drawer = createDrawerManager({ leftPanel: leftPanelEl, rightPanel: rightPanelEl });
let onboarding = null;

document.querySelectorAll(".rail-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const panel = btn.dataset.panel;
    const side = btn.dataset.side;
    drawer.toggle(side, panel);
  });
});

const handlePanelCloseClick = (event) => {
  const closeBtn = event.target.closest(".panel-close-btn");
  if (!closeBtn) return;
  const side = String(closeBtn.dataset.side ?? "").trim();
  if (side !== "left" && side !== "right") return;
  drawer.close(side);
  setStatus("Paneel suletud", "default");
};

leftPanelEl.addEventListener("click", handlePanelCloseClick);
rightPanelEl.addEventListener("click", handlePanelCloseClick);

cartPillBtn.addEventListener("click", () => {
  drawer.toggle("right", "cart");
  cartPanel.refresh();
  if (drawer.getActive("right") === "cart") {
    onboarding?.notify("drawer:cart");
  }
});

// ── Room name inline rename ────────────────────────────────────
roomNameEl.addEventListener("click", () => {
  if (!state.activeProject) return;
  roomNameEl.contentEditable = "true";
  roomNameEl.focus();
  const range = document.createRange();
  range.selectNodeContents(roomNameEl);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
});

roomNameEl.addEventListener("blur", async () => {
  roomNameEl.contentEditable = "false";
  const newName = roomNameEl.textContent.trim();
  if (!newName || !state.activeProject || newName === state.activeProject.name) return;
  try {
    const data = await fetchJson(`${API_BASE}/room-projects/${state.activeProject.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName })
    });
    state.activeProject = data.project;
    roomNameEl.textContent = data.project.name;
    setStatus("Nimi salvestatud", "ok");
  } catch {
    roomNameEl.textContent = state.activeProject.name;
  }
});

roomNameEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); roomNameEl.blur(); }
  if (e.key === "Escape") { roomNameEl.textContent = state.activeProject?.name ?? ""; roomNameEl.blur(); }
});

// ── Mode buttons ───────────────────────────────────────────────
modeEditBtn.addEventListener("click", () => setMode("edit-room"));
modeFurnishBtn.addEventListener("click", () => setMode("furnish"));

const setMode = (mode) => {
  state.mode = mode;
  modeEditBtn.classList.toggle("active", mode === "edit-room");
  modeFurnishBtn.classList.toggle("active", mode === "furnish");
  if (mode === "edit-room") drawer.open("left", "room-edit");
  if (mode === "furnish")  floatingToolbar.hide();
};

// ── Save ───────────────────────────────────────────────────────
saveBtn.addEventListener("click", saveScene);

async function saveScene() {
  if (!state.activeProject) { setStatus("Projekt pole laaditud", "warn"); return; }
  setButtonLoading(saveBtn, true, "Salvestan...");
  setStatus("Salvestan...", "default");
  try {
    const camState = scene3d.getCameraState();
    await fetchJson(`${API_BASE}/room-projects/${state.activeProject.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scene: {
          objects: state.objects,
          camera_state: camState ?? undefined
        }
      })
    });
    state.dirty = false;
    setStatus("Salvestatud", "ok");
    onboarding?.notify("scene:saved");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Salvestamine ebaõnnestus", "err");
  } finally {
    setButtonLoading(saveBtn, false);
  }
}

// ── Clear scene ────────────────────────────────────────────────
clearSceneBtn.addEventListener("click", async () => {
  if (!state.activeProject) return;
  if (!confirm("Kustutad kõik esemed stseenist? Seda ei saa tagasi võtta.")) return;
  pushHistory();
  state.objects = [];
  state.selectedId = null;
  scene3d.setSelectedId(null);
  floatingToolbar.hide();
  state.dirty = false;
  renderScene();
  updateUndoRedo();
  setStatus("Stseen tühjendatud, salvestan...", "default");
  // Save empty scene to server so it stays in sync
  await saveScene();
});

// ── Undo / Redo ────────────────────────────────────────────────
undoBtn.addEventListener("click", () => {
  const snapshot = history.undo(state.objects);
  if (!snapshot) return;
  state.objects = snapshot;
  state.dirty = true; scheduleAutoSave();
  renderScene();
  updateUndoRedo();
});

redoBtn.addEventListener("click", () => {
  const snapshot = history.redo(state.objects);
  if (!snapshot) return;
  state.objects = snapshot;
  state.dirty = true; scheduleAutoSave();
  renderScene();
  updateUndoRedo();
});

// ── Rooms panel ────────────────────────────────────────────────
const roomsPanel = createRoomsPanel({
  containerEl: panelRoomsEl,
  onOpen: (project) => loadProject(project.id),
  onStatusChange: setStatus
});

// ── Room-edit panel ────────────────────────────────────────────
const roomEditPanel = createRoomEditPanel({
  containerEl: panelRoomEditEl,
  onSaved: (project) => {
    state.activeProject = project;
    state.roomShell = project.room_shell;
    updateToolbarDims();
    scene3d.setRoomType(project.room_type ?? "indoor");
    renderRoom();
    setStatus("Tuba uuendatud", "ok");
  },
  onStatusChange: setStatus
});

// ── Catalog panel ──────────────────────────────────────────────
let catalogInitialized = false;

const catalogPanel = createCatalogPanelV4({
  containerEl: panelCatalogEl,
  onAddToScene: (product) => addProductToScene(product),
  onAddToCart: (product) => addProductToLocalCart(product),
  onShowDetails: (product) => {
    state.selectedCatalogProduct = product;
    detailsPanel.show(product);
    drawer.open("right", "details");
  },
  onStatusChange: setStatus
});

const ensureCatalogInitialized = async () => {
  if (catalogInitialized) return;
  catalogInitialized = true;
  await catalogPanel.init();
};

// Lazy init catalog when panel first opened + onboarding events
const origToggle = drawer.toggle.bind(drawer);
drawer.toggle = (side, panelId) => {
  origToggle(side, panelId);

  const activeOnSide = drawer.getActive(side);
  if (side === "left" && panelId === "catalog" && activeOnSide === "catalog") {
    void ensureCatalogInitialized().catch((err) => setStatus(err.message, "err"));
  }

  if (activeOnSide === panelId) {
    onboarding?.notify(`drawer:${panelId}`);
  }
};

// ── Cart panel ─────────────────────────────────────────────────
const cartPanel = createCartPanel({
  containerEl: panelCartEl,
  onAddToScene: (line) => importCartLines([line]),
  onAddAllToScene: (lines) => importCartLines(lines),
  onStatusChange: setStatus
});

// ── Details panel ──────────────────────────────────────────────
const detailsPanel = createDetailsPanel({
  containerEl: panelDetailsEl,
  onAddToScene: (product) => addProductToScene(product),
  onAddToCart: (product) => addProductToLocalCart(product)
});

// ── Add to scene helpers ───────────────────────────────────────
async function addProductToScene(product) {
  if (!state.activeProject) { setStatus("Projekt pole valitud", "warn"); return; }
  const baseKey = String(product.handle ?? product.sku ?? product.variantId ?? product.id ?? product.title ?? "").trim();
  if (!baseKey) { setStatus("Tootel puudub identifikaator", "warn"); return; }

  const nextIndex = countImportedCopies(baseKey) + 1;
  const object = buildLocalSceneObject(product, {
    baseKey,
    index: nextIndex,
    existingObjects: state.objects
  });

  if (!object) {
    setStatus("Toote lisamine ebaõnnestus", "err");
    return;
  }

  appendSceneObjects([object], `Lisatud: ${product.title ?? object.title}`);
}

async function importCartLines(lines) {
  if (!state.activeProject) { setStatus("Projekt pole valitud", "warn"); return; }
  if (!lines?.length) { setStatus("Korv on tühi", "warn"); return; }

  setStatus("Importin ostukorvist...", "default");
  try {
    const cartLines = lines.map((l) => ({
      id: String(l.id),
      title: String(l.title),
      qty: Number(l.qty ?? 1),
      price: l.price != null ? Number(l.price) : undefined,
      url: l.url,
      image: l.image
    }));
    const data = await fetchJson(`${API_BASE}/room-projects/${state.activeProject.id}/scene/import-cart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cartLines })
    });
    if (!Number(data.addedCount ?? 0)) {
      const existingSourceKeys = new Set(state.objects.map((item) => String(item.source_key ?? "")));
      const localAdds = [];

      for (const line of cartLines) {
        const baseKey = String(line.id ?? line.title ?? "").trim();
        if (!baseKey) continue;
        const targetQty = Math.max(1, Number(line.qty ?? 1));
        for (let index = 1; index <= targetQty; index += 1) {
          const sourceKey = `${baseKey}:${index}`;
          if (existingSourceKeys.has(sourceKey)) continue;
          const object = buildLocalSceneObject(
            { ...line, handle: line.id, sku: line.id },
            { baseKey, index, existingObjects: [...state.objects, ...localAdds] }
          );
          if (!object) continue;
          existingSourceKeys.add(sourceKey);
          localAdds.push(object);
        }
      }

      if (appendSceneObjects(localAdds, `Lisatud ${localAdds.length} eset`)) {
        onboarding?.notify("cart:add-to-scene");
      } else {
        setStatus("Kõik korvi tooted on juba ruumis", "warn");
      }
      return;
    }
    applySceneUpdate(data.project);
    setStatus(`Lisatud ${data.addedCount ?? cartLines.length} eset`, "ok");
    onboarding?.notify("cart:add-to-scene");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Import ebaõnnestus", "err");
  }
}

function addProductToLocalCart(product) {
  const lines = readLocalCartLines();
  const existing = lines.find((l) => l.id === String(product.sku ?? product.id ?? product.title));
  if (existing) {
    existing.qty += 1;
    writeLocalCartLines(lines);
  } else {
    lines.push({
      id: String(product.sku ?? product.id ?? product.title ?? Date.now()),
      title: String(product.title ?? "Toode"),
      qty: 1,
      price: product.price ? parseFloat(String(product.price).replace(/[^0-9.]/g, "")) : undefined,
      url: product.url,
      image: product.image
    });
    writeLocalCartLines(lines);
  }
  cartPanel.updateCartPill();
  setStatus(`Lisatud korvi: ${product.title}`, "ok");
  onboarding?.notify("catalog:add-to-cart");
}

function applySceneUpdate(project) {
  if (!project) return;
  pushHistory();
  state.activeProject = project;
  state.objects = Array.isArray(project.scene?.objects) ? project.scene.objects : [];
  state.dirty = false;
  renderScene();
  updateUndoRedo();
}

// ── Project loading ────────────────────────────────────────────
async function loadProject(projectId) {
  if (!projectId) return;
  setStatus("Laen projekti...", "default");
  try {
    const data = await fetchJson(`${API_BASE}/room-projects/${projectId}`);
    const project = data.project;
    state.activeProject = project;
    state.activeProjectId = project.id;
    state.roomShell = project.room_shell ?? null;
    state.objects = Array.isArray(project.scene?.objects) ? project.scene.objects : [];
    state.selectedId = null;
    state.dirty = false;
    history.reset();

    try { localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, project.id); } catch {}

    updateToolbarDims();
    scene3d.setRoomType(project.room_type ?? "indoor");
    renderRoom();
    renderScene();
    updateUndoRedo();

    // Restore camera state if saved
    if (project.scene?.camera_state) {
      scene3d.restoreCameraState(project.scene.camera_state);
    }

    // Populate room-edit panel
    roomEditPanel.populate(project);
    void onboarding?.maybeStart();

    setStatus("Projekt laaditud", "ok");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Projekti laadimine ebaõnnestus";
    // If project was deleted, clear stale ID and open rooms panel
    if (msg.toLowerCase().includes("not found") || msg.includes("404")) {
      try { localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY); } catch {}
      roomNameEl.classList.remove("loading-pulse");
      roomNameEl.textContent = "—";
      drawer.open("left", "rooms");
      setStatus("Projekt ei leitud — vali või loo uus", "warn");
    } else {
      setStatus(msg, "err");
    }
  }
}

const updateToolbarDims = () => {
  const project = state.activeProject;
  if (!project) return;
  roomNameEl.classList.remove("loading-pulse");
  roomNameEl.textContent = project.name ?? "Nimeta tuba";
  const dims = project.dimensions;
  roomDimsEl.textContent = dims
    ? `${dims.width_cm}×${dims.length_cm}×${dims.height_cm} cm`
    : "";
};

// ── Boot ───────────────────────────────────────────────────────
async function boot() {
  roomNameEl.classList.add("loading-pulse");
  const query = new URLSearchParams(window.location.search);
  const urlProjectId = query.get("projectId") ?? "";
  const urlPanel = query.get("panel") ?? "";
  const urlSku = query.get("sku") ?? "";

  // Legacy roomId adapter
  const urlRoomId = query.get("roomId") ?? "";
  if (urlRoomId && !urlProjectId) {
    try {
      const data = await fetchJson(`${API_BASE}/room-projects/from-room/${urlRoomId}`, { method: "POST" });
      if (data.project?.id) {
        const url = new URL(window.location.href);
        url.searchParams.set("projectId", data.project.id);
        url.searchParams.delete("roomId");
        history.reset();
        window.history.replaceState({}, "", url.toString());
        await boot();
        return;
      }
    } catch {}
  }

  // Load project list
  try {
    const data = await fetchJson(`${API_BASE}/room-projects`);
    state.projects = Array.isArray(data.projects) ? data.projects : [];
    roomsPanel.setProjects(state.projects, "");
  } catch (err) {
    setStatus("Projektide laadimine ebaõnnestus", "err");
  }

  // Determine which project to open
  let targetProjectId = urlProjectId;
  if (!targetProjectId) {
    try { targetProjectId = localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY) ?? ""; } catch {}
  }

  // Validate that stored ID still exists in the project list; clear stale IDs
  if (targetProjectId && state.projects.length) {
    const projectExists = state.projects.some((p) => p.id === targetProjectId);
    if (!projectExists) {
      try { localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY); } catch {}
      targetProjectId = state.projects[0].id;
    }
  }
  if (!targetProjectId && state.projects.length) {
    targetProjectId = state.projects[0].id;
  }

  if (targetProjectId) {
    roomsPanel.setProjects(state.projects, targetProjectId);
    await loadProject(targetProjectId);
  } else {
    // No project — open rooms panel so user can create one
    roomNameEl.classList.remove("loading-pulse");
    drawer.open("left", "rooms");
    setStatus("Loo uus projekt alustamiseks", "default");
  }

  // Open panel from URL param
  if (urlPanel === "room-edit") drawer.open("left", "room-edit");
  else if (urlPanel === "catalog") drawer.open("left", "catalog");
  else if (urlPanel === "rooms") drawer.open("left", "rooms");

  // Deep-link SKU
  if (urlSku) {
    drawer.toggle("left", "catalog");
    await ensureCatalogInitialized();
    catalogPanel.search(urlSku);
  }

  // Initial cart pill update
  cartPanel.updateCartPill();

  // Resize on window resize
  window.addEventListener("resize", () => scene3d.resize());
}

// ── Keyboard shortcuts ─────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.contentEditable === "true") return;

  if (e.key === "Escape") {
    if (state.elevateMode) { exitElevateMode(); return; }
    if (state.rotateMode) { exitRotateMode(); return; }
    if (state.moveMode) { exitMoveMode(); return; }
    selectObject(null);
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
    e.preventDefault();
    undoBtn.click();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
    e.preventDefault();
    redoBtn.click();
    return;
  }

  if ((e.key === "Delete" || e.key === "Backspace") && state.selectedId) {
    e.preventDefault();
    floatingTbEl.querySelector("#ftb-delete")?.click();
    return;
  }

  if (e.key === "r" || e.key === "R") {
    if (state.selectedId) floatingTbEl.querySelector("#ftb-rotate")?.click();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    saveBtn.click();
  }
});

const loadStart = Date.now();

const hideLoading = () => {
  const el = document.getElementById("app-loading");
  if (!el) return;
  const elapsed = Date.now() - loadStart;
  const delay = Math.max(0, 700 - elapsed);
  setTimeout(() => {
    el.classList.add("fade-out");
    setTimeout(() => el.remove(), 320);
  }, delay);
};

boot()
  .catch((err) => {
    setStatus(err instanceof Error ? err.message : "Rakenduse laadimine ebaõnnestus", "err");
  })
  .finally(hideLoading);
