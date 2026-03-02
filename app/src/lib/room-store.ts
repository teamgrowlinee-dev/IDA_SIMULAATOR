import crypto from "node:crypto";
import type { RoomRecord } from "../types/simulator.js";

const rooms = new Map<string, RoomRecord>();

const createRoomId = (): string => {
  const suffix = crypto.randomBytes(4).toString("hex");
  return `room_${Date.now()}_${suffix}`;
};

export const saveRoom = (
  input: Omit<RoomRecord, "id" | "created_at">
): RoomRecord => {
  const record: RoomRecord = {
    ...input,
    id: createRoomId(),
    created_at: new Date().toISOString()
  };
  rooms.set(record.id, record);
  return record;
};

export const getRoomById = (roomId: string): RoomRecord | null =>
  rooms.get(roomId) ?? null;

export const updateRoomVisualRefs = (
  roomId: string,
  visualRefs: RoomRecord["visual_refs"]
): RoomRecord | null => {
  const existing = rooms.get(roomId);
  if (!existing) return null;
  const updated: RoomRecord = {
    ...existing,
    visual_refs: visualRefs
  };
  rooms.set(roomId, updated);
  return updated;
};
