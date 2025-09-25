# Grader System

This is a grader system with a React frontend and a Node.js (Express) backend, fully containerized with Docker for easy setup and deployment.

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

## Managing Problems

### Batch Uploading Problems

The system includes a script to automatically import multiple problems from the `backend/problem_source` directory into the database.

**To run the batch upload:**
```bash
docker-compose exec backend node batch_upload.js
```

### Directory Structure

Each problem must have its own directory inside `backend/problem_source`. For example:

```
backend/
└── problem_source/
    ├── MyFirstProblem/
    │   ├── config.json
    │   ├── MyFirstProblem.pdf
    │   └── testcases.zip
    ├── MySecondProblem/
    │   ├── config.json
    │   ├── MySecondProblem.pdf
    │   └── testcases/
    │       ├── input/
    │       │   ├── 1.in
    │       │   └── 2.in
    │       └── output/
    │           ├── 1.out
    │           └── 2.out
    └── MyThirdProblem/
        ├── config.json
        ├── MyThirdProblem.pdf
        └── testcases/
            ├── input/
            │   ├── input1.txt
            │   └── input2.txt
            └── output/
                ├── output2.txt
                └── output2.txt
```

Each problem directory must contain:

1.  **`config.json`**: A JSON file with problem metadata.
    ```json
    {
      "id": "A-Plus-B",
      "title": "A + B",
      "author": "System",
      "time_limit_ms": 1000,
      "memory_limit_mb": 256
    }
    ```
    -   `id`: A unique string identifier for the problem.
    -   `title`: The display name of the problem.
    -   `author`: The author of the problem.
    -   `time_limit_ms`: Time limit in milliseconds.
    -   `memory_limit_mb`: Memory limit in megabytes.

2.  **Problem Statement PDF**: A single `.pdf` file containing the problem description. The script will automatically find and use the first PDF it finds in the directory.

3.  **Test Cases**: Test cases can be provided in one of two formats:

    *   **Option A: Zip Archive**
        -   A single `.zip` file containing all test case files.
        -   Input and output files must be paired by number.
        -   Supported naming conventions include: `input1.in`/`output1.out`, `1.in`/`1.out`, `input1.txt`/`output1.txt`, etc. The script intelligently pairs them based on the numbers in the filenames.

    *   **Option B: `input`/`output` Subdirectories**
        -   A subdirectory (e.g., `testcases/`, `data/`) that contains two folders: `input/` and `output/`.
        -   All input files go into the `input/` folder.
        -   All corresponding output files go into the `output/` folder.
        -   Files are paired by sorting them alphabetically/numerically. For example, the first file in `input/` is matched with the first file in `output/`. It's recommended to use names like `01.in`, `02.in`, etc., to ensure correct ordering.

**Note**: The script will clear any existing test cases for a problem before inserting the new ones.

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
