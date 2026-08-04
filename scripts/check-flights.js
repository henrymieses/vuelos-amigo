const fs = require('fs');

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DEST_EMAIL = process.env.DEST_EMAIL;
const FLIGHT_NUMBERS = process.env.FLIGHT_NUMBERS.split(',').map(s => s.trim());
const DATA_FILE = 'data/flights.json';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchFlight(flightNumber) {
  const date = todayISO();
  const res = await fetch(
    `https://aerodatabox.p.rapidapi.com/flights/number/${flightNumber}/${date}`,
    { headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com'
    }}
  );
  if (!res.ok) throw new Error(`API error ${res.status} para ${flightNumber}`);
  const arr = await res.json();
  return arr[0]; // primer resultado (ajusta si tu vuelo tiene varias etapas/codeshares)
}

async function sendDelayEmail(flightNumber, info) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'onboarding@resend.dev',
      to: [DEST_EMAIL],
      subject: `⚠️ Vuelo ${flightNumber} retrasado`,
      html: `<p>El vuelo <b>${flightNumber}</b> aparece como <b>${info.status}</b>.</p>
             <p>Programado: ${info.scheduledTime}<br>Estimado/Real: ${info.estimatedTime}</p>`
    })
  });
}

async function main() {
  const previous = fs.existsSync(DATA_FILE)
    ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
    : [];
  const previousByFlight = Object.fromEntries(previous.map(f => [f.flightNumber, f]));

  const results = [];
  for (const flightNumber of FLIGHT_NUMBERS) {
    try {
      const raw = await fetchFlight(flightNumber);
      // AJUSTA estos campos según lo que veas en la respuesta real
      // (pruébala primero en el "Test Endpoint" de RapidAPI).
      const status = raw.status || 'Unknown';
      const scheduledTime = raw.departure?.scheduledTime?.local || '-';
      const estimatedTime = raw.departure?.revisedTime?.local
        || raw.departure?.actualTime?.local || '-';

      const isDelayed = status === 'Delayed';
      const prev = previousByFlight[flightNumber];
      const alreadyNotified = prev?.notified && prev?.status === 'Delayed';

      if (isDelayed && !alreadyNotified) {
        await sendDelayEmail(flightNumber, { status, scheduledTime, estimatedTime });
      }

      results.push({
        flightNumber, status, scheduledTime, estimatedTime,
        notified: isDelayed,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error(`Error con ${flightNumber}:`, err.message);
      if (previousByFlight[flightNumber]) results.push(previousByFlight[flightNumber]);
    }
  }

  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(results, null, 2));
}

main();
