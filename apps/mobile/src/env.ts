const need = (name: string, value: string | undefined) => {
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`);
  return value.replace(/\/$/, '');
};

export const env = {
  apiUrl: need('EXPO_PUBLIC_API_URL', process.env.EXPO_PUBLIC_API_URL),
  oidcAuthority: need('EXPO_PUBLIC_OIDC_AUTHORITY', process.env.EXPO_PUBLIC_OIDC_AUTHORITY),
  oidcClientId: 'grids-mobile',
};
