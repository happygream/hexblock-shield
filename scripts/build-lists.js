#!/usr/bin/env node
/**
 * HexBlock Shield — filter list compiler
 *
 * Fetches EasyList, EasyPrivacy, and a YouTube-specific block list,
 * then compiles them to Chrome's declarativeNetRequest JSON format.
 *
 * Usage:
 *   node scripts/build-lists.js
 *
 * Output:
 *   lists/easylist.json
 *   lists/easyprivacy.json
 *   lists/youtube_ads.json
 *
 * Chrome's declarativeNetRequest API has a limit of 30,000 dynamic rules
 * and a separate limit per static ruleset. We compile the most impactful
 * rules first and cap each list to stay within limits.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');

const LISTS_DIR = path.join(__dirname, '..', 'lists');

const SOURCES = {
  easylist:   'https://easylist.to/easylist/easylist.txt',
  easyprivacy: 'https://easylist.to/easylist/easyprivacy.txt',
};

// YouTube-specific rules — these target ad request patterns
// that EasyList does not cover because they share domains with content
const YOUTUBE_RULES = [
  { urlFilter: '||googlevideo.com/videoplayback*ctier=L*',  resourceTypes: ['media'] },
  { urlFilter: '||googlevideo.com/videoplayback*&&oad=*',   resourceTypes: ['media'] },
  { urlFilter: '||googlevideo.com/videoplayback*&&adformat=', resourceTypes: ['media'] },
  { urlFilter: '||youtube.com/api/stats/ads',               resourceTypes: ['xmlhttprequest', 'ping'] },
  { urlFilter: '||youtube.com/pagead/',                     resourceTypes: ['script', 'xmlhttprequest'] },
  { urlFilter: '||youtube.com/ptracking',                   resourceTypes: ['ping', 'xmlhttprequest'] },
  { urlFilter: '||youtube.com/youtubei/v1/log_event*adformat', resourceTypes: ['xmlhttprequest'] },
  { urlFilter: '||doubleclick.net^',                        resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame'] },
  { urlFilter: '||googleadservices.com^',                   resourceTypes: ['script', 'xmlhttprequest'] },
  { urlFilter: '||googlesyndication.com^',                  resourceTypes: ['script', 'image', 'xmlhttprequest'] },
  { urlFilter: '||adservice.google.com^',                   resourceTypes: ['script', 'xmlhttprequest'] },
  { urlFilter: '||adservice.google.co.uk^',                 resourceTypes: ['script', 'xmlhttprequest'] },
  { urlFilter: '||yt3.ggpht.com/*/ad-*',                   resourceTypes: ['image'] },
];

// Resource type mapping from Adblock Plus syntax to declarativeNetRequest
const TYPE_MAP = {
  'script':     'script',
  'image':      'image',
  'stylesheet': 'stylesheet',
  'object':     'object',
  'xmlhttprequest': 'xmlhttprequest',
  'subdocument': 'sub_frame',
  'ping':       'ping',
  'media':      'media',
  'font':       'font',
  'other':      'other',
};

const ALL_TYPES = Object.values(TYPE_MAP);

function fetch(url) {
  return new Promise((resolve, reject) => {
    let data = '';
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseEasyList(text, maxRules = 25000) {
  const rules  = [];
  let   ruleId = 1;

  for (const raw of text.split('\n')) {
    if (rules.length >= maxRules) break;

    const line = raw.trim();

    // Skip comments, blank lines, cosmetic filters, and exception rules
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;
    if (line.includes('##') || line.includes('#@#'))       continue;
    if (line.startsWith('@@'))                              continue;
    if (line.startsWith('/') && line.endsWith('/'))        continue; // regex rules — skip

    // Parse options
    let   filter  = line;
    let   options = {};
    const optIdx  = line.lastIndexOf('$');

    if (optIdx > 0) {
      filter  = line.slice(0, optIdx);
      const   optStr = line.slice(optIdx + 1);
      for (const opt of optStr.split(',')) {
        const [k, v] = opt.split('=');
        options[k.replace('~', '!')] = v || true;
      }
    }

    if (!filter) continue;

    // Build declarativeNetRequest urlFilter
    let urlFilter = filter
      .replace(/\*+/g, '*')
      .replace(/\^/g, '*')   // ^ separator — treat as wildcard
      .replace(/\|$/g, '')   // trailing pipe
      .replace(/^\|/, '');   // leading pipe handled below

    // Handle domain anchors
    if (filter.startsWith('||')) {
      urlFilter = '||' + urlFilter.slice(2);
    } else if (filter.startsWith('|')) {
      urlFilter = '|' + urlFilter.slice(1);
    }

    if (urlFilter.length < 4) continue;  // too short to be useful

    // Determine resource types
    let resourceTypes = ALL_TYPES;
    const typeKeys = Object.keys(options).filter(k => TYPE_MAP[k]);
    if (typeKeys.length > 0) {
      resourceTypes = typeKeys.map(k => TYPE_MAP[k]).filter(Boolean);
    }

    // Excluded types — skip if only excluded types listed
    const excludedTypes = Object.keys(options)
      .filter(k => k.startsWith('!') && TYPE_MAP[k.slice(1)])
      .map(k => TYPE_MAP[k.slice(1)]);
    if (excludedTypes.length > 0) {
      resourceTypes = ALL_TYPES.filter(t => !excludedTypes.includes(t));
    }

    // Domain restrictions
    const domainOpt = options['domain'];
    let   condition = { urlFilter, resourceTypes };
    if (typeof domainOpt === 'string') {
      const domains  = domainOpt.split('|');
      const included = domains.filter(d => !d.startsWith('~'));
      const excluded = domains.filter(d =>  d.startsWith('~')).map(d => d.slice(1));
      if (included.length) condition.initiatorDomains  = included;
      if (excluded.length) condition.excludedInitiatorDomains = excluded;
    }

    try {
      rules.push({
        id:       ruleId++,
        priority: 1,
        action:   { type: 'block' },
        condition,
      });
    } catch (_) {
      // Skip malformed rules
    }
  }

  return rules;
}

async function buildList(name, sourceUrl, maxRules) {
  console.log(`Fetching ${name} from ${sourceUrl}...`);
  const text  = await fetch(sourceUrl);
  const rules = parseEasyList(text, maxRules);
  const dest  = path.join(LISTS_DIR, `${name}.json`);
  fs.writeFileSync(dest, JSON.stringify(rules, null, 2));
  console.log(`  Wrote ${rules.length} rules to ${dest}`);
}

function buildYouTubeRules() {
  const rules = YOUTUBE_RULES.map((r, i) => ({
    id:       i + 1,
    priority: 2,  // Higher priority than general lists
    action:   { type: 'block' },
    condition: {
      urlFilter:     r.urlFilter,
      resourceTypes: r.resourceTypes,
    },
  }));
  const dest = path.join(LISTS_DIR, 'youtube_ads.json');
  fs.writeFileSync(dest, JSON.stringify(rules, null, 2));
  console.log(`Wrote ${rules.length} YouTube rules to ${dest}`);
}

async function main() {
  if (!fs.existsSync(LISTS_DIR)) fs.mkdirSync(LISTS_DIR, { recursive: true });

  await buildList('easylist',    SOURCES.easylist,    25000);
  await buildList('easyprivacy', SOURCES.easyprivacy, 25000);
  buildYouTubeRules();

  console.log('\nDone. Commit the lists/ directory.');
}

main().catch(err => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
