import { google } from "googleapis";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function getSheetData() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
    return [];
  }

  const credentials = JSON.parse(
    Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString()
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Raw Data!A:D",
  });
  const rows = response.data.values;
  if (!rows || rows.length < 2) return [];
  return rows.slice(1).map((row) => ({
    unique_key: row[0] || "",
    date: row[1] || "",
    insurer: row[2] || "",
    claims_count: parseInt(row[3]) || 0,
  }));
}

export async function GET() {
  try {
    const data = await getSheetData();
    return NextResponse.json(
      { success: true, data, count: data.length, updated_at: new Date().toISOString() },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" } }
    );
  } catch (error) {
    console.error("Google Sheets API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
