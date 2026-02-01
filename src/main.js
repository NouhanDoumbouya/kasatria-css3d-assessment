import "./style.css";

import * as THREE from "three";
import { CSS3DRenderer, CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import TWEEN from "three/examples/jsm/libs/tween.module.js";
import { el, append } from "./ui.js";

// Google OAuth + Sheets configuration (provided via Vite env).
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SPREADSHEET_ID = import.meta.env.VITE_SPREADSHEET_ID;
const RANGE = import.meta.env.VITE_SHEET_RANGE || "Sheet1!A1:Z";

const CONFIG = {
  cameraZ: 2600,
  table: { columns: 20, rows: 10, spacingX: 140, spacingY: 180 },
  sphere: { radius: 900 },
  helix: { radius: 1000, separation: 28, angleStep: 0.4 },
  grid: { x: 5, y: 4, z: 10, spacing: 320 },
  netWorth: { low: 100_000, high: 200_000 },
};

const MAX_RECORDS = CONFIG.table.columns * CONFIG.table.rows;

const statusEl = document.getElementById("status");
const signinBtn = document.getElementById("signin");
const authOverlay = document.getElementById("authOverlay");
const menuEl = document.getElementById("menu");
const container = document.getElementById("container");

let accessToken = null;
let scene;
let camera;
let renderer;
let controls;
let animationId;

const objects = [];
const targets = {
  table: [],
  sphere: [],
  helix: [],
  grid: [],
};

boot();

// Entry point: wait for Google SDK, then bind the OAuth flow.
async function boot() {
  status("Waiting for Google script…");
  await waitForGoogle();

  if (!CLIENT_ID) return status("Missing VITE_GOOGLE_CLIENT_ID in .env");
  if (!SPREADSHEET_ID) return status("Missing VITE_SPREADSHEET_ID in .env");

  const tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    callback: async (resp) => {
      accessToken = resp.access_token;
      status("Token received. Fetching sheet…");
      try {
        const { header, rows } = await fetchSheet();
        const records = normalizeRows(header, rows);
        if (records.length < MAX_RECORDS) {
          status(`Fetched ${records.length} rows. Need ${MAX_RECORDS} to fill 20x10/5x4x10.`);
        } else {
          status(`Fetched ${records.length} rows.`);
        }
        initScene(records.slice(0, MAX_RECORDS));
        authOverlay.classList.add("hidden");
        menuEl.style.display = "flex";
      } catch (e) {
        console.error(e);
        status(`Error: ${e.message}`);
      }
    },
  });

  signinBtn.addEventListener("click", () => {
    status("Signing in…");
    tokenClient.requestAccessToken({ prompt: "consent" });
  });

  status("Signed out");
}

function status(msg) {
  statusEl.textContent = msg;
}

// Poll for the Google Identity Services SDK to load.
function waitForGoogle() {
  return new Promise((resolve) => {
    const tick = () => {
      if (window.google?.accounts?.oauth2) resolve();
      else setTimeout(tick, 50);
    };
    tick();
  });
}

// Read the sheet values using the OAuth access token.
async function fetchSheet() {
  if (!accessToken) throw new Error("No access token");

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/` +
    encodeURIComponent(RANGE);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || JSON.stringify(err);
    throw new Error(`Sheets API error ${res.status}: ${msg}`);
  }

  const json = await res.json();
  const [header, ...rows] = json.values ?? [];

  if (!header?.length) throw new Error("No header row found in sheet");

  return { header, rows };
}

// Map arbitrary header names to our expected fields.
function normalizeRows(header, rows) {
  const keys = header.map((cell) => cell.trim());
  const indexFor = (candidates) =>
    keys.findIndex((key) =>
      candidates.some((candidate) => normalizeKey(key).includes(normalizeKey(candidate)))
    );

  const idxName = indexFor(["name", "full name", "person"]);
  const idxPhoto = indexFor(["photo", "image", "avatar"]);
  const idxAge = indexFor(["age"]);
  const idxCountry = indexFor(["country", "nation", "location"]);
  const idxInterest = indexFor(["interest", "hobby", "hobbies"]);
  const idxWorth = indexFor(["net worth", "networth", "worth", "wealth"]);

  warnOnMissingColumns({
    Name: idxName,
    Photo: idxPhoto,
    Age: idxAge,
    Country: idxCountry,
    Interest: idxInterest,
    "Net Worth": idxWorth,
  });

  return rows
    .filter((row) => row.some((cell) => String(cell || "").trim() !== ""))
    .map((row, index) => {
      const rawWorth = idxWorth >= 0 ? row[idxWorth] : "";
      return {
        name: (idxName >= 0 ? row[idxName] : "") || `Person ${index + 1}`,
        photo: (idxPhoto >= 0 ? row[idxPhoto] : "") || "",
        age: (idxAge >= 0 ? row[idxAge] : "") || "",
        country: (idxCountry >= 0 ? row[idxCountry] : "") || "",
        interest: (idxInterest >= 0 ? row[idxInterest] : "") || "",
        netWorthRaw: rawWorth || "",
        netWorthValue: parseNetWorth(rawWorth),
      };
    });
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function warnOnMissingColumns(indexes) {
  const missing = Object.entries(indexes)
    .filter(([, idx]) => idx < 0)
    .map(([label]) => label);
  if (missing.length) {
    console.warn(`Missing expected columns: ${missing.join(", ")}`);
  }
}

function isValidUrl(value) {
  if (!value) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// Accepts values like "$251,260.80", "100K", or "0.2M".
function parseNetWorth(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const cleaned = raw.toUpperCase().replace(/\$/g, "").replace(/USD/g, "").trim();
  const match = cleaned.match(/(-?[\d,.]+)\s*([KMB])?/);
  if (!match) return null;

  const number = parseFloat(match[1].replace(/,/g, ""));
  if (Number.isNaN(number)) return null;

  const suffix = match[2] || "";
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
  return number * multiplier;
}

// Initialize Three.js scene, renderer, and controls.
function initScene(records) {
  cleanupScene();

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 1, 10000);
  camera.position.z = CONFIG.cameraZ;

  renderer = new CSS3DRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  controls = new TrackballControls(camera, renderer.domElement);
  controls.rotateSpeed = 0.8;
  controls.minDistance = 500;
  controls.maxDistance = 6000;
  controls.addEventListener("change", render);

  buildObjects(records);
  buildTargets(records.length);
  setMenuHandlers();
  transform(targets.table, 2000);

  window.addEventListener("resize", onWindowResize);
  animate();
}

// Remove existing renderer/controls when re-initializing.
function cleanupScene() {
  if (animationId) cancelAnimationFrame(animationId);
  if (controls) controls.dispose();
  if (renderer?.domElement && renderer.domElement.parentElement) {
    renderer.domElement.parentElement.removeChild(renderer.domElement);
  }

  objects.length = 0;
  targets.table.length = 0;
  targets.sphere.length = 0;
  targets.helix.length = 0;
  targets.grid.length = 0;
}

// Create the CSS3D tiles from sheet records.
function buildObjects(records) {
  records.forEach((record, i) => {
    const element = el("div", "element");

    const worthClass = getWorthClass(record.netWorthValue);
    element.classList.add(worthClass);

    const header = el("div", "header");

    const country = el("div", "country", record.country || "");

    const age = el("div", "age", record.age || "");

    append(header, country, age);

    const photo = el("div", "photo");
    if (isValidUrl(record.photo)) {
      const img = el("img");
      img.src = record.photo;
      img.alt = record.name;
      img.loading = "lazy";
      photo.appendChild(img);
    } else {
      photo.textContent = "No Photo";
    }

    const interest = el("div", "role", record.interest || "");

    const footer = el("div", "footer");
    const name = el("div", "name", record.name);
    append(footer, name, interest);

    append(element, header, photo, footer);

    const object = new CSS3DObject(element);
    object.position.x = Math.random() * 4000 - 2000;
    object.position.y = Math.random() * 4000 - 2000;
    object.position.z = Math.random() * 4000 - 2000;

    scene.add(object);
    objects.push(object);
  });
}

// Net worth color buckets (used only for tile background).
function getWorthClass(netWorthValue) {
  if (netWorthValue == null) return "worth-unknown";
  if (netWorthValue < CONFIG.netWorth.low) return "worth-low";
  if (netWorthValue < CONFIG.netWorth.high) return "worth-mid";
  return "worth-high";
}

// Build all layout targets for the current record count.
function buildTargets(count) {
  buildTableTargets(count);
  buildSphereTargets(count);
  buildHelixTargets(count);
  buildGridTargets(count);
}

// Table layout: fixed 20x10 grid.
function buildTableTargets(count) {
  const { columns, rows, spacingX, spacingY } = CONFIG.table;
  const offsetX = (columns - 1) * spacingX * 0.5;
  const offsetY = (rows - 1) * spacingY * 0.5;

  for (let i = 0; i < count; i += 1) {
    const object = new THREE.Object3D();
    const col = i % columns;
    const row = Math.floor(i / columns);
    object.position.x = col * spacingX - offsetX;
    object.position.y = -(row * spacingY - offsetY);
    object.position.z = 0;
    targets.table.push(object);
  }
}

// Sphere layout based on a golden spiral distribution.
function buildSphereTargets(count) {
  const { radius } = CONFIG.sphere;

  for (let i = 0; i < count; i += 1) {
    const phi = Math.acos(-1 + (2 * i) / count);
    const theta = Math.sqrt(count * Math.PI) * phi;

    const object = new THREE.Object3D();
    object.position.x = radius * Math.cos(theta) * Math.sin(phi);
    object.position.y = radius * Math.sin(theta) * Math.sin(phi);
    object.position.z = radius * Math.cos(phi);

    const vector = object.position.clone().multiplyScalar(2);
    object.lookAt(vector);

    targets.sphere.push(object);
  }
}

// Double helix layout (two alternating strands).
function buildHelixTargets(count) {
  const { radius, separation, angleStep } = CONFIG.helix;

  for (let i = 0; i < count; i += 1) {
    const strand = i % 2;
    const angle = i * angleStep + (strand === 0 ? 0 : Math.PI);
    const object = new THREE.Object3D();

    object.position.x = radius * Math.sin(angle);
    object.position.y = -(i * separation) + count * separation * 0.5;
    object.position.z = radius * Math.cos(angle);

    const lookAt = new THREE.Vector3(object.position.x * 2, object.position.y, object.position.z * 2);
    object.lookAt(lookAt);

    targets.helix.push(object);
  }
}

// Grid layout: 5x4x10.
function buildGridTargets(count) {
  const { x: gridX, y: gridY, z: gridZ, spacing } = CONFIG.grid;

  for (let i = 0; i < count; i += 1) {
    const object = new THREE.Object3D();
    const x = i % gridX;
    const y = Math.floor(i / gridX) % gridY;
    const z = Math.floor(i / (gridX * gridY)) % gridZ;

    object.position.x = (x - (gridX - 1) / 2) * spacing;
    object.position.y = (-(y - (gridY - 1) / 2)) * spacing;
    object.position.z = (z - (gridZ - 1) / 2) * spacing;

    targets.grid.push(object);
  }
}

// Menu buttons drive the transform animations.
function setMenuHandlers() {
  const tableBtn = document.getElementById("table");
  const sphereBtn = document.getElementById("sphere");
  const helixBtn = document.getElementById("helix");
  const gridBtn = document.getElementById("grid");

  tableBtn.addEventListener("click", () => transform(targets.table, 2000));
  sphereBtn.addEventListener("click", () => transform(targets.sphere, 2000));
  helixBtn.addEventListener("click", () => transform(targets.helix, 2000));
  gridBtn.addEventListener("click", () => transform(targets.grid, 2000));
}

// Tween from current positions to target layout.
function transform(targetsList, duration) {
  TWEEN.removeAll();

  objects.forEach((object, i) => {
    const target = targetsList[i % targetsList.length];

    new TWEEN.Tween(object.position)
      .to(
        { x: target.position.x, y: target.position.y, z: target.position.z },
        duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start();

    new TWEEN.Tween(object.rotation)
      .to(
        { x: target.rotation.x, y: target.rotation.y, z: target.rotation.z },
        duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start();
  });

  new TWEEN.Tween(this)
    .to({}, duration)
    .onUpdate(render)
    .start();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
  render();
}

// Main loop: update tween + controls, then render.
function animate() {
  animationId = requestAnimationFrame(animate);
  TWEEN.update();
  controls.update();
  render();
}

function render() {
  renderer.render(scene, camera);
}
