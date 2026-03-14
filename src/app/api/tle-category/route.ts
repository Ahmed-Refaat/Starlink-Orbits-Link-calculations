import { parseTLEText, type TLEData } from '@/lib/satellites/tle-fetcher';
import { NextRequest } from 'next/server';

const ONE_HOUR_MS = 60 * 60 * 1000;

// Per-category cache: stores raw JSON string for fast streaming
const cache = new Map<string, { json: string; ts: number }>();
// In-flight fetches to avoid duplicate requests
const inflight = new Map<string, Promise<string>>();

// All supported Celestrak groups
export const CELESTRAK_GROUPS: Record<string, string> = {
  'starlink':       'Starlink',
  'gps-ops':        'GPS',
  'glo-ops':        'GLONASS',
  'galileo':        'Galileo',
  'beidou':         'BeiDou',
  'active':         'All Active',
  'stations':       'Space Stations',
  'visual':         'Brightest (Visual)',
  'weather':        'Weather',
  'noaa':           'NOAA',
  'goes':           'GOES',
  'resource':       'Earth Resources',
  'sarsat':         'Search & Rescue',
  'iridium-NEXT':   'Iridium NEXT',
  'oneweb':         'OneWeb',
  'kuiper':         'Kuiper',
  'qianfan':        'Qianfan',
  'orbcomm':        'Orbcomm',
  'globalstar':     'Globalstar',
  'intelsat':       'Intelsat',
  'ses':            'SES',
  'telesat':        'Telesat',
  'military':       'Military',
  'radar':          'Radar Calibration',
  'gnss':           'GNSS',
  'science':        'Science',
  'geodetic':       'Geodetic',
  'engineering':    'Engineering',
  'education':      'Education',
  'amateur':        'Amateur Radio',
  'satnogs':        'SatNOGS',
  'cubesat':        'CubeSats',
  'other-comm':     'Other Comm',
  'last-30-days':   'Last 30 Days',
};

async function fetchFromCelestrak(group: string): Promise<string> {
  // Deduplicate concurrent requests for same group
  const existing = inflight.get(group);
  if (existing) return existing;

  const promise = (async () => {
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
    // Use 30s timeout for large datasets like 'active'
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const response = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`Celestrak fetch failed: ${response.status}`);
      const text = await response.text();
      const data: TLEData[] = parseTLEText(text);
      const json = JSON.stringify(data);
      cache.set(group, { json, ts: Date.now() });
      return json;
    } finally {
      clearTimeout(timer);
      inflight.delete(group);
    }
  })();

  inflight.set(group, promise);
  return promise;
}

export async function GET(req: NextRequest) {
  const group = req.nextUrl.searchParams.get('group') || 'starlink';

  if (!CELESTRAK_GROUPS[group]) {
    return new Response(JSON.stringify({ error: `Unknown group: ${group}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const now = Date.now();
  const cached = cache.get(group);

  // Serve from cache if fresh
  if (cached && now - cached.ts < ONE_HOUR_MS) {
    return new Response(cached.json, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        'Content-Length': String(Buffer.byteLength(cached.json, 'utf8')),
      },
    });
  }

  try {
    const json = await fetchFromCelestrak(group);
    return new Response(json, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        'Content-Length': String(Buffer.byteLength(json, 'utf8')),
      },
    });
  } catch (error) {
    // Serve stale cache if available
    if (cached) {
      return new Response(cached.json, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(cached.json, 'utf8')),
        },
      });
    }
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
