import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const [major, minor, patch] = process.versions.node.split('.').map(Number);
const supported = major === 22 && (minor > 22 || (minor === 22 && patch >= 3));
console.log(`Node ${process.versions.node}: ${supported ? 'supported' : 'use Node 22.23.3 (nvm use)'}`);
try { loadEnvFile(resolve('.env')); }
catch (error) { if (error.code !== 'ENOENT') { console.error('Local configuration could not be loaded.'); process.exitCode = 1; } }
const has = name => Boolean(process.env[name]?.trim());
console.log(`Dependencies: ${existsSync('node_modules') ? 'installed' : 'run npm ci'}`);
console.log(`Production build: ${existsSync('apps/web/dist/agree-first/browser/index.html') && existsSync('apps/api/dist/index.js') ? 'available' : 'run npm run build'}`);
console.log(`PayPal sandbox: ${has('PAYPAL_CLIENT_ID') && has('PAYPAL_CLIENT_SECRET') ? 'credentials present; verify in checkout' : 'add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env'}`);
console.log(`AI gateway: ${has('ASTRO_GATEWAY_URL') && has('ASTRO_GATEWAY_API_KEY') ? 'settings present; verify Generate AI draft' : existsSync('.tools/astropods/gateway-runtime.json') ? 'local runtime present; check its connection in the app' : 'add ASTRO_GATEWAY_URL and ASTRO_GATEWAY_API_KEY to .env or use the Windows connector'}`);
console.log('Only readiness is shown. Credentials are never printed. No provider calls were made.');
if (!supported) process.exitCode = 1;
