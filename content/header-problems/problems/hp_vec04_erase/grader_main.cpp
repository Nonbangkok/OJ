// SECRET grader main for hp_vec04_erase. Never shipped to students.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so erase() is interleaved with push_back(),
//     resize(), clear(), operator[] and the copy operations;
//   * it instantiates THREE different T (int, std::string, long long);
//   * the positions it asks for are not random noise: the generator aims them
//     at 0, at mSize - 1, at the middle, at mSize exactly, and far beyond the
//     end — so an erase that writes one element too far, or that treats an
//     out-of-range position as "erase the last one", is caught;
//   * `10 k pos` erases k times at the SAME position, which both buys a lot
//     of element movement per input byte and walks the position from inside
//     the vector to past its end within one command;
//   * capacity() is printed after every build and append: erase must not
//     reallocate;
//   * every block ends with a digest of the whole vector.
//
// Input format
//   B                      number of blocks
//   per block:
//     kind q               kind: 1 = int, 2 = std::string, 3 = long long
//     q command lines:
//       1 n seed           clear and push_back n elements from `seed`
//       2 pos              erase(pos)
//       3 i                print element i (taken modulo size)
//       4 k seed           push_back k more elements from `seed`
//       5 n                resize(n)
//       6                  clear()
//       7                  copy-constructor / assignment check
//       8                  digest of the whole vector
//       9                  print every element (small cases only)
//      10 k pos            call erase(pos) k times

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
    assigned.erase(0);
    assigned.erase(assigned.size());  // out of range: must be a no-op
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
      case 4:
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
          v.push_back(value);
        }
        std::cout << (op == 1 ? "P " : "B ") << v.size() << ' ' << v.capacity() << '\n';
        break;
      }
      case 2:
      {
        size_t pos;
        std::cin >> pos;
        v.erase(pos);
        std::cout << "D " << v.size() << '\n';
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
      case 10:
      {
        size_t count, pos;
        std::cin >> count >> pos;
        for (size_t i = 0; i < count; ++i)
          v.erase(pos);
        std::cout << "M " << v.size() << '\n';
        break;
      }
      default:
        std::cerr << "unknown command " << op << '\n';
        return;
      }
    }

    std::cout << "E " << v.size() << ' ' << v.capacity() << ' ' << digest(v) << '\n';
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
