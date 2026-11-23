// A tiny stack VM for make.fun's tiny stack ISA (ISA.md in the kit), written from the spec: 32-bit wrapping
// values, a 256-deep data stack, 64 return addresses, 256 words of memory, byte input and output, ten traps.
// For every program in the input directory it writes the bytes the program wrote and the code it ended with.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// One pack per opcode byte: immediate bytes * 16 + pops * 4 + pushes. A hole in the array is no opcode at all.
const T = [0,17,65,4,6,10,11,15,,,,,,,,,9,9,9,9,9,9,9,5,9,9,9,5,9,9,9,,9,9,9,,,,,,,,,,,,,,32,36,36,32,0,,,,,,,,,,,,5,8,,,,,,,,,,,,,,,4,4,1,4];

// Runs one program (P) on its input (N) and answers [output bytes, exit code]. A trap's code is its exit code,
// and the output written before a trap stands.
function run(P, N) {
  const n = P.length;
  const S = new Int32Array(256), C = new Int32Array(64), M = new Int32Array(256), out = new Uint8Array(65536);
  let sp = 0, cp = 0, ol = 0, ip = 0, pc = 0, steps = 0;
  const fin = (code) => [out.slice(0, ol), code];
  for (;;) {
    if (steps === 1e6) return fin(10);
    if (pc < 0 || pc >= n) return fin(9);
    const op = P[pc], m = T[op];
    if (m === undefined) return fin(5);
    const imm = m >> 4;
    if (pc + imm >= n) return fin(9);
    steps++;
    const pops = (m >> 2) & 3;
    if (sp < pops) return fin(2);
    if (sp - pops + (m & 3) > 256) return fin(3);
    const nx = pc + 1 + imm;
    pc = nx;
    switch (op) {
      case 0x00: return fin(0);
      case 0x01: S[sp++] = (P[nx - 1] << 24) >> 24; break;
      case 0x02: S[sp++] = P[nx - 4] | (P[nx - 3] << 8) | (P[nx - 2] << 16) | (P[nx - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: S[sp] = S[sp - 1]; sp++; break;
      case 0x05: { const t = S[sp - 1]; S[sp - 1] = S[sp - 2]; S[sp - 2] = t; break; }
      case 0x06: S[sp] = S[sp - 2]; sp++; break;
      case 0x07: { const a = S[sp - 3]; S[sp - 3] = S[sp - 2]; S[sp - 2] = S[sp - 1]; S[sp - 1] = a; break; }
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = S[sp - 1], a = S[sp - 2];
        let r;
        switch (op) {
          case 0x10: r = a + b | 0; break;
          case 0x11: r = a - b | 0; break;
          case 0x12: r = Math.imul(a, b); break;
          case 0x13: if (b === 0) return fin(4); r = a / b | 0; break;
          case 0x14: if (b === 0) return fin(4); r = a % b | 0; break;
          case 0x15: if (b === 0) return fin(4); r = (a >>> 0) / (b >>> 0) | 0; break;
          case 0x16: if (b === 0) return fin(4); r = (a >>> 0) % (b >>> 0) | 0; break;
          case 0x18: r = a & b; break;
          case 0x19: r = a | b; break;
          case 0x1a: r = a ^ b; break;
          case 0x1c: r = a << (b & 31); break;
          case 0x1d: r = a >> (b & 31); break;
          case 0x1e: r = (a >>> (b & 31)) | 0; break;
          case 0x20: r = a === b ? 1 : 0; break;
          case 0x21: r = a < b ? 1 : 0; break;
          default: r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        }
        sp--; S[sp - 1] = r; break;
      }
      case 0x17: S[sp - 1] = -S[sp - 1] | 0; break;
      case 0x1b: S[sp - 1] = ~S[sp - 1]; break;
      case 0x30: case 0x31: case 0x32: {
        const rel = ((P[nx - 2] | (P[nx - 1] << 8)) << 16) >> 16;
        if (op === 0x30) pc = nx + rel;
        else { const v = S[--sp]; if (op === 0x31 ? v === 0 : v !== 0) pc = nx + rel; }
        break;
      }
      case 0x33:
        if (cp === 64) return fin(7);
        C[cp++] = nx; pc = P[nx - 2] | (P[nx - 1] << 8); break;
      case 0x34:
        if (cp === 0) return fin(8);
        pc = C[--cp]; break;
      case 0x40: case 0x41: { const a = S[sp - 1]; if (a < 0 || a > 255) return fin(6); if (op === 0x40) S[sp - 1] = M[a]; else { M[a] = S[sp - 2]; sp -= 2; } break; }
      case 0x50: {
        const t = '' + S[--sp];
        if (ol + t.length > 65536) return fin(11);
        for (let i = 0; i < t.length; i++) out[ol++] = t.charCodeAt(i);
        break;
      }
      case 0x51:
        if (ol === 65536) return fin(11);
        out[ol++] = S[--sp] & 255; break;
      case 0x52: S[sp++] = ip < N.length ? N[ip++] : -1; break;
      case 0x53: return fin(S[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const [bytes, code] = run(readFileSync(join(I, id, 'program.bin')), readFileSync(join(I, id, 'input.bin')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), bytes);
  writeFileSync(join(O, id, 'exit.txt'), code + '\n');
}
