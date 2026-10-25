const WORD_BITS = 32;
const SEQUENCE_SPACE = 0x100000000;
const SEQUENCE_HALF = 0x80000000;
const MAX_SEQUENCE = SEQUENCE_SPACE - 1;
const MAX_SIZE = 0x100000;

export const ACCEPT = 'accept';
export const DUPLICATE = 'duplicate';
export const TOO_OLD = 'too-old';

export class SeqWindow {
  #size;
  #words;
  #bitmap;
  #scratch;
  #highest = 0;
  #started = false;

  constructor(size) {
    if (!Number.isInteger(size) || size < 1 || size > MAX_SIZE) {
      throw new RangeError(`size must be an integer from 1 to ${MAX_SIZE}`);
    }
    this.#size = size;
    this.#words = Math.ceil(size / WORD_BITS);
    this.#bitmap = new Uint32Array(this.#words);
    this.#scratch = new Uint32Array(this.#words);
  }

  get size() {
    return this.#size;
  }

  get highest() {
    return this.#started ? this.#highest : null;
  }

  receive(sequence) {
    if (
      !Number.isInteger(sequence) ||
      sequence < 0 ||
      sequence > MAX_SEQUENCE
    ) {
      throw new RangeError(
        `sequence must be an integer from 0 to ${MAX_SEQUENCE}`,
      );
    }

    const value = sequence >>> 0;
    if (!this.#started) {
      this.#started = true;
      this.#highest = value;
      return ACCEPT;
    }

    if (value === this.#highest) {
      return DUPLICATE;
    }

    const ahead = (value - this.#highest) >>> 0;
    if (ahead < SEQUENCE_HALF) {
      this.#advance(ahead);
      this.#highest = value;
      return ACCEPT;
    }

    const behind = (this.#highest - value) >>> 0;
    if (behind > this.#size) {
      return TOO_OLD;
    }

    const index = behind - 1;
    if (this.#has(index)) {
      return DUPLICATE;
    }
    this.#mark(index);
    return ACCEPT;
  }

  #advance(ahead) {
    if (ahead > this.#size) {
      this.#bitmap.fill(0);
      return;
    }
    this.#shift(ahead);
    this.#mark(ahead - 1);
    this.#trim();
  }

  #shift(ahead) {
    const wordShift = ahead >>> 5;
    const bitShift = ahead & 31;
    const words = this.#words;
    const source = this.#bitmap;
    const dest = this.#scratch;

    if (wordShift >= words) {
      dest.fill(0);
    } else if (bitShift === 0) {
      for (let word = 0; word < words; word += 1) {
        dest[word] = word >= wordShift ? source[word - wordShift] : 0;
      }
    } else {
      const inverse = WORD_BITS - bitShift;
      for (let word = 0; word < words; word += 1) {
        const src = word - wordShift;
        const low = src >= 0 ? source[src] : 0;
        const high = src > 0 ? source[src - 1] : 0;
        dest[word] = ((low << bitShift) | (high >>> inverse)) >>> 0;
      }
    }

    this.#bitmap = dest;
    this.#scratch = source;
  }

  #mark(index) {
    const word = index >>> 5;
    const bit = index & 31;
    this.#bitmap[word] = (this.#bitmap[word] | (1 << bit)) >>> 0;
  }

  #has(index) {
    const word = index >>> 5;
    const bit = index & 31;
    return (this.#bitmap[word] & (1 << bit)) !== 0;
  }

  #trim() {
    const used = this.#size & 31;
    if (used === 0) {
      return;
    }
    const mask = 0xffffffff >>> (WORD_BITS - used);
    const top = this.#words - 1;
    this.#bitmap[top] = (this.#bitmap[top] & mask) >>> 0;
  }
}
