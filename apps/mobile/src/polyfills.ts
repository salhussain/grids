import * as Crypto from 'expo-crypto';

// @grids/schema and @grids/forms draw random numbers from the web's `crypto`.
if (!globalThis.crypto?.getRandomValues) {
  Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: Crypto.getRandomValues }, configurable: true });
}
