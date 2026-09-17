/** Read a required environment variable; empty counts as missing. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var ${name}. Add it to .env or export it in your shell.`);
  }
  return value;
}
