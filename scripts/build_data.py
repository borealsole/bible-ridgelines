#!/usr/bin/env python3
"""Build the compact datasets used by the Bible Ridgelines web app.

Inputs (from the sync.bible repository):
  public/bibles/accented.json                 pointed Hebrew + accented Tischendorf, keyed by Strong's
  public/data/strongsDictionary.json          lemmas, transliterations and definitions
  public/data/strongsObjectWithFamilies.json  roots, families and Bible-wide counts

Outputs (written to <out>/):
  text.json     every verse as a list of lexicon indices (base-36, space separated)
  lexicon.json  one entry per Strong's number / Hebrew prefix used in the text

Usage:
  python3 scripts/build_data.py --source ../sync.bible --out site/data
  python3 scripts/build_data.py --download --out site/data   # fetch from GitHub
"""

import argparse
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_BASE = "https://raw.githubusercontent.com/borealsole/sync.bible/main/"
FILES = {
    "text": "public/bibles/accented.json",
    "dict": "public/data/strongsDictionary.json",
    "families": "public/data/strongsObjectWithFamilies.json",
}

# The accented text marks Hebrew prefixes with letter codes rather than Strong's numbers.
PREFIXES = {
    "Hb": ("בְּ", "b", "in"),
    "Hc": ("וְ", "w", "and"),
    "Hd": ("הַ", "ha", "the"),
    "Hi": ("הֲ", "ha", "(question)"),
    "Hk": ("כְּ", "k", "like"),
    "Hl": ("לְ", "l", "to"),
    "Hm": ("מִ", "m", "from"),
    "Hs": ("שֶׁ", "she", "who/which"),
}

# Hand-checked glosses for common words whose Strong's definitions open with
# etymology or grammar notes rather than the core meaning.
with open(os.path.join(HERE, "gloss_overrides.json"), encoding="utf-8") as _f:
    GLOSS_OVERRIDES = json.load(_f)

# Definition fragments that are about the word rather than its meaning.
UNHELPFUL = re.compile(
    r"\b[GH]\d+|\bcompare\b|\bakin\b|particle|pronoun|preposition|conjunction|"
    r"used only|alternate|denoting|indicative|form of|\bof foreign origin\b|^[^A-Za-z]",
    re.IGNORECASE,
)
TRAILING = re.compile(r"(\s+(in|a|an|the|of|to|for|with|and|or|by|on|at|as))+$", re.IGNORECASE)

LEADING_NOISE = re.compile(
    r"^\s*(properly|figuratively|literally|specifically|especially|generally|"
    r"by implication|by extension|causatively|i\.e\.|e\.g\.|a primitive root|"
    r"a primary verb|a primary particle|a prolonged form|apparently|perhaps|"
    r"probably|also|or|to)\b|^[\s,;:.\-\(\)\{\}]+",
    re.IGNORECASE,
)


def strip_noise(s):
    prev = None
    while prev != s:
        prev = s
        s = LEADING_NOISE.sub("", s, count=1)
    return s


def clean_piece(s):
    s = re.sub(r"\{|\}", "", s)
    s = re.sub(r"\([^)]*\)", "", s)
    s = re.sub(r"\[[^\]]*\]", "", s)
    s = re.sub(r"\bX\b", "", s)
    s = re.sub(r"\s+", " ", s).strip(" ,;:.-")
    return s


NT_BOOKS = set()


def make_gloss(key, entry):
    if key in GLOSS_OVERRIDES:
        return GLOSS_OVERRIDES[key]
    if not entry:
        return key
    sdef = entry.get("strongs_def") or ""
    sdef = re.sub(r"\{|\}|\"", "", sdef)
    # Drop parenthetical asides (repeatedly, for nesting) before splitting.
    prev = None
    while prev != sdef:
        prev = sdef
        sdef = re.sub(r"\([^()]*\)", "", sdef)
    sdef = sdef.replace("(", "").replace(")", "")
    candidates = []
    for part in re.split(r"[;,]|\bi\.e\.|\bor\b", sdef):
        p = clean_piece(strip_noise(part))
        p = re.sub(r"^(an?|the|meaning|used as|as) ", "", p, flags=re.IGNORECASE)
        if p and not UNHELPFUL.search(p):
            candidates.append(p)
    gloss = candidates[0] if candidates else ""
    # Prefer short phrases; long explanatory clauses get trimmed.
    words = gloss.split()
    if len(words) > 4:
        gloss = TRAILING.sub("", " ".join(words[:3]))
    if not gloss:
        kjv = entry.get("kjv_def") or ""
        for part in kjv.split(","):
            p = clean_piece(part)
            if p and not UNHELPFUL.search(p):
                gloss = p
                break
    return gloss or key


def load(path_or_url):
    if path_or_url.startswith("http"):
        print("downloading", path_or_url, file=sys.stderr)
        with urllib.request.urlopen(path_or_url) as r:
            return json.loads(r.read().decode("utf-8"))
    with open(path_or_url, encoding="utf-8") as f:
        return json.load(f)


def display_name(name):
    name = re.sub(r"^III ", "3 ", name)
    name = re.sub(r"^II ", "2 ", name)
    name = re.sub(r"^I ", "1 ", name)
    if name == "Revelation of John":
        return "Revelation"
    return name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", help="path to a sync.bible checkout")
    ap.add_argument("--download", action="store_true", help="fetch the inputs from GitHub")
    ap.add_argument("--out", default=os.path.join(HERE, "..", "site", "data"))
    args = ap.parse_args()
    if not args.source and not args.download:
        ap.error("pass --source <sync.bible checkout> or --download")

    def src(k):
        return RAW_BASE + FILES[k] if args.download else os.path.join(args.source, FILES[k])

    bible = load(src("text"))["books"]
    sdict = load(src("dict"))
    fams = load(src("families"))
    with open(os.path.join(HERE, "books.json"), encoding="utf-8") as f:
        book_aliases = json.load(f)

    NT_BOOKS.update(a[0] for a in book_aliases[39:])
    keys = []
    index = {}

    def idx(key):
        if key not in index:
            index[key] = len(keys)
            keys.append(key)
        return index[key]

    out_books = []
    passage_counts = {}
    for aliases in book_aliases:
        name = aliases[0]
        chapters = bible.get(name)
        if chapters is None:
            print("missing book", name, file=sys.stderr)
            continue
        out_chapters = []
        for chapter in chapters:
            out_verses = []
            for verse in chapter:
                toks = []
                for word in verse:
                    for part in word[1].split("/"):
                        part = part.strip()
                        if not part:
                            continue
                        passage_counts[part] = passage_counts.get(part, 0) + 1
                        toks.append(base36(idx(part)))
                out_verses.append(" ".join(toks))
            out_chapters.append(out_verses)
        out_books.append(
            {
                "name": display_name(name),
                "aliases": sorted(set([display_name(name)] + aliases)),
                "testament": "NT" if name in NT_BOOKS else "OT",
                "chapters": out_chapters,
            }
        )

    lexicon = []
    for key in keys:
        if key in PREFIXES:
            lemma, translit, gloss = PREFIXES[key]
            lexicon.append(
                {"k": key, "l": lemma, "t": translit, "g": gloss, "p": 1, "n": passage_counts[key]}
            )
            continue
        entry = sdict.get(key) or {}
        fam = fams.get(key) or {}
        item = {
            "k": key,
            "l": entry.get("lemma") or key,
            "t": entry.get("xlit") or entry.get("translit") or "",
            "g": make_gloss(key, entry),
            "n": passage_counts[key],
        }
        roots = [r for r in (fam.get("roots") or []) if r != key]
        if roots:
            item["r"] = list(dict.fromkeys(roots))
        if isinstance(fam.get("family"), str) and fam["family"] and fam["family"] != key:
            item["f"] = fam["family"]
        if re.match(r"\s*\((Aramaic|Chaldee)\)", entry.get("derivation") or ""):
            item["a"] = 1
        d = (entry.get("strongs_def") or "").strip()
        if d:
            item["d"] = re.sub(r"\s+", " ", d)[:100]
        lexicon.append(item)

    # Lexicon entries referenced only as roots/families still need a label.
    referenced = set()
    for item in lexicon:
        referenced.update(item.get("r", []))
        if "f" in item:
            referenced.add(item["f"])
    extra = sorted(k for k in referenced if k not in index)
    for key in extra:
        entry = sdict.get(key) or {}
        fam = fams.get(key) or {}
        index[key] = len(keys)
        keys.append(key)
        item = {
            "k": key,
            "l": entry.get("lemma") or key,
            "t": entry.get("xlit") or entry.get("translit") or "",
            "g": make_gloss(key, entry),
            "n": 0,
        }
        roots = [r for r in (fam.get("roots") or []) if r != key]
        if roots:
            item["r"] = list(dict.fromkeys(roots))
        if isinstance(fam.get("family"), str) and fam["family"] and fam["family"] != key:
            item["f"] = fam["family"]
        lexicon.append(item)

    os.makedirs(args.out, exist_ok=True)
    meta = {
        "source": "sync.bible accented.json (pointed WLC Hebrew + accented Tischendorf Greek), Strong's dictionary and families",
    }
    with open(os.path.join(args.out, "text.json"), "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "books": out_books}, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(args.out, "lexicon.json"), "w", encoding="utf-8") as f:
        json.dump(lexicon, f, ensure_ascii=False, separators=(",", ":"))
    total = sum(passage_counts.values())
    print(f"wrote {len(out_books)} books, {total} tokens, {len(lexicon)} lexicon entries to {args.out}", file=sys.stderr)


def base36(n):
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    if n == 0:
        return "0"
    s = ""
    while n:
        n, r = divmod(n, 36)
        s = digits[r] + s
    return s


if __name__ == "__main__":
    main()
