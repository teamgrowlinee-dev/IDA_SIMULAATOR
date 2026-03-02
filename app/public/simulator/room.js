const ROOM_STORAGE_KEY = "ida_room_id";
const MAX_VISUAL_FILES = 3;
const MAX_VISUAL_FILE_BYTES = 2_500_000;

const $ = (selector) => document.querySelector(selector);

const form = $("#room-form");
const obstaclesList = $("#obstacles-list");
const addObstacleBtn = $("#add-obstacle");
const doorEnabled = $("#door-enabled");
const doorFields = $("#door-fields");
const statusBox = $("#status-box");
const openSimulatorBtn = $("#open-simulator-btn");
const filesInput = $("#visual-files");

const query = new URLSearchParams(window.location.search);
const nextSku = query.get("nextSku")?.trim() ?? "";

let obstacleSeq = 0;
let latestRoomId = "";

const setStatus = (text, variant = "info") => {
  statusBox.textContent = text;
  statusBox.className = "status-box";
  if (variant === "ok") statusBox.classList.add("ok");
  if (variant === "err") statusBox.classList.add("err");
};

const cm = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const createObstacleRow = (defaults = {}) => {
  obstacleSeq += 1;
  const wrapper = document.createElement("div");
  wrapper.className = "obstacle-row";
  wrapper.dataset.obstacleId = String(obstacleSeq);

  wrapper.innerHTML = `
    <div class="row two">
      <div>
        <label>Nimi</label>
        <input data-field="label" placeholder="nt radiaator" value="${defaults.label ?? ""}" />
      </div>
      <div style="display:flex;align-items:end;justify-content:flex-end;">
        <button type="button" class="btn ghost" data-action="remove-obstacle">Eemalda</button>
      </div>
    </div>
    <div class="row">
      <div>
        <label>x (cm)</label>
        <input data-field="x_cm" type="number" min="0" value="${defaults.x_cm ?? 60}" />
      </div>
      <div>
        <label>z (cm)</label>
        <input data-field="z_cm" type="number" min="0" value="${defaults.z_cm ?? 60}" />
      </div>
      <div>
        <label>kõrgus (cm)</label>
        <input data-field="height_cm" type="number" min="1" value="${defaults.height_cm ?? 80}" />
      </div>
    </div>
    <div class="row">
      <div>
        <label>laius (cm)</label>
        <input data-field="width_cm" type="number" min="1" value="${defaults.width_cm ?? 120}" />
      </div>
      <div>
        <label>sügavus (cm)</label>
        <input data-field="depth_cm" type="number" min="1" value="${defaults.depth_cm ?? 20}" />
      </div>
      <div></div>
    </div>
  `;

  wrapper.querySelector('[data-action="remove-obstacle"]')?.addEventListener("click", () => {
    wrapper.remove();
  });

  obstaclesList.appendChild(wrapper);
};

const toggleDoorFields = () => {
  doorFields.style.display = doorEnabled.checked ? "block" : "none";
};

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const collectVisualRefs = async () => {
  const fileList = Array.from(filesInput.files ?? []).slice(0, MAX_VISUAL_FILES);
  if (!fileList.length) return [];

  const refs = [];
  for (const file of fileList) {
    if (file.size > MAX_VISUAL_FILE_BYTES) {
      continue;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (dataUrl) refs.push({ type: "image", url: dataUrl });
    } catch (error) {
      console.error("[room] visual ref read failed:", error);
    }
  }
  return refs;
};

const collectPayload = async () => {
  const width_cm = cm($("#width-cm").value, 420);
  const length_cm = cm($("#length-cm").value, 560);
  const heightRaw = cm($("#height-cm").value, 0);
  const obstacles = Array.from(obstaclesList.querySelectorAll(".obstacle-row")).map((row) => {
    const byField = (field) => row.querySelector(`[data-field="${field}"]`);
    return {
      type: "box",
      label: String(byField("label")?.value ?? "").trim() || undefined,
      x_cm: cm(byField("x_cm")?.value, 60),
      z_cm: cm(byField("z_cm")?.value, 60),
      width_cm: cm(byField("width_cm")?.value, 120),
      depth_cm: cm(byField("depth_cm")?.value, 20),
      height_cm: cm(byField("height_cm")?.value, 80)
    };
  });

  const openings = [];
  if (doorEnabled.checked) {
    openings.push({
      type: "door",
      wall: $("#door-wall").value,
      offset_cm: cm($("#door-offset").value, 0),
      width_cm: cm($("#door-width").value, 90),
      height_cm: 210
    });
  }

  const visual_refs = await collectVisualRefs();

  return {
    shape: "rect",
    width_cm,
    length_cm,
    height_cm: heightRaw > 0 ? heightRaw : undefined,
    openings,
    obstacles,
    visual_refs
  };
};

const openSimulator = (roomId) => {
  const url = new URL("/simulator", window.location.origin);
  url.searchParams.set("roomId", roomId);
  if (nextSku) url.searchParams.set("sku", nextSku);
  window.open(url.toString(), "_blank", "noopener,noreferrer");
};

const updateOpenButton = () => {
  if (!latestRoomId) {
    openSimulatorBtn.disabled = true;
    return;
  }
  openSimulatorBtn.disabled = false;
};

addObstacleBtn.addEventListener("click", () => createObstacleRow());
doorEnabled.addEventListener("change", toggleDoorFields);
openSimulatorBtn.addEventListener("click", () => {
  if (!latestRoomId) return;
  openSimulator(latestRoomId);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Salvestan ruumi...", "info");

  try {
    const payload = await collectPayload();
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof data?.error === "string" ? data.error : "Room save failed");
    }

    latestRoomId = String(data.roomId ?? "");
    if (!latestRoomId) throw new Error("roomId missing from response");

    localStorage.setItem(ROOM_STORAGE_KEY, latestRoomId);

    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "ida-room-created", roomId: latestRoomId }, "*");
    }

    updateOpenButton();
    setStatus(`Tuba salvestatud. roomId: ${latestRoomId}`, "ok");

    if (nextSku) {
      openSimulator(latestRoomId);
    }
  } catch (error) {
    console.error("[room] save error:", error);
    setStatus(error instanceof Error ? error.message : "Ruumi salvestamine ebaõnnestus", "err");
  }
});

(() => {
  const stored = localStorage.getItem(ROOM_STORAGE_KEY) ?? "";
  if (stored) {
    latestRoomId = stored;
    setStatus(`Leidsin varasema roomId: ${stored}`, "ok");
  }
  toggleDoorFields();
  createObstacleRow({ label: "radiaator", x_cm: 300, z_cm: 20, width_cm: 120, depth_cm: 20, height_cm: 60 });
  updateOpenButton();
})();
