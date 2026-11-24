import copy, datetime, io, json, pathlib, sys, tempfile, unittest, urllib.error
from contextlib import redirect_stdout
from unittest import mock
ROOT = pathlib.Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))
import fetch

GOOD = json.loads((ROOT / "tests/feed-2026-11-24.json").read_text())
T1 = datetime.datetime(2026, 11, 25, 8, tzinfo=datetime.timezone.utc)

class Base(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.addCleanup(self.t.cleanup)
        self.d = pathlib.Path(self.t.name)
        fetch.apply(json.dumps(GOOD).encode(), self.d, T1 - datetime.timedelta(days=1))
        self.f = copy.deepcopy(GOOD)
    def files(self):
        return {str(p.relative_to(self.d)): p.read_bytes() for p in self.d.rglob("*") if p.is_file()}
    def rejected(self, raw):
        before = self.files()
        with self.assertRaises(fetch.BadFeed):
            fetch.apply(raw if isinstance(raw, bytes) else json.dumps(raw).encode(), self.d, T1)
        self.assertEqual(before, self.files(), "last good data must stay untouched")

class Rejects(Base):
    def test_bad_json(self):
        for raw in (b"", b"<html>down</html>", b'{"providers": [', b"\xff\xfe\x00", b"[" * 200000, b"null", b"[]", b"{}"):
            with self.subTest(raw[:20]):
                self.rejected(raw)
    def test_missing_top_fields(self):
        for k in ("license", "updated", "categories", "providers"):
            f = copy.deepcopy(GOOD); del f[k]
            with self.subTest(k):
                self.rejected(f)
    def test_licence_changed(self):
        self.f["license"] = "All rights reserved"
        self.rejected(self.f)
    def test_missing_provider_fields(self):
        for k in ("slug", "name", "website", "lastChecked", "status", "categories", "sources", "benchmarks", "features", "pricing", "comparablePrice", "score", "watchOut"):
            f = copy.deepcopy(GOOD); del f["providers"][3][k]
            with self.subTest(k):
                self.rejected(f)
        for a, k in (("pricing", "rates"), ("pricing", "plans"), ("pricing", "freeTier"), ("pricing", "freeTierKind"), ("features", "maxVcpu"), ("features", "gpu")):
            f = copy.deepcopy(GOOD); del f["providers"][3][a][k]
            with self.subTest(k):
                self.rejected(f)
    def test_missing_rate_key(self):
        del self.f["providers"][0]["pricing"]["rates"]["vcpuHour"]
        self.rejected(self.f)
    def test_bad_numbers(self):
        for v in ("0.05", -1, True, [1]):
            f = copy.deepcopy(GOOD); f["providers"][0]["pricing"]["rates"]["vcpuHour"] = v
            with self.subTest(v):
                self.rejected(f)
        self.f["providers"][0]["pricing"]["rates"]["vcpuHour"] = float("nan")
        self.rejected(self.f)
        self.rejected(b'{"license": 1e999}')
    def test_infinite_float(self):
        self.rejected(json.dumps(GOOD).replace('"vcpuHour": ', '"vcpuHour": 1e999, "x": ', 1).encode())
    def test_duplicate_and_unsafe_slug(self):
        self.f["providers"][1]["slug"] = self.f["providers"][0]["slug"]
        self.rejected(self.f)
        for s in ("../../etc/passwd", "a/b", "", None, "A B"):
            f = copy.deepcopy(GOOD); f["providers"][0]["slug"] = s
            with self.subTest(s):
                self.rejected(f)
    def test_over_ten_percent_dropped(self):
        n = len(GOOD["providers"])
        self.f["providers"] = self.f["providers"][: n - n // 10 - 1]
        self.rejected(self.f)
    def test_renames_count_as_drops(self):
        for i, p in enumerate(self.f["providers"][:15]):
            p["slug"] = f"new-{i}"
        self.rejected(self.f)
    def test_empty(self):
        self.f["providers"] = []
        self.rejected(self.f)

class Accepts(Base):
    def test_small_drop_is_recorded(self):
        gone = self.f["providers"].pop()
        fetch.apply(json.dumps(self.f).encode(), self.d, T1)
        self.assertIn((gone["slug"], "listing"), {(e["slug"], e["field"]) for e in json.loads((self.d / "changes.json").read_text())})
    def test_null_is_fine_and_price_change_is_dated(self):
        p = next(p for p in self.f["providers"] if p["pricing"]["rates"]["vcpuHour"])
        was, p["pricing"]["rates"]["vcpuHour"] = p["pricing"]["rates"]["vcpuHour"], None
        fetch.apply(json.dumps(self.f).encode(), self.d, T1)
        e = json.loads((self.d / "changes.json").read_text())
        self.assertEqual([(x["date"], x["slug"], x["field"], x["from"], x["to"]) for x in e], [("2026-11-25", p["slug"], "rates > vcpuHour", was, None)])
        self.assertTrue((self.d / "history/2026-11-25.json").exists())
    def test_no_change_only_moves_status(self):
        a = self.files()
        r = fetch.apply(json.dumps(GOOD).encode(), self.d, T1)
        b = self.files()
        self.assertFalse(r["changed"])
        self.assertEqual({k for k in b if a.get(k) != b[k]}, {"status.json"})

class Network(Base):
    def run_main(self, err):
        with mock.patch.object(fetch, "DATA", self.d), mock.patch.object(sys, "argv", ["fetch.py"]), \
             mock.patch("urllib.request.urlopen", side_effect=err), redirect_stdout(io.StringIO()) as out:
            return fetch.main(), out.getvalue()
    def test_unreachable(self):
        before = self.files()
        for e in (urllib.error.URLError("dns"), urllib.error.HTTPError("u", 503, "x", {}, None), TimeoutError("slow")):
            code, out = self.run_main(e)
            self.assertEqual(code, 1)
            self.assertIn("last good data kept", out)
        self.assertEqual(before, self.files())
    def test_too_big(self):
        r = mock.MagicMock(); r.__enter__.return_value = r; r.status = 200; r.read.return_value = b"x" * (fetch.MAX_BYTES + 1)
        with mock.patch("urllib.request.urlopen", return_value=r), self.assertRaises(fetch.BadFeed):
            fetch.get()

if __name__ == "__main__":
    unittest.main()
