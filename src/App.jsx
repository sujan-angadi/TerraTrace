import SiteSuitabilityPanel from './components/SiteSuitabilityPanel';
import AnalysisPanel from './components/AnalysisPanel';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  API_BASE,
  fetchInitialDashboardData,
  fetchAdditionalInventorySample,
  fetchFacilities,
  searchFacilitiesAutocomplete,
  fetchFacilityEnvironmentalData,
  clearApiCache,
} from './services/api.js';
import './App.css';

const BUFFER_OPTIONS_KM = [1, 5, 10, 25];

const CATEGORY_COLORS = {
  Solar: '#d97706',
  Wind: '#0284c7',
  Hydropower: '#2563eb',
  'Oil/Gas': '#475569',
  Coal: '#334155',
  Bioenergy: '#15803d',
  Nuclear: '#7c3aed',
  Geothermal: '#dc2626',
  Unspecified: '#0f766e',
};

/* Task 1: Keyless Map Tile Providers (Removed CARTO basemaps.cartocdn.com API key error) */
const MAP_LAYERS = {
  light: {
    id: 'light',
    label: 'Light GIS',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    fallbackUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (Light GIS)',
    tileFilterClass: 'tt-tiles-light-gis',
  },
  standard: {
    id: 'standard',
    label: 'Standard Street',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    fallbackUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    tileFilterClass: '',
  },
  satellite: {
    id: 'satellite',
    label: 'Satellite View',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    fallbackUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, USDA, USGS',
    tileFilterClass: '',
  },
  terrain: {
    id: 'terrain',
    label: 'Topographic',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    fallbackUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      'Tiles &copy; Esri &mdash; Esri, USGS, NOAA | &copy; OpenStreetMap contributors',
    tileFilterClass: '',
  },
};

function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || '#0f766e';
}

function formatHemisphereCoords(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '—';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

export default function App({ onNavigateHome }) {
  /* Core Facility Store & Backend Aggregations */
  const [facilityStore, setFacilityStore] = useState(() => new Map());
  const [countryList, setCountryList] = useState([]);
  const [categoryList, setCategoryList] = useState([]);
  const [totalSitesCount, setTotalSitesCount] = useState(0);
  const [totalCountriesCount, setTotalCountriesCount] = useState(0);
  const [endpointsUsed, setEndpointsUsed] = useState([]);
  const [nextSampleOffset, setNextSampleOffset] = useState(2500);

  /* Country Filter State (Supports Single & Multi-Selection) */
  const [selectedCountries, setSelectedCountries] = useState([]); // empty = All Countries
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [countrySearchText, setCountrySearchText] = useState('');
  const [multiCountryMode, setMultiCountryMode] = useState(false);

  /* Category Filter State */
  const [selectedCategory, setSelectedCategory] = useState('All');

  /* Facility Search Autocomplete State */
  const [facilitySearchText, setFacilitySearchText] = useState('');
  const [autocompleteResults, setAutocompleteResults] = useState([]);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  /* Map & Viewport State */
  const [activeLayer, setActiveLayer] = useState('light');
  const [activeSatelliteOverlay, setActiveSatelliteOverlay] = useState('none');
  const satelliteOverlayRef = useRef(null);
  const [layerFallbackNotice, setLayerFallbackNotice] = useState('');
  const [clusteringEnabled, setClusteringEnabled] = useState(true);
  const [mapZoom, setMapZoom] = useState(2.5);
  const [viewportBounds, setViewportBounds] = useState(null);

  /* Selected Facility & Analytical Observation Buffer (Default 1 km) */
  const [selectedFacility, setSelectedFacility] = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [bufferKm, setBufferKm] = useState(1);
  const [copiedCoords, setCopiedCoords] = useState(false);

  /* API & Loading Status */
  const [apiState, setApiState] = useState('loading'); // 'loading' | 'online' | 'offline' | 'error'
  const [apiError, setApiError] = useState('');
  const [filterLoading, setFilterLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  /* Environmental Feed State */
  const [envTelemetry, setEnvTelemetry] = useState({
    state: 'idle',
    indicators: [],
    timeSeries: null,
    source: null,
    period: null,
    quality: null,
    endpoint: null,
    message: '',
  });

  /* DOM & Leaflet Refs */
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const boundaryLayerRef = useRef(null);
  const canvasRendererRef = useRef(null);
  const countryDropdownRef = useRef(null);
  const searchDropdownRef = useRef(null);

  /* Close dropdowns on outside click */
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(e.target)) {
        setCountryDropdownOpen(false);
      }
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(e.target)) {
        setAutocompleteOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  /* Load Initial Dashboard Dataset & Aggregations */
  const loadDashboardData = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) clearApiCache();
    setApiState('loading');
    setApiError('');

    const result = await fetchInitialDashboardData();
    if (!result.ok) {
      setApiState(result.apiState || 'offline');
      setApiError(result.error || `Unable to reach FastAPI server at ${API_BASE}`);
      return;
    }

    const store = new Map();
    result.facilities.forEach((f) => store.set(f.id, f));

    setFacilityStore(store);
    setCountryList(result.countries);
    setCategoryList(result.categories);
    setTotalSitesCount(result.totalFacilities);
    setTotalCountriesCount(result.totalCountries);
    setEndpointsUsed(result.endpointsUsed || []);
    setApiState('online');
  }, []);

  useEffect(() => {
    loadDashboardData(false);
  }, [loadDashboardData]);

  /* Progressive background discovery if initial country list has fewer than totalCountriesCount */
  useEffect(() => {
    if (apiState !== 'online') return;
    if (countryList.length >= totalCountriesCount || nextSampleOffset > 140000) return;

    const timer = setTimeout(async () => {
      const more = await fetchAdditionalInventorySample({
        currentOffset: nextSampleOffset,
        step: 5500,
        batches: 4,
      });
      if (more.length > 0) {
        setFacilityStore((prev) => {
          const next = new Map(prev);
          more.forEach((f) => next.set(f.id, f));
          return next;
        });
        setNextSampleOffset((prev) => prev + 22000);
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [apiState, countryList.length, totalCountriesCount, nextSampleOffset]);

  /* All Cached Facilities */
  const allFacilities = useMemo(
    () => Array.from(facilityStore.values()),
    [facilityStore]
  );

  /* Dynamically Synchronized Country List (with Facility Counts) */
  const dynamicCountries = useMemo(() => {
    const counts = new Map();
    countryList.forEach((c) => counts.set(c.name, c.count));

    const loadedCounts = new Map();
    allFacilities.forEach((f) => {
      if (f.country && f.country !== 'Unspecified') {
        loadedCounts.set(f.country, (loadedCounts.get(f.country) || 0) + 1);
        if (!counts.has(f.country)) counts.set(f.country, null);
      }
    });

    return Array.from(counts.entries())
      .map(([name, reportedCount]) => ({
        name,
        count: reportedCount ?? loadedCounts.get(name) ?? 0,
        loadedCount: loadedCounts.get(name) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [countryList, allFacilities]);

  /* Filtered Countries for Searchable Country Autocomplete Dropdown */
  const filteredCountryOptions = useMemo(() => {
    const q = countrySearchText.trim().toLowerCase();
    if (!q) return dynamicCountries;
    return dynamicCountries.filter((c) => c.name.toLowerCase().includes(q));
  }, [dynamicCountries, countrySearchText]);

  /* Dynamically Synchronized Facility Categories */
  const dynamicCategories = useMemo(() => {
    const catMap = new Map();
    categoryList.forEach((c) => catMap.set(c.name, { ...c }));

    const loadedCounts = new Map();
    allFacilities.forEach((f) => {
      if (f.category) {
        loadedCounts.set(f.category, (loadedCounts.get(f.category) || 0) + 1);
        if (!catMap.has(f.category)) {
          catMap.set(f.category, {
            name: f.category,
            count: 0,
            rawToken: f.raw_type || f.category.toLowerCase(),
          });
        }
      }
    });

    return Array.from(catMap.values())
      .map((c) => ({
        ...c,
        count: Math.max(c.count || 0, loadedCounts.get(c.name) || 0),
        loadedCount: loadedCounts.get(c.name) || 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [categoryList, allFacilities]);

  /* Fetch Targeted Records When User Filters by Country or Category */
  useEffect(() => {
    if (apiState !== 'online') return;
    if (selectedCountries.length === 0 && selectedCategory === 'All') return;

    let cancelled = false;
    setFilterLoading(true);

    const catEntry = dynamicCategories.find((c) => c.name === selectedCategory);
    const backendCategoryToken =
      selectedCategory === 'All'
        ? null
        : catEntry?.rawToken || selectedCategory.toLowerCase();

    const countriesToQuery =
      selectedCountries.length > 0 ? selectedCountries.slice(0, 4) : [null];

    const timer = setTimeout(async () => {
      const results = await Promise.all(
        countriesToQuery.map((cName) =>
          fetchFacilities({
            country: cName,
            category: backendCategoryToken,
            limit: 500,
          })
        )
      );

      if (!cancelled) {
        setFacilityStore((prev) => {
          const next = new Map(prev);
          results.forEach((res) => {
            if (res.ok && res.facilities.length > 0) {
              res.facilities.forEach((f) => next.set(f.id, f));
            }
          });
          return next;
        });
        setFilterLoading(false);
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selectedCountries, selectedCategory, apiState, dynamicCategories]);

  /* Task 3: Debounced Facility Search Autocomplete */
  useEffect(() => {
    const q = facilitySearchText.trim();
    if (!q) {
      setAutocompleteResults([]);
      setAutocompleteLoading(false);
      setHighlightedIndex(-1);
      return;
    }

    let cancelled = false;
    setAutocompleteLoading(true);

    const timer = setTimeout(async () => {
      const matches = await searchFacilitiesAutocomplete(q, allFacilities, 15);
      if (!cancelled) {
        setAutocompleteResults(matches);
        setAutocompleteLoading(false);
        setHighlightedIndex(matches.length > 0 ? 0 : -1);
        if (matches.length > 0) {
          setFacilityStore((prev) => {
            const next = new Map(prev);
            matches.forEach((f) => next.set(f.id, f));
            return next;
          });
        }
      }
    }, 260);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [facilitySearchText, allFacilities]);

  /* Facilities Matching Active Country, Category & Search Filters */
  const filteredFacilities = useMemo(() => {
    const selectedCountrySet = new Set(
      selectedCountries.map((c) => c.toLowerCase())
    );
    const q = facilitySearchText.trim().toLowerCase();
    const coordMatch = q.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
    const qLat = coordMatch ? Number(coordMatch[1]) : null;
    const qLon = coordMatch ? Number(coordMatch[2]) : null;

    return allFacilities.filter((f) => {
      if (
        selectedCountrySet.size > 0 &&
        !selectedCountrySet.has(f.country.toLowerCase())
      ) {
        return false;
      }
      if (
        selectedCategory !== 'All' &&
        f.category.toLowerCase() !== selectedCategory.toLowerCase()
      ) {
        return false;
      }
      if (q) {
        if (Number.isFinite(qLat) && Number.isFinite(qLon)) {
          return (
            Math.abs(f.latitude - qLat) <= 1.5 && Math.abs(f.longitude - qLon) <= 1.5
          );
        }
        const hay = `${f.name} ${f.id} ${f.gem_id || ''} ${f.country} ${f.category} ${
          f.raw_type || ''
        } ${f.latitude.toFixed(4)} ${f.longitude.toFixed(4)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allFacilities, selectedCountries, selectedCategory, facilitySearchText]);

  /* Task 4: Facilities Currently Inside the Active Map Viewport */
  const viewportFacilities = useMemo(() => {
    if (!viewportBounds) return filteredFacilities;
    const { south, north, west, east } = viewportBounds;
    const inBox = filteredFacilities.filter(
      (f) =>
        f.latitude >= south &&
        f.latitude <= north &&
        f.longitude >= west &&
        f.longitude <= east
    );
    // Always keep the selected facility visible even during pan transitions
    if (selectedFacility && !inBox.some((f) => f.id === selectedFacility.id)) {
      return [selectedFacility, ...inBox];
    }
    return inBox;
  }, [filteredFacilities, viewportBounds, selectedFacility]);

  /* Task 3 & 5: Select Facility Action (Zooms Map, Sets 1 km Buffer, Opens Inspector & Queries Env) */
  const handleSelectFacility = useCallback((fac, resetBufferTo1Km = true) => {
    if (!fac) return;
    setSelectedFacility(fac);
    if (resetBufferTo1Km) {
      setBufferKm(1);
    }
    setAutocompleteOpen(false);

    const map = mapRef.current;
    if (map && Number.isFinite(fac.latitude) && Number.isFinite(fac.longitude)) {
      map.flyTo([fac.latitude, fac.longitude], Math.max(map.getZoom(), 13), {
        duration: 0.75,
      });
    }
  }, []);

  /* Query Environmental Data When Selected Facility or Buffer Radius Changes */
  useEffect(() => {
    if (!selectedFacility) {
      setEnvTelemetry({
        state: 'idle',
        indicators: [],
        timeSeries: null,
        source: null,
        period: null,
        quality: null,
        endpoint: null,
        message: '',
      });
      return;
    }

    let cancelled = false;
    setEnvTelemetry((prev) => ({
      ...prev,
      state: 'loading',
      message: `Loading environmental observations within ${bufferKm} km radius…`,
    }));

    fetchFacilityEnvironmentalData({
      facilityId: selectedFacility.id,
      latitude: selectedFacility.latitude,
      longitude: selectedFacility.longitude,
      radiusKm: bufferKm,
      facility: selectedFacility,
    }).then((res) => {
      if (!cancelled) {
        setEnvTelemetry(res);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedFacility, bufferKm]);

  /* Task 1 & 4: Initialize Leaflet Map with Keyless Providers & Viewport Tracking */
  useEffect(() => {
    let mounted = true;

    async function setupMap() {
      if (!mapElRef.current || mapRef.current) return;

      if (!document.getElementById('leaflet-css-stylesheet')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css-stylesheet';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      let L = window.L;
      if (!L) {
        try {
          const mod = await import('leaflet');
          L = mod.default || mod;
        } catch {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            s.onload = resolve;
            s.onerror = reject;
            document.body.appendChild(s);
          });
          L = window.L;
        }
      }

      if (!mounted || !L || !mapElRef.current) return;
      window.L = L;

      const canvasRenderer = L.canvas({ padding: 0.5 });
      canvasRendererRef.current = canvasRenderer;

      const map = L.map(mapElRef.current, {
        center: [22, 18],
        zoom: 2.5,
        minZoom: 2,
        maxZoom: 18,
        zoomControl: false,
        preferCanvas: true,
        renderer: canvasRenderer,
        worldCopyJump: true,
      });

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      const initialLayer = MAP_LAYERS[activeLayer] || MAP_LAYERS.light;
      const tl = L.tileLayer(initialLayer.url, {
        attribution: initialLayer.attribution,
        maxZoom: 19,
      });

      tl.on('tileerror', () => {
        if (tl._url !== initialLayer.fallbackUrl && initialLayer.fallbackUrl) {
          tl.setUrl(initialLayer.fallbackUrl);
          setLayerFallbackNotice(
            `Switched ${initialLayer.label} to keyless OpenStreetMap fallback tiles.`
          );
        }
      });

      tl.addTo(map);
      tileLayerRef.current = tl;

      markersLayerRef.current = L.layerGroup().addTo(map);
      boundaryLayerRef.current = L.layerGroup().addTo(map);

      const updateBoundsState = () => {
        const b = map.getBounds();
        setMapZoom(map.getZoom());
        setViewportBounds({
          south: Math.max(-90, b.getSouth() - 2),
          north: Math.min(90, b.getNorth() + 2),
          west: Math.max(-180, b.getWest() - 2),
          east: Math.min(180, b.getEast() + 2),
        });
      };

      updateBoundsState();
      map.on('moveend', updateBoundsState);
      map.on('zoomend', updateBoundsState);

      mapRef.current = map;
    }

    setupMap();

    return () => {
      mounted = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  /* Fetch More Facilities When User Pans or Zooms Into a Region */
  useEffect(() => {
    if (apiState !== 'online' || !viewportBounds || mapZoom < 5) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await fetchFacilities({
        bbox: {
          minLat: viewportBounds.south,
          maxLat: viewportBounds.north,
          minLon: viewportBounds.west,
          maxLon: viewportBounds.east,
        },
        limit: 500,
      });
      if (!cancelled && res.ok && res.facilities.length > 0) {
        setFacilityStore((prev) => {
          const next = new Map(prev);
          res.facilities.forEach((f) => next.set(f.id, f));
          return next;
        });
      }
    }, 320);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [viewportBounds, mapZoom, apiState]);

  /* Switch Map Base Tile Layer With Automatic Fallback Protection */
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!L || !map) return;

    setLayerFallbackNotice('');
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const cfg = MAP_LAYERS[activeLayer] || MAP_LAYERS.light;
    const tl = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: 19,
    });

    tl.on('tileerror', () => {
      if (tl._url !== cfg.fallbackUrl && cfg.fallbackUrl) {
        tl.setUrl(cfg.fallbackUrl);
        setLayerFallbackNotice(
          `${cfg.label} primary provider unavailable; using keyless OpenStreetMap tiles.`
        );
      }
    });

    tl.addTo(map);
    tileLayerRef.current = tl;
  }, [activeLayer]);

  /* NASA GIBS analytical satellite overlays */
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!L || !map) return;

    if (satelliteOverlayRef.current) {
      map.removeLayer(satelliteOverlayRef.current);
      satelliteOverlayRef.current = null;
    }

    const products = {
      ndvi: {
        layer: 'MODIS_Terra_NDVI_8Day',
        title: 'NASA MODIS Terra NDVI'
      },
      thermal: {
        layer: 'Land Surface Temperature',
        title: 'NASA Land Surface Temperature'
      },
      rainfall: {
        layer: 'IMERG_Precipitation_Rate',
        title: 'NASA GPM IMERG Precipitation Rate'
      }
    };

    if (activeSatelliteOverlay === 'none') return;

    const product = products[activeSatelliteOverlay];
    if (!product) return;

    const overlay = L.tileLayer.wms(
      'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi',
      {
        layers: product.layer,
        format: 'image/png',
        transparent: true,
        version: '1.1.1',
        attribution: 'NASA GIBS / NASA Earthdata',
        opacity: 0.68,
        tiled: true
      }
    );

    overlay.addTo(map);
    satelliteOverlayRef.current = overlay;

    overlay.on('tileerror', () => {
      setLayerFallbackNotice(
        `${product.title} could not load. Check the product availability or layer identifier.`
      );
    });

    return () => {
      if (map.hasLayer(overlay)) map.removeLayer(overlay);
      if (satelliteOverlayRef.current === overlay) {
        satelliteOverlayRef.current = null;
      }
    };
  }, [activeSatelliteOverlay]);

  /* Auto-fit Map Bounds When User Selects Country Filter */
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!L || !map || selectedCountries.length === 0 || selectedFacility) return;
    if (filteredFacilities.length === 0) return;

    const bounds = L.latLngBounds(
      filteredFacilities.map((f) => [f.latitude, f.longitude])
    );
    if (bounds.isValid()) {
      map.flyToBounds(bounds.pad(0.18), { maxZoom: 7, duration: 0.7 });
    }
  }, [selectedCountries, filteredFacilities.length]);

  /* Task 4: Render Facility Markers & Clusters Within the Active Viewport */
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    const group = markersLayerRef.current;
    if (!L || !map || !group) return;

    group.clearLayers();

    const toRender = viewportFacilities;
    if (toRender.length === 0) return;

    const shouldCluster =
      clusteringEnabled && mapZoom <= 5 && toRender.length > 350;

    if (shouldCluster) {
      const cellSizeDeg = mapZoom <= 2.5 ? 7 : mapZoom <= 3.5 ? 4.5 : 2.5;
      const buckets = new Map();

      toRender.forEach((fac) => {
        if (selectedFacility && fac.id === selectedFacility.id) return;
        const gx = Math.floor((fac.longitude + 180) / cellSizeDeg);
        const gy = Math.floor((fac.latitude + 90) / cellSizeDeg);
        const key = `${gx}:${gy}`;
        let b = buckets.get(key);
        if (!b) {
          b = { count: 0, sumLat: 0, sumLon: 0, items: [], catCounts: {} };
          buckets.set(key, b);
        }
        b.count += 1;
        b.sumLat += fac.latitude;
        b.sumLon += fac.longitude;
        b.items.push(fac);
        b.catCounts[fac.category] = (b.catCounts[fac.category] || 0) + 1;
      });

      buckets.forEach((b) => {
        if (b.count === 1) {
          const fac = b.items[0];
          const color = getCategoryColor(fac.category);
          const m = L.circleMarker([fac.latitude, fac.longitude], {
            renderer: canvasRendererRef.current,
            radius: 5.5,
            fillColor: color,
            color: '#ffffff',
            weight: 1.3,
            opacity: 1,
            fillOpacity: 0.9,
          });
          m.bindTooltip(
            `<div class="tt-map-tooltip">
              <strong>${fac.name}</strong>
              <span>${fac.country} · ${fac.category}${
              fac.capacity_mw !== null ? ` · ${fac.capacity_mw.toLocaleString()} MW` : ''
            }</span>
            </div>`,
            { direction: 'top', offset: [0, -5] }
          );
          m.on('click', () => handleSelectFacility(fac, false));
          m.addTo(group);
        } else {
          const cLat = b.sumLat / b.count;
          const cLon = b.sumLon / b.count;
          const dominantCat = Object.entries(b.catCounts).sort(
            (a, c) => c[1] - a[1]
          )[0]?.[0];
          const color = getCategoryColor(dominantCat);
          const radius = Math.min(20, 8 + Math.log2(b.count) * 2.2);

          const clusterMarker = L.circleMarker([cLat, cLon], {
            renderer: canvasRendererRef.current,
            radius,
            fillColor: color,
            color: '#ffffff',
            weight: 2,
            opacity: 0.95,
            fillOpacity: 0.84,
          });

          clusterMarker.bindTooltip(
            `<div class="tt-map-tooltip">
              <strong>${b.count.toLocaleString()} Facilities in Cluster</strong>
              <span>Primary: ${dominantCat} · Click to zoom in</span>
            </div>`,
            { direction: 'top', offset: [0, -6] }
          );

          clusterMarker.on('click', () => {
            const clusterBounds = L.latLngBounds(
              b.items.map((item) => [item.latitude, item.longitude])
            );
            map.flyToBounds(clusterBounds.pad(0.25), {
              maxZoom: Math.min(map.getZoom() + 3, 11),
              duration: 0.65,
            });
          });

          clusterMarker.addTo(group);
        }
      });
    } else {
      toRender.slice(0, 2500).forEach((fac) => {
        if (selectedFacility?.id === fac.id) return;
        const color = getCategoryColor(fac.category);

        const marker = L.circleMarker([fac.latitude, fac.longitude], {
          renderer: canvasRendererRef.current,
          radius: mapZoom >= 8 ? 6.5 : 5.5,
          fillColor: color,
          color: '#ffffff',
          weight: 1.3,
          opacity: 1,
          fillOpacity: 0.9,
        });

        marker.bindTooltip(
          `<div class="tt-map-tooltip">
            <strong>${fac.name}</strong>
            <span>${fac.country} · ${fac.category}${
            fac.capacity_mw !== null ? ` · ${fac.capacity_mw.toLocaleString()} MW` : ''
          }</span>
            <small>${fac.latitude.toFixed(4)}°, ${fac.longitude.toFixed(4)}°</small>
          </div>`,
          { direction: 'top', offset: [0, -5] }
        );

        marker.on('click', () => handleSelectFacility(fac, false));
        marker.addTo(group);
      });
    }

    // Visually distinct selected marker (outer halo ring + high-contrast bullseye core)
    if (selectedFacility) {
      const selColor = getCategoryColor(selectedFacility.category);

      const outerHalo = L.circleMarker(
        [selectedFacility.latitude, selectedFacility.longitude],
        {
          radius: 14,
          fillColor: selColor,
          color: '#0f766e',
          weight: 2,
          opacity: 0.85,
          fillOpacity: 0.22,
        }
      );
      outerHalo.addTo(group);

      const selMarker = L.circleMarker(
        [selectedFacility.latitude, selectedFacility.longitude],
        {
          radius: 8.5,
          fillColor: selColor,
          color: '#0f172a',
          weight: 2.5,
          opacity: 1,
          fillOpacity: 1,
        }
      );

      selMarker.bindTooltip(
        `<div class="tt-map-tooltip">
          <strong>${selectedFacility.name}</strong>
          <span>${selectedFacility.country} · ${selectedFacility.category}${
          selectedFacility.capacity_mw !== null
            ? ` · ${selectedFacility.capacity_mw.toLocaleString()} MW`
            : ''
        }</span>
          <small>Selected · Analytical Buffer: ${bufferKm} km</small>
        </div>`,
        { direction: 'top', offset: [0, -10], permanent: false }
      );

      selMarker.addTo(group);
    }
  }, [
    viewportFacilities,
    selectedFacility,
    mapZoom,
    clusteringEnabled,
    bufferKm,
    handleSelectFacility,
  ]);

  /* Task 5: Draw & Update Analytical Observation Buffer Circle (1, 5, 10, 25 km) */
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    const boundaryGroup = boundaryLayerRef.current;
    if (!L || !map || !boundaryGroup) return;

    boundaryGroup.clearLayers();
    if (!selectedFacility) return;

    const bufferCircle = L.circle(
      [selectedFacility.latitude, selectedFacility.longitude],
      {
        radius: bufferKm * 1000,
        color: '#0f766e',
        weight: 2.2,
        dashArray: '6 4',
        fillColor: '#0f766e',
        fillOpacity: 0.13,
      }
    );

    bufferCircle.bindTooltip(
      `Analytical Observation Buffer: ${bufferKm} km radius (Not physical property boundary)`,
      { sticky: true }
    );
    bufferCircle.addTo(boundaryGroup);

    if (selectedFacility.boundaryGeometry) {
      try {
        L.geoJSON(selectedFacility.boundaryGeometry, {
          style: {
            color: '#1d4ed8',
            weight: 2,
            fillColor: '#3b82f6',
            fillOpacity: 0.18,
          },
        })
          .bindTooltip('Mapped Facility Footprint Geometry')
          .addTo(boundaryGroup);
      } catch {
        // Ignore malformed geometry
      }
    }

    const circleBounds = bufferCircle.getBounds();
    if (circleBounds.isValid()) {
      map.flyToBounds(circleBounds.pad(0.35), {
        maxZoom: bufferKm <= 1 ? 14 : bufferKm <= 5 ? 12 : bufferKm <= 10 ? 11 : 9,
        duration: 0.65,
      });
    }
  }, [selectedFacility, bufferKm]);

  /* Load Additional Batch on Demand */
  const handleLoadMoreFacilities = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    const more = await fetchAdditionalInventorySample({
      currentOffset: nextSampleOffset,
      step: 1500,
      batches: 3,
    });
    if (more.length > 0) {
      setFacilityStore((prev) => {
        const next = new Map(prev);
        more.forEach((f) => next.set(f.id, f));
        return next;
      });
      setNextSampleOffset((prev) => prev + 4500);
    }
    setLoadingMore(false);
  };

  /* Country Selection Handlers (Single & Multi-Select Support) */
  const handleSelectCountryOption = (countryName) => {
    if (countryName === 'All') {
      setSelectedCountries([]);
      setSelectedFacility(null);
      if (!multiCountryMode) setCountryDropdownOpen(false);
      return;
    }

    if (multiCountryMode) {
      setSelectedCountries((prev) =>
        prev.includes(countryName)
          ? prev.filter((c) => c !== countryName)
          : [...prev, countryName]
      );
      setSelectedFacility(null);
    } else {
      setSelectedCountries([countryName]);
      setSelectedFacility(null);
      setCountryDropdownOpen(false);
    }
  };

  const handleCopyCoords = () => {
    if (!selectedFacility) return;
    const text = `${selectedFacility.latitude.toFixed(5)}, ${selectedFacility.longitude.toFixed(5)}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    }
    setCopiedCoords(true);
    setTimeout(() => setCopiedCoords(false), 2000);
  };

  const handleResetFilters = () => {
    setSelectedCountries([]);
    setCountrySearchText('');
    setSelectedCategory('All');
    setFacilitySearchText('');
    setAutocompleteResults([]);
    setAutocompleteOpen(false);
    setSelectedFacility(null);
    setBufferKm(1);
    if (mapRef.current) {
      mapRef.current.setView([22, 18], 2.5);
    }
  };

  /* Keyboard Navigation for Facility Search Autocomplete */
  const handleSearchKeyDown = (e) => {
    if (!autocompleteOpen || autocompleteResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < autocompleteResults.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : autocompleteResults.length - 1
      );
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      const chosen = autocompleteResults[highlightedIndex];
      if (chosen) {
        setFacilitySearchText(chosen.name);
        handleSelectFacility(chosen, true);
      }
    } else if (e.key === 'Escape') {
      setAutocompleteOpen(false);
    }
  };

  const displayedTotalSites =
    totalSitesCount > 0 ? totalSitesCount : allFacilities.length;
  const displayedTotalCountries =
    totalCountriesCount > 0 ? totalCountriesCount : dynamicCountries.length;

  const countryTriggerLabel =
    selectedCountries.length === 0
      ? `All Countries (${displayedTotalCountries.toLocaleString()})`
      : selectedCountries.length === 1
      ? selectedCountries[0]
      : `${selectedCountries.length} Countries Selected`;

  const activeLayerConfig = MAP_LAYERS[activeLayer] || MAP_LAYERS.light;

  return (
    <div className="app-container">
      {/* HEADER BAR */}
      <header className="top-bar">
        <div className="brand-lockup">
          <a
            href="/"
            className="brand-lockup"
            onClick={(e) => {
              if (onNavigateHome) {
                e.preventDefault();
                onNavigateHome();
              }
            }}
          >
            <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
              <circle cx="14" cy="14" r="10" stroke="#0f766e" strokeWidth="1.75" />
              <path
                d="M4.5 14h19M14 4.5c2.7 2.6 4.2 5.9 4.2 9.5s-1.5 6.9-4.2 9.5c-2.7-2.6-4.2-5.9-4.2-9.5S11.3 7.1 14 4.5z"
                stroke="#0f766e"
                strokeWidth="1.4"
              />
              <circle cx="19.5" cy="9.5" r="2.5" fill="#1d4ed8" stroke="#ffffff" strokeWidth="1.2" />
            </svg>
            <div>
              <h1 className="brand-title">TerraTrace</h1>
              <span className="brand-subtitle">
                {apiState === 'loading'
                  ? 'Loading global facility inventory…'
                  : `Total Inventory: ${displayedTotalSites.toLocaleString()} sites • ${displayedTotalCountries.toLocaleString()} countries`}
              </span>
            </div>
          </a>
        </div>

        <div className="header-controls">
          <div
            className="stat-pill"
            title="Facilities currently visible inside the active map viewport versus total records cached in the browser"
          >
            <span>In Viewport:</span>
            <strong>{viewportFacilities.length.toLocaleString()}</strong>
            <span>of {allFacilities.length.toLocaleString()} loaded</span>
          </div>

          <button
            type="button"
            className="stat-pill tt-load-more-pill"
            disabled={loadingMore || apiState !== 'online'}
            onClick={handleLoadMoreFacilities}
            title="Fetch additional facility batches from the backend inventory"
          >
            {loadingMore ? 'Loading batch…' : '+ Load More Sites'}
          </button>

          <div
            className={`api-status ${
              apiState === 'online'
                ? 'online'
                : apiState === 'loading'
                ? 'connecting'
                : 'offline'
            }`}
            title={
              endpointsUsed.length > 0
                ? `Active endpoints: ${endpointsUsed.join(', ')}`
                : API_BASE
            }
          >
            <span className="status-dot" />
            <span>
              {apiState === 'online'
                ? 'API Online'
                : apiState === 'loading'
                ? 'Connecting…'
                : 'Backend Offline'}
            </span>
          </div>

          <a
            href="/"
            className="db-back-btn"
            onClick={(e) => {
              if (onNavigateHome) {
                e.preventDefault();
                onNavigateHome();
              }
            }}
          >
            ← Landing Page
          </a>
          <button
            type="button"
            className="db-back-btn"
            aria-label="Open environmental analysis"
            onClick={() => setShowAnalysis(v => !v)}
          >
            {showAnalysis ? '← Map Dashboard' : 'Analysis ↗'}
          </button>
        </div>
      </header>

      {/* ERROR BANNER IF BACKEND IS UNREACHABLE */}
      {(apiState === 'offline' || apiState === 'error') && (
        <div className="db-api-banner" role="alert">
          <div className="db-api-banner__text">
            <strong>FastAPI Backend Connection Issue:</strong> {apiError}. Ensure the Developer 1 FastAPI server is running at <code>http://127.0.0.1:8000</code>.
          </div>
          <button
            type="button"
            className="db-api-banner__retry"
            onClick={() => loadDashboardData(true)}
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* MAIN WORKSPACE */}
      {!showAnalysis ? (
      <div className="body-layout">
        {/* LEFT SIDEBAR: AUTOCOMPLETE SEARCH, SEARCHABLE COUNTRY DROPDOWN & CATEGORIES */}
        <aside className="sidebar">
          <div className="sidebar-section">
            <div className="sidebar-header">
              <h2>Search &amp; Jurisdiction</h2>
              <button type="button" className="db-link-btn" onClick={handleResetFilters}>
                Reset All
              </button>
            </div>

            {/* TASK 3: FACILITY SEARCH AUTOCOMPLETE DROPDOWN */}
            <div className="search-box tt-autocomplete-container" ref={searchDropdownRef}>
              <label className="filter-label" htmlFor="facility-search-input">
                Search Facility (Name, ID, Country, Lat/Lon)
              </label>
              <div className="tt-search-input-wrap">
                <input
                  id="facility-search-input"
                  type="text"
                  className="search-input"
                  placeholder="Type name, ID, country, or 27.53, 71.91…"
                  autoComplete="off"
                  value={facilitySearchText}
                  onFocus={() => {
                    if (facilitySearchText.trim()) setAutocompleteOpen(true);
                  }}
                  onChange={(e) => {
                    setFacilitySearchText(e.target.value);
                    setAutocompleteOpen(true);
                  }}
                  onKeyDown={handleSearchKeyDown}
                />
                {facilitySearchText && (
                  <button
                    type="button"
                    className="tt-input-clear-btn"
                    aria-label="Clear search"
                    onClick={() => {
                      setFacilitySearchText('');
                      setAutocompleteResults([]);
                      setAutocompleteOpen(false);
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {autocompleteOpen && facilitySearchText.trim().length > 0 && (
                <div className="tt-autocomplete-menu" role="listbox">
                  {autocompleteLoading ? (
                    <div className="tt-autocomplete-state">
                      Searching global facility inventory…
                    </div>
                  ) : autocompleteResults.length === 0 ? (
                    <div className="tt-autocomplete-state">
                      No matching facilities found for &ldquo;{facilitySearchText}&rdquo;.
                    </div>
                  ) : (
                    autocompleteResults.map((fac, idx) => (
                      <button
                        key={fac.id}
                        type="button"
                        role="option"
                        aria-selected={idx === highlightedIndex}
                        className={`tt-autocomplete-item ${
                          idx === highlightedIndex ? 'highlighted' : ''
                        }`}
                        onClick={() => {
                          setFacilitySearchText(fac.name);
                          handleSelectFacility(fac, true);
                        }}
                      >
                        <div className="tt-autocomplete-item__top">
                          <strong className="tt-autocomplete-item__name">{fac.name}</strong>
                          <span
                            className="tt-autocomplete-item__badge"
                            style={{
                              backgroundColor: `${getCategoryColor(fac.category)}18`,
                              color: getCategoryColor(fac.category),
                            }}
                          >
                            {fac.category}
                          </span>
                        </div>
                        <div className="tt-autocomplete-item__meta">
                          <span>{fac.country}</span>
                          <span>
                            {fac.capacity_mw !== null
                              ? `${fac.capacity_mw.toLocaleString()} MW`
                              : 'Unlisted MW'}
                          </span>
                        </div>
                        <div className="tt-autocomplete-item__coords">
                          ID: {fac.id} • {fac.latitude.toFixed(3)}°, {fac.longitude.toFixed(3)}°
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* TASK 2: SEARCHABLE COUNTRY AUTOCOMPLETE DROPDOWN */}
            <div className="filter-group tt-country-dropdown-wrap" ref={countryDropdownRef}>
              <div className="tt-filter-label-row">
                <label className="filter-label">
                  Country / Territory ({dynamicCountries.length} loaded)
                </label>
                {selectedCountries.length > 0 && (
                  <button
                    type="button"
                    className="db-link-btn"
                    onClick={() => {
                      setSelectedCountries([]);
                      setSelectedFacility(null);
                    }}
                  >
                    Clear ({selectedCountries.length})
                  </button>
                )}
              </div>

              <button
                type="button"
                className={`tt-dropdown-trigger ${countryDropdownOpen ? 'open' : ''}`}
                aria-expanded={countryDropdownOpen}
                onClick={() => setCountryDropdownOpen((prev) => !prev)}
              >
                <span className="tt-dropdown-trigger__text">{countryTriggerLabel}</span>
                <span className="tt-dropdown-trigger__arrow" aria-hidden="true">
                  {countryDropdownOpen ? '▲' : '▼'}
                </span>
              </button>

              {/* Selected Country Chips when Filtered */}
              {selectedCountries.length > 0 && (
                <div className="tt-selected-chips">
                  {selectedCountries.map((cName) => (
                    <span key={cName} className="tt-chip">
                      {cName}
                      <button
                        type="button"
                        aria-label={`Remove ${cName}`}
                        onClick={() =>
                          setSelectedCountries((prev) => prev.filter((c) => c !== cName))
                        }
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {countryDropdownOpen && (
                <div className="tt-country-popover">
                  <div className="tt-country-popover__controls">
                    <input
                      type="text"
                      className="search-input tt-country-search-input"
                      placeholder="Search countries..."
                      autoFocus
                      value={countrySearchText}
                      onChange={(e) => setCountrySearchText(e.target.value)}
                    />
                    <div className="tt-country-popover__toolbar">
                      <label className="tt-multiselect-toggle">
                        <input
                          type="checkbox"
                          checked={multiCountryMode}
                          onChange={(e) => setMultiCountryMode(e.target.checked)}
                        />
                        <span>Multi-select</span>
                      </label>
                      <button
                        type="button"
                        className="db-link-btn"
                        onClick={() => {
                          setSelectedCountries([]);
                          setCountrySearchText('');
                        }}
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  <div className="tt-country-options-list" role="listbox">
                    {apiState === 'loading' ? (
                      <div className="tt-autocomplete-state">
                        Loading countries from backend…
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={`tt-country-option ${
                            selectedCountries.length === 0 ? 'selected' : ''
                          }`}
                          onClick={() => handleSelectCountryOption('All')}
                        >
                          <span className="tt-country-option__name">All Countries</span>
                          <span className="tt-country-option__count">
                            ({displayedTotalSites.toLocaleString()})
                          </span>
                        </button>

                        {filteredCountryOptions.length === 0 ? (
                          <div className="tt-autocomplete-state">
                            No countries match &ldquo;{countrySearchText}&rdquo;.
                          </div>
                        ) : (
                          filteredCountryOptions.map((c) => {
                            const isChecked = selectedCountries.includes(c.name);
                            return (
                              <button
                                key={c.name}
                                type="button"
                                className={`tt-country-option ${isChecked ? 'selected' : ''}`}
                                onClick={() => handleSelectCountryOption(c.name)}
                              >
                                <span className="tt-country-option__left">
                                  {multiCountryMode && (
                                    <input
                                      type="checkbox"
                                      readOnly
                                      checked={isChecked}
                                      className="tt-country-checkbox"
                                    />
                                  )}
                                  <span className="tt-country-option__name">{c.name}</span>
                                </span>
                                <span className="tt-country-option__count">
                                  ({(c.count || c.loadedCount || 0).toLocaleString()})
                                </span>
                              </button>
                            );
                          })
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* DYNAMIC FACILITY CATEGORIES */}
          <div className="sidebar-section">
            <div className="sidebar-header">
              <h2>Facility Categories</h2>
              <span className="db-sidebar__sub">
                {filterLoading ? 'Syncing…' : `${dynamicCategories.length} types`}
              </span>
            </div>

            <div className="category-list">
              <button
                type="button"
                className={`category-item ${selectedCategory === 'All' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedCategory('All');
                  setSelectedFacility(null);
                }}
              >
                <span className="legend-dot" style={{ backgroundColor: '#0f766e' }} />
                <span className="db-category-item__name">All Categories</span>
                <span className="db-category-item__count">
                  {displayedTotalSites.toLocaleString()}
                </span>
              </button>

              {dynamicCategories.map((cat) => (
                <button
                  key={cat.name}
                  type="button"
                  className={`category-item ${
                    selectedCategory === cat.name ? 'active' : ''
                  }`}
                  onClick={() => {
                    setSelectedCategory(cat.name);
                    setSelectedFacility(null);
                  }}
                >
                  <span
                    className="legend-dot"
                    style={{ backgroundColor: getCategoryColor(cat.name) }}
                  />
                  <span className="db-category-item__name">{cat.name}</span>
                  <span className="db-category-item__count">
                    {(cat.count || cat.loadedCount || 0).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* MATCHING FACILITY DIRECTORY LIST */}
          <div className="sidebar-section db-sidebar__list-section">
            <div className="sidebar-header">
              <h2>Facilities in Viewport</h2>
              <span className="db-sidebar__sub">
                {viewportFacilities.length.toLocaleString()} shown
              </span>
            </div>

            {apiState === 'loading' ? (
              <div className="empty-state">
                <strong>Loading facility dataset from FastAPI…</strong>
                <span>Retrieving coordinates and country aggregations.</span>
              </div>
            ) : viewportFacilities.length === 0 ? (
              <div className="empty-state">
                <strong>No loaded facilities in current view</strong>
                <span>
                  {filterLoading
                    ? 'Querying backend for matching records…'
                    : 'Zoom out, pan the map, or reset active filters.'}
                </span>
                <button type="button" className="action-btn" onClick={handleResetFilters}>
                  Reset Filters
                </button>
              </div>
            ) : (
              <div className="facility-list">
                {viewportFacilities.slice(0, 100).map((fac) => (
                  <button
                    key={fac.id}
                    type="button"
                    className={`facility-item ${
                      selectedFacility?.id === fac.id ? 'selected' : ''
                    }`}
                    onClick={() => handleSelectFacility(fac, false)}
                  >
                    <div className="db-facility-row__top">
                      <span className="db-facility-row__name">{fac.name}</span>
                      <span
                        className="db-facility-row__badge"
                        style={{
                          backgroundColor: `${getCategoryColor(fac.category)}18`,
                          color: getCategoryColor(fac.category),
                        }}
                      >
                        {fac.category}
                      </span>
                    </div>
                    <div className="db-facility-row__meta">
                      <span>{fac.country}</span>
                      <span>
                        {fac.capacity_mw !== null
                          ? `${fac.capacity_mw.toLocaleString()} MW`
                          : 'Unlisted MW'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* CENTER INTERACTIVE LEAFLET MAP STAGE */}
        <main className={`map-container ${activeLayerConfig.tileFilterClass || ''}`}>
          <div ref={mapElRef} className="db-map-canvas" />

          {/* BASEMAP SWITCHER (.basemap-switcher) */}
          <div className="basemap-switcher" role="toolbar" aria-label="Map layer switcher">
            {Object.values(MAP_LAYERS).map((layer) => (
              <button
                key={layer.id}
                type="button"
                className={activeLayer === layer.id ? 'active' : ''}
                aria-pressed={activeLayer === layer.id}
                onClick={() => setActiveLayer(layer.id)}
              >
                {layer.label}
              </button>
            ))}
            <span className="tt-overlay-divider">NASA DATA</span>
            {[
              ['none', 'No Overlay'],
              ['ndvi', 'Vegetation'],
              ['thermal', 'Thermal'],
              ['rainfall', 'Rainfall']
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={activeSatelliteOverlay === id ? 'active' : ''}
                aria-pressed={activeSatelliteOverlay === id}
                onClick={() => setActiveSatelliteOverlay(id)}
              >
                {label}
              </button>
            ))}

            <button
              type="button"
              className={clusteringEnabled ? 'active' : ''}
              title="Toggle spatial marker clustering at global zoom levels"
              onClick={() => setClusteringEnabled((v) => !v)}
            >
              {clusteringEnabled ? 'Clusters: On' : 'Clusters: Off'}
            </button>
          </div>

          {layerFallbackNotice && (
            <div className="tt-layer-notice" role="status">
              {layerFallbackNotice}
            </div>
          )}

          {/* MAP LEGEND */}
          <div className="map-legend">
            <span className="legend-title">Facility Categories</span>
            <div className="legend-items">
              {Object.entries(CATEGORY_COLORS)
                .filter(([k]) => k !== 'Unspecified')
                .map(([name, color]) => (
                  <span key={name} className="legend-item">
                    <i className="legend-dot" style={{ backgroundColor: color }} />
                    {name}
                  </span>
                ))}
            </div>
          </div>
        </main>

        {/* RIGHT FACILITY INSPECTOR (.facility-inspector) */}
        <aside className="facility-inspector">
          <SiteSuitabilityPanel selectedFacility={selectedFacility} />
          {!selectedFacility ? (
            <div className="inspector-empty">
              <h3>Facility Intelligence Inspector</h3>
              <p>
                Select any facility marker on the map, use the <strong>Facility Search Autocomplete</strong>, or click a site in the directory to inspect its coordinates, capacity, <strong>1 km default analytical observation buffer</strong>, and environmental data feeds.
              </p>
              <div className="bento-grid">
                <div className="bento-card">
                  <span className="bento-label">Total Inventory</span>
                  <strong className="bento-value">
                    {displayedTotalSites.toLocaleString()}
                  </strong>
                  <small>Mapped power facilities</small>
                </div>
                <div className="bento-card">
                  <span className="bento-label">Jurisdictions</span>
                  <strong className="bento-value">
                    {displayedTotalCountries.toLocaleString()}
                  </strong>
                  <small>Countries &amp; territories</small>
                </div>
                <div className="bento-card">
                  <span className="bento-label">In Map Viewport</span>
                  <strong className="bento-value">
                    {viewportFacilities.length.toLocaleString()}
                  </strong>
                  <small>Visible markers in bounds</small>
                </div>
                <div className="bento-card">
                  <span className="bento-label">Cached in Browser</span>
                  <strong className="bento-value">
                    {allFacilities.length.toLocaleString()}
                  </strong>
                  <small>Loaded via API batches</small>
                </div>
                <div className="bento-card full-width">
                  <span className="bento-label">Default Observation Boundary</span>
                  <strong className="bento-value">1 km Analytical Radius</strong>
                  <small>
                    Configurable across 1 km, 5 km, 10 km, and 25 km radial buffers around any selected facility coordinate.
                  </small>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* 1. FACILITY HEADER & OVERVIEW */}
              <header className="inspector-header">
                <div>
                  <div className="db-intel-badges">
                    <span
                      className="fuel-badge"
                      style={{
                        backgroundColor: `${getCategoryColor(selectedFacility.category)}16`,
                        color: getCategoryColor(selectedFacility.category),
                        borderColor: `${getCategoryColor(selectedFacility.category)}45`,
                      }}
                    >
                      {selectedFacility.category}
                    </span>
                    <span className="gem-id">ID: {selectedFacility.id}</span>
                  </div>
                  <h2 className="inspector-title">{selectedFacility.name}</h2>
                  <p className="inspector-subtitle">{selectedFacility.country}</p>
                </div>
                <button
                  type="button"
                  className="close-btn"
                  onClick={() => setSelectedFacility(null)}
                  aria-label="Close facility inspector"
                >
                  ✕
                </button>
              </header>

              {/* QUICK ACTIONS: SATELLITE VIEW & COPY COORDINATES */}
              <div className="inspector-actions">
                <button
                  type="button"
                  className={`action-btn ${activeLayer === 'satellite' ? 'active' : ''}`}
                  onClick={() =>
                    setActiveLayer((prev) => (prev === 'satellite' ? 'light' : 'satellite'))
                  }
                >
                  {activeLayer === 'satellite' ? '✓ Satellite View Active' : '🛰 Satellite View'}
                </button>
                <button type="button" className="action-btn" onClick={handleCopyCoords}>
                  {copiedCoords ? '✓ Copied to Clipboard' : '⎘ Copy Coordinates'}
                </button>
              </div>

              {/* 2. BENTO GRID: METADATA, CAPACITY, STATUS & COORDINATES */}
              <div className="bento-grid">
                <div className="bento-card">
                  <span className="bento-label">Listed Capacity</span>
                  <strong className="bento-value">
                    {selectedFacility.capacity_mw !== null
                      ? `${selectedFacility.capacity_mw.toLocaleString()} MW`
                      : 'Not Reported'}
                  </strong>
                  <small>
                    {selectedFacility.raw_type
                      ? `Type: ${selectedFacility.raw_type}`
                      : `Category: ${selectedFacility.category}`}
                  </small>
                </div>

                <div className="bento-card">
                  <span className="bento-label">Operational Status</span>
                  <strong className="bento-value">
                    {selectedFacility.status || 'Listed in Inventory'}
                  </strong>
                  <small>
                    {selectedFacility.commissioned
                      ? `Commissioned: ${selectedFacility.commissioned}`
                      : 'Commission year unrecorded'}
                  </small>
                </div>

                <div className="bento-card full-width">
                  <span className="bento-label">Geospatial Coordinates (WGS84)</span>
                  <strong className="bento-value">
                    <code>
                      {selectedFacility.latitude.toFixed(5)},{' '}
                      {selectedFacility.longitude.toFixed(5)}
                    </code>
                  </strong>
                  <small>
                    {formatHemisphereCoords(
                      selectedFacility.latitude,
                      selectedFacility.longitude
                    )}
                  </small>
                </div>

                {/* 3. SPATIAL OBSERVATION BUFFER (1 km, 5 km, 10 km, 25 km) */}
                <div className="bento-card full-width">
                  <div className="db-block-row">
                    <span className="bento-label">Analytical Observation Buffer</span>
                    <strong className="db-buffer-readout">{bufferKm} km radius</strong>
                  </div>
                  <div
                    className="buffer-selector"
                    role="group"
                    aria-label="Observation buffer radius"
                  >
                    {BUFFER_OPTIONS_KM.map((km) => (
                      <button
                        key={km}
                        type="button"
                        className={`buffer-btn ${bufferKm === km ? 'active' : ''}`}
                        onClick={() => setBufferKm(km)}
                      >
                        {km} km
                      </button>
                    ))}
                  </div>
                  <small>
                    <strong>Analytical Observation Buffer:</strong> This {bufferKm} km circle defines the radial satellite query zone centred on the facility coordinates—not the physical property boundary.
                  </small>
                </div>

                {/* 4. ENVIRONMENTAL DATA & SATELLITE TELEMETRY */}
                <div className="bento-card full-width">
                  <span className="bento-label">
                    Environmental Observations ({bufferKm} km Buffer)
                  </span>

                  {envTelemetry.state === 'loading' && (
                    <div className="env-box loading">
                      <strong>Loading environmental observations…</strong>
                      <p>{envTelemetry.message}</p>
                    </div>
                  )}

                  {envTelemetry.state === 'available' && (
                    <div className="env-box available">
                      <div className="db-env-box__status">
                        <span>Source: {envTelemetry.source}</span>
                        {envTelemetry.period && <span>Period: {envTelemetry.period}</span>}
                      </div>

                      {envTelemetry.indicators.length > 0 && (
                        <div className="db-telemetry-list">
                          {envTelemetry.indicators.map((ind) => (
                            <div key={ind.key} className="db-telemetry-row">
                              <span>{ind.label}</span>
                              <strong>
                                {typeof ind.value === 'number'
                                  ? ind.value.toLocaleString(undefined, {
                                      maximumFractionDigits: 3,
                                    })
                                  : String(ind.value)}
                                {ind.unit ? ` ${ind.unit}` : ''}
                              </strong>
                            </div>
                          ))}
                        </div>
                      )}

                      {envTelemetry.quality && (
                        <small style={{ display: 'block', marginTop: '6px' }}>
                          Quality / Confidence: {String(envTelemetry.quality)}
                        </small>
                      )}
                    </div>
                  )}

                  {envTelemetry.state === 'unavailable' && (
                    <div className="env-box">
                      <strong>No Environmental Measurements Available for Selection</strong>
                      <p>{envTelemetry.message}</p>
                      <small>
                        TerraTrace displays only genuine measurements returned by the backend and never fabricates satellite telemetry.
                      </small>
                    </div>
                  )}

                  {envTelemetry.state === 'connection_error' && (
                    <div className="env-box error">
                      <strong>Environmental Feed Connection Error</strong>
                      <p>{envTelemetry.message}</p>
                    </div>
                  )}
                </div>
              </div>

              <small className="db-intel-disclaimer">
                Note: Satellite and precipitation observations support environmental monitoring and preliminary screening; they do not establish industrial causation.
              </small>
            </>
          )}
        </aside>
      </div>
      ) : (
        <AnalysisPanel selectedFacility={selectedFacility} envTelemetry={envTelemetry} bufferKm={bufferKm} />
      )}

      {/* FULL-SCREEN BACKEND INITIALIZATION EXPERIENCE */}
      {apiState === 'loading' && (
        <div className="tt-startup-overlay" role="status" aria-live="polite">
          <div className="tt-startup-grid" aria-hidden="true" />

          <section className="tt-startup-panel">
            <div className="tt-startup-brand">
              <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
                <circle cx="14" cy="14" r="10" stroke="#5eead4" strokeWidth="1.75" />
                <path
                  d="M4.5 14h19M14 4.5c2.7 2.6 4.2 5.9 4.2 9.5s-1.5 6.9-4.2 9.5c-2.7-2.6-4.2-5.9-4.2-9.5S11.3 7.1 14 4.5z"
                  stroke="#5eead4"
                  strokeWidth="1.4"
                />
                <circle cx="19.5" cy="9.5" r="2.5" fill="#2dd4bf" />
              </svg>
              <span>TERRATRACE</span>
              <span className="tt-startup-tag">GLOBAL GIS</span>
            </div>

            <div className="tt-startup-heading">
              <span className="tt-startup-eyebrow">GLOBAL ENVIRONMENTAL DATA</span>
              <h2>Getting TerraTrace ready</h2>
              <p>
                We're connecting to our servers and loading global facility data. This may take a few moments.
              </p>
              <p className="tt-startup-reload">
                If the website doesn't load, please reload the page.
              </p>
            </div>

            <div className="tt-startup-progress">
              <div className="tt-startup-progress-track">
                <span />
              </div>
              <div className="tt-startup-progress-caption">
                <span>LOADING YOUR DASHBOARD...</span>
                <span className="tt-startup-pulse">LIVE</span>
              </div>
            </div>

            <div className="tt-startup-steps">
              <div className="tt-startup-step active">
                <span className="tt-startup-step-icon"><i /></span>
                <div>
                  <strong>Connecting to TerraTrace</strong>
                  <small>Establishing a connection to our servers</small>
                </div>
              </div>
              <div className="tt-startup-step active">
                <span className="tt-startup-step-icon"><i /></span>
                <div>
                  <strong>Loading facility data</strong>
                  <small>Getting global facility information</small>
                </div>
              </div>
              <div className="tt-startup-step">
                <span className="tt-startup-step-icon"><i /></span>
                <div>
                  <strong>Preparing your dashboard</strong>
                  <small>Getting the map ready</small>
                </div>
              </div>
            </div>

            <div className="tt-startup-footer">
              <span>GLOBAL FACILITY DATA</span>
              <span>TERRATRACE</span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}