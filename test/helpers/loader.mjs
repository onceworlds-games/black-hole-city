// A module loader for the smoke test: stylesheets import as nothing, and 'three' is the real three.js with a renderer
// that draws nothing (there is no GPU in node).
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shim = pathToFileURL(resolvePath(here, 'three-shim.mjs')).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'three' && !String(context.parentURL).endsWith('three-shim.mjs')) return { url: shim, shortCircuit: true };
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };
  return next(url, context);
}
