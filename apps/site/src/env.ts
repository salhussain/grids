/** Where the product apps live; the site only links to them. */
export const LOGIN_URL = import.meta.env.VITE_LOGIN_URL ?? 'http://localhost:5175';
export const APP_URL = import.meta.env.VITE_APP_URL ?? 'http://localhost:5174';
export const SIGNUP_URL = import.meta.env.VITE_SIGNUP_URL ?? `${LOGIN_URL}/signup`;
