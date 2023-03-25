import { useCallback, useEffect, useRef } from "react";
import { CENTERED_VERTICAL } from "../util/styles";

export const KEYS = [
  'qwertyuiop'.split(''),
  'asdfghjkl'.split(''),
  ['enter', ...('zxcvbnm'.split('')), 'backspace']
]

export const ALL_KEYS = new Set<string>();
KEYS.forEach(row => row.forEach(key => ALL_KEYS.add(key)));

const DISPLAY_ALIAS: { [key in string]: { alias: string, width: number, fontScale: number } } = {
  backspace: {
    alias: '⌫',
    fontScale: 1,
    width: 2
  },
  enter: {
    alias: 'ENTER',
    fontScale: 0.6,
    width: 2
  }
}

const FONT_SIZE = 20;

interface KeyProps {
  id: string;
  color: string;
  onClick: () => void;
}

const Key = ({ id, color, onClick }: KeyProps) => {
  const alias = DISPLAY_ALIAS[id];
  return (
    <div
      style={{
        float: 'left',
        borderRadius: 5,
        backgroundColor: color,
        height: 50,
        width: 15 + 20 * (alias?.width || id.length),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: alias?.fontScale * FONT_SIZE || FONT_SIZE,
        fontWeight: 'bold',
        userSelect: 'none',
        margin: 2,
        cursor: 'pointer'
      }}
      key={id}
      onClick={onClick}
    >
      {alias?.alias || id.toUpperCase()}
    </div>
  )
}

interface KeyboardProps {
  onKey: (key: string) => void;
  colors: {
    [key in string]: Set<string>;
  };
  colorAliases: {
    [key in string]: string;
  }
}

const Keyboard = ({ onKey, colors, colorAliases }: KeyboardProps) => {
  const keyboardHandler = useRef<(event: KeyboardEvent) => void>(() => null);

  useEffect(() => {
    keyboardHandler.current = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (ALL_KEYS.has(key)) {
        keyHandler(key)();
      }
    };
  }, [onKey]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => keyboardHandler.current(event);
    document.addEventListener('keydown', handler, false);
    return () => document.removeEventListener('keydown', handler, false);
  }, []);


  function keyHandler(key: string) {
    return () => {onKey(key);console.log(key)};
  }

  function keyColor(key: string): string {
    for (const color of Object.keys(colors)) {
      if (colors[color].has(key)) {
        return colorAliases[color];
      }
    }
    return '#EEEEEE';
  }

  return (
    <div style={CENTERED_VERTICAL}>
      {KEYS.map((row: string[], i: number) => (
        <div key={i} style={{ overflow: 'hidden' }}>
          {row.map(key => <Key id={key} color={keyColor(key)} key={key} onClick={keyHandler(key)}/>)}
        </div>
      ))}
    </div>
  )
}

export default Keyboard;