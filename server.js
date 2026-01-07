import express from 'express';
import pg from 'pg';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Webhook URLs - CORRECTED
const WEBHOOK_INVITE = 'https://n8n.jane.iternative.com/webhook/14f1dc78-d1ca-4540-a7d9-05a500be7bceCTO_Lunch_INVITE';
const WEBHOOK_MESSAGE = 'https://n8n.jane.iternative.com/webhook/14f1dc78-d1ca-4540-a7d9-05a500be7bceCTO_CONTACT_ORGANIZER';
const WEBHOOK_RSVP_LIST = 'https://n8n.jane.iternative.com/webhook/3a335e73-c12b-4225-9f92-bcbec9b32445_CURRENT_RSVP_LIST';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@db:5432/rnrsvp'
});

// Helper function to send webhooks
async function sendWebhook(url, data) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    console.log(`Webhook sent to ${url}: ${response.status}`);
    return response.ok;
  } catch (err) {
    console.error(`Webhook error: ${err.message}`);
    return false;
  }
}

// Helper function to get second Wednesday of a month
function getSecondWednesday(year, month) {
  const date = new Date(year, month, 1);
  let count = 0;
  while (count < 2) {
    if (date.getDay() === 3) count++;
    if (count < 2) date.setDate(date.getDate() + 1);
  }
  return date;
}

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        location_name VARCHAR(255) DEFAULT 'TBD',
        location_address VARCHAR(255) DEFAULT 'TBD',
        meeting_time VARCHAR(100) DEFAULT '12:00 PM',
        organizer_email VARCHAR(255) DEFAULT 'organizer@example.com'
      );
      CREATE TABLE IF NOT EXISTS participants (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(50),
        invited_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS rsvps (
        id SERIAL PRIMARY KEY,
        participant_id INTEGER REFERENCES participants(id) ON DELETE CASCADE,
        event_date DATE NOT NULL,
        status VARCHAR(20) DEFAULT 'maybe',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(participant_id, event_date)
      );
      CREATE TABLE IF NOT EXISTS agendas (
        id SERIAL PRIMARY KEY,
        event_date DATE NOT NULL,
        item TEXT NOT NULL,
        proposed_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_name VARCHAR(255),
        sender_email VARCHAR(255),
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO settings (location_name, location_address, meeting_time, organizer_email)
      SELECT 'TBD', 'TBD', '12:00 PM', 'organizer@example.com'
      WHERE NOT EXISTS (SELECT 1 FROM settings);
    `);
    console.log('Database initialized successfully');
  } finally {
    client.release();
  }
}

async function startWithRetry() {
  const maxRetries = 30;
  for (let i = 0; i < maxRetries; i++) {
    try {
      await initDB();
      const PORT = process.env.PORT || 3000;
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`RNRSVP server running on port ${PORT}`);
      });
      return;
    } catch (err) {
      console.log(`DB connection attempt ${i + 1}/${maxRetries} failed: ${err.message}`);
      if (i < maxRetries - 1) {
        console.log('Retrying in 3 seconds...');
        await new Promise(r => setTimeout(r, 3000));
      } else {
        console.error('Could not connect to database after all retries');
        process.exit(1);
      }
    }
  }
}

// API Routes
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM settings LIMIT 1');
    res.json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', async (req, res) => {
  const { location_name, location_address, meeting_time, organizer_email } = req.body;
  try {
    const result = await pool.query(
      'UPDATE settings SET location_name=$1, location_address=$2, meeting_time=$3, organizer_email=$4 WHERE id=1 RETURNING *',
      [location_name, location_address, meeting_time, organizer_email]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/participants', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, phone, invited_by FROM participants ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/participants', async (req, res) => {
  const { name, email, phone, invited_by } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO participants (name, email, phone, invited_by) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, email, phone, invited_by]
    );
    
    // Send webhook for new invite - USES WEBHOOK_INVITE
    await sendWebhook(WEBHOOK_INVITE, {
      type: 'new_invite',
      participant: result.rows[0],
      timestamp: new Date().toISOString()
    });
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/participants/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM participants WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rsvps/:date', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id as participant_id, p.name, COALESCE(r.status, 'maybe') as status 
       FROM participants p 
       LEFT JOIN rsvps r ON p.id = r.participant_id AND r.event_date = $1
       ORDER BY p.name`,
      [req.params.date]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rsvps', async (req, res) => {
  const { participant_id, event_date, status } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO rsvps (participant_id, event_date, status) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (participant_id, event_date) 
       DO UPDATE SET status = $3 
       RETURNING *`,
      [participant_id, event_date, status]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agendas/:date', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM agendas WHERE event_date = $1 ORDER BY created_at',
      [req.params.date]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agendas', async (req, res) => {
  const { event_date, item, proposed_by } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO agendas (event_date, item, proposed_by) VALUES ($1, $2, $3) RETURNING *',
      [event_date, item, proposed_by]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/agendas/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM agendas WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/messages', async (req, res) => {
  const { sender_name, sender_email, message } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO messages (sender_name, sender_email, message) VALUES ($1, $2, $3) RETURNING *',
      [sender_name, sender_email, message]
    );
    
    // Send webhook for new message - USES WEBHOOK_MESSAGE (Contact Organizer)
    await sendWebhook(WEBHOOK_MESSAGE, {
      type: 'contact_message',
      message: result.rows[0],
      timestamp: new Date().toISOString()
    });
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM messages ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// iCal download endpoint
app.get('/api/ical/:date', async (req, res) => {
  try {
    const settings = await pool.query('SELECT * FROM settings LIMIT 1');
    const s = settings.rows[0] || {};
    
    // Parse the date parts
    const [year, month, day] = req.params.date.split('-').map(Number);
    
    // Parse time (e.g., "12:00 PM")
    let hours = 12;
    let minutes = 0;
    if (s.meeting_time) {
      const timeMatch = s.meeting_time.match(/(\d+):(\d+)\s*(AM|PM)?/i);
      if (timeMatch) {
        hours = parseInt(timeMatch[1]);
        minutes = parseInt(timeMatch[2]);
        if (timeMatch[3] && timeMatch[3].toUpperCase() === 'PM' && hours !== 12) {
          hours += 12;
        }
        if (timeMatch[3] && timeMatch[3].toUpperCase() === 'AM' && hours === 12) {
          hours = 0;
        }
      }
    }
    
    // Format as local time for iCal (DTSTART;TZID=America/New_York)
    const pad = (n) => n.toString().padStart(2, '0');
    const dtstart = `${year}${pad(month)}${pad(day)}T${pad(hours)}${pad(minutes)}00`;
    
    // End time (1.5 hours later)
    let endHours = hours + 1;
    let endMinutes = minutes + 30;
    if (endMinutes >= 60) {
      endHours += 1;
      endMinutes -= 60;
    }
    const dtend = `${year}${pad(month)}${pad(day)}T${pad(endHours)}${pad(endMinutes)}00`;
    
    const uid = `ctolunch-${req.params.date}@ctolunches.iternative.com`;
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    
    const location = `${s.location_name || 'TBD'}, ${s.location_address || 'TBD'}`;
    
    const ical = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//CTO Lunches Orlando//NONSGML v1.0//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${now}
DTSTART;TZID=America/New_York:${dtstart}
DTEND;TZID=America/New_York:${dtend}
SUMMARY:CTO Lunches Orlando
DESCRIPTION:Monthly CTO networking lunch. RSVP at https://ctolunches.iternative.com
LOCATION:${location}
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cto-lunch-${req.params.date}.ics"`);
    res.send(ical);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper to format date in Eastern Time
function formatEasternTime(date) {
  return date.toLocaleString('en-US', { 
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

// New endpoint: Get quarterly RSVP data and send to webhook
app.post('/api/send-quarterly-rsvp', async (req, res) => {
  try {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    
    const participantsResult = await pool.query(
      'SELECT id, name, email, phone, invited_by FROM participants ORDER BY name'
    );
    
    const rsvpsResult = await pool.query(
      `SELECT p.id as participant_id, p.name, p.email, p.phone, p.invited_by,
              r.event_date, COALESCE(r.status, 'maybe') as status
       FROM participants p
       LEFT JOIN rsvps r ON p.id = r.participant_id 
         AND r.event_date >= $1 AND r.event_date <= $2
       ORDER BY r.event_date, p.name`,
      [lastMonth.toISOString().split('T')[0], nextMonthEnd.toISOString().split('T')[0]]
    );
    
    const agendasResult = await pool.query(
      `SELECT event_date, item, proposed_by, created_at
       FROM agendas 
       WHERE event_date >= $1 AND event_date <= $2
       ORDER BY event_date, created_at`,
      [lastMonth.toISOString().split('T')[0], nextMonthEnd.toISOString().split('T')[0]]
    );
    
    const rsvpsByDate = {};
    rsvpsResult.rows.forEach(row => {
      if (row.event_date) {
        const dateKey = row.event_date.toISOString().split('T')[0];
        if (!rsvpsByDate[dateKey]) {
          rsvpsByDate[dateKey] = [];
        }
        rsvpsByDate[dateKey].push({
          name: row.name,
          email: row.email,
          phone: row.phone,
          invited_by: row.invited_by,
          status: row.status
        });
      }
    });
    
    const agendasByDate = {};
    agendasResult.rows.forEach(row => {
      if (row.event_date) {
        const dateKey = row.event_date.toISOString().split('T')[0];
        if (!agendasByDate[dateKey]) {
          agendasByDate[dateKey] = [];
        }
        agendasByDate[dateKey].push({
          item: row.item,
          proposed_by: row.proposed_by || 'Anonymous'
        });
      }
    });
    
    const payload = {
      type: 'quarterly_rsvp_list',
      quarter: {
        start: lastMonth.toISOString().split('T')[0],
        end: nextMonthEnd.toISOString().split('T')[0]
      },
      all_participants: participantsResult.rows,
      rsvps_by_date: rsvpsByDate,
      agendas_by_date: agendasByDate,
      timestamp: new Date().toISOString(),
      timestamp_eastern: formatEasternTime(new Date()),
      timezone: 'America/New_York'
    };
    
    const success = await sendWebhook(WEBHOOK_RSVP_LIST, payload);
    
    if (success) {
      res.json({ success: true, message: 'RSVP list sent to webhook' });
    } else {
      res.status(500).json({ success: false, message: 'Failed to send webhook' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/ninjaadmin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

startWithRetry();
