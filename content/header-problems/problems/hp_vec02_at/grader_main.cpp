// SECRET grader main for hp_vec02_at. Never shipped to students.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so at() is interleaved with resize(),
//     clear(), operator[] and the copy operations, and out-of-range reads sit
//     between valid ones instead of coming in one batch at the end;
//   * it instantiates THREE different T (int, std::string, long long);
//   * it calls BOTH overloads: the non-const one through a mutable vector
//     (and assigns through the returned reference, which only compiles if it
//     really is a T&) and the const one through a const reference (which only
//     compiles if the const overload exists and is const-correct);
//   * it probes the three index regions that tell implementations apart:
//     inside the vector, inside the RESERVED capacity (index >= size() but
//     < capacity(), where mData[index] exists but is not an element), and far
//     outside. An at() that checks against mCap instead of mSize, or that
//     uses > instead of >=, is caught by the middle region;
//   * the whole-vector digest is computed THROUGH the const at(), so a wrong
//     at() shows up on every element, not only on the probes.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind q               kind: 1 = int, 2 = std::string, 3 = long long
//     q command lines:
//       1 n seed           resize to n and refill from `seed`
//       2 i                read element i through the non-const at()
//       3 i x              assign x through the non-const at()
//       4 i                read element i through the const at()
//       5 n                resize(n)
//       6                  clear()
//       7                  copy-constructor / assignment check
//       8                  digest of the whole vector, computed via at()
//       9                  print every element (small cases only)
//
// Every access command prints either the value (or "W" for a write) or "X"
// when std::out_of_range came out, so the stream of X's is itself the answer.

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

  // Const reference on purpose: the digest can only be built if at() has a
  // const overload returning a const T&.
  template <typename T>
  unsigned long long digest_via_at(const CP::vector<T> &v)
  {
    unsigned long long h = 1469598103934665603ULL;
    for (size_t i = 0; i < v.size(); ++i)
    {
      const T &element = v.at(i);
      h = mix(h, hash_of(element));
    }
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
    std::cout << "C " << copied.size() << ' ' << digest_via_at(copied);
    // One probe just past the end of the copy: the copy's reserved capacity
    // is usually non-empty, so this also re-checks the mSize/mCap boundary on
    // a freshly copied object.
    try
    {
      std::cout << ' ' << copied.at(copied.size()) << '\n';
    }
    catch (const std::out_of_range &)
    {
      std::cout << " X\n";
    }

    CP::vector<T> assigned;
    assigned = copied;
    std::cout << "A " << assigned.size() << ' ' << digest_via_at(assigned) << '\n';
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
        std::cout << "P " << v.size() << ' ' << v.capacity() << '\n';
        break;
      }
      case 2:
      {
        size_t i;
        std::cin >> i;
        try
        {
          std::cout << v.at(i) << '\n';
        }
        catch (const std::out_of_range &)
        {
          std::cout << "X\n";
        }
        break;
      }
      case 3:
      {
        size_t i;
        T value;
        std::cin >> i >> value;
        try
        {
          // Only compiles if at() returns a non-const reference.
          v.at(i) = value;
          std::cout << "W\n";
        }
        catch (const std::out_of_range &)
        {
          std::cout << "X\n";
        }
        break;
      }
      case 4:
      {
        size_t i;
        std::cin >> i;
        const CP::vector<T> &frozen = v;
        try
        {
          std::cout << frozen.at(i) << '\n';
        }
        catch (const std::out_of_range &)
        {
          std::cout << "X\n";
        }
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
        std::cout << "S " << v.size() << ' ' << digest_via_at(v) << '\n';
        break;
      case 9:
      {
        std::cout << 'L';
        for (size_t i = 0; i < v.size(); ++i)
          std::cout << ' ' << v.at(i);
        std::cout << '\n';
        break;
      }
      default:
        std::cerr << "unknown command " << op << '\n';
        return;
      }
    }

    std::cout << "E " << v.size() << ' ' << digest_via_at(v) << '\n';
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
