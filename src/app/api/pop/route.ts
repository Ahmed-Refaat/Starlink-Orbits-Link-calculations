import { NextResponse } from 'next/server';
import { promises as dns } from 'dns';
import { parsePopHostname } from '@/lib/utils/pop';

// Cache successful results — PoP rarely changes during a session
let cached: { ip: string; rdns: string; pop: string; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const IP_SERVICES = [
  'https://api.ipify.org',
  'https://ifconfig.me',
  'https://icanhazip.com',
  'https://checkip.amazonaws.com',
];

async function getPublicIp(): Promise<string | null> {
  for (const url of IP_SERVICES) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      const ip = (await res.text()).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
    } catch {
      // try next service
    }
  }
  return null;
}

export async function GET() {
  // Return cache if fresh
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json({ ip: cached.ip, rdns: cached.rdns, pop: cached.pop });
  }

  try {
    const ip = await getPublicIp();
    if (!ip) {
      return NextResponse.json({ ip: null, rdns: null, pop: 'Unknown' });
    }

    // Use Node's built-in dns.reverse() — no subprocess, no chunked encoding issues
    let rdns = '';
    try {
      const hostnames = await dns.reverse(ip);
      rdns = hostnames[0] ?? '';
    } catch {
      // rDNS lookup failed — not critical
    }

    const pop = parsePopHostname(rdns) || 'Unknown';

    if (pop !== 'Unknown') {
      cached = { ip, rdns, pop, ts: Date.now() };
    }

    return NextResponse.json({ ip, rdns, pop });
  } catch {
    return NextResponse.json({ ip: null, rdns: null, pop: 'Unknown' });
  }
}
