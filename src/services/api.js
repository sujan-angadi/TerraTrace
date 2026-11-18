/**
 * TerraTrace API Service (src/services/api.js)
 * Connects to the Developer 1 FastAPI backend (http://127.0.0.1:8000)
 * - Runtime OpenAPI (/openapi.json) route & parameter constraint discovery
 * - Deep payload extraction & case-insensitive coordinate normalization
 * - Debounced server-side facility search & viewport bounding-box queries
 * - Dynamic 226-country & 8-category aggregation
 * - Request deduplication, TTL caching & proxy failover
 */

const ENV_BASE = import.meta.env.VITE_API_BASE_URL;
export const CANDIDATE_BASES = [
  ...(ENV_BASE ? [ENV_BASE.replace(/\/+$/, '')] : []),
  'http://127.0.0.1:8000',
  'http://localhost:8000',
  '/api-proxy',
];

export let API_BASE = CANDIDATE_BASES[0];

const responseCache = new Map();
const inflightRequests = new Map();
const DEFAULT_CACHE_TTL_MS = 60 * 1000;

let cachedCapabilities = null;
let capabilitiesPromise = null;

export function clearApiCache() {
  responseCache.clear();
  inflightRequests.clear();
  cachedCapabilities = null;
  capabilitiesPromise = null;
}

/**
 * Normalizes raw fuel/facility type strings into canonical TerraTrace categories
 * while preserving the raw backend token for filter queries.
 */
export function normalizeFuelCategory(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return 'Unspecified';
  }
  const s = String(rawValue).trim();
  const lower = s.toLowerCase();

  if (lower.includes('solar') || lower === 'pv') return 'Solar';
  if (lower.includes('wind')) return 'Wind';
  if (lower.includes('hydro') || lower.includes('pumped') || lower.includes('wave') || lower.includes('tidal')) {
    return 'Hydropower';
  }
  if (
    lower.includes('oil') ||
    lower.includes('gas') ||
    lower.includes('petrol') ||
    lower.includes('diesel') ||
    lower.includes('lng') ||
    lower.includes('turbine') ||
    lower.includes('combined cycle') ||
    lower.includes('fossil')
  ) {
    return 'Oil/Gas';
  }
  if (lower.includes('coal') || lower.includes('lignite') || lower.includes('peat') || lower.includes('anthracite')) {
    return 'Coal';
  }
  if (
    lower.includes('bio') ||
    lower.includes('waste') ||
    lower.includes('bagasse') ||
    lower.includes('biomass') ||
    lower.includes('biogas')
  ) {
    return 'Bioenergy';
  }
  if (lower.includes('nuclear')) return 'Nuclear';
  if (lower.includes('geo')) return 'Geothermal';

  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatCategoryLabel(category) {
  return normalizeFuelCategory(category);
}

/**
 * Case-insensitive property lookup helper for heterogeneous backend schemas.
 */
function pickField(obj, candidateKeys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of candidateKeys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      return obj[key];
    }
  }
  const lowerMap = {};
  for (const k of Object.keys(obj)) {
    lowerMap[k.toLowerCase()] = obj[k];
  }
  for (const key of candidateKeys) {
    const val = lowerMap[key.toLowerCase()];
    if (val !== undefined && val !== null && val !== '') {
      return val;
    }
  }
  return undefined;
}

/**
 * Extracts valid WGS84 [latitude, longitude] from flat fields, nested objects,
 * GeoJSON Point/Polygon geometries, or WKT strings.
 */
function extractCoordinates(props, rawItem) {
  let rawLat = pickField(props, [
    'latitude',
    'lat',
    'y',
    'lat_deg',
    'latitude_deg',
    'centroid_lat',
    'facility_lat',
    'plant_lat',
  ]);

  let rawLon = pickField(props, [
    'longitude',
    'lon',
    'lng',
    'long',
    'x',
    'lon_deg',
    'lng_deg',
    'longitude_deg',
    'centroid_lon',
    'facility_lon',
    'plant_lon',
  ]);

  // Check nested coordinate containers
  if (rawLat === undefined || rawLon === undefined) {
    const nested =
      props.location ||
      props.coordinates ||
      props.coord ||
      props.coords ||
      props.point ||
      props.position ||
      props.centroid ||
      props.geo;

    if (Array.isArray(nested) && nested.length >= 2) {
      // GeoJSON convention is [lon, lat]; verify if first element > 90
      const a = Number(nested[0]);
      const b = Number(nested[1]);
      if (Math.abs(a) > 90 && Math.abs(b) <= 90) {
        rawLon = a;
        rawLat = b;
      } else {
        rawLat = b;
        rawLon = a;
      }
    } else if (nested && typeof nested === 'object') {
      rawLat = rawLat ?? pickField(nested, ['latitude', 'lat', 'y']);
      rawLon = rawLon ?? pickField(nested, ['longitude', 'lon', 'lng', 'long', 'x']);
    }
  }

  // Check GeoJSON geometry (Point, Polygon, or MultiPolygon)
  const geom = props.geometry || rawItem?.geometry;
  if ((rawLat === undefined || rawLon === undefined) && geom && typeof geom === 'object') {
    if (geom.type === 'Point' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
      rawLon = geom.coordinates[0];
      rawLat = geom.coordinates[1];
    } else if (
      (geom.type === 'Polygon' || geom.type === 'MultiPolygon') &&
      Array.isArray(geom.coordinates)
    ) {
      const ring =
        geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0]?.[0];
      if (Array.isArray(ring) && ring.length > 0) {
        let sumLon = 0;
        let sumLat = 0;
        let count = 0;
        ring.forEach((pt) => {
          if (Array.isArray(pt) && pt.length >= 2) {
            sumLon += Number(pt[0]);
            sumLat += Number(pt[1]);
            count += 1;
          }
        });
        if (count > 0) {
          rawLon = sumLon / count;
          rawLat = sumLat / count;
        }
      }
    }
  }

  // Check WKT string e.g. "POINT (71.9167 27.5398)"
  if (rawLat === undefined || rawLon === undefined) {
    const wkt = pickField(props, ['wkt', 'geom', 'geometry_wkt', 'the_geom']);
    if (typeof wkt === 'string') {
      const m = wkt.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
      if (m) {
        rawLon = Number(m[1]);
        rawLat = Number(m[2]);
      }
    }
  }

  let latitude = rawLat !== undefined && rawLat !== null && rawLat !== '' ? Number(rawLat) : NaN;
  let longitude = rawLon !== undefined && rawLon !== null && rawLon !== '' ? Number(rawLon) : NaN;

  // If lat and lon were reversed in source record, swap them if unambiguous
  if (Math.abs(latitude) > 90 && Math.abs(longitude) <= 90 && Math.abs(latitude) <= 180) {
    const tmp = latitude;
    latitude = longitude;
    longitude = tmp;
  }

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

/**
 * Normalizes a single facility record from any backend schema.
 * Missing numeric values (such as capacity_mw) remain `null`, never `0`.
 */
export function normalizeFacilityRecord(item, index = 0) {
  if (!item) return null;

  // Support tuple/array rows if backend returns [id, name, country, type, cap, lat, lon]
  if (Array.isArray(item)) {
    if (item.length < 2) return null;
    const objFromTuple = {
      id: item[0],
      name: item[1],
      country: item[2],
      type: item[3],
      capacity_mw: item[4],
      latitude: item[5],
      longitude: item[6],
    };
    return normalizeFacilityRecord(objFromTuple, index);
  }

  if (typeof item !== 'object') return null;

  const props =
    item.type === 'Feature' && item.properties && typeof item.properties === 'object'
      ? { ...item.properties, geometry: item.geometry, id: item.id ?? item.properties.id }
      : item;

  const coords = extractCoordinates(props, item);
  if (!coords) return null;
  const { latitude, longitude } = coords;

  const rawCap = pickField(props, [
    'capacity_mw',
    'capacity',
    'installed_capacity_mw',
    'nameplate_capacity_mw',
    'mw',
    'power_mw',
  ]);
  const parsedCap =
    rawCap !== undefined && rawCap !== null && String(rawCap).trim() !== ''
      ? Number(String(rawCap).replace(/,/g, ''))
      : null;
  const capacity_mw = Number.isFinite(parsedCap) ? parsedCap : null;

  const rawCategory = pickField(props, [
    'facility_type',
    'type',
    'primary_fuel',
    'fuel_type',
    'category',
    'energy_source',
    'technology',
    'sector',
    'fuel',
  ]);
  const category = normalizeFuelCategory(rawCategory);

  const rawId = pickField(props, [
    'facility_id',
    'gem_id',
    'gem_location_id',
    'gppd_idnr',
    'plant_id',
    'unit_id',
    'site_id',
    'id',
    'uid',
  ]);
  const id =
    rawId !== undefined && rawId !== null && String(rawId).trim() !== ''
      ? String(rawId).trim()
      : `FAC-${latitude.toFixed(4)}_${longitude.toFixed(4)}_${index}`;

  const rawCountry = pickField(props, [
    'country_long',
    'country_name',
    'country',
    'nation',
    'area',
    ' territory',
  ]);
  const country =
    rawCountry !== undefined && rawCountry !== null && String(rawCountry).trim() !== ''
      ? String(rawCountry).trim()
      : 'Unspecified';

  const rawName = pickField(props, [
    'name',
    'facility_name',
    'plant_name',
    'project_name',
    'site_name',
    'unit_name',
    'station_name',
    'title',
  ]);
  const name =
    rawName !== undefined && rawName !== null && String(rawName).trim() !== ''
      ? String(rawName).trim()
      : `${country} ${category} Facility (${id})`;

  const rawStatus = pickField(props, [
    'status',
    'operating_status',
    'unit_status',
    'status_description',
    'state',
  ]);
  const status =
    rawStatus !== undefined && rawStatus !== null && String(rawStatus).trim() !== ''
      ? String(rawStatus).trim()
      : null;

  const rawYear = pickField(props, [
    'commissioning_year',
    'start_year',
    'commissioned',
    'year',
    'year_built',
  ]);
  const commissioned =
    rawYear !== undefined && rawYear !== null && String(rawYear).trim() !== ''
      ? rawYear
      : null;

  const geom = props.geometry || item.geometry;
  const boundaryGeometry =
    geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')
      ? geom
      : props.boundary_geojson || props.polygon || null;

  return {
    id,
    gem_id: rawId ? String(rawId) : null,
    name,
    country,
    country_code: pickField(props, ['country_code', 'iso3', 'iso_code']) || null,
    type: category,
    category,
    raw_type: rawCategory ? String(rawCategory) : null,
    capacity_mw,
    status,
    commissioned,
    owner: pickField(props, ['owner', 'operator', 'company']) || null,
    source: pickField(props, ['source', 'dataset', 'data_source']) || null,
    latitude,
    longitude,
    boundaryGeometry,
    raw: props,
  };
}

/**
 * Low-level HTTP GET with deduplication, TTL cache, and base URL failover.
 */
async function requestJson(pathAndQuery, { ttlMs = DEFAULT_CACHE_TTL_MS, timeoutMs = 8500 } = {}) {
  const cleanPath = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;

  if (ttlMs > 0 && responseCache.has(cleanPath)) {
    const cached = responseCache.get(cleanPath);
    if (Date.now() - cached.timestamp < ttlMs) {
      return cached.result;
    }
    responseCache.delete(cleanPath);
  }

  if (inflightRequests.has(cleanPath)) {
    return inflightRequests.get(cleanPath);
  }

  const promise = (async () => {
    const basesToTry = import.meta.env.PROD
      ? [API_BASE]
      : [API_BASE, ...CANDIDATE_BASES.filter((b) => b !== API_BASE)];

    let lastError = null;

    for (const base of basesToTry) {
      const url = `${base}${cleanPath}`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timer);

        API_BASE = base;

        let body = null;
        if (res.status !== 204) {
          try {
            body = await res.json();
          } catch {
            body = null;
          }
        }

        const result = {
          ok: res.ok,
          status: res.status,
          url,
          base,
          data: body,
        };

        if (res.ok && ttlMs > 0) {
          responseCache.set(cleanPath, { timestamp: Date.now(), result });
        }
        return result;
      } catch (err) {
        lastError = err;
      }
    }

    return {
      ok: false,
      status: 0,
      url: `${API_BASE}${cleanPath}`,
      base: API_BASE,
      data: null,
      error:
        lastError?.name === 'AbortError'
          ? `Request timed out (${API_BASE}${cleanPath})`
          : `Unable to connect to backend at ${API_BASE}`,
    };
  })();

  inflightRequests.set(cleanPath, promise);
  try {
    return await promise;
  } finally {
    inflightRequests.delete(cleanPath);
  }
}

/**
 * Parses an OpenAPI parameter definition (including Pydantic v2 anyOf / oneOf schemas).
 */
function parseOpenApiParam(param) {
  const s = param?.schema || {};
  const branches = Array.isArray(s.anyOf)
    ? s.anyOf
    : Array.isArray(s.oneOf)
    ? s.oneOf
    : [s];

  let maximum = null;
  let minimum = null;
  let defaultValue = s.default ?? param?.default;

  if (s.maximum !== undefined) maximum = Number(s.maximum);
  else if (s.exclusiveMaximum !== undefined) maximum = Number(s.exclusiveMaximum) - 1;

  if (s.minimum !== undefined) minimum = Number(s.minimum);

  for (const b of branches) {
    if (maximum === null && b.maximum !== undefined) maximum = Number(b.maximum);
    else if (maximum === null && b.exclusiveMaximum !== undefined) {
      maximum = Number(b.exclusiveMaximum) - 1;
    }
    if (minimum === null && b.minimum !== undefined) minimum = Number(b.minimum);
    if (defaultValue === undefined && b.default !== undefined) defaultValue = b.default;
  }

  return {
    name: param.name,
    in: param.in || 'query',
    required: Boolean(param.required),
    maximum: Number.isFinite(maximum) ? maximum : null,
    minimum: Number.isFinite(minimum) ? minimum : null,
    default: defaultValue,
  };
}

/**
 * Discovers all actual routes and query constraints from /openapi.json.
 */
export async function discoverApiCapabilities(forceRefresh = false) {
  if (!forceRefresh && cachedCapabilities) return cachedCapabilities;
  if (!forceRefresh && capabilitiesPromise) return capabilitiesPromise;

  capabilitiesPromise = (async () => {
    const cap = {
      openapiAvailable: false,
      paths: [],
      facilitiesPath: '/facilities',
      facilityCandidatePaths: ['/facilities'],
      facilityDetailPath: null,
      searchPaths: [],
      bboxPaths: [],
      statsPaths: [],
      countriesPaths: [],
      categoriesPaths: [],
      environmentalRoutes: [],
      facilityQueryParams: {
        limitParam: 'limit',
        maxLimit: 500,
        defaultLimit: 500,
        offsetParam: 'offset',
        countryParam: 'country',
        categoryParam: 'facility_type',
        searchParam: 'search',
        bboxStyle: null, // 'min_max' | 'nesw' | 'bbox_str'
      },
    };

    const res = await requestJson('/openapi.json', { ttlMs: 5 * 60 * 1000, timeoutMs: 5000 });
    if (!res.ok || !res.data || typeof res.data.paths !== 'object') {
      cachedCapabilities = cap;
      return cap;
    }

    cap.openapiAvailable = true;
    const pathEntries = Object.entries(res.data.paths);
    cap.paths = pathEntries.map(([p]) => p);

    const discoveredFacilityPaths = [];

    for (const [pathStr, pathItem] of pathEntries) {
      const getOp = pathItem?.get;
      if (!getOp) continue;

      const lowerPath = pathStr.toLowerCase();
      const rawParams = [
        ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
        ...(Array.isArray(getOp.parameters) ? getOp.parameters : []),
      ];
      const parsedParams = rawParams.map(parseOpenApiParam);
      const qNames = parsedParams.filter((p) => p.in === 'query').map((p) => p.name.toLowerCase());

      // Check for bbox / viewport endpoints
      if (
        !pathStr.includes('{') &&
        (lowerPath.includes('bbox') ||
          lowerPath.includes('viewport') ||
          lowerPath.includes('bounds') ||
          lowerPath.includes('map'))
      ) {
        cap.bboxPaths.push({ path: pathStr, params: parsedParams });
      }

      // Check for dedicated facility search endpoints
      if (!pathStr.includes('{') && lowerPath.includes('search')) {
        cap.searchPaths.push({ path: pathStr, params: parsedParams });
      }

      // Check for primary facilities list endpoint
      if (
        !pathStr.includes('{') &&
        (/^\/(api\/)?(v1\/)?(facilities|plants|locations|sites|power[-_]?plants)\/?$/.test(
          lowerPath
        ) ||
          lowerPath === '/facilities')
      ) {
        discoveredFacilityPaths.push(pathStr);
        cap.facilitiesPath = pathStr;

        const limitP = parsedParams.find((p) =>
          ['limit', 'page_size', 'per_page', 'size', 'count', 'max_results'].includes(
            p.name.toLowerCase()
          )
        );
        if (limitP) {
          cap.facilityQueryParams.limitParam = limitP.name;
          if (limitP.maximum && limitP.maximum > 0) {
            cap.facilityQueryParams.maxLimit = limitP.maximum;
            cap.facilityQueryParams.defaultLimit = Math.min(limitP.maximum, 500);
          }
        }

        const offsetP = parsedParams.find((p) =>
          ['offset', 'skip', 'page', 'start'].includes(p.name.toLowerCase())
        );
        cap.facilityQueryParams.offsetParam = offsetP ? offsetP.name : null;

        const countryP = parsedParams.find((p) =>
          ['country', 'country_name', 'country_long', 'iso3', 'nation'].includes(
            p.name.toLowerCase()
          )
        );
        if (countryP) cap.facilityQueryParams.countryParam = countryP.name;

        const catP = parsedParams.find((p) =>
          [
            'facility_type',
            'type',
            'category',
            'primary_fuel',
            'fuel_type',
            'fuel',
            'energy_source',
          ].includes(p.name.toLowerCase())
        );
        if (catP) cap.facilityQueryParams.categoryParam = catP.name;

        const searchP = parsedParams.find((p) =>
          ['search', 'q', 'query', 'name', 'keyword', 'term'].includes(p.name.toLowerCase())
        );
        if (searchP) cap.facilityQueryParams.searchParam = searchP.name;

        if (
          qNames.includes('min_lat') &&
          qNames.includes('max_lat') &&
          qNames.includes('min_lon') &&
          qNames.includes('max_lon')
        ) {
          cap.facilityQueryParams.bboxStyle = 'min_max';
        } else if (
          qNames.includes('south') &&
          qNames.includes('north') &&
          qNames.includes('west') &&
          qNames.includes('east')
        ) {
          cap.facilityQueryParams.bboxStyle = 'nesw';
        } else if (qNames.includes('bbox')) {
          cap.facilityQueryParams.bboxStyle = 'bbox_str';
        }
        continue;
      }

      // Facility detail endpoint
      if (
        /^\/(api\/)?(v1\/)?(facilities|plants|locations|sites)\/\{[^}]+\}\/?$/.test(lowerPath)
      ) {
        cap.facilityDetailPath = pathStr;
        continue;
      }

      // Stats / Summary / Overview endpoints
      if (
        !pathStr.includes('{') &&
        /(stats|statistics|summary|overview|metadata|counts|inventory|aggregat)/i.test(lowerPath)
      ) {
        cap.statsPaths.push(pathStr);
      }

      // Countries endpoints
      if (!pathStr.includes('{') && /countr/i.test(lowerPath)) {
        cap.countriesPaths.push(pathStr);
      }

      // Categories / Facility types endpoints
      if (
        !pathStr.includes('{') &&
        /(categor|facility[-_]?types|types|fuels|energy[-_]?sources)/i.test(lowerPath)
      ) {
        cap.categoriesPaths.push(pathStr);
      }

      // Environmental / Rainfall / Precipitation / Satellite endpoints
      if (
        /(rainfall|precip|environ|telemetry|climate|weather|satellite|eo|indicator|screening|analysis|imerg|ndvi|lst)/i.test(
          lowerPath
        )
      ) {
        cap.environmentalRoutes.push({
          path: pathStr,
          params: parsedParams,
          hasPathParam: pathStr.includes('{'),
        });
      }
    }

    if (discoveredFacilityPaths.length > 0) {
      cap.facilityCandidatePaths = discoveredFacilityPaths;
    }

    cachedCapabilities = cap;
    return cap;
  })();

  try {
    return await capabilitiesPromise;
  } finally {
    capabilitiesPromise = null;
  }
}

export async function discoverBackendPaths() {
  const cap = await discoverApiCapabilities();
  return cap.paths;
}

/**
 * Deeply extracts the facility array and reported total count from any backend response envelope.
 */
function extractFacilitiesFromPayload(payload) {
  if (!payload) return { rawArray: [], reportedTotal: null, extraMeta: {} };

  if (Array.isArray(payload)) {
    return { rawArray: payload, reportedTotal: null, extraMeta: {} };
  }

  if (payload.type === 'FeatureCollection' && Array.isArray(payload.features)) {
    const reportedTotal =
      payload.total ??
      payload.total_features ??
      payload.total_count ??
      payload.numberMatched ??
      payload.count ??
      null;
    return {
      rawArray: payload.features,
      reportedTotal: Number.isFinite(Number(reportedTotal)) ? Number(reportedTotal) : null,
      extraMeta: payload,
    };
  }

  const candidateKeys = [
    'facilities',
    'items',
    'data',
    'results',
    'records',
    'locations',
    'plants',
    'power_plants',
    'power_locations',
    'sites',
    'features',
    'rows',
    'points',
    'entries',
    'nodes',
    'list',
  ];

  const reportedTotalRaw =
    payload.total ??
    payload.total_count ??
    payload.total_facilities ??
    payload.total_sites ??
    payload.facilities_count ??
    payload.count ??
    payload.pagination?.total ??
    payload.meta?.total ??
    null;
  const reportedTotal = Number.isFinite(Number(reportedTotalRaw))
    ? Number(reportedTotalRaw)
    : null;

  for (const key of candidateKeys) {
    if (Array.isArray(payload[key])) {
      return {
        rawArray: payload[key],
        reportedTotal,
        extraMeta: payload,
      };
    }
  }

  // Fallback 1: Inspect nested object properties (e.g., payload.data.facilities)
  for (const key of ['data', 'result', 'response', 'payload', 'body']) {
    if (payload[key] && typeof payload[key] === 'object' && !Array.isArray(payload[key])) {
      const nested = extractFacilitiesFromPayload(payload[key]);
      if (nested.rawArray.length > 0) {
        return {
          rawArray: nested.rawArray,
          reportedTotal: nested.reportedTotal ?? reportedTotal,
          extraMeta: payload,
        };
      }
    }
  }

  // Fallback 2: Find ANY property on payload whose value is a non-empty array of objects
  for (const [, val] of Object.entries(payload)) {
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
      return {
        rawArray: val,
        reportedTotal,
        extraMeta: payload,
      };
    }
  }

  return { rawArray: [], reportedTotal, extraMeta: payload };
}

/**
 * Fetches facilities from the backend with automatic 422 parameter validation recovery,
 * viewport bounding-box support, country filtering, category filtering, and search.
 */
export async function fetchFacilities({
  limit,
  offset = 0,
  country = null,
  type = null,
  category = null,
  search = null,
  bbox = null,
} = {}) {
  const cap = await discoverApiCapabilities();
  const qpConfig = cap.facilityQueryParams;
  const requestedLimit = limit ?? qpConfig.defaultLimit ?? 500;
  const safeInitialLimit = Math.min(requestedLimit, qpConfig.maxLimit || 1000);

  const categoryFilter = category || type;

  const buildQueryUrl = (basePath, limitVal) => {
    const params = new URLSearchParams();
    if (limitVal !== null && limitVal !== undefined && qpConfig.limitParam) {
      params.set(qpConfig.limitParam, String(limitVal));
    }
    if (offset > 0 && qpConfig.offsetParam) {
      if (qpConfig.offsetParam === 'page' && limitVal) {
        params.set('page', String(Math.floor(offset / limitVal) + 1));
      } else {
        params.set(qpConfig.offsetParam, String(offset));
      }
    }
    if (country && country !== 'All' && qpConfig.countryParam) {
      params.set(qpConfig.countryParam, country);
    }
    if (categoryFilter && categoryFilter !== 'All' && qpConfig.categoryParam) {
      params.set(qpConfig.categoryParam, categoryFilter);
    }
    if (search && search.trim() && qpConfig.searchParam) {
      params.set(qpConfig.searchParam, search.trim());
    }
    if (bbox && qpConfig.bboxStyle) {
      if (qpConfig.bboxStyle === 'min_max') {
        params.set('min_lat', String(bbox.minLat));
        params.set('max_lat', String(bbox.maxLat));
        params.set('min_lon', String(bbox.minLon));
        params.set('max_lon', String(bbox.maxLon));
      } else if (qpConfig.bboxStyle === 'nesw') {
        params.set('south', String(bbox.minLat));
        params.set('north', String(bbox.maxLat));
        params.set('west', String(bbox.minLon));
        params.set('east', String(bbox.maxLon));
      } else if (qpConfig.bboxStyle === 'bbox_str') {
        params.set('bbox', `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`);
      }
    }
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const candidateLimits = Array.from(
    new Set([safeInitialLimit, 500, 250, 100, 50, null])
  );

  for (const candidateLimit of candidateLimits) {
    const url = buildQueryUrl(cap.facilitiesPath, candidateLimit);
    const res = await requestJson(url);

    if (res.ok && res.data !== null) {
      const { rawArray, reportedTotal, extraMeta } = extractFacilitiesFromPayload(res.data);
      const facilities = [];
      for (let i = 0; i < rawArray.length; i++) {
        const norm = normalizeFacilityRecord(rawArray[i], offset + i);
        if (norm) facilities.push(norm);
      }

      if (facilities.length > 0 || rawArray.length === 0) {
        return {
          ok: true,
          status: res.status,
          apiState: 'online',
          endpoint: url,
          facilities,
          reportedTotal,
          appliedLimit: candidateLimit,
          meta: extraMeta,
        };
      }
    }

    // Handle FastAPI 422 Unprocessable Entity by parsing detail[].ctx.le
    if (res.status === 422 && res.data?.detail) {
      const details = Array.isArray(res.data.detail) ? res.data.detail : [];
      const limitErr = details.find(
        (d) =>
          Array.isArray(d.loc) &&
          d.loc.some((l) => String(l).toLowerCase().includes('limit')) &&
          (d.ctx?.le !== undefined || d.ctx?.lt !== undefined)
      );
      if (limitErr) {
        const allowedMax = Number(limitErr.ctx.le ?? limitErr.ctx.lt - 1);
        if (Number.isFinite(allowedMax) && allowedMax > 0) {
          qpConfig.maxLimit = allowedMax;
          qpConfig.defaultLimit = allowedMax;
          const retryUrl = buildQueryUrl(cap.facilitiesPath, allowedMax);
          const retryRes = await requestJson(retryUrl);
          if (retryRes.ok && retryRes.data !== null) {
            const { rawArray, reportedTotal, extraMeta } = extractFacilitiesFromPayload(
              retryRes.data
            );
            const facilities = [];
            for (let i = 0; i < rawArray.length; i++) {
              const norm = normalizeFacilityRecord(rawArray[i], offset + i);
              if (norm) facilities.push(norm);
            }
            return {
              ok: true,
              status: retryRes.status,
              apiState: 'online',
              endpoint: retryUrl,
              facilities,
              reportedTotal,
              appliedLimit: allowedMax,
              meta: extraMeta,
            };
          }
        }
      }
      continue;
    }

    if (res.status === 0) {
      return {
        ok: false,
        status: 0,
        apiState: 'offline',
        endpoint: url,
        facilities: [],
        reportedTotal: null,
        error: res.error || `Cannot reach backend at ${API_BASE}`,
      };
    }
  }

  return {
    ok: false,
    status: 422,
    apiState: 'error',
    endpoint: cap.facilitiesPath,
    facilities: [],
    reportedTotal: null,
    error: `Backend rejected query parameters on ${cap.facilitiesPath}`,
  };
}

export const fetchFacilitiesBatch = fetchFacilities;

/**
 * Dedicated debounced search query for the Facility Search Autocomplete component.
 * Supports searching by facility name, GEM/facility ID, country, or "lat, lon" coordinates.
 */
export async function searchFacilitiesAutocomplete(queryText, cachedFacilities = [], limit = 15) {
  const q = (queryText || '').trim();
  if (!q) return [];

  const qLower = q.toLowerCase();
  const coordMatch = q.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  const targetLat = coordMatch ? Number(coordMatch[1]) : null;
  const targetLon = coordMatch ? Number(coordMatch[2]) : null;

  const rankAndDeduplicate = (list) => {
    const map = new Map();
    list.forEach((f) => {
      if (f && f.id && !map.has(f.id)) {
        map.set(f.id, f);
      }
    });
    const unique = Array.from(map.values());

    if (Number.isFinite(targetLat) && Number.isFinite(targetLon)) {
      return unique
        .map((f) => ({
          facility: f,
          dist: Math.hypot(f.latitude - targetLat, f.longitude - targetLon),
        }))
        .filter((item) => item.dist <= 5.0)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, limit)
        .map((item) => item.facility);
    }

    return unique
      .map((f) => {
        const nameLower = f.name.toLowerCase();
        const idLower = f.id.toLowerCase();
        const countryLower = f.country.toLowerCase();
        const catLower = f.category.toLowerCase();
        const coordStr = `${f.latitude.toFixed(4)}, ${f.longitude.toFixed(4)}`;

        let score = 0;
        if (idLower === qLower) score = 100;
        else if (nameLower === qLower) score = 95;
        else if (nameLower.startsWith(qLower)) score = 85;
        else if (idLower.startsWith(qLower)) score = 80;
        else if (nameLower.includes(qLower)) score = 70;
        else if (countryLower.startsWith(qLower)) score = 60;
        else if (countryLower.includes(qLower)) score = 50;
        else if (catLower.includes(qLower)) score = 40;
        else if (coordStr.includes(qLower)) score = 35;

        return { facility: f, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || (b.facility.capacity_mw || 0) - (a.facility.capacity_mw || 0))
      .slice(0, limit)
      .map((item) => item.facility);
  };

  // 1. Local matches from already cached facilities
  const localMatches = rankAndDeduplicate(cachedFacilities);

  // 2. Query backend search endpoint (if not a raw coordinate pair or if local results < limit)
  if (!coordMatch && q.length >= 2) {
    try {
      const cap = await discoverApiCapabilities();
      let backendItems = [];

      // Try dedicated /facilities/search route if present in OpenAPI
      if (cap.searchPaths.length > 0) {
        const sp = cap.searchPaths[0];
        const qParam =
          sp.params.find((p) =>
            ['q', 'query', 'search', 'name', 'term'].includes(p.name.toLowerCase())
          )?.name || 'q';
        const res = await requestJson(
          `${sp.path}?${encodeURIComponent(qParam)}=${encodeURIComponent(q)}&limit=${limit}`
        );
        if (res.ok && res.data) {
          const { rawArray } = extractFacilitiesFromPayload(res.data);
          backendItems = rawArray
            .map((r, i) => normalizeFacilityRecord(r, i))
            .filter(Boolean);
        }
      }

      // Also try standard /facilities?search=...
      if (backendItems.length === 0) {
        const res = await fetchFacilities({ search: q, limit: 50 });
        if (res.ok && res.facilities.length > 0) {
          backendItems = res.facilities;
        }
      }

      if (backendItems.length > 0) {
        return rankAndDeduplicate([...backendItems, ...localMatches]);
      }
    } catch {
      // Fallback to local matches
    }
  }

  return localMatches;
}

/**
 * Fetches backend country and category aggregations from /stats, /countries, and /categories.
 */
async function fetchBackendAggregations() {
  const cap = await discoverApiCapabilities();
  const agg = {
    totalFacilities: null,
    totalCountries: null,
    countriesMap: new Map(), // countryName -> count (or null)
    categoriesMap: new Map(), // normalizedCategory -> { count, rawToken }
    statsEndpointUsed: null,
  };

  const ingestCategories = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach((item) => {
        if (typeof item === 'string' && item.trim()) {
          const norm = normalizeFuelCategory(item);
          if (!agg.categoriesMap.has(norm)) {
            agg.categoriesMap.set(norm, { count: null, rawToken: item.trim() });
          }
        } else if (item && typeof item === 'object') {
          const rawName = pickField(item, [
            'facility_type',
            'category',
            'type',
            'primary_fuel',
            'fuel_type',
            'name',
            'label',
          ]);
          const cnt = pickField(item, ['count', 'total', 'facilities_count', 'site_count', 'value']);
          if (rawName) {
            const norm = normalizeFuelCategory(rawName);
            const prev = agg.categoriesMap.get(norm);
            const numCnt = Number.isFinite(Number(cnt)) ? Number(cnt) : null;
            agg.categoriesMap.set(norm, {
              count: numCnt !== null ? (prev?.count || 0) + numCnt : prev?.count ?? null,
              rawToken: prev?.rawToken || String(rawName),
            });
          }
        }
      });
    } else {
      Object.entries(obj).forEach(([k, v]) => {
        if (typeof v === 'number' || typeof v === 'string') {
          const norm = normalizeFuelCategory(k);
          const numCnt = Number.isFinite(Number(v)) ? Number(v) : null;
          const prev = agg.categoriesMap.get(norm);
          agg.categoriesMap.set(norm, {
            count: numCnt !== null ? (prev?.count || 0) + numCnt : prev?.count ?? null,
            rawToken: prev?.rawToken || k,
          });
        }
      });
    }
  };

  const ingestCountries = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach((item) => {
        if (typeof item === 'string' && item.trim()) {
          const c = item.trim();
          if (!agg.countriesMap.has(c)) agg.countriesMap.set(c, null);
        } else if (item && typeof item === 'object') {
          const name = pickField(item, [
            'country',
            'country_name',
            'country_long',
            'name',
            'label',
          ]);
          const cnt = pickField(item, ['count', 'total', 'facilities_count', 'site_count', 'value']);
          if (name && String(name).trim()) {
            const cName = String(name).trim();
            const numCnt = Number.isFinite(Number(cnt)) ? Number(cnt) : null;
            agg.countriesMap.set(cName, numCnt ?? agg.countriesMap.get(cName) ?? null);
          }
        }
      });
    } else {
      Object.entries(obj).forEach(([k, v]) => {
        if (k && k.trim() && (typeof v === 'number' || typeof v === 'string')) {
          const numCnt = Number.isFinite(Number(v)) ? Number(v) : null;
          agg.countriesMap.set(k.trim(), numCnt);
        }
      });
    }
  };

  // 1. Query stats endpoints
  const statsCandidates = [
    ...new Set([
      ...cap.statsPaths,
      '/global-stats',
      '/stats',
      '/facilities/stats',
      '/api/stats',
    ]),
  ];
  for (const sPath of statsCandidates) {
    const res = await requestJson(sPath);
    if (res.ok && res.data && typeof res.data === 'object') {
      agg.statsEndpointUsed = sPath;
      const d = res.data.data || res.data;

      const tFac = pickField(d, [
        'total_facilities',
        'facility_count',
        'total_sites',
        'facilities_count',
        'total_plants',
        'total',
        'count',
      ]);
      if (Number.isFinite(Number(tFac)) && Number(tFac) > 0) {
        agg.totalFacilities = Number(tFac);
      }

      const tCountries = pickField(d, [
        'total_countries',
        'countries_count',
        'num_countries',
        'country_count',
      ]);
      if (Number.isFinite(Number(tCountries)) && Number(tCountries) > 0) {
        agg.totalCountries = Number(tCountries);
      } else if (typeof d.countries === 'number' && d.countries > 0) {
        agg.totalCountries = d.countries;
      }

      ingestCategories(
        d.by_type ||
          d.by_category ||
          d.facility_types ||
          d.categories ||
          d.types ||
          d.fuel_types ||
          d.by_fuel ||
          d.type_counts ||
          d.category_counts
      );

      if (Array.isArray(d.countries) || (d.countries && typeof d.countries === 'object')) {
        ingestCountries(d.countries);
      }
      if (d.by_country || d.country_counts || d.countries_breakdown) {
        ingestCountries(d.by_country || d.country_counts || d.countries_breakdown);
      }
    }
  }

  // 2. Query countries endpoints (with a high limit parameter in case it paginates)
  const countryCandidates =
    cap.countriesPaths.length > 0
      ? cap.countriesPaths
      : ['/countries', '/facilities/countries', '/api/countries'];
  for (const cPath of countryCandidates) {
    const res = await requestJson(cPath);
    if (res.ok && res.data) {
      const payload =
        res.data.countries ||
        res.data.items ||
        res.data.data ||
        res.data.results ||
        res.data;
      ingestCountries(payload);
      const reportedCount = res.data.total ?? res.data.count ?? null;
      if (Number.isFinite(Number(reportedCount)) && Number(reportedCount) > 0) {
        agg.totalCountries = Math.max(agg.totalCountries || 0, Number(reportedCount));
      }
    }
  }

  // 3. Query categories endpoints
  const catCandidates =
    cap.categoriesPaths.length > 0
      ? cap.categoriesPaths
      : ['/categories', '/facility-types', '/facilities/types'];
  for (const catPath of catCandidates) {
    const res = await requestJson(catPath);
    if (res.ok && res.data) {
      const payload =
        res.data.categories ||
        res.data.facility_types ||
        res.data.types ||
        res.data.items ||
        res.data.data ||
        res.data;
      ingestCategories(payload);
    }
  }

  return agg;
}

/**
 * Loads the initial dashboard dataset + distributed batches across the inventory
 * so markers, all available countries, and all categories populate immediately.
 */
export async function fetchInitialDashboardData() {
  try {
    const response = await fetch('/data/facilities.json', {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Static facility dataset returned HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data.facilities)) {
      throw new Error('Invalid static facility dataset');
    }

    const facilities = data.facilities
      .map((record, index) => {
        // Compact static dataset: convert each array into the original
        // named-field format before passing it to the existing normalizer.
        const item = Array.isArray(record)
          ? Object.fromEntries(data.fields.map((field, i) => [field, record[i]]))
          : record;

        return normalizeFacilityRecord(item, index);
      })
      .filter(Boolean);

    const countryCounts = new Map();
    const categoryCounts = new Map();
    const rawCategoryTokens = new Map();

    facilities.forEach((f) => {
      if (f.country && f.country !== 'Unspecified') {
        countryCounts.set(
          f.country,
          (countryCounts.get(f.country) || 0) + 1
        );
      }

      if (f.category) {
        categoryCounts.set(
          f.category,
          (categoryCounts.get(f.category) || 0) + 1
        );

        if (f.raw_type && !rawCategoryTokens.has(f.category)) {
          rawCategoryTokens.set(f.category, f.raw_type);
        }
      }
    });

    const countries = Array.from(countryCounts.entries())
      .map(([name, count]) => ({
        name,
        count: data.countries?.[name] ?? count,
        loadedCount: count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const categories = Array.from(categoryCounts.entries())
      .map(([name, count]) => ({
        name,
        count,
        loadedCount: count,
        rawToken: rawCategoryTokens.get(name) || name.toLowerCase(),
      }))
      .sort((a, b) => b.count - a.count);

    return {
      ok: true,
      apiState: 'online',
      apiBase: API_BASE,
      facilities,
      countries,
      categories,
      totalFacilities: data.total ?? facilities.length,
      totalCountries: countries.length,
      loadedCount: facilities.length,
      endpointsUsed: ['/data/facilities.json'],
      capabilities: null,
    };
  } catch (error) {
    console.error('Failed to load static facility dataset:', error);

    return {
      ok: false,
      apiState: 'offline',
      error: error.message || 'Failed to load static facility dataset',
      facilities: [],
      countries: [],
      categories: [],
      totalFacilities: 0,
      totalCountries: 0,
      endpointsUsed: [],
    };
  }
}

/**
 * Progressive background sweep to discover any remaining countries across the dataset
 * when the backend does not expose a dedicated /countries aggregation endpoint.
 */
export async function fetchAdditionalInventorySample({
  currentOffset = 0,
  step = 4000,
  batches = 5,
} = {}) {
  const cap = await discoverApiCapabilities();
  if (!cap.facilityQueryParams.offsetParam) return [];
  const limit = Math.min(400, cap.facilityQueryParams.maxLimit || 500);

  const offsets = [];
  for (let i = 0; i < batches; i++) {
    offsets.push(currentOffset + i * step);
  }

  const results = await Promise.all(
    offsets.map((off) => fetchFacilities({ limit, offset: off }))
  );

  const merged = [];
  results.forEach((r) => {
    if (r.ok && r.facilities.length > 0) {
      merged.push(...r.facilities);
    }
  });
  return merged;
}

export async function fetchFacilityById(facilityId) {
  if (!facilityId) return null;
  const cap = await discoverApiCapabilities();
  if (!cap.facilityDetailPath) return null;

  const resolvedPath = cap.facilityDetailPath.replace(
    /\{[^}]+\}/,
    encodeURIComponent(String(facilityId))
  );
  const res = await requestJson(resolvedPath);
  if (res.ok && res.data) {
    const record = res.data.facility || res.data.data || res.data;
    return {
      facility: normalizeFacilityRecord(record, 0),
      raw: record,
      endpoint: resolvedPath,
    };
  }
  return null;
}

/**
 * Parses supported environmental / rainfall observations from a backend payload.
 */
function parseEnvironmentalIndicators(rawPayload, defaultEndpoint) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return { indicators: [], timeSeries: null, source: null, period: null, quality: null };
  }

  const indicators = [];
  const seenKeys = new Set();

  const sourceLabel =
    rawPayload.source ||
    rawPayload.dataset ||
    rawPayload.sensor ||
    rawPayload.mission ||
    (defaultEndpoint?.toLowerCase().includes('rainfall') ||
    defaultEndpoint?.toLowerCase().includes('precip') ||
    defaultEndpoint?.toLowerCase().includes('imerg')
      ? 'NASA GPM IMERG'
      : 'Earth Observation Feed');

  const periodLabel =
    rawPayload.period ||
    rawPayload.date ||
    rawPayload.observation_date ||
    rawPayload.timestamp ||
    rawPayload.time_range ||
    rawPayload.temporal_coverage ||
    null;

  const qualityLabel =
    rawPayload.quality ||
    rawPayload.confidence ||
    rawPayload.qa_status ||
    rawPayload.data_quality ||
    null;

  const addIndicator = (key, label, value, unit = '', itemMeta = {}) => {
    if (value === null || value === undefined || value === '' || Number.isNaN(value)) {
      return;
    }
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    indicators.push({
      key,
      label,
      value,
      unit,
      source: itemMeta.source || itemMeta.dataset || itemMeta.sensor || sourceLabel,
      period: itemMeta.period || itemMeta.date || itemMeta.timestamp || periodLabel,
      quality: itemMeta.quality || itemMeta.confidence || qualityLabel,
    });
  };

  const arrayCandidates = [
    rawPayload.observations,
    rawPayload.indicators,
    rawPayload.measurements,
    rawPayload.metrics,
    rawPayload.layers,
    rawPayload.results,
  ];

  for (const arr of arrayCandidates) {
    if (Array.isArray(arr)) {
      arr.forEach((item, idx) => {
        if (!item || typeof item !== 'object') return;
        const name =
          item.indicator ||
          item.name ||
          item.parameter ||
          item.metric ||
          item.variable ||
          `Observation ${idx + 1}`;
        const val =
          item.value ??
          item.mean ??
          item.average ??
          item.measurement ??
          item.rainfall_mm ??
          item.precipitation_mm;
        const unit = item.unit || item.units || '';
        addIndicator(`${name}-${idx}`, name, val, unit, item);
      });
    }
  }

  const KNOWN_FIELDS = [
    ['mean_rainfall_mm', 'Mean Precipitation', 'mm'],
    ['annual_rainfall_mm', 'Annual Precipitation', 'mm/yr'],
    ['total_rainfall_mm', 'Total Precipitation', 'mm'],
    ['rainfall_mm', 'Precipitation (Rainfall)', 'mm'],
    ['precipitation_mm', 'Precipitation', 'mm'],
    ['precipitation_rate', 'Precipitation Rate', 'mm/hr'],
    ['rainfall_anomaly', 'Rainfall Anomaly', '%'],
    ['wet_days', 'Wet Days', 'days'],
    ['lst_celsius', 'Land Surface Temperature (LST)', '°C'],
    ['surface_temperature_c', 'Land Surface Temperature', '°C'],
    ['ndvi', 'Vegetation Index (NDVI)', 'index'],
    ['mean_ndvi', 'Mean NDVI', 'index'],
    ['ndwi', 'Water Index (NDWI)', 'index'],
    ['surface_water_km2', 'Surface Water Extent', 'km²'],
    ['sar_backscatter_db', 'SAR Backscatter (Sentinel-1)', 'dB'],
    ['no2_column', 'Tropospheric NO₂ (Sentinel-5P)', 'mol/m²'],
    ['so2_column', 'Tropospheric SO₂ (Sentinel-5P)', 'mol/m²'],
    ['co_column', 'Carbon Monoxide (Sentinel-5P)', 'mol/m²'],
    ['aerosol_index', 'UV Aerosol Index', 'index'],
  ];

  const targetObj =
    rawPayload.data && typeof rawPayload.data === 'object' ? rawPayload.data : rawPayload;

  for (const [fieldKey, label, unit] of KNOWN_FIELDS) {
    if (targetObj[fieldKey] !== undefined && targetObj[fieldKey] !== null) {
      addIndicator(fieldKey, label, targetObj[fieldKey], unit, targetObj);
    }
  }

  const EXCLUDED_KEYS = new Set([
    'id',
    'facility_id',
    'gem_id',
    'gppd_idnr',
    'lat',
    'lon',
    'lng',
    'latitude',
    'longitude',
    'radius',
    'radius_km',
    'buffer_km',
    'capacity',
    'capacity_mw',
    'status',
    'code',
    'count',
    'total',
    'limit',
    'offset',
    'commissioning_year',
    'start_year',
    'year',
  ]);

  Object.entries(targetObj).forEach(([k, v]) => {
    if (EXCLUDED_KEYS.has(k.toLowerCase())) return;
    if (typeof v === 'number' && Number.isFinite(v)) {
      const cleanLabel = k
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      addIndicator(k, cleanLabel, v, '', targetObj);
    }
  });

  const seriesArray =
    targetObj.time_series ||
    targetObj.series ||
    targetObj.monthly_rainfall ||
    targetObj.history ||
    targetObj.records;

  let timeSeries = null;
  if (Array.isArray(seriesArray) && seriesArray.length > 0) {
    timeSeries = seriesArray.slice(-12);
  }

  return {
    indicators,
    timeSeries,
    source: sourceLabel,
    period: periodLabel,
    quality: qualityLabel,
  };
}

/**
 * Fetches environmental observations for the selected facility and analytical radius (1, 5, 10, 25 km).
 */
export async function fetchFacilityEnvironmentalData({
  facilityId,
  latitude,
  longitude,
  radiusKm = 1,
  facility = null,
}) {
  const cap = await discoverApiCapabilities();
  const triedEndpoints = [];

  // Facility-linked NASA SMAP and GPM data (not global test observations).
  if (facilityId) {
    const facilityPath = `/environmental/facilities/${encodeURIComponent(String(facilityId))}`;
    triedEndpoints.push(facilityPath);
    const linked = await requestJson(facilityPath, { ttlMs: 30000, timeoutMs: 8000 });

    if (linked.ok && linked.data) {
      const payload = linked.data;
      const f = payload.facility || {};
      const rainfall = Array.isArray(payload.monthly_rainfall)
        ? payload.monthly_rainfall
        : [];
      const indicators = [];

      const add = (key, label, value, unit, source, period, quality) => {
        if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return;
        indicators.push({ key, label, value: Number(value), unit, source, period, quality });
      };

      add("smap_surface", "Surface soil moisture", f.surface_soil_moisture_m3_m3,
        "m³/m³", f.source || "NASA SMAP L4", f.observation_time_utc, f.quality_flag);
      add("smap_rootzone", "Root-zone soil moisture", f.rootzone_soil_moisture_m3_m3,
        "m³/m³", f.source || "NASA SMAP L4", f.observation_time_utc, f.quality_flag);
      add("smap_profile", "Profile soil moisture", f.profile_soil_moisture_m3_m3,
        "m³/m³", f.source || "NASA SMAP L4", f.observation_time_utc, f.quality_flag);

      rainfall.slice(-12).forEach((r) => {
        const month = `${r.year}-${String(r.month).padStart(2, "0")}`;
        add(`gpm_${month}`, `Rainfall ${month}`,
          r.estimated_monthly_accumulation_mm, "mm/month",
          r.source || "NASA GPM IMERG V07B", month, r.quality_index);
      });

      if (indicators.length) {
        return {
          state: "available",
          status: linked.status || 200,
          endpoint: facilityPath,
          radiusKm,
          indicators,
          timeSeries: rainfall,
          source: "NASA SMAP L4 / NASA GPM IMERG V07B",
          period: rainfall.length ? `${rainfall[0].year}-${rainfall[0].month} to ${rainfall.at(-1).year}-${rainfall.at(-1).month}` : f.observation_time_utc,
          quality: f.quality_flag || null,
          message: "Facility-linked observations. Coverage varies by satellite product."
        };
      }
    }
  }

  if (facility?.raw) {
    const embedded = parseEnvironmentalIndicators(facility.raw, 'Facility Record');
    if (embedded.indicators.length > 0) {
      return {
        state: 'available',
        status: 200,
        endpoint: `${cap.facilitiesPath}/${facilityId}`,
        radiusKm,
        ...embedded,
      };
    }
  }

  if (facilityId && cap.facilityDetailPath) {
    const detail = await fetchFacilityById(facilityId);
    if (detail?.raw) {
      triedEndpoints.push(detail.endpoint);
      const parsedDetail = parseEnvironmentalIndicators(detail.raw, detail.endpoint);
      if (parsedDetail.indicators.length > 0) {
        return {
          state: 'available',
          status: 200,
          endpoint: detail.endpoint,
          radiusKm,
          ...parsedDetail,
        };
      }
    }
  }

  for (const route of cap.environmentalRoutes) {
    let resolvedPath = route.path;
    if (route.hasPathParam) {
      if (!facilityId) continue;
      resolvedPath = resolvedPath.replace(
        /\{[^}]+\}/g,
        encodeURIComponent(String(facilityId))
      );
    }

    const params = new URLSearchParams();
    const queryParams = route.params.filter((p) => p.in === 'query');

    if (queryParams.length > 0) {
      for (const p of queryParams) {
        const pLower = p.name.toLowerCase();
        if (['lat', 'latitude', 'y'].includes(pLower)) {
          params.set(p.name, String(latitude));
        } else if (['lon', 'lng', 'longitude', 'long', 'x'].includes(pLower)) {
          params.set(p.name, String(longitude));
        } else if (
          ['radius_km', 'buffer_km', 'radius', 'buffer', 'distance_km'].includes(pLower)
        ) {
          params.set(p.name, String(radiusKm));
        } else if (['facility_id', 'id', 'gem_id', 'plant_id'].includes(pLower) && facilityId) {
          params.set(p.name, String(facilityId));
        }
      }
    } else {
      params.set('lat', String(latitude));
      params.set('lon', String(longitude));
      params.set('radius_km', String(radiusKm));
      if (facilityId) params.set('facility_id', String(facilityId));
    }

    const qs = params.toString();
    const fullUrl = qs ? `${resolvedPath}?${qs}` : resolvedPath;
    triedEndpoints.push(fullUrl);

    const res = await requestJson(fullUrl, { ttlMs: 30 * 1000, timeoutMs: 6000 });
    if (res.status === 0) {
      return {
        state: 'connection_error',
        status: 0,
        endpoint: fullUrl,
        radiusKm,
        indicators: [],
        timeSeries: null,
        message: res.error || `Backend connection failed while requesting ${fullUrl}`,
      };
    }

    if (res.ok && res.data) {
      const parsed = parseEnvironmentalIndicators(res.data, resolvedPath);
      if (parsed.indicators.length > 0 || parsed.timeSeries) {
        return {
          state: 'available',
          status: res.status,
          endpoint: fullUrl,
          radiusKm,
          ...parsed,
        };
      }
    }
  }

  return {
    state: 'unavailable',
    status: 404,
    endpoint: triedEndpoints[0] || null,
    triedEndpoints,
    radiusKm,
    indicators: [],
    timeSeries: null,
    message:
      cap.environmentalRoutes.length === 0
        ? 'No environmental or rainfall telemetry endpoints are registered on the active FastAPI server (/openapi.json).'
        : `No environmental measurements were returned for (${latitude.toFixed(
            4
          )}, ${longitude.toFixed(4)}) within the ${radiusKm} km observation buffer.`,
  };
}


export async function fetchFullEnvironmentalProfile(facilityId) {
  const response = await requestJson(
    `/facilities/${encodeURIComponent(facilityId)}/environmental-profile`,
    { ttlMs: 60000, timeoutMs: 15000 }
  );
  return response.ok ? response.data : null;
}

export const fetchEnvironmentalData = fetchFacilityEnvironmentalData;

export default {
  API_BASE,
  CANDIDATE_BASES,
  discoverApiCapabilities,
  discoverBackendPaths,
  fetchInitialDashboardData,
  fetchAdditionalInventorySample,
  fetchFacilities,
  fetchFacilitiesBatch,
  searchFacilitiesAutocomplete,
  fetchFacilityById,
  fetchFacilityEnvironmentalData,
  fetchEnvironmentalData,
  normalizeFacilityRecord,
  normalizeFuelCategory,
  formatCategoryLabel,
  clearApiCache,
};