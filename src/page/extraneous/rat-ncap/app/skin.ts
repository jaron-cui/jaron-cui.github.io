/**
 * A skinned rat mesh for the Slender renderer: loads a GLB exported from the rat's Blender rig
 * (joints named after MuJoCo bodies, inverse bind matrices from the bind pose, up to 8 influences
 * per vertex), skins it on the CPU from the simulated body poses, and turns it into flat vrender
 * meshes, one per mesh node and material.
 */
import type { Face, MeshNode, Rgb } from '../../../../lib/vrender/model';
import { fixed } from '../../../../lib/vrender/model';

const MM = 1000;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const INFLUENCES = 8;
const BORDER = { color: { r: 0.1, g: 0.11, b: 0.13, a: 1 }, width: 1.2 };

/** One flat-coloured piece: a mesh node's triangles of one material. */
type Piece = { name: string; fill: Rgb; faces: Face[]; vertices: number[] };

export type Skin = {
  positions: Float32Array;  // Bind-pose vertices (m).
  joints: Uint16Array;  // INFLUENCES joint indices per vertex.
  weights: Float32Array;  // INFLUENCES weights per vertex.
  jointBody: number[];  // MuJoCo body of each joint.
  ibm: Float32Array;  // Inverse bind matrices, column-major 4x4 per joint.
  pieces: Piece[];
};

const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** Reads a skin GLB; `bodyNames` maps its joints to MuJoCo bodies. Materials named in `skip` are left out. */
export async function loadSkin(url: string, bodyNames: string[], skip = new Set(['whisker'])): Promise<Skin> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const buf = await response.arrayBuffer();
  const jsonLength = new DataView(buf).getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLength)));
  const binStart = 20 + jsonLength + 8;
  const read = (index: number): Float32Array | Uint16Array | Uint8Array => {
    const accessor = json.accessors[index];
    const view = json.bufferViews[accessor.bufferView];
    const components = ({ SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[accessor.type];
    const offset = binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const n = accessor.count * components;
    switch (accessor.componentType) {
      case 5126: return new Float32Array(buf.slice(offset, offset + 4 * n));
      case 5123: return new Uint16Array(buf.slice(offset, offset + 2 * n));
      case 5121: return new Uint8Array(buf.slice(offset, offset + n));
    }
    throw new Error(`Unsupported glTF component type ${accessor.componentType}`);
  };
  const skin = json.skins[0];
  const jointBody = skin.joints.map((node: number) => {
    const body = bodyNames.indexOf(json.nodes[node].name);
    if (body < 0) throw new Error(`The skin's joint ${json.nodes[node].name} is not a body of the model.`);
    return body;
  });
  const positions: number[] = [], joints: number[] = [], weights: number[] = [];
  const bases = new Map<number, number>();  // POSITION accessor -> its first vertex
  const pieces: Piece[] = [];
  for (const node of json.nodes) {
    if (node.mesh === undefined) continue;
    for (const primitive of json.meshes[node.mesh].primitives) {
      const a = primitive.attributes;
      let base = bases.get(a.POSITION);
      if (base === undefined) {
        base = positions.length / 3;
        bases.set(a.POSITION, base);
        positions.push(...read(a.POSITION));
        const sets = [[a.JOINTS_0, a.WEIGHTS_0], [a.JOINTS_1, a.WEIGHTS_1]].filter(([j]) => j !== undefined).map(([j, w]) => [read(j), read(w)]);
        const count = read(a.POSITION).length / 3;
        for (let v = 0; v < count; v++) {
          for (let s = 0; s < INFLUENCES / 4; s++) {
            const set = sets[s];
            for (let k = 0; k < 4; k++) {
              joints.push(set ? set[0][4 * v + k] : 0);
              weights.push(set ? set[1][4 * v + k] : 0);
            }
          }
        }
      }
      const material = json.materials[primitive.material];
      if (skip.has(material.name)) continue;
      const [r, g, b] = material.pbrMetallicRoughness.baseColorFactor;
      const indices = read(primitive.indices);
      const local = new Map<number, number>();
      const vertices: number[] = [];
      const faces: Face[] = [];
      for (let t = 0; t < indices.length; t += 3) {
        faces.push([0, 1, 2].map(k => {
          const v = base! + indices[t + k];
          let l = local.get(v);
          if (l === undefined) {
            l = vertices.length;
            local.set(v, l);
            vertices.push(v);
          }
          return l;
        }));
      }
      pieces.push({ name: `${node.name}/${material.name}`, fill: { r: toSrgb(r), g: toSrgb(g), b: toSrgb(b) }, faces, vertices });
    }
  }
  return {
    positions: Float32Array.from(positions), joints: Uint16Array.from(joints), weights: Float32Array.from(weights),
    jointBody, ibm: read(skin.inverseBindMatrices) as Float32Array, pieces,
  };
}

/**
 * The skin posed by body world poses (positions [nbody*3] in m, row-major rotations [nbody*9]), as
 * vrender meshes in mm. Each joint's matrix is its body's pose times its inverse bind matrix.
 * `outline`: the whole skin as one unfilled mesh, so only the rat's outer outline draws.
 */
export function skinNodes(skin: Skin, xpos: ArrayLike<number>, xmat: ArrayLike<number>, outline = false): MeshNode[] {
  const nj = skin.jointBody.length;
  const M = new Float64Array(12 * nj);  // Row-major 3x4 per joint, in mm.
  for (let j = 0; j < nj; j++) {
    const b = skin.jointBody[j];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += xmat[9 * b + 3 * r + k] * skin.ibm[16 * j + 4 * c + k];
        if (c === 3) s += xpos[3 * b + r];
        M[12 * j + 4 * r + c] = MM * s;
      }
    }
  }
  const world = new Float32Array(skin.positions.length);
  const P = skin.positions, J = skin.joints, W = skin.weights;
  for (let v = 0; v < P.length / 3; v++) {
    const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
    let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < INFLUENCES; k++) {
      const w = W[INFLUENCES * v + k];
      if (w === 0) continue;
      const m = 12 * J[INFLUENCES * v + k];
      ox += w * (M[m] * x + M[m + 1] * y + M[m + 2] * z + M[m + 3]);
      oy += w * (M[m + 4] * x + M[m + 5] * y + M[m + 6] * z + M[m + 7]);
      oz += w * (M[m + 8] * x + M[m + 9] * y + M[m + 10] * z + M[m + 11]);
    }
    world[3 * v] = ox;
    world[3 * v + 1] = oy;
    world[3 * v + 2] = oz;
  }
  const node = (name: string, vertices: number[], faces: Face[], fill: Rgb, filled = true): MeshNode => ({
    kind: 'mesh',
    name,
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    worldMatrix: fixed(IDENTITY),
    vertices: vertices.map(v => ({ x: world[3 * v], y: world[3 * v + 1], z: world[3 * v + 2] })),
    faces: fixed(faces),
    edges: fixed([]),
    ...(filled ? {} : { filled: false }),
    fill,
    border: BORDER,
  });
  if (outline) {
    // Every piece's triangles over the skin's own vertices, as one mesh.
    const faces = skin.pieces.flatMap(piece => piece.faces.map(face => face.map(i => piece.vertices[i])));
    const all = Array.from({ length: P.length / 3 }, (_, v) => v);
    return [node('skin', all, faces, skin.pieces[0]?.fill ?? { r: 0, g: 0, b: 0 }, false)];
  }
  return skin.pieces.map(piece => node(piece.name, piece.vertices, piece.faces, piece.fill));
}
