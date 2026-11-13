// SECRET grader main for hp_vec09_compress. Never shipped to students.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so compress() is interleaved with
//     push_back(), resize(), clear(), operator[] and the copy operations;
//   * it instantiates THREE different T (int, std::string, long long), so the
//     comparison has to be T's own operator== and not something numeric;
//   * `1 n seed runlen` manufactures n elements in RUNS of about `runlen`
//     equal values, so one short line of input produces a million elements
//     with a controlled amount of duplication: runlen 1 gives an almost
//     all-distinct vector (nothing to remove), runlen n gives an all-equal
//     one (everything but the first element goes);
//   * `10` calls compress() TWICE in a row: the second call must change
//     nothing, which catches an implementation that merges runs it should not
//     or that keeps a stale element at the end;
//   * resize() upwards fills the new slots with T(), i.e. it creates a fresh
//     run of equal values at the end on purpose;
//   * every block ends with a digest of the whole vector, so keeping one
//     element too many (or one too few) at a run boundary is caught.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind q               kind: 1 = int, 2 = std::string, 3 = long long
//     q command lines:
//       1 n seed runlen    rebuild: n elements in runs of about runlen
//       2                  compress()
//       3 i                print element i (taken modulo size)
//       4 k x              push_back the same value x, k times
//       5 n                resize(n)
//       6                  clear()
//       7                  copy-constructor / assignment check
//       8                  digest of the whole vector
//       9                  print every element (small cases only)
//      10                  compress() twice (idempotence)

#include "vector.h"
#include "student.h"

#include <iostream>
#include <string>

namespace
{

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

  template <typename T>
  unsigned long long digest(const CP::vector<T> &v)
  {
    unsigned long long h = 1469598103934665603ULL;
    for (size_t i = 0; i < v.size(); ++i)
      h = mix(h, hash_of(v[i]));
    return h;
  }

  unsigned long long step(unsigned long long &state)
  {
    state = state * 6364136223846793005ULL + 1442695040888963407ULL;
    return state >> 17;
  }

  // Deliberately a SMALL value space: short runs plus a narrow alphabet mean
  // run boundaries where two neighbouring runs happen to carry the same value
  // are common, which is the case a "remove every duplicate value" solution
  // (as opposed to every ADJACENT duplicate) gets wrong.
  void make_value(unsigned long long &state, int &out)
  {
    out = (int)(step(state) % 7ULL) - 3;
  }

  void make_value(unsigned long long &state, long long &out)
  {
    out = (long long)(step(state) % 9ULL) - 4;
  }

  void make_value(unsigned long long &state, std::string &out)
  {
    static const char *words[6] = {"a", "bb", "ccc", "dd", "e", "ffff"};
    out = words[(size_t)(step(state) % 6ULL)];
  }

  template <typename T>
  void copy_check(const CP::vector<T> &v)
  {
    CP::vector<T> copied(v);
    std::cout << "C " << copied.size() << ' ' << digest(copied) << '\n';

    CP::vector<T> assigned;
    assigned = copied;
    if (assigned.size() > 0)
    {
      T last = assigned[assigned.size() - 1];
      assigned.push_back(last);
      assigned.push_back(last);
    }
    assigned.compress();
    std::cout << "A " << assigned.size() << ' ' << digest(assigned) << '\n';
  }

  template <typename T>
  void run_block(size_t commands)
  {
    CP::vector<T> v;

    for (size_t c = 0; c < commands; ++c)
    {
      int op;
      if (!(std::cin >> op))
        break;
      switch (op)
      {
      case 1:
      {
        size_t n, runlen;
        unsigned long long seed;
        std::cin >> n >> seed >> runlen;
        if (runlen == 0)
          runlen = 1;
        v.resize(n);
        T current = T();
        size_t left = 0;
        for (size_t i = 0; i < n; ++i)
        {
          if (left == 0)
          {
            make_value(seed, current);
            left = 1 + (size_t)(step(seed) % (unsigned long long)(2 * runlen));
          }
          v[i] = current;
          left--;
        }
        std::cout << "P " << v.size() << '\n';
        break;
      }
      case 2:
        v.compress();
        std::cout << "K " << v.size() << '\n';
        break;
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
        size_t count;
        T value;
        std::cin >> count >> value;
        for (size_t i = 0; i < count; ++i)
          v.push_back(value);
        std::cout << "B " << v.size() << '\n';
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
      case 10:
      {
        v.compress();
        size_t once = v.size();
        unsigned long long after_once = digest(v);
        v.compress();
        std::cout << "I " << once << ' ' << after_once << ' ' << v.size()
                  << ' ' << digest(v) << '\n';
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
