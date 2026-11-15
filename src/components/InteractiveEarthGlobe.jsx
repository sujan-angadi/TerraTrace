import React, { useEffect, useRef, useState } from 'react';

/* Full 360-degree rotation every 105 seconds (within the 90–120s requirement) */
const ROTATION_PERIOD_SECONDS = 105.0;
const ANGULAR_VELOCITY_RAD_PER_SEC = (Math.PI * 2) / ROTATION_PERIOD_SECONDS;
const DEG_TO_RAD = Math.PI / 180;

/* Restrained Global Infrastructure Nodes */
const INFRASTRUCTURE_NODES = [
  { id: 'bhadla', name: 'Bhadla Solar Park', country: 'India', meta: 'Solar · 2,245 MW', lat: 27.54, lon: 71.92 },
  { id: 'itaipu', name: 'Itaipu Hydroelectric', country: 'Brazil', meta: 'Hydro · 14,000 MW', lat: -25.41, lon: -54.59 },
  { id: 'alta', name: 'Alta Wind Energy Center', country: 'United States', meta: 'Wind · 1,548 MW', lat: 35.02, lon: -118.32 },
  { id: 'hornsea', name: 'Hornsea Offshore Wind', country: 'United Kingdom', meta: 'Wind · 1,218 MW', lat: 53.88, lon: 1.79 },
  { id: 'olkaria', name: 'Olkaria Geothermal', country: 'Kenya', meta: 'Geothermal · 792 MW', lat: -0.89, lon: 36.31 },
  { id: 'gansu', name: 'Gansu Wind Cluster', country: 'China', meta: 'Wind · 7,965 MW', lat: 40.2, lon: 96.9 },
  { id: 'mbr', name: 'MBR Solar Park', country: 'United Arab Emirates', meta: 'Solar · 2,027 MW', lat: 24.75, lon: 55.36 },
  { id: 'bungala', name: 'Bungala Solar Project', country: 'Australia', meta: 'Solar · 275 MW', lat: -32.42, lon: 137.84 },
];

/* High-resolution continental coastline vectors for crisp landmass rasterization */
const CONTINENT_POLYGONS = [
  // North America
  [
    [71, -162], [70, -128], [66, -92], [61, -65], [47, -53], [44, -66],
    [35, -75], [25, -80], [29, -90], [21, -97], [18, -94], [9, -83],
    [8, -77], [15, -93], [23, -106], [33, -118], [48, -124], [60, -141], [63, -165],
  ],
  // Greenland
  [
    [60, -44], [69, -26], [79, -18], [82, -36], [76, -68], [66, -53],
  ],
  // South America
  [
    [11, -75], [10, -61], [2, -50], [-6, -35], [-18, -39], [-24, -46],
    [-35, -53], [-54, -68], [-50, -75], [-33, -71], [-18, -71], [-5, -81], [5, -77],
  ],
  // Eurasia
  [
    [36, -9], [43, -9], [48, -4], [53, 5], [58, 8], [62, 5], [70, 20],
    [71, 45], [73, 85], [72, 135], [66, 178], [60, 162], [53, 141],
    [41, 130], [38, 120], [31, 121], [22, 114], [12, 109], [2, 103],
    [16, 97], [22, 89], [8, 77], [20, 72], [25, 67], [30, 49],
    [26, 56], [21, 59], [13, 45], [20, 40], [31, 34], [36, 36],
    [41, 29], [38, 23], [40, 18], [44, 12], [38, 15], [43, 5], [36, -5],
  ],
  // Great Britain & Ireland
  [[50, -5], [58, -6], [58, -1], [51, 1]],
  // Africa
  [
    [35, -6], [37, 10], [32, 32], [22, 37], [12, 44], [11, 51], [2, 45],
    [-12, 41], [-26, 33], [-34, 25], [-34, 18], [-18, 12], [-5, 12],
    [4, 9], [5, -4], [11, -16], [15, -17], [26, -15],
  ],
  // Madagascar
  [[-13, 49], [-25, 47], [-25, 44], [-15, 46]],
  // Japan
  [[31, 130], [35, 140], [43, 145], [40, 139], [34, 132]],
  // Maritime SE Asia
  [[5, 95], [-6, 106], [-8, 118], [-2, 120], [4, 117], [6, 100]],
  [[0, 109], [-4, 115], [-1, 117], [3, 113]],
  [[-2, 132], [-6, 140], [-8, 147], [-4, 142]],
  // Australia
  [
    [-12, 131], [-12, 142], [-20, 149], [-28, 153], [-38, 146],
    [-35, 136], [-32, 125], [-34, 115], [-22, 114], [-15, 124],
  ],
  // New Zealand
  [[-35, 173], [-41, 175], [-46, 167], [-39, 174]],
  // Antarctica
  [
    [-68, -180], [-65, -120], [-63, -60], [-67, 0], [-66, 60],
    [-65, 120], [-68, 180], [-89, 180], [-89, -180],
  ],
];

function hash2(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}

function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x, y, octaves = 5) {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    value += amp * valueNoise(x * freq, y * freq);
    freq *= 2.02;
    amp *= 0.5;
  }
  return value;
}

/**
- Builds a highly realistic, CLOUDLESS procedural Earth texture.
- Oceans are deep navy. Landmasses have dark, natural shading.
 */
function buildCloudlessEarthTexture() {
  const width = 1024;
  const height = 512;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const mctx = maskCanvas.getContext('2d');

  mctx.fillStyle = '#000000';
  mctx.fillRect(0, 0, width, height);
  mctx.fillStyle = '#ffffff';

  CONTINENT_POLYGONS.forEach((poly) => {
    mctx.beginPath();
    poly.forEach(([lat, lon], idx) => {
      const x = ((lon + 180) / 360) * width;
      const y = ((90 - lat) / 180) * height;
      if (idx === 0) mctx.moveTo(x, y);
      else mctx.lineTo(x, y);
    });
    mctx.closePath();
    mctx.fill();
  });

  const rawMask = mctx.getImageData(0, 0, width, height).data;
  const earthData = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const v = y / height;
    const lat = 90 - v * 180;
    const absLat = Math.abs(lat);

    for (let x = 0; x < width; x++) {
      const u = x / width;
      const lon = u * 360 - 180;
      const idx = (y * width + x) * 4;

      const angle = u * Math.PI * 2;
      const nx = Math.cos(angle) * 2.5 + 3.7;
      const ny = Math.sin(angle) * 2.5 + 3.7;
      const nz = v * 5.0;

      const n1 = fbm(nx + nz, ny - nz, 5);
      const n2 = fbm(nx * 2.8 + 7.1, ny * 2.8 + nz * 1.9, 4);

      const baseMask = rawMask[idx] / 255;
      const coastDetail = (n2 - 0.48) * 0.4;
      const isLand = baseMask + coastDetail > 0.51 || (absLat > 80 && baseMask > 0.2);

      if (!isLand) {
        // Deep Navy / Dark Blue Oceans
        const shelf = Math.max(0, Math.min(1, (baseMask + n2 * 0.26) * 1.45));
        earthData[idx] = Math.round(2 + shelf * 10 + n1 * 4);
        earthData[idx + 1] = Math.round(14 + shelf * 22 + n1 * 6);
        earthData[idx + 2] = Math.round(32 + shelf * 30 + n1 * 8);
        earthData[idx + 3] = 0; // Alpha 0 = Ocean (receives solar specular glint)
      } else {
        // Darker, Natural Landmass Biomes
        const isSaharaArabia = lat > 13 && lat < 33 && lon > -17 && lon < 58 ? 1.0 : 0.0;
        const isAusOutback = lat > -31 && lat < -18 && lon > 115 && lon < 143 ? 0.85 : 0.0;
        const isCentralAsia = lat > 35 && lat < 47 && lon > 55 && lon < 110 ? 0.75 : 0.0;
        const isSWAmerica = lat > 23 && lat < 38 && lon > -118 && lon < -102 ? 0.7 : 0.0;

        const aridity = Math.min(
          1,
          Math.max(isSaharaArabia, isAusOutback, isCentralAsia, isSWAmerica) *
            (0.65 + n1 * 0.55) +
            Math.exp(-Math.pow((absLat - 25) / 11, 2)) * (n1 * 0.6)
        );

        const polarIce = Math.max(0, Math.min(1, (absLat - 66 + (n2 - 0.5) * 10) / 10));
        const elevation = Math.max(0, (n1 * 0.6 + n2 * 0.4 - 0.53) * 2.5);

        // Rich, dark forest base
        let r = 18 + n1 * 18;
        let g = 36 + n1 * 22;
        let b = 22 + n2 * 14;

        // Blend arid ochre
        r = r * (1 - aridity) + (140 + n2 * 20) * aridity;
        g = g * (1 - aridity) + (110 + n2 * 20) * aridity;
        b = b * (1 - aridity) + (70 + n2 * 15) * aridity;

        // Blend mountain rock
        if (elevation > 0.24) {
          const m = Math.min(1, (elevation - 0.24) * 1.6);
          r = r * (1 - m) + 90 * m;
          g = g * (1 - m) + 85 * m;
          b = b * (1 - m) + 80 * m;
        }

        // Blend polar ice
        r = r * (1 - polarIce) + 190 * polarIce;
        g = g * (1 - polarIce) + 195 * polarIce;
        b = b * (1 - polarIce) + 200 * polarIce;

        earthData[idx] = Math.min(255, Math.max(0, Math.round(r)));
        earthData[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
        earthData[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
        earthData[idx + 3] = 255; // Alpha 255 = Land (diffuse shading only)
      }
    }
  }

  return { width, height, earthData };
}

const VERTEX_SHADER_SRC = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

/* Crisp, Cloudless Earth Shader. No hazy outer atmospheric glow. */
const FRAGMENT_SHADER_SRC = `
  precision highp float;
  varying vec2 v_uv;

  uniform vec2 u_resolution;
  uniform float u_rotationLon;
  uniform float u_tiltLat;
  uniform sampler2D u_earthTex;

  const float PI = 3.14159265359;

  vec3 rotateX(vec3 p, float a) {
    float c = cos(a), s = sin(a);
    return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
  }

  vec3 rotateY(vec3 p, float a) {
    float c = cos(a), s = sin(a);
    return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  }

  vec2 sphereToEquirectUV(vec3 n) {
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float lon = atan(n.x, n.z);
    float u = lon / (2.0 * PI) + 0.5;
    float v = 0.5 - lat / PI;
    return vec2(fract(u), clamp(v, 0.001, 0.999));
  }

  void main() {
    vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
    vec2 p = (v_uv * 2.0 - 1.0) * aspect;

    float R = 0.86;
    float dist = length(p);

    if (dist > R) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
      return;
    }

    float z = sqrt(max(0.0, R * R - dot(p, p)));
    vec3 normal = normalize(vec3(p.x, p.y, z));

    vec3 geoPos = rotateX(normal, u_tiltLat);
    vec3 earthPos = rotateY(geoPos, -u_rotationLon);
    vec2 earthUV = sphereToEquirectUV(earthPos);

    vec4 earthSample = texture2D(u_earthTex, earthUV);
    float isLand = earthSample.a;
    vec3 albedo = earthSample.rgb;

    // Natural Sunlight & Crisp Terminator
    vec3 sunDir = normalize(vec3(-0.45, 0.55, 0.70));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);

    float nDotL = dot(normal, sunDir);
    float diffuse = smoothstep(-0.15, 0.85, nDotL);

    // Deep Ocean Specular Glint
    vec3 halfVec = normalize(sunDir + viewDir);
    float specRaw = max(dot(normal, halfVec), 0.0);
    float oceanSpec = pow(specRaw, 48.0) * 0.75 * (1.0 - isLand) * smoothstep(0.0, 0.4, nDotL);

    // Dark ambient shadow tint prevents total blackness while keeping contrast high
    vec3 ambient = vec3(0.015, 0.03, 0.08); 
    vec3 litSurface = mix(ambient, albedo * 1.1, diffuse) + vec3(0.7, 0.85, 1.0) * oceanSpec;

    // Tight Inner Rayleigh Atmospheric Rim (No Haze)
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
    vec3 atmoRim = vec3(0.12, 0.35, 0.75) * fresnel * smoothstep(-0.2, 0.5, nDotL) * 0.65;

    vec3 finalRgb = litSurface + atmoRim;

    // Anti-aliased edge and lower hemisphere fade for seamless background blending
    float edgeAA = smoothstep(R, R - 0.005, dist);
    float bottomFade = smoothstep(-0.85, -0.15, p.y);
    float alpha = edgeAA * (0.15 + 0.85 * bottomFade); // Retains subtle presence at the bottom

    gl_FragColor = vec4(finalRgb, alpha);
  }
`;

function project3DSpherePoint(latDeg, lonDeg, tiltRad, rotLonRad, radiusPx, cx, cy) {
  const lat = latDeg * DEG_TO_RAD;
  const lon = lonDeg * DEG_TO_RAD - rotLonRad;

  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  const x0 = cosLat * sinLon;
  const y0 = sinLat;
  const z0 = cosLat * cosLon;

  const cosTilt = Math.cos(-tiltRad);
  const sinTilt = Math.sin(-tiltRad);
  const y1 = y0 * cosTilt - z0 * sinTilt;
  const z1 = y0 * sinTilt + z0 * cosTilt;

  return {
    x: cx + x0 * radiusPx,
    y: cy - y1 * radiusPx,
    z: z1,
    visible: z1 > 0.08,
  };
}

export default function InteractiveEarthGlobe() {
  const wrapperRef = useRef(null);
  const glCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);

  const rotationLonRef = useRef(0.45);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const isInViewportRef = useRef(true);
  const projectedMarkersRef = useRef([]);

  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        isInViewportRef.current = entry.isIntersecting;
      },
      { threshold: 0.01 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const glCanvas = glCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!glCanvas || !overlayCanvas) return;

    const gl =
      glCanvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: false,
        antialias: true,
        powerPreference: 'low-power',
      }) || glCanvas.getContext('experimental-webgl');

    if (!gl) return;

    const compileShader = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
      return sh;
    };

    const vs = compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    const aPos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const { width: texW, height: texH, earthData } = buildCloudlessEarthTexture();

    gl.activeTexture(gl.TEXTURE0);
    const earthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, earthTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texW, texH, 0, gl.RGBA, gl.UNSIGNED_BYTE, earthData);

    const uRes = gl.getUniformLocation(program, 'u_resolution');
    const uRotLon = gl.getUniformLocation(program, 'u_rotationLon');
    const uTiltLat = gl.getUniformLocation(program, 'u_tiltLat');
    const uEarthTex = gl.getUniformLocation(program, 'u_earthTex');

    gl.uniform1i(uEarthTex, 0);

    let animFrameId = null;
    let satPhase = 0.6;
    const tiltRad = 15 * DEG_TO_RAD;
    let lastTimestamp = performance.now();

    const renderFrame = (now) => {
      if (!isInViewportRef.current || document.hidden) {
        lastTimestamp = now;
        animFrameId = requestAnimationFrame(renderFrame);
        return;
      }

      const dt = Math.min(0.1, Math.max(0, (now - lastTimestamp) / 1000));
      lastTimestamp = now;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = glCanvas.clientWidth;
      const cssH = glCanvas.clientHeight;
      const pixelW = Math.round(cssW * dpr);
      const pixelH = Math.round(cssH * dpr);

      if (glCanvas.width !== pixelW || glCanvas.height !== pixelH) {
        glCanvas.width = pixelW;
        glCanvas.height = pixelH;
        overlayCanvas.width = pixelW;
        overlayCanvas.height = pixelH;
        gl.viewport(0, 0, pixelW, pixelH);
      }

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.uniform2f(uRes, pixelW, pixelH);
      gl.uniform1f(uRotLon, rotationLonRef.current);
      gl.uniform1f(uTiltLat, tiltRad);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // 2D Overlay for Subtle Orbits and Restrained Markers
      const ctx = overlayCanvas.getContext('2d');
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, cssW, cssH);

      const cx = cssW / 2;
      const cy = cssH / 2;
      const sphereRadiusPx = (cssH * 0.5) * 0.86;

      const drawSubtleOrbit = (incDeg, nodeDeg, rMult, phaseOffset) => {
        const inc = incDeg * DEG_TO_RAD;
        const node = nodeDeg * DEG_TO_RAD;
        const orbitR = sphereRadiusPx * rMult;

        ctx.beginPath();
        let activeSegment = false;
        for (let deg = 0; deg <= 360; deg += 3) {
          const t = deg * DEG_TO_RAD;
          const ox = orbitR * Math.cos(t);
          const oy = orbitR * Math.sin(t) * Math.sin(inc);
          const oz = orbitR * Math.sin(t) * Math.cos(inc);

          const rx = ox * Math.cos(node) - oy * Math.sin(node);
          const ry = ox * Math.sin(node) + oy * Math.cos(node);
          const distFromCenter = Math.hypot(rx, ry);

          const visible = oz >= 0 || distFromCenter > sphereRadiusPx * 1.01;
          if (visible) {
            if (!activeSegment) {
              ctx.moveTo(cx + rx, cy - ry);
              activeSegment = true;
            } else {
              ctx.lineTo(cx + rx, cy - ry);
            }
          } else {
            activeSegment = false;
          }
        }
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.12)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        const st = satPhase + phaseOffset;
        const sox = orbitR * Math.cos(st);
        const soy = orbitR * Math.sin(st) * Math.sin(inc);
        const soz = orbitR * Math.sin(st) * Math.cos(inc);
        const srx = sox * Math.cos(node) - soy * Math.sin(node);
        const sry = sox * Math.sin(node) + soy * Math.cos(node);

        if (soz >= 0 || Math.hypot(srx, sry) > sphereRadiusPx * 1.01) {
          ctx.beginPath();
          ctx.arc(cx + srx, cy - sry, 1.8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(224, 242, 254, 0.7)';
          ctx.fill();
        }
      };

      drawSubtleOrbit(62, -24, 1.15, 0.2);
      drawSubtleOrbit(36, 29, 1.21, 2.8);

      const visibleNodes = [];
      INFRASTRUCTURE_NODES.forEach((node) => {
        const pt = project3DSpherePoint(
          node.lat,
          node.lon,
          tiltRad,
          rotationLonRef.current,
          sphereRadiusPx,
          cx,
          cy
        );
        if (pt.visible) {
          visibleNodes.push({ ...node, x: pt.x, y: pt.y, z: pt.z });
          const alpha = Math.min(1, (pt.z - 0.08) * 1.6);
          const glow = ctx.createRadialGradient(pt.x, pt.y, 0.5, pt.x, pt.y, 6.0);
          glow.addColorStop(0, `rgba(94, 234, 212, ${0.6 * alpha})`);
          glow.addColorStop(1, 'rgba(56, 189, 248, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 6.0, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 1.8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(240, 253, 250, ${0.9 * alpha})`;
          ctx.fill();
        }
      });
      projectedMarkersRef.current = visibleNodes;

      ctx.restore();

      if (!reducedMotion && !isDraggingRef.current) {
        rotationLonRef.current = (rotationLonRef.current + dt * ANGULAR_VELOCITY_RAD_PER_SEC) % (Math.PI * 2);
        satPhase = (satPhase + dt * 0.4) % (Math.PI * 2);
      }

      animFrameId = requestAnimationFrame(renderFrame);
    };

    animFrameId = requestAnimationFrame(renderFrame);

    return () => {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      gl.deleteTexture(earthTex);
      gl.deleteBuffer(quadBuffer);
      gl.deleteProgram(program);
    };
  }, [reducedMotion]);

  return (
    <div className="lp-earth-backdrop" ref={wrapperRef} aria-hidden="true">
      <div 
        className="lp-earth-backdrop__planet-wrap"
        onMouseDown={(e) => {
          isDraggingRef.current = true;
          dragStartXRef.current = e.clientX;
        }}
        onMouseUp={() => {
          isDraggingRef.current = false;
        }}
        onMouseLeave={() => {
          isDraggingRef.current = false;
        }}
        onMouseMove={(e) => {
          if (isDraggingRef.current) {
            const dx = e.clientX - dragStartXRef.current;
            dragStartXRef.current = e.clientX;
            rotationLonRef.current -= dx * 0.005;
          }
        }}
      >
        <canvas ref={glCanvasRef} className="lp-earth-backdrop__canvas lp-earth-backdrop__canvas--webgl" />
        <canvas ref={overlayCanvasRef} className="lp-earth-backdrop__canvas lp-earth-backdrop__canvas--overlay" />
      </div>
    </div>
  );
}