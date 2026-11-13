// SECRET grader main for hp_pair09_accumulate. Never shipped to students: it
// goes into problem_files role 'grader', is written into the judge sandbox,
// and is deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so += is interleaved with the header's +,
//     absorb_twice, copy assignment and copy construction;
//   * it instantiates THREE pair types (pair<int,int>,
//     pair<long long,std::string> and pair<std::string,std::string>), so a
//     student.h that only works for numbers fails;
//   * `chain` evaluates p += q += r and `twice` evaluates (p += q) += q.
//     Both only give the right answer if += updates *this AND hands back a
//     reference to it, so the "returns *this" half of the contract is checked
//     rather than assumed;
//   * `agree` prints A[i] + A[j] next to a copy of A[i] that was += A[j].
//     The header writes + in terms of +=, so the two must match character for
//     character;
//   * `acc` is the hot command and prints nothing: it folds array elements
//     into one of four accumulators. The large cases aim almost all of their
//     commands at ONE accumulator, so its string component grows to hundreds
//     of thousands of characters. A += that builds a new pair and assigns it
//     back copies that whole string every time — O(q*L) in total against the
//     reference's O(L) — and runs out of time;
//   * `show` reports the LENGTH and a hash of each component instead of the
//     component itself, so a 300 KB accumulator costs a few bytes of expected
//     output and the testcases stay inside the archive budget;
//   * the array A is never modified, so component values stay inside the
//     statement's bounds however long the stream is.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind n q             kind: 1 = pair<int,int>,
//                                2 = pair<long long,std::string>,
//                                3 = pair<std::string,std::string>
//     n lines: a b         the read-only array, built with the two-arg ctor
//     q command lines:
//       1 k i              acc    : S[k] += A[i]
//       2 k                show   : print length and hash of both components
//       3 i j k            chain  : p += q += r over local copies
//       4 i j              twice  : (p += A[j]) += A[j] over a local copy
//       5 i j              agree  : A[i] + A[j] against a copy of A[i] += A[j]
//       6 k                reset  : S[k] = pair()
//       7 i j              absorb : p.absorb_twice(A[j]) over a local copy
//
// Output: one line per printing command, then one "E <k> ..." line per
// accumulator at the end of the block.

#include "pair.h"
#include "student.h"

#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace
{

  const size_t ACCUMULATORS = 4;

  // FNV-1a. Unsigned on purpose: the judge compiles with
  // -fsanitize=signed-integer-overflow, and unsigned wrap-around is well
  // defined.
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

  // Length plus hash of a component's printed form. Works the same way for a
  // number and for a 300 KB string, which is what keeps the expected output
  // small while still pinning down the exact accumulated value.
  template <typename C>
  void print_component_digest(const C &value)
  {
    std::ostringstream text;
    text << value;
    const std::string rendered = text.str();
    std::cout << ' ' << rendered.size() << ':' << digest_of(rendered);
  }

  template <typename T1, typename T2>
  void print_digest_line(char tag, size_t index, const CP::pair<T1, T2> &p)
  {
    std::cout << tag << ' ' << index;
    print_component_digest(p.first);
    print_component_digest(p.second);
    std::cout << '\n';
  }

  template <typename T1, typename T2>
  void print_pair(const CP::pair<T1, T2> &p)
  {
    std::cout << p.first << ' ' << p.second;
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

    std::vector<CP::pair<T1, T2>> accumulators(ACCUMULATORS);

    for (size_t step = 0; step < commands; ++step)
    {
      int op;
      if (!(std::cin >> op))
        break;
      switch (op)
      {
      case 1:
      {
        size_t k, i;
        std::cin >> k >> i;
        accumulators[k % ACCUMULATORS] += a[i];
        break;
      }
      case 2:
      {
        size_t k;
        std::cin >> k;
        print_digest_line('H', k % ACCUMULATORS, accumulators[k % ACCUMULATORS]);
        break;
      }
      case 3:
      {
        size_t i, j, k;
        std::cin >> i >> j >> k;
        CP::pair<T1, T2> p(a[i]);
        CP::pair<T1, T2> q(a[j]);
        CP::pair<T1, T2> r(a[k]);
        p += q += r;
        std::cout << "C ";
        print_pair(p);
        std::cout << " | ";
        print_pair(q);
        std::cout << " | ";
        print_pair(r);
        std::cout << '\n';
        break;
      }
      case 4:
      {
        size_t i, j;
        std::cin >> i >> j;
        CP::pair<T1, T2> p(a[i]);
        (p += a[j]) += a[j];
        std::cout << "T ";
        print_pair(p);
        std::cout << '\n';
        break;
      }
      case 5:
      {
        size_t i, j;
        std::cin >> i >> j;
        CP::pair<T1, T2> viaplus = a[i] + a[j];
        CP::pair<T1, T2> viaassign(a[i]);
        viaassign += a[j];
        std::cout << "G ";
        print_pair(viaplus);
        std::cout << " | ";
        print_pair(viaassign);
        std::cout << '\n';
        break;
      }
      case 6:
      {
        size_t k;
        std::cin >> k;
        accumulators[k % ACCUMULATORS] = CP::pair<T1, T2>();
        std::cout << "R " << (k % ACCUMULATORS) << '\n';
        break;
      }
      case 7:
      {
        size_t i, j;
        std::cin >> i >> j;
        CP::pair<T1, T2> p(a[i]);
        CP::pair<T1, T2> &result = p.absorb_twice(a[j]);
        std::cout << "A ";
        print_pair(result);
        std::cout << ' ' << (&result == &p ? 1 : 0) << '\n';
        break;
      }
      default:
        std::cerr << "unknown command " << op << '\n';
        return;
      }
    }

    for (size_t k = 0; k < ACCUMULATORS; ++k)
      print_digest_line('E', k, accumulators[k]);
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
      run_block<int, int>(n, commands);
      break;
    case 2:
      run_block<long long, std::string>(n, commands);
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
