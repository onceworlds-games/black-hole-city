// Cities are built once per seed and shared by everything on the page that needs one (the host's rules, the picture).
// Pure: no DOM, no three.js.

import { generateCity, generateLobby } from '../logic/city.js';
import { LOBBY_SEED } from '../logic/config.js';

const cache = new Map();
let lobby = null;

export function getCity(seed) {
  let city = cache.get(seed);
  if (city) {
    cache.delete(seed); // asking again makes it the freshest
  } else {
    city = generateCity(seed);
  }
  cache.set(seed, city);
  // the current round, the next one and the title's stay; older ones go
  while (cache.size > 6) cache.delete(cache.keys().next().value);
  return city;
}

export function getLobby() {
  if (!lobby) lobby = generateLobby(LOBBY_SEED);
  return lobby;
}
