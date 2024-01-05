import * as PIXI from 'pixi.js';
import { useEffect, useRef } from 'react';

enum Block {
  Air, Grass, Grasses, Stone, Soil, Placeholder
};

// represents a 2D grid-based terrain
class Terrain {
  blocks: Uint8Array;
  w: number;
  h: number;
  constructor(width: number, height: number) {
    this.blocks = new Uint8Array(width * height);
    this.w = width;
    this.h = height;
  }
  
  at(x: number, y: number) {
    return this.blocks[y * this.w + x];
  }

  set(x: number, y: number, value: number) {
    this.blocks[y * this.w + x] = value;
  }
}

const BLOCK_TEXTURE_SCHEMA = {
  frames: {
    0: {
      frame: { x: 0, y: 0, w: 8, h: 8 },
      sourceSize: { w: 8, h: 8 },
      spriteSourceSize: { x: 0, y: 0, w: 8, h: 8 }
    }
  },
  meta: {
    image: 'blocks.png',
    format: 'RGBA8888',
    size: { w: 8, h: 16 },
    scale: 2
  }
};


// Create the SpriteSheet from data and image
const spritesheet = new PIXI.Spritesheet(
  PIXI.BaseTexture.from(BLOCK_TEXTURE_SCHEMA.meta.image),
  BLOCK_TEXTURE_SCHEMA
);

// Generate all the Textures asynchronously
spritesheet.parse().then(() => {
  console.log('done');
  // Create a new Sprite from the Texture
  const block = new PIXI.Sprite(spritesheet.textures['0']);
  block.scale.set(2);
  block.x = 0;
  block.y = 0;
  //app.stage.addChild(block);
});

// const shader = PIXI.Shader.from(`
//   precision mediump float;
//   void main() {
//       // Vertex shader output
//       gl_Position = vec4(position, 0.0, 1.0);
//   }`, `
//   precision mediump float;
//   //attribute vec2 position;
//   //varying vec2 vUvs;

//   //uniform sampler2D uSampler2;

//   void main() {
//     //gl_Position = vec4(position, 0.0, 0.0);
//     gl_FragColor = vec4(position, 0.0, 1.0);
//   }

// `,
// {
//     //uSampler2: PIXI.Texture.from('blocks.png'),
// });

// const geometry = new PIXI.Geometry()
//     .addAttribute('position', [-100, -100, // x, y
//     100, -100, // x, y
//     100, 100,
//     -100, 100], 2);

//     const tileMesh = new PIXI.Mesh(geometry, shader);
const geometry = new PIXI.Geometry()
    .addAttribute('aVertexPosition', // the attribute name
        [-1, -1, // x, y
            1, -1, // x, y
            1, 1,
            -1, 1], // x, y
        2) // the size of the attribute
    .addAttribute('aUvs', // the attribute name
        [0, 0, // u, v
            1, 0, // u, v
            1, 1,
            0, 1], // u, v
        2) // the size of the attribute
    .addIndex([0, 1, 2, 0, 2, 3]);

const vertexSrc = `

    precision mediump float;

    attribute vec2 aVertexPosition;
    attribute vec2 aUvs;

    varying vec2 vUvs;
    varying vec2 vPos;

    void main() {

        vUvs = aUvs;
        gl_Position = vec4(aVertexPosition, 0.0, 1.0);
        vPos = gl_Position.xy;
    }`;

const fragmentSrc = `
//Based on this: https://www.shadertoy.com/view/wtlSWX
precision mediump float;

varying vec2 vUvs;
varying vec2 vPos;

uniform sampler2D uBlockTextures;
uniform int uBlockSize;

uniform vec2 uScreenSize;
uniform vec2 uBlockOffset;
uniform vec2 uGridSize;

uniform int uBlockTypes;
uniform sampler2D uTerrain;

uniform int wind;

void main() {
  vec2 pixelPos = ((vPos + 1.0) * 0.5) * uScreenSize;
  //pixelPos = vec2(pixelPos.x, uScreenSize.y - pixelPos.y);

  vec2 relativePos = pixelPos - uBlockOffset;
  vec2 blockPos = relativePos / float(uBlockSize);
  vec2 c = floor(blockPos);
  if (c.x < 0.0 || c.x >= uGridSize.x || c.y < 0.0 || c.y >= uGridSize.y) {
    discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  int blockType = int(255.0 * texture2D(uTerrain, c / uGridSize).a);
  int textureVariant = blockType == 1 || blockType == 2 ? wind + 2 : 0;
  if (blockType == 0) {
    discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 subTextureOffset = blockPos - c;

  vec2 textureOffset = vec2((subTextureOffset.x + float(textureVariant)) / 5.0, (1.0 - subTextureOffset.y + float(blockType - 1)) / float(uBlockTypes));

    gl_FragColor = vec4(texture2D(uBlockTextures, textureOffset));
}`;

const WORLD_WIDTH = 48;
const WORLD_HEIGHT = 20;
const world = new Terrain(WORLD_WIDTH, WORLD_HEIGHT);
for (let x = 0; x < WORLD_WIDTH; x += 1) {
  for (let y = 0; y < WORLD_HEIGHT; y += 1) {
    if (y < 15) {
      world.set(x, y, Block.Stone);
    } else if (y < 16) {
      world.set(x, y, Block.Grass);
    } else if (y < 17) {
      world.set(x, y, Block.Grasses);
    } else {
      world.set(x, y, Block.Air);
    }
  }
}
const worldData = PIXI.BaseTexture.fromBuffer(world.blocks, world.w, world.h, { format: PIXI.FORMATS.ALPHA, type: PIXI.TYPES.UNSIGNED_BYTE });
worldData.wrapMode = PIXI.WRAP_MODES.CLAMP;
worldData.mipmap = PIXI.MIPMAP_MODES.OFF;
worldData.scaleMode = PIXI.SCALE_MODES.NEAREST;

const SCREEN_WIDTH = 960;
const SCREEN_HEIGHT = 540;
const BLOCK_TEXTURES = PIXI.Texture.from('blocks2.png');
BLOCK_TEXTURES.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
const uniforms = {
  uBlockTextures: BLOCK_TEXTURES,
  uScreenSize: [SCREEN_WIDTH, SCREEN_HEIGHT],
  uBlockOffset: [0, 0],
  uGridSize: [WORLD_WIDTH, WORLD_HEIGHT],
  uBlockSize: 20,
  uBlockTypes: Object.keys(Block).length / 2 - 1,
  uTerrain: worldData,
  wind: 0
};
// Build the shader and the quad.
const shader = PIXI.Shader.from(vertexSrc, fragmentSrc, uniforms);
const quad = new PIXI.Mesh(geometry, shader);

quad.position.set(0, 0);
quad.scale.set(2);

function createApp() {
  const app = new PIXI.Application<HTMLCanvasElement>({ background: '#1099bb', width: SCREEN_WIDTH, height: SCREEN_HEIGHT });

  app.stage.addChild(quad);
  let t = 0;
  // Listen for animate update
  app.ticker.minFPS = 40;
  app.ticker.maxFPS = 40;
  app.ticker.add((delta: number) => {
    t += 1;
    quad.shader.uniforms.wind = Math.sin(t / 30) * 2.2;
  });
  return app;
};

export const Rect = () => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const myDomElement = createApp().view;

    if (ref.current) {
      ref.current.appendChild(myDomElement);
    }
  }, []);

  return <div ref={ref}></div>;
}