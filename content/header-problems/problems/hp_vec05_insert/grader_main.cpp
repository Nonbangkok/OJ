// SECRET grader main for hp_vec05_insert. Never shipped to students.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so insert() is interleaved with resize(),
//     clear(), operator[] and the copy operations;
//   * it instantiates THREE different T (int, std::string, long long);
//   * `10 k seed` appends k elements with insert(size(), x) and `11 k seed`
//     pushes k elements in at the front, so one short line buys a million
//     insertions. The appends are what separate an amortized O(1) growth
//     strategy from one that grows the array by a single slot each time;
//   * the positions asked for include 0, size() - 1, size() (an append) and
//     size() + something (which must be a no-op);
//   * it deliberately NEVER prints capacity(). How much room a student
//     reserves is their own business — only size() and the element order are
//     part of the answer — so an implementation that doubles, triples or
//     grows in blocks is equally acceptable as long as it is fast enough.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind q               kind: 1 = int, 2 = std::string, 3 = long long
//     q command lines:
//       1 n seed           clear, then append n elements from `seed`
//       2 pos x            insert(pos, x)
//       3 i                print element i (taken modulo size)
//       5 n                resize(n)
//       6                  clear()
//       7                  copy-constructor / assignment check
//       8                  digest of the whole vector
//       9                  print every element (small cases only)
//      10 k seed           append k elements with insert(size(), x)
//      11 k seed           insert k elements at position 0
//      12 k seed           insert k elements at positions derived from `seed`

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
    T value = T();
    if (assigned.size() > 0)
      value = assigned[0];
    assigned.insert(0, value);
    assigned.insert(assigned.size(), value);
    assigned.insert(assigned.size() + 3, value);  // out of range: a no-op
    std::cout << "A " << assigned.size() << ' ' << digest(assigned) << '\n';
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
      case 10:
      {
        size_t count;
        unsigned long long given;
        std::cin >> count >> given;
        seed = given;
        if (op == 1)
          v.clear();
        for (size_t i = 0; i < count; ++i)
        {
          T value;
          make_value(seed, value);
          v.insert(v.size(), value);
        }
        std::cout << (op == 1 ? "P " : "A ") << v.size() << '\n';
        break;
      }
      case 2:
      {
        size_t pos;
        T value;
        std::cin >> pos >> value;
        v.insert(pos, value);
        std::cout << "I " << v.size() << '\n';
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
      case 11:
      {
        size_t count;
        unsigned long long given;
        std::cin >> count >> given;
        seed = given;
        for (size_t i = 0; i < count; ++i)
        {
          T value;
          make_value(seed, value);
          v.insert(0, value);
        }
        std::cout << "F " << v.size() << '\n';
        break;
      }
      case 12:
      {
        size_t count;
        unsigned long long given;
        std::cin >> count >> given;
        seed = given;
        for (size_t i = 0; i < count; ++i)
        {
          T value;
          make_value(seed, value);
          size_t pos = (size_t)(step(seed) % (unsigned long long)(v.size() + 1));
          v.insert(pos, value);
        }
        std::cout << "M " << v.size() << '\n';
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
