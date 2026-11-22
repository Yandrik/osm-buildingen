/**
 * Dev tool: passages (roads through buildings) from the angles that show mistakes.
 * `pnpm exec tsx tools/passages.ts <outdir> [scene...]`
 *
 * Per scene, close-ups of the passages along the road at eye level (you must see
 * through), from the other end and obliquely from three sides, plus the
 * whole building from above. The renderer culls back faces, so a wrongly wound or
 * missing face shows as a hole.
 */
import { mkdirSync } from 'node:fs';
import { type BuildingMesh, generateBuilding } from '../packages/core/src';
import { PASSAGE_SCENES } from '../packages/core/test/passageScenes';
import { save } from './render';

const [out = 'renders', ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

for (const scene of PASSAGE_SCENES) {
  if (only.length > 0 && !only.includes(scene.name)) continue;
  const mesh = generateBuilding(scene.input);
  const line = scene.clear[0] ?? scene.solid[0];
  if (!line) continue;
  // Azimuth 0 looks north; the camera looks along the line from its start.
  const axis = (Math.atan2(line[1][0] - line[0][0], line[1][1] - line[0][1]) * 180) / Math.PI;
  const parts = mesh.debug?.parts ?? (mesh.debug ? [mesh.debug] : []);
  const found = parts.flatMap((p) => p.passages);
  // The renderer frames `bounds`, so narrowing them to the passages zooms in on these.
  const points = found.length > 0 ? found.flatMap((p) => p.polygon) : [line[0], line[1]];
  const m = 3.5;
  const close: BuildingMesh = {
    ...mesh,
    bounds: {
      min: [Math.min(...points.map((p) => p[0])) - m, 0, Math.min(...points.map((p) => -p[1])) - m],
      max: [Math.max(...points.map((p) => p[0])) + m, 6, Math.max(...points.map((p) => -p[1])) + m],
    },
  };
  const views: [string, BuildingMesh, number, number][] = [
    ['along', close, axis, 4],
    ['back', close, axis + 180, 4],
    ['left', close, axis - 50, 10],
    ['right', close, axis + 50, 10],
    ['rear', close, axis + 140, 12],
    ['above', mesh, axis + 25, 50],
  ];
  for (const [name, item, azimuth, elevation] of views) {
    save(`${out}/${scene.name}-${name}.png`, [{ mesh: item, x: 0, z: 0 }], {
      azimuth,
      elevation,
      width: 900,
      height: 600,
    });
  }
  const notes = parts.flatMap((p) => p.spec.notes);
  console.log(
    `${scene.name}: ${found.length} passage(s)${found
      .map(
        (p) =>
          ` [clear ${p.clearHeight.toFixed(2)} m, ${p.openings
            .map((o) => `wall ${o.wall} ${o.from.toFixed(2)}..${o.to.toFixed(2)}`)
            .join(', ')}]`,
      )
      .join('')}${notes.length > 0 ? ` notes: ${notes.join('; ')}` : ''}`,
  );
}
