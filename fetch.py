"""Fetch the feed, validate it, keep history. Fails closed: on any problem nothing is written and exit code is 1."""
import argparse, copy, datetime, json, math, pathlib, re, sys, urllib.request

FEED = "https://aisandboxhunt.com/api/v1/providers.json"
DATA = pathlib.Path(__file__).parent / "data"
MAX_BYTES, MAX_DROP = 10_000_000, 0.10
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,80}$")

class BadFeed(Exception):
    pass

def _no_const(x):
    raise BadFeed(f"non-finite number {x}")

def parse(raw):
    try:
        return json.loads(raw, parse_constant=_no_const)
    except (ValueError, UnicodeDecodeError, RecursionError) as e:
        raise BadFeed(f"not valid JSON: {e}") from None

def _need(ok, msg):
    if not ok:
        raise BadFeed(msg)

def _num(v, where):
    _need(v is None or (isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0),
          f"{where}: not a non-negative number or null: {v!r:.60}")

def _str(v, where):
    _need(isinstance(v, str) and v.strip(), f"{where}: missing text")

def _bool(v, where):
    _need(v is None or isinstance(v, bool), f"{where}: not true, false or null")

def validate(feed, last_good=None):
    _need(isinstance(feed, dict), "top level is not an object")
    for k in ("license", "updated", "categories", "providers"):
        _need(feed.get(k), f"missing {k}")
    _need("CC BY 4.0" in str(feed["license"]), "license is no longer CC BY 4.0; a person must look")
    _need(isinstance(feed["providers"], list) and isinstance(feed["categories"], list), "lists expected")
    for c in feed["categories"]:
        _need(isinstance(c, dict), "category is not an object")
        _str(c.get("id"), "category id")
        _str(c.get("name"), "category name")
    seen = set()
    for i, p in enumerate(feed["providers"]):
        _need(isinstance(p, dict), f"provider {i} is not an object")
        s = p.get("slug")
        _need(isinstance(s, str) and SLUG.match(s), f"provider {i}: bad slug {s!r:.60}")
        _need(s not in seen, f"duplicate slug {s}")
        seen.add(s)
        for k in ("name", "website", "lastChecked", "status"):
            _str(p.get(k), f"{s}.{k}")
        _need(re.match(r"^\d{4}-\d\d-\d\d$", p["lastChecked"]), f"{s}.lastChecked is not a date")
        for k in ("categories", "sdks", "sources", "benchmarks", "watchOut", "bestFor"):
            _need(isinstance(p.get(k), list), f"{s}.{k} is not a list")
        _need(p["categories"] and all(isinstance(c, str) for c in p["categories"]), f"{s}.categories empty")
        for k in ("sdks", "watchOut", "bestFor"):
            _need(all(isinstance(x, str) for x in p[k]), f"{s}.{k} has non-text")
        for k in ("sources", "benchmarks"):
            _need(all(isinstance(x, dict) for x in p[k]), f"{s}.{k} has a non-object")
        for b in p["benchmarks"]:
            for k in ("source", "metric", "unit", "date", "better"):
                _str(b.get(k), f"{s}.benchmark {k}")
            _num(b.get("value"), f"{s}.benchmark value")
        for k in ("features", "pricing", "comparablePrice", "score"):
            _need(isinstance(p.get(k), dict), f"{s}.{k} is not an object")
        f, pr = p["features"], p["pricing"]
        for k in ("maxVcpu", "maxMemoryGib", "maxSessionHours"):
            _need(k in f, f"{s}.features.{k} missing")
            _num(f[k], f"{s}.features.{k}")
        for k in ("gpu", "pauseResume", "snapshots", "customImages", "networkControls"):
            _need(k in f, f"{s}.features.{k} missing")
            _bool(f[k], f"{s}.features.{k}")
        for k in ("openSource", "selfHost"):
            _bool(p.get(k), f"{s}.{k}")
        _need(isinstance(pr.get("rates"), dict), f"{s}.rates missing")
        for k in ("vcpuHour", "gibHour", "instanceHour", "storageGibMonth", "unitVcpu", "unitGib", "browserHour"):
            _need(k in pr["rates"], f"{s}.rates.{k} missing")
            _num(pr["rates"][k], f"{s}.rates.{k}")
        _bool(pr["rates"].get("cpuActiveOnly"), f"{s}.rates.cpuActiveOnly")
        for k in ("plans", "gpu", "notes"):
            _need(isinstance(pr.get(k), list), f"{s}.pricing.{k} is not a list")
        _need(all(isinstance(x, str) for x in pr["notes"]), f"{s}.notes has non-text")
        for x in pr["plans"]:
            _need(isinstance(x, dict), f"{s}.plan is not an object")
            _str(x.get("name"), f"{s}.plan name")
            for k in ("monthlyFee", "includedUsageUsd", "includedVcpuHours", "includedGibHours"):
                _need(k in x, f"{s}.plan.{k} missing")
                _num(x[k], f"{s}.plan.{k}")
            _bool(x.get("capped"), f"{s}.plan.capped")
        for g in pr["gpu"]:
            _need(isinstance(g, dict), f"{s}.gpu is not an object")
            _str(g.get("type"), f"{s}.gpu type")
            _num(g.get("perHour"), f"{s}.gpu price")
        _need(pr.get("freeTierKind") in ("recurring", "credit", "none"), f"{s}.freeTierKind {pr.get('freeTierKind')!r:.40}")
        _str(pr.get("freeTier"), f"{s}.freeTier")
        for v in p["comparablePrice"].values():
            _num(v, f"{s}.comparablePrice")
    _need(seen, "no providers")
    if last_good:
        old = {p["slug"] for p in last_good["providers"]}
        gone = old - seen
        _need(len(gone) <= MAX_DROP * len(old), f"{len(gone)} of {len(old)} providers disappeared: {sorted(gone)[:8]}")
    return feed

def prices(feed):
    """The price-relevant slice that history keeps."""
    return {p["slug"]: {"name": p["name"], "status": p["status"], "rates": {k: v for k, v in p["pricing"]["rates"].items()
              if isinstance(v, (int, float)) or v is None},
              "plans": {x["name"]: {k: x[k] for k in ("monthlyFee", "includedUsageUsd", "includedVcpuHours", "includedGibHours")} for x in p["pricing"]["plans"]},
              "gpu": {g["type"]: g["perHour"] for g in p["pricing"]["gpu"]},
              "freeTierKind": p["pricing"]["freeTierKind"], "freeTier": p["pricing"]["freeTier"],
              "comparablePrice": p["comparablePrice"]} for p in feed["providers"]}

def _flat(o, pre=""):
    if not isinstance(o, dict):
        return {pre: o}
    out = {}
    for k, v in o.items():
        out.update(_flat(v, f"{pre} > {k}" if pre else k))
    return out

def diff(old, new, date):
    ev = []
    for s in sorted(old.keys() | new.keys()):
        if s not in new:
            ev.append({"date": date, "slug": s, "name": old[s]["name"], "field": "listing", "from": "listed", "to": "removed from the feed"})
        elif s not in old:
            ev.append({"date": date, "slug": s, "name": new[s]["name"], "field": "listing", "from": None, "to": "added to the feed"})
        else:
            a, b = _flat(old[s]), _flat(new[s])
            for k in sorted(a.keys() | b.keys()):
                if a.get(k) != b.get(k):
                    ev.append({"date": date, "slug": s, "name": new[s]["name"], "field": k, "from": a.get(k), "to": b.get(k)})
    return ev

def _load(p, default=None):
    return json.loads(p.read_text()) if p.exists() else default

def _dump(p, o, indent=1):
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(o, indent=indent, ensure_ascii=False, sort_keys=False) + "\n")
    tmp.replace(p)

def apply(raw, data=DATA, now=None):
    """Validate first, then write. Returns a summary dict."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    last = _load(data / "source.json")
    feed = validate(parse(raw), last)
    day = now.strftime("%Y-%m-%d")
    changed = feed != last
    events = []
    if changed:
        new = prices(feed)
        if last is None or prices(last) != new:
            if last is not None:
                events = diff(prices(last), new, day)
                _dump(data / "changes.json", _load(data / "changes.json", []) + events)
            _dump(data / "history" / f"{day}.json", new, None)
        _dump(data / "source.json", feed)
    _dump(data / "status.json", {"lastGoodFetch": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "feedUpdated": feed["updated"],
                                 "providers": len(feed["providers"])})
    return {"changed": changed, "providers": len(feed["providers"]), "priceEvents": len(events)}

def get(url=FEED):
    req = urllib.request.Request(url, headers={"User-Agent": "agent-sandboxes-leaderboard/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        if r.status != 200:
            raise BadFeed(f"HTTP {r.status}")
        raw = r.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise BadFeed("feed is too large")
    return raw

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", help="read a local file instead of the live feed")
    ap.add_argument("--url", default=FEED)
    a = ap.parse_args()
    try:
        raw = pathlib.Path(a.file).read_bytes() if a.file else get(a.url)
        print(json.dumps(apply(raw)))
    except (BadFeed, OSError) as e:
        print(f"::error::feed rejected, last good data kept: {type(e).__name__}: {str(e)[:300]}")
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
