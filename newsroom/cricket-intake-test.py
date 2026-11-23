import runpy
from pathlib import Path
import unittest

compare_scorecard = runpy.run_path(
    str(Path(__file__).with_name("cricket-intake.py"))
)["compare_scorecard"]


class ScorecardComparisonTest(unittest.TestCase):
    def test_matches_only_a_unique_finished_fixture_and_compares_totals(self):
        expected = {"india": 150, "australia": 145}
        fixture = {
            "id": 21, "status": {"type": "finished"},
            "home": {"name": "Australia"}, "away": {"name": "India"},
        }
        innings = [
            {"battingTeam": {"name": "India"}, "runs": 150},
            {"battingTeam": {"name": "Australia"}, "runs": 145},
        ]
        fixtures = [fixture]

        def fetch(path):
            if path == "/fixtures/21/scorecard":
                return {"data": {"innings": innings}}
            self.assertEqual(path, "/fixtures?sport=cricket&date=2026-11-22&page=0")
            return {"data": fixtures, "meta": {"complete": True, "hasNextPage": False}}

        self.assertEqual(compare_scorecard("2026-11-22", expected, fetch), "innings totals match")
        innings[0]["runs"] = 149
        self.assertEqual(compare_scorecard("2026-11-22", expected, fetch), "innings totals differ")
        fixtures.append({**fixture, "id": 22})
        self.assertEqual(compare_scorecard("2026-11-22", expected, fetch), "fixture missing or ambiguous")


if __name__ == "__main__":
    unittest.main()
