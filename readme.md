# Real-Time Chat Room

A simple, lightweight chat room application supporting up to 20 concurrent users. Built with Node.js, Express, and Socket.IO for real-time WebSocket communication.

## Live Demo

**Hosted on Render.com:** [https://votely-mwzo.onrender.com]

> **Note:** The free tier on Render spins down after 15 minutes of inactivity. First user may experience a ~30 second wake-up time. Once active, the chat runs smoothly for all users.

---

## Features

- Real-time messaging with WebSockets
- Live user list showing who's online
- Join/leave notifications
- Responsive design (works on mobile)
- Clean, modern UI
- Zero database required (ephemeral chat)

---

## TODO LIST
- [x] Add a db of some kind to ensure we have persistant logs, etc... 
    - Implemented Format: Implemted dirty via sqlite, saves history in the directory
    - All users that now join are able to see history etc...
- [x] Add feature for data extraction
- 

## Quick Start (Local Development)

### Prerequisites
- Node.js 18.x or higher
- npm (comes with Node.js)

### Installation

1. **Clone the repository**
```bash