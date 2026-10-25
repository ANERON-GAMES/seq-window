# @aneron/seq-window

Sliding sequence-number window for unreliable transports.

## Purpose

`@aneron/seq-window` remembers which sequence numbers have already been accepted when delivery can reorder or repeat them. It stores the newest sequence number seen and a fixed-size bitmap of the numbers immediately behind that mark. Each incoming number is classified as `accept`, `duplicate`, or `too-old`. A newer accepted number slides the window forward.

Sequence numbers are 32-bit values and wrap from 4294967295 back to 0.

## Install

```bash
npm install @aneron/seq-window
```

The package is ESM and is developed for Node.js 20 and Node.js 22.

## Usage

```js
import { SeqWindow } from '@aneron/seq-window';

const tracker = new SeqWindow(64);

tracker.receive(1); // 'accept'
tracker.receive(3); // 'accept'
tracker.receive(2); // 'accept'
tracker.receive(3); // 'duplicate'
tracker.receive(0); // 'accept'
tracker.receive(1000); // 'accept'
tracker.receive(2); // 'too-old'
```

A number newer than the current mark is accepted and the window slides. A repeated number still covered by the bitmap is a duplicate. A number older than the bitmap is too old and does not change the window.

```js
const wrapping = new SeqWindow(32);

wrapping.receive(0xffffffff); // 'accept'
wrapping.receive(0); // 'accept'
wrapping.receive(0xffffffff); // 'duplicate'
```

## API

### `new SeqWindow(size)`

Create a window. `size` is the number of sequence numbers remembered behind the newest accepted number. It must be an integer from 1 through 1048576. The constructor throws `RangeError` otherwise.

The newest accepted number is tracked separately, so a window remembers `size + 1` numbers: the mark, plus `size` numbers behind it.

### `tracker.receive(sequence)`

Classify `sequence` and update the window when the number is new.

`sequence` must be an integer from 0 through 4294967295. The method throws `RangeError` otherwise.

| Result        | Meaning                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| `'accept'`    | The number is new. The first number, a newer number, or a gap inside the bitmap. |
| `'duplicate'` | The number was already accepted and is still inside the window.                  |
| `'too-old'`   | The number is older than the bitmap. The window does not change.                 |

The first call always returns `'accept'`.

### `tracker.highest`

The newest sequence number accepted so far, under 32-bit serial order. `null` before the first accepted number.

### `tracker.size`

The bitmap length passed to the constructor.

### Constants

`ACCEPT`, `DUPLICATE`, and `TOO_OLD` are the strings `'accept'`, `'duplicate'`, and `'too-old'`.

## Design notes

The mark is stored on its own. Bit `i` of the bitmap is set when the sequence number `i + 1` behind the mark has been accepted. With a bitmap of length `size`, the oldest remembered number is exactly `size` behind the mark. Anything older returns `too-old`.

Comparison uses unsigned 32-bit serial arithmetic. A number is newer when the forward distance from the mark, modulo 2^32, is greater than 0 and less than 2^31. The window then shifts forward by that distance, and the previous mark is recorded at its new offset. If the forward distance is greater than `size`, the bitmap is cleared and every number behind the new mark is forgotten. A forward distance of exactly 2^31 is unordered in 32-bit serial arithmetic and is reported as `too-old`.

`duplicate` and `too-old` leave the mark and the bitmap unchanged. There is no timer. Numbers age out only when a newer number slides the bitmap past them.

Each `SeqWindow` keeps its own state. The library does not use shared mutable state or I/O, and it has no runtime dependencies.

## License

MIT. Copyright (c) 2026 Vadim Gubin. See [LICENSE](./LICENSE).
