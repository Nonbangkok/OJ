# OJ (Online Judge) System

This is a simple Online Judge system with a React frontend and a Node.js (Express) backend.

## Features

- User registration and login
- Problem statements (PDF)
- Code submission (C++ only)
- Real-time judging of submissions
- Scoreboard
- Admin panel for user and problem management

## Prerequisites

- Node.js (v14 or later)
- npm
- PostgreSQL
- C++ compiler (like `g++` or `clang++`)

## Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd <project-directory>
    ```

2.  **Backend Setup:**
    - Navigate to the backend directory: `cd backend`
    - Install dependencies: `npm install`
    - Set up your PostgreSQL database and create a `.env` file with your database credentials. See `backend/db.js` for connection details.
    - Initialize the database tables: `node init_db.js`
    - Create an admin user: `node create_admin.js` (Follow the prompts)

3.  **Frontend Setup:**
    - Navigate to the frontend directory: `cd ../frontend`
    - Install dependencies: `npm install`

## Running the Application

1.  **Start the Backend Server:**
    - In the `backend` directory, run:
      ```bash
      node server.js
      ```
    - The server will be running on `http://localhost:3000`.

2.  **Start the Frontend Development Server:**
    - In the `frontend` directory, run:
      ```bash
      npm start
      ```
    - The application will open in your browser at `http://localhost:3001`.
