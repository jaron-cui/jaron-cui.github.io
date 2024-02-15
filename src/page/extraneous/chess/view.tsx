import * as PIXI from 'pixi.js';
import { useEffect, useRef } from 'react';
import { BoardLocation, BoardSpace, ChessBoard } from './chess';

function frame(x: number, y: number, w: number, h: number) {
  return {
    frame: {x: x, y: y, w: w, h: h},
    spriteSourceSize: {x: 0, y: 0, w: w, h: h},
    sourceSize: {w: w, h: h}
  }
}

const CHESS_PIECE_SCHEMA = {
  frames: {
    pawn: frame(0, 0, 15, 25),
    rook: frame(0, 25, 15, 25),
    knight: frame(0, 50, 15, 25),
    bishop: frame(0, 75, 15, 25),
    queen: frame(0, 100, 15, 25),
    king: frame(0, 125, 15, 25),
  }, meta: {
    image: 'chesspieces2.png',
    format: 'RGBA8888',
    size: {w: 15, h: 25 * 6},
    scale: '1'
  }
}

const TEXTURES: Record<string, PIXI.Texture<PIXI.Resource>> = {};

async function loadTextures() {
  const blackPieceTextures = PIXI.BaseTexture.from(CHESS_PIECE_SCHEMA.meta.image);
  blackPieceTextures.scaleMode = PIXI.SCALE_MODES.NEAREST;
  const blackPieceSpritesheet = new PIXI.Spritesheet(blackPieceTextures, CHESS_PIECE_SCHEMA);
  await blackPieceSpritesheet.parse();
  Object.entries(blackPieceSpritesheet.textures).forEach(([piece, texture]) => {
    TEXTURES['black' + piece] = texture;
  });
  const whitePieceTextures = PIXI.BaseTexture.from('chesspieceswhite.png');
  whitePieceTextures.scaleMode = PIXI.SCALE_MODES.NEAREST;
  const whitePieceSpritesheet = new PIXI.Spritesheet(whitePieceTextures, CHESS_PIECE_SCHEMA);
  await whitePieceSpritesheet.parse();
  Object.entries(whitePieceSpritesheet.textures).forEach(([piece, texture]) => {
    TEXTURES['white' + piece] = texture;
  });
}

function getTexture(name: string) {
  return TEXTURES[name] || PIXI.Texture.EMPTY;
}

class Renderer {
  board: ChessBoard;
  app: PIXI.Application<HTMLCanvasElement>;
  pieceSprites: Map<number, PIXI.Sprite>;
  layers: PIXI.Container[];

  constructor(app: PIXI.Application<HTMLCanvasElement>, board: ChessBoard) {
    this.app = app;
    this.board = board;
    this.pieceSprites = new Map();

    const boardTex = PIXI.BaseTexture.from('chessboard.png');
    boardTex.scaleMode = PIXI.SCALE_MODES.NEAREST;
    const boardSprite = PIXI.Sprite.from(boardTex);
    boardSprite.scale.set(10);
    app.stage.addChild(boardSprite);

    this.layers = [0, 0, 0, 0, 0, 0, 0, 0].map(_ => new PIXI.Container());
    this.app.stage.addChild(...this.layers);
  }

  rerender() {
    // delete all piece sprites
    this.pieceSprites.forEach(sprite => this.app.stage.removeChild(sprite));
    // create piece sprites
    this.pieceSprites = new Map();
    this.board.board.forEach((row, y) => row.forEach((space, x) => {
      if (space.piece) {
        const sprite = PIXI.Sprite.from(getTexture(space.piece.color + (space.piece.name === 'freshPawn' ? 'pawn' : space.piece.name)));
        sprite.anchor.set(0.5, 0.75);
        sprite.scale.set(3.5);
        sprite.x = (x + 0.5) * 50;
        sprite.y = (y + 0.5) * 50;
        const hash = y * 8 + x;
        this.pieceSprites.set(hash, sprite);
        this.layers[y].addChild(sprite);
      }
    }));
  }

  animateMovement(from: [number, number], to: [number, number]) {
    const [fx, fy] = from;
    const [tx, ty] = to;
    const fromHash = fy * 8 + fx;
    const toHash = ty * 8 + tx;
    const sprite = this.pieceSprites.get(fromHash);
    if (!sprite) {
      return;
    }
    this.pieceSprites.delete(fromHash);
    const pieceTaken = this.pieceSprites.get(toHash);
    if (pieceTaken) {
      this.layers[ty].removeChild(pieceTaken);
    }

    this.pieceSprites.set(toHash, sprite);
    this.layers[fy].removeChild(sprite);
    this.layers[ty].addChild(sprite);
    sprite.x = (tx + 0.5) * 50;
    sprite.y = (ty + 0.5) * 50;
  }
}

async function createApp(): Promise<PIXI.Application<HTMLCanvasElement>> {
  const app = new PIXI.Application<HTMLCanvasElement>({ background: '#7acdeb', width: 600, height: 400 });
  // app.renderer.addListener('mousepos', (event: MouseEvent) => console.log(event.clientX));
  let t = 0;
  // Listen for animate update
  app.ticker.minFPS = 40;
  app.ticker.maxFPS = 40;

  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;

  const board = ChessBoard.setBoard();
  await loadTextures();
  const renderer = new Renderer(app, board);
  let selected: BoardLocation | undefined;

  app.stage.addEventListener('click', event => {
    const [x, y]: BoardLocation = [Math.floor(event.screenX / 50), Math.floor(event.screenY / 50)] as BoardLocation;
    if (x < 0 || x >= 8 || y < 0 || y >= 8) {
      return;
    }
    // console.log(selected);
    if (selected) {
      // console.log('moveTo: ' + [x, y]);
      if (ChessBoard.legalMove(board, 'white', selected, [x, y])) {
        // console.log('legal')
        ChessBoard.movePiece(board, selected, [x, y]);
        renderer.animateMovement(selected, [x, y]);
      } else {
        
        // console.log('illegal')
      }
      selected = undefined;
    } else {
      if (board.board[y][x].piece) {
        selected = [x, y];
      }
    }
  })

  renderer.rerender();
  // app.stage.addChild(pawnSprite);

  app.ticker.add(delta => {
    // board.board.forEach((row, y) => row.forEach((space, x) => {
    //   if (space.piece) {
    //     pawnSprite.x = (x + 0.5) * 50;
    //     pawnSprite.y = (y + 0) * 50;
    //   }
    // }))
  });
  return app;
}


export const Chess = () => {
  const gameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const myDomElement = createApp();
    
    myDomElement.then((app) => {
      gameRef.current?.appendChild(app.view);
    });
 
    return () => {
      myDomElement.then((app) => {
        gameRef.current?.removeChild(app.view);
        app.destroy();
      });
    };
  }, []);

  return (
    <div ref={gameRef} onContextMenu={e => e.preventDefault()} onMouseDown={e => e.preventDefault()}>
    </div>
  );
}