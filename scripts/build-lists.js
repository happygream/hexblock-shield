#!/usr/bin/env node
/**
 * HexBlock Shield — filter list compiler
 *
 * Fetches EasyList and EasyPrivacy and compiles them to Chrome's
 * declarativeNetRequest JSON, writing a single curated lists/filters.json.
 *
 * CRITICAL CORRECTNESS RULES (do not remove — these prevent the bug where
 * legitimate sites were blocked):
 *   1. Block rules NEVER include main_frame or sub_frame.
 *   2. $third-party is preserved as domainType:"thirdParty" so an ad-domain
 *      rule only fires when loaded as a third party on another site.
 *   3. The '^' separator is kept as a real DNR anchor, NOT converted to '*',
 *      so ||indiatimes.com^ does not become a whole-domain wildcard.
 *   4. Output is a single curated ruleset capped under Chrome's 30,000
 *      enabled-static-rule guarantee.
 *
 * Usage: node scripts/build-lists.js
 * Output: lists/filters.json, lists/youtube_ads.json
 */
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const LISTS_DIR = path.join(__dirname, '..', 'lists');
const BUDGET    = 24000;

const SOURCES = {
  easylist:    'https://easylist.to/easylist/easylist.txt',
  easyprivacy: 'https://easylist.to/easylist/easyprivacy.txt',
};

const DEFAULT_TYPES = ['script','image','stylesheet','font','object',
                       'xmlhttprequest','ping','media','websocket','other'];

const TYPE_MAP = {
  script:'script', image:'image', stylesheet:'stylesheet', object:'object',
  'object-subrequest':'object', xmlhttprequest:'xmlhttprequest',
  ping:'ping', media:'media', font:'font', other:'other', websocket:'websocket',
};

const YOUTUBE_RULES = [
  { urlFilter: '||googlevideo.com/videoplayback*ctier=L*',  resourceTypes: ['media'] },
  { urlFilter: '||googlevideo.com/videoplayback*&&oad=*',   resourceTypes: ['media'] },
  { urlFilter: '||googlevideo.com/videoplayback*&&adformat=', resourceTypes: ['media'] },
  { urlFilter: '||youtube.com/api/stats/ads',               resourceTypes: ['xmlhttprequest','ping'] },
  { urlFilter: '||youtube.com/pagead/',                     resourceTypes: ['script','xmlhttprequest'] },
  { urlFilter: '||youtube.com/ptracking',                   resourceTypes: ['ping','xmlhttprequest'] },
  { urlFilter: '||youtube.com/youtubei/v1/log_event*adformat', resourceTypes: ['xmlhttprequest'] },
  { urlFilter: '||doubleclick.net^',                        resourceTypes: ['script','image','xmlhttprequest'] },
  { urlFilter: '||googleadservices.com^',                   resourceTypes: ['script','xmlhttprequest'] },
  { urlFilter: '||googlesyndication.com^',                  resourceTypes: ['script','image','xmlhttprequest'] },
  { urlFilter: '||adservice.google.com^',                   resourceTypes: ['script','xmlhttprequest'] },
  { urlFilter: '||adservice.google.co.uk^',                 resourceTypes: ['script','xmlhttprequest'] },
  { urlFilter: '||yt3.ggpht.com/*/ad-*',                    resourceTypes: ['image'] },
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    let data = '';
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302)
        return fetch(res.headers.location).then(resolve).catch(reject);
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

const FRAME_OPTS = new Set(['document','subdocument','popup','elemhide',
  'generichide','genericblock','csp','inline-script','inline-font']);
const IGNORE_OPTS = new Set(['match-case','important']);

function parseLine(line) {
  const s = line.trim();
  if (!s || s.startsWith('!') || s.startsWith('[')) return null;
  if (s.includes('##') || s.includes('#@#') || s.includes('#?#') || s.includes('#$#')) return null;
  const isException = s.startsWith('@@');
  const body = isException ? s.slice(2) : s;
  if (body.startsWith('/') && body.endsWith('/')) return null;

  const dollar = body.indexOf('$');
  const filter = dollar >= 0 ? body.slice(0, dollar) : body;
  const optStr = dollar >= 0 ? body.slice(dollar + 1) : '';
  if (!filter) return null;

  let types = new Set(), thirdParty = null, domains = [], excluded = [], skip = false;
  if (optStr) {
    for (const raw of optStr.split(',')) {
      const opt = raw.trim();
      if (!opt) continue;
      if (opt === 'third-party') thirdParty = true;
      else if (opt === '~third-party') thirdParty = false;
      else if (opt.startsWith('domain=')) {
        for (const d of opt.slice(7).split('|')) {
          if (d.startsWith('~')) excluded.push(d.slice(1)); else if (d) domains.push(d);
        }
      } else if (TYPE_MAP[opt]) types.add(TYPE_MAP[opt]);
      else if (opt.startsWith('~') && TYPE_MAP[opt.slice(1)]) { }
      else if (FRAME_OPTS.has(opt)) { }
      else if (IGNORE_OPTS.has(opt)) { }
      else { skip = true; break; }
    }
  }
  if (skip) return null;

  const urlFilter = filter;
  if (urlFilter.length < 3) return null;

  const condition = { urlFilter, resourceTypes: types.size ? [...types] : DEFAULT_TYPES.slice() };
  if (thirdParty === true)  condition.domainType = 'thirdParty';
  if (thirdParty === false) condition.domainType = 'firstParty';
  if (domains.length)  condition.initiatorDomains = domains;
  if (excluded.length) condition.excludedInitiatorDomains = excluded;

  return { action: { type: isException ? 'allow' : 'block' },
           priority: isException ? 1000 : 1, condition };
}

function hasPath(uf) {
  return uf.replace(/^\|\|/, '').replace(/\^$/, '').includes('/');
}

async function main() {
  if (!fs.existsSync(LISTS_DIR)) fs.mkdirSync(LISTS_DIR, { recursive: true });

  const raw = [];
  for (const [name, url] of Object.entries(SOURCES)) {
    console.log(`Fetching ${name}...`);
    const text = await fetch(url);
    for (const line of text.split('\n')) {
      const r = parseLine(line);
      if (r) raw.push(r);
    }
  }

  const seen = new Set(), all = [];
  for (const r of raw) {
    const k = r.action.type + '|' + r.condition.urlFilter + '|' + (r.condition.domainType || '');
    if (seen.has(k)) continue;
    seen.add(k); all.push(r);
  }

  const tp    = all.filter(r => r.action.type==='block' && r.condition.domainType==='thirdParty');
  const paths = all.filter(r => r.action.type==='block' && r.condition.domainType!=='thirdParty' && hasPath(r.condition.urlFilter));
  const dom   = all.filter(r => r.action.type==='block' && r.condition.domainType!=='thirdParty' && !hasPath(r.condition.urlFilter));
  const ordered = [...tp, ...paths, ...dom].slice(0, BUDGET);

  ordered.forEach((r, i) => { r.id = i + 1; });

  for (const r of ordered) {
    if (r.action.type === 'block') {
      const t = r.condition.resourceTypes;
      if (!t || !t.length || t.includes('main_frame') || t.includes('sub_frame'))
        throw new Error(`Rule ${r.id} unsafe resourceTypes: ${JSON.stringify(t)}`);
    }
  }

  fs.writeFileSync(path.join(LISTS_DIR, 'filters.json'), JSON.stringify(ordered));
  console.log(`Wrote ${ordered.length} rules to lists/filters.json (tp:${tp.length} path:${paths.length} dom:${dom.length})`);

  const yt = YOUTUBE_RULES.map((r, i) => ({
    id: i + 1, priority: 2, action: { type: 'block' },
    condition: { urlFilter: r.urlFilter, resourceTypes: r.resourceTypes },
  }));
  fs.writeFileSync(path.join(LISTS_DIR, 'youtube_ads.json'), JSON.stringify(yt));
  console.log(`Wrote ${yt.length} YouTube rules to lists/youtube_ads.json`);
  console.log('Done. Review git diff, then commit lists/.');
}

main().catch(err => { console.error('Build failed:', err.message); process.exit(1); });
