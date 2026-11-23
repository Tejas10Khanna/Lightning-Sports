"""Select one recent completed match and build a brief from Cricsheet data."""

import datetime as dt
import io
import json
from pathlib import Path
import re
import sys
import urllib.request
import zipfile


ARCHIVE = "https://cricsheet.org/downloads/recently_played_2_json.zip"
MAX_ARCHIVE_BYTES = 8_000_000
MAX_MATCH_BYTES = 700_000


def candidate(match_id, match, today):
    info = match["info"]
    match_date = dt.date.fromisoformat(info["dates"][-1])
    if not today - dt.timedelta(days=2) <= match_date <= today:
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
    for inning in innings:
        overs = inning["overs"]
        if len(overs) < 6 or [over["over"] for over in overs[:6]] != list(range(6)):
            return None
        runs = sum(ball["runs"]["total"] for over in overs[:6] for ball in over["deliveries"])
        evidence.append({"fact": f"{inning['team']} scored {runs} runs off deliveries in its first six overs.", "url": source})
    return (match_date, info.get("team_type") == "international", match_id, {
        "sport": "Cricket",
        "topic": f"What did the opening six overs contribute to the {match_type} between {teams[0]} and {teams[1]}?",
        "modelUseApproved": True,
        "evidence": evidence,
    })


def select(archive, seen, today):
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
                pick = candidate(match_id, json.loads(bundle.read(entry)), today)
            except (KeyError, IndexError, ValueError, TypeError, StopIteration, AttributeError):
                continue
            if pick:
                picks.append(pick)
    return max(picks, key=lambda row: row[:3], default=None)


def main():
    seen_path, brief_path, id_path = map(Path, sys.argv[1:])
    seen = set(seen_path.read_text().splitlines()) if seen_path.exists() else set()
    with urllib.request.urlopen(ARCHIVE, timeout=20) as response:
        if response.geturl() != ARCHIVE:
            raise ValueError("Cricsheet archive unexpectedly redirected.")
        archive = response.read(MAX_ARCHIVE_BYTES + 1)
    if len(archive) > MAX_ARCHIVE_BYTES:
        raise ValueError("Cricsheet archive is too large.")
    today = dt.datetime.now(dt.timezone.utc).date()
    pick = select(io.BytesIO(archive), seen, today)
    if pick is None:
        print("No new eligible cricket scorecard.")
        return
    _, _, match_id, brief = pick
    brief_path.write_text(json.dumps(brief), encoding="utf-8")
    id_path.write_text(match_id, encoding="utf-8")
    print("One eligible cricket scorecard selected.")


if __name__ == "__main__":
    main()
