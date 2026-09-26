suppressPackageStartupMessages({
  library(nfl4th)
  library(dplyr)
  library(jsonlite)
  library(stringr)
})

start_season <- as.integer(Sys.getenv("START_SEASON", unset = "2021"))
end_season <- as.integer(Sys.getenv("END_SEASON", unset = "2025"))
holdout_season <- as.integer(Sys.getenv("HOLDOUT_SEASON", unset = as.character(end_season)))

if (!is.finite(start_season) || !is.finite(end_season) || start_season < 2014 || end_season < start_season) {
  stop("Invalid calibration season range")
}
if (!holdout_season %in% start_season:end_season) {
  stop("HOLDOUT_SEASON must fall inside START_SEASON:END_SEASON")
}

seasons <- start_season:end_season
out_dir <- ".calibration"
out_file <- file.path(out_dir, "reference.json")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

message("Loading nfl4th reference for seasons ", paste(seasons, collapse = ", "), "...")
message("This deliberately uses exact nfl4th probability computation rather than copying the live model.")

pbp <- nfl4th::load_4th_pbp(seasons, fast = FALSE)

character_cols <- c("play_type_nfl", "roof", "defteam", "season_type", "desc")
numeric_cols <- c(
  "no_play", "punt_attempt", "field_goal_attempt", "wp", "vegas_wp",
  "week", "game_seconds_remaining", "go"
)
for (nm in character_cols) {
  if (!nm %in% names(pbp)) pbp[[nm]] <- NA_character_
}
for (nm in numeric_cols) {
  if (!nm %in% names(pbp)) pbp[[nm]] <- NA_real_
}

clean <- pbp |>
  mutate(
    actual_decision = case_when(
      coalesce(punt_attempt, 0) == 1 | play_type_nfl == "PUNT" ~ "PUNT",
      coalesce(field_goal_attempt, 0) == 1 | play_type_nfl == "FIELD_GOAL" ~ "FG",
      go == 100 ~ "GO",
      TRUE ~ NA_character_
    ),
    indoor = tolower(coalesce(roof, "")) %in% c("dome", "closed"),
    game_seconds_remaining = ifelse(
      is.finite(game_seconds_remaining),
      game_seconds_remaining,
      pmax(0, (4 - qtr) * 900 + quarter_seconds_remaining)
    )
  ) |>
  filter(
    down == 4,
    qtr >= 1,
    qtr <= 4,
    !is.na(actual_decision),
    is.na(no_play) | no_play == 0,
    is.na(desc) | !str_detect(desc, regex("No Play", ignore_case = TRUE)),
    !is.na(posteam),
    !is.na(ydstogo),
    !is.na(yardline_100),
    !is.na(score_differential),
    !is.na(posteam_timeouts_remaining),
    !is.na(defteam_timeouts_remaining),
    !is.na(go_wp),
    rowSums(!is.na(cbind(go_wp, fg_wp, punt_wp))) >= 2
  ) |>
  transmute(
    season = as.integer(season),
    week = as.integer(week),
    season_type = as.character(season_type),
    game_id = as.character(game_id),
    play_id = as.character(play_id),
    posteam = as.character(posteam),
    defteam = as.character(defteam),
    home_team = as.character(home_team),
    away_team = as.character(away_team),
    qtr = as.integer(qtr),
    quarter_seconds_remaining = as.numeric(quarter_seconds_remaining),
    game_seconds_remaining = as.numeric(game_seconds_remaining),
    ydstogo = as.numeric(ydstogo),
    yardline_100 = as.numeric(yardline_100),
    score_differential = as.numeric(score_differential),
    posteam_timeouts_remaining = as.numeric(posteam_timeouts_remaining),
    defteam_timeouts_remaining = as.numeric(defteam_timeouts_remaining),
    indoor = as.logical(indoor),
    wp = as.numeric(wp),
    vegas_wp = as.numeric(vegas_wp),
    actual_decision = as.character(actual_decision),
    go_wp = as.numeric(go_wp),
    fg_wp = as.numeric(fg_wp),
    punt_wp = as.numeric(punt_wp),
    first_down_prob = as.numeric(first_down_prob),
    fg_make_prob = as.numeric(fg_make_prob),
    desc = as.character(desc)
  ) |>
  arrange(season, game_id, play_id)

if (nrow(clean) < 1000) {
  stop("Calibration export unexpectedly small: ", nrow(clean))
}

payload <- list(
  metadata = list(
    schema_version = 1,
    source = "nfl4th::load_4th_pbp(fast = FALSE)",
    nfl4th_version = as.character(utils::packageVersion("nfl4th")),
    generated_at = format(Sys.time(), tz = "UTC", usetz = TRUE),
    start_season = start_season,
    end_season = end_season,
    holdout_season = holdout_season,
    seasons = seasons,
    rows = nrow(clean),
    methodology = "Only real GO/FG/PUNT fourth-down decisions. No-play penalties and non-decision fourth-down states are excluded."
  ),
  rows = clean
)

jsonlite::write_json(
  payload,
  out_file,
  pretty = FALSE,
  auto_unbox = TRUE,
  na = "null",
  null = "null",
  digits = 10,
  dataframe = "rows"
)

message("Wrote ", nrow(clean), " decisions to ", out_file)
