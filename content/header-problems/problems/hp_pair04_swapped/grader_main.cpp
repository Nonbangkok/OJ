// SECRET grader main for hp_pair04_swapped. Never shipped to students: it goes
// into problem_files role 'grader', is written into the judge sandbox, and is
// deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so swapped() is interleaved with round_trip,
//     become, copy assignment, copy construction and plain field reads;
//   * it instantiates THREE pair types — pair<int,std::string>,
//     pair<std::string,long long> and pair<int,int>. The first two are
//     asymmetric, so a swapped() that returns pair<T1,T2> instead of
//     pair<T2,T1> does not even compile; the third is symmetric, which is the
//     one case where a wrong-but-compiling version could hide, and it is
//     checked against the same logic as the others;
//   * it nests the call: swapping a swap (round_trip), swapping a COPY of a
//     swap (twice), and feeding a swap into become — all of which instantiate
//     swapped() on pair<T2,T1> as well as on pair<T1,T2>;
//   * `raw` prints the original components after the swaps, so a swapped()
//     that mutates *this (it is declared const, but a student may cast that
//     away) is caught;
//   * every block ends by hashing the swap of every element in the array.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind n q             kind: 1 = pair<int,std::string>,
//                                2 = pair<std::string,long long>,
//                                3 = pair<int,int>
//     n lines: a b         the initial array, built with the two-argument ctor
//     q command lines:
//       1 i                swap   : print A[i].swapped()
//       2 i                trip   : print A[i].round_trip()
//       3 i j              become : A[i].become(A[j].swapped()), then print A[i]
//       4 i a b            assign : A[i] = pair(a, b), then print its swap
//       5 i                twice  : swap a copy of A[i].swapped() back
//       6 i                raw    : print A[i].first and A[i].second
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

  // FNV-1a over the streamed text of every swapped element. Unsigned on
  // purpose: the judge compiles with -fsanitize=signed-integer-overflow, and
  // unsigned wrap-around is well defined.
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

  // Taken by const reference on purpose: this only compiles if swapped() is a
  // const member function, which is what the class declares.
  template <typename T1, typename T2>
  void print_swap(const CP::pair<T1, T2> &p)
  {
    CP::pair<T2, T1> flipped = p.swapped();
    std::cout << flipped.first << ' ' << flipped.second << '\n';
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
        size_t i;
        std::cin >> i;
        print_swap(a[i]);
        break;
      }
      case 2:
      {
        size_t i;
        std::cin >> i;
        CP::pair<T1, T2> back = a[i].round_trip();
        std::cout << "T " << back.first << ' ' << back.second << '\n';
        break;
      }
      case 3:
      {
        size_t i, j;
        std::cin >> i >> j;
        a[i].become(a[j].swapped());
        std::cout << "B " << a[i].first << ' ' << a[i].second << '\n';
        break;
      }
      case 4:
      {
        size_t i;
        T1 first;
        T2 second;
        std::cin >> i >> first >> second;
        a[i] = CP::pair<T1, T2>(first, second);
        print_swap(a[i]);
        break;
      }
      case 5:
      {
        size_t i;
        std::cin >> i;
        CP::pair<T2, T1> flipped(a[i].swapped());
        CP::pair<T1, T2> back = flipped.swapped();
        std::cout << "W " << back.first << ' ' << back.second << '\n';
        break;
      }
      case 6:
      {
        size_t i;
        std::cin >> i;
        std::cout << "R " << a[i].first << ' ' << a[i].second << '\n';
        break;
      }
      default:
        std::cerr << "unknown command " << op << '\n';
        return;
      }
    }

    std::ostringstream sweep;
    for (size_t i = 0; i < a.size(); ++i)
    {
      CP::pair<T2, T1> flipped = a[i].swapped();
      sweep << flipped.first << '|' << flipped.second << ';';
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
      run_block<int, std::string>(n, commands);
      break;
    case 2:
      run_block<std::string, long long>(n, commands);
      break;
    case 3:
      run_block<int, int>(n, commands);
      break;
    default:
      std::cerr << "unknown block kind " << kind << '\n';
      return 0;
    }
  }
  return 0;
}
