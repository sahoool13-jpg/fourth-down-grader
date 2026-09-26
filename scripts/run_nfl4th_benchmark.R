suppressPackageStartupMessages({
  library(nfl4th)
  library(dplyr)
  library(jsonlite)
})

gid <- Sys.getenv("GAME_ID", unset = "")
if (!nzchar(gid)) {
  args <- commandArgs(trailingOnly = TRUE)
  gid <- if (length(args)) args[[1]] else "2026_03_ATL_GB"
}

message("Benchmarking ", gid, " with nfl4th...")
plays <- nfl4th::get_4th_plays(gid)
if (!nrow(plays)) stop("No fourth-down plays returned for ", gid)

probs <- nfl4th::add_4th_probs(plays)

pick_option <- function(go, fg, punt) {
  vals <- c(GO = go, FG = fg, PUNT = punt)
  vals <- vals[is.finite(vals)]
  if (!length(vals)) return(NA_character_)
  names(vals)[which.max(vals)]
}

pick_edge <- function(go, fg, punt) {
  vals <- c(GO = go, FG = fg, PUNT = punt)
  vals <- sort(vals[is.finite(vals)], decreasing = TRUE)
  if (length(vals) < 2) return(NA_real_)
  100 * (vals[[1]] - vals[[2]])
}

certainty_from_edge <- function(edge) {
  if (!is.finite(edge)) return("UNKNOWN")
  if (edge >= 2.0) return("CLEAR")
  if (edge >= 0.75) return("LEAN")
  "TOSS-UP"
}

rows <- probs |>
  mutate(
    play_id = as.character(play_id),
    optimal = mapply(pick_option, go_wp, fg_wp, punt_wp),
    edge_pp = mapply(pick_edge, go_wp, fg_wp, punt_wp),
    certainty = vapply(edge_pp, certainty_from_edge, character(1))
  ) |>
  transmute(
    play_id,
    desc,
    posteam,
    qtr,
    quarter_seconds_remaining,
    ydstogo,
    yardline_100,
    score_differential,
    posteam_timeouts_remaining,
    defteam_timeouts_remaining,
    first_down_prob,
    wp_fail,
    wp_succeed,
    go_wp,
    fg_make_prob,
    miss_fg_wp,
    make_fg_wp,
    fg_wp,
    punt_wp,
    go_boost,
    optimal,
    edge_pp,
    certainty
  )

espn_ids <- unique(as.character(plays$espn_id))
espn_ids <- espn_ids[nzchar(espn_ids) & !is.na(espn_ids)]
if (!length(espn_ids)) stop("No ESPN event id found")
espn_id <- espn_ids[[1]]

out <- list(
  schema_version = 1,
  source = "nfl4th::add_4th_probs",
  source_repo = "https://github.com/nflverse/nfl4th",
  game_id = gid,
  espn_id = espn_id,
  generated_at = format(Sys.time(), tz = "UTC", usetz = TRUE),
  rows = rows
)

dir.create("public/benchmarks", recursive = TRUE, showWarnings = FALSE)
path <- file.path("public", "benchmarks", paste0(espn_id, ".json"))
jsonlite::write_json(out, path, pretty = TRUE, auto_unbox = TRUE, na = "null", digits = 10, dataframe = "rows")
message("Wrote ", path, " with ", nrow(rows), " fourth-down states")
