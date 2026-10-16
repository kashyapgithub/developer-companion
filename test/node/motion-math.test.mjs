/** motion-math.test.mjs — camera, plane drawing, curve simplify/smooth/resample and the CSS the agent receives. */
import { createCamera, project, rayAt, orbit, zoom, basis } from "../../motion/modules/camera.js";
import { hitPlane, planeOrigin } from "../../motion/modules/plane-hit.js";
import { simplify, smooth, resample, pathLength, bounds, createCurve, PALETTE } from "../../motion/modules/curve-model.js";
import { describeMove, keyframesFor, buildMotionDoc, slug } from "../../motion/modules/curve-css.js";
import { v3, dist } from "../../motion/modules/vec3.js";
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);
const W = 800, H = 600;
const near = (a, b, e = 0.5) => Math.abs(a - b) <= e;

// camera: a point at the target is in the middle of the screen
const cam = createCamera({ yaw: 0, pitch: 0, distance: 1000 });
const mid = project(cam, v3(0, 0, 0), W, H);
t("the target projects to the screen centre", near(mid.x, W / 2) && near(mid.y, H / 2));
t("+x is to the right, +y is DOWN (CSS)", project(cam, v3(100, 0, 0), W, H).x > W / 2 && project(cam, v3(0, 100, 0), W, H).y > H / 2);
t("+z (toward the viewer) looks bigger", project(cam, v3(0, 100, 300), W, H).k > project(cam, v3(0, 100, 0), W, H).k);
t("a point behind the camera is not drawn", project(cam, v3(0, 0, 5000), W, H) === null);

// orbit / zoom limits
const c2 = createCamera(); orbit(c2, 0, 100000); zoom(c2, -1e9); zoom(c2, 1e9);
t("pitch and distance stay in range", c2.pitch <= 1.45 && c2.distance <= 4000 && c2.distance >= 250);
const c3 = createCamera({ yaw: 0.2 }); orbit(c3, 100, 0);
t("dragging right turns the scene", c3.yaw < 0.2);

// rays: unproject then project returns the same pixel
const c4 = createCamera({ yaw: -0.6, pitch: 0.4, distance: 1100 });
let ok = true;
for (const [sx, sy] of [[100, 120], [400, 300], [700, 500]]) {
  const ray = rayAt(c4, sx, sy, W, H);
  const hit = hitPlane(ray, "front", planeOrigin("front", 80));
  const back = hit && project(c4, hit, W, H);
  ok = ok && hit && near(hit.z, 80, 0.01) && near(back.x, sx, 0.6) && near(back.y, sy, 0.6);
}
t("clicking a pixel on the front plane and projecting back gives the same pixel", ok);
const floor = hitPlane(rayAt(c4, 400, 450, W, H), "floor", planeOrigin("floor", 100));
t("the floor plane is hit at the chosen y", floor && near(floor.y, 100, 0.01));
const side = hitPlane(rayAt(c4, 400, 300, W, H), "side", planeOrigin("side", -50));
t("the side plane is hit at the chosen x", side && near(side.x, -50, 0.01));
t("a ray parallel to the plane misses", hitPlane({ origin: v3(0, 0, 500), dir: v3(1, 0, 0) }, "front", v3(0, 0, 0)) === null);
t("a plane behind the camera is not hit", hitPlane({ origin: v3(0, 0, 500), dir: v3(0, 0, 1) }, "front", v3(0, 0, 0)) === null);

// curves
const straight = Array.from({ length: 50 }, (_, i) => v3(i * 4, i * 2, 0));
t("a straight stroke simplifies to its two ends", simplify(straight, 2).length === 2);
const bent = [...Array.from({ length: 20 }, (_, i) => v3(i * 10, 0, 0)), ...Array.from({ length: 20 }, (_, i) => v3(190, i * 10, 0))];
t("a bend keeps its corner", simplify(bent, 3).length === 3);
const sm = smooth([v3(0, 0, 0), v3(100, 50, 20), v3(200, 0, 40)], 10);
t("the spline passes through the control points", dist(sm[0], v3(0, 0, 0)) < 1e-6 && dist(sm[10], v3(100, 50, 20)) < 1e-6 && dist(sm.at(-1), v3(200, 0, 40)) < 1e-6);
const rs = resample(sm, 9), gaps = rs.slice(1).map((p, i) => dist(rs[i], p));
t("resampling spaces points evenly along the path", Math.max(...gaps) - Math.min(...gaps) < 3, gaps.map((g) => g.toFixed(1)).join(","));
t("path length and bounds", near(pathLength([v3(0, 0, 0), v3(3, 4, 0)]), 5, 1e-9) && bounds(sm).size.x >= 199);

// colours + labels
const cs = []; for (let i = 0; i < 5; i++) cs.push(createCurve(cs));
t("each new curve gets a different colour and a label", new Set(cs.map((c) => c.color)).size === 5 && cs[2].label === "Curve 3" && PALETTE.length === 8);

// CSS
const curve = createCurve([], { label: "Card slide-in!", target: ".card", durationMs: 600, easing: "ease-out", points: [v3(0, 0, 0), v3(100, -40, 200), v3(220, -40, 400)] });
const kf = keyframesFor(curve, "motion-card");
t("keyframes start at zero and end at the full move", /0% \{ transform: translate3d\(0px, 0px, 0px\)/.test(kf.keyframes) && /100% \{ transform: translate3d\(220px, -40px, 400px\)/.test(kf.keyframes));
t("the animation rule carries duration and easing", kf.rule === "animation: motion-card 600ms ease-out 1 both;");
t("words describe the move", describeMove(v3(120, -40, 200)) === "right 120px, up 40px, toward the viewer 200px" && /no net movement/.test(describeMove(v3(1, 1, 1))));
const doc = buildMotionDoc({ curves: [curve, { ...createCurve([curve]), points: [v3(0, 0, 0)] }, { ...curve, visible: false }], perspective: 800, stage: { w: 320, h: 200 }, notes: "Smooth." });
t("the document lists only drawn, visible curves", doc.curves.length === 1 && doc.curves[0].animationName === "motion-card-slide-in");
t("the document explains its coordinates and perspective", /y DOWN/.test(doc.coordinates) && doc.perspective === "800px" && /perspective: 800px/.test(doc.usage));
t("slug is css-safe", slug("My Curve!!", "x") === "my-curve" && slug("???", "curve-1") === "curve-1");
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
