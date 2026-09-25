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
 *
 * Backwards compatible: if mem_mb / cpu_seconds are omitted (legacy 1-arg
 * invocation), no resource limits are applied and the program runs as before.
 * judgeService.ts now always passes mem_mb, cpu_seconds and uid.
 *
 * In the child (after fork, before execv) this wrapper:
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
 * The parent still measures CPU time / peak RSS via wait4() and emits the
 * exact same stderr line the judge parser expects:
 *     TIME_USED:<user>+<sys> MEM_USED:<maxrss_kb>
 */

/* Default unprivileged identity to drop to when started as root. 65534 is the
 * conventional nobody/nogroup id on Debian-family images (the backend base);
 * judgeService passes the per-submission pool uid as argv[3] so concurrent
 * submissions do not share an RLIMIT_NPROC budget. */
#define SANDBOX_UID 65534
#define SANDBOX_GID 65534

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

int main(int argc, char *argv[]) {
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

    pid_t pid = fork();

    if (pid < 0) {
        perror("fork");
        return 1;
    }

    if (pid == 0) {
        /* ---- Child: lock down, then exec the untrusted program. ---- */

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
        /* ---- Parent: wait and collect stats (unchanged output format). ---- */
        int status;
        struct rusage usage;

        if (wait4(pid, &status, 0, &usage) < 0) {
            perror("wait4");
            return 1;
        }

        double user_time = (double)usage.ru_utime.tv_sec + (double)usage.ru_utime.tv_usec / 1000000.0;
        double sys_time = (double)usage.ru_stime.tv_sec + (double)usage.ru_stime.tv_usec / 1000000.0;

        long max_rss = usage.ru_maxrss; /* KB on Linux */

        fprintf(stderr, "TIME_USED:%.3f+%.3f MEM_USED:%ld\n", user_time, sys_time, max_rss);

        if (WIFEXITED(status)) {
            return WEXITSTATUS(status);
        } else if (WIFSIGNALED(status)) {
            return 128 + WTERMSIG(status);
        }
    }

    return 0;
}
