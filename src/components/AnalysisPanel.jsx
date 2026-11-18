import React, { useEffect, useState } from 'react';
import './AnalysisPanel.css';

const SECTIONS = [
  { id: 'rainfall', title: 'Rainfall', icon: '🌧️', unit: 'mm/month', hint: 'NASA GPM IMERG' },
  { id: 'hydrology', title: 'Hydrology & Soil', icon: '💧', unit: 'Environmental indicators', hint: 'Water and soil observations' },
  { id: 'impact', title: 'Industrial Impact', icon: '🏭', unit: 'Research', hint: 'Before/after and DiD research' },
  { id: 'temperature', title: 'Temperature', icon: '🌡️', unit: '°C', hint: 'MODIS daytime & nighttime LST' }
];

const numberOrNull = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const fmt = (value, digits = 2) => {
  const n = numberOrNull(value);
  return n === null ? 'Not available' : n.toLocaleString(undefined, { maximumFractionDigits: digits });
};


function findActualDidEstimate(node, path = '') {
  if (!node || typeof node !== 'object') return null;
  for (const [key, value] of Object.entries(node)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    const nextPath = path ? `${path}.${key}` : key;
    const isDidField = [
      'didestimate', 'differenceindifferencesestimate', 'attestimate',
      'treatmenteffectdid', 'didcoefficient',
    ].includes(normalized);
    if (isDidField && value !== null && value !== undefined && value !== '') {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return { value: numeric, path: nextPath };
    }
    if (value && typeof value === 'object') {
      const found = findActualDidEstimate(value, nextPath);
      if (found) return found;
    }
  }
  return null;
}

function Metric({ label, value, unit = '', detail }) {
  return (
    <article className="tt-analysis-observation">
      <small>{label}</small>
      <strong>{value === 'Not available' ? value : `${value}${unit ? ` ${unit}` : ''}`}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}

export default function AnalysisPanel({ selectedFacility, envTelemetry, bufferKm = 1 }) {
  const [active, setActive] = useState('rainfall');
  const [research, setResearch] = useState(null);

  useEffect(() => {
    fetch('/data/developer3-statistical-results.json')
      .then(r => r.ok ? r.json() : null)
      .then(setResearch)
      .catch(() => setResearch(null));
  }, []);

  const section = SECTIONS.find(x => x.id === active) || SECTIONS[0];
  const raw = selectedFacility?.raw || {};
  const indicators = envTelemetry?.indicators || [];
  const source = envTelemetry?.source || 'Facility inventory dataset';
  const matches = indicators.filter(item => {
    const s = `${item.key} ${item.label}`.toLowerCase();
    if (active === 'rainfall') return /rain|precip|gpm/.test(s);
    if (active === 'hydrology') return /soil|moisture|water|hydro|wind/.test(s);
    return true;
  });

  const globalResults = research?.before_after_results || [];
  const significance = research?.statistical_significance_and_confidence_intervals || [];
  const didEstimate = findActualDidEstimate(research);
  const facilityName = selectedFacility?.name || selectedFacility?.facility_name || 'No facility selected';

  return (
    <main className="tt-analysis">
      <header className="tt-analysis-header">
        <div>
          <span className="tt-analysis-kicker">TERRATRACE / RESEARCH WORKSPACE</span>
          <h1>Environmental Analysis</h1>
          <p>Facility-level satellite observations, environmental indicators and research.</p>
        </div>
        <span className="tt-analysis-status">● {selectedFacility ? 'Facility selected' : 'Research mode'}</span>
      </header>

      <section className="tt-analysis-grid">
        {SECTIONS.map(x => (
          <button key={x.id} className={`tt-analysis-card ${active === x.id ? 'selected' : ''}`}
            onClick={() => setActive(x.id)} aria-pressed={active === x.id}>
            <span className="tt-analysis-icon">{x.icon}</span>
            <strong>{x.title}</strong>
            <small>{x.hint}</small>
          </button>
        ))}
      </section>

      <section className="tt-analysis-detail">
        <div className="tt-analysis-detail-head">
          <div>
            <span className="tt-analysis-kicker">SELECTED INDICATOR</span>
            <h2>{section.icon} {section.title}</h2>
            <p>Facility-specific source values are shown where available. Missing values are never treated as zero.</p>
          </div>
          <span className="tt-analysis-unit">{section.unit}</span>
        </div>

        <div className="tt-analysis-facility">
          <strong>Selected facility</strong>
          <span>{facilityName}</span>
          <small>{selectedFacility?.country || ''} · Observation buffer: {bufferKm} km</small>
          {selectedFacility?.id && <small>Facility ID: {selectedFacility.id}</small>}
        </div>

        {active === 'rainfall' && (
          <>
            <h3 className="tt-analysis-section-title">NASA GPM rainfall observations</h3>
            <p className="tt-analysis-source">Source: {raw.gpm_gpm_source || source} · Monthly accumulation</p>
            <div className="tt-analysis-observation-grid">
              <Metric label="Mean monthly rainfall" value={fmt(raw.gpm_gpm_mean_monthly_accumulation_mm)} unit="mm/month" />
              <Metric label="Minimum monthly rainfall" value={fmt(raw.gpm_gpm_min_monthly_accumulation_mm)} unit="mm/month" />
              <Metric label="Maximum monthly rainfall" value={fmt(raw.gpm_gpm_max_monthly_accumulation_mm)} unit="mm/month" />
              <Metric label="Data coverage" value={fmt(raw.gpm_gpm_coverage_percent, 1)} unit="%" detail={raw.gpm_gpm_observed_months != null ? `${raw.gpm_gpm_observed_months} observed months` : null} />
              {matches.map((item, i) => <Metric key={item.key || i} label={item.label} value={fmt(item.value, 4)} unit={item.unit} detail={item.period ? `Period: ${item.period}` : item.quality} />)}
            </div>
            {numberOrNull(raw.gpm_gpm_mean_monthly_accumulation_mm) === null && matches.length === 0 &&
              <div className="tt-analysis-notice">No rainfall measurement is available for this facility in the loaded inventory or telemetry response.</div>}
          </>
        )}

        {active === 'hydrology' && (
          <>
            <h3 className="tt-analysis-section-title">Hydrology and soil-related observations</h3>
            <p className="tt-analysis-source">Only variables present in the source dataset are displayed. Wind speed is not soil moisture.</p>
            <div className="tt-analysis-observation-grid">
              <Metric label="Mean wind speed (10 m)" value={fmt(raw.wind_mean_speed_10m_m_s)} unit="m/s" />
              <Metric label="90th percentile wind speed (10 m)" value={fmt(raw.wind_p90_speed_10m_m_s)} unit="m/s" />
              <Metric label="Mean daily precipitation" value={fmt(raw.precipitation_mean_daily_mm)} unit="mm/day" />
              <Metric label="Wind / hydrology observations" value={fmt(raw.wind_hydro_observations, 0)} />
              <Metric label="Wind / hydrology data status" value={raw.wind_hydro_status || 'Not available'} />
              {matches.map((item, i) => <Metric key={item.key || i} label={item.label} value={fmt(item.value, 4)} unit={item.unit} detail={item.period || item.quality} />)}
            </div>
            <div className="tt-analysis-notice">Soil-moisture measurements are not included in the current 17-field static facility dataset. They are shown as unavailable rather than being inferred from rainfall or wind.</div>
          </>
        )}

        {active === 'temperature' && (
          <>
            <h3 className="tt-analysis-section-title">Facility land-surface temperature</h3>
            <p className="tt-analysis-source">Source: MODIS land-surface temperature (LST) · Values are satellite-derived surface temperatures, not air temperatures.</p>
            <div className="tt-analysis-observation-grid">
              <Metric label="Daytime mean LST" value={fmt(raw.modis_day_mean_lst_c)} unit="°C" detail={`${fmt(raw.modis_day_coverage_percent, 1)}% coverage`} />
              <Metric label="Nighttime mean LST" value={fmt(raw.modis_night_mean_lst_c)} unit="°C" detail={`${fmt(raw.modis_night_coverage_percent, 1)}% coverage`} />
              <Metric label="Combined mean LST" value={fmt(raw.modis_combined_mean_lst_c)} unit="°C" />
            </div>
            <div className="tt-analysis-notice">These are the values available for the selected facility in the processed MODIS dataset. A missing daytime or nighttime value means no valid value is available in this dataset for that facility.</div>
          </>
        )}

        {active === 'impact' && (
          <>
            <h3 className="tt-analysis-section-title">Global MODIS before/after comparison</h3>
            <p className="tt-analysis-source">2022 versus 2023 · Paired facility-level annual means · Descriptive, not causal</p>
            <div className="tt-analysis-observation-grid">
              {globalResults.map(result => {
                const sig = significance.find(x => x.variable === result.variable);
                return (
                  <article className="tt-analysis-observation" key={result.variable}>
                    <small>{result.period === 'day' ? 'Daytime LST' : 'Nighttime LST'}</small>
                    <strong>+{Number(result.mean_change_c).toFixed(2)} °C</strong>
                    <small>{Number(result.mean_2022_c).toFixed(2)}°C → {Number(result.mean_2023_c).toFixed(2)}°C</small>
                    <small>{Number(result.paired_facilities).toLocaleString()} paired facilities</small>
                    {sig && <small>95% CI: {Number(sig.ci_95_lower).toFixed(2)} to {Number(sig.ci_95_upper).toFixed(2)}°C</small>}
                    {sig && <small>Holm-adjusted p: {Number(sig.p_value_holm).toExponential(3)}</small>}
                    {sig && <small>Cohen's dz: {Number(sig.effect_size_cohens_dz).toFixed(3)}</small>}
                  </article>
                );
              })}
            </div>
            <h3 className="tt-analysis-section-title">Difference-in-Differences research</h3>
            <div className="tt-analysis-notice">
              <strong>FGD installation treatment/control study</strong>
              Treatment and control registers and installation cohorts are available in the Developer 3 research data.
              <br/><br/>
              {didEstimate ? (
                <>
                  <strong>DiD estimate: {didEstimate.value.toLocaleString(undefined, { maximumFractionDigits: 6 })}</strong>
                  <br/><small>Source field: {didEstimate.path}</small>
                </>
              ) : (
                <>
                  <strong>DiD estimate: Not available in the supplied research results.</strong>
                  <br/>
                  The supplied Developer 3 statistical-results file contains MODIS before/after comparisons, but no validated Difference-in-Differences estimate. Those descriptive changes must not be presented as a causal DiD result.
                </>
              )}
              <br/>
              A real DiD estimate can be displayed once the treatment/control outcome analysis, treatment timing and validation results are included in the research data.
            </div>
            <p className="tt-analysis-footnote">MODIS results describe global facility-level temperature changes between 2022 and 2023. They do not establish that industrial facilities caused those changes.</p>
          </>
        )}

        <details className="tt-analysis-raw">
          <summary>Inspect selected facility source fields</summary>
          <pre>{JSON.stringify(raw, null, 2).slice(0, 15000)}</pre>
        </details>
      </section>
      <footer className="tt-analysis-footer">TerraTrace · NASA Earth observation research · Data coverage and limitations must be considered.</footer>
    </main>
  );
}
