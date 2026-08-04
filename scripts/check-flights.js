const fs = require('fs');

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DEST_EMAILS = process.env.DEST_EMAIL.split(',').map(s => s.trim());
const FLIGHT_NUMBERS = process.env.FLIGHT_NUMBERS.split(',').map(s => s.trim());
const TEST_MODE = process.env.TEST_MODE === 'true';
const DATA_FILE = 'data/flights.json';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  const text = await res.text();
  if (!res.ok) throw new Error(`API error ${res.status} para ${flightNumber}: ${text.slice(0, 200)}`);
  if (!text) throw new Error(`Respuesta vacia de la API para ${flightNumber}`);
  const arr = JSON.parse(text);
  return arr[0]; // primer resultado (ajusta si tu vuelo tiene varias etapas/codeshares)
}

async function sendDelayEmail(flightNumber, info, isTest = false) {
  const notaPrueba = isTest
    ? '<p style="color:#888"><i>Nota: este es un correo de PRUEBA generado manualmente para confirmar que el envio funciona. No corresponde a un vuelo real.</i></p>'
    : '';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'onboarding@resend.dev',
      to: DEST_EMAILS,
      subject: `${isTest ? '[PRUEBA] ' : ''}⚠️ Vuelo ${flightNumber} retrasado`,
      html: `<p>El vuelo <b>${flightNumber}</b> aparece como <b>${info.status}</b>.</p>
             <p>Programado: ${info.scheduledTime}<br>Estimado/Real: ${info.estimatedTime}</p>
             ${notaPrueba}`
    })
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`Resend error ${res.status} enviando correo de ${flightNumber}: ${body}`);
  } else {
    console.log(`Correo enviado para ${flightNumber} a [${DEST_EMAILS.join(', ')}]: ${body}`);
  }
}

async function main() {
  if (TEST_MODE) {
    console.log('TEST_MODE activo: enviando correo de prueba...');
    await sendDelayEmail('TEST-999', {
      status: 'Delayed',
      scheduledTime: '00:00 (prueba)',
      estimatedTime: '00:30 (prueba)'
    }, true);
    console.log('Correo de prueba enviado.');
  }

  const previous = fs.existsSync(DATA_FILE)
    ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
    : [];
  const previousByFlight = Object.fromEntries(previous.map(f => [f.flightNumber, f]));

  const results = [];
  for (const flightNumber of FLIGHT_NUMBERS) {
    await sleep(1500); // evita el limite de 1 solicitud/segundo del plan free
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
