import type { CellInputs } from './inputs';

export type TileRequest =
  | { kind: 'terrain'; id: number; tx: number; ty: number; grid: number }
  | { kind: 'paint'; id: number; tx: number; ty: number; texSize: number }
  | { kind: 'detail'; id: number; tx: number; ty: number }
  | { kind: 'far'; id: number; z: number; x: number; y: number; grid: number };

export interface BridgeData {
  /** x, n, deck height triples in tile-local metres. */
  pts: number[];
  width: number;
  rail: boolean;
}

export interface TerrainResult {
  kind: 'terrain';
  id: number;
  /** (grid+1)^2 heights, row 0 = north edge, column 0 = west edge. */
  heights: Float32Array;
  grid: number;
}

export interface PaintResult {
  kind: 'paint';
  id: number;
  bitmap: ImageBitmap;
}

export interface DetailResult {
  kind: 'detail';
  id: number;
  cells: CellInputs[];
  /** x, n, ground height, scale per tree, tile-local. */
  trees: Float32Array;
  bridges: BridgeData[];
}

export interface FarResult {
  kind: 'far';
  id: number;
  heights: Float32Array;
  grid: number;
}

export interface ErrorResult {
  kind: 'error';
  id: number;
  message: string;
}

export type TileResponse = TerrainResult | PaintResult | DetailResult | FarResult | ErrorResult;
