/**
 * Reference template for multi-file generators. Mirrors the runner contract:
 * write 1–1000 .txt files into ./input/, read the seed from argv[1] (or
 * OJ_SEED) so reruns with the same seed reproduce the same files, exit 0.
 */
export const GENERATOR_TEMPLATE = `#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main(int argc, char** argv) {
    // The system passes the seed as argv[1] (e.g. "12345"); using it makes
    // "Generate inputs" reproducible — same seed, same testcases.
    mt19937_64 gen(argc > 1 ? stoull(argv[1]) : 12345ULL);
    uniform_int_distribution<ll> ranN(1, 100);

    // Files must be written into input/ (1–1000 files) — the runner collects
    // them as the draft's testcases. Opening a path whose parent folder does
    // not exist fails silently, so check the stream before writing.
    for (int i = 1; i <= 2; i++) {
        ofstream fout("input/input" + to_string(i) + ".txt");
        if (!fout) { cerr << "cannot open input " << i << endl; return 1; }

        ll n = ranN(gen);
        fout << n << "\\n";
        for (ll j = 0; j < n; j++) fout << gen() % 1000 << "\\n";
    }
    return 0;
}
`;
