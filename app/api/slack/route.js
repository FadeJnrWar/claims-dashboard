import { NextResponse } from "next/server";

const WEBHOOKS = {
  "#health-ops": process.env.SLACK_WEBHOOK_HEALTHOPS,
  "#customer-success": process.env.SLACK_WEBHOOK_CS,
};

export async function GET() {
  const channels = Object.keys(WEBHOOKS).filter(ch => !!WEBHOOKS[ch]);
  return NextResponse.json({ channels });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { channels, message, blocks } = body;

    if (!channels || !channels.length) {
      return NextResponse.json({ success: false, error: "No channels selected" }, { status: 400 });
    }

    const results = [];
    for (const channel of channels) {
      const webhookUrl = WEBHOOKS[channel];
      if (!webhookUrl) {
        results.push({ channel, success: false, error: "Webhook not configured" });
        continue;
      }
      try {
        const payload = blocks ? { blocks, text: message } : { text: message };
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          results.push({ channel, success: true });
        } else {
          const errText = await res.text();
          results.push({ channel, success: false, error: errText });
        }
      } catch (e) {
        results.push({ channel, success: false, error: e.message });
      }
    }

    return NextResponse.json({ success: results.every(r => r.success), results });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
