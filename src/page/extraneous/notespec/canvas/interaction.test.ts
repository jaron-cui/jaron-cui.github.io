import { Interaction, KeyInput, Modal, PointerInput, Region } from './interaction';

const at = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput => ({ x, y, button: 0, shift: false, ctrl: false, alt: false, ...extra });
const key = (name: string): KeyInput => ({ key: name, code: name, repeat: false, shift: false, ctrl: false, alt: false });

function drawn(interaction: Interaction, regions: Region[]) {
  const frame = interaction.frame();
  regions.forEach(region => frame.region(region));
  interaction.commit(frame);
}

describe('Interaction', () => {
  it('sends a press to the topmost region that takes presses', () => {
    const pressed: string[] = [];
    const interaction = new Interaction();
    drawn(interaction, [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, press: () => { pressed.push('back'); } },
      { rect: { x: 10, y: 10, width: 20, height: 20 }, press: () => { pressed.push('front'); } },
      // On top, but takes no presses.
      { rect: { x: 0, y: 0, width: 100, height: 100 }, key: 'overlay' },
    ]);
    interaction.pointerDown(at(15, 15));
    interaction.pointerUp(at(15, 15));
    interaction.pointerDown(at(50, 50));
    expect(pressed).toEqual(['front', 'back']);
  });

  it('gives a drag the pointer until release, even outside its region', () => {
    const moves: number[] = [];
    let ended = false;
    const interaction = new Interaction();
    drawn(interaction, [{ rect: { x: 0, y: 0, width: 10, height: 10 }, press: () => ({ move: input => moves.push(input.x), end: () => { ended = true; } }) }]);
    interaction.pointerDown(at(5, 5));
    interaction.pointerMove(at(50, 5));
    interaction.pointerMove(at(80, 5));
    interaction.pointerUp(at(80, 5));
    interaction.pointerMove(at(90, 5));
    expect(moves).toEqual([50, 80]);
    expect(ended).toBe(true);
  });

  it('reports every free pointer move', () => {
    let moves = 0;
    const interaction = new Interaction(() => {}, () => { moves++; });
    interaction.pointerMove(at(1, 1));
    interaction.pointerMove(at(2, 1));
    expect(moves).toBe(2);
  });

  it('tracks hover by key', () => {
    const interaction = new Interaction();
    drawn(interaction, [{ rect: { x: 0, y: 0, width: 10, height: 10 }, key: 'note-1', cursor: 'pointer' }]);
    interaction.pointerMove(at(5, 5));
    expect(interaction.hovered).toBe('note-1');
    expect(interaction.cursor()).toBe('pointer');
    interaction.pointerMove(at(50, 50));
    expect(interaction.hovered).toBeNull();
  });

  it('routes everything to a modal operator until it confirms or cancels', () => {
    const log: string[] = [];
    let pressedRegion = false;
    const interaction = new Interaction();
    drawn(interaction, [{ rect: { x: 0, y: 0, width: 100, height: 100 }, press: () => { pressedRegion = true; } }]);
    const modal: Modal = {
      move: input => { log.push(`move ${input.x}`); },
      key: input => (input.key === 'z' ? 'handled' : undefined),
      press: input => (input.button === 0 ? 'confirm' : 'cancel'),
      finish: confirmed => { log.push(confirmed ? 'confirmed' : 'cancelled'); },
    };
    interaction.startModal(modal);
    interaction.pointerMove(at(20, 0));
    expect(interaction.key(key('z'))).toBe(true);
    interaction.pointerDown(at(20, 0));
    expect(log).toEqual(['move 20', 'confirmed']);
    expect(pressedRegion).toBe(false);
    expect(interaction.activeModal).toBeNull();

    interaction.startModal(modal);
    interaction.key(key('Escape'));
    expect(log.at(-1)).toBe('cancelled');
    interaction.startModal(modal);
    interaction.key(key('Enter'));
    expect(log.at(-1)).toBe('confirmed');
  });

  it('cancels a drag on Escape', () => {
    let cancelled = false;
    const interaction = new Interaction();
    drawn(interaction, [{ rect: { x: 0, y: 0, width: 10, height: 10 }, press: () => ({ cancel: () => { cancelled = true; } }) }]);
    interaction.pointerDown(at(5, 5));
    expect(interaction.key(key('Escape'))).toBe(true);
    expect(cancelled).toBe(true);
    expect(interaction.busy).toBe(false);
  });

  it('gives the wheel to the topmost region that uses it', () => {
    const interaction = new Interaction();
    const used: string[] = [];
    drawn(interaction, [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, wheel: () => { used.push('back'); return true; } },
      { rect: { x: 0, y: 0, width: 10, height: 10 }, wheel: () => false },
    ]);
    expect(interaction.wheel({ x: 5, y: 5, deltaX: 0, deltaY: 1, shift: false, ctrl: false, alt: false })).toBe(true);
    expect(used).toEqual(['back']);
  });
});
