"""Run by hand: python3 tools/logos.py [slug ...]. Needs Pillow. Fetches each provider's own icon, re-encodes it as a
small PNG in site/logos/ and records where it came from in data/logos.json. Existing logos are kept unless named."""
import base64, concurrent.futures, html.parser, io, json, pathlib, subprocess, sys, tempfile, urllib.parse, urllib.request
from PIL import Image
ROOT = pathlib.Path(__file__).parents[1]
Image.MAX_IMAGE_PIXELS = 20_000_000
UA = {"User-Agent": "Mozilla/5.0 (compatible; agent-sandboxes-leaderboard/1.0)"}

class Links(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(); self.out = []
    def handle_starttag(self, t, a):
        a = dict(a); rel = (a.get("rel") or "").lower()
        if t == "link" and "icon" in rel and "mask" not in rel and a.get("href"):
            self.out.append(("apple" not in rel, a["href"]))

def get(u, cap):
    if urllib.parse.urlsplit(u).scheme != "https":
        raise ValueError("https only")
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=15) as r:
        if urllib.parse.urlsplit(r.geturl()).scheme != "https":
            raise ValueError("https only")
        b = r.read(cap + 1)
        if len(b) > cap:
            raise ValueError("too big")
        return b, r.geturl()

def svg(b):
    """Rasterise with macOS sips; only the PNG is ever published."""
    if b"<!ENTITY" in b or b"<script" in b.lower():
        raise ValueError("unsafe svg")
    with tempfile.TemporaryDirectory() as t:
        t = pathlib.Path(t); (t / "a.svg").write_bytes(b)
        subprocess.run(["sips", "-s", "format", "png", "-Z", "128", str(t / "a.svg"), "--out", str(t / "a.png")],
                       check=True, capture_output=True, timeout=20)
        return (t / "a.png").read_bytes()

def icon(u):
    if u.startswith("data:image/svg"):
        head, _, body = u.partition(",")
        b = base64.b64decode(body) if "base64" in head else urllib.parse.unquote(body).encode()
    else:
        b = get(u, 2_000_000)[0]
    if b.lstrip()[:5] in (b"<svg ", b"<?xml") and b"<svg" in b[:2000]:
        b = svg(b)
    im = Image.open(io.BytesIO(b), formats=["PNG", "ICO", "JPEG", "WEBP", "GIF"])
    im.load()
    w, h = im.size
    if min(w, h) < 16 or max(w, h) > 1.5 * min(w, h):
        raise ValueError(f"size {w}x{h}")
    im = im.convert("RGBA")
    if im.getchannel("A").getextrema()[1] < 30:
        raise ValueError("blank")
    return im, min(w, h)

def one(p, override):
    gh = lambda u: "https://github.com/" + urllib.parse.urlsplit(u).path.split("/")[1] + ".png?size=128"
    site = override or p["website"]
    host = urllib.parse.urlsplit(site).hostname
    cands = []
    if host == "github.com":
        if urllib.parse.urlsplit(site).path.strip("/").split("/")[0] != "features":
            cands = [gh(site)]
        site = "https://github.com/"
    best = None
    pages = [] if cands else dict.fromkeys([site, f"https://{host}/"])
    for page in pages:
        try:
            body, final = get(page, 6_000_000)
            x = Links(); x.feed(body.decode("utf-8", "replace"))
            cands += [urllib.parse.urljoin(final, h) for _, h in sorted(x.out, key=lambda t: t[0])]
        except Exception:
            pass
        cands += [urllib.parse.urljoin(page, "/apple-touch-icon.png"), urllib.parse.urljoin(page, "/favicon.ico"), urllib.parse.urljoin(page, "/favicon.png")]
    if p.get("repoUrl") and "github.com" in p["repoUrl"]:
        cands.append(gh(p["repoUrl"]))
    for u in dict.fromkeys(cands):
        try:
            im, s = icon(u)
        except Exception:
            continue
        if not best or s > best[1]:
            best = (im, s, u)
        if s >= 64:
            break
    return p["slug"], best

def main():
    ps = json.loads((ROOT / "_site/data/site.json").read_text())["providers"]
    f = ROOT / "data/logos.json"
    rec = json.loads(f.read_text()) if f.exists() else {}
    args = dict(a.partition("=")[::2] for a in sys.argv[1:])   # slug or slug=https://page
    todo = [p for p in ps if (p["slug"] in args if args else p["slug"] not in rec)]
    d = ROOT / "site/logos"; d.mkdir(exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(12) as ex:
        for slug, best in ex.map(lambda p: one(p, args.get(p["slug"])), todo):
            if not best:
                print("no logo:", slug); continue
            im, s, u = best
            px = [p for p in im.getdata() if p[3] > 60]
            if len(px) < 0.98 * im.width * im.height and sum(min(p[:3]) for p in px) / len(px) > 225:
                dark = Image.new("RGBA", im.size, "#14212a"); dark.alpha_composite(im); im = dark   # white on clear
            im.thumbnail((64, 64), Image.LANCZOS)
            c = Image.new("RGBA", (64, 64)) if s >= 64 else im
            if c is not im:
                c.paste(im, ((64 - im.width) // 2, (64 - im.height) // 2))
            c.save(d / f"{slug}.png", optimize=True)
            rec[slug] = {"from": u, "px": s}
            if s < 32: print("small:", slug, s, u)
    f.write_text(json.dumps(dict(sorted(rec.items())), indent=1) + "\n")
    print(len(rec), "of", len(ps))

main()
