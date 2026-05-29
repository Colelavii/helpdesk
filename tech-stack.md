# Tech Stack

## Frontend

- **React** with **TypeScript**
- **React Router** for client-side routing
- **Tailwind CSS** for styling

## Backend

- **Express** with **TypeScript**

## Database

- **PostgreSQL**
- **Prisma** as the ORM

## Authentication

- Database-backed sessions (session records stored in PostgreSQL via Prisma)
- No third-party auth provider; admin bootstraps agents from within the app

## AI

- **Claude** (Anthropic API) for classification, summaries, and drafted replies

## Email

- **Mailgun** for both inbound (forwarded support emails via routes/webhook) and outbound (agent replies)

## Deployment

- **Docker** — containerised services for the API, frontend, and database
