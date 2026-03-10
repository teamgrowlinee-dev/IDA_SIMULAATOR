const readRuntimeApiBase = () => {
  try {
    const value = String(window.__IDA_SIMULATOR_API_BASE__ ?? "").trim();
    return value ? value.replace(/\/$/, "") : "";
  } catch {
    return "";
  }
};

export const API_BASE = readRuntimeApiBase() || "/api";
export const PROFILE_STORAGE_KEY = "ida_profile_id";
export const ACTIVE_PROJECT_STORAGE_KEY = "ida_active_project_id";
export const LOCAL_CART_STORAGE_KEY = "ida_local_cart_v1";

const readStoredProfileId = () => {
  try {
    return String(localStorage.getItem(PROFILE_STORAGE_KEY) ?? "").trim();
  } catch {
    return "";
  }
};

const writeStoredProfileId = (profileId) => {
  const value = String(profileId ?? "").trim();
  if (!value) return;
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, value);
  } catch {
    // ignore storage failures
  }
};

export const fetchJson = async (url, options = {}) => {
  const headers = { ...(options.headers || {}) };
  const profileId = readStoredProfileId();
  if (profileId && !headers["x-ida-profile-id"]) {
    headers["x-ida-profile-id"] = profileId;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const payload = await response.json().catch(() => ({}));
  if (typeof payload?.profileId === "string") {
    writeStoredProfileId(payload.profileId);
  }

  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : `HTTP ${response.status}`);
  }

  return payload;
};

export const computeDimensions = (widthCm, lengthCm, heightCm) => {
  const width = Number(widthCm);
  const length = Number(lengthCm);
  const height = Number(heightCm);
  const area = Number(((width * length) / 10000).toFixed(2));
  const volume = Number(((area * height) / 100).toFixed(2));
  return {
    width_cm: width,
    length_cm: length,
    height_cm: height,
    area_m2: area,
    volume_m3: volume
  };
};

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const readLocalCartLines = () => {
  try {
    const raw = localStorage.getItem(LOCAL_CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((line) => ({
        id: String(line.id ?? "").trim(),
        title: String(line.title ?? "Toode").trim(),
        qty: Number.isFinite(Number(line.qty)) ? Math.max(1, Number(line.qty)) : 1,
        price: Number.isFinite(Number(line.price)) ? Number(line.price) : undefined,
        url: typeof line.url === "string" ? line.url : undefined,
        image: typeof line.image === "string" ? line.image : undefined
      }))
      .filter((line) => line.id && line.title);
  } catch {
    return [];
  }
};

export const writeLocalCartLines = (items) => {
  try {
    localStorage.setItem(LOCAL_CART_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore storage failures
  }
};
