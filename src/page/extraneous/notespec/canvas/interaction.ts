// A small interaction layer for canvas UIs, independent of the DOM so it can be tested.
//
// Drawing code records hit regions as it draws (`Frame.region`), so what can be hit is always what
// was drawn, in the same order: later regions are on top. `Interaction` routes input:
//
// - A modal operator (G, B), while one runs, gets every pointer move, press and key, and ends with
//   a confirm or a cancel.
// - Otherwise a press goes to the topmost region under the pointer that takes presses. It may
//   return a drag, which then gets the pointer until release (pointer capture).
// - Moves update which region is hovered, by key, so drawing can highlight it.

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Modifiers = { shift: boolean; ctrl: boolean; alt: boolean };
export type PointerInput = Point & Modifiers & { button: number };
export type KeyInput = Modifiers & { key: string; code: string; repeat: boolean };
export type WheelInput = Point & Modifiers & { deltaX: number; deltaY: number };

export type Drag = {
  move?(input: PointerInput): void;
  end?(input: PointerInput): void;
  cancel?(): void;
};

export type Region = {
  rect: Rect;
  // Names the region across frames, for hover.
  key?: string;
  cursor?: string;
  // A press on the region; return a drag to follow the pointer until release.
  press?(input: PointerInput): Drag | void;
  // Wheel turns over the region; return true if used.
  wheel?(input: WheelInput): boolean;
};

export type ModalResult = 'confirm' | 'cancel' | 'handled' | void;

export type Modal = {
  // Shown in the status bar while the operator runs.
  describe?(): string;
  cursor?: string;
  move?(input: PointerInput): void;
  press?(input: PointerInput): ModalResult;
  release?(input: PointerInput): ModalResult;
  key?(input: KeyInput): ModalResult;
  wheel?(input: WheelInput): ModalResult;
  // Called once when the operator ends.
  finish?(confirmed: boolean): void;
};

export const contains = (rect: Rect, { x, y }: Point) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;

// The regions drawn in one frame.
export class Frame {
  readonly regions: Region[] = [];

  constructor(readonly hovered: string | null) {}

  region(region: Region): Region {
    this.regions.push(region);
    return region;
  }

  isHovered(key: string): boolean {
    return this.hovered === key;
  }
}

export class Interaction {
  private regions: Region[] = [];
  private drag: Drag | null = null;
  private modal: Modal | null = null;
  pointer: Point = { x: 0, y: 0 };
  hovered: string | null = null;

  // `changed` is called whenever something drawing depends on changes (hover, modal state).
  constructor(private readonly changed: () => void = () => {}) {}

  // A new frame; its regions replace the last frame's once it has been drawn.
  frame(): Frame {
    return new Frame(this.hovered);
  }

  commit(frame: Frame) {
    this.regions = frame.regions;
    this.updateHover();
  }

  hit(point: Point, accepts: (region: Region) => boolean = () => true): Region | null {
    for (let i = this.regions.length - 1; i >= 0; i--) {
      if (contains(this.regions[i].rect, point) && accepts(this.regions[i])) {
        return this.regions[i];
      }
    }
    return null;
  }

  get activeModal(): Modal | null {
    return this.modal;
  }

  get busy(): boolean {
    return this.modal !== null || this.drag !== null;
  }

  cursor(): string {
    if (this.modal) {
      return this.modal.cursor ?? 'default';
    }
    return this.hit(this.pointer, region => region.cursor !== undefined)?.cursor ?? 'default';
  }

  startModal(modal: Modal) {
    this.cancelDrag();
    this.endModal(false);
    this.modal = modal;
    this.changed();
  }

  endModal(confirmed: boolean) {
    const modal = this.modal;
    if (modal) {
      this.modal = null;
      modal.finish?.(confirmed);
      this.changed();
    }
  }

  private resolve(result: ModalResult): boolean {
    if (result === 'confirm' || result === 'cancel') {
      this.endModal(result === 'confirm');
    }
    return result !== undefined;
  }

  pointerDown(input: PointerInput) {
    this.pointer = input;
    if (this.modal) {
      this.resolve(this.modal.press?.(input));
      return;
    }
    const region = this.hit(input, other => other.press !== undefined);
    const drag = region?.press?.(input);
    this.drag = drag ?? null;
    this.changed();
  }

  pointerMove(input: PointerInput) {
    this.pointer = input;
    if (this.modal) {
      this.modal.move?.(input);
      this.changed();
      return;
    }
    if (this.drag) {
      this.drag.move?.(input);
      this.changed();
      return;
    }
    this.updateHover();
  }

  pointerUp(input: PointerInput) {
    this.pointer = input;
    if (this.modal) {
      this.resolve(this.modal.release?.(input));
      return;
    }
    const drag = this.drag;
    this.drag = null;
    drag?.end?.(input);
    this.changed();
  }

  // Returns true if the key was used, so the caller can skip its own shortcuts.
  key(input: KeyInput): boolean {
    if (this.modal) {
      const result = this.modal.key?.(input);
      if (result === undefined && input.key === 'Escape') {
        this.endModal(false);
        return true;
      }
      if (result === undefined && input.key === 'Enter') {
        this.endModal(true);
        return true;
      }
      this.resolve(result);
      this.changed();
      return true;
    }
    if (this.drag && input.key === 'Escape') {
      this.cancelDrag();
      return true;
    }
    return false;
  }

  wheel(input: WheelInput): boolean {
    if (this.modal) {
      return this.resolve(this.modal.wheel?.(input));
    }
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const region = this.regions[i];
      if (region.wheel && contains(region.rect, input) && region.wheel(input)) {
        this.changed();
        return true;
      }
    }
    return false;
  }

  cancelDrag() {
    const drag = this.drag;
    this.drag = null;
    drag?.cancel?.();
  }

  private updateHover() {
    const hovered = this.drag || this.modal ? this.hovered : this.hit(this.pointer, region => region.key !== undefined)?.key ?? null;
    if (hovered !== this.hovered) {
      this.hovered = hovered;
      this.changed();
    }
  }
}
