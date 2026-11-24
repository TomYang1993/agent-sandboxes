import copy, json, pathlib, sys, tempfile, unittest
ROOT = pathlib.Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))
import build, derive

FEED = json.loads((ROOT / "tests/feed-2026-11-24.json").read_text())
EMPTY = {"entries": {}, "manual": []}
def one(ps, s): return next(p for p in ps if p["slug"] == s)

class Overlay(unittest.TestCase):
    def test_null_override_means_unknown(self):
        s = FEED["providers"][0]["slug"]
        ps, _ = build.make(FEED, {"entries": {s: {"date": "2026-11-23", "override": {"cardRequiredForFree": None, "riskFlag": None, "inkling2MiniFit": {"verdict": "unknown", "why": "x"}}}}, "manual": []})
        p = one(ps, s)
        self.assertIn("cardRequiredForFree", p["override"])
        self.assertIsNone(p["effective"]["cardRequiredForFree"])
    def test_null_beats_known_source(self):
        ps, _ = build.make(FEED, EMPTY)
        s = next(p["slug"] for p in ps if p["effective"]["cardRequiredForFree"] is False)
        ps, _ = build.make(FEED, {"entries": {s: {"override": {"cardRequiredForFree": None}}}, "manual": []})
        self.assertIsNone(one(ps, s)["effective"]["cardRequiredForFree"])
    def test_review_flag(self):
        ov = {"entries": {"e2b": {"date": "2026-11-23", "override": {}, "baseline": {"pricing.freeTier": "old text"}}}, "manual": []}
        ps, warn = build.make(FEED, ov)
        self.assertEqual(one(ps, "e2b")["review"][0]["field"], "pricing.freeTier")
        self.assertTrue(any(w["slug"] == "e2b" for w in warn))
    def test_shipped_overlay_has_baselines(self):
        ov = json.loads((ROOT / "data/overlay.json").read_text())
        for s, e in ov["entries"].items():
            self.assertTrue(e["date"], s)
            for k in e.get("override", {}):
                self.assertTrue(e.get("baseline"), f"{s}.{k} has no baseline to notice feed changes")
    def test_entry_for_missing_provider_is_flagged(self):
        _, warn = build.make(FEED, {"entries": {"gone-co": {"override": {}}}, "manual": []})
        self.assertEqual(warn[0]["slug"], "gone-co")
    def test_tenki_once(self):
        ps, _ = build.make(FEED, json.loads((ROOT / "data/overlay.json").read_text()))
        self.assertEqual(len([p for p in ps if "tenki" in p["slug"] or "luxor" in p["name"].lower()]), 1)
    def test_tokens_never_measured(self):
        for p in build.make(FEED, EMPTY)[0]:
            self.assertEqual(p["tokenEfficiency"], {"value": None, "status": "not_measured"})

class Untrusted(unittest.TestCase):
    def test_urls(self):
        for u in ("javascript:alert(1)", "data:text/html,x", "//x.com", "https://a@b.com", 'https://x.com/"onclick', "https://x .com", "ftp://x", None, 5, "https://"):
            self.assertIsNone(build.safe_url(u), u)
        self.assertEqual(build.safe_url("https://x.com/a?b=1"), "https://x.com/a?b=1")
    def test_bad_link_removed_and_markup_escaped(self):
        f = copy.deepcopy(FEED); p = f["providers"][0]
        p["website"], p["name"] = "javascript:alert(1)", "<img src=x onerror=alert(1)>\n# [x](http://e.vil)"
        p["sources"] = [{"url": "data:text/html,1", "quote": "q"}]
        ps, _ = build.make(f, EMPTY)
        q = one(ps, p["slug"])
        self.assertIsNone(q["website"]); self.assertIsNone(q["sources"][0]["url"])
        md = build.markdown(ps, {"lastGoodFetch": "x"})
        self.assertNotIn("<img", md.replace("\\<img", "")); self.assertNotIn("\n# [x]", md); self.assertNotIn("javascript:", md)
    def test_frontend_never_builds_html_from_strings(self):
        js = (ROOT / "site/app.js").read_text()
        for bad in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"):
            self.assertNotIn(bad, js)

class Site(unittest.TestCase):
    def test_full_build(self):
        with tempfile.TemporaryDirectory() as t:
            out = pathlib.Path(t) / "s"
            build.main(out)
            d = json.loads((out / "data/site.json").read_text())
            self.assertEqual(len(d["providers"]), len(list((out / "data/p").glob("*.json"))))
            html = (out / "index.html").read_text()
            self.assertIn("creativecommons.org/licenses/by/4.0", html); self.assertIn("aisandboxhunt.com", html); self.assertIn("compute-tracker", html)
            self.assertIn("CC BY 4.0", (out / "llms.txt").read_text())

class Logos(unittest.TestCase):
    def test_logos_are_small_local_pngs(self):
        for s, v in json.loads((ROOT / "data/logos.json").read_text()).items():
            b = (ROOT / f"site/logos/{s}.png").read_bytes()
            self.assertEqual(b[:8], b"\x89PNG\r\n\x1a\n", s); self.assertLess(len(b), 30000, s); self.assertTrue(build.safe_url(v["from"]) or v["from"].startswith("data:image/"), s)
    def test_no_logo_is_null(self):
        f = copy.deepcopy(FEED); f["providers"][0]["slug"] = "brand-new"
        self.assertIsNone(one(build.make(f, EMPTY)[0], "brand-new")["logo"])

class Derive(unittest.TestCase):
    def card(self, t, k="credit"): return derive.card_required(t, k)
    def test_card(self):
        self.assertIs(self.card("$100 credit, no credit card required."), False)
        self.assertIs(self.card("Credit card required."), True)
        self.assertIs(self.card("There is no free tier without a credit card."), True)
        self.assertIsNone(self.card("$10 credit."))
        self.assertIsNone(self.card("No card required. Credit card required."))
        self.assertIsNone(self.card("No card required", "none"))
        self.assertIsNone(self.card("Free plan. New accounts also get a trial with no credit card.", "recurring"))
    def test_interfaces_unknown_not_no(self):
        self.assertIsNone(derive.has(["Python client"], r"\bcli\b"))
        self.assertIsNone(derive.has(None, "x"))
    def test_inkling(self):
        v = lambda ram, gpu, gpus=(): derive.inkling_fit({"maxMemoryGib": ram, "gpu": gpu}, [{"type": g} for g in gpus])["verdict"]
        self.assertEqual(v(None, True, ["NVIDIA L4"]), "gpu_sold")
        self.assertEqual(v(8, True, ["T4"]), "too_small")
        self.assertEqual(v(32, False), "cpu_sold")
        self.assertEqual(v(16, False), "too_small")
        self.assertEqual(v(16, None), "unknown")
        self.assertEqual(v(None, None), "unknown")
        self.assertEqual(v(16, True, ["Mystery GPU"]), "unknown")
    def test_free(self):
        self.assertEqual(derive.free_kind("credit", "14-day trial"), "trial")
        self.assertEqual(derive.free_amount("credit", "up to $30 credit", None), (30.0, True, "read from the source text"))
        self.assertEqual(derive.free_amount("recurring", "$0/month", None)[0], None)
        self.assertIsNone(derive.free_expiry("credit", "7-day maximum lifetime"))
        self.assertIsNone(derive.free_risk("$5 credit", None))

if __name__ == "__main__":
    unittest.main()
