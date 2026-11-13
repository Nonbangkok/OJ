// SECRET grader main for hp_vec07_range_insert. Never shipped to students.
//
// NOTE on the include order: <vector> comes BEFORE "vector.h" because the
// class declares range_insert(size_t, const std::vector<T>&), so std::vector
// must already be known when the class body is parsed. The starter's main.cpp
// does the same, which is why a student never has to add an #include of their
// own (rule 5 forbids it).
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so range_insert() is interleaved with
//     resize(), clear(), operator[] and the copy operations;
//   * it instantiates THREE different T (int, std::string, long long);
//   * the blocks of values are MANUFACTURED INSIDE THE GRADER from a seed, so
//     one short line of input inserts two hundred thousand elements;
//   * it inserts at the front, in the middle, at size() (an append) and past
//     the end (a no-op), and with an EMPTY block (also a no-op). Appending a
//     block is the easy direction — nothing has to move — so the cases that
//     decide the problem insert near the FRONT of a large vector;
//   * capacity() is never printed: how much room a student reserves is their
//     own business. Only size(), the element order and the clock are judged.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind q               kind: 1 = int, 2 = std::string, 3 = long long
//     q command lines:
//       1 n seed           resize to n and refill from `seed`
//       2 pos m seed       range_insert(pos, m values from `seed`)
//       3 i                print element i (taken modulo size)
//       4 m seed           range_insert(size(), m values)   (append a block)
//       5 n                resize(n)
//       6                  clear()
//       7                  copy-constructor / assignment check
//       8                  digest of the whole vector
//       9                  print every element (small cases only)
//      10 pos              range_insert(pos, {}) — an empty block
//      11 m seed           range_insert(0, m values)        (front block)

#include <vector>

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
  std::vector<T> make_block(size_t count, unsigned long long seed)
  {
    std::vector<T> values(count);
    for (size_t i = 0; i < count; ++i)
      make_value(seed, values[i]);
    return values;
  }

  template <typename T>
  void copy_check(const CP::vector<T> &v)
  {
    CP::vector<T> copied(v);
    std::cout << "C " << copied.size() << ' ' << digest(copied) << '\n';

    CP::vector<T> assigned;
    assigned = copied;
    std::vector<T> pair_of_values = make_block<T>(2, 777);
    assigned.range_insert(0, pair_of_values);
    assigned.range_insert(assigned.size(), pair_of_values);
    assigned.range_insert(assigned.size() + 5, pair_of_values);  // out of range: a no-op
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
        size_t pos, count;
        unsigned long long given;
        std::cin >> pos >> count >> given;
        std::vector<T> values = make_block<T>(count, given);
        v.range_insert(pos, values);
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
      case 4:
      {
        size_t count;
        unsigned long long given;
        std::cin >> count >> given;
        std::vector<T> values = make_block<T>(count, given);
        v.range_insert(v.size(), values);
        std::cout << "A " << v.size() << '\n';
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
        size_t pos;
        std::cin >> pos;
        std::vector<T> nothing;
        v.range_insert(pos, nothing);
        std::cout << "Z " << v.size() << '\n';
        break;
      }
      case 11:
      {
        size_t count;
        unsigned long long given;
        std::cin >> count >> given;
        std::vector<T> values = make_block<T>(count, given);
        v.range_insert(0, values);
        std::cout << "F " << v.size() << '\n';
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
