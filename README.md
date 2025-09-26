# Grader System

This is a grader system with a React frontend and a Node.js (Express) backend, fully containerized with Docker for easy setup and deployment.

## Features

- User registration and login
- Problem statements (PDF) and test case management via database
- Code submission (C++ only) with judging in an isolated environment
- Real-time judging of submissions
- Scoreboard
- Admin panel for user, problem, and database management

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
**Important:** The database tables are NOT created automatically when the containers start. You must run the initialization script manually.

1.  **Create the database tables:**
    -   Run this command in your terminal:
        ```bash
        docker-compose exec backend node init_db.js
        ```
    -   This command will create all necessary database tables.

2.  **Create an admin user:**
    -   Run this command and follow the interactive prompts to set up your admin account:
        ```bash
        docker-compose exec backend node create_admin.js
        ```

Your OJ system is now fully set up and ready to use!

## Database Management (Admin Only)

The system provides administration tools for exporting and importing the entire database, useful for backups or emergency recovery. These features are accessible via the Admin Panel under "Settings".

### Export Database

Administrators can export the current state of the database to a `.sql` dump file.

1.  Navigate to the Admin Panel.
2.  Go to the "Settings" section.
3.  Click the "Export Database" button.
4.  The browser will download an `oj_backup_*.sql` file containing your entire database.

### Import Database

Administrators can import a database dump file (`.sql`, `.dump`, or `.tar`) to restore the database to a previous state.

**WARNING:** Importing a database will **PERMANENTLY DELETE ALL EXISTING DATA** in the database and replace it with the contents of the uploaded file. Proceed with extreme caution and ensure you have a backup of your current database if needed.

1.  Navigate to the Admin Panel.
2.  Go to the "Settings" section.
3.  In the "Import Database" section, click "Choose File" and select your database dump file.
4.  Click the "Upload & Import" button.
5.  Confirm the action when prompted. The import process will begin.
6.  After a successful import, you may need to refresh your browser or re-login.

## Managing Problems

### Batch Uploading Problems

The system allows administrators to upload problems in bulk via the Admin Panel. By clicking the **Batch Upload** button on the Problem Management page, you can upload a single `.zip` file containing one or more problems.

The uploaded `.zip` file can have two primary structures:

1.  **Single Problem ZIP**: The root of the ZIP file contains the files for one problem directly (`config.json`, a PDF, and test cases).
2.  **Multiple Problems ZIP**: The root of the ZIP file contains multiple directories, where each directory represents a single problem.

### ZIP File Structure Examples

#### Structure 1: Single Problem ZIP

The ZIP file contains all necessary files for a single problem at its root level.

```
MooDeng.zip
├── config.json
├── MooDeng.pdf
└── testcases/
    ├── input/
    │   ├── 1.in
    │   └── 2.in
    └── output/
        ├── 1.out
        └── 2.out
```

#### Structure 2: Multiple Problems ZIP

The ZIP file contains multiple problem directories. The system will iterate through each directory and process it as a separate problem, demonstrating the various ways test cases can be structured.

```
ProblemSet.zip
├── MyFirstProblem/  (Using a ZIP for test cases)
│   ├── config.json
│   ├── MyFirstProblem.pdf
│   └── testcases.zip
│       ├── input/
│       │   ├── input01.in
│       │   └── input02.in
│       └── output/
│           ├── output01.out
│           └── output02.out
│
├── MySecondProblem/ (Using a folder with input/output subdirectories)
│   ├── config.json
│   ├── MySecondProblem.pdf
│   └── testcases/
│       ├── input/
│       │   ├── 1.in
│       │   └── 2.in
│       └── output/
│           ├── 1.out
│           └── 2.out
│
└── MyThirdProblem/  (Using a folder with a flat file structure)
    ├── config.json
    ├── MyThirdProblem.pdf
    └── data/
        ├── input_01.txt
        ├── output_01.txt
        ├── input_02.txt
        └── output_02.txt
```

### Problem Directory Contents

Each problem directory (either at the root of a multi-problem ZIP or the content of a single-problem ZIP) must contain:

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

    *   **Option A: Zip Archive (`testcases.zip`)**
        -   A single `.zip` file containing all test case files for that specific problem.
        -   This `testcases.zip` file itself can have two internal structures:
            1.  **Flat Structure**: Input and output files are at the root of the zip. They must be paired by number. Supported naming conventions include: `input1.in`/`output1.out`, `1.in`/`1.out`, `input1.txt`/`output1.txt`, etc.
                ```
                Internal structure of MyFirstProblem/testcases.zip
                ├── 1.in
                ├── 1.out
                ├── input2.txt
                └── output2.txt
                ```
            2.  **Directory Structure**: The zip contains `input/` and `output/` subdirectories. All input files go into the `input/` folder, and all corresponding output files go into the `output/` folder. Files are paired by sorting them alphabetically/numerically.
                ```
                Another example of a testcases.zip internal structure
                ├── input/
                │   ├── case1.txt
                │   └── case2.txt
                └── output/
                    ├── case1.txt
                    └── case2.txt
                ```

    *   **Option B: `input`/`output` Subdirectories**
        -   Instead of a zip, you can provide a subdirectory (e.g., `testcases/`, `data/`) that contains two folders: `input/` and `output/`.
        -   All input files go into the `input/` folder, and all corresponding output files go into the `output/` folder.
        -   Files are paired by sorting them alphabetically/numerically. For example, the first file in `input/` is matched with the first file in `output/`. It's recommended to use names like `01.in`, `02.in`, etc., to ensure correct ordering.

    *   **Option C: Flat Directory Structure**
        -   As an alternative to `input/output` subdirectories, you can place all test case files directly inside a single subdirectory (e.g., `testcases/`, `data/`).
        -   The system will pair files based on the numbers in their filenames (e.g., `input1.txt` is paired with `output1.txt`, `case_02.in` with `case_02.out`).

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
