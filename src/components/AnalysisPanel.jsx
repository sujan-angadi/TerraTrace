import React, { useEffect, useState } from 'react';
import './AnalysisPanel.css';

const SECTIONS = [
  { id: 'rainfall', title: 'Rainfall', icon: '🌧️', unit: 'mm/month' },
  { id: 'hydrology', title: 'Hydrology & Soil', icon: '💧', unit: 'm³/m³' },
  { id: 'impact', title: 'Industrial Impact', icon: '🏭', unit: 'Research' }
];

export default function AnalysisPanel({ selectedFacility, envTelemetry, bufferKm = 1 }) {
  const [active, setActive] = useState('rainfall');
  const [research, setResearch] = useState(null);

  useEffect(() => {
    fetch('/data/developer3-statistical-results.json')
      .then(r => r.ok ? r.json() : null)
      .then(setResearch)
      .catch(() => setResearch(null));
  }, []);

  const section = SECTIONS.find(x => x.id === active);
  const indicators = envTelemetry?.indicators || [];
  const source = envTelemetry?.source || 'Not specified';
  const available = envTelemetry?.state === 'available';

  const matches = indicators.filter(item => {
    const s = `${item.key} ${item.label}`.toLowerCase();
    if (active === 'rainfall') return /rain|precip|gpm/.test(s);
    if (active === 'hydrology') return /soil|moisture|water|hydro/.test(s);
    return true;
  });

  const globalResults = research?.before_after_results || [];
  const significance = research?.statistical_significance_and_confidence_intervals || [];

  return (
    <main className="tt-analysis">
      <header className="tt-analysis-header">
        <div>
          <span className="tt-analysis-kicker">TERRATRACE / RESEARCH WORKSPACE</span>
          <h1>Environmental Analysis</h1>
          <p>Satellite observations, facility telemetry and environmental research.</p>
        </div>
        <span className="tt-analysis-status">
          {envTelemetry?.state === 'loading' ? '● Loading facility data' :
           available ? '● Facility data available' : '● Research mode'}
        </span>
      </header>

      <section className="tt-analysis-grid">
        {SECTIONS.map(x => (
          <button key={x.id}
            className={`tt-analysis-card ${active === x.id ? 'selected' : ''}`}
            onClick={() => setActive(x.id)}>
            <span className="tt-analysis-icon">{x.icon}</span>
            <strong>{x.title}</strong>
            <small>{x.id === 'impact' ? 'Before/after and DiD research' : x.unit}</small>
          </button>
        ))}
      </section>

      <section className="tt-analysis-detail">
        <div className="tt-analysis-detail-head">
          <div>
            <span className="tt-analysis-kicker">SELECTED INDICATOR</span>
            <h2>{section.icon} {section.title}</h2>
            <p>Verified observations only. Missing data is not treated as zero.</p>
          </div>
          <span className="tt-analysis-unit">{section.unit}</span>
        </div>

        <div className="tt-analysis-facility">
          <strong>Selected facility</strong>
          <span>{selectedFacility?.name || selectedFacility?.facility_name || 'No facility selected'}</span>
          <small>Observation buffer: {bufferKm} km · {envTelemetry?.state || 'No telemetry state'}</small>
          {envTelemetry?.endpoint && <small>Endpoint: {envTelemetry.endpoint}</small>}
        </div>

        {envTelemetry?.state === 'loading' && <p className="tt-analysis-message">Loading environmental observations...</p>}
        {envTelemetry?.state === 'connection_error' && <p className="tt-analysis-error">{envTelemetry.message}</p>}

        {active !== 'impact' && (
          <>
            <h3 className="tt-analysis-section-title">Facility observations</h3>
            <p className="tt-analysis-source">Source: {source}</p>
            {matches.length ? (
              <div className="tt-analysis-observation-grid">
                {matches.map((item, i) => (
                  <article className="tt-analysis-observation" key={item.key || i}>
                    <small>{item.label}</small>
                    <strong>{typeof item.value === 'number' ? item.value.toLocaleString(undefined, {maximumFractionDigits: 4}) : String(item.value)} {item.unit}</strong>
                    {item.period && <small>Period: {item.period}</small>}
                    {item.quality && <small>Quality: {item.quality}</small>}
                  </article>
                ))}
              </div>
            ) : (
              <div className="tt-analysis-notice">
                {available
                  ? `No ${section.title.toLowerCase()} indicators were returned for this facility. Other environmental variables may still be available.`
                  : envTelemetry?.message || `No verified ${section.title.toLowerCase()} measurements are currently available for this facility.`}
              </div>
            )}
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
              <strong>DiD estimate: Not yet calculated or validated.</strong>
              <br/>
              Comparable pre/post SO₂ outcome observations, treatment timing validation and parallel-trend checks are required before reporting a causal estimate.
            </div>
            <p className="tt-analysis-footnote">
              MODIS results describe global facility-level temperature changes between 2022 and 2023. They do not establish that industrial facilities caused those changes.
            </p>
          </>
        )}

        <details className="tt-analysis-raw">
          <summary>Inspect facility telemetry response</summary>
          <pre>{JSON.stringify(envTelemetry || {}, null, 2).slice(0, 15000)}</pre>
        </details>
      </section>
      <footer className="tt-analysis-footer">
        TerraTrace · NASA Earth observation research · Data coverage and limitations must be considered.
      </footer>
    </main>
  );
}
