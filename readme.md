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
- [] Reply to set User
- [] Box on the right side, showing who is winning and why - current standings based on +1 for prefered, -1 for not preferred
    - [] A graph in js with the n alternatuves and add nodes and update weights for each node that is not discussed often - XYZ
- [] Box on the top part showing alternatives/ candiates - listed somewhere
- [] Add Room reference numbers - require password (hash key of the reference name)
- [] P5 will be the framework that will be used for making graphs and the current standings
- [] importing CSV, basically, forum will work like this: We will create that dataset offline with users, topics, and replies, etc..., via csv (ensure we have who replied to who to show it), and then simulate as if they are the humans joining, and so full stack will have current standings being updated, graph adding notes and edges to it, and then of couse the chat room itself..
- 

## Quick Start (Local Development)

### Prerequisites
- Node.js 18.x or higher
- npm (comes with Node.js)

### Installation

1. **Clone the repository**
```bash