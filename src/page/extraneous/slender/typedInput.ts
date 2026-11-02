import { AxisLock, lockVector } from './editing';
import { Vec3 } from './model';

// A number typed during a transformation. A free move has one for each world axis, with Tab going
// between them. Everything else reads the first.
export type TypedInput = { fields: string[]; index: number };

const AXIS_NAMES = ['X', 'Y', 'Z'];

function edited(field: string, key: string): string {
  if (key === 'Backspace') {
    return field.slice(0, -1);
  }
  if (key === '-') {
    return field.startsWith('-') ? field.slice(1) : `-${field}`;
  }
  return key === '.' && field.includes('.') ? field : field + key;
}

export function isTypedKey(key: string): boolean {
  return /^[0-9.-]$/.test(key) || key === 'Backspace';
}

// The input after a key. Erasing the last character gives the transformation back to the pointer.
export function typeKey(input: TypedInput | null, key: string): TypedInput | null {
  const { fields, index } = input ?? { fields: ['', '', ''], index: 0 };
  const next = fields.map((field, i) => (i === index ? edited(field, key) : field));
  return next.some(field => field !== '') ? { fields: next, index } : null;
}

export function nextField(input: TypedInput | null): TypedInput {
  const { fields, index } = input ?? { fields: ['', '', ''], index: 0 };
  return { fields, index: (index + 1) % fields.length };
}

// What a field says, or the fallback while it has no digits yet.
export function typedValue({ fields }: TypedInput, index: number, fallback: number): number {
  return /\d/.test(fields[index]) ? Number(fields[index]) : fallback;
}

export function typedOffset(input: TypedInput, lock: AxisLock | null): Vec3 {
  if (lock) {
    const { x, y, z } = lockVector(lock);
    const distance = typedValue(input, 0, 0);
    return { x: x * distance, y: y * distance, z: z * distance };
  }
  return { x: typedValue(input, 0, 0), y: typedValue(input, 1, 0), z: typedValue(input, 2, 0) };
}

// How the input reads, with the field being typed in marked when there is a choice of them.
export function describeTyped({ fields, index }: TypedInput, separate: boolean, unit = ''): string {
  if (!separate) {
    return `${fields[0] || '0'}${unit}`;
  }
  return fields.map((field, i) => {
    const text = `${AXIS_NAMES[i]} ${field || '0'}`;
    return i === index ? `[${text}]` : text;
  }).join('  ');
}
