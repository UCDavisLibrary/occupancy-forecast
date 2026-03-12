# Library Occupancy Modeling and Evaluation

A Node.js CLI tool that generates same-day occupancy forecasts for UC Davis libraries by building statistical profiles from historical foot-traffic sensor data (from vendor Sensource).

## Primary Features

- **Occupancy profiles** – builds median and percentile (p10, p25, p75, p90) relative-occupancy curves for each day-of-week and schedule-type (*reduced*, *normal*, *expanded*, or *summer*) combination from historical Sensource data.
- **Accuracy evaluation** – compares profile predictions against actual Libcal hours and Sensource occupancy and reports hourly and summary error metrics.

## Prerequisites

- NodeJs. Tested on v24.4
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

Create a `.env` file in the project root:

```env
SENSOURCE_CLIENT_ID=your_sensource_client_id
SENSOURCE_CLIENT_SECRET=your_sensource_client_secret
LIBCAL_CLIENT_ID=your_libcal_client_id
LIBCAL_CLIENT_SECRET=your_libcal_client_secret
```

Sensource credentials can be retrieved from `https://vea.sensourceinc.com/#/login`

Libcal credentials can be retrieved from `https://reservations.library.ucdavis.edu/admin/api/authentication`. Required scope is `Hours - Read`

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

or

```
./bin/index.js  <command> [options]
```

For any command you can add the `-h` flag for a list of options.

### `spaces`

List all Sensource spaces available to the configured credentials.

```bash
occupancy-forecast spaces
```

This will tell you the Sensource spaceId for the Library you want to generate a prediction model for.

### `generate`

The main command for this package. Builds same-day occupancy profiles from historical data and save them to `data/profiles/`.


**Example:**

```bash
occupancy-forecast generate --config config/shields.json
```

### `hours`

Export estimated open/close times for every day in the historical range to a CSV file in `data/reports/`. Good for evaluating hours estimate accuracy before running the generate command.

```bash
occupancy-forecast hours --config config/shields.json
```

### `evaluate`

Compare profile predictions against actual Libcal hours for a date range and print accuracy metrics.

**Example:**

```
./bin/index.js evaluate -p ./data/profiles/profiles_062b96af-5c92-4889-a212-1bd5706812b5.json -s 2026-03-05 -e 2026-03-10 -l 18170
```

## Output

All output is written inside a `data/` directory that is created automatically at the project root:

```
data/
├── cache/        # Raw Sensource and Libcal API responses (JSON) — prevents redundant API calls
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
- `median` / `percentiles` – relative occupancy as a percentage of `capacity` for the library.

See `Evaluation.js` for an example of how to use the profiles to predict occupancy for a given day. The basic procedure is:
1. Compute the scale for each 30 minute bucket you have data for so far in the day: `scale = (Σ y_b * p_b) / (Σ p_b^2)` where `p_b` is the typical profile value at time bucket b, and `y_b` is today’s observed value at that same bucket
2. For each bucket you want to select the best matching profile with a sufficient sample size e.g. if `[tuesday, summer]` doesn't have enough observations, fall back to `[tuesday]`
3. For the rest of the buckets get the forecast with `forecast_b = scale * p_b`

## How it works

1. **Data retrieval** – Historical Sensource occupancy data is fetched to generate profiles (requests are automatically chunked and cached for performance)
2. **Preprocessing** – Records with sensor errors are removed; relative occupancy (`avgoccupancy / capacity × 100`) is computed for each 30-minute interval.
3. **Open/close estimation** – For each calendar day the first interval where cumulative entries exceed `openThreshold` is treated as open, and the last interval where cumulative exits exceed `closeThreshold` is treated as close. This introduces error, but it appears to be manageable, and we don't have historical business hour ranges.
4. **Schedule classification** – Each day is labelled *expanded*, *summer*, *reduced*, or *normal* based on hours-open and configured thresholds.
5. **Profile generation** – Days are grouped by weekday and schedule type. Relative occupancy at each period distance from open (and to close) is aggregated into median and percentile statistics.
6. **Prediction** – During evaluation a profile hierarchy (`[weekday + scheduleType] → [weekday] → [scheduleType]`) is tried in order, falling back to broader groupings when a specific combination lacks sufficient data.
