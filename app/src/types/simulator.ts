export type RoomShape = "rect";
export type RoomWall = "north" | "east" | "south" | "west";

export interface RoomOpening {
  type: "door";
  wall: RoomWall;
  offset_cm: number;
  width_cm: number;
  height_cm?: number;
}

export interface RoomObstacle {
  type: "box";
  label?: string;
  x_cm: number;
  z_cm: number;
  width_cm: number;
  depth_cm: number;
  height_cm?: number;
}

export interface RoomVisualRef {
  type: "image";
  url: string;
}

export interface RoomRecord {
  id: string;
  shape: RoomShape;
  width_cm: number;
  length_cm: number;
  height_cm?: number;
  openings: RoomOpening[];
  obstacles: RoomObstacle[];
  visual_refs: RoomVisualRef[];
  created_at: string;
}

export interface ProductDimensionsCm {
  w: number;
  d: number;
  h: number;
}

export interface SimulatorProductMeta {
  sku: string;
  name: string;
  category: string;
  dimensions_cm: ProductDimensionsCm;
  model_glb_url: string | null;
}
