import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ACCEPT, DUPLICATE, SeqWindow, TOO_OLD } from '../src/index.js';

const SEQUENCE_HALF = 0x80000000;

function createOracle(size) {
  let mark = null;
  let seen = new Set();

  return {
    get highest() {
      return mark;
    },
    receive(sequence) {
      const value = sequence === 0 ? 0 : sequence;
      if (mark === null) {
        mark = value;
        seen = new Set([0]);
        return ACCEPT;
      }

      const ahead = (value - mark) >>> 0;
      if (ahead > 0 && ahead < SEQUENCE_HALF) {
        const next = new Set([0]);
        if (ahead <= size) {
          for (const distance of seen) {
            const shifted = distance + ahead;
            if (shifted <= size) {
              next.add(shifted);
            }
          }
        }
        seen = next;
        mark = value;
        return ACCEPT;
      }

      const behind = (mark - value) >>> 0;
      if (behind > size) {
        return TOO_OLD;
      }
      if (seen.has(behind)) {
        return DUPLICATE;
      }
      seen.add(behind);
      return ACCEPT;
    },
  };
}

function openWindow(size) {
  const tracker = new SeqWindow(size);
  const oracle = createOracle(size);
  return {
    tracker,
    receive(sequence, expected, highest) {
      const fromOracle = oracle.receive(sequence);
      const fromTracker = tracker.receive(sequence);
      assert.equal(fromTracker, fromOracle, `sequence ${sequence}`);
      assert.equal(tracker.highest, oracle.highest, `mark after ${sequence}`);
      if (expected !== undefined) {
        assert.equal(fromTracker, expected, `sequence ${sequence}`);
      }
      if (highest !== undefined) {
        assert.equal(tracker.highest, highest, `mark after ${sequence}`);
      }
    },
  };
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return mixed >>> 0;
  };
}

function nextSequence(random, highest) {
  const roll = random() % 8;
  if (highest === null || roll === 0) {
    return random();
  }
  if (roll === 1) {
    return highest;
  }
  if (roll === 2) {
    return (highest + 1) >>> 0;
  }
  if (roll === 3) {
    return (highest + 1 + (random() % 8)) >>> 0;
  }
  if (roll === 4) {
    return (highest + (random() % 4096)) >>> 0;
  }
  if (roll === 5) {
    return (highest - (1 + (random() % 2048))) >>> 0;
  }
  if (roll === 6) {
    return (highest + SEQUENCE_HALF - 1) >>> 0;
  }
  return (highest + SEQUENCE_HALF) >>> 0;
}

describe('SeqWindow', () => {
  test('exports the result strings', () => {
    assert.equal(ACCEPT, 'accept');
    assert.equal(DUPLICATE, 'duplicate');
    assert.equal(TOO_OLD, 'too-old');
  });

  test('starts with an empty mark', () => {
    const tracker = new SeqWindow(8);
    assert.equal(tracker.highest, null);
    assert.equal(tracker.size, 8);
  });

  test('rejects a bitmap length outside 1 through 1048576', () => {
    const badSizes = [
      0,
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1048577,
      2 ** 31,
      '8',
      null,
      undefined,
      8n,
    ];
    for (const size of badSizes) {
      assert.throws(() => new SeqWindow(size), RangeError);
    }
    assert.equal(new SeqWindow(1).size, 1);
    assert.equal(new SeqWindow(1048576).size, 1048576);
  });

  test('rejects sequence numbers outside the 32-bit range', () => {
    const { receive, tracker } = openWindow(8);
    receive(3, ACCEPT, 3);
    const badValues = [
      -1,
      2 ** 32,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      '3',
      null,
      undefined,
      3n,
    ];
    for (const value of badValues) {
      assert.throws(() => tracker.receive(value), RangeError);
    }
    assert.equal(tracker.highest, 3);
    receive(3, DUPLICATE, 3);
    receive(2, ACCEPT, 3);
  });

  test('treats negative zero as sequence 0', () => {
    const { receive, tracker } = openWindow(4);
    receive(-0, ACCEPT, 0);
    assert.equal(Object.is(tracker.highest, 0), true);
    receive(0, DUPLICATE, 0);
  });

  test('accepts an in-order run, then flags duplicates and too-old numbers', () => {
    const { receive } = openWindow(64);
    for (let sequence = 0; sequence < 200; sequence += 1) {
      receive(sequence, ACCEPT, sequence);
    }
    for (let sequence = 199 - 64; sequence <= 199; sequence += 1) {
      receive(sequence, DUPLICATE, 199);
    }
    receive(199 - 65, TOO_OLD, 199);
    receive(200, ACCEPT, 200);
    receive(200 - 64, DUPLICATE, 200);
    receive(200 - 65, TOO_OLD, 200);
  });

  test('accepts out-of-order numbers inside the bitmap', () => {
    const { receive } = openWindow(16);
    receive(5, ACCEPT, 5);
    receive(8, ACCEPT, 8);
    receive(6, ACCEPT, 8);
    receive(7, ACCEPT, 8);
    receive(4, ACCEPT, 8);
    receive(9, ACCEPT, 9);
    receive(1, ACCEPT, 9);
    receive(6, DUPLICATE, 9);
    receive(5, DUPLICATE, 9);
    receive(8, DUPLICATE, 9);
    receive(0, ACCEPT, 9);
    receive((9 - 17) >>> 0, TOO_OLD, 9);
  });

  test('reports duplicates without moving the mark', () => {
    const { receive } = openWindow(8);
    receive(30, ACCEPT, 30);
    receive(28, ACCEPT, 30);
    receive(30, DUPLICATE, 30);
    receive(28, DUPLICATE, 30);
    receive(28, DUPLICATE, 30);
    receive(29, ACCEPT, 30);
  });

  test('reports too-old numbers without moving the mark', () => {
    const { receive } = openWindow(8);
    receive(100, ACCEPT, 100);
    receive(100 - 9, TOO_OLD, 100);
    receive(100 - 40, TOO_OLD, 100);
    receive(100 - 8, ACCEPT, 100);
    receive(100 - 8, DUPLICATE, 100);
    receive(100 - 9, TOO_OLD, 100);
  });

  test('leaves gaps open after duplicate and too-old results', () => {
    const { receive } = openWindow(8);
    receive(20, ACCEPT, 20);
    receive(17, ACCEPT, 20);
    receive(20, DUPLICATE, 20);
    receive(11, TOO_OLD, 20);
    receive(19, ACCEPT, 20);
    receive(18, ACCEPT, 20);
    receive(16, ACCEPT, 20);
    receive(22, ACCEPT, 22);
    receive(13, TOO_OLD, 22);
    receive(14, ACCEPT, 22);
    receive(15, ACCEPT, 22);
    receive(16, DUPLICATE, 22);
    receive(14, DUPLICATE, 22);
  });

  test('forgets numbers left behind a far jump', () => {
    const { receive } = openWindow(4);
    receive(10, ACCEPT, 10);
    receive(9, ACCEPT, 10);
    receive(8, ACCEPT, 10);
    receive(7, ACCEPT, 10);
    receive(6, ACCEPT, 10);
    receive(15, ACCEPT, 15);
    receive(10, TOO_OLD, 15);
    receive(11, ACCEPT, 15);
    receive(14, ACCEPT, 15);
    receive(13, ACCEPT, 15);
    receive(12, ACCEPT, 15);
    receive(15, DUPLICATE, 15);
    receive(6, TOO_OLD, 15);
    receive(1000, ACCEPT, 1000);
    receive(15, TOO_OLD, 1000);
    receive(996, ACCEPT, 1000);
    receive(995, TOO_OLD, 1000);
    receive(999, ACCEPT, 1000);
    receive(997, ACCEPT, 1000);
    receive(998, ACCEPT, 1000);
    receive(996, DUPLICATE, 1000);
  });

  test('keeps only the previous mark on a jump equal to the bitmap length', () => {
    const { receive } = openWindow(4);
    receive(10, ACCEPT, 10);
    receive(8, ACCEPT, 10);
    receive(14, ACCEPT, 14);
    receive(10, DUPLICATE, 14);
    receive(8, TOO_OLD, 14);
    receive(11, ACCEPT, 14);
    receive(12, ACCEPT, 14);
    receive(13, ACCEPT, 14);
    receive(9, TOO_OLD, 14);
  });

  test('treats a half-range distance as too old', () => {
    const { receive } = openWindow(8);
    receive(100, ACCEPT, 100);
    receive((100 + SEQUENCE_HALF) >>> 0, TOO_OLD, 100);
    const almost = (100 + SEQUENCE_HALF - 1) >>> 0;
    receive(almost, ACCEPT, almost);
    receive(100, TOO_OLD, almost);

    const base = 0xffff0000;
    const wrapped = openWindow(8);
    wrapped.receive(base, ACCEPT, base);
    wrapped.receive((base + SEQUENCE_HALF) >>> 0, TOO_OLD, base);
    const wrappedAlmost = (base + SEQUENCE_HALF - 1) >>> 0;
    wrapped.receive(wrappedAlmost, ACCEPT, wrappedAlmost);
    wrapped.receive(base, TOO_OLD, wrappedAlmost);
  });

  test('with a one-bit bitmap remembers only the previous mark', () => {
    const { receive } = openWindow(1);
    receive(0, ACCEPT, 0);
    receive(0, DUPLICATE, 0);
    receive(1, ACCEPT, 1);
    receive(0, DUPLICATE, 1);
    receive(2, ACCEPT, 2);
    receive(0, TOO_OLD, 2);
    receive(1, DUPLICATE, 2);
    receive(3, ACCEPT, 3);
    receive(1, TOO_OLD, 3);
    receive(2, DUPLICATE, 3);
  });

  test('fills gaps across the wraparound point', () => {
    const { receive } = openWindow(8);
    receive(0xfffffffd, ACCEPT, 0xfffffffd);
    receive(2, ACCEPT, 2);
    receive(0xffffffff, ACCEPT, 2);
    receive(0, ACCEPT, 2);
    receive(1, ACCEPT, 2);
    receive(0xfffffffe, ACCEPT, 2);
    receive(0xfffffffd, DUPLICATE, 2);
    receive(0xfffffffc, ACCEPT, 2);
    receive(0xfffffffb, ACCEPT, 2);
    receive(0xfffffffa, ACCEPT, 2);
    receive(0xfffffff9, TOO_OLD, 2);
    receive(2, DUPLICATE, 2);
    receive(0, DUPLICATE, 2);
  });

  test('keeps an in-order run across wraparound', () => {
    const { receive } = openWindow(16);
    let sequence = 0xfffffff8;
    for (let step = 0; step < 32; step += 1) {
      receive(sequence, ACCEPT, sequence);
      sequence = (sequence + 1) >>> 0;
    }
    receive(0x17, DUPLICATE, 0x17);
    receive(0x8, DUPLICATE, 0x17);
    receive(0x7, DUPLICATE, 0x17);
    receive(0x6, TOO_OLD, 0x17);
    receive(0, TOO_OLD, 0x17);
    receive(0xffffffff, TOO_OLD, 0x17);
    receive(0x18, ACCEPT, 0x18);
    receive(0x8, DUPLICATE, 0x18);
    receive(0x7, TOO_OLD, 0x18);
  });

  test('reaccepts a number after the window wraps past it', () => {
    const { receive } = openWindow(4);
    receive(0, ACCEPT, 0);
    receive(SEQUENCE_HALF - 1, ACCEPT, SEQUENCE_HALF - 1);
    receive(0, TOO_OLD, SEQUENCE_HALF - 1);
    receive(0xfffffffe, ACCEPT, 0xfffffffe);
    receive(0, ACCEPT, 0);
    receive(0, DUPLICATE, 0);
    receive(0xfffffffe, DUPLICATE, 0);
    receive(0xffffffff, ACCEPT, 0);
    receive(0xfffffffc, ACCEPT, 0);
    receive(0xfffffffb, TOO_OLD, 0);
  });

  test('slides the bitmap across word boundaries', () => {
    const sizes = [1, 31, 32, 33, 63, 64, 65, 127, 128];
    const starts = [5, 1000, 0xfffffff0, 0xffffffff];
    for (const size of sizes) {
      const candidates = [1, 31, 32, 33, size, size + 1, size + 31];
      const shifts = [];
      for (const shift of candidates) {
        if (!shifts.includes(shift)) {
          shifts.push(shift);
        }
      }
      for (const start of starts) {
        for (const shift of shifts) {
          const { receive } = openWindow(size);
          receive(start, ACCEPT, start);
          for (let distance = 1; distance <= size; distance += 1) {
            receive((start - distance) >>> 0, ACCEPT, start);
          }
          for (let distance = 1; distance <= size; distance += 1) {
            receive((start - distance) >>> 0, DUPLICATE, start);
          }
          const next = (start + shift) >>> 0;
          receive(next, ACCEPT, next);
          for (let distance = 1; distance <= size; distance += 1) {
            const sequence = (next - distance) >>> 0;
            const expected = distance >= shift ? DUPLICATE : ACCEPT;
            receive(sequence, expected, next);
          }
          receive((next - size - 1) >>> 0, TOO_OLD, next);
        }
      }
    }
  });

  test('supports the largest bitmap', () => {
    const size = 1048576;
    const { receive } = openWindow(size);
    receive(0, ACCEPT, 0);
    receive(0, DUPLICATE, 0);
    receive(size, ACCEPT, size);
    receive(0, DUPLICATE, size);
    receive(1, ACCEPT, size);
    receive(0xffffffff, TOO_OLD, size);
    receive(size, DUPLICATE, size);
  });

  test('keeps instances independent', () => {
    const left = openWindow(4);
    const right = openWindow(4);
    left.receive(5, ACCEPT, 5);
    right.receive(5, ACCEPT, 5);
    left.receive(5, DUPLICATE, 5);
    right.receive(4, ACCEPT, 5);
    left.receive(4, ACCEPT, 5);
    right.receive(9, ACCEPT, 9);
    left.receive(6, ACCEPT, 6);
    assert.equal(left.tracker.highest, 6);
    assert.equal(right.tracker.highest, 9);
  });

  test('matches an independent oracle on mixed traffic', () => {
    const sizes = [1, 2, 3, 8, 31, 32, 33, 64, 127, 128, 1024];
    const starts = [
      0,
      1,
      5,
      SEQUENCE_HALF - 1,
      SEQUENCE_HALF,
      0xfffffffe,
      0xffffffff,
    ];
    const seeds = [1, 7, 99, 2026];
    for (const size of sizes) {
      for (const start of starts) {
        for (const seed of seeds) {
          const random = mulberry32((seed + size * 131 + start) >>> 0);
          const { receive, tracker } = openWindow(size);
          const recent = [];
          receive(start, ACCEPT, start);
          recent.push(start);
          for (let step = 0; step < 250; step += 1) {
            const sequence = nextSequence(random, tracker.highest);
            recent.push(sequence);
            if (recent.length > 12) {
              recent.shift();
            }
            try {
              receive(sequence);
            } catch (error) {
              assert.fail(
                `size=${size} start=${start} seed=${seed} step=${step} recent=${recent.join(',')} ${error}`,
              );
            }
          }
        }
      }
    }
  });
});
