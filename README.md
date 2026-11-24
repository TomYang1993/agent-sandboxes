# Agent Sandbox Leaderboard

Live: https://tomyang1993.github.io/agent-sandboxes/

Compares agent sandboxes, dev boxes, browsers, GPU clouds, CI runners, coding agents and notebooks on cost, free tier, paid plans, capabilities, onboarding and published benchmarks.

## Credit

Provider facts come from [AI Sandbox Hunt](https://aisandboxhunt.com), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). We changed the data: derived fields, conflict notes, dated manual corrections and 9 manual rows were added, unsafe links removed, and scores here use our own formula. AI Sandbox Hunt does not endorse this site. The data in this repository stays under CC BY 4.0.

Vendor claims are claims. We tested nothing. No affiliate links and no trackers.

## How it works

- `fetch.py` gets the feed, validates it, then writes `data/`. On any problem (unreachable, bad JSON, missing field, more than 10% of providers gone) it writes nothing and exits 1.
- `data/overlay.json` holds manual corrections, conflicts and rows. They have dates and do not refresh. If the feed changes a field under a correction, the site shows "needs review". A `null` override means unknown.
- `derive.py` computes fields. `null` always means unknown.
- `build.py` writes the static site to `_site/`, with `llms.txt`, JSON and Markdown for agents.
- `site/calc.js` has the calculator, onboarding points and overall formula. The formula is also on the site's Method page.
- `.github/workflows/refresh.yml` runs daily, on push and by hand. It commits only when the feed changed, and redeploys so "last refreshed" stays true. A failed scheduled or manual fetch fails the run and leaves the published site alone.

```
python3 fetch.py && python3 build.py && python3 -m http.server -d _site
python3 -m unittest discover -s tests && node --test tests/*.test.mjs
```

## Limits

- Token efficiency is not measured for anyone.
- Free-tier fields such as "card required" are read from feed text by rules; unclear text stays unknown.
- The calculator leaves out storage, traffic, regional prices and plan session limits.
- GitHub pauses scheduled workflows after 60 days without repository activity. If the date on the site goes stale, re-enable the workflow.
