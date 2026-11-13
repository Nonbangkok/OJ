// SECRET grader main for hp_vec01_fill. Never shipped to students: it goes
// into problem_files role 'grader', is written into the judge sandbox and is
// deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so fill() is interleaved with resize(),
//     operator[], clear() and the copy operations instead of being called
//     once at the end;
//   * it instantiates THREE different T (int, std::string, long long), so a
//     student.h that only works for int fails;
//   * a two-token `build` command manufactures up to a million elements from
//     a seed, so a 2 kB input can still demand a million assignments — the
//     stream does a lot of work per byte;
//   * every block ends with a digest of the WHOLE vector, so an
//     implementation that fills only part of it (say up to mCap instead of
//     mSize, or that stops one element short) cannot hide behind a few
//     spot checks.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind q               kind: 1 = int, 2 = std::string, 3 = long long
//     q command lines:
//       1 n seed           resize to n and refill from `seed`, print "P <size>"
//       2 x                fill(x)
//       3 i                print element i (i is taken modulo size)
//       4 i x              assign x to element i (i modulo size)
//       5 n                resize(n), print "R <size>"
//       6                  clear(), print "C <size> <empty>"
//       7                  copy-constructor / assignment check
//       8                  print "S <size> <digest>"
//       9                  print every element on one line
//
// Output: one line per printing command, then "E <size> <digest>" for the
// block.

#include "vector.h"
#include "student.h"

#include <iostream>
#include <string>

namespace
{

  // --- whole-vector digest -------------------------------------------------
  //
  // Printing a million elements would blow the testcase budget, so the big
  // cases are checked with an order-sensitive 64-bit digest instead. All of
  // the arithmetic is unsigned: the judge compiles with
  // -fsanitize=signed-integer-overflow -fno-sanitize-recover, so a signed
  // overflow anywhere in the grader would abort the run.
  unsigned long long mix(unsigned long long h, unsigned long long value)
  {
    h ^= value + 0x9e3779b97f4a7c15ULL + (h << 6) + (h >> 2);
    return h;
  }

  unsigned long long hash_of(int value) { return (unsigned long long)(long long)value; }
  unsigned long long hash_of(long long value) { return (unsigned long long)value; }
  unsigned long long hash_of(const std::string &value)
  {
    unsigned long long h = 1469598103934665603ULL;
    for (size_t i = 0; i < value.size(); ++i)
      h = (h ^ (unsigned long long)(unsigned char)value[i]) * 1099511628211ULL;
    return h;
  }

  // Taken by const reference on purpose: it only compiles if the const
  // operator[] and the const size() are usable, which is what the class
  // declares.
  template <typename T>
  unsigned long long digest(const CP::vector<T> &v)
  {
    unsigned long long h = 1469598103934665603ULL;
    for (size_t i = 0; i < v.size(); ++i)
      h = mix(h, hash_of(v[i]));
    return h;
  }

  // --- deterministic element factory --------------------------------------
  unsigned long long step(unsigned long long &state)
  {
    state = state * 6364136223846793005ULL + 1442695040888963407ULL;
    return state >> 17;
  }

  void make_value(unsigned long long &state, int &out)
  {
    out = (int)(step(state) % 2000001ULL) - 1000000;
  }

  void make_value(unsigned long long &state, long long &out)
  {
    out = (long long)(step(state) % 4000000001ULL) - 2000000000LL;
  }

  void make_value(unsigned long long &state, std::string &out)
  {
    size_t length = 1 + (size_t)(step(state) % 5ULL);
    out.assign(length, 'a');
    for (size_t i = 0; i < length; ++i)
      out[i] = (char)('a' + (int)(step(state) % 26ULL));
  }

  // --- copy check ---------------------------------------------------------
  //
  // The copy constructor and the copy assignment operator live in the header
  // and the student may not touch them, but an implementation that quietly
  // changes mSize or mCap while filling would show up here. The original is
  // passed by const reference and the block's final digest proves it was not
  // disturbed.
  template <typename T>
  void copy_check(const CP::vector<T> &v)
  {
    CP::vector<T> copied(v);
    std::cout << "C " << copied.size() << ' ' << digest(copied) << '\n';

    CP::vector<T> assigned;
    assigned = copied;
    T probe = T();
    if (assigned.size() > 0)
    {
      T first = assigned[0];
      assigned.fill(first);
      probe = assigned[assigned.size() - 1];
    }
    std::cout << "A " << assigned.size() << ' ' << digest(assigned) << ' ' << probe << '\n';
  }

  template <typename T>
  void run_block(size_t commands)
  {
    CP::vector<T> v;
    unsigned long long seed = 0;

    for (size_t c = 0; c < commands; ++c)
    {
      int op;
      if (!(std::cin >> op))
        break;
      switch (op)
      {
      case 1:
      {
        size_t n;
        unsigned long long given;
        std::cin >> n >> given;
        seed = given;
        v.resize(n);
        for (size_t i = 0; i < n; ++i)
        {
          T value;
          make_value(seed, value);
          v[i] = value;
        }
        std::cout << "P " << v.size() << '\n';
        break;
      }
      case 2:
      {
        T value;
        std::cin >> value;
        v.fill(value);
        break;
      }
      case 3:
      {
        size_t i;
        std::cin >> i;
        if (v.empty())
          std::cout << "-\n";
        else
          std::cout << v[i % v.size()] << '\n';
        break;
      }
      case 4:
      {
        size_t i;
        T value;
        std::cin >> i >> value;
        if (!v.empty())
          v[i % v.size()] = value;
        break;
      }
      case 5:
      {
        size_t n;
        std::cin >> n;
        v.resize(n);
        std::cout << "R " << v.size() << '\n';
        break;
      }
      case 6:
        v.clear();
        std::cout << "C " << v.size() << ' ' << (v.empty() ? 1 : 0) << '\n';
        break;
      case 7:
        copy_check(v);
        break;
      case 8:
        std::cout << "S " << v.size() << ' ' << digest(v) << '\n';
        break;
      case 9:
      {
        std::cout << 'L';
        for (size_t i = 0; i < v.size(); ++i)
          std::cout << ' ' << v[i];
        std::cout << '\n';
        break;
      }
      default:
        std::cerr << "unknown command " << op << '\n';
        return;
      }
    }

    std::cout << "E " << v.size() << ' ' << digest(v) << '\n';
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
    size_t commands;
    if (!(std::cin >> kind >> commands))
      return 0;
    switch (kind)
    {
    case 1:
      run_block<int>(commands);
      break;
    case 2:
      run_block<std::string>(commands);
      break;
    case 3:
      run_block<long long>(commands);
      break;
    default:
      std::cerr << "unknown block kind " << kind << '\n';
      return 0;
    }
  }
  return 0;
}
