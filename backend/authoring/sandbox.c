#define _GNU_SOURCE
#include <errno.h>
#include <grp.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <sched.h>
#include <sys/prctl.h>
#include <sys/syscall.h>

/* Runtime only. A static generator sees its private jail, never the spool or /proc.
 * Descendants may fork but cannot escape the process group killed by the supervisor.
 * clone3 returns ENOSYS so libc can use the inspectable legacy clone syscall. */
#if defined(__x86_64__)
#define NATIVE_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define NATIVE_ARCH AUDIT_ARCH_AARCH64
#else
#error Unsupported authoring runner architecture
#endif
#define DENY(nr) BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, nr, 0, 1), BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM)

static int restrict_processes(void) {
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
        DENY(__NR_setsid), DENY(__NR_setpgid), DENY(__NR_unshare), DENY(__NR_setns),
        DENY(__NR_ptrace), DENY(__NR_mount), DENY(__NR_chroot),
        BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_clone3, 0, 1),
        BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|ENOSYS),
        BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_clone, 0, 3),
        BPF_STMT(BPF_LD|BPF_W|BPF_ABS, offsetof(struct seccomp_data, args[0])),
        BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K, CLONE_NEWUSER|CLONE_NEWPID|CLONE_NEWNS|CLONE_NEWNET|CLONE_NEWIPC|CLONE_NEWUTS|CLONE_NEWCGROUP, 0, 1),
        BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM),
        BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW),
    };
    struct sock_fprog program = { .len = sizeof(rules)/sizeof(rules[0]), .filter = rules };
    return prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) || prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program);
}

int main(int argc, char **argv) {
    if (argc != 3 || geteuid() != 0) return 125;
    if (chdir(argv[1]) || chroot(".") || chdir("/") || setgroups(0, NULL)
        || setgid(65534) || setuid(65534) || restrict_processes()) {
        perror("authoring sandbox setup failed");
        return 125;
    }
    char *const args[] = { "/generator", argv[2], NULL };
    execv(args[0], args);
    perror("authoring generator execution failed");
    return 125;
}
