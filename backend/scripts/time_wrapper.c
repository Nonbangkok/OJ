/* _GNU_SOURCE exposes setgroups() in <grp.h> on glibc (the Debian-family
 * backend image). Harmless on macOS/BSD where it is in <unistd.h>. */
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif

#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <string.h>
#include <grp.h>
#include <fcntl.h>
#include <dirent.h>
#include <signal.h>
#include <sys/wait.h>
#include <sys/resource.h>
#include <sys/types.h>
#include <errno.h>
#include <stddef.h>

/* seccomp socket-deny (RUNNER-002). Guarded so the wrapper still builds on
 * non-Linux dev machines, where seccomp is simply skipped. */
#ifdef __linux__
#include <sys/prctl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <sys/syscall.h>
#endif

/*
 * High-precision timing + sandbox wrapper for the judge.
 *
 * Usage:
 *   time_wrapper <executable> [mem_mb] [cpu_seconds] [uid] [exec_args...]
 *   time_wrapper --kill-uid <uid>
 *
 * Backwards compatible: if mem_mb / cpu_seconds are omitted (legacy 1-arg
 * invocation), no resource limits are applied and the program runs as before.
 * judgeService.ts always passes mem_mb, cpu_seconds and uid.
 *
 * In the child (after fork, before execv) this wrapper:
 *   - closes the telemetry fd (below), so the program can never write to it;
 *   - applies setrlimit() for RLIMIT_AS, RLIMIT_CPU, RLIMIT_NPROC,
 *     RLIMIT_FSIZE and RLIMIT_NOFILE to bound memory, CPU, fork-bombs,
 *     disk writes and file descriptors of untrusted user code;
 *   - installs a seccomp filter denying socket/socketpair (and other
 *     namespace/escape syscalls) so the submission cannot reach the network
 *     (see restrict_network below); and
 *   - if currently running as root, drops to an unprivileged identity (the
 *     per-submission sandbox uid/gid passed as argv[4], default nobody) via
 *     setgid() then setuid() so the submitted binary cannot act with root
 *     privileges.
 *
 * The parent measures CPU time / peak RSS via wait4() and reports
 *     TIME_USED:<user>+<sys> MEM_USED:<maxrss_kb>
 * on fd 3 (TELEMETRY_FD) when the caller opened it (the judge always does),
 * otherwise on stderr for manual runs. The judge reads the figures ONLY from
 * fd 3: the program shares stderr with the wrapper, so anything on stderr is
 * attacker-controlled (a program printing a fake MEM_USED:1 line first used
 * to dodge Memory Limit Exceeded, audit A4-04). A missing report means the
 * wrapper itself was killed, which the judge treats as timeout evidence.
 *
 * --kill-uid <uid> (audit A4-02): SIGKILL every process of a sandbox uid and
 * wait until none is left. Root in the production container has no CAP_KILL,
 * so it cannot signal sandbox processes; instead this mode drops to the uid
 * and calls kill(-1, SIGKILL), which from uid X reaches exactly X's
 * processes and needs no capability. It repeats until /proc shows no live
 * (non-zombie) process with that uid, for a bounded number of rounds.
 * Exit status: 0 = none left, 3 = processes survived, 2 = usage/setup error
 * (including "not started as root", so a dev run can never turn this into a
 * kill of the developer's own processes).
 */

/* Default unprivileged identity to drop to when started as root. 65534 is the
 * conventional nobody/nogroup id on Debian-family images (the backend base);
 * judgeService passes the per-submission pool uid as argv[3] so concurrent
 * submissions do not share an RLIMIT_NPROC budget. */
#define SANDBOX_UID 65534
#define SANDBOX_GID 65534

/* The judge passes a fourth pipe for the wrapper's telemetry line. */
#define TELEMETRY_FD 3

/* --kill-uid bounds: about a second in all, which a SIGKILLed process tree
 * (even one freeing a large heap) needs far less than. */
#define SWEEP_MAX_ROUNDS 400
#define SWEEP_ROUND_SLEEP_US 2500

#ifdef __linux__
#if defined(__x86_64__)
#define NATIVE_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define NATIVE_ARCH AUDIT_ARCH_AARCH64
#else
/* Unsupported sandbox architecture: skip the seccomp filter rather than
 * breaking the build on exotic platforms. */
#define SECCOMP_UNSUPPORTED 1
#endif

#if !defined(SECCOMP_UNSUPPORTED)
#define DENY(nr) BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, nr, 0, 1), \
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|(EPERM & SECCOMP_RET_DATA))

/* Deny networking and namespace/escape syscalls for the untrusted program
 * (RUNNER-002). Mirrors the authoring sandbox (`backend/authoring/sandbox.c`):
 * a submission must not be able to open sockets to the database or other
 * in-stack services, nor escape its identity via namespaces/ptrace. Failures
 * installing the filter abort the child — never run unfiltered by accident. */
static int restrict_sandbox_syscalls(void) {
    struct sock_filter rules[] = {
        BPF_STMT(BPF_LD|BPF_W|BPF_ABS, offsetof(struct seccomp_data, arch)),
        BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, NATIVE_ARCH, 1, 0),
        BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_STMT(BPF_LD|BPF_W|BPF_ABS, offsetof(struct seccomp_data, nr)),
#if defined(__x86_64__)
        /* Reject the x32 ABI as well as an entirely different architecture. */
        BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K, 0x40000000, 0, 1),
        BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_KILL_PROCESS),
#endif
        DENY(__NR_socket), DENY(__NR_socketpair),
        DENY(__NR_unshare), DENY(__NR_setns),
        DENY(__NR_ptrace), DENY(__NR_mount),
        BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW),
    };
    struct sock_fprog program = { .len = sizeof(rules)/sizeof(rules[0]), .filter = rules };
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) return -1;
    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) != 0) return -1;
    return 0;
}
#endif /* !SECCOMP_UNSUPPORTED */
#endif /* __linux__ */

/* Hard caps independent of the per-problem limits. */
#define MAX_PROCESSES 64           /* RLIMIT_NPROC: block fork bombs        */
#define MAX_FILE_SIZE_BYTES (256L * 1024 * 1024) /* RLIMIT_FSIZE: 256MB     */
#define MAX_OPEN_FILES 64          /* RLIMIT_NOFILE                          */

/* Apply a single rlimit, warning (but not aborting) on failure so that a
 * permission quirk in one limit does not silently disable the others. */
static void set_limit(int resource, rlim_t value, const char *name) {
    struct rlimit rl;
    rl.rlim_cur = value;
    rl.rlim_max = value;
    if (setrlimit(resource, &rl) != 0) {
        fprintf(stderr, "warning: setrlimit(%s) failed: %s\n", name, strerror(errno));
    }
}

/* Live processes (other than `self`) any of whose real/effective/saved/fs
 * uids is `uid`; zombies and dead tasks do not count. Reads the Uid: line of
 * /proc/<pid>/status rather than the owner of /proc/<pid>, which a process
 * can turn into root by making itself non-dumpable. A zombie whose Threads:
 * count is above 1 is a process whose main thread exited while other threads
 * still run, so it counts as live. A status file that exists but cannot be
 * read counts as a live process (fail closed). Returns -1 when /proc itself
 * cannot be read. */
static int count_uid_processes(uid_t uid, pid_t self) {
    DIR *proc = opendir("/proc");
    if (proc == NULL) return -1;
    int count = 0;
    struct dirent *entry;
    while ((entry = readdir(proc)) != NULL) {
        char *end = NULL;
        long pid = strtol(entry->d_name, &end, 10);
        if (end == entry->d_name || *end != '\0' || pid <= 0 || (pid_t)pid == self) continue;

        char path[64];
        snprintf(path, sizeof(path), "/proc/%ld/status", pid);
        FILE *status = fopen(path, "re");
        if (status == NULL) {
            if (errno != ENOENT && errno != ESRCH) count++;
            continue;
        }
        char line[256];
        char state = '?';
        int owned = 0;
        long threads = 0;
        while (fgets(line, sizeof(line), status) != NULL) {
            if (strncmp(line, "State:", 6) == 0) {
                sscanf(line + 6, " %c", &state);
            } else if (strncmp(line, "Uid:", 4) == 0) {
                unsigned long ids[4];
                if (sscanf(line + 4, "%lu %lu %lu %lu", &ids[0], &ids[1], &ids[2], &ids[3]) == 4) {
                    for (int i = 0; i < 4; i++) {
                        if (ids[i] == (unsigned long)uid) owned = 1;
                    }
                }
            } else if (strncmp(line, "Threads:", 8) == 0) {
                sscanf(line + 8, " %ld", &threads);
                break; /* State: and Uid: precede Threads: */
            }
        }
        fclose(status);
        int dead = (state == 'Z' || state == 'X') && threads <= 1;
        if (owned && !dead) count++;
    }
    closedir(proc);
    return count;
}

static int kill_uid_mode(const char *arg) {
    char *end = NULL;
    errno = 0;
    long uid = strtol(arg, &end, 10);
    if (errno != 0 || end == arg || *end != '\0' || uid <= 0 || uid > 2147483647L) {
        fprintf(stderr, "error: --kill-uid needs a positive uid\n");
        return 2;
    }
    if (getuid() != 0 || geteuid() != 0) {
        fprintf(stderr, "error: --kill-uid must be started as root\n");
        return 2;
    }
    if (setgroups(0, NULL) != 0 || setgid((gid_t)uid) != 0 || setuid((uid_t)uid) != 0
        || getuid() != (uid_t)uid || geteuid() != (uid_t)uid) {
        fprintf(stderr, "error: cannot become uid %ld: %s\n", uid, strerror(errno));
        return 2;
    }

    pid_t self = getpid();
    for (int round = 0; round < SWEEP_MAX_ROUNDS; round++) {
        /* ESRCH = nothing of ours left to signal. kill(-1) never signals the
         * caller itself or pid 1. */
        if (kill(-1, SIGKILL) != 0 && errno != ESRCH) {
            fprintf(stderr, "error: kill(-1) as uid %ld failed: %s\n", uid, strerror(errno));
            return 2;
        }
        int remaining = count_uid_processes((uid_t)uid, self);
        if (remaining < 0) {
            fprintf(stderr, "error: cannot read /proc: %s\n", strerror(errno));
            return 2;
        }
        if (remaining == 0) return 0;
        usleep(SWEEP_ROUND_SLEEP_US);
    }
    fprintf(stderr, "error: processes of uid %ld survived the sweep\n", uid);
    return 3;
}

int main(int argc, char *argv[]) {
    if (argc >= 2 && strcmp(argv[1], "--kill-uid") == 0) {
        if (argc != 3) {
            fprintf(stderr, "Usage: %s --kill-uid <uid>\n", argv[0]);
            return 2;
        }
        return kill_uid_mode(argv[2]);
    }

    if (argc < 2) {
        fprintf(stderr, "Usage: %s <executable> [mem_mb] [cpu_seconds] [args...]\n", argv[0]);
        return 1;
    }

    /* argv[1] = executable.
     * argv[2] = memory limit in MB (0 / missing => unlimited)
     * argv[3] = CPU seconds hard limit (0 / missing => unlimited)
     * argv[4] = sandbox uid/gid to drop to (0 / missing => SANDBOX_UID default)
     * argv[5..] = extra args forwarded to the executable. */
    long mem_mb = (argc >= 3) ? strtol(argv[2], NULL, 10) : 0;
    long cpu_seconds = (argc >= 4) ? strtol(argv[3], NULL, 10) : 0;
    long drop_uid = (argc >= 5) ? strtol(argv[4], NULL, 10) : 0;

    /* Telemetry channel: fd 3 when the caller opened it, stderr otherwise.
     * Close-on-exec as well as the explicit close in the child below, so no
     * exec'd program can ever hold it. */
    int report_fd = STDERR_FILENO;
    if (fcntl(TELEMETRY_FD, F_GETFD) != -1) {
        report_fd = TELEMETRY_FD;
        if (fcntl(TELEMETRY_FD, F_SETFD, FD_CLOEXEC) != 0) {
            perror("fcntl(telemetry fd)");
            return 1;
        }
    }

    pid_t pid = fork();

    if (pid < 0) {
        perror("fork");
        return 1;
    }

    if (pid == 0) {
        /* ---- Child: lock down, then exec the untrusted program. ---- */

        /* The program must not be able to write (forge) the telemetry. */
        if (report_fd == TELEMETRY_FD && close(TELEMETRY_FD) != 0) {
            fprintf(stderr, "error: cannot close the telemetry fd: %s\n", strerror(errno));
            _exit(127);
        }

        /* Address space (virtual memory). This is the primary memory cap; the
         * judge reports MLE from peak RSS, but RLIMIT_AS prevents a runaway
         * allocation from exhausting the host before that is observed. */
        if (mem_mb > 0) {
            set_limit(RLIMIT_AS, (rlim_t)mem_mb * 1024 * 1024, "RLIMIT_AS");
        }

        /* CPU time hard limit (backstop to the wall-clock `timeout`). */
        if (cpu_seconds > 0) {
            set_limit(RLIMIT_CPU, (rlim_t)cpu_seconds, "RLIMIT_CPU");
        }

        /* Block fork bombs and runaway disk writes / fd exhaustion. */
        set_limit(RLIMIT_NPROC, MAX_PROCESSES, "RLIMIT_NPROC");
        set_limit(RLIMIT_FSIZE, MAX_FILE_SIZE_BYTES, "RLIMIT_FSIZE");
        set_limit(RLIMIT_NOFILE, MAX_OPEN_FILES, "RLIMIT_NOFILE");

        /* Drop privileges if we were started as root. Order matters: setgid
         * MUST precede setuid, otherwise we'd no longer have the privilege to
         * change the gid. Abort the child on failure rather than running the
         * untrusted binary with elevated rights. The uid is the per-submission
         * sandbox identity (argv[4], default nobody): per-uid RLIMIT_NPROC
         * keeps concurrent submissions' process budgets independent, and the
         * matching gid keeps the identity's files private to it. */
        if (geteuid() == 0) {
            uid_t child_uid = (drop_uid > 0) ? (uid_t)drop_uid : SANDBOX_UID;
            gid_t child_gid = (drop_uid > 0) ? (gid_t)drop_uid : SANDBOX_GID;
            if (setgid(child_gid) != 0) {
                fprintf(stderr, "error: setgid failed: %s\n", strerror(errno));
                _exit(127);
            }
            /* Drop any inherited supplementary groups (e.g. root) too. */
            if (setgroups(0, NULL) != 0) {
                fprintf(stderr, "warning: setgroups failed: %s\n", strerror(errno));
            }
            if (setuid(child_uid) != 0) {
                fprintf(stderr, "error: setuid failed: %s\n", strerror(errno));
                _exit(127);
            }
            /* Paranoia: ensure privileges cannot be regained. */
            if (setuid(0) == 0) {
                fprintf(stderr, "error: privilege drop ineffective\n");
                _exit(127);
            }
        }

#if defined(__linux__) && !defined(SECCOMP_UNSUPPORTED)
        /* Deny sockets / namespaces / ptrace AFTER the privilege drop so the
         * filter cannot be bypassed by regaining privileges. Aborting here
         * (127) surfaces as a Runtime Error, never an unsandboxed run. */
        if (restrict_sandbox_syscalls() != 0) {
            fprintf(stderr, "error: seccomp sandbox installation failed: %s\n", strerror(errno));
            _exit(127);
        }
#endif

        /* Build the child's argv: the executable itself followed by any extra
         * args that came AFTER mem_mb/cpu_seconds/uid. We must not leak those
         * positional values into the program's argv.
         *
         * Layout of our argv:  [0]=wrapper [1]=exe [2]=mem [3]=cpu [4]=uid [5..]=args
         * Legacy layout (no limits): [0]=wrapper [1]=exe [2..]=args */
        char **child_argv;
        if (argc >= 5) {
            /* exe + (argc-5) forwarded args + NULL terminator */
            int extra = argc - 5;
            child_argv = (char **)malloc(sizeof(char *) * (extra + 2));
            if (child_argv == NULL) {
                fprintf(stderr, "error: malloc failed building argv\n");
                _exit(127);
            }
            child_argv[0] = argv[1];
            for (int i = 0; i < extra; i++) {
                child_argv[i + 1] = argv[5 + i];
            }
            child_argv[extra + 1] = NULL;
        } else {
            /* Legacy invocation: forward exe + everything after it verbatim. */
            child_argv = &argv[1];
        }

        execv(argv[1], child_argv);
        /* If execv returns, an error occurred. */
        perror("execv");
        _exit(127);
    } else {
        /* ---- Parent: wait and collect stats. ---- */
        int status;
        struct rusage usage;

        if (wait4(pid, &status, 0, &usage) < 0) {
            perror("wait4");
            return 1;
        }

        double user_time = (double)usage.ru_utime.tv_sec + (double)usage.ru_utime.tv_usec / 1000000.0;
        double sys_time = (double)usage.ru_stime.tv_sec + (double)usage.ru_stime.tv_usec / 1000000.0;

        long max_rss = usage.ru_maxrss; /* KB on Linux */

        dprintf(report_fd, "TIME_USED:%.3f+%.3f MEM_USED:%ld\n", user_time, sys_time, max_rss);

        if (WIFEXITED(status)) {
            return WEXITSTATUS(status);
        } else if (WIFSIGNALED(status)) {
            return 128 + WTERMSIG(status);
        }
    }

    return 0;
}
