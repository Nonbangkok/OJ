#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/resource.h>
#include <sys/types.h>
#include <errno.h>

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: %s <executable> [args...]\n", argv[0]);
        return 1;
    }

    pid_t pid = fork();

    if (pid < 0) {
        perror("fork");
        return 1;
    }

    if (pid == 0) {
        // Child process: execute the target program
        execv(argv[1], &argv[1]);
        // If execv returns, an error occurred
        perror("execv");
        exit(1);
    } else {
        // Parent process: wait for child and collect stats
        int status;
        struct rusage usage;
        
        // wait4 is deprecated in some systems but widely available on Linux
        // and provides the rusage of the specific child.
        if (wait4(pid, &status, 0, &usage) < 0) {
            perror("wait4");
            return 1;
        }

        // Calculate User time and System time in seconds with microsecond precision
        double user_time = (double)usage.ru_utime.tv_sec + (double)usage.ru_utime.tv_usec / 1000000.0;
        double sys_time = (double)usage.ru_stime.tv_sec + (double)usage.ru_stime.tv_usec / 1000000.0;
        
        // Memory usage in KB (ru_maxrss is in KB on Linux)
        long max_rss = usage.ru_maxrss;

        // Output to stderr in the expected format for judgeService.js
        // Using %.3f for microsecond precision
        fprintf(stderr, "TIME_USED:%.3f+%.3f MEM_USED:%ld\n", user_time, sys_time, max_rss);

        // Exit with the same status as the child if possible
        if (WIFEXITED(status)) {
            return WEXITSTATUS(status);
        } else if (WIFSIGNALED(status)) {
            return 128 + WTERMSIG(status);
        }
    }

    return 0;
}
