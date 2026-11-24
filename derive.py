"""Pure derivations over feed facts. None always means unknown, never zero and never "no"."""
import re

# ---- card required -------------------------------------------------------
_NO_WITHOUT = re.compile(r"\bno\b[^.;]*\bwithout a (credit )?card")
_NEG = re.compile(r"\bno (credit[ -]?card|card)\b|\bwithout a (credit )?card|\bno card hold")
_POS = re.compile(
    r"\bcard (is )?(required|needed)|\bafter adding a (credit )?card|\badds a (credit )?card"
    r"|payment method is (added|attached|required|needed)|\bcard is (saved|on file|needed|required)"
    r"|payment details collected|credit with card on file")
# A clause about what happens after the free part is used says nothing about starting.
_LATER = re.compile(r"\b(once|after) (the|your) (free|trial|credit)")
# A bonus trial attached to a recurring plan says nothing about the recurring plan.
_BONUS = re.compile(r"^(new (organizations|sign-ups|accounts)|.*\balso get)\b")

def card_required(text, kind):
    if kind == "none":
        return None                      # nothing free to ask a card for
    yes = no = False
    for c in re.split(r"(?<=[^\d])[.;](?=\s|$)", (text or "").lower()):
        c = c.strip()
        if not c or _LATER.search(c) or (kind == "recurring" and _BONUS.search(c)):
            continue
        if _NO_WITHOUT.search(c):
            yes = True
            continue
        if _NEG.search(c):
            no = True
        if _POS.search(_NEG.sub(" ", c)):
            yes = True
    return None if yes == no else yes    # both = contradictory = unknown

# ---- free tier -----------------------------------------------------------
def free_kind(kind, text):
    """The feed files trials under "credit" and free software under "recurring". Split only on its own words."""
    t = (text or "").lower()
    if kind == "credit" and re.search(r"\btrial\b", t):
        return "trial"
    if kind == "recurring" and re.search(
            r"^free open-source software|^free software|^self-hosting is free|^self-hosting the open-source"
            r"|^the open-source .* free to run yourself|free self-hosted license|^community edition is free", t):
        return "software"
    return kind

def free_amount(kind, text, free_plan):
    """(usd, up_to, where). Monthly for recurring, one-off otherwise."""
    if kind == "recurring":
        v = (free_plan or {}).get("includedUsageUsd")
        return (v, False, "feed plan field") if v else (None, False, None)
    if kind in ("credit", "trial"):
        for m in re.finditer(r"(up to )?\$(\d[\d,]*(?:\.\d+)?)([^.;,]{0,16})", text or "", re.I):
            if "model token" in m.group(3) or not float(m.group(2).replace(",", "")):
                continue
            return float(m.group(2).replace(",", "")), bool(m.group(1)), "read from the source text"
    return None, False, None

def free_expiry(kind, text):
    t = (text or "").lower()
    if kind in ("credit", "trial"):
        m = re.search(r"(?:valid(?: for)?|lasts|within|credit for) (\d+) days|(\d+)-day (?:free |pro )?trial", t)
        if m:
            return f"{m.group(1) or m.group(2)} days"
    if re.search(r"forever|permanently|no end date", t):
        return "No end date, per the source"
    if kind == "recurring":
        return "Renews"
    return None

def free_risk(text, free_plan):
    t = (text or "").lower()
    if re.search(r"auto-reload|usage beyond it is paid|\$\d+ is charged on day", t):
        return "can_auto_charge"
    if (free_plan or {}).get("capped") is True or re.search(
            r"hard (stop|cap)|usage stops|no overage|creation pauses|pause at a \$0|sessions stop when"
            r"|it ends at|does not convert|upgrade required once used", t):
        return "hard_stop"
    return None

# ---- interfaces ----------------------------------------------------------
def has(sdks, pattern):
    """True if listed. Absence from a list is not a documented "no", so None."""
    return True if any(re.search(pattern, s, re.I) for s in sdks or []) else None

# ---- Inkling 2 Mini ------------------------------------------------------
# GB per single GPU, smallest shipped variant. Only used when the listing does not state a size itself.
VRAM = [(r"\bT4\b", 16), (r"\bL4\b", 24), (r"\bA10G?\b", 24), (r"\bL40S?\b", 48), (r"\bA100\b", 40),
        (r"\bH100\b", 80), (r"\bH200\b", 141), (r"\bB200\b", 180), (r"\bB300\b", 268),
        (r"\bMI355X\b", 288), (r"\bRTX PRO 6000\b", 96), (r"\bA6000\b", 48), (r"\bM4000\b", 8),
        (r"\b4090\b", 24), (r"\b5090\b", 32), (r"\bRTX 4000 SFF\b", 20)]

def vram(name):
    m = re.search(r"(\d+) ?GB\b", name)
    if m:
        return int(m.group(1))
    return next((gb for rx, gb in VRAM if re.search(rx, name)), None)

def inkling_fit(features, gpus):
    """Needs a 24 GB GPU or 32 GB RAM, plus about 30 GB disk. The feed has no max-disk field, so disk is never checked."""
    sizes = [(g["type"], vram(g["type"])) for g in gpus or []]
    big = [(n, v) for n, v in sizes if v and v >= 24]
    ram, gpu = features.get("maxMemoryGib"), features.get("gpu")
    disk = "; disk not checked"
    if big:
        n, v = min(big, key=lambda x: x[1])
        return {"verdict": "gpu_sold", "why": f"sells {n} ({v} GB); sold, not free{disk}"}
    if ram is not None and ram >= 32:
        return {"verdict": "cpu_sold", "why": f"sells up to {ram:g} GiB RAM; CPU only, slow; sold, not free{disk}"}
    if any(v is None for _, v in sizes):
        return {"verdict": "unknown", "why": "lists a GPU without a model or memory size"}
    if ram is None:
        return {"verdict": "unknown", "why": "no maximum memory published in the data"
                + (f"; largest listed GPU is {max(v for _, v in sizes)} GB" if sizes else "")}
    if gpu is None and not sizes:
        return {"verdict": "unknown", "why": f"largest listed size is {ram:g} GiB RAM; GPU not stated"}
    if gpu is True and not sizes:
        return {"verdict": "unknown", "why": f"offers GPUs but lists no model; RAM up to {ram:g} GiB"}
    return {"verdict": "too_small", "why": f"largest listed size is {ram:g} GiB RAM, no GPU of 24 GB or more"}

# ---- billing notes -------------------------------------------------------
def cpu_floor(billed_while):
    m = re.search(r"minimum of (\d+)% of allocated vCPU", billed_while or "", re.I)
    return int(m.group(1)) / 100 if m else 0

def pause_billing(pause_resume, billed_while):
    """What the calculator charges while paused: 'none', 'memory', or 'full' (no documented pause, or unknown)."""
    if pause_resume is not True:
        return "full"
    t = (billed_while or "").lower()
    if re.search(r"paused? [^.;]*(still )?billed for memory|ram [^.;]*standby|hibernation[^.;]*: memory", t):
        return "memory"
    return "none"

def derive(p, eff_kind, eff_text, text_overridden=False):
    pr, f = p["pricing"], p["features"]
    plans, sdks, rates = pr.get("plans") or [], p.get("sdks"), pr.get("rates") or {}
    paid = sorted((x for x in plans if (x.get("monthlyFee") or 0) > 0), key=lambda x: x["monthlyFee"])
    free = next((x for x in plans if x.get("monthlyFee") == 0), None)
    fk = free_kind(eff_kind, eff_text)
    amt, up_to, where = (None, False, None) if text_overridden else free_amount(fk, eff_text, free)
    cp = paid[0] if paid else None
    return {
        "cardRequiredForFree": card_required(eff_text, eff_kind),
        "freeKind": fk, "freeAmountUsd": amt, "freeAmountUpTo": up_to, "freeAmountFrom": where,
        "freeExpiry": free_expiry(fk, eff_text), "freeRisk": free_risk(eff_text, free),
        "cheapestPaidPlan": cp, "freePlan": free,
        "paidUsagePerDollar": cp["includedUsageUsd"] / cp["monthlyFee"] if cp and cp.get("includedUsageUsd") else None,
        "hasMcp": has(sdks, r"\bmcp\b"), "hasPython": has(sdks, r"\bpython\b"),
        "hasTypescript": has(sdks, r"typescript|javascript|\bnode(\.?js)?\b"),
        "hasRestOrCli": has(sdks, r"\brest\b|\bcli\b|\bhttp\b|\bapi\b"),
        "inkling2MiniFit": inkling_fit(f, pr.get("gpu")),
        "cpuFloor": cpu_floor(rates.get("billedWhile")),
        "pauseBilling": pause_billing(f.get("pauseResume"), rates.get("billedWhile")),
        "physicalCoreNote": any(re.search(r"physical core", n, re.I) for n in pr.get("notes") or []),
        "hasBenchmarks": bool(p.get("benchmarks")),
    }
