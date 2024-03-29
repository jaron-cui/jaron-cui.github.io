import * as PIXI from 'pixi.js';

export enum MouseAction {
  leftclick = 'leftclick',
  rightclick = 'rightclick',
  scrollup = 'scrollup',
  scrolldown = 'scrolldown'
}

export type InputButtonMap<T> = {
  [key in keyof T]: (MouseAction | string | 'any')[];
}

export type ActionMap<T> = {
  [key in keyof T]: (pressed: boolean, inputState: InputState<T>) => void;
}

export type InputState<T> = {
  buttons: {
    [key in keyof T]: boolean;
  };
  cursorPosition: [number, number];
}

export interface InputController<T> {
  inputButtonMap: InputButtonMap<T>;
  actions: ActionMap<T>;
  onType?: (key: string, inputState: InputState<T>) => void;
  onPointerMove?: (inputState: InputState<T>) => void;
  inputState: InputState<T>;
  enabled: boolean;
}

interface FrameInputs {
  previousPressedButtons: Set<string>;
  previousMousePosition: [number, number];
  buttonChanges: Map<string, boolean[]>;
  newMousePosition: [number, number];
}

export class InputHandler {
  app: PIXI.Application<HTMLCanvasElement>
  handlers: [any, string, (event: any) => void][];
  // triggers: InputTriggers;
  inputListenerSets: InputController<any>[];

  frameInputs: FrameInputs;

  constructor(app: PIXI.Application<HTMLCanvasElement>) {
    this.app = app;
    this.handlers = [];
    this.inputListenerSets = [];

    this.frameInputs = {
      previousPressedButtons: new Set(),
      previousMousePosition: [0, 0],
      buttonChanges: new Map(),
      newMousePosition: [0, 0]
    }
    this.initializeHandlers();
  }

  cycleFrameInputs() {
    // update mouse position
    const [x0, y0] = this.frameInputs.previousMousePosition;
    const [x1, y1] = this.frameInputs.newMousePosition;
    this.inputListenerSets.forEach(controller => {
      (x0 === x1 && y0 === y1) || (controller.onPointerMove && controller.onPointerMove(controller.inputState));
      controller.inputState.cursorPosition = this.frameInputs.newMousePosition;
    });
    // cycle mouse position
    this.frameInputs.previousMousePosition = this.frameInputs.newMousePosition;
    for (let [button, states] of this.frameInputs.buttonChanges) {
      // pull out actions bound to this button
      const actions: [string, InputState<any>, (pressed: boolean, input: InputState<any>) => void][] = [];
      this.inputListenerSets.forEach(controller => {
        // find matching actions based on keybinds
        controller.enabled && Object.entries(controller.inputButtonMap).forEach(([binding, boundButtons]) => {
          boundButtons.forEach(boundButton => {
            if (boundButton.toLowerCase() === button.toLowerCase() || boundButton === 'any') {
              actions.push([binding, controller.inputState, controller.actions[binding]]);
            }
          });
        });
      });

      // activate buttons each time the state changes
      let previous = this.frameInputs.previousPressedButtons.has(button);
      states.forEach(state => {
        if (state !== previous) {
          actions.forEach(([binding, input, action]) => {
            input.buttons[binding] = state;
            action(state, input);
          });
        }
        previous = state;
      });
      // roll over last input state
      if (states[states.length - 1]) {
        this.frameInputs.previousPressedButtons.add(button);
      } else {
        this.frameInputs.previousPressedButtons.delete(button);
      }
      // empty out button changes
      this.frameInputs.buttonChanges = new Map();
    }
  }

  private cacheInput(button: string, down: boolean) {
    let list = this.frameInputs.buttonChanges.get(button);
    if (list === undefined) {
      this.frameInputs.buttonChanges.set(button, [down]);
    } else {
      list.push(down);
    }
  }

  registerInputListeners(inputListenerSet: InputController<any>) {
    this.inputListenerSets.push(inputListenerSet);
  }

  processInput() {
    this.cycleFrameInputs();
  }

  // TODO: maybe perform grouping so that each controller isn't fully iterated through for every input
  private initializeHandlers() {
    this.clearHandlers();

    const clickHandler = (clickType: 'leftclick' | 'rightclick', down: boolean) => () => this.cacheInput(clickType, down);
    const leftClick = clickHandler('leftclick', true);
    const leftUnClick = clickHandler('leftclick', false);
    const rightClick = clickHandler('rightclick', true);
    const rightUnClick = clickHandler('rightclick', false);
    const keyHandler = (down: boolean) => (event: KeyboardEvent) => {
      this.cacheInput(event.key, down);
      this.inputListenerSets.forEach(controller => {
        // TODO: probably move this into the proper typing handler...
        if (!down) {
          controller.enabled && controller.onType && controller.onType(event.key, controller.inputState);
        }
      });
    }
    const keyDown = keyHandler(true);
    const keyUp = keyHandler(false);

    const scroll = (event: WheelEvent) => {
      const scroll = Math.sign(event.deltaY) > 0 ? MouseAction.scrollup : MouseAction.scrolldown;
      this.cacheInput(scroll, true);
      this.cacheInput(scroll, false);
    };
    const mouseMove = (event: MouseEvent) => {
      this.frameInputs.newMousePosition = [event.screenX, event.screenY];
    };

    this.app.stage.addEventListener('mousedown', leftClick);
    this.app.stage.addEventListener('mouseup', leftUnClick);
    this.app.stage.addEventListener('rightdown', rightClick);
    this.app.stage.addEventListener('rightup', rightUnClick);
    this.app.stage.addEventListener('wheel', scroll);
    this.app.stage.addEventListener('mousemove', mouseMove);
    document.addEventListener('keydown', keyDown);
    document.addEventListener('keyup', keyUp);

    this.handlers.push([this.app.stage, 'mousedown', leftClick]);
    this.handlers.push([this.app.stage, 'mouseup', leftUnClick]);
    this.handlers.push([this.app.stage, 'rightdown', rightClick]);
    this.handlers.push([this.app.stage, 'rightup', rightUnClick]);
    this.handlers.push([this.app.stage, 'wheel', scroll]);
    this.handlers.push([this.app.stage, 'mousemove', mouseMove]);
    this.handlers.push([document, 'keydown', keyDown]);
    this.handlers.push([document, 'keyup', keyUp]);
  }

  clearHandlers() {
    this.handlers.forEach(([container, trigger, handler]) => container.removeEventListener(trigger, handler));
    this.handlers = [];
  }
}