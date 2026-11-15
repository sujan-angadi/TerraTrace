import { API_BASE } from '../services/api.js';
import { useEffect, useMemo, useState } from 'react';
import './SiteSuitabilityPanel.css';

const fmt = (v, digits = 2) =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? 'Not available'
    : Number(v).toFixed(digits);

export default function SiteSuitabilityPanel({ selectedFacility }) {
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    fetch('/data/site-suitability-top.json')
      .then(r => {
        if (!r.ok) throw new Error('Could not load site suitability data');
        return r.json();
      })
      .then(d => { if (active) setData(d); })
      .catch(e => { if (active) setError(e.message); });

    fetch('/data/analysis-summary.json')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (active) setStats(d); })
      .catch(() => {});

    return () => { active = false; };
  }, []);

  const selectedId = String(
    selectedFacility?.gem_id || selectedFacility?.id || ''
  );

  const [fullSelectedResult, setFullSelectedResult] = useState(null);

  useEffect(() => {
    if (!selectedId) {
      setFullSelectedResult(null);
      return;
    }

    let active = true;
    fetch(`${API_BASE}/facilities/${encodeURIComponent(selectedId)}/environmental-profile`)
      .then(r => r.ok ? r.json() : null)
      .then(result => {
        if (active) {
          setFullSelectedResult(result?.environmental_profile
            ? { facility: result.environmental_profile, monthly_rainfall: [], dataset: result.dataset }
            : null);
        }
      })
      .catch(() => {
        if (active) setFullSelectedResult(null);
      });

    return () => { active = false; };
  }, [selectedId]);

  const selectedResult = useMemo(() => {
    if (!selectedId) return null;
    return data?.facilities?.find(
      f => String(f.facility_id) === selectedId
    ) || fullSelectedResult?.facility || fullSelectedResult || null;
  }, [data, selectedId, fullSelectedResult]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.facilities.filter(f =>
      !q ||
      String(f.facility_name || '').toLowerCase().includes(q) ||
      String(f.country || '').toLowerCase().includes(q) ||
      String(f.facility_id || '').toLowerCase().includes(q)
    ).slice(0, 30);
  }, [data, query]);

  const trends = stats?.before_after_results || [];
  const significance = stats?.statistical_significance_and_confidence_intervals || [];

  return (
    <section className="tt-research-panel">
      <button
        className="tt-research-toggle"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <span>
          <strong>Site Suitability & Research</strong>
          <small>Satellite-derived environmental screening and resource indicators</small>
        </span>
        <span>{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div className="tt-research-content">
          {error && <p className="tt-research-error">{error}</p>}

          {!data && !error && <p>Loading analytical dataset…</p>}

          {data && (
            <>
              <div className="tt-research-summary">
                <div>
                  <small>Ranked facilities loaded</small>
                  <strong>{data.count.toLocaleString()}</strong>
                </div>
                <div>
                  <small>Total facilities scored</small>
                  <strong>{data.total_scored.toLocaleString()}</strong>
                </div>
              </div>

              <h4>Selected Facility Assessment</h4>

              {selectedFacility ? (
                selectedResult ? (
                  <div className="tt-assessment-card">
                    <div className="tt-score-row">
                      <span>Relative screening score</span>
                      <strong>{fmt(selectedResult.mcda_score_0_100, 1)}/100</strong>
                    </div>
                    <div className="tt-score-track">
                      <span style={{
                        width: `${Math.max(0, Math.min(100, Number(selectedResult.mcda_score_0_100) || 0))}%`
                      }} />
                    </div>
                    <p>Dataset rank: #{selectedResult.rank}</p>
                    <p>
                      Criteria coverage: {selectedResult.criteria_available}/
                      {selectedResult.criteria_expected} (
                      {fmt(selectedResult.criteria_coverage_percent, 0)}%)
                    </p>
                    <p>Daytime land-surface temperature: {fmt(selectedResult.modis_day_mean_lst_c)} °C</p>
                    <p>Nighttime land-surface temperature: {fmt(selectedResult.modis_night_mean_lst_c)} °C</p>
                    <p>Mean wind speed: {fmt(selectedResult.wind_mean_speed_2011_2025_m_per_s)} m/s</p>
                    <p>Mean daily solar GHI: {fmt(selectedResult.solar_mean_daily_ghi_2011_2025)} kWh/m²/day</p>
                  </div>
                ) : (
                  <p className="tt-research-muted">
                    No matching ranked record found in the top 5,000. This does not mean the facility has no environmental data.
                  </p>
                )
              ) : (
                <p className="tt-research-muted">
                  Select a facility on the map to view its matching assessment.
                </p>
              )}

              {fullSelectedResult?.facility && (
                <>
                  <h4>Location-Specific Environmental Observations</h4>
                  <div className="tt-assessment-card">
                    <strong>NASA SMAP Soil Moisture</strong>
                    <p>Surface: {fmt(fullSelectedResult.facility.surface_soil_moisture_m3_m3, 3)} m³/m³</p>
                    <p>Root zone: {fmt(fullSelectedResult.facility.rootzone_soil_moisture_m3_m3, 3)} m³/m³</p>
                    <p>Profile: {fmt(fullSelectedResult.facility.profile_soil_moisture_m3_m3, 3)} m³/m³</p>
                    <small>
                      {fullSelectedResult.facility.source || 'NASA SMAP'} ·
                      {' '}{fullSelectedResult.facility.quality_flag || 'Quality not reported'} ·
                      {' '}{fullSelectedResult.facility.observation_time_utc || 'Date unavailable'}
                    </small>
                  </div>

                  <h4>Integrated Satellite Environmental Profile</h4>
                  <div className="tt-assessment-card">
                    <strong>NASA MODIS Land Surface Temperature</strong>
                    <p>Daytime: {fmt(fullSelectedResult.facility.modis_day_mean_lst_c, 2)} °C</p>
                    <p>Nighttime: {fmt(fullSelectedResult.facility.modis_night_mean_lst_c, 2)} °C</p>
                    <p>Combined day/night LST: {fmt(fullSelectedResult.facility.modis_combined_mean_lst_c, 2)} °C</p>
                    <small>Day coverage: {fmt(fullSelectedResult.facility.modis_day_coverage_percent, 1)}% · Night coverage: {fmt(fullSelectedResult.facility.modis_night_coverage_percent, 1)}%</small>
                    <small>Valid months: {fullSelectedResult.facility.modis_months_present ?? 'Not available'}</small>
                  </div>
                  <div className="tt-assessment-card">
                    <strong>NASA GPM IMERG Rainfall Summary</strong>
                    <p>Mean monthly accumulation: {fmt(fullSelectedResult.facility.gpm_gpm_mean_monthly_accumulation_mm, 2)} mm/month</p>
                    <p>Minimum: {fmt(fullSelectedResult.facility.gpm_gpm_min_monthly_accumulation_mm, 2)} mm · Maximum: {fmt(fullSelectedResult.facility.gpm_gpm_max_monthly_accumulation_mm, 2)} mm</p>
                    <small>Coverage: {fmt(fullSelectedResult.facility.gpm_gpm_coverage_percent, 1)}% · Observed months: {fullSelectedResult.facility.gpm_gpm_observed_months ?? 'Not available'}</small>
                    <small>Period: {fullSelectedResult.facility.gpm_gpm_start_month || 'Unknown'} to {fullSelectedResult.facility.gpm_gpm_end_month || 'Unknown'} · {fullSelectedResult.facility.gpm_gpm_source || 'NASA GPM'}</small>
                  </div>
                  <div className="tt-assessment-card">
                    <strong>Solar Resource — NASA POWER</strong>
                    <p>Mean daily GHI: {fmt(fullSelectedResult.facility.solar_mean_daily_ghi_2011_2025, 2)} {fullSelectedResult.facility.solar_ghi_unit || ''}</p>
                    <p>Mean annual GHI: {fmt(fullSelectedResult.facility.solar_mean_annual_ghi_2011_2025, 2)}</p>
                    <small>Coverage: {fmt(fullSelectedResult.facility.solar_data_coverage_percent, 1)}%</small>
                  </div>
                  <div className="tt-assessment-card">
                    <strong>Global Wind Resource — NASA POWER Grid Analysis</strong>
                    <p>Mean wind speed: {fmt(fullSelectedResult.facility.global_wind_mean_speed_10m_m_s ?? fullSelectedResult.facility.wind_mean_speed_10m_m_s, 2)} m/s</p>
                    <p>90th percentile wind speed: {fmt(fullSelectedResult.facility.global_wind_p90_speed_10m_m_s ?? fullSelectedResult.facility.wind_p90_speed_10m_m_s, 2)} m/s</p>
                    <p>Grid cell: {fullSelectedResult.facility.global_wind_cell_key || fullSelectedResult.facility.wind_hydro_cell_key || 'Unavailable'}</p>
                    <small>
                      {fullSelectedResult.facility.global_wind_status || fullSelectedResult.facility.wind_hydro_status || 'Coverage unavailable'}
                      · {fmt(fullSelectedResult.facility.global_wind_observations ?? fullSelectedResult.facility.wind_hydro_observations, 0)} observations
                    </small>
                    <small>Regional 1° grid estimate at 10 m height; not a direct facility measurement.</small>
                  </div>
                  <div className="tt-assessment-card">
                    <strong>Vegetation Health — NDVI</strong>
                    <p>Mean NDVI: {fmt(fullSelectedResult.facility.mean_ndvi ?? fullSelectedResult.facility.ndvi_mean ?? fullSelectedResult.facility.ndvi, 3)}</p>
                    <small>
                      {fullSelectedResult.facility.mean_ndvi != null || fullSelectedResult.facility.ndvi_mean != null || fullSelectedResult.facility.ndvi != null
                        ? 'Validated NDVI observation available'
                        : 'No validated NDVI observation available for this facility.'}
                    </small>
                  </div>
                  <h4>NASA GPM Monthly Rainfall</h4>
                  <div className="tt-ranking-list">
                    {(fullSelectedResult.monthly_rainfall || []).slice(-12).map((r) => (
                      <div className="tt-ranking-item" key={`${r.year}-${r.month}`}>
                        <span>{String(r.month).padStart(2, '0')}/{r.year}</span>
                        <div>
                          <strong>{fmt(r.estimated_monthly_accumulation_mm, 1)} mm</strong>
                          <small>Quality index: {fmt(r.quality_index, 1)}</small>
                        </div>
                        <b>GPM</b>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <h4>Explore Site Rankings</h4>
              <input
                className="tt-research-search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search facility, country or ID…"
              />

              <div className="tt-ranking-list">
                {filtered.map(f => (
                  <div className="tt-ranking-item" key={f.facility_id}>
                    <span className="tt-rank-number">#{f.rank}</span>
                    <div>
                      <strong>{f.facility_name || f.facility_id}</strong>
                      <small>{f.country || 'Country unavailable'} · {f.criteria_available}/{f.criteria_expected} criteria</small>
                    </div>
                    <b>{fmt(f.mcda_score_0_100, 1)}</b>
                  </div>
                ))}
                {filtered.length === 0 && <p>No matching facility in the loaded ranking.</p>}
              </div>

              <h4>Global MODIS Temperature Comparison</h4>
              {trends.map(t => {
                const sig = significance.find(s => s.variable === t.variable);
                return (
                  <div className="tt-trend-card" key={t.variable}>
                    <strong>{t.period === 'day' ? 'Daytime' : 'Nighttime'} land-surface temperature</strong>
                    <p>2022: {fmt(t.mean_2022_c)} °C → 2023: {fmt(t.mean_2023_c)} °C</p>
                    <p>Mean change: +{fmt(t.mean_change_c)} °C</p>
                    <p>Paired facilities: {Number(t.paired_facilities).toLocaleString()}</p>
                    {sig && (
                      <>
                        <p>95% CI: {fmt(sig.ci_95_lower)} to {fmt(sig.ci_95_upper)} °C</p>
                        <p>Holm-adjusted p-value: {Number(sig.p_value_holm).toExponential(3)}</p>
                        <p>Effect size (Cohen's dz): {fmt(sig.effect_size_cohens_dz, 3)}</p>
                        <span className="tt-significance">
                          {sig.significant_after_holm_0_05
                            ? 'Statistically significant after Holm correction'
                            : 'Not statistically significant after Holm correction'}
                        </span>
                      </>
                    )}
                  </div>
                );
              })}

              <div className="tt-research-limitations">
                <strong>Scientific interpretation and limitations</strong>
                <ul>
                  {data.limitations.map((item, i) => <li key={i}>{item}</li>)}
                  <li>2022–2023 comparisons are descriptive temporal comparisons, not causal estimates of facility impact.</li>
                  <li>Statistical significance does not imply a large practical effect.</li>
                  <li>Only the top 5,000 ranked records are included in this frontend preview.</li>
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
