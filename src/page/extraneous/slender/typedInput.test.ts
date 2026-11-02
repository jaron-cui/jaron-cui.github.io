import { translatedBy } from './editing';
import { describeTyped, nextField, TypedInput, typedOffset, typedValue, typeKey } from './typedInput';

const typed = (...keys: string[]) => keys.reduce<TypedInput | null>(typeKey, null);

describe('typed transformation values', () => {
  it('builds a number, flips its sign from anywhere, and allows one point', () => {
    const input = typed('1', '.', '5', '.', '-')!;
    expect(input.fields[0]).toBe('-1.5');
    expect(typedValue(input, 0, 0)).toBe(-1.5);
  });

  it('falls back until there are digits, and gives up the input once erased', () => {
    expect(typedValue(typed('-')!, 0, 1)).toBe(1);
    expect(typed('2', 'Backspace')).toBeNull();
  });

  it('offsets along each world axis when free, and along the lock when locked', () => {
    const input = typeKey(nextField(typed('5')), '3')!;
    expect(typedOffset(input, null)).toEqual({ x: 5, y: 3, z: 0 });
    expect(typedOffset(input, 'z')).toEqual({ x: 0, y: 0, z: 5 });
    expect(typedOffset(input, { x: 0, y: 1, z: 0 })).toEqual({ x: 0, y: 5, z: 0 });
  });

  it('keeps the other fields while erasing one', () => {
    const input = typeKey(nextField(typed('5')), '3')!;
    expect(typeKey(input, 'Backspace')!.fields).toEqual(['5', '', '']);
  });

  it('reads as one value, or as all three with the current one marked', () => {
    expect(describeTyped(typed('9', '0')!, false, '°')).toBe('90°');
    expect(describeTyped(nextField(typed('5')), true)).toBe('X 5  [Y 0]  Z 0');
  });

  it('moves only what is affected', () => {
    const points = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }];
    expect(translatedBy(points, new Set([1]), { x: 2, y: 0, z: 0 })).toEqual([points[0], { x: 3, y: 1, z: 1 }]);
  });
});
