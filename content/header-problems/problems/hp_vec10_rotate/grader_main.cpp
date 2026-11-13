// SECRET grader main for hp_vec10_rotate. Never shipped to students.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so rotate() is interleaved with resize(),
//     clear(), operator[] and (on the small blocks) the copy operations;
//   * it instantiates THREE different T (long long, int, std::string);
//   * `10 count seed` performs `count` rotations whose k comes from the seed
//     and is often LARGER than size(), so k % size() has to be handled;
//   * the big block is built with ONE resize(n) and then only ever shrinks,
//     so the vector's own buffer is exactly n elements and the whole process
//     sits around 22 MB of the 32 MB limit. That headroom is the point of
//     this problem: a rotation that allocates a temporary copy of the data
//     needs another 16 MB and goes over the limit;
//   * the copy-check command is only used on the small blocks, precisely
//     because a second copy of a 2,000,000-element vector would blow the
//     memory limit all by itself — the grader must not spend the budget the
//     student needs;
//   * `4` rotates by exactly size(), which must be a no-op;
//   * every block ends with a digest of the whole vector, so a rotation that
//     is off by one, or that loses an element into a hole, is caught.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind q               kind: 1 = int, 2 = std::string, 3 = long long
//     q command lines:
//       1 n seed           resize to n and refill from `seed`
//       2 k                rotate(k)
//       3 i                print element i (taken modulo size)
//       4                  rotate(size())  — a no-op
//       5 n                resize(n)
//       6                  clear()
//       7                  copy-constructor / assignment check (small blocks)
//       8                  digest of the whole vector
//       9                  print every element (small cases only)
//      10 count seed       count rotations with k taken from `seed`

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

  template <typename T>
  void copy_check(const CP::vector<T> &v)
  {
    CP::vector<T> copied(v);
    std::cout << "C " << copied.size() << ' ' << digest(copied) << '\n';

    CP::vector<T> assigned;
    assigned = copied;
    assigned.rotate(1);
    assigned.rotate(assigned.size());          // a no-op
    assigned.rotate(assigned.size() * 3 + 2);  // k far larger than the size
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
        size_t n;
        unsigned long long seed;
        std::cin >> n >> seed;
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
        size_t k;
        std::cin >> k;
        v.rotate(k);
        std::cout << "T " << v.size() << '\n';
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
        v.rotate(v.size());
        std::cout << "F " << v.size() << '\n';
        break;
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
        size_t count;
        unsigned long long seed;
        std::cin >> count >> seed;
        for (size_t i = 0; i < count; ++i)
        {
          size_t span = v.size() + 1;
          size_t k = (size_t)(step(seed) % (unsigned long long)(2 * span));
          v.rotate(k);
        }
        std::cout << "M " << count << ' ' << v.size() << '\n';
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
