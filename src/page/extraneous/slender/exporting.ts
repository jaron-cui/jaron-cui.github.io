import { Color, Scene, Vec2 } from './model';
import { DrawItem, projectScene } from './project';

// How finely curves are flattened, in image units. Exports get viewed zoomed in more than the viewport.
const FLATTENING_TOLERANCE = 0.1;

export type ExportSize = { width: number; height: number };

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function color({ r, g, b }: Pick<Color, 'r' | 'g' | 'b'>): string {
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

function pathData(points: Vec2[], closed: boolean): string {
  const line = points.map(({ x, y }, i) => `${i === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`).join('');
  return closed ? `${line}Z` : line;
}

// Each item as SVG, matching how render.ts draws it: a mesh's border is stroked at twice its width
// and the fill goes over the inner half.
function itemSvg(item: DrawItem): string {
  if (item.kind === 'shape') {
    const d = item.runs.map(({ points, closed }) => pathData(points, closed)).join('');
    const fill = item.fill ? `fill="${color(item.fill)}" fill-opacity="${item.fill.a}"` : 'fill="none"';
    const stroke = item.stroke && item.stroke.width > 0
      ? ` stroke="${color(item.stroke.color)}" stroke-opacity="${item.stroke.color.a}" stroke-width="${round(item.stroke.width)}"`
      : '';
    return `<path d="${d}" ${fill}${stroke}/>`;
  }
  const faces = item.polygons.map(polygon => pathData(polygon, true)).join('');
  const lines = item.lines.map(line => pathData(line, false)).join('');
  const border = item.border && item.border.width > 0
    ? `<path d="${faces}${lines}" fill="none" stroke="${color(item.border.color)}" stroke-width="${round(item.border.width * 2)}" stroke-linejoin="round" stroke-linecap="round"/>`
    : '';
  return `${border}${faces ? `<path d="${faces}" fill="${color(item.fill)}"/>` : ''}`;
}

function frameContent(scene: Scene): string {
  return projectScene(scene, FLATTENING_TOLERANCE).map(itemSvg).join('');
}

function document(size: ExportSize, background: Scene['background'], body: string): string {
  const { width, height } = size;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${-width / 2} ${-height / 2} ${width} ${height}">`
    + `<rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" fill="${color(background)}"/>${body}</svg>`;
}

// One moment as a standalone SVG.
export function svgFrame(scene: Scene, size: ExportSize): string {
  return document(size, scene.background, frameContent(scene));
}

// A looping animation as one standalone SVG. Each frame is its own group that CSS shows for its
// moment, so it stays vector at any size and plays in anything that shows SVG with CSS.
export function svgAnimation(sceneAt: (time: number) => Scene, times: number[], frameRate: number, size: ExportSize): string {
  const frames = times.map((time, i) => (
    `<g style="animation-delay:${Math.round(i / frameRate * 1000) / 1000}s">${frameContent(sceneAt(time))}</g>`
  ));
  const duration = Math.round(times.length / frameRate * 1000) / 1000;
  const style = `<style>g{visibility:hidden;animation:show ${duration}s step-end infinite}`
    + `@keyframes show{0%{visibility:visible}${100 / times.length}%{visibility:hidden}100%{visibility:hidden}}</style>`;
  return document(size, sceneAt(times[0]).background, style + frames.join(''));
}

// The time of each frame from start to end, inclusive.
export function frameTimes(start: number, end: number, frameRate: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => (start + i) / frameRate);
}
