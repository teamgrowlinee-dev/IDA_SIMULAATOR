import { fetchProductCatalog } from "./storefront-tools.js";
import type { ProductDimensionsCm, SimulatorProductMeta } from "../types/simulator.js";

interface CatalogProductLike {
  id: string;
  title: string;
  handle: string;
  categories: string[];
  categorySlugs: string[];
  description: string;
}

const normalizeForMatch = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const DEFAULT_MODEL_GLB = "https://threejs.org/examples/models/gltf/DamagedHelmet/glTF-Binary/DamagedHelmet.glb";

const CATEGORY_DEFAULT_DIMS: Record<string, ProductDimensionsCm> = {
  sofa: { w: 220, d: 95, h: 85 },
  bed: { w: 180, d: 210, h: 95 },
  desk: { w: 140, d: 70, h: 75 },
  table: { w: 160, d: 90, h: 75 },
  chair: { w: 55, d: 55, h: 90 },
  shelf: { w: 90, d: 35, h: 190 },
  cabinet: { w: 100, d: 45, h: 120 },
  lamp: { w: 40, d: 40, h: 150 },
  rug: { w: 200, d: 300, h: 2 },
  decor: { w: 40, d: 40, h: 40 },
  generic: { w: 100, d: 60, h: 90 }
};

const inferCategory = (product: CatalogProductLike): string => {
  const searchable = normalizeForMatch(
    [product.title, ...product.categories, ...product.categorySlugs, product.description].join(" ")
  );

  if (/voodi|voodipeats/.test(searchable)) return "bed";
  if (/diivan|sohva/.test(searchable)) return "sofa";
  if (/kirjutuslaud|toolaud|arvutilaud|desk/.test(searchable)) return "desk";
  if (/soogilaud|laud/.test(searchable)) return "table";
  if (/kontoritool|tool|tugitool|chair/.test(searchable)) return "chair";
  if (/riiul/.test(searchable)) return "shelf";
  if (/kummut|kapp|tv kapp|tvkapp|vitriinkapp/.test(searchable)) return "cabinet";
  if (/lamp|valgusti/.test(searchable)) return "lamp";
  if (/vaip/.test(searchable)) return "rug";
  if (/dekor|aksessuaar|peegel/.test(searchable)) return "decor";
  return "generic";
};

const clampDimension = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const parseDimensions = (product: CatalogProductLike, category: string): ProductDimensionsCm => {
  const searchable = `${product.title} ${product.description}`;
  const sizeMatch = searchable.match(/(\d{2,3})\s*[x×]\s*(\d{2,3})(?:\s*[x×]\s*(\d{2,3}))?/i);
  const fallback = CATEGORY_DEFAULT_DIMS[category] ?? CATEGORY_DEFAULT_DIMS.generic;

  if (!sizeMatch) return fallback;

  const first = Number(sizeMatch[1]);
  const second = Number(sizeMatch[2]);
  const third = Number(sizeMatch[3] ?? NaN);

  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return fallback;
  }

  if (Number.isFinite(third)) {
    return {
      w: clampDimension(first, 25, 500),
      d: clampDimension(second, 20, 400),
      h: clampDimension(third, 10, 320)
    };
  }

  return {
    w: clampDimension(first, 25, 500),
    d: clampDimension(second, 20, 400),
    h: fallback.h
  };
};

const findCatalogProduct = (products: CatalogProductLike[], sku: string): CatalogProductLike | null => {
  const raw = (sku ?? "").trim();
  const normalized = normalizeForMatch(raw);
  if (!raw || !normalized) return null;

  return (
    products.find((product) => product.id === raw) ??
    products.find((product) => product.handle === raw) ??
    products.find((product) => normalizeForMatch(product.handle) === normalized) ??
    products.find((product) => normalizeForMatch(product.title) === normalized) ??
    products.find((product) => normalizeForMatch(product.title).includes(normalized)) ??
    null
  );
};

export const resolveSimulatorProductMeta = async (sku: string): Promise<SimulatorProductMeta | null> => {
  const catalog = (await fetchProductCatalog()) as unknown as CatalogProductLike[];
  const product = findCatalogProduct(catalog, sku);
  if (!product) return null;

  const category = inferCategory(product);
  const dimensions = parseDimensions(product, category);

  return {
    sku: sku.trim(),
    name: product.title,
    category,
    dimensions_cm: dimensions,
    model_glb_url: DEFAULT_MODEL_GLB
  };
};
