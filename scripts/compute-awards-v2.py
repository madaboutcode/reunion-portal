#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "google-auth",
#   "google-api-python-client",
#   "pandas",
# ]
# ///

"""
Prediction-contest awards (OPTIONAL: only for events running the prediction
contest feature, e.g. the original WC2026 Prediction Contest).

Reads ALL scoring tabs of the contest Google Sheet (including MainScores,
R16Scores) and recomputes every award category. Cross-checks against the
precomputed Leaderboard tab. The tab names in SHEETS_TO_READ and the scoring
rules below are specific to the original contest; adapt them to your sheet.

READ-ONLY: reads the sheet and prints to stdout. Writes nothing.

Usage:
    uv run scripts/compute-awards-v2.py
    uv run scripts/compute-awards-v2.py --help

Needs GOOGLE_SPREADSHEET_ID (the ID from the sheet URL) and GOOGLE_SA_KEY. Both are
secrets: process env, .env.ops, or src/server/.dev.vars (the Worker uses the same values).
The sheet is not tied to stg or prod, so this script takes no --env.
"""

import base64
import json
import re
import sys

import pandas as pd
from google.oauth2 import service_account
from googleapiclient.discovery import build

from ops_common import load_secrets

SPREADSHEET_ID = ""  # set in load_sa_credentials from GOOGLE_SPREADSHEET_ID

SHEETS_TO_READ = [
    "Fixtures", "Scores", "Players", "Leaderboard",
    "BatchLeaderboard", "MainScores", "R16Scores", "MainResults",
]

MIN_BRANCH_PARTICIPANTS = 3


def load_sa_credentials() -> service_account.Credentials:
    global SPREADSHEET_ID
    env = load_secrets("GOOGLE_SPREADSHEET_ID", "GOOGLE_SA_KEY")
    SPREADSHEET_ID = env["GOOGLE_SPREADSHEET_ID"]
    sa_key_b64 = env["GOOGLE_SA_KEY"]
    sa_json = json.loads(base64.b64decode(sa_key_b64).decode("utf-8"))
    return service_account.Credentials.from_service_account_info(
        sa_json, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
    )


def read_sheet(service, sheet_name: str) -> pd.DataFrame:
    result = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=SPREADSHEET_ID, range=f"{sheet_name}!A:Z")
        .execute()
    )
    values = result.get("values", [])
    if len(values) < 2:
        return pd.DataFrame()
    headers = values[0]
    rows = values[1:]
    padded = [row + [""] * (len(headers) - len(row)) for row in rows]
    return pd.DataFrame(padded, columns=headers)


def safe_int(val, default=0) -> int:
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return default


def parse_score_detail(detail: str) -> dict:
    normalized = detail.strip().upper()
    mom_points = 20 if "+MOM" in normalized else 0
    if normalized.startswith("EXACT"):
        return {"tier": "exact", "goals_off": 0, "mom_points": mom_points}
    close_match = re.match(r"^CLOSE\s+-(\d+)", normalized)
    if close_match:
        off = int(close_match.group(1))
        tier = "goalDiff" if off <= 2 else "outcome"
        return {"tier": tier, "goals_off": off, "mom_points": mom_points}
    if normalized == "GOAL-DIFF":
        return {"tier": "goalDiff", "goals_off": None, "mom_points": mom_points}
    if normalized == "OUTCOME":
        return {"tier": "outcome", "goals_off": None, "mom_points": mom_points}
    return {"tier": "miss", "goals_off": None, "mom_points": 0}


def build_player_match_scores(scores_df: pd.DataFrame, fixtures_df: pd.DataFrame) -> pd.DataFrame:
    scores_df = scores_df.copy()
    scores_df["Email"] = scores_df["Email"].str.strip().str.lower()
    scores_df["Points"] = scores_df["Points"].apply(lambda x: safe_int(x))
    scores_df["MatchId"] = scores_df["MatchId"].astype(str).str.strip()

    fixture_stages = fixtures_df.set_index(
        fixtures_df["MatchId"].astype(str).str.strip()
    )["Stage"].to_dict()

    base_rows, joker_rows, upset_rows = [], [], []

    for _, row in scores_df.iterrows():
        email = row["Email"]
        match_id = row["MatchId"]
        stage = str(row.get("Stage", "")).strip()
        points = row["Points"]
        detail = str(row.get("Detail", ""))

        if stage == "JOKER":
            joker_rows.append({"email": email, "match_id": match_id, "joker_points": points})
        elif stage == "UPSET":
            upset_rows.append({"email": email, "match_id": match_id, "upset_points": points})
        else:
            parsed = parse_score_detail(detail)
            base_rows.append({
                "email": email, "match_id": match_id, "base_points": points,
                "tier": parsed["tier"], "goals_off": parsed["goals_off"],
                "mom_points": parsed["mom_points"], "score_stage": stage,
                "fixture_stage": fixture_stages.get(match_id, ""),
            })

    base_df = pd.DataFrame(base_rows)
    joker_df = pd.DataFrame(joker_rows) if joker_rows else pd.DataFrame(columns=["email", "match_id", "joker_points"])
    upset_df = pd.DataFrame(upset_rows) if upset_rows else pd.DataFrame(columns=["email", "match_id", "upset_points"])

    if base_df.empty:
        return pd.DataFrame()

    base_df["stage_match"] = base_df["score_stage"] == base_df["fixture_stage"]
    base_df = base_df.sort_values("stage_match", ascending=False).drop_duplicates(
        subset=["email", "match_id"], keep="first"
    )

    merged = base_df.merge(joker_df, on=["email", "match_id"], how="left")
    merged = merged.merge(upset_df, on=["email", "match_id"], how="left")
    merged["joker_points"] = merged["joker_points"].fillna(0).astype(int)
    merged["upset_points"] = merged["upset_points"].fillna(0).astype(int)
    merged["total_match_points"] = merged["base_points"] + merged["joker_points"] + merged["upset_points"]

    return merged


def build_main_scores(main_scores_df: pd.DataFrame, r16_scores_df: pd.DataFrame) -> pd.DataFrame:
    rows = []

    if not main_scores_df.empty:
        main_scores_df = main_scores_df.copy()
        email_col = main_scores_df.columns[0]  # Column A = Email
        item_col = main_scores_df.columns[1] if len(main_scores_df.columns) > 1 else "Item"
        pts_col = main_scores_df.columns[2] if len(main_scores_df.columns) > 2 else "Points"
        for _, row in main_scores_df.iterrows():
            email = str(row[email_col]).strip().lower()
            if not email or "@" not in email:
                continue
            rows.append({
                "email": email,
                "item": str(row[item_col]).strip(),
                "points": safe_int(row[pts_col]),
                "source": "main",
            })

    if not r16_scores_df.empty:
        r16_scores_df = r16_scores_df.copy()
        email_col = r16_scores_df.columns[0]
        item_col = r16_scores_df.columns[1] if len(r16_scores_df.columns) > 1 else "Item"
        pts_col = r16_scores_df.columns[2] if len(r16_scores_df.columns) > 2 else "Points"
        for _, row in r16_scores_df.iterrows():
            email = str(row[email_col]).strip().lower()
            if not email or "@" not in email:
                continue
            rows.append({
                "email": email,
                "item": str(row[item_col]).strip(),
                "points": safe_int(row[pts_col]),
                "source": "r16",
            })

    return pd.DataFrame(rows) if rows else pd.DataFrame(columns=["email", "item", "points", "source"])


def print_section(title: str, char: str = "─"):
    print(f"\n{char * 60}")
    print(f"  {title}")
    print(f"{char * 60}")


def print_ranking(df: pd.DataFrame, name_col: str, batch_col: str, metric_col: str,
                  detail_col: str = None, top_n: int = 5, metric_fmt: str = "{}"):
    for i, (_, row) in enumerate(df.head(top_n).iterrows()):
        marker = " << WINNER" if i == 0 else ""
        detail = f"  ({row[detail_col]})" if detail_col and pd.notna(row.get(detail_col)) else ""
        print(f"  {i+1}. {row[name_col]:25s} ({row[batch_col]:5s}) — {metric_fmt.format(row[metric_col])}{detail}{marker}")


def main():
    print("Connecting to Google Sheets...")
    service = build("sheets", "v4", credentials=load_sa_credentials())

    print("Reading sheets...")
    sheets = {}
    for name in SHEETS_TO_READ:
        sheets[name] = read_sheet(service, name)
        print(f"  {name}: {len(sheets[name])} rows, cols: {list(sheets[name].columns)}")

    fixtures_df = sheets["Fixtures"]
    scores_df = sheets["Scores"]
    players_df = sheets["Players"]
    leaderboard_df = sheets["Leaderboard"]
    batch_lb_df = sheets["BatchLeaderboard"]
    main_scores_df = sheets["MainScores"]
    r16_scores_df = sheets["R16Scores"]
    main_results_df = sheets["MainResults"]

    # Only scored fixtures
    scored_fixtures = fixtures_df[fixtures_df["Scored"].str.strip() == "Y"].copy()
    scored_fixtures["MatchId"] = scored_fixtures["MatchId"].astype(str).str.strip()
    print(f"\nScored fixtures: {len(scored_fixtures)}")

    # ── Players lookup ──
    players_df = players_df.copy()
    players_df["Email"] = players_df["Email"].str.strip().str.lower()
    players_df["Batch"] = players_df["Batch"].str.strip()
    player_lookup = players_df.set_index("Email")[["DisplayName", "Batch"]].to_dict("index")

    # ── Match scores ──
    ms = build_player_match_scores(scores_df, scored_fixtures)
    ms = ms[ms["email"].isin(player_lookup)].copy()
    ms["display_name"] = ms["email"].map(lambda e: player_lookup.get(e, {}).get("DisplayName", e))
    ms["batch"] = ms["email"].map(lambda e: player_lookup.get(e, {}).get("Batch", ""))

    fixture_stage = scored_fixtures.set_index("MatchId")["Stage"].to_dict()
    ms["stage"] = ms["match_id"].map(fixture_stage)
    print(f"Player-match score rows: {len(ms)}")

    # ── Main prediction scores ──
    main_pred = build_main_scores(main_scores_df, r16_scores_df)
    main_pred = main_pred[main_pred["email"].isin(player_lookup)]
    main_per_player = main_pred.groupby("email")["points"].sum().reset_index()
    main_per_player.columns = ["email", "main_pts"]
    print(f"Players with main prediction scores: {len(main_per_player)}")

    # ── Combined totals ──
    match_totals = ms.groupby(["email", "display_name", "batch"]).agg(
        match_pts=("total_match_points", "sum"),
        matches_predicted=("match_id", "count"),
    ).reset_index()

    combined = match_totals.merge(main_per_player, on="email", how="left")
    combined["main_pts"] = combined["main_pts"].fillna(0).astype(int)
    combined["grand_total"] = combined["match_pts"] + combined["main_pts"]
    combined = combined.sort_values("grand_total", ascending=False).reset_index(drop=True)

    # ══════════════════════════════════════════════════════════
    # CROSS-CHECK AGAINST LEADERBOARD
    # ══════════════════════════════════════════════════════════
    print_section("CROSS-CHECK vs LEADERBOARD", "═")

    lb = leaderboard_df.copy()
    lb_email_col = "Email" if "Email" in lb.columns else lb.columns[-1]
    lb["email"] = lb[lb_email_col].str.strip().str.lower()
    lb["lb_total"] = lb["Total"].apply(safe_int)
    lb["lb_match"] = lb["MatchPts"].apply(safe_int) if "MatchPts" in lb.columns else 0
    lb["lb_main"] = lb["MainPts"].apply(safe_int) if "MainPts" in lb.columns else 0
    lb["lb_joker"] = lb["JokerPts"].apply(safe_int) if "JokerPts" in lb.columns else 0

    check = combined.merge(lb[["email", "lb_total", "lb_match", "lb_main", "lb_joker"]], on="email", how="outer")
    check["diff"] = check["grand_total"].fillna(0) - check["lb_total"].fillna(0)
    mismatches = check[check["diff"].abs() > 0].sort_values("diff", ascending=False)

    if mismatches.empty:
        print("  ALL TOTALS MATCH the Leaderboard.")
    else:
        print(f"  {len(mismatches)} MISMATCHES found:")
        for _, row in mismatches.head(20).iterrows():
            name = row.get("display_name", row["email"])
            print(f"    {str(name):25s} — ours: {row['grand_total']:.0f}  LB: {row['lb_total']:.0f}  diff: {row['diff']:+.0f}"
                  f"  (match={row['match_pts']:.0f} main={row['main_pts']:.0f} | lb_match={row['lb_match']:.0f} lb_main={row['lb_main']:.0f} lb_joker={row['lb_joker']:.0f})")

    # ══════════════════════════════════════════════════════════
    # AWARD 1: NOSTRADAMUS — Overall Winner
    # ══════════════════════════════════════════════════════════
    print_section("1. NOSTRADAMUS OF KARICODE — Highest total points")
    top = combined.sort_values("grand_total", ascending=False)
    for i, (_, row) in enumerate(top.head(5).iterrows()):
        marker = " << WINNER" if i == 0 else ""
        print(f"  {i+1}. {row['display_name']:25s} ({row['batch']:5s}) — {row['grand_total']:.0f} pts"
              f"  (match={row['match_pts']:.0f}, main={row['main_pts']:.0f}, {row['matches_predicted']:.0f} matches){marker}")

    # ══════════════════════════════════════════════════════════
    # AWARD 2: CHACKO MASTER — Most exact scores
    # ══════════════════════════════════════════════════════════
    print_section("2. CHACKO MASTER AWARD — Most exact scoreline predictions")
    exacts = ms[ms["tier"] == "exact"].groupby(["email", "display_name", "batch"]).size().reset_index(name="exact_count")
    exacts = exacts.sort_values("exact_count", ascending=False)
    print_ranking(exacts, "display_name", "batch", "exact_count", metric_fmt="{} exact scores")

    # ══════════════════════════════════════════════════════════
    # AWARD 3: VELICHAPPADU — Most upset bonus points
    # ══════════════════════════════════════════════════════════
    print_section("3. VELICHAPPADU AWARD — Most upset bonus points")
    upsets = ms[ms["upset_points"] > 0].groupby(["email", "display_name", "batch"]).agg(
        upset_total=("upset_points", "sum"),
        upset_matches=("match_id", "count"),
    ).reset_index().sort_values("upset_total", ascending=False)
    if upsets.empty:
        print("  No upset bonuses.")
    else:
        for i, (_, row) in enumerate(upsets.head(5).iterrows()):
            marker = " << WINNER" if i == 0 else ""
            print(f"  {i+1}. {row['display_name']:25s} ({row['batch']:5s}) — {row['upset_total']:.0f} upset pts"
                  f"  ({row['upset_matches']:.0f} upsets){marker}")

    # ══════════════════════════════════════════════════════════
    # AWARD 4: THURUPPU GULAN — Highest joker returns
    # ══════════════════════════════════════════════════════════
    print_section("4. THURUPPU GULAN — Highest total joker bonus")
    jokers = ms[ms["joker_points"] > 0].groupby(["email", "display_name", "batch"]).agg(
        joker_total=("joker_points", "sum"),
        joker_matches=("match_id", "count"),
    ).reset_index().sort_values("joker_total", ascending=False)
    if jokers.empty:
        print("  No joker bonuses.")
    else:
        for i, (_, row) in enumerate(jokers.head(5).iterrows()):
            marker = " << WINNER" if i == 0 else ""
            print(f"  {i+1}. {row['display_name']:25s} ({row['batch']:5s}) — {row['joker_total']:.0f} joker pts"
                  f"  ({row['joker_matches']:.0f} jokers){marker}")

    # ══════════════════════════════════════════════════════════
    # AWARD 5: FAZIL AWARD — Most MoM correct (QF onward)
    # ══════════════════════════════════════════════════════════
    print_section("5. FAZIL AWARD — Most correct Man of the Match (QF onward)")
    qf_plus = ms[ms["stage"].isin(["QF", "SF", "FINAL", "3RD"])]
    moms = qf_plus[qf_plus["mom_points"] > 0].groupby(["email", "display_name", "batch"]).agg(
        mom_total=("mom_points", "sum"),
        mom_hits=("match_id", "count"),
    ).reset_index().sort_values(["mom_hits", "mom_total"], ascending=False)
    if moms.empty:
        print("  No MoM bonuses from QF onward.")
    else:
        for i, (_, row) in enumerate(moms.head(5).iterrows()):
            marker = " << WINNER" if i == 0 else ""
            print(f"  {i+1}. {row['display_name']:25s} ({row['batch']:5s}) — {row['mom_hits']:.0f} correct"
                  f"  ({row['mom_total']:.0f} MoM pts){marker}")
        # Check for ties at the top
        top_hits = moms.iloc[0]["mom_hits"]
        tied = moms[moms["mom_hits"] == top_hits]
        if len(tied) > 1:
            print(f"\n  ⚠️  {len(tied)}-WAY TIE at {top_hits:.0f} correct MoM predictions")

    # ══════════════════════════════════════════════════════════
    # AWARD 6: NOKIA 3310 — Highest hit rate
    # ══════════════════════════════════════════════════════════
    print_section("6. NOKIA 3310 AWARD — Highest hit rate (serious players)")

    # Criteria: predicted 5+ R32 matches AND 3+ of last 10 matches
    ko_stages = {"R32", "R16", "QF", "SF", "FINAL", "3RD"}
    ko_predictions = ms[ms["stage"].isin(ko_stages)].groupby("email")["match_id"].count().reset_index()
    ko_predictions.columns = ["email", "ko_count"]

    # Last 10 scored fixtures by MatchId
    last_10_ids = set(scored_fixtures.sort_values("MatchId", key=lambda x: x.apply(safe_int), ascending=False).head(10)["MatchId"])
    last_10_predictions = ms[ms["match_id"].isin(last_10_ids)].groupby("email")["match_id"].count().reset_index()
    last_10_predictions.columns = ["email", "last10_count"]

    player_tiers = ms.groupby(["email", "display_name", "batch"]).agg(
        total_matches=("match_id", "count"),
        miss_count=("tier", lambda x: (x == "miss").sum()),
    ).reset_index()

    nokia = player_tiers.merge(ko_predictions, on="email", how="left")
    nokia = nokia.merge(last_10_predictions, on="email", how="left")
    nokia["ko_count"] = nokia["ko_count"].fillna(0)
    nokia["last10_count"] = nokia["last10_count"].fillna(0)

    qualifying = nokia[(nokia["ko_count"] >= 5) & (nokia["last10_count"] >= 3)].copy()
    qualifying["hit_rate"] = ((qualifying["total_matches"] - qualifying["miss_count"]) / qualifying["total_matches"] * 100).round(1)
    qualifying = qualifying.sort_values("hit_rate", ascending=False)

    print(f"  Qualifying players (5+ KO matches, 3+ of last 10): {len(qualifying)}")
    for i, (_, row) in enumerate(qualifying.head(5).iterrows()):
        marker = " << WINNER" if i == 0 else ""
        print(f"  {i+1}. {row['display_name']:25s} ({row['batch']:5s}) — {row['hit_rate']}% hit rate"
              f"  ({row['miss_count']:.0f} misses / {row['total_matches']:.0f} matches){marker}")

    # ══════════════════════════════════════════════════════════
    # AWARD 7: SERIES EXAM STAR — Highest group stage points
    # ══════════════════════════════════════════════════════════
    print_section("7. SERIES EXAM STAR — Highest group stage points")
    group_ms = ms[ms["stage"] == "GROUP"]
    group_totals = group_ms.groupby(["email", "display_name", "batch"]).agg(
        group_points=("total_match_points", "sum"),
    ).reset_index().sort_values("group_points", ascending=False)
    print_ranking(group_totals, "display_name", "batch", "group_points", metric_fmt="{:.0f} pts")

    # ══════════════════════════════════════════════════════════
    # AWARD 8: DESERT STORM — Highest knockout points
    # ══════════════════════════════════════════════════════════
    print_section("8. DESERT STORM AWARD — Highest knockout points")
    ko_ms = ms[ms["stage"] != "GROUP"]
    ko_totals = ko_ms.groupby(["email", "display_name", "batch"]).agg(
        ko_points=("total_match_points", "sum"),
    ).reset_index().sort_values("ko_points", ascending=False)
    print_ranking(ko_totals, "display_name", "batch", "ko_points", metric_fmt="{:.0f} pts")

    # ══════════════════════════════════════════════════════════
    # AWARD 9: KANIPPAYYUR JR — Top scorer per branch
    # ══════════════════════════════════════════════════════════
    print_section("9. KANIPPAYYUR JR — Top scorer per qualifying branch")
    branch_counts = combined.groupby("batch")["email"].count().reset_index()
    branch_counts.columns = ["batch", "count"]
    qualifying_batches = set(branch_counts[branch_counts["count"] >= MIN_BRANCH_PARTICIPANTS]["batch"])
    branch_players = combined[combined["batch"].isin(qualifying_batches)]
    toppers = branch_players.sort_values("grand_total", ascending=False).drop_duplicates(subset=["batch"], keep="first")
    toppers = toppers.sort_values("grand_total", ascending=False)
    print(f"  Qualifying branches ({MIN_BRANCH_PARTICIPANTS}+ participants): {sorted(qualifying_batches)}")
    for _, row in toppers.iterrows():
        print(f"  {row['display_name']:25s} ({row['batch']:5s}) — {row['grand_total']:.0f} pts")

    # ══════════════════════════════════════════════════════════
    # AWARD 10: ROLLING TROPHY — From BatchLeaderboard (precomputed)
    # ══════════════════════════════════════════════════════════
    print_section("10. ROLLING TROPHY — Best department (precomputed)")
    if not batch_lb_df.empty:
        print(f"  BatchLeaderboard columns: {list(batch_lb_df.columns)}")
        print(f"  Rows: {len(batch_lb_df)}")
        for _, row in batch_lb_df.iterrows():
            print(f"  {row.to_dict()}")
    else:
        print("  BatchLeaderboard is empty — computing from our data:")
        branch_stats = combined.groupby("batch").agg(
            branch_total=("grand_total", "sum"),
            participants=("email", "count"),
            avg_points=("grand_total", "mean"),
        ).reset_index()
        branch_stats = branch_stats[branch_stats["participants"] >= MIN_BRANCH_PARTICIPANTS]
        branch_stats = branch_stats.sort_values("avg_points", ascending=False)
        for _, row in branch_stats.iterrows():
            print(f"  {row['batch']:15s} — avg {row['avg_points']:.0f} pts  ({row['participants']:.0f} players, total {row['branch_total']:.0f})")

    # ══════════════════════════════════════════════════════════
    # TOURNAMENT PREDICTIONS — Who got Champion/Runner-up/etc right
    # ══════════════════════════════════════════════════════════
    print_section("TOURNAMENT PREDICTION AWARDS", "═")

    if not main_results_df.empty:
        print("\n  MainResults sheet:")
        for _, row in main_results_df.iterrows():
            print(f"    {row.to_dict()}")

    categories = {
        "CHAMPION": [], "RUNNER_UP": [], "GOLDEN_BOOT": [], "GOLDEN_GLOVE": [],
        "R16_CHAMPION": [], "R16_RUNNER_UP": [], "R16_GOLDEN_BOOT": [], "R16_GOLDEN_GLOVE": [],
    }
    semifinalists = []

    for _, row in main_pred.iterrows():
        email = row["email"]
        item = row["item"]
        pts = row["points"]
        name = player_lookup.get(email, {}).get("DisplayName", email)
        batch = player_lookup.get(email, {}).get("Batch", "")

        if item in categories:
            categories[item].append({"email": email, "name": name, "batch": batch, "points": pts})
        elif item.startswith("SEMIFINALIST"):
            semifinalists.append({"email": email, "name": name, "batch": batch, "points": pts, "item": item})

    for cat, winners in sorted(categories.items()):
        if winners:
            print(f"\n  {cat} ({len(winners)} correct):")
            for w in sorted(winners, key=lambda x: x["name"]):
                print(f"    {w['name']:25s} ({w['batch']:5s}) — {w['points']} pts")

    if semifinalists:
        semi_by_player = {}
        for s in semifinalists:
            semi_by_player.setdefault(s["email"], []).append(s)
        print(f"\n  SEMIFINALIST predictions ({len(semi_by_player)} players with correct picks):")
        for email, picks in sorted(semi_by_player.items(), key=lambda x: len(x[1]), reverse=True):
            name = picks[0]["name"]
            batch = picks[0]["batch"]
            total = sum(p["points"] for p in picks)
            print(f"    {name:25s} ({batch:5s}) — {len(picks)} correct, {total} pts")

    # ══════════════════════════════════════════════════════════
    # DATA SUMMARY
    # ══════════════════════════════════════════════════════════
    print_section("DATA SUMMARY", "═")
    print(f"  Players scored:          {ms['email'].nunique()}")
    print(f"  Matches scored:          {ms['match_id'].nunique()}")
    print(f"  Total match score rows:  {len(ms)}")
    print(f"  MainScores entries:      {len(main_pred[main_pred['source'] == 'main'])}")
    print(f"  R16Scores entries:       {len(main_pred[main_pred['source'] == 'r16'])}")
    print(f"  Branches:                {ms['batch'].nunique()} ({len(qualifying_batches)} qualifying)")


if __name__ == "__main__":
    import argparse
    argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter).parse_args()
    main()
