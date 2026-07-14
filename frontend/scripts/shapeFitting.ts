import * as THREE from 'three';

/**
 * Fits a freehand 3D stroke (points collected while dragging on a mesh surface)
 * to the closest of three idealized shapes: a straight line, a circle/ellipse, or a
 * rectangle — all lying within a single inferred plane.
 *
 * Pipeline:
 *   1. Fit the best plane through the stroke's points (PCA on the point
 *      covariance matrix), oriented using the averaged surface normals
 *      collected during raycasting as a sign hint.
 *   2. Project the 3D points into that plane's 2D coordinate system.
 *   3. Fit a line, an ellipse, and a rectangle to the 2D points independently.
 *   4. Analyze the stroke using the invariant Convex Hull Area ratio to robustly 
 *      distinguish sharp boxes from smooth eccentric ellipses.
 *   5. Score each fit by its RMS residual (normalized uniformly by the shape size).
 *   6. Apply dynamic penalties: penalize closed shapes if the stroke is open, and 
 *      penalize lines if the stroke curves/loops back on itself.
 *   7. Return the lowest-scoring shape, expressed back in 3D world space.
 */

export type ShapeType = 'line' | 'circle' | 'ellipse' | 'rectangle';

export interface FittedShape {
  type: ShapeType;
  /** The inferred plane the shape lies in. */
  plane: {
    center: [number, number, number];
    normal: [number, number, number];
  };
  /** Idealized points in 3D world space (for rendering / export). For a line
   *  this is [start, end]; for a circle/ellipse a sampled ring; for a
   *  rectangle the 4 corners with the first repeated to close the loop. */
  points: [number, number, number][];
  bounds: { min: [number, number, number]; max: [number, number, number] };
  line?: { start: [number, number, number]; end: [number, number, number]; length: number };
  /** Present when type === 'circle' (radiusX ~= radiusY). */
  circle?: { center: [number, number, number]; radius: number };
  /** Present when type === 'ellipse'. `rotation` is the in-plane angle (radians)
   *  of the major axis relative to the plane's u-axis. */
  ellipse?: {
    center: [number, number, number];
    radiusX: number; // semi-major
    radiusY: number; // semi-minor
    rotation: number;
  };
  rectangle?: {
    center: [number, number, number];
    width: number;
    height: number;
    corners: [number, number, number][];
  };
}

export type SketchData = FittedShape[];

const MIN_POINTS_FOR_CLOSED_SHAPE = 3;
const ELLIPSE_SAMPLES = 48;
// Flat multiplier buff for ellipses to ensure they win near-ties against rectangles
const ROUNDNESS_LENIENCY = 0.8;
// If the two semi-axes are within this ratio of each other, classify as
// 'circle' instead of 'ellipse'.
const CIRCLE_ASPECT_RATIO_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// Small linear algebra helpers
// ---------------------------------------------------------------------------

function eigenSymmetric3x3(m: number[][]): { values: number[]; vectors: THREE.Vector3[] } {
  const A = [m[0].slice(), m[1].slice(), m[2].slice()];
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  for (let iter = 0; iter < 60; iter++) {
    let p = 0, q = 1, max = Math.abs(A[0][1]);
    if (Math.abs(A[0][2]) > max) { max = Math.abs(A[0][2]); p = 0; q = 2; }
    if (Math.abs(A[1][2]) > max) { max = Math.abs(A[1][2]); p = 1; q = 2; }
    if (max < 1e-9) break;

    const app = A[p][p], aqq = A[q][q], apq = A[p][q];
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi), s = Math.sin(phi);

    A[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    A[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    A[p][q] = 0; A[q][p] = 0;

    for (let i = 0; i < 3; i++) {
      if (i !== p && i !== q) {
        const aip = A[i][p], aiq = A[i][q];
        A[i][p] = A[p][i] = c * aip - s * aiq;
        A[i][q] = A[q][i] = s * aip + c * aiq;
      }
    }
    for (let i = 0; i < 3; i++) {
      const vip = V[i][p], viq = V[i][q];
      V[i][p] = c * vip - s * viq;
      V[i][q] = s * vip + c * viq;
    }
  }

  const values = [A[0][0], A[1][1], A[2][2]];
  const order = [0, 1, 2].sort((a, b) => values[a] - values[b]);
  return {
    values: order.map(i => values[i]),
    vectors: order.map(i => new THREE.Vector3(V[0][i], V[1][i], V[2][i]).normalize())
  };
}

function fitPlane(points: THREE.Vector3[], hintNormal?: THREE.Vector3) {
  const centroid = new THREE.Vector3();
  points.forEach(p => centroid.add(p));
  centroid.divideScalar(points.length);

  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  points.forEach(p => {
    const d = p.clone().sub(centroid);
    cov[0][0] += d.x * d.x; cov[0][1] += d.x * d.y; cov[0][2] += d.x * d.z;
    cov[1][1] += d.y * d.y; cov[1][2] += d.y * d.z; cov[2][2] += d.z * d.z;
  });
  cov[1][0] = cov[0][1]; cov[2][0] = cov[0][2]; cov[2][1] = cov[1][2];

  const { vectors } = eigenSymmetric3x3(cov);
  let normal = vectors[0].clone();  
  const primaryInPlaneAxis = vectors[2].clone().normalize(); 

  const normalIsDegenerate = !isFinite(normal.length()) || normal.length() < 0.5;
  if (normalIsDegenerate) {
    normal = hintNormal && hintNormal.length() > 0.001
      ? hintNormal.clone().normalize()
      : new THREE.Vector3(0, 1, 0);
  }
  if (hintNormal && hintNormal.length() > 0.001 && normal.dot(hintNormal) < 0) {
    normal.negate();
  }

  let uAxis = primaryInPlaneAxis.clone()
    .sub(normal.clone().multiplyScalar(primaryInPlaneAxis.dot(normal)))
    .normalize();
  if (!isFinite(uAxis.length()) || uAxis.length() < 0.5) {
    uAxis = Math.abs(normal.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    uAxis.sub(normal.clone().multiplyScalar(uAxis.dot(normal))).normalize();
  }
  const vAxis = normal.clone().cross(uAxis).normalize();

  return { centroid, normal, uAxis, vAxis };
}

function to2D(p: THREE.Vector3, centroid: THREE.Vector3, uAxis: THREE.Vector3, vAxis: THREE.Vector3): THREE.Vector2 {
  const d = p.clone().sub(centroid);
  return new THREE.Vector2(d.dot(uAxis), d.dot(vAxis));
}

function to3D(p: THREE.Vector2, centroid: THREE.Vector3, uAxis: THREE.Vector3, vAxis: THREE.Vector3): THREE.Vector3 {
  return centroid.clone()
    .add(uAxis.clone().multiplyScalar(p.x))
    .add(vAxis.clone().multiplyScalar(p.y));
}

// ---------------------------------------------------------------------------
// Stroke analysis
// ---------------------------------------------------------------------------

function polygonArea(pts: THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(area / 2);
}

/**
 * Analyzes stroke to return a [0, 1] likelihood that it's a rectangle vs an ellipse.
 * Utilizes the invariant Convex Hull Area ratio: 
 * Ellipses inherently fill ~78.5% (PI/4) of their bounding box, regardless of eccentricity. 
 * Hand drawn rectangles usually hit ~90%+.
 */
function analyzeStrokeBoxiness(pts: THREE.Vector2[], rectFit: any): number {
  if (pts.length < 3 || !rectFit || rectFit.width * rectFit.height < 1e-6) return 0.5;

  const hull = convexHull2D(pts);
  const hullArea = polygonArea(hull);
  const rectArea = rectFit.width * rectFit.height;
  
  const fillRatio = hullArea / rectArea;
  
  // Requires fillRatio > 0.80 to even start penalizing the ellipse fit.
  return Math.max(0, Math.min(1, (fillRatio - 0.80) / (0.92 - 0.80)));
}

// ---------------------------------------------------------------------------
// Candidate shape fits, all performed in 2D plane coordinates
// ---------------------------------------------------------------------------

function fitLine2D(pts: THREE.Vector2[]) {
  const centroid = new THREE.Vector2();
  pts.forEach(p => centroid.add(p));
  centroid.divideScalar(pts.length);

  let sxx = 0, sxy = 0, syy = 0;
  pts.forEach(p => {
    const dx = p.x - centroid.x, dy = p.y - centroid.y;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  });
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dir = new THREE.Vector2(Math.cos(angle), Math.sin(angle));

  let minT = Infinity, maxT = -Infinity, residual = 0;
  pts.forEach(p => {
    const rel = p.clone().sub(centroid);
    const t = rel.dot(dir);
    const perp = rel.clone().sub(dir.clone().multiplyScalar(t));
    residual += perp.lengthSq();
    minT = Math.min(minT, t); maxT = Math.max(maxT, t);
  });

  const rms = Math.sqrt(residual / pts.length);
  const start = centroid.clone().add(dir.clone().multiplyScalar(minT));
  const end = centroid.clone().add(dir.clone().multiplyScalar(maxT));
  return { start, end, rms, length: maxT - minT };
}

function fitEllipse2D(pts: THREE.Vector2[]) {
  const centroid = new THREE.Vector2();
  pts.forEach(p => centroid.add(p));
  centroid.divideScalar(pts.length);

  let sxx = 0, sxy = 0, syy = 0;
  pts.forEach(p => {
    const dx = p.x - centroid.x, dy = p.y - centroid.y;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  });
  sxx /= pts.length; sxy /= pts.length; syy /= pts.length;

  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  const lambdaMajor = trace / 2 + disc;
  const lambdaMinor = Math.max(0, trace / 2 - disc);
  const rotation = 0.5 * Math.atan2(2 * sxy, sxx - syy);

  const a = Math.sqrt(2 * Math.max(0, lambdaMajor)); // semi-major
  const b = Math.sqrt(2 * Math.max(0, lambdaMinor)); // semi-minor

  const c = Math.cos(-rotation), s = Math.sin(-rotation);
  let residual = 0;
  pts.forEach(p => {
    const dx = p.x - centroid.x, dy = p.y - centroid.y;
    const rx = dx * c - dy * s;
    const ry = dx * s + dy * c;
    const xn = a > 1e-9 ? rx / a : 0;
    const yn = b > 1e-9 ? ry / b : 0;
    const rn = Math.hypot(xn, yn);
    
    let d = 0;
    if (rn > 1e-9) {
      // Geometric distance to the exact point on the ellipse along the center ray.
      // Vastly more accurate than algebraic distance for highly eccentric ellipses.
      d = Math.hypot(rx - rx / rn, ry - ry / rn);
    } else {
      d = Math.min(a, b);
    }
    residual += d * d;
  });
  
  return { center: centroid, a, b, rotation, rms: Math.sqrt(residual / pts.length) };
}

function fitRectangle2D(pts: THREE.Vector2[]) {
  const hull = convexHull2D(pts);
  let best = { angle: 0, area: Infinity, minU: 0, maxU: 0, minV: 0, maxV: 0 };

  if (hull.length < 3) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(p => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    best = { angle: 0, area: (maxX - minX) * (maxY - minY), minU: minX, maxU: maxX, minV: minY, maxV: maxY };
  } else {
    for (let i = 0; i < hull.length; i++) {
      const p1 = hull[i], p2 = hull[(i + 1) % hull.length];
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const c = Math.cos(-angle), s = Math.sin(-angle);
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      hull.forEach(p => {
        const u = p.x * c - p.y * s, v = p.x * s + p.y * c;
        minU = Math.min(minU, u); maxU = Math.max(maxU, u);
        minV = Math.min(minV, v); maxV = Math.max(maxV, v);
      });
      const area = (maxU - minU) * (maxV - minV);
      if (area < best.area) best = { angle, area, minU, maxU, minV, maxV };
    }
  }

  const c = Math.cos(best.angle), s = Math.sin(best.angle);
  const rot = (u: number, v: number) => new THREE.Vector2(u * c - v * s, u * s + v * c);
  const corners = [
    rot(best.minU, best.minV), rot(best.maxU, best.minV),
    rot(best.maxU, best.maxV), rot(best.minU, best.maxV)
  ];
  
  const width = best.maxU - best.minU;
  const height = best.maxV - best.minV;

  const cc = Math.cos(-best.angle), ss = Math.sin(-best.angle);
  let residual = 0;
  pts.forEach(p => {
    const u = p.x * cc - p.y * ss, v = p.x * ss + p.y * cc;
    const inside = u >= best.minU && u <= best.maxU && v >= best.minV && v <= best.maxV;
    const d = inside
      ? Math.min(Math.abs(u - best.minU), Math.abs(u - best.maxU), Math.abs(v - best.minV), Math.abs(v - best.maxV))
      : Math.hypot(Math.max(best.minU - u, 0, u - best.maxU), Math.max(best.minV - v, 0, v - best.maxV));
    residual += d * d;
  });

  const center = rot((best.minU + best.maxU) / 2, (best.minV + best.maxV) / 2);
  return { center, width, height, corners, rms: Math.sqrt(residual / pts.length) };
}

function convexHull2D(points: THREE.Vector2[]): THREE.Vector2[] {
  const pts = [...points].sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: THREE.Vector2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: THREE.Vector2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
}

function boundsOf(points: [number, number, number][]) {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  points.forEach(p => {
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
  });
  return { min, max };
}

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

export function fitStrokeToShape(rawPoints: THREE.Vector3[], rawNormals: THREE.Vector3[]): FittedShape | null {
  if (rawPoints.length < 2) return null;

  const hintNormal = new THREE.Vector3();
  rawNormals.forEach(n => hintNormal.add(n));
  if (rawNormals.length > 0) hintNormal.normalize();

  const { centroid, normal, uAxis, vAxis } = fitPlane(rawPoints, rawNormals.length ? hintNormal : undefined);
  const pts2D = rawPoints.map(p => to2D(p, centroid, uAxis, vAxis));

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  pts2D.forEach(p => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  });
  const size = Math.max(maxX - minX, maxY - minY, 1e-6);

  let pathLength = 0;
  for (let i = 1; i < pts2D.length; i++) pathLength += pts2D[i].distanceTo(pts2D[i - 1]);
  const endpointGap = pts2D[0].distanceTo(pts2D[pts2D.length - 1]);
  const closedness = pathLength > 1e-6 ? 1 - Math.min(1, endpointGap / pathLength) : 0;
  
  // Penalize circle/rectangle if the stroke is just an open curve
  const openPenalty = (1 - closedness) * 0.8; 
  // Conversely, penalize lines if the stroke loops or curves back on itself (avoids flat eccentric loops defaulting to lines)
  const linePenalty = closedness * 0.8;

  const lineFit = fitLine2D(pts2D);
  const lineScore = (lineFit.rms / size) + linePenalty;

  let ellipseScore = Infinity, ellipseFit: ReturnType<typeof fitEllipse2D> | null = null;
  let rectScore = Infinity, rectFit: ReturnType<typeof fitRectangle2D> | null = null;
  
  if (rawPoints.length >= MIN_POINTS_FOR_CLOSED_SHAPE) {
    ellipseFit = fitEllipse2D(pts2D);
    rectFit = fitRectangle2D(pts2D);
    
    const rectLikelihood = analyzeStrokeBoxiness(pts2D, rectFit);
    
    // Scale shape penalties dynamically based purely on hull geometric volume
    const ellipseMultiplier = 0.5 + (rectLikelihood * 2.0);
    const rectMultiplier = 0.5 + ((1.0 - rectLikelihood) * 2.0);
    
    // Using `size` identically across all shapes ensures uniform scale normalization
    ellipseScore = (ellipseFit.rms / size) * ROUNDNESS_LENIENCY * ellipseMultiplier + openPenalty;
    rectScore = (rectFit.rms / size) * rectMultiplier + openPenalty;
  }

  let type: ShapeType = 'line';
  if (ellipseScore <= lineScore && ellipseScore <= rectScore) {
    if (ellipseFit) {
      const minRadius = Math.min(ellipseFit.a, ellipseFit.b);
      const maxRadius = Math.max(ellipseFit.a, ellipseFit.b);
      type = (minRadius / maxRadius >= CIRCLE_ASPECT_RATIO_THRESHOLD) ? 'circle' : 'ellipse';
    }
  }
  else if (rectScore <= lineScore && rectScore <= ellipseScore) {
    type = 'rectangle';
  }

  const plane = {
    center: centroid.toArray() as [number, number, number],
    normal: normal.toArray() as [number, number, number]
  };

  if ((type === 'circle' || type === 'ellipse') && ellipseFit) {
    const points: [number, number, number][] = [];
    const isCircle = type === 'circle';
    
    const radiusX = isCircle ? (ellipseFit.a + ellipseFit.b) / 2 : ellipseFit.a;
    const radiusY = isCircle ? (ellipseFit.a + ellipseFit.b) / 2 : ellipseFit.b;

    for (let i = 0; i <= ELLIPSE_SAMPLES; i++) {
      const t = (i / ELLIPSE_SAMPLES) * Math.PI * 2;
      const ex = Math.cos(t) * radiusX;
      const ey = Math.sin(t) * radiusY;
      
      const c = Math.cos(ellipseFit.rotation);
      const s = Math.sin(ellipseFit.rotation);
      const rx = ex * c - ey * s;
      const ry = ex * s + ey * c;
      
      const p2 = new THREE.Vector2(ellipseFit.center.x + rx, ellipseFit.center.y + ry);
      points.push(to3D(p2, centroid, uAxis, vAxis).toArray() as [number, number, number]);
    }
    
    const center3D = to3D(ellipseFit.center, centroid, uAxis, vAxis).toArray() as [number, number, number];
    
    if (isCircle) {
      return { type, plane, points, bounds: boundsOf(points), circle: { center: center3D, radius: radiusX } };
    } else {
      return { type, plane, points, bounds: boundsOf(points), ellipse: { center: center3D, radiusX, radiusY, rotation: ellipseFit.rotation } };
    }
  }

  if (type === 'rectangle' && rectFit) {
    const corners = rectFit.corners.map(c => to3D(c, centroid, uAxis, vAxis).toArray() as [number, number, number]);
    const points = [...corners, corners[0]];
    return {
      type, plane, points, bounds: boundsOf(points),
      rectangle: {
        center: to3D(rectFit.center, centroid, uAxis, vAxis).toArray() as [number, number, number],
        width: rectFit.width, height: rectFit.height, corners
      }
    };
  }

  // Fallback to line
  const start = to3D(lineFit.start, centroid, uAxis, vAxis).toArray() as [number, number, number];
  const end = to3D(lineFit.end, centroid, uAxis, vAxis).toArray() as [number, number, number];
  const points = [start, end];
  return { type: 'line', plane, points, bounds: boundsOf(points), line: { start, end, length: lineFit.length } };
}