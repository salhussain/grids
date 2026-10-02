import { describe, expect, it } from 'vitest';
import { Id, uuidv7 } from '../src/ids.js';

describe('uuidv7', () => {
  it('produces valid v7 ids', () => {
    for (let i = 0; i < 100; i++) expect(Id.safeParse(uuidv7()).success).toBe(true);
  });

  it('is time-ordered (lexicographically sortable)', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a < b).toBe(true);
  });

  it('encodes the timestamp in the first 48 bits', () => {
    const ms = 1_759_412_345_678;
    const id = uuidv7(ms);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(ms);
  });
});
