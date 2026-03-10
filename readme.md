# Library Occupancy Modeling and Evaluation

A Node.js CLI tool that generates same-day occupancy forecasts for libraries by building statistical profiles from historical foot-traffic sensor data.

## Features

- **Occupancy profiles** – builds median and percentile (p10, p25, p75, p90) relative-occupancy curves for each day-of-week and schedule-type combination from historical Sensource data.
- **Open/close estimation** – derives library open and close times automatically from entry/exit sensor counts when no historical schedule is available.
- **Schedule classification** – labels each day as *reduced*, *normal*, *expanded*, or *summer* based on configurable hour thresholds.
- **Accuracy evaluation** – compares profile predictions against actual Libcal hours and reports hourly and summary error metrics.
- **API caching** – stores raw Sensource responses locally so repeat runs don't re-fetch the same data.
- **CSV and JSON reports** – exports estimated hours and generated profiles to `data/reports/` and `data/profiles/`.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- Sensource API credentials (OAuth 2.0 client ID and secret)
- Libcal API credentials (OAuth 2.0 client ID and secret) — required for the `evaluate` command only

## Installation

```bash
git clone https://github.com/UCDavisLibrary/occupancy-forecast.git
cd occupancy-forecast
npm install
```

To use the CLI globally:

```bash
npm install -g .
```

## Configuration

### Environment variables

Create a `.env` file in the project root (this file is git-ignored):

```env
SENSOURCE_CLIENT_ID=your_sensource_client_id
SENSOURCE_CLIENT_SECRET=your_sensource_client_secret
LIBCAL_CLIENT_ID=your_libcal_client_id
LIBCAL_CLIENT_SECRET=your_libcal_client_secret
```

### Config file (optional)

Instead of passing every flag on the command line you can supply a JSON config file with `--config <path>`. Command-line flags override config-file values. An example config is provided at `config/shields.json`:

```json
{
  "space": "062b96af-5c92-4889-a212-1bd5706812b5",
  "startDate": "2023-07-01",
  "openThreshold": 25,
  "closeThreshold": 25,
  "capacity": 3000,
  "reducedThreshold": 10,
  "expandedThreshold": 18
}
```

## Usage

```
occupancy-forecast <command> [options]
```

### `spaces`

List all Sensource spaces available to the configured credentials.

```bash
occupancy-forecast spaces
```

### `generate`

Build same-day occupancy profiles from historical data and save them to `data/profiles/`.

```bash
occupancy-forecast generate \
  --space <spaceId> \
  --startDate <YYYY-MM-DD> \
  --openThreshold <n> \
  --closeThreshold <n> \
  --capacity <n> \
  [--reducedThreshold <hours>] \
  [--expandedThreshold <hours>] \
  [--config <path/to/config.json>]
```

| Option | Description |
|---|---|
| `--space` | Sensource space UUID. Use `spaces` command to find it. |
| `--startDate` | Earliest date to pull historical data from (`YYYY-MM-DD`). Rounded down to the most recent half-year boundary (Jan 1 or Jul 1). |
| `--openThreshold` | Minimum cumulative entries in a 30-minute window to consider the library open. |
| `--closeThreshold` | Minimum cumulative exits in a 30-minute window to consider the library closed. |
| `--capacity` | Total seating/person capacity; used to compute relative-occupancy percentages. |
| `--reducedThreshold` | Hours open below which a day is classified as *reduced* schedule. |
| `--expandedThreshold` | Hours open at or above which a day is classified as *expanded* schedule. |
| `--config` | Path to a JSON config file. |

**Example:**

```bash
occupancy-forecast generate --config config/shields.json
```

### `hours`

Export estimated open/close times for every day in the historical range to a CSV file in `data/reports/`.

```bash
occupancy-forecast hours \
  --space <spaceId> \
  --startDate <YYYY-MM-DD> \
  --openThreshold <n> \
  --closeThreshold <n> \
  --capacity <n> \
  [--config <path/to/config.json>]
```

Accepts the same options as `generate`. The CSV contains `date`, `weekday`, `open`, `close`, and `scheduleType` columns.

### `evaluate`

Compare profile predictions against actual Libcal hours for a date range and print accuracy metrics.

```bash
occupancy-forecast evaluate \
  --profilePath <path/to/profiles_<spaceId>.json> \
  --libcalLocationId <id> \
  --startDate <YYYY-MM-DD> \
  --endDate <YYYY-MM-DD> \
  [--startPeriod <hours>] \
  [--minimumSampleSize <n>]
```

| Option | Description |
|---|---|
| `-p, --profilePath` | Path to the profile JSON file produced by `generate`. |
| `-l, --libcalLocationId` | Libcal location ID. Found in Libcal admin under **Admin → Hours → Libraries**. |
| `-s, --startDate` | Start of the evaluation window (`YYYY-MM-DD`). |
| `-e, --endDate` | End of the evaluation window (`YYYY-MM-DD`). |
| `--startPeriod` | Hour of day from which to begin predicting occupancy. |
| `--minimumSampleSize` | Minimum data points required before attempting a prediction for a given day. |

## Output

All output is written inside a `data/` directory that is created automatically at the project root:

```
data/
├── cache/        # Raw Sensource API responses (JSON) — prevents redundant API calls
├── profiles/     # Generated occupancy profile files — profiles_<spaceId>.json
└── reports/      # Exported CSV files — hours_<spaceId>.csv
```

### Profile format

Each profile JSON file contains the configuration used to generate it and an array of profiles, one per day-of-week × schedule-type combination:

```json
{
  "config": { ... },
  "profiles": [
    {
      "grouping": { "weekday": "Mon", "scheduleType": "normal" },
      "periodsFromOpen": [
        { "period": 0, "median": 12, "count": 42, "percentiles": { "p10": 5, "p25": 8, "p75": 18, "p90": 24 } },
        ...
      ],
      "periodsToClose": [ ... ]
    },
    ...
  ]
}
```

- `period` – number of 30-minute intervals from the estimated open time (`periodsFromOpen`) or until the estimated close time (`periodsToClose`).
- `median` / `percentiles` – relative occupancy as a percentage of `capacity`.

## How it works

1. **Data retrieval** – Sensource occupancy data is fetched in half-year chunks and cached locally.
2. **Preprocessing** – Records with sensor errors are removed; relative occupancy (`avgoccupancy / capacity × 100`) is computed for each 30-minute interval.
3. **Open/close estimation** – For each calendar day the first interval where cumulative entries exceed `openThreshold` is treated as open, and the last interval where cumulative exits exceed `closeThreshold` is treated as close.
4. **Schedule classification** – Each day is labelled *expanded*, *summer*, *reduced*, or *normal* based on hours-open and configured thresholds.
5. **Profile generation** – Days are grouped by weekday and schedule type. Relative occupancy at each period distance from open (and to close) is aggregated into median and percentile statistics.
6. **Prediction** – During evaluation a profile hierarchy (`[weekday + scheduleType] → [weekday] → [scheduleType]`) is tried in order, falling back to broader groupings when a specific combination lacks sufficient data.
