// SECRET grader main for hp_vec08_block_swap. Never shipped to students.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so block_swap() is interleaved with
//     resize(), clear(), operator[] and the copy operations;
//   * it instantiates THREE different T (int, std::string, long long);
//   * `10 count seed maxlen` performs `count` swaps whose (i, j, len) are
//     manufactured INSIDE the grader — always valid and always short — so one
//     short line of input buys twenty thousand calls on a million-element
//     vector. That is the shape that separates an O(len) swap from one that
//     touches the whole vector;
//   * the explicit `2 i j len` commands are the opposite: they carry the
//     awkward arguments on purpose — len == 0, i == j, overlapping ranges,
//     i + len or j + len past the end, len > size — every one of which must
//     leave the vector exactly as it was;
//   * `4` swaps the two halves (len == size / 2), the largest legal swap;
//   * every block ends with a digest of the whole vector, so a swap that
//     duplicates one block over the other instead of exchanging them is
//     caught immediately.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind q               kind: 1 = int, 2 = std::string, 3 = long long
//     q command lines:
//       1 n seed           resize to n and refill from `seed`
//       2 i j len          block_swap(i, j, len) with the given arguments
//       3 i                print element i (taken modulo size)
//       4                  swap the two halves of the vector
//       5 n                resize(n)
//       6                  clear()
//       7                  copy-constructor / assignment check
//       8                  digest of the whole vector
//       9                  print every element (small cases only)
//      10 count seed maxlen  count generated valid swaps, len <= maxlen

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
    if (assigned.size() >= 4)
    {
      size_t len = assigned.size() / 4;
      assigned.block_swap(0, assigned.size() - len, len);
      assigned.block_swap(0, len - (len > 0 ? 1 : 0), len);  // overlapping: a no-op
    }
    std::cout << "A " << assigned.size() << ' ' << digest(assigned) << '\n';
  }

  // Generated swaps are valid by construction: `a` and `b` are at least `len`
  // apart and b + len never passes the end.
  template <typename T>
  void generated_swaps(CP::vector<T> &v, size_t count, unsigned long long seed, size_t maxlen)
  {
    for (size_t c = 0; c < count; ++c)
    {
      size_t size = v.size();
      if (size < 2)
        return;
      size_t limit = size / 2;
      if (maxlen < limit)
        limit = maxlen;
      if (limit == 0)
        return;
      size_t len = 1 + (size_t)(step(seed) % (unsigned long long)limit);
      size_t room = size - 2 * len;
      size_t a = (size_t)(step(seed) % (unsigned long long)(room + 1));
      size_t b = a + len + (size_t)(step(seed) % (unsigned long long)(room - a + 1));
      v.block_swap(a, b, len);
    }
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
        size_t i, j, len;
        std::cin >> i >> j >> len;
        v.block_swap(i, j, len);
        std::cout << "B " << v.size() << '\n';
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
        size_t len = v.size() / 2;
        v.block_swap(0, v.size() - len, len);
        std::cout << "H " << len << ' ' << v.size() << '\n';
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
        size_t count, maxlen;
        unsigned long long given;
        std::cin >> count >> given >> maxlen;
        generated_swaps(v, count, given, maxlen);
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
