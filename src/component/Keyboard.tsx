import { useEffect, useRef } from "react";
import { CENTERED, CENTERED_VERTICAL, UNSELECTABLE } from "../util/styles";
import TypingHandler from "./TypingHandler";

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
  const characterCount = (alias?.width || id.length);
  const fontSize = alias?.fontScale * FONT_SIZE || FONT_SIZE;
  return (
    <div
      style={{
        float: 'left',
        borderRadius: 5,
        backgroundColor: color,
        height: 'min(16vw, 62px)',
        width: 'calc(min(3.5vw, 18px) + min(4.9vw, 24px) * ' + characterCount + ')',
        fontSize: fontSize,
        fontWeight: 'bold',
        margin: 'min(0.6vw, 3px)',
        cursor: 'pointer',
        ...CENTERED,
        ...UNSELECTABLE
      }}
      key={id}
      onClick={onClick}
      onTouchStart={onClick}
      onTouchEnd={event => event.preventDefault()}
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
  function keyHandler(key: string) {
    return () => {onKey(key);console.log(key)};
  }

  function onTypedKey(key: string) {
    const lowercase = key.toLowerCase();
    if (ALL_KEYS.has(lowercase)) {
      onKey(lowercase);
    }
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
      <TypingHandler onKeyDown={onTypedKey}/>
    </div>
  )
}

export default Keyboard;