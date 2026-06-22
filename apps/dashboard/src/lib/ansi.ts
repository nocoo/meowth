// docs/architecture/07 §3.1 — untrusted text → React nodes.
//
// Parses ANSI escape sequences from arbitrary input and emits a
// flat array of React nodes. Text segments are returned as plain
// strings (so React text-escapes them); styled segments are
// returned as <span className=...> nodes built with
// React.createElement (this file is .ts on purpose, no JSX).
//
// Strict scope:
//   - Only CSI sequences are recognised. Final byte 'm' updates
//     style state; every other final byte is parsed and DROPPED
//     (cursor moves, erase, etc).
//   - Non-CSI escape sequences and stray ESC bytes are dropped.
//   - No HTML string path, no innerHTML, no eval, no Function
//     constructor.

import { cn } from '@/lib/utils';
import { type ReactNode, createElement } from 'react';

type AnsiColor =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'brightBlack'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite';

interface Style {
  fg: AnsiColor | undefined;
  bg: AnsiColor | undefined;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
}

function freshStyle(): Style {
  return {
    fg: undefined,
    bg: undefined,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
  };
}

const BASIC_FG: Record<number, AnsiColor> = {
  30: 'black',
  31: 'red',
  32: 'green',
  33: 'yellow',
  34: 'blue',
  35: 'magenta',
  36: 'cyan',
  37: 'white',
  90: 'brightBlack',
  91: 'brightRed',
  92: 'brightGreen',
  93: 'brightYellow',
  94: 'brightBlue',
  95: 'brightMagenta',
  96: 'brightCyan',
  97: 'brightWhite',
};

const BASIC_BG: Record<number, AnsiColor> = {
  40: 'black',
  41: 'red',
  42: 'green',
  43: 'yellow',
  44: 'blue',
  45: 'magenta',
  46: 'cyan',
  47: 'white',
  100: 'brightBlack',
  101: 'brightRed',
  102: 'brightGreen',
  103: 'brightYellow',
  104: 'brightBlue',
  105: 'brightMagenta',
  106: 'brightCyan',
  107: 'brightWhite',
};

// xterm 256 -> nearest basic 16 color (we don't render truecolor).
function color256ToBasic(code: number): AnsiColor | undefined {
  if (code < 0 || code > 255) return undefined;
  if (code < 16) {
    const basicByIndex: AnsiColor[] = [
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'brightBlack',
      'brightRed',
      'brightGreen',
      'brightYellow',
      'brightBlue',
      'brightMagenta',
      'brightCyan',
      'brightWhite',
    ];
    return basicByIndex[code];
  }
  if (code >= 232) {
    // grayscale ramp
    return code < 244 ? 'brightBlack' : 'white';
  }
  // 6x6x6 cube: pick a rough match based on luminance of the largest component.
  const cube = code - 16;
  const r = Math.floor(cube / 36);
  const g = Math.floor((cube % 36) / 6);
  const b = cube % 6;
  const max = Math.max(r, g, b);
  if (max <= 1) return 'black';
  const bright = max >= 4;
  if (r === g && g === b) return bright ? 'white' : 'brightBlack';
  if (r >= g && r >= b) return bright ? 'brightRed' : 'red';
  if (g >= r && g >= b) return bright ? 'brightGreen' : 'green';
  return bright ? 'brightBlue' : 'blue';
}

const FG_CLASS: Record<AnsiColor, string> = {
  black: 'text-zinc-900',
  red: 'text-red-600',
  green: 'text-green-600',
  yellow: 'text-yellow-600',
  blue: 'text-blue-600',
  magenta: 'text-fuchsia-600',
  cyan: 'text-cyan-600',
  white: 'text-zinc-200',
  brightBlack: 'text-zinc-500',
  brightRed: 'text-red-400',
  brightGreen: 'text-green-400',
  brightYellow: 'text-yellow-400',
  brightBlue: 'text-blue-400',
  brightMagenta: 'text-fuchsia-400',
  brightCyan: 'text-cyan-400',
  brightWhite: 'text-white',
};

const BG_CLASS: Record<AnsiColor, string> = {
  black: 'bg-zinc-900',
  red: 'bg-red-600',
  green: 'bg-green-600',
  yellow: 'bg-yellow-600',
  blue: 'bg-blue-600',
  magenta: 'bg-fuchsia-600',
  cyan: 'bg-cyan-600',
  white: 'bg-zinc-200',
  brightBlack: 'bg-zinc-500',
  brightRed: 'bg-red-400',
  brightGreen: 'bg-green-400',
  brightYellow: 'bg-yellow-400',
  brightBlue: 'bg-blue-400',
  brightMagenta: 'bg-fuchsia-400',
  brightCyan: 'bg-cyan-400',
  brightWhite: 'bg-white',
};

function classesFor(style: Style): string[] {
  const out: string[] = [];
  const fg = style.inverse && style.bg ? style.bg : style.fg;
  const bg = style.inverse && style.fg ? style.fg : style.bg;
  if (fg) out.push(FG_CLASS[fg]);
  if (bg) out.push(BG_CLASS[bg]);
  if (style.bold) out.push('font-bold');
  if (style.dim) out.push('opacity-70');
  if (style.italic) out.push('italic');
  if (style.underline) out.push('underline');
  return out;
}

function isStyled(style: Style): boolean {
  return Boolean(
    style.fg ||
      style.bg ||
      style.bold ||
      style.dim ||
      style.italic ||
      style.underline ||
      style.inverse,
  );
}

function resetStyle(style: Style): void {
  style.fg = undefined;
  style.bg = undefined;
  style.bold = false;
  style.dim = false;
  style.italic = false;
  style.underline = false;
  style.inverse = false;
}

// Apply a single SGR parameter list to the running style.
function applySgr(params: number[], style: Style): void {
  // Empty parameter list (e.g. `ESC[m`) is treated as reset.
  if (params.length === 0) {
    resetStyle(style);
    return;
  }
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (p === 0) {
      resetStyle(style);
    } else if (p === 1) style.bold = true;
    else if (p === 2) style.dim = true;
    else if (p === 3) style.italic = true;
    else if (p === 4) style.underline = true;
    else if (p === 7) style.inverse = true;
    else if (p === 22) {
      style.bold = false;
      style.dim = false;
    } else if (p === 23) style.italic = false;
    else if (p === 24) style.underline = false;
    else if (p === 27) style.inverse = false;
    else if (p === 39) {
      style.fg = undefined;
    } else if (p === 49) {
      style.bg = undefined;
    } else if (p === 38 && params[i + 1] === 5 && typeof params[i + 2] === 'number') {
      const c = color256ToBasic(params[i + 2] as number);
      style.fg = c;
      i += 2;
    } else if (p === 48 && params[i + 1] === 5 && typeof params[i + 2] === 'number') {
      const c = color256ToBasic(params[i + 2] as number);
      style.bg = c;
      i += 2;
    } else if (p === 38 && params[i + 1] === 2) {
      // truecolor `38;2;r;g;b` — not rendered; skip arguments.
      i += 4;
    } else if (p === 48 && params[i + 1] === 2) {
      i += 4;
    } else {
      if (typeof p !== 'number') continue;
      const fg = BASIC_FG[p];
      const bg = BASIC_BG[p];
      if (fg) style.fg = fg;
      else if (bg) style.bg = bg;
    }
    // unknown SGR codes are silently dropped.
  }
}

function makeSpan(text: string, style: Style, key: number): ReactNode {
  if (!isStyled(style)) return text;
  const classes = classesFor(style);
  return createElement(
    'span',
    classes.length > 0 ? { key, className: cn(...classes) } : { key },
    text,
  );
}

export function ansiToReactNodes(input: string): ReactNode[] {
  if (input.length === 0) return [];

  const style: Style = freshStyle();
  const out: ReactNode[] = [];
  let buf = '';
  let key = 0;

  const flush = (): void => {
    if (buf.length === 0) return;
    out.push(makeSpan(buf, style, key++));
    buf = '';
  };

  for (let i = 0; i < input.length; ) {
    const ch = input[i];
    if (ch !== '\x1b') {
      buf += ch;
      i += 1;
      continue;
    }
    const next = input[i + 1];
    if (next === undefined) {
      // dangling ESC at end of input — drop it.
      i += 1;
      continue;
    }
    // String-control families that take a payload terminated by
    // BEL (0x07) or ST (ESC '\'): OSC ']', DCS 'P', PM '^',
    // APC '_', SOS 'X'. The entire payload (including the
    // terminator) is consumed and dropped — we never render it
    // as text and never honour cursor / title / clipboard
    // requests carried by an OSC sequence.
    if (next === ']' || next === 'P' || next === '^' || next === '_' || next === 'X') {
      let j = i + 2;
      while (j < input.length) {
        const c = input.charCodeAt(j);
        if (c === 0x07) {
          j += 1;
          break;
        }
        if (c === 0x1b && input[j + 1] === '\\') {
          j += 2;
          break;
        }
        j += 1;
      }
      i = j;
      continue;
    }
    // Anything other than CSI '[' at this point is a non-CSI
    // single-byte escape (e.g. ESC '7' save cursor, ESC '=' app
    // keypad). Drop the ESC and the introducer byte.
    if (next !== '[') {
      i += 2;
      continue;
    }
    // CSI: ESC '[' params final.
    // Walk parameter / intermediate bytes until we find a final byte.
    let j = i + 2;
    while (j < input.length) {
      const code = input.charCodeAt(j);
      // CSI final byte is in range 0x40..0x7E.
      if (code >= 0x40 && code <= 0x7e) break;
      j += 1;
    }
    if (j >= input.length) {
      // unterminated CSI — drop the rest.
      i = input.length;
      continue;
    }
    const final = input[j];
    const paramsRaw = input.slice(i + 2, j);
    if (final === 'm') {
      // SGR: parse params, flush current run, apply.
      flush();
      const params: number[] = paramsRaw
        .split(';')
        .map((s) => (s === '' ? 0 : Number.parseInt(s, 10)))
        .filter((n) => Number.isFinite(n));
      applySgr(params, style);
    }
    // Every other CSI (cursor move / erase / etc) is intentionally dropped.
    i = j + 1;
  }
  flush();
  return out;
}
