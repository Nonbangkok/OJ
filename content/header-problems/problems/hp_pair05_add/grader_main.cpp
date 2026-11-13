// SECRET grader main for hp_pair05_add. Never shipped to students: it goes
// into problem_files role 'grader', is written into the judge sandbox, and is
// deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so + is interleaved with doubled,
//     plus_twice, copy assignment and temporaries;
//   * it instantiates THREE pair types — pair<long long,long long>,
//     pair<int,std::string> and pair<std::string,std::string>. With a string
//     component, + is concatenation and is NOT commutative, so an operator+
//     that swaps the operands (other.second + second) passes the numeric
//     blocks and fails here;
//   * `chain` evaluates (A[i] + A[j]) + (A[j] + A[i]) in one expression,
//     which both adds the result of an addition and makes the operand order
//     visible in the output;
//   * `zero` adds the default-constructed pair, the identity element for both
//     kinds of component, so an implementation that drops or duplicates a
//     component shows up immediately;
//   * it calls the pre-existing member the student may have edited (doubled)
//     and the one the header defines on top of their + (plus_twice), so an
//     edit that breaks either is caught;
//   * every block ends by hashing the sum of every adjacent pair in the
//     array, which touches all n elements in O(n) total.
//
// Sums are never stored back into the array, so component values stay inside
// the statement's bounds no matter how long the command stream is.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind n q             kind: 1 = pair<long long,long long>,
//                                2 = pair<int,std::string>,
//                                3 = pair<std::string,std::string>
//     n lines: a b         the initial array, built with the two-argument ctor
//     q command lines:
//       1 i j              add    : print A[i] + A[j]
//       2 i                dbl    : print A[i].doubled()
//       3 i j              twice  : print A[i].plus_twice(A[j])
//       4 i a b            assign : A[i] = pair(a, b), then print A[i] + A[i]
//       5 i                zero   : print A[i] + pair()
//       6 i j              chain  : print (A[i] + A[j]) + (A[j] + A[i])
//
// Output: one line per printing command, then "S <size> <hash>" for the
// block's closing sweep.

#include "pair.h"
#include "student.h"

#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace
{

  // FNV-1a over the streamed text of the sweep. Unsigned on purpose: the
  // judge compiles with -fsanitize=signed-integer-overflow, and unsigned
  // wrap-around is well defined.
  unsigned long long digest_of(const std::string &text)
  {
    unsigned long long hash = 1469598103934665603ULL;
    for (unsigned char byte : text)
    {
      hash ^= byte;
      hash *= 1099511628211ULL;
    }
    return hash;
  }

  template <typename T1, typename T2>
  void print_pair(char tag, const CP::pair<T1, T2> &p)
  {
    std::cout << tag << ' ' << p.first << ' ' << p.second << '\n';
  }

  template <typename T1, typename T2>
  void run_block(size_t n, size_t commands)
  {
    std::vector<CP::pair<T1, T2>> a;
    a.reserve(n);
    for (size_t i = 0; i < n; ++i)
    {
      T1 first;
      T2 second;
      std::cin >> first >> second;
      a.push_back(CP::pair<T1, T2>(first, second));
    }

    for (size_t step = 0; step < commands; ++step)
    {
      int op;
      if (!(std::cin >> op))
        break;
      switch (op)
      {
      case 1:
      {
        size_t i, j;
        std::cin >> i >> j;
        print_pair('A', a[i] + a[j]);
        break;
      }
      case 2:
      {
        size_t i;
        std::cin >> i;
        print_pair('D', a[i].doubled());
        break;
      }
      case 3:
      {
        size_t i, j;
        std::cin >> i >> j;
        print_pair('P', a[i].plus_twice(a[j]));
        break;
      }
      case 4:
      {
        size_t i;
        T1 first;
        T2 second;
        std::cin >> i >> first >> second;
        a[i] = CP::pair<T1, T2>(first, second);
        print_pair('N', a[i] + a[i]);
        break;
      }
      case 5:
      {
        size_t i;
        std::cin >> i;
        print_pair('Z', a[i] + CP::pair<T1, T2>());
        break;
      }
      case 6:
      {
        size_t i, j;
        std::cin >> i >> j;
        print_pair('C', (a[i] + a[j]) + (a[j] + a[i]));
        break;
      }
      default:
        std::cerr << "unknown command " << op << '\n';
        return;
      }
    }

    std::ostringstream sweep;
    for (size_t i = 0; i + 1 < a.size(); ++i)
    {
      CP::pair<T1, T2> sum = a[i] + a[i + 1];
      sweep << sum.first << '|' << sum.second << ';';
    }
    std::cout << "S " << a.size() << ' ' << digest_of(sweep.str()) << '\n';
  }

} // namespace

int main()
{
  std::ios_base::sync_with_stdio(false);
  std::cin.tie(nullptr);

  int blocks;
  if (!(std::cin >> blocks))
    return 0;

  for (int b = 0; b < blocks; ++b)
  {
    int kind;
    size_t n, commands;
    if (!(std::cin >> kind >> n >> commands))
      return 0;
    switch (kind)
    {
    case 1:
      run_block<long long, long long>(n, commands);
      break;
    case 2:
      run_block<int, std::string>(n, commands);
      break;
    case 3:
      run_block<std::string, std::string>(n, commands);
      break;
    default:
      std::cerr << "unknown block kind " << kind << '\n';
      return 0;
    }
  }
  return 0;
}
