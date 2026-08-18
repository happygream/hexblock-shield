#!/usr/bin/env python3
"""
HexBlock Shield — EasyList / EasyPrivacy -> declarativeNetRequest converter.

Emits Manifest V3 declarativeNetRequest rules that:
  1. NEVER block main_frame or sub_frame (top-level pages / legit embeds).
  2. Preserve $third-party as "domainType": "thirdParty", so an ad-domain block
     only fires when loaded as a third party on another site — never when the
     user visits it directly or it loads its own resources. This is what stops
     legitimate sites (news sites, link shorteners) from breaking.
  3. Skip filters we cannot model safely rather than over-block.

Cosmetic filters (##, #?#, #@#) are ignored (handled by the content script).
Exception rules (@@) become allow rules where simple.

Usage:
  python3 convert-easylist.py sources/easylist.txt   ../lists/easylist.json    1
  python3 convert-easylist.py sources/easyprivacy.txt ../lists/easyprivacy.json 100000
"""
import json, sys

DEFAULT_BLOCK_TYPES = ["script","image","stylesheet","font","object",
                       "xmlhttprequest","ping","media","websocket","other"]

OPT_TO_TYPE = {"script":"script","image":"image","stylesheet":"stylesheet",
               "font":"font","object":"object","object-subrequest":"object",
               "xmlhttprequest":"xmlhttprequest","ping":"ping","media":"media",
               "websocket":"websocket","other":"other"}

FRAME_OPTS = {"document","subdocument","popup","elemhide","generichide",
              "genericblock","csp","inline-script","inline-font"}

def parse_options(optstr):
    resource_types=set(); third_party=None; domains=[]; excluded=[]
    for opt in optstr.split(','):
        opt=opt.strip()
        if not opt: continue
        if opt=="third-party": third_party=True
        elif opt=="~third-party": third_party=False
        elif opt.startswith("domain="):
            for d in opt[len("domain="):].split('|'):
                if d.startswith('~'): excluded.append(d[1:])
                elif d: domains.append(d)
        elif opt in OPT_TO_TYPE: resource_types.add(OPT_TO_TYPE[opt])
        elif opt.startswith('~') and opt[1:] in OPT_TO_TYPE: pass
        elif opt in FRAME_OPTS: pass
        elif opt in ("match-case","important"): pass
        else: return None,None,None,None,True
    return resource_types,third_party,domains,excluded,False

def parse_filter(line, rule_id):
    s=line.strip()
    if not s or s.startswith('!') or s.startswith('['): return None
    if '##' in s or '#@#' in s or '#?#' in s or '#$#' in s: return None
    is_exception=s.startswith('@@')
    if is_exception: s=s[2:]
    if s.startswith('/') and s.endswith('/'): return None
    if '$' in s:
        url_part,optstr=s.split('$',1)
    else:
        url_part,optstr=s,''
    resource_types,third_party,domains,excluded,skip=set(),None,[],[],False
    if optstr:
        resource_types,third_party,domains,excluded,skip=parse_options(optstr)
        if skip: return None
    if not url_part: return None
    cond={"urlFilter":url_part}
    rts=sorted(resource_types) if resource_types else list(DEFAULT_BLOCK_TYPES)
    if not rts: rts=list(DEFAULT_BLOCK_TYPES)
    cond["resourceTypes"]=rts
    if third_party is True: cond["domainType"]="thirdParty"
    elif third_party is False: cond["domainType"]="firstParty"
    if domains: cond["initiatorDomains"]=domains
    if excluded: cond["excludedInitiatorDomains"]=excluded
    return {"id":rule_id,
            "priority":1000 if is_exception else 1,
            "action":{"type":"allow" if is_exception else "block"},
            "condition":cond}

def convert(path,start_id):
    rules=[]; rid=start_id; seen=set()
    for line in open(path,encoding='utf-8',errors='ignore'):
        r=parse_filter(line,rid)
        if not r: continue
        key=(r["action"]["type"],r["condition"]["urlFilter"],r["condition"].get("domainType"))
        if key in seen: continue
        seen.add(key); rules.append(r); rid+=1
    return rules

def validate(rules):
    for r in rules:
        if r["action"]["type"]=="block":
            rts=r["condition"].get("resourceTypes")
            if not rts: raise SystemExit(f"Rule {r['id']}: block with no resourceTypes")
            if "main_frame" in rts or "sub_frame" in rts:
                raise SystemExit(f"Rule {r['id']}: block includes frame type {rts}")

if __name__=='__main__':
    if len(sys.argv)<4:
        print(__doc__); sys.exit(1)
    src,out,start=sys.argv[1],sys.argv[2],int(sys.argv[3])
    rules=convert(src,start); validate(rules)
    json.dump(rules,open(out,'w'),separators=(',',':'))
    print(f"{out}: {len(rules)} rules (ids {start}..{start+len(rules)-1})",file=sys.stderr)
