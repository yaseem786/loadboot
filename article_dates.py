# One-off helper: finds the real first-commit date of every blog article
# by asking git when each slug first appeared in build_site.py.
# Run from the repo root:  python article_dates.py
# It writes article_dates.json and prints the table.
import re, json, subprocess

src = open('build_site.py', encoding='utf-8').read()
slugs = []
for m in re.finditer(r"rich_article\(\s*'([^']+\.html)'", src):
    s = m.group(1)
    if s not in slugs:
        slugs.append(s)

out = {}
for s in slugs:
    try:
        r = subprocess.run(
            ['git', 'log', '--reverse', '--format=%cs', '-S', s, '--', 'build_site.py'],
            capture_output=True, text=True, check=True)
        dates = [l for l in r.stdout.splitlines() if l.strip()]
        out[s] = dates[0] if dates else 'UNKNOWN'
    except Exception as ex:
        out[s] = 'ERROR: ' + str(ex)[:60]
    print(f"{out[s]}  {s}")

json.dump(out, open('article_dates.json', 'w'), indent=1)
print(f"\n{len(out)} articles -> article_dates.json written")
