import React, { useState } from 'react';
import InteractiveEarthGlobe from './components/InteractiveEarthGlobe.jsx';
import './LandingPage.css';

const CAPABILITIES = [
  {
    code: 'MONITOR',
    title: 'Facility Environment Monitoring',
    description: 'Explore environmental indicators around industrial facilities.',
    detail:
      'Inspect localized precipitation records, surface temperature context, and vegetative conditions within configurable 1 km to 25 km spatial buffers.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
      </svg>
    ),
  },
  {
    code: 'COMPARE',
    title: 'Historical Baseline Comparison',
    description: 'Compare environmental conditions across historical periods.',
    detail:
      'Evaluate multi-year and seasonal observations side by side to distinguish normal climatic variability from persistent local changes.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M3 3v18h18" />
        <path d="M7 14l4-4 4 3 5-6" />
        <path d="M7 18l4-2 4 1 5-4" strokeDasharray="2 2" />
      </svg>
    ),
  },
  {
    code: 'DETECT',
    title: 'Spatial & Temporal Change Detection',
    description: 'Identify geographical and temporal changes in environmental indicators.',
    detail:
      'Track how surface reflectance, vegetation indices, hydrological patterns, and atmospheric columns evolve over time around infrastructure.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    code: 'SCREEN',
    title: 'Preliminary Site Screening',
    description:
      'Support preliminary environmental screening of potential industrial development locations.',
    detail:
      'Review historical baseline trends, regional precipitation behavior, and proximity to existing power facilities prior to detailed field assessment.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 10h18M9 4v16" />
      </svg>
    ),
  },
];

const DATA_SOURCES = [
  {
    name: 'NASA GPM IMERG',
    agency: 'NASA / JAXA',
    category: 'Precipitation & Hydrological Context',
    integrationRole: 'Global Precipitation & Facility Rainfall Pipeline',
    resolution: '0.1° (~10 km) Global Grid',
    description:
      'Provides multi-satellite precipitation estimates paired with mapped facility coordinates to evaluate regional rainfall trends and anomalies.',
  },
  {
    name: 'MODIS Terra',
    agency: 'NASA EOS',
    category: 'Land Surface Temperature & Vegetation',
    integrationRole: 'Regional Thermal & Spectral Baseline Pipeline',
    resolution: '250 m – 1 km Composites',
    description:
      'Supports long-term Land Surface Temperature (LST) and broad-scale vegetative index tracking around energy corridors.',
  },
  {
    name: 'Landsat 8/9',
    agency: 'NASA / USGS',
    category: 'Multispectral & Thermal Infrared',
    integrationRole: 'Site-Scale Optical & Thermal Pipeline',
    resolution: '30 m Optical / 100 m Thermal',
    description:
      'Captures multi-year land-cover transformation, surface reflectance shifts, and localized thermal signatures across facility buffer zones.',
  },
  {
    name: 'Sentinel-2',
    agency: 'ESA Copernicus',
    category: 'High-Resolution Multispectral Optical',
    integrationRole: 'Fine-Scale Vegetation & Surface Pipeline',
    resolution: '10 m – 20 m Revisit',
    description:
      'Enables high-resolution NDVI vegetation health profiling and surface water boundary delineation near infrastructure footprints.',
  },
  {
    name: 'Sentinel-1',
    agency: 'ESA Copernicus',
    category: 'C-Band Synthetic Aperture Radar (SAR)',
    integrationRole: 'All-Weather Structural & Surface Pipeline',
    resolution: '10 m Interferometric Wide Swath',
    description:
      'Provides cloud-penetrating radar backscatter observations to detect structural surface changes and water extent independent of daylight.',
  },
  {
    name: 'Sentinel-5P',
    agency: 'ESA Copernicus',
    category: 'TROPOMI Atmospheric Spectrometer',
    integrationRole: 'Regional Atmospheric Column Pipeline',
    resolution: '3.5 × 5.5 km Tropospheric Column',
    description:
      'Monitors regional tropospheric concentrations of nitrogen dioxide (NO₂), sulfur dioxide (SO₂), carbon monoxide (CO), and aerosols.',
  },
];

const WORKFLOW_STAGES = [
  {
    step: '01',
    title: 'Global Facility Inventory + Satellite Observations',
    description:
      'Combines 145,596 geolocated power facilities across 226 countries with archival and near-real-time spaceborne Earth observation datasets.',
  },
  {
    step: '02',
    title: 'Geospatial Processing',
    description:
      'Constructs analytical coordinate buffers (default 1 km radius), aligns projections, and extracts regional observation windows.',
  },
  {
    step: '03',
    title: 'Data Normalization and Quality Filtering',
    description:
      'Applies cloud masking, sensor calibration adjustments, and seasonal baseline alignment to ensure comparable multi-year records.',
  },
  {
    step: '04',
    title: 'Environmental Time-Series Analysis',
    description:
      'Computes longitudinal trends across precipitation, surface temperature, vegetation health, and atmospheric indicators.',
  },
  {
    step: '05',
    title: 'Change Detection and Visualization',
    description:
      'Renders interactive geospatial layers, satellite imagery views, and site-level intelligence inside the TerraTrace map dashboard.',
  },
];

export default function LandingPage({ onLaunchDashboard }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleLaunch = (e) => {
    if (e) e.preventDefault();
    setMobileNavOpen(false);
    if (typeof onLaunchDashboard === 'function') {
      onLaunchDashboard();
    } else {
      window.location.href = '/dashboard';
    }
  };

  const scrollToSection = (e, sectionId) => {
    e.preventDefault();
    setMobileNavOpen(false);
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="lp-root" id="overview">
      <header className="lp-header">
        <div className="lp-container lp-header__inner">
          <a
            href="#overview"
            className="lp-brand"
            onClick={(e) => scrollToSection(e, 'overview')}
          >
            <span className="lp-brand__icon" aria-hidden="true">
              <svg viewBox="0 0 28 28" fill="none">
                <circle cx="14" cy="14" r="10" stroke="#0f766e" strokeWidth="1.75" />
                <path
                  d="M4.5 14h19M14 4.5c2.7 2.6 4.2 5.9 4.2 9.5s-1.5 6.9-4.2 9.5c-2.7-2.6-4.2-5.9-4.2-9.5S11.3 7.1 14 4.5z"
                  stroke="#0f766e"
                  strokeWidth="1.4"
                />
                <circle cx="19.5" cy="9.5" r="2.5" fill="#1d4ed8" stroke="#ffffff" strokeWidth="1.2" />
              </svg>
            </span>
            <span className="lp-brand__name">TerraTrace</span>
          </a>

          <nav className={`lp-nav ${mobileNavOpen ? 'lp-nav--open' : ''}`} aria-label="Main Navigation">
            <a href="#overview" className="lp-nav__link" onClick={(e) => scrollToSection(e, 'overview')}>
              Overview
            </a>
            <a href="#capabilities" className="lp-nav__link" onClick={(e) => scrollToSection(e, 'capabilities')}>
              Capabilities
            </a>
            <a href="#data-sources" className="lp-nav__link" onClick={(e) => scrollToSection(e, 'data-sources')}>
              Data Sources
            </a>
            <a href="#about" className="lp-nav__link" onClick={(e) => scrollToSection(e, 'about')}>
              About
            </a>
            <button type="button" className="lp-btn lp-btn--nav" onClick={handleLaunch}>
              Launch Dashboard
            </button>
          </nav>

          <button
            type="button"
            className="lp-mobile-menu-btn"
            aria-label="Toggle Menu"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </header>

      <main className="lp-main">
        {/* ENORMOUS UNBOXED 3D EARTH BACKGROUND LAYER */}
        <InteractiveEarthGlobe />

        {/* HERO SECTION (Foreground Content Over the Earth Horizon) */}
        <section className="lp-hero">
          <div className="lp-container lp-hero__content">
            <div className="lp-hero__copy">
              <div className="lp-badge">
                <span className="lp-badge__dot" />
                <span>EARTH OBSERVATION &amp; INFRASTRUCTURE ANALYTICS</span>
              </div>

              <h1 className="lp-hero__title">
                See How Industrial Development Changes Our Planet.
              </h1>

              <p className="lp-hero__subtitle">
                TerraTrace transforms satellite observations and global infrastructure data into environmental insights, helping users monitor changes, compare historical conditions and explore potential industrial development locations.
              </p>

              <div className="lp-hero__actions">
                <button type="button" className="lp-btn lp-btn--primary" onClick={handleLaunch}>
                  Explore Global Map →
                </button>
                <a
                  href="#how-it-works"
                  className="lp-btn lp-btn--secondary"
                  onClick={(e) => scrollToSection(e, 'how-it-works')}
                >
                  Discover How It Works
                </a>
              </div>

              <div className="lp-hero__quick-facts">
                <div className="lp-quick-fact">
                  <strong>145,596</strong>
                  <span>Mapped Power Facilities</span>
                </div>
                <div className="lp-quick-fact__divider" aria-hidden="true" />
                <div className="lp-quick-fact">
                  <strong>226</strong>
                  <span>Countries &amp; Territories</span>
                </div>
                <div className="lp-quick-fact__divider" aria-hidden="true" />
                <div className="lp-quick-fact">
                  <strong>6</strong>
                  <span>Satellite Mission Feeds</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* GLOBAL PERSPECTIVE */}
        <section className="lp-section lp-section--over-earth" id="about">
          <div className="lp-container">
            <div className="lp-perspective-grid">
              <div className="lp-perspective__intro">
                <span className="lp-eyebrow">GLOBAL PERSPECTIVE</span>
                <h2 className="lp-section-title">
                  Grounded in a Verified Global Power-Facility Inventory
                </h2>
                <p className="lp-section-text">
                  Understanding how energy and industrial infrastructure interacts with surrounding ecosystems requires reliable baseline coordinates. TerraTrace links multi-mission satellite archives to a curated global power-facility registry.
                </p>
                <div className="lp-scope-callout">
                  <strong>Inventory Scope Note:</strong> These statistics represent a verified <strong>global power-facility inventory</strong> covering documented electricity-generating plants worldwide. It is not a complete inventory of every industrial or manufacturing facility on Earth.
                </div>
              </div>

              <div className="lp-perspective__metrics">
                <div className="lp-metric-card">
                  <span className="lp-metric-card__tag">MAPPED INFRASTRUCTURE</span>
                  <div className="lp-metric-card__value">145,596</div>
                  <div className="lp-metric-card__label">mapped power facilities</div>
                  <p className="lp-metric-card__desc">
                    Geolocated solar, wind, hydro, thermal, nuclear, geothermal, and bioenergy power plants indexed with capacity, status, and fuel metadata.
                  </p>
                </div>

                <div className="lp-metric-card">
                  <span className="lp-metric-card__tag">GEOGRAPHIC COVERAGE</span>
                  <div className="lp-metric-card__value">226</div>
                  <div className="lp-metric-card__label">countries and territories</div>
                  <p className="lp-metric-card__desc">
                    Standardized country-level aggregation supporting cross-regional filtering, coordinate lookup, and localized environmental context inspection.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CAPABILITIES */}
        <section className="lp-section lp-section--over-earth" id="capabilities">
          <div className="lp-container">
            <div className="lp-section-header">
              <span className="lp-eyebrow">CORE CAPABILITIES</span>
              <h2 className="lp-section-title">
                Four Analytical Workflows for Environmental Intelligence
              </h2>
              <p className="lp-section-text">
                Purpose-built tools to inspect local indicators, compare multi-year records, detect spatial changes, and screen candidate locations.
              </p>
            </div>

            <div className="lp-capabilities-grid">
              {CAPABILITIES.map((cap) => (
                <article key={cap.code} className="lp-cap-card">
                  <div className="lp-cap-card__top">
                    <span className="lp-cap-card__icon" aria-hidden="true">
                      {cap.icon}
                    </span>
                    <span className="lp-cap-card__code">{cap.code}</span>
                  </div>
                  <h3 className="lp-cap-card__title">{cap.title}</h3>
                  <p className="lp-cap-card__lead">{cap.description}</p>
                  <p className="lp-cap-card__detail">{cap.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* DATA SOURCES */}
        <section className="lp-section lp-section--subtle" id="data-sources">
          <div className="lp-container">
            <div className="lp-section-header">
              <span className="lp-eyebrow">EARTH OBSERVATION SOURCES</span>
              <h2 className="lp-section-title">
                Spaceborne Sensors &amp; Observational Feeds
              </h2>
              <p className="lp-section-text">
                TerraTrace draws from six complementary Earth-observation missions across optical, thermal, radar, atmospheric, and precipitation domains.
              </p>
            </div>

            <div className="lp-integration-notice">
              <strong>Integration Transparency:</strong> Not all satellite sources are equally integrated into every facility view or analysis. The interactive global map couples the <strong>145,596-facility inventory</strong> with <strong>NASA GPM IMERG</strong> precipitation context and satellite imagery layers, while <strong>MODIS Terra</strong>, <strong>Landsat 8/9</strong>, and <strong>Sentinel-1/2/5P</strong> feeds support targeted environmental analysis pipelines where spatial and temporal coverage is available.
            </div>

            <div className="lp-sources-grid">
              {DATA_SOURCES.map((source) => (
                <div key={source.name} className="lp-source-card">
                  <div className="lp-source-card__header">
                    <span className="lp-source-card__agency">{source.agency}</span>
                    <span className="lp-source-card__res">{source.resolution}</span>
                  </div>
                  <h3 className="lp-source-card__name">{source.name}</h3>
                  <div className="lp-source-card__category">{source.category}</div>
                  <p className="lp-source-card__desc">{source.description}</p>
                  <div className="lp-source-card__role">
                    <span>Scope:</span> {source.integrationRole}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* HOW TERRATRACE WORKS */}
        <section className="lp-section" id="how-it-works">
          <div className="lp-container">
            <div className="lp-section-header">
              <span className="lp-eyebrow">METHODOLOGY &amp; PIPELINE</span>
              <h2 className="lp-section-title">How TerraTrace Works</h2>
              <p className="lp-section-text">
                A structured five-stage geospatial pipeline transforms raw infrastructure coordinates and satellite observations into interpretable environmental context.
              </p>
            </div>

            <div className="lp-workflow" aria-label="TerraTrace 5-stage processing workflow">
              {WORKFLOW_STAGES.map((stage, index) => (
                <React.Fragment key={stage.step}>
                  <div className="lp-workflow-step">
                    <div className="lp-workflow-step__badge">{stage.step}</div>
                    <div className="lp-workflow-step__body">
                      <h3 className="lp-workflow-step__title">{stage.title}</h3>
                      <p className="lp-workflow-step__desc">{stage.description}</p>
                    </div>
                  </div>
                  {index < WORKFLOW_STAGES.length - 1 && (
                    <div className="lp-workflow-arrow" aria-hidden="true">
                      ↓
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="lp-cta-section">
          <div className="lp-container">
            <div className="lp-cta-card">
              <div className="lp-cta-card__content">
                <span className="lp-eyebrow">INTERACTIVE GEOSPATIAL PLATFORM</span>
                <h2 className="lp-cta-card__title">
                  Explore Environmental Change. Understand the Bigger Picture.
                </h2>
                <p className="lp-cta-card__desc">
                  Inspect 145,596 mapped power facilities across 226 countries and territories, switch to live satellite imagery, and examine localized observation buffers.
                </p>
                <button
                  type="button"
                  className="lp-btn lp-btn--primary lp-btn--lg"
                  onClick={handleLaunch}
                >
                  Launch TerraTrace Dashboard →
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer__inner">
          <div className="lp-footer__row">
            <div className="lp-footer__brand">
              <strong>TerraTrace</strong> <span aria-hidden="true">|</span> NASA Space Apps Challenge
            </div>
            <div className="lp-footer__nav">
              <a href="#overview" onClick={(e) => scrollToSection(e, 'overview')}>Overview</a>
              <a href="#capabilities" onClick={(e) => scrollToSection(e, 'capabilities')}>Capabilities</a>
              <a href="#data-sources" onClick={(e) => scrollToSection(e, 'data-sources')}>Data Sources</a>
              <a href="#about" onClick={(e) => scrollToSection(e, 'about')}>About</a>
              <a href="/dashboard" onClick={handleLaunch}>Launch Dashboard</a>
            </div>
          </div>
          <p className="lp-footer__disclaimer">
            TerraTrace supports environmental monitoring and preliminary site screening. Satellite observations alone do not establish causation or certify construction-site safety.
          </p>
        </div>
      </footer>
    </div>
  );
}