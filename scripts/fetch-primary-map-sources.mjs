#!/usr/bin/env node

import { fetchPrimaryRiverHeights } from '../lib/primary-hydrology.mjs';
import { fetchSatelliteFloodStatus } from '../lib/satellite-flood.mjs';

const [riverHeights, satelliteFlood] = await Promise.all([
  fetchPrimaryRiverHeights(),
  fetchSatelliteFloodStatus()
]);

process.stdout.write(JSON.stringify({ riverHeights, satelliteFlood }));
