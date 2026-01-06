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

// Database connection
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@db:5432/rnrsvp'
});

// Initialize database
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
  } catch (err) {
    console.error('Database initialization error:', err);
  } finally {
    client.release();
  }
}

// API Routes

// Settings
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
      `UPDATE settings SET location_name = $1, location_address = $2, meeting_time = $3, organizer_email = $4 WHERE id = 1 RETURNING *`,
      [location_name, location_address, meeting_time, organizer_email]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Participants
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
      'INSERT INTO participants (name, email, phone, invited_by) VALUES ($1, $2, $3, $4) RETURNING id, name, email, phone, invited_by',
      [name, email, phone, invited_by]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/participants/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM participants WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// RSVPs
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

// Agendas
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

// Messages
app.post('/api/messages', async (req, res) => {
  const { sender_name, sender_email, message } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO messages (sender_name, sender_email, message) VALUES ($1, $2, $3) RETURNING *',
      [sender_name, sender_email, message]
    );
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

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RNRSVP server running on port ${PORT}`);
  });
});
