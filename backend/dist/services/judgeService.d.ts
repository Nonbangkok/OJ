export function judge(problemId: any, executablePath: any): Promise<{
    overallStatus: "System Error";
    score: number;
    results: {
        testCase: number;
        status: string;
    }[];
    maxTimeMs?: undefined;
    maxMemoryKb?: undefined;
} | {
    results: ({
        testCase: any;
        status: any;
        timeMs: any;
        memoryKb: any;
        output: any;
    } | {
        testCase: any;
        status: "Skipped";
        timeMs?: undefined;
        memoryKb?: undefined;
        output?: undefined;
    })[];
    score: number;
    overallStatus: any;
    maxTimeMs: number;
    maxMemoryKb: number;
}>;
