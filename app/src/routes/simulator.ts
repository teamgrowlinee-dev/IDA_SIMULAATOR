import { Router } from "express";
import { z } from "zod";
import { getRoomById, saveRoom, updateRoomVisualRefs } from "../lib/room-store.js";
import type { RoomRecord } from "../types/simulator.js";
import { resolveSimulatorProductMeta } from "../services/simulator-product.js";

const router = Router();

const wallSchema = z.enum(["north", "east", "south", "west"]);

const roomOpeningSchema = z.object({
  type: z.literal("door"),
  wall: wallSchema,
  offset_cm: z.number().min(0).max(100_000),
  width_cm: z.number().min(40).max(300),
  height_cm: z.number().min(160).max(320).optional()
});

const roomObstacleSchema = z.object({
  type: z.literal("box"),
  label: z.string().max(120).optional(),
  x_cm: z.number().min(0).max(100_000),
  z_cm: z.number().min(0).max(100_000),
  width_cm: z.number().min(1).max(20_000),
  depth_cm: z.number().min(1).max(20_000),
  height_cm: z.number().min(1).max(1_000).optional()
});

const roomVisualRefSchema = z.object({
  type: z.literal("image"),
  url: z.string().min(1).max(2_000)
});

const roomCreateSchema = z.object({
  shape: z.literal("rect"),
  width_cm: z.number().min(120).max(20_000),
  length_cm: z.number().min(120).max(20_000),
  height_cm: z.number().min(180).max(1_000).optional(),
  openings: z.array(roomOpeningSchema).max(20).default([]),
  obstacles: z.array(roomObstacleSchema).max(80).default([]),
  visual_refs: z.array(roomVisualRefSchema).max(20).default([])
});

router.post("/rooms", (req, res) => {
  const parsed = roomCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid room payload", issues: parsed.error.issues });
    return;
  }

  const room = saveRoom({
    ...parsed.data,
    openings: parsed.data.openings ?? [],
    obstacles: parsed.data.obstacles ?? [],
    visual_refs: parsed.data.visual_refs ?? []
  });

  res.status(201).json({
    roomId: room.id,
    room
  });
});

router.get("/rooms/:id", (req, res) => {
  const roomId = String(req.params.id ?? "").trim();
  const room = getRoomById(roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json(room);
});

const uploadSchema = z.object({
  roomId: z.string().min(1),
  refs: z.array(roomVisualRefSchema).max(20)
});

router.post("/uploads", (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid upload payload", issues: parsed.error.issues });
    return;
  }

  const room = getRoomById(parsed.data.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const deduped: RoomRecord["visual_refs"] = [];
  const seen = new Set<string>();
  for (const ref of [...room.visual_refs, ...parsed.data.refs]) {
    if (seen.has(ref.url)) continue;
    seen.add(ref.url);
    deduped.push(ref);
  }

  const updated = updateRoomVisualRefs(room.id, deduped);
  res.json({
    ok: true,
    roomId: room.id,
    visual_refs: updated?.visual_refs ?? deduped
  });
});

router.get("/products/:sku", async (req, res) => {
  try {
    const sku = String(req.params.sku ?? "").trim();
    if (!sku) {
      res.status(400).json({ error: "sku is required" });
      return;
    }

    const product = await resolveSimulatorProductMeta(sku);
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    res.json(product);
  } catch (error) {
    console.error("[simulator/products] error:", error);
    res.status(500).json({ error: "Product meta lookup failed" });
  }
});

export default router;
