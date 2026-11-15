from .environmental import router as environmental_router
from pathlib import Path
from functools import lru_cache
import json

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="TerraTrace API",
    description="Global Earth observation, facility monitoring and environmental change analysis",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(environmental_router)

DATA = Path("data/integration/validated")
PROCESSED = Path("data/processed")


def load_json(filename):
    path = DATA / filename
    if not path.exists():
        raise HTTPException(404, f"{filename} not available yet")
    with path.open() as file:
        return json.load(file)


@lru_cache(maxsize=1)
def load_facilities():
    path = PROCESSED / "global_facility_grid_mapping.csv"
    if not path.exists():
        raise HTTPException(404, "Global facility mapping not available")
    return pd.read_csv(path, dtype={"GEM_Location_ID": str})


@lru_cache(maxsize=1)
def load_rainfall():
    path = PROCESSED / "global_gpm_monthly_rainfall.csv.gz"
    if not path.exists():
        raise HTTPException(404, "Global GPM rainfall dataset not available")
    return pd.read_csv(path)


def clean_records(frame):
    return frame.astype(object).where(pd.notna(frame), None).to_dict("records")


@app.get("/health")
def health():
    return {"status": "running", "service": "TerraTrace", "version": "0.2.0"}


@app.get("/observations")
def observations(
    variable: str | None = None,
    source: str | None = None,
):
    records = load_json("normalized_observations.json")

    if variable:
        records = [r for r in records if r.get("variable") == variable]
    if source:
        records = [r for r in records if r.get("source") == source]

    return {"count": len(records), "observations": records}


@app.get("/timeseries")
def timeseries(variable: str | None = None):
    records = load_json("monthly_analysis.json")

    if variable:
        records = [r for r in records if r.get("variable") == variable]

    return {"count": len(records), "results": records}


@app.get("/report")
def report():
    observations = load_json("normalized_observations.json")
    analysis = load_json("monthly_analysis.json")

    return {
        "observation_count": len(observations),
        "analysis_groups": len(analysis),
        "analysis": analysis,
    }


@app.get("/change-detection")
def change_detection():
    return load_json("change_detection.json")


@app.get("/global-stats")
def global_stats():
    facilities = load_facilities()
    rainfall = load_rainfall()

    periods = (
        rainfall["year"].astype(int).astype(str)
        + "-"
        + rainfall["month"].astype(int).astype(str).str.zfill(2)
    )

    # Global country aggregation
    countries = (
        facilities["Country"]
        .dropna()
        .value_counts()
        .sort_index()
        .to_dict()
    )

    # Global facility category aggregation
    facility_types = (
        facilities["Facility_Type"]
        .dropna()
        .value_counts()
        .to_dict()
    )

    return {
        "facility_count": len(facilities),
        "country_count": len(countries),
        "countries": {str(k): int(v) for k, v in countries.items()},
        "facility_types": {str(k): int(v) for k, v in facility_types.items()},
        "unique_gpm_pixels": int(rainfall["gpm_pixel_key"].nunique()),
        "rainfall_observations": len(rainfall),
        "rainfall_months": int(
            rainfall[["year", "month"]].drop_duplicates().shape[0]
        ),
        "rainfall_period": {
            "start": periods.min(),
            "end": periods.max(),
        },
        "rainfall_source": "NASA GPM IMERG V07B",
    }


@app.get("/facilities")
def facilities(
    country: str | None = None,
    facility_type: str | None = None,
    search: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    df = load_facilities()

    if country:
        df = df[df["Country"].str.casefold() == country.casefold()]

    if facility_type:
        df = df[df["Facility_Type"].str.casefold() == facility_type.casefold()]

    if search:
        mask = (
            df["Facility_Name"].str.contains(search, case=False, na=False)
            | df["Country"].str.contains(search, case=False, na=False)
        )
        df = df[mask]

    total = len(df)
    results = clean_records(df.iloc[offset:offset + limit])

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "facilities": results,
    }


@app.get("/facilities/{facility_id}/rainfall")
def facility_rainfall(facility_id: str):
    facilities_df = load_facilities()
    match = facilities_df[
        facilities_df["GEM_Location_ID"].astype(str) == str(facility_id)
    ]

    if match.empty:
        raise HTTPException(404, "Facility not found")

    facility = match.iloc[0]
    pixel_key = facility["gpm_pixel_key"]

    rainfall = load_rainfall()
    result = rainfall[rainfall["gpm_pixel_key"] == pixel_key].copy()
    result = result.sort_values(["year", "month"])

    return {
        "facility": {
            "id": str(facility["GEM_Location_ID"]),
            "name": facility["Facility_Name"],
            "country": facility["Country"],
            "type": facility["Facility_Type"],
            "latitude": float(facility["Latitude"]),
            "longitude": float(facility["Longitude"]),
            "gpm_pixel_key": pixel_key,
        },
        "rainfall_count": len(result),
        "rainfall": clean_records(result),
    }


@app.get("/facilities/{facility_id}")
def facility_detail(facility_id: str):
    df = load_facilities()
    match = df[df["GEM_Location_ID"].astype(str) == str(facility_id)]

    if match.empty:
        raise HTTPException(404, "Facility not found")

    return clean_records(match)[0]


# TerraTrace: full integrated environmental profile lookup
import csv as _tt_csv
import os
from pathlib import Path as _tt_Path
from fastapi import HTTPException as _tt_HTTPException

_TT_PROFILE_CSV = _tt_Path(os.environ.get("TT_PROFILE_CSV", str(_tt_Path(__file__).resolve().parents[1] / "data/processed/analysis/developer3_integrated_facility_dataset_v6.csv")))
_TT_PROFILE_INDEX = None

def _tt_get_profile_index():
    global _TT_PROFILE_INDEX
    if _TT_PROFILE_INDEX is None:
        if not _TT_PROFILE_CSV.exists():
            raise RuntimeError(f"Integrated dataset not found: {_TT_PROFILE_CSV}")
        with _TT_PROFILE_CSV.open("r", encoding="utf-8-sig", newline="") as f:
            _TT_PROFILE_INDEX = {
                row["facility_id"]: row
                for row in _tt_csv.DictReader(f)
                if row.get("facility_id")
            }
    return _TT_PROFILE_INDEX

@app.get("/facilities/{facility_id}/environmental-profile")
def get_full_environmental_profile(facility_id: str):
    try:
        index = _tt_get_profile_index()
        profile = index.get(facility_id)
        if profile is None:
            raise _tt_HTTPException(
                status_code=404,
                detail="Facility not found in integrated environmental dataset"
            )

        numeric_fields = {
            "capacity_mw", "latitude", "longitude",
            "gpm_gpm_observed_months", "gpm_gpm_expected_months",
            "gpm_gpm_coverage_percent", "gpm_gpm_mean_monthly_accumulation_mm",
            "gpm_gpm_std_monthly_accumulation_mm", "gpm_gpm_min_monthly_accumulation_mm",
            "gpm_gpm_max_monthly_accumulation_mm", "gpm_gpm_mean_precipitation_rate_mm_hr",
            "gpm_gpm_mean_quality_index", "gpm_gpm_mean_random_error_mm_hr",
            "modis_months_present", "solar_mean_daily_ghi_2011_2025",
            "solar_median_daily_ghi_2011_2025", "solar_daily_ghi_std_dev_2011_2025",
            "solar_mean_annual_ghi_2011_2025", "solar_annual_ghi_std_dev_2011_2025",
            "solar_data_coverage_percent", "modis_day_valid_count",
            "modis_day_mean_lst_c", "modis_day_strict_count",
            "modis_day_extended_count", "modis_day_coverage_percent",
            "modis_night_valid_count", "modis_night_mean_lst_c",
            "modis_night_strict_count", "modis_night_extended_count",
            "modis_night_coverage_percent"
        }

        result = {}
        for key, value in profile.items():
            if value == "":
                result[key] = None
            elif key in numeric_fields:
                try:
                    number = float(value)
                    result[key] = int(number) if number.is_integer() else number
                except (ValueError, TypeError):
                    result[key] = None
            else:
                result[key] = value

        return {
            "facility_id": facility_id,
            "environmental_profile": result,
            "dataset": "Developer 3 integrated facility dataset v6",
            "record_count": len(index)
        }
    except _tt_HTTPException:
        raise
    except Exception as exc:
        raise _tt_HTTPException(status_code=500, detail=str(exc))
