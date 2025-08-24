# OJ (Online Judge) System

This is a simple Online Judge system with a React frontend and a Node.js (Express) backend, fully containerized with Docker for easy setup and deployment.

## Features

- User registration and login
- Problem statements (PDF) and test case management via database
- Code submission (C++ only) with judging in an isolated environment
- Real-time judging of submissions
- Scoreboard
- Admin panel for user and problem management

## Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop/)
- [Docker Compose](https://docs.docker.com/compose/install/)

That's it! You do not need to install Node.js, npm, or PostgreSQL on your host machine.

## Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Nonbangkok/OJ.git
    cd OJ
    ```

2.  **Create the environment file:**
    -   Copy the example environment file to create your own local configuration.
        ```bash
        cp .env.example .env
        ```
    -   Open the `.env` file and change the `POSTGRES_PASSWORD` and `SECRET_KEY` to your own strong, secret values.

## Running the Application

1.  **Build and run the containers:**
    -   From the root directory of the project (where `docker-compose.yml` is), run:
        ```bash
        docker-compose up --build -d
        ```
    -   This command will build the Docker images for the frontend and backend, download the PostgreSQL image, and start all three services in the background. The first run might take a few minutes.

2.  **Access the application:**
    -   Open your web browser and navigate to:
        [http://localhost](http://localhost)

## First-Time Setup (Database Initialization)

After running the application for the first time, you need to initialize the database and create an admin user.

1.  **Create the database tables:**
    -   Run this command in your terminal:
        ```bash
        docker-compose exec backend node init_db.js
        ```

2.  **Create an admin user:**
    -   Run this command and follow the interactive prompts to set up your admin account:
        ```bash
        docker-compose exec backend node create_admin.js
        ```

Your OJ system is now fully set up and ready to use!

## Useful Docker Compose Commands

-   **Check the status of your containers:**
    ```bash
    docker-compose ps
    ```

-   **View logs for a specific service (e.g., backend):**
    ```bash
    docker-compose logs -f backend
    ```

-   **Stop and remove all containers:**
    ```bash
    docker-compose down
    ```

-   **Stop and remove all containers AND delete database data:**
    > **Warning:** This will permanently delete all users, problems, and submissions.
    ```bash
    docker-compose down -v
    ```

-   **Rebuild and restart a service after making code changes (e.g., backend):**
    ```bash
    docker-compose up --build -d backend
    ```
