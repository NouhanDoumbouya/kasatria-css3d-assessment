# kasatria-css3d-assessment

CSS3D periodic-table style visualization driven by Google Sheets data, built for the Kasatria assessment.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a Google Cloud Project with OAuth consent + Web Client ID.
3. Create a Google Sheet using the provided CSV and share it with `lisa@kasatria.com`.
4. Add a `.env` file in the project root:
   ```bash
   VITE_GOOGLE_CLIENT_ID=your_oauth_client_id
   VITE_SPREADSHEET_ID=your_sheet_id
   VITE_SHEET_RANGE=Sheet1!A1:Z
   ```
5. Run the app:
   ```bash
   npm run dev
   ```

## Behavior

- Uses Google OAuth to read the sheet via the Sheets API.
- Renders 200 tiles (20x10) and supports Table, Sphere, Helix (double), and Grid (5x4x10) layouts.
- Net worth is encoded only by tile color (red < $100K, orange $100K–$200K, green > $200K).

## Notes

- If fewer than 200 rows are present in the sheet, the scene still loads but with fewer tiles.
- Invalid or missing photo URLs fall back to a “No Photo” placeholder.

## Deploy (Vercel)

1. Import the repo into Vercel.
2. Set framework to **Vite**.
3. Build Command: `npm run build`
4. Output Directory: `dist`
5. Add Environment Variables:
   - `VITE_GOOGLE_CLIENT_ID`
   - `VITE_SPREADSHEET_ID`
   - `VITE_SHEET_RANGE` (optional; default `Sheet1!A1:Z`)
6. Deploy.
