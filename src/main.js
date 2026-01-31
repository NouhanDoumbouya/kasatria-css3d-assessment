import "./style.css";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SPREADSHEET_ID = import.meta.env.VITE_SPREADSHEET_ID;
const RANGE = import.meta.env.VITE_SHEET_RANGE || "Sheet1!A1:F";

const statusEl = document.getElementById("status");
const signinBtn = document.getElementById("signin");

let accessToken = null;

boot();

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
        status(`Fetched ${rows.length} rows. Header: ${header.join(", ")}`);
        console.log("Header:", header);
        console.log("Rows:", rows);
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

function waitForGoogle() {
  return new Promise((resolve) => {
    const tick = () => {
      if (window.google?.accounts?.oauth2) resolve();
      else setTimeout(tick, 50);
    };
    tick();
  });
}

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