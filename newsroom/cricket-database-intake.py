"""Select a recent completed Cricket Database match for human editorial review."""
import datetime as dt
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request


API = "https://api.cricketdatabase.com/v1/results/yesterday"
PUBLIC_MATCH = "https://cricketdatabase.com/matches/"
MAX_BYTES = 1_048_576
FORMATS = {"odi": "ODI", "t20i": "T20 international", "t20": "T20", "one-day": "one-day match"}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


def safe_name(value):
    if isinstance(value, str) and re.fullmatch(r"[\w .’'()&-]{1,80}", value):
        return value.strip()
    return None


def match_brief(row, seen, today):
    if not isinstance(row, dict):
        return None
    slug = row.get("match")
    if not isinstance(slug, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) or len(slug) > 150:
        return None
    match_id = "cdb:" + slug
    if match_id in seen:
        return None
    try:
        date = dt.date.fromisoformat(row.get("date"))
    except (ValueError, TypeError):
        return None
    if not today - dt.timedelta(days=2) <= date <= today:
        return None
    match_format = FORMATS.get(row.get("format")) if isinstance(row.get("format"), str) else None
    teams = row.get("teams")
    if not match_format or not isinstance(teams, list) or len(teams) != 2:
        return None
    if any(not isinstance(team, dict) for team in teams):
        return None
    names = [safe_name(team.get("name")) for team in teams]
    scores = [team.get("score") for team in teams]
    if not all(names) or names[0].casefold() == names[1].casefold() or any(
        not isinstance(score, str) or not re.fullmatch(r"[0-9]{1,4}(?:/(?:10|[0-9]))?", score)
        for score in scores
    ):
        return None
    winners = [index for index, team in enumerate(teams) if team.get("won") is True]
    if len(winners) != 1 or teams[1 - winners[0]].get("won") is not False:
        return None
    winner = names[winners[0]]
    result = row.get("result")
    if not isinstance(result, str):
        return None
    margin = re.fullmatch(re.escape(winner) + r" won by ([1-9][0-9]{0,2}) (runs?|wickets?)", result)
    if not margin:
        return None
    gap = int(margin[1])
    totals = [int(score.split("/")[0]) for score in scores]
    if margin[2].startswith("run") and totals[winners[0]] - totals[1 - winners[0]] != gap:
        return None
    if margin[2].startswith("wicket") and (gap > 10 or totals[winners[0]] <= totals[1 - winners[0]]):
        return None
    url = PUBLIC_MATCH + slug
    facts = [f"{winner} defeated {names[1 - winners[0]]} by {gap} {margin[2]} on {date}."]
    for name, score, team in zip(names, scores, teams):
        overs = team.get("overs")
        detail = f" in {overs} overs" if isinstance(overs, str) and re.fullmatch(r"[0-9]{1,2}(?:\.[0-5])?", overs) else ""
        facts.append(f"{name} recorded an innings score of {score}{detail}.")
    competition = safe_name(row.get("competition_name"))
    if competition:
        facts.append(f"The match was played in {competition}.")
    return match_id, {
        "sport": "Cricket",
        "topic": f"What do the final scores and result tell us about the {match_format} between {names[0]} and {names[1]}?",
        "modelUseApproved": True,
        "evidence": [{"fact": fact, "url": url} for fact in facts],
    }


def main():
    seen_path, brief_path, id_path = map(Path, sys.argv[1:])
    key = os.environ.get("NEWSROOM_CRICKET_DATABASE_KEY", "").strip()
    if not key:
        print("Cricket Database intake skipped because its GitHub secret is missing.")
        return
    seen = set(seen_path.read_text().splitlines()) if seen_path.exists() else set()
    request = urllib.request.Request(API, headers={
        "Authorization": "Bearer " + key,
        "Accept": "application/json",
        "User-Agent": "LightningSportsNewsroom/1.0",
    })
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
            raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("size limit")
        results = json.loads(raw)["data"]["results"]
        if not isinstance(results, list):
            raise ValueError("expected a results list")
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Cricket Database returned HTTP {error.code}.") from None
    except (OSError, TypeError, KeyError, ValueError):
        raise SystemExit("Cricket Database results request failed or returned an invalid response.") from None
    today = dt.datetime.now(dt.timezone.utc).date()
    for row in results:
        selected = match_brief(row, seen, today)
        if selected:
            match_id, brief = selected
            brief_path.write_text(json.dumps(brief), encoding="utf-8")
            id_path.write_text(match_id, encoding="utf-8")
            print("One recent Cricket Database result selected for editorial review.")
            return
    print(f"Cricket Database returned {len(results)} results. No new eligible match found.")


if __name__ == "__main__":
    main()
