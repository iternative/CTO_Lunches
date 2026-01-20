# CTO Lunches Orlando - RNRSVP

A beautiful RSVP application for CTO networking lunches in West Orlando. Features a premium glass UI design with calendar-based event management.

## Features

- **Calendar View**: Interactive calendar highlighting the second Wednesday of each month
- **RSVP Management**: Yes/Maybe/No status tracking for all participants
- **Participant Invitations**: Add new participants with contact information
- **Agenda Management**: Propose and view meeting agenda items
- **Contact Organizer**: Send messages to the event organizer
- **Admin Panel**: Separate admin interface at `/admin` with:
  - Edit meeting location, address, and time
  - Delete participants
  - Delete agenda items
  - View all messages

## URLs

- **User Page**: `/` - Main RSVP interface
- **Admin Page**: `/admin` - Administrative functions (no authentication required)

## Deployment to Dokploy

### Option 1: Docker Compose (Recommended)

1. Create a new Docker Compose project in Dokploy
2. Upload or paste the `docker-compose.yml` contents
3. Deploy

### Option 2: Manual Docker Deployment

1. Create a PostgreSQL database service in Dokploy
2. Create a new Docker application
3. Set environment variable: `DATABASE_URL=postgresql://user:pass@host:5432/rnrsvp`
4. Build and deploy from this Dockerfile

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@db:5432/rnrsvp` |
| `PORT` | Application port | `3000` |

## Database Schema

The application automatically creates these tables on startup:

- `settings` - Meeting location, address, time, organizer email
- `participants` - Name, email, phone, invited_by
- `rsvps` - Participant ID, event date, status (yes/maybe/no)
- `agendas` - Event date, agenda item, proposed_by
- `messages` - Sender name, email, message content

## API Endpoints

### Settings
- `GET /api/settings` - Get meeting settings
- `PUT /api/settings` - Update settings (admin)

### Participants
- `GET /api/participants` - List all participants
- `POST /api/participants` - Add new participant
- `DELETE /api/participants/:id` - Remove participant (admin)

### RSVPs
- `GET /api/rsvps/:date` - Get RSVPs for a date
- `POST /api/rsvps` - Create/update RSVP

### Agendas
- `GET /api/agendas/:date` - Get agenda items for a date
- `POST /api/agendas` - Add agenda item
- `DELETE /api/agendas/:id` - Remove agenda item (admin)

### Messages
- `GET /api/messages` - Get all messages (admin)
- `POST /api/messages` - Send message to organizer

## Design System

Built with the "Jane Glass" design system featuring:
- Cold premium glass aesthetics
- Translucent layers with blur effects
- Touch-first interface (buttons ≥ 40px)
- Low-contrast accents
- DM Sans + JetBrains Mono typography

## License

MIT
