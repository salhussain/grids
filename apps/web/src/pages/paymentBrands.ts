import type { PayMethod } from '@grids/schema';

/** Stand-in marks for well-known ways to pay (simple tiles, not the brands' official artwork; upload theirs to replace). */
const tile = (bg: string, body: string) =>
  `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${bg}"/>${body}</svg>`)}`;

export interface PayPreset {
  id: string;
  name: string;
  kind: PayMethod;
  logo: string;
  instalments?: number;
}

export const PAY_PRESETS: PayPreset[] = [
  {
    id: 'digicel',
    name: 'Digicel Pay',
    kind: 'wallet',
    logo: tile(
      '#e60000',
      '<text x="32" y="43" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="34" font-weight="700" fill="#fff">d</text><circle cx="46" cy="18" r="4" fill="#fff"/>',
    ),
  },
  {
    id: 'paypal',
    name: 'PayPal',
    kind: 'wallet',
    logo: tile(
      '#ffffff',
      '<text x="26" y="46" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="40" font-weight="700" font-style="italic" fill="#009cde">P</text><text x="32" y="42" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="40" font-weight="700" font-style="italic" fill="#003087">P</text>',
    ),
  },
  {
    id: 'applepay',
    name: 'Apple Pay',
    kind: 'wallet',
    logo: tile(
      '#000000',
      '<path d="M40.6 33.2c0-3.6 3-5.3 3.1-5.4-1.7-2.5-4.3-2.8-5.2-2.8-2.2-.2-4.3 1.300-5.400 1.300-1.100 0-2.900-1.300-4.700-1.200-2.400 0-4.700 1.400-5.900 3.600-2.500 4.400-.6 10.900 1.800 14.500 1.200 1.700 2.600 3.700 4.500 3.600 1.800-.1 2.500-1.200 4.700-1.200 2.200 0 2.800 1.200 4.700 1.100 1.900 0 3.200-1.800 4.300-3.500 1.400-2 1.900-3.900 2-4-.1 0-3.800-1.400-3.900-5.700zM37.100 22.500c1-1.200 1.600-2.800 1.400-4.400-1.400.1-3.100.9-4.100 2.100-.9 1-1.700 2.700-1.500 4.300 1.600.1 3.200-.8 4.200-2z" fill="#fff"/>',
    ),
  },
  {
    id: 'googlepay',
    name: 'Google Pay',
    kind: 'wallet',
    logo: tile(
      '#ffffff',
      '<rect x="8" y="8" width="48" height="48" rx="10" fill="none" stroke="#dadce0" stroke-width="2"/><text x="32" y="45" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="36" font-weight="700" fill="#4285f4">G</text><rect x="14" y="50" width="9" height="3" fill="#ea4335"/><rect x="23" y="50" width="9" height="3" fill="#fbbc05"/><rect x="32" y="50" width="9" height="3" fill="#34a853"/><rect x="41" y="50" width="9" height="3" fill="#4285f4"/>',
    ),
  },
  {
    id: 'afterpay',
    name: 'Afterpay',
    kind: 'instalments',
    instalments: 4,
    logo: tile(
      '#b2fce4',
      '<path d="M32 14 50 25v14L32 50 14 39V25z" fill="#000"/><path d="M32 22 42 28l-10 6-10-6z" fill="#b2fce4"/>',
    ),
  },
];
