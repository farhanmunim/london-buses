/* OSGB36 British National Grid → WGS84, plus WKT parsing for the DfT feeds
 * (Street Manager, D-TRO) that publish geometry as EPSG:27700 easting/
 * northing. Inverse transverse Mercator on Airy 1830, then the standard
 * OSTN-less Helmert shift to WGS84 (~5 m accuracy — fine for showing works
 * and orders on a bus-route map). Extracted from drain-streetworks.js when
 * fetch-dtro.js became its second consumer. */

export function osgbToWgs84(E, N) {
  const a = 6377563.396, b = 6356256.909, F0 = 0.9996012717;
  const lat0 = 49 * Math.PI/180, lon0 = -2 * Math.PI/180, N0 = -100000, E0 = 400000;
  const e2 = 1 - (b*b)/(a*a), n = (a-b)/(a+b), n2 = n*n, n3 = n2*n;
  let lat = lat0, M = 0;
  do {
    lat = (N - N0 - M) / (a*F0) + lat;
    M = b*F0*((1 + n + 1.25*n2 + 1.25*n3) * (lat - lat0)
      - (3*n + 3*n2 + 2.625*n3) * Math.sin(lat - lat0) * Math.cos(lat + lat0)
      + (1.875*n2 + 1.875*n3) * Math.sin(2*(lat - lat0)) * Math.cos(2*(lat + lat0))
      - (35/24)*n3 * Math.sin(3*(lat - lat0)) * Math.cos(3*(lat + lat0)));
  } while (Math.abs(N - N0 - M) >= 1e-5);
  const sinL = Math.sin(lat), cosL = Math.cos(lat), tanL = Math.tan(lat);
  const nu = a*F0 / Math.sqrt(1 - e2*sinL*sinL);
  const rho = a*F0*(1 - e2) * Math.pow(1 - e2*sinL*sinL, -1.5);
  const eta2 = nu/rho - 1, t2 = tanL*tanL, t4 = t2*t2;
  const dE = E - E0, dE2 = dE*dE;
  const latOS = lat - (tanL/(2*rho*nu))*dE2
    + (tanL/(24*rho*nu**3))*(5 + 3*t2 + eta2 - 9*t2*eta2)*dE2*dE2
    - (tanL/(720*rho*nu**5))*(61 + 90*t2 + 45*t4)*dE2*dE2*dE2;
  const lonOS = lon0 + (dE/(cosL*nu))
    - (dE*dE2/(cosL*6*nu**3))*(nu/rho + 2*t2)
    + (dE*dE2*dE2/(cosL*120*nu**5))*(5 + 28*t2 + 24*t4);
  // Helmert OSGB36 → WGS84 via cartesian coordinates.
  const H = 0, sinP = Math.sin(latOS), cosP = Math.cos(latOS);
  const nu2 = a / Math.sqrt(1 - e2*sinP*sinP);
  let x = (nu2 + H)*cosP*Math.cos(lonOS), y = (nu2 + H)*cosP*Math.sin(lonOS), z = ((1 - e2)*nu2 + H)*sinP;
  const tx = 446.448, ty = -125.157, tz = 542.060, s = -20.4894e-6;
  const rx = 0.1502/3600*Math.PI/180, ry = 0.2470/3600*Math.PI/180, rz = 0.8421/3600*Math.PI/180;
  const x2 = tx + (1+s)*x - rz*y + ry*z, y2 = ty + rz*x + (1+s)*y - rx*z, z2 = tz - ry*x + rx*y + (1+s)*z;
  // Back to geodetic on WGS84.
  const aW = 6378137, e2W = 6.69437999014e-3;
  const p = Math.sqrt(x2*x2 + y2*y2);
  let phi = Math.atan2(z2, p*(1 - e2W)), phi0;
  do {
    phi0 = phi;
    const nuW = aW / Math.sqrt(1 - e2W*Math.sin(phi)*Math.sin(phi));
    phi = Math.atan2(z2 + e2W*nuW*Math.sin(phi), p);
  } while (Math.abs(phi - phi0) > 1e-11);
  return [Math.round(phi*180/Math.PI * 1e5)/1e5, Math.round(Math.atan2(y2, x2)*180/Math.PI * 1e5)/1e5];
}

// WKT in BNG (LINESTRING/POINT/POLYGON/MULTI*) → [[lat, lng], …], null when
// absent or empty. Vertices are capped so pathological polygons stay lean.
export function wktToCoords(wkt, cap = 60) {
  const nums = String(wkt ?? '').match(/-?\d+(\.\d+)?\s+-?\d+(\.\d+)?/g);
  if (!nums?.length) return null;
  const step = Math.max(1, Math.ceil(nums.length / cap));
  const out = [];
  for (let i = 0; i < nums.length; i += step) {
    const [E, N] = nums[i].trim().split(/\s+/).map(Number);
    out.push(osgbToWgs84(E, N));
  }
  const ok = out.filter(([la, ln]) => la > 49 && la < 59 && ln > -8 && ln < 2.5);   // GB-wide sanity bounds
  return ok.length ? ok : null;
}
