# Style packs

A style pack is plain data that names pieces and gives rules. One pack covers
one region; the era (modernity) and the building type select within it.

```ts
interface StylePack {
  id: string;                       // 'de', 'us'
  version: number;
  palettes: PaletteSet;             // weighted colour lists per role and era
  types: Record<BuildingType, TypeStyle>;
}
interface TypeStyle {
  levelHeight: EraCurve;            // metres as a function of era
  levels: WeightedTable<number>;
  roofShapes: (era) => WeightedTable<RoofShape>;
  roofPitch: EraRange;              // degrees
  overhang: EraRange;               // metres
  bayWidth: EraRange;
  tiles: FacadeTile[];              // see pipeline/04-facade-wfc.md
  sockets: SocketTable;
  trim: TrimStyle;                  // plinth, level bands, corner boards, eaves
  roofDetails: RoofDetailStyle;
  symmetry: number;                 // 0..1 probability of a mirrored street wall
}
```

Types may inherit from another type in the same pack (`garage` and `shed`
inherit palette and trim from `house`), so plots stay consistent.

## Colours

Each role (wall, roof, trim, door, accent) has a list of ten weighted colours
per era band. The caller can replace the lists or pin single colours per
building. Glass is one colour per pack with a slight per-building tint.

## Validation

`registerStylePack` checks: unique tile ids, at most 32 tiles per type, every
socket used is in the table, every type has at least one blank tile and one
tile that fits blocked cells, weights are finite and non-negative.

## Built-in packs

- [de-residential.md](de-residential.md)
- [us-suburban.md](us-suburban.md)
- [non-residential.md](non-residential.md) (shared by both regions with
  regional tweaks)
