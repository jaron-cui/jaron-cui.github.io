// A number typed during a move, as in Blender: G then 2 moves by two beats. Adapted from Slender
// (slender/typedInput.ts), which has a field per axis; a move here only ever needs one number.
export type TypedInput = { text: string };

export function isTypedKey(key: string): boolean {
  return /^[0-9.-]$/.test(key) || key === 'Backspace';
}

// The input after a key. Erasing the last character gives the move back to the pointer.
export function typeKey(input: TypedInput | null, key: string): TypedInput | null {
  const text = input?.text ?? '';
  let next: string;
  if (key === 'Backspace') {
    next = text.slice(0, -1);
  } else if (key === '-') {
    next = text.startsWith('-') ? text.slice(1) : `-${text}`;
  } else {
    next = key === '.' && text.includes('.') ? text : text + key;
  }
  return next === '' ? null : { text: next };
}

// What the input says, or the fallback while it has no digits yet.
export function typedValue(input: TypedInput, fallback = 0): number {
  return /\d/.test(input.text) ? Number(input.text) : fallback;
}

export function describeTyped(input: TypedInput, unit: string): string {
  return `${input.text || '0'} ${unit}`;
}
