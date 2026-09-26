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

out_dir <- Sys.getenv("BENCHMARK_OUTPUT_DIR", unset = "public/benchmarks")
status_path <- Sys.getenv("BENCHMARK_STATUS_PATH", unset = file.path(out_dir, "_status.json"))
pipeline_version <- "v0.3.1"

parts <- strsplit(gid, "_", fixed = TRUE)[[1]]
season <- suppressWarnings(if (length(parts) >= 1) as.integer(parts[[1]]) else NA_integer_)
current_year <- as.integer(format(Sys.Date(), "%Y"))

dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
dir.create(dirname(status_path), recursive = TRUE, showWarnings = FALSE)

write_status <- function(code, label, status_message, espn_id = NULL, output_file = NULL, row_count = NULL) {
  payload <- list(
    schema_version = 1,
    pipeline_version = pipeline_version,
    code = code,
    label = label,
    game_id = gid,
    season = if (is.finite(season)) season else NULL,
    espn_id = espn_id,
    generated_at = format(Sys.time(), tz = "UTC", usetz = TRUE),
    message = status_message,
    output_file = output_file,
    row_count = row_count
  )
  jsonlite::write_json(payload, status_path, pretty = TRUE, auto_unbox = TRUE, na = "null", null = "null")
  message("Status: ", label, " -> ", status_path)
}

finish_failure <- function(code, label, status_message, exit_status) {
  write_status(code, label, status_message)
  message(status_message)
  quit(save = "no", status = exit_status, runLast = FALSE)
}

classify_fetch_error <- function(msg) {
  lower <- tolower(msg)
  looks_missing <- grepl("404|not found|no data|unavailable|failed to download|cannot open|does not exist", lower)
  if (looks_missing && is.finite(season) && season >= current_year) return("DATA_NOT_YET_AVAILABLE")
  if (looks_missing) return("GAME_NOT_FOUND")
  "PIPELINE_ERROR"
}

message("Benchmarking ", gid, " with nfl4th...")
plays_result <- tryCatch(nfl4th::get_4th_plays(gid), error = identity)
if (inherits(plays_result, "error")) {
  msg <- conditionMessage(plays_result)
  code <- classify_fetch_error(msg)
  if (code == "DATA_NOT_YET_AVAILABLE") {
    finish_failure(code, paste0(if (is.finite(season)) season else "CURRENT-SEASON", " DATA NOT YET AVAILABLE"), msg, 2)
  }
  if (code == "GAME_NOT_FOUND") finish_failure(code, "GAME NOT FOUND", msg, 3)
  finish_failure(code, "PIPELINE ERROR", msg, 4)
}

plays <- plays_result
if (!is.data.frame(plays) || !nrow(plays)) {
  if (is.finite(season) && season >= current_year) {
    finish_failure("DATA_NOT_YET_AVAILABLE", paste0(season, " DATA NOT YET AVAILABLE"), paste0("No fourth-down plays returned for ", gid), 2)
  }
  finish_failure("GAME_NOT_FOUND", "GAME NOT FOUND", paste0("No fourth-down plays returned for ", gid), 3)
}

probs_result <- tryCatch(nfl4th::add_4th_probs(plays), error = identity)
if (inherits(probs_result, "error")) {
  finish_failure("PIPELINE_ERROR", "PIPELINE ERROR", conditionMessage(probs_result), 4)
}
probs <- probs_result

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

rows_result <- tryCatch({
  probs |>
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
}, error = identity)

if (inherits(rows_result, "error")) {
  finish_failure("PIPELINE_ERROR", "PIPELINE ERROR", conditionMessage(rows_result), 4)
}
rows <- rows_result

espn_ids <- unique(as.character(plays$espn_id))
espn_ids <- espn_ids[nzchar(espn_ids) & !is.na(espn_ids)]
if (!length(espn_ids)) {
  finish_failure("PIPELINE_ERROR", "PIPELINE ERROR", "nfl4th returned plays but no ESPN event id", 4)
}
espn_id <- espn_ids[[1]]

out <- list(
  schema_version = 2,
  pipeline_version = pipeline_version,
  source = "nfl4th::add_4th_probs",
  source_repo = "https://github.com/nflverse/nfl4th",
  status = "BENCHMARK_READY",
  game_id = gid,
  espn_id = espn_id,
  generated_at = format(Sys.time(), tz = "UTC", usetz = TRUE),
  rows = rows
)

path <- file.path(out_dir, paste0(espn_id, ".json"))
write_result <- tryCatch({
  jsonlite::write_json(out, path, pretty = TRUE, auto_unbox = TRUE, na = "null", digits = 10, dataframe = "rows")
  TRUE
}, error = identity)

if (inherits(write_result, "error")) {
  finish_failure("PIPELINE_ERROR", "PIPELINE ERROR", conditionMessage(write_result), 4)
}
if (!file.exists(path) || file.info(path)$size <= 0) {
  finish_failure("PIPELINE_ERROR", "PIPELINE ERROR", paste0("Benchmark output missing or empty: ", path), 4)
}

write_status(
  "BENCHMARK_READY",
  "BENCHMARK READY",
  paste0("Wrote ", nrow(rows), " nfl4th fourth-down states for ", gid),
  espn_id = espn_id,
  output_file = path,
  row_count = nrow(rows)
)
message("Wrote ", path, " with ", nrow(rows), " fourth-down states")
