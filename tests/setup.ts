import { existsSync } from "node:fs";

// Node 22 built-in .env loader; never overrides vars already in the environment.
if (existsSync(".env")) process.loadEnvFile(".env");
