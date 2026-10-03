function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set. Run: pnpm --filter @grids/api bootstrap:idp`);
  return value;
}

export const env = {
  apiUrl: required('VITE_API_URL', import.meta.env.VITE_API_URL),
  oidcAuthority: required('VITE_OIDC_AUTHORITY', import.meta.env.VITE_OIDC_AUTHORITY),
  oidcClientId: required('VITE_OIDC_CLIENT_ID', import.meta.env.VITE_OIDC_CLIENT_ID),
};
