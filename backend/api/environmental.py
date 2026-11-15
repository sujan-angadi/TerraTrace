from pathlib import Path
from functools import lru_cache

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/environmental", tags=["Environmental Data"])

ROOT = Path(__file__).resolve().parents[1]
PHASE1 = ROOT / "data/integration/phase1"
PHASE2 = ROOT / "data/integration/phase2"

SNAPSHOT = PHASE2 / "global_facility_soil_moisture_snapshot.csv.gz"
FACILITY_LOOKUP = PHASE1 / "global_facility_rainfall_lookup.csv.gz"
GPM_GRID = PHASE1 / "global_gpm_grid_monthly_with_facility_counts.csv.gz"


def records(df):
    return df.astype(object).where(pd.notna(df), None).to_dict(orient="records")


@lru_cache(maxsize=1)
def load_snapshot():
    return pd.read_csv(SNAPSHOT, dtype={"facility_id": str})


@lru_cache(maxsize=1)
def load_lookup():
    return pd.read_csv(FACILITY_LOOKUP, dtype={"facility_id": str})


@lru_cache(maxsize=1)
def load_gpm():
    return pd.read_csv(GPM_GRID, dtype={"gpm_pixel_key": str})


@router.get("/stats")
def environmental_stats():
    df = load_snapshot()

    return {
        "facilities": int(df["facility_id"].nunique()),
        "countries": int(df["country"].nunique()),
        "valid_soil_moisture": int((df["quality_flag"] == "valid").sum()),
        "missing_or_out_of_range": int((df["quality_flag"] != "valid").sum()),
        "observation_time": df["observation_time_utc"].iloc[0],
        "soil_moisture_source": "NASA SMAP L4 SPL4SMGP V008",
        "rainfall_source": "NASA GPM IMERG V07B",
        "rainfall_periods": 45,
        "rainfall_start": "2022-01",
        "rainfall_end": "2025-09",
        "warning": "Soil moisture represents one three-hourly observation, not a historical time series."
    }


@router.get("/facilities")
def environmental_facilities(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0)
):
    df = load_snapshot()

    return {
        "total": len(df),
        "limit": limit,
        "offset": offset,
        "facilities": records(df.iloc[offset:offset + limit])
    }


@router.get("/facilities/{facility_id}")
def environmental_facility(facility_id: str):
    snapshot = load_snapshot()
    match = snapshot[snapshot["facility_id"] == facility_id]

    if match.empty:
        raise HTTPException(status_code=404, detail="Facility not found")

    lookup = load_lookup()
    facility_mapping = lookup[lookup["facility_id"] == facility_id]

    if facility_mapping.empty:
        raise HTTPException(status_code=404, detail="Facility rainfall mapping not found")

    pixel_key = facility_mapping.iloc[0]["gpm_pixel_key"]
    gpm = load_gpm()
    rainfall = gpm[gpm["gpm_pixel_key"] == pixel_key].sort_values(
        ["year", "month"]
    )

    return {
        "facility": records(match)[0],
        "monthly_rainfall": records(rainfall),
        "soil_moisture_temporal_resolution": "single observation",
        "rainfall_temporal_resolution": "monthly",
        "rainfall_source": "NASA GPM IMERG V07B",
        "soil_moisture_source": "NASA SMAP L4 SPL4SMGP V008"
    }
