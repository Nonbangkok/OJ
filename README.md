# Grader System

The Grader System is a comprehensive online judge platform designed to facilitate competitive programming and programming education. It features a modern, responsive React frontend, a robust Node.js (Express) backend, and a PostgreSQL database, all orchestrated with Docker for seamless setup, deployment, and scalability. This system allows users to register, solve programming problems by submitting C++ code, and receive real-time feedback on their submissions. Administrators have powerful tools to manage users, problems, contests, and the database, making it a versatile platform for various programming challenges.

**Target Audience:** This system is ideal for students, educators, and anyone interested in developing their programming skills through competitive programming or structured practice.

## Features

The Grader System offers a rich set of features for both users and administrators:

*   **User Management:**
    *   **User Registration and Login:** Secure user authentication with encrypted passwords and session management.
    *   **User Roles:** Differentiated access for regular users, staffs and administrators.
    *   **Batch User Creation (Admin):** Administrators can generate multiple user accounts with a defined prefix and random passwords.
*   **Problem Management:**
    *   **Problem Statements (PDF):** Upload and display problem descriptions in PDF format (up to 1GB).
    *   **Test Case Management:** Store and manage test cases (input/output) for each problem in the database.
    *   **Single Problem Upload (Admin):** Administrators can add new problems or update existing ones individually, including their metadata, PDF, and test cases (via ZIP upload).
    *   **Batch Problem Upload (Admin):** Efficiently upload multiple problems at once using structured ZIP files (up to 1GB).
    *   **Problem Visibility Control (Admin):** Administrators can toggle the visibility of problems to users.
*   **Code Submission & Judging:**
    *   **C++ Code Submission:** Users can submit C++ solutions to problems (C++ only currently supported).
    *   **Isolated Judging Environment:** Code is compiled and executed in an isolated environment to prevent security risks and ensure fair evaluation.
    *   **Real-time Judging:** Submissions are judged promptly, providing immediate feedback on correctness, execution time, and memory usage.
    *   **Detailed Results:** For each submission, users receive detailed results per test case, including status (Accepted, Wrong Answer, Time Limit Exceeded, Memory Limit Exceeded, Runtime Error, Compilation Error).
    *   **Time and Memory Limits:** Configurable time and memory limits for each problem to control resource usage during judging.
*   **Contest Management:**
    *   **Contest Creation and Configuration (Admin):** Administrators can create and configure new programming contests with specific problems, start/end times, and visibility settings.
    *   **Contest Participation:** Users can view available contests and join those that are currently active or scheduled.
    *   **Contest-Specific Submissions:** Submissions made within a contest are tracked separately from general problem submissions, ensuring contest integrity.
    *   **Contest Scoreboard:** Real-time scoreboard displaying participants' scores and rankings within a contest.
*   **Scoreboard:**
    *   **Global Scoreboard:** A public scoreboard displaying user rankings based on their performance across all general problems.
*   **Database Management (Admin Only):**
    *   **Export Database:** Administrators can export the entire database to a `.sql` dump file for backup purposes.
    *   **Import Database:** Administrators can restore the database from a `.sql`, `.dump`, or `.tar` file. **WARNING: Importing a database will PERMANENTLY DELETE ALL EXISTING DATA in the database and replace it with the contents of the uploaded file. Proceed with extreme caution and ensure you have a backup of your current database if needed.**
*   **System Settings (Admin Only):**
    *   **Registration Toggle:** Administrators can enable or disable new user registrations.

## Technology

The Grader System is built with a modern tech stack, ensuring a robust, scalable, and responsive application.

*   **Frontend:**
    *   **React:** A JavaScript library for building user interfaces.
    *   **React Router DOM:** For declarative routing in React applications.
    *   **Axios:** Promise-based HTTP client for making API requests.
*   **Backend:**
    *   **Node.js & Express:** A powerful and flexible framework for building RESTful APIs.
    *   **PostgreSQL:** A robust, open-source relational database.
    *   **`bcrypt`:** For hashing and salting passwords securely.
    *   **`multer`:** Middleware for handling `multipart/form-data`, primarily for file uploads.
    *   **`unzipper`:** For extracting contents from ZIP archives.
    *   **`node-cron`:** For scheduling tasks (e.g., contest scheduling).
    *   **`express-session`:** Session management for Express.js.
*   **Containerization & Deployment:**
    *   **Docker:** For containerizing the frontend, backend, and PostgreSQL database.
    *   **Docker Compose:** For defining and running multi-container Docker applications.
    *   **Nginx:** Used as a reverse proxy for routing requests to the frontend and backend services, and potentially for SSL termination in the future.
*   **Language & Tools:**
    *   **JavaScript:** Primary language for both frontend and backend development.
    *   **C++:** The judging system compiles and runs user-submitted C++ code.
    *   **Git:** A distributed version control system for tracking changes in source code.

## Prerequisites

To get the Grader System up and running, you only need to install a few essential tools on your host machine. The rest of the application's dependencies (Node.js, npm, PostgreSQL) are managed within Docker containers.

*   **[Docker](https://www.docker.com/):** Essential for containerizing, building, running, and managing the application's services.
*   **[Git](https://git-scm.com/downloads):** Required to clone the project repository for local development and version control.

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
    -   Open the `.env` file and change all of them and the `POSTGRES_PASSWORD` and `SECRET_KEY` to your own strong, secret values.

## Running the Project

Once the installation and setup are complete, you can start the application:

1.  **Build and Run Docker Containers:**
    Navigate to the root directory of the project (where `docker-compose.yml` is located) and execute the following command:
    ```bash
    docker-compose up --build -d
    ```
    *   The first time you run this command, it might take several minutes as Docker downloads the PostgreSQL image and builds the frontend and backend images.
2.  **Access the Application:**
    After the containers have successfully started, open your web browser and navigate to:
    [http://localhost](http://localhost)
    The Nginx proxy, running in its own Docker container, handles routing. Requests to `/` are forwarded to the `frontend` service, while requests to `/api/` are rewritten and forwarded to the `backend` service.

## Database Initialization

After successfully running the Docker containers for the first time, you need to initialize the PostgreSQL database and create an administrative user. This is a crucial step as the database tables are **not automatically created** when the containers start.

1.  **Create Database Tables:**
    Execute the following command from the project's root directory to set up all necessary database tables and default system settings:
    ```bash
    docker-compose exec backend node init_db.js
    ```
    *   This script connects to the `oj_database` container and runs the database schema initialization.
2.  **Create an Admin User:**
    After creating the tables, you must create an initial administrator account. Run this command and follow the interactive prompts in your terminal to set up your admin username and password:
    ```bash
    docker-compose exec backend node create_admin.js
    ```
    *   This command will guide you through creating an admin user, which is essential for accessing the administrative functionalities of the system.

Your Grader System is now fully set up and ready for use!

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

## Problems Management

The system provides robust tools for administrators to manage programming problems, accessible via the Admin Panel under the "Problem Management" section.

*   **Single Problem Upload:**
    Administrators can add new problems or update existing ones individually. This includes:
    1.  **Problem Metadata:** Define problem ID, title, author, time limit (in milliseconds), and memory limit (in megabytes).
    2.  **Problem Statement (PDF):** Upload a single PDF file (up to 1GB) containing the problem description.
    3.  **Test Cases:** Upload a `.zip` archive (up to 1GB) containing the input and output test cases for the problem. The system will automatically parse and store these test cases.
    *   **Note:** Uploading new test cases for an existing problem will **clear all previously associated test cases** before inserting the new ones.
*   **Batch Problem Upload:**
    For efficiency, administrators can upload multiple problems simultaneously using a single structured `.zip` file (up to 1GB). This feature is available via the "Batch Upload" button on the Problem Management page.
    *   **Zip File Structure:** The uploaded `.zip` file can follow two main structures:
        *   **Single Problem ZIP:** The root of the ZIP contains all files for one problem (`config.json`, PDF, and test cases).
        *   **Multiple Problems ZIP:** The root of the ZIP contains multiple directories, where each directory represents a distinct problem.

### ZIP File Structure Examples

#### Structure 1: Single Problem ZIP

The ZIP file contains all necessary files for a single problem at its root level.

```
Problem.zip
├── config.json
├── Problem.pdf
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
├── MyFirstProblem/
│   ├── config.json
│   ├── MyFirstProblem.pdf
│   └── testcases.zip  (Internal structure: Flat)
│       ├── 1.in
│       ├── 1.out
│       ├── input_02.txt
│       └── output_02.txt
│
├── MySecondProblem/
│   ├── config.json
│   ├── MySecondProblem.pdf
│   └── testcases/  (Internal structure: Directories)
│       ├── input/
│       │   ├── 01.in
│       │   └── 02.in
│       └── output/
│           ├── 01.out
│           └── 02.out
│
└── MyThirdProblem/
    ├── config.json
    ├── MyThirdProblem.pdf
    └── data/  (Internal structure: Flat directory)
        ├── case_01.txt
        ├── out_case_01.txt
        ├── case_02.txt
        └── out_case_02.txt
```

### Problem Directory Contents Structure

Each problem directory (either at the root of a multi-problem ZIP or the content of a single-problem ZIP) must contain:

1.  **`config.json`:** A JSON file detailing the problem's metadata.
    ```json
    {
      "id": "plus",
      "title": "Plus",
      "author": "Nonbangkok",
      "time_limit_ms": 1000,
      "memory_limit_mb": 32
    }
    ```
    *   `id`: A unique string identifier for the problem (e.g., "plus").
    *   `title`: The display name of the problem (e.g., "Plus").
    *   `author`: The author of the problem.
    *   `time_limit_ms`: The maximum allowed execution time for a solution, in milliseconds.
    *   `memory_limit_mb`: The maximum allowed memory usage for a solution, in megabytes.

2.  **Problem Statement PDF:**
    A single `.pdf` file (up to 1GB) containing the problem description. The system will automatically detect and use the first PDF file found within the problem's directory.

3.  **Test Cases:**
    Test cases can be organized in one of several flexible formats:

    *   **Option A: Zip Archive (`testcases.zip`)**
        A single `.zip` file named `testcases.zip` placed within the problem directory. This inner ZIP file can itself have two internal structures:
        1.  **Flat Structure:** Input and output files are directly at the root of `testcases.zip`. Files must be numerically paired. Supported naming conventions include: `input1.in`/`output1.out`, `1.in`/`1.out`, `input1.txt`/`output1.txt`, `test_01.in`/`test_01.out`, `case_A.in`/`case_A.out`, etc.
            ```
            Internal structure of MyFirstProblem/testcases.zip
            ├── 1.in
            ├── 1.out
            ├── input_02.txt
            └── output_02.txt
            ```
        2.  **Directory Structure:** The `testcases.zip` contains `input/` and `output/` subdirectories. All input files go into `input/`, and all corresponding output files go into `output/`. Files are paired by sorting them alphabetically/numerically.
            ```
            Another example of a testcases.zip internal structure
            ├── input/
            │   ├── 01.in
            │   └── 02.in
            └── output/
                ├── 01.out
                └── 02.out
            ```

    *   **Option B: `input`/`output` Subdirectories**
        Instead of a `testcases.zip`, you can provide a subdirectory (e.g., `testcases/` or `data/`) that directly contains two subfolders: `input/` and `output/`.
        All input files are placed in `input/`, and their corresponding output files in `output/`. Files are paired by sorting them alphabetically/numerically (e.g., `01.in` in `input/` matches `01.out` in `output/`).

        ```
        Internal structure of problem testcases , Option B :
        └── testcases/
            ├── input/
            │   ├── 01.in
            │   └── 02.in
            └── output/
                ├── 01.out
                └── 02.out
        ```

    *   **Option C: Flat Directory Structure**
        As an alternative, you can place all test case files directly within a single subdirectory (e.g., `testcases/` or `data/`). The system will pair files based on the numbers in their filenames (e.g., `input1.txt` with `output1.txt`, `case_02.in` with `case_02.out`, `test_01.in` with `test_01.out`, `case_A.in` with `case_A.out`).

        ```
        Internal structure of problem testcases , Option C :
        └── testcases/
            ├── input1.txt
            ├── output1.txt
            ├── case_02.in
            └── case_02.out
        ```
        
    *   **Recommendation:** It is highly recommended to use numerically sequential and consistently named test case files (e.g., `01.in`, `02.in`, ..., `01.out`, `02.out`, ...) to ensure correct pairing and ordering during the judging process. This helps avoid unexpected behavior across different file systems and parsing logic.

**Note**: The script will clear any existing test cases for a problem before inserting the new ones.

## Contests Management

The Grader System includes a dedicated module for managing programming contests, providing a structured environment for competitive events. This functionality is primarily accessible and configurable by administrators.

*   **Contest Creation and Configuration:**
    Administrators can create new contests, defining:
    *   **Basic Information:** Contest title, description, and visibility.
    *   **Schedule:** Start and end times for the contest.
    *   **Associated Problems:** Select existing problems to be part of the contest. **Important: Problems assigned to an active contest become inaccessible as standalone problems for general submission during the contest period.**
    *   **Status Management:** Contests progress through various statuses: `scheduled` (waiting to start), `running` (currently active), and `finished` (concluded). These statuses are managed automatically by the system's scheduler.
*   **Contest Participation:**
    Users can view available contests and join those that are currently active or scheduled.
*   **Contest-Specific Submissions:**
    During a contest, participants submit solutions to problems specifically within the contest environment. These submissions are tracked separately from general problem submissions, ensuring contest integrity.
*   **Contest Scoreboard:**
    A real-time scoreboard is available for each contest, displaying the scores and rankings of participants. This scoreboard is dynamically updated as participants submit and their solutions are judged.
*   **Contest Scheduler:**
    The backend includes a dedicated service (`contestScheduler.js`) that automatically manages the status of contests based on their defined start and end times.
