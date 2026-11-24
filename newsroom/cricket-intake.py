"""Select one recent completed match and build a brief from Cricsheet data."""

import datetime as dt
import io
import json
import os
from pathlib import Path
import re
import sys
import urllib.request
import urllib.parse
import unicodedata
import zipfile


ARCHIVE = "https://cricsheet.org/downloads/recently_played_2_json.zip"
VERIFICATION_ARCHIVE = "https://cricsheet.org/downloads/recently_played_7_json.zip"
MAX_ARCHIVE_BYTES = 8_000_000
MAX_MATCH_BYTES = 700_000


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


def team_key(name):
    name = unicodedata.normalize("NFKC", name).casefold()
    return "".join(character for character in name if character.isalnum())


def compare_scorecard(match_date, expected, fetch):
    fixture_ids = set()
    for page in range(3):
        query = urllib.parse.urlencode({"sport": "cricket", "date": match_date, "page": page})
        result = fetch("/fixtures?" + query)
        if result["meta"].get("complete") is not True:
            return "incomplete fixtures"
        for fixture in result["data"]:
            if fixture["status"]["type"] != "finished":
                continue
            names = {team_key((fixture.get(side) or {}).get("name") or "") for side in ("home", "away")}
            if names == set(expected):
                fixture_ids.add(fixture["id"])
        if result["meta"]["hasNextPage"] is False:
            break
    else:
        return "fixture search limit reached"
    if len(fixture_ids) != 1:
        return "fixture missing or ambiguous"
    fixture_id = fixture_ids.pop()
    if type(fixture_id) is not int or fixture_id <= 0:
        return "invalid fixture"
    innings = fetch(f"/fixtures/{fixture_id}/scorecard")["data"]["innings"]
    if len(innings) != 2 or any(type(row.get("runs")) is not int for row in innings):
        return "incomplete scorecard"
    observed = {team_key(row["battingTeam"]["name"]): row["runs"] for row in innings}
    return "innings totals match" if observed == expected else "innings totals differ"


def report_comparison(match_date, expected=None):
    key = os.environ.get("NEWSROOM_DATASPORTS_API_KEY", "").strip()
    if not key:
        print("DataSportsAPI comparison skipped: key unavailable.")
        return
    opener = urllib.request.build_opener(NoRedirect())

    def fetch(path):
        request = urllib.request.Request("https://api.datasportsapi.com/v2" + path, headers={
            "Authorization": "Bearer " + key, "Accept": "application/json",
        })
        with opener.open(request, timeout=10) as response:
            payload = response.read(MAX_ARCHIVE_BYTES + 1)
        if len(payload) > MAX_ARCHIVE_BYTES:
            raise ValueError("Oversized API response.")
        return json.loads(payload)

    try:
        if expected is None:
            query = urllib.parse.urlencode({"sport": "cricket", "date": match_date, "page": 0})
            result = fetch("/fixtures?" + query)
            status = "key accepted; no scorecard compared" if isinstance(result.get("data"), list) else "invalid fixtures response"
        else:
            status = compare_scorecard(match_date, expected, fetch)
    except urllib.error.HTTPError as error:
        status = f"provider HTTP {error.code}"
    except (OSError, KeyError, ValueError, TypeError, AttributeError):
        status = "provider response unavailable or invalid"
    print(f"DataSportsAPI comparison: {status}.")


def candidate(match_id, match, today, max_age_days):
    info = match["info"]
    match_date = dt.date.fromisoformat(info["dates"][-1])
    if not today - dt.timedelta(days=max_age_days) <= match_date <= today:
        return None
    match_type = info["match_type"]
    if match_type not in {"T20", "ODI"} or info.get("missing"):
        return None
    teams = info["teams"]
    outcome = info["outcome"]
    winner = outcome.get("winner")
    if len(teams) != 2 or winner not in teams or outcome.get("method"):
        return None
    innings = match["innings"]
    if len(innings) != 2 or {row["team"] for row in innings} != set(teams):
        return None
    unit, margin = next(iter(outcome["by"].items()))
    if unit not in {"wickets", "runs"} or type(margin) is not int or margin < 1:
        return None

    source = ARCHIVE
    evidence = [
        {"fact": f"{winner} won the {match_type} between {teams[0]} and {teams[1]} on {match_date} by {margin} {unit}.", "url": source},
    ]
    totals = {}
    for inning in innings:
        overs = inning["overs"]
        if len(overs) < 6 or [over["over"] for over in overs[:6]] != list(range(6)):
            return None
        runs = sum(ball["runs"]["total"] for over in overs[:6] for ball in over["deliveries"])
        penalties = inning.get("penalty_runs", {})
        totals[team_key(inning["team"])] = (
            sum(ball["runs"]["total"] for over in overs for ball in over["deliveries"])
            + penalties.get("pre", 0) + penalties.get("post", 0)
        )
        evidence.append({"fact": f"{inning['team']} scored {runs} runs off deliveries in its first six overs.", "url": source})
    return (match_date, info.get("team_type") == "international", match_id, {
        "sport": "Cricket",
        "topic": f"What did the opening six overs contribute to the {match_type} between {teams[0]} and {teams[1]}?",
        "modelUseApproved": True,
        "evidence": evidence,
    }, totals)


def select(archive, seen, today, max_age_days=2):
    picks = []
    with zipfile.ZipFile(archive) as bundle:
        members = bundle.infolist()
        if len(members) > 200:
            raise ValueError("Cricsheet archive contains too many entries.")
        for entry in members:
            match_name = re.fullmatch(r"([0-9]{1,12})\.json", entry.filename)
            if not match_name or entry.file_size > MAX_MATCH_BYTES:
                continue
            match_id = match_name[1]
            if match_id in seen:
                continue
            try:
                pick = candidate(match_id, json.loads(bundle.read(entry)), today, max_age_days)
            except (KeyError, IndexError, ValueError, TypeError, StopIteration, AttributeError):
                continue
            if pick:
                picks.append(pick)
    return max(picks, key=lambda row: row[:3], default=None)


def download_archive(url):
    with urllib.request.urlopen(url, timeout=20) as response:
        if response.geturl() != url:
            raise ValueError("Cricsheet archive unexpectedly redirected.")
        archive = response.read(MAX_ARCHIVE_BYTES + 1)
    if len(archive) > MAX_ARCHIVE_BYTES:
        raise ValueError("Cricsheet archive is too large.")
    return io.BytesIO(archive)


def check_reference(today):
    if not os.environ.get("NEWSROOM_DATASPORTS_API_KEY", "").strip():
        print("DataSportsAPI comparison skipped: key unavailable.")
        return
    sample = select(download_archive(VERIFICATION_ARCHIVE), set(), today, max_age_days=6)
    if sample is None:
        print("No recent cricket scorecard was available for verification.")
        report_comparison(today)
        return
    match_date, _, _, _, totals = sample
    print("Checking a reference scorecard without creating a draft.")
    report_comparison(match_date, totals)


def main():
    today = dt.datetime.now(dt.timezone.utc).date()
    if sys.argv[1:] == ["--verify-only"]:
        check_reference(today)
        return
    seen_path, brief_path, id_path = map(Path, sys.argv[1:])
    seen = set(seen_path.read_text().splitlines()) if seen_path.exists() else set()
    pick = select(download_archive(ARCHIVE), seen, today)
    if pick is None:
        print("No new eligible cricket scorecard.")
        check_reference(today)
        return
    match_date, _, match_id, brief, totals = pick
    report_comparison(match_date, totals)
    brief_path.write_text(json.dumps(brief), encoding="utf-8")
    id_path.write_text(match_id, encoding="utf-8")
    print("One eligible cricket scorecard selected.")


if __name__ == "__main__":
    main()
