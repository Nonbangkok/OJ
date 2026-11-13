// SECRET grader main for hp_pq09_merge. Never shipped to students: it goes into
// problem_files role 'grader', is written into the judge sandbox, and is
// deleted again before the student's binary runs.
//
// It differs from starter_main.cpp on purpose:
//   * it reads a COMMAND STREAM, so merge() is interleaved with push/pop/top/
//     size instead of being called once at the end;
//   * it instantiates the class with four different <T, Comp> pairs, two of
//     which are NOT std::less: a min-heap over int, and a total order over a
//     struct that has no operator< at all. A student.h that compares with `<`
//     instead of the heap's own mLess therefore either answers the min-heap
//     blocks wrongly or does not compile at all;
//   * it exercises the members the student never edits (copy constructor,
//     copy assignment, push, pop, top, size, empty) around the target;
//   * the big blocks build ONE template heap of several hundred thousand
//     elements and then merge a fresh copy of it over and over, so the cost
//     measured is the merge itself and not the building of the input;
//   * those templates are filled from a tiny value span, so equally important
//     elements are everywhere: that is exactly when fixUp carries a pushed
//     element all the way to the root, and a merge written as m pushes costs
//     m*log(n+m) instead of O(n+m);
//   * every merge prints the size of BOTH heaps, the new top and the
//     heap-property flag, so forgetting to empty `other`, or leaving the
//     array un-heapified, is caught on the spot.

#include "priority_queue.h"
#include "student.h"

#include <functional>
#include <iostream>

namespace
{

  const char EMPTY_MARK = '-';
  const char THREW_MARK = 'X';

  // ---- element types ------------------------------------------------------

  // Item has NO operator< on purpose: inside the class the only way to compare
  // two of them is the comparator object mLess, so `a < b` in a submission
  // breaks the build for these blocks instead of silently working.
  struct Item
  {
    long long w;
    long long id;
  };

  std::istream &operator>>(std::istream &in, Item &item) { return in >> item.w >> item.id; }

  std::ostream &operator<<(std::ostream &out, const Item &item)
  {
    return out << item.w << ':' << item.id;
  }

  struct ItemOrder
  {
    // A TOTAL order: two Items are equivalent only when they are identical, so
    // the expected output can never depend on which of two "equal" elements a
    // correct submission happens to pick.
    bool operator()(const Item &a, const Item &b) const
    {
      return a.w != b.w ? a.w < b.w : a.id > b.id;
    }
  };

  unsigned long long mix(int value)
  {
    return (unsigned long long)(unsigned int)value * 0x9E3779B97F4A7C15ULL;
  }

  unsigned long long mix(long long value)
  {
    return (unsigned long long)value * 0x9E3779B97F4A7C15ULL;
  }

  unsigned long long mix(const Item &value)
  {
    return (unsigned long long)value.w * 0x9E3779B97F4A7C15ULL +
           (unsigned long long)value.id * 0xBF58476D1CE4E5B9ULL;
  }

  // ---- procedural data ----------------------------------------------------

  // A `fill` command turns twenty bytes of input into a million pushes, which
  // is how the large cases stay far inside the per-problem testcase budget.
  struct Lcg
  {
    unsigned long long state;

    explicit Lcg(unsigned long long seed)
        : state(seed * 6364136223846793005ULL + 1442695040888963407ULL) {}

    unsigned long long next()
    {
      state = state * 6364136223846793005ULL + 1442695040888963407ULL;
      return state >> 17;
    }
  };

  // `span` is the size of the value universe: a small span means many ties,
  // which is what makes fixUp climb all the way to the root.
  template <typename T>
  T spread(unsigned long long raw, long long span);

  template <>
  int spread<int>(unsigned long long raw, long long span)
  {
    return (int)((long long)(raw % (unsigned long long)span) - span / 2);
  }

  template <>
  long long spread<long long>(unsigned long long raw, long long span)
  {
    return (long long)(raw % (unsigned long long)span) - span / 2;
  }

  template <>
  Item spread<Item>(unsigned long long raw, long long span)
  {
    Item item;
    item.w = (long long)(raw % (unsigned long long)span) - span / 2;
    item.id = (long long)((raw / (unsigned long long)span) % 1000ULL);
    return item;
  }

  // ---- shared command helpers --------------------------------------------

  // Taken by const reference on purpose: this only compiles while top() and
  // size() are const member functions, which is what the class declares.
  template <typename T, typename Comp>
  void print_top(const CP::priority_queue<T, Comp> &heap)
  {
    if (heap.empty())
      std::cout << EMPTY_MARK << '\n';
    else
      std::cout << heap.top() << '\n';
  }

  template <typename T, typename Comp>
  void fill(CP::priority_queue<T, Comp> &heap, size_t count, unsigned long long seed, long long span)
  {
    Lcg random(seed);
    for (size_t i = 0; i < count; i++)
      heap.push(spread<T>(random.next(), span));
  }

  // The copy constructor and the copy assignment must carry the whole heap.
  // Draining the COPY in priority order and hashing it checks the entire
  // order rather than the root alone, and the original has to survive
  // untouched — which the block's own epilogue then verifies.
  template <typename T, typename Comp>
  void copy_check(const CP::priority_queue<T, Comp> &heap)
  {
    CP::priority_queue<T, Comp> copied(heap);
    CP::priority_queue<T, Comp> assigned;
    assigned = copied;

    unsigned long long hash = 1469598103934665603ULL;
    size_t count = assigned.size();
    while (!assigned.empty())
    {
      hash = hash * 1099511628211ULL + mix(assigned.top());
      assigned.pop();
    }
    std::cout << "C " << count << ' ' << hash << '\n';
  }

  // Every block ends here. `limit` elements are popped in priority order and
  // hashed (the first few are printed as well), so a target that produced the
  // right answer while leaving the array corrupted is caught even when
  // nothing printed it at the time.
  template <typename T, typename Comp>
  void finish(CP::priority_queue<T, Comp> &heap, size_t limit)
  {
    std::cout << "E " << heap.size() << ' ' << (heap.heap_ok() ? 1 : 0);
    unsigned long long hash = 1469598103934665603ULL;
    size_t drained = 0;
    while (!heap.empty() && drained < limit)
    {
      if (drained < 40)
        std::cout << ' ' << heap.top();
      hash = hash * 1099511628211ULL + mix(heap.top());
      heap.pop();
      drained++;
    }
    std::cout << " # " << drained << ' ' << hash << ' ' << heap.size() << '\n';
  }

  // Replace a heap with an empty one. `operator=` takes its argument by
  // value, so this also exercises the copy constructor and the copy-and-swap
  // assignment the student never sees.
  template <typename T, typename Comp>
  void reset(CP::priority_queue<T, Comp> &heap)
  {
    CP::priority_queue<T, Comp> empty;
    heap = empty;
  }

  template <typename T, typename Comp>
  void report_merge(const CP::priority_queue<T, Comp> &heap,
                    const CP::priority_queue<T, Comp> &other)
  {
    std::cout << "M " << heap.size() << ' ' << other.size() << ' '
              << (heap.heap_ok() ? 1 : 0) << ' ';
    if (heap.empty())
      std::cout << EMPTY_MARK << '\n';
    else
      std::cout << heap.top() << '\n';
  }

  // ---- the command stream -------------------------------------------------

  template <typename T, typename Comp>
  void run_block(size_t commands, size_t drain)
  {
    CP::priority_queue<T, Comp> heap;
    // Two heaps kept aside so that a big merge can be repeated without
    // paying to rebuild its operands every time.
    CP::priority_queue<T, Comp> first_template;
    CP::priority_queue<T, Comp> second_template;
    for (size_t index = 0; index < commands; index++)
    {
      int op;
      if (!(std::cin >> op))
        break;
      switch (op)
      {
        case 1:
        {
          T value;
          std::cin >> value;
          heap.push(value);
          break;
        }
        case 2:
          if (!heap.empty())
            heap.pop();
          break;
        case 3:
          print_top(heap);
          break;
        case 4:
          std::cout << heap.size() << '\n';
          break;
        case 5:
        {
          size_t count;
          unsigned long long seed;
          long long span;
          std::cin >> count >> seed >> span;
          fill(heap, count, seed, span);
          break;
        }
        case 6:
          copy_check(heap);
          break;
        case 7:
          std::cout << "H " << (heap.heap_ok() ? 1 : 0) << ' ' << heap.size() << '\n';
          break;
        case 8:
        {
          // Build the template that the working heap is restored from.
          size_t count;
          unsigned long long seed;
          long long span;
          std::cin >> count >> seed >> span;
          reset(first_template);
          fill(first_template, count, seed, span);
          break;
        }
        case 9:
        {
          // Build the template that gets merged in, again and again.
          size_t count;
          unsigned long long seed;
          long long span;
          std::cin >> count >> seed >> span;
          reset(second_template);
          fill(second_template, count, seed, span);
          break;
        }
        case 10:
          // Restore the working heap from the first template.
          heap = first_template;
          break;
        case 11:
        {
          // THE TARGET on a copy of the second template.
          CP::priority_queue<T, Comp> other(second_template);
          heap.merge(other);
          report_merge(heap, other);
          break;
        }
        case 12:
        {
          // THE TARGET on a small heap built from the stream itself, which is
          // where the interesting shapes live: one element, two elements, a
          // heap bigger than the destination, a heap of equal values.
          size_t count;
          std::cin >> count;
          CP::priority_queue<T, Comp> other;
          for (size_t k = 0; k < count; k++)
          {
            T value;
            std::cin >> value;
            other.push(value);
          }
          heap.merge(other);
          report_merge(heap, other);
          break;
        }
        case 13:
        {
          // THE TARGET on an EMPTY heap: nothing may change, and nothing may
          // be read out of the empty operand's array.
          CP::priority_queue<T, Comp> other;
          heap.merge(other);
          report_merge(heap, other);
          break;
        }
        default:
          std::cerr << "unknown command " << op << '\n';
          return;
        }
    }

    finish(heap, drain);
  }

} // namespace

int main()
{
  std::ios_base::sync_with_stdio(false);
  std::cin.tie(nullptr);

  int blocks;
  if (!(std::cin >> blocks))
    return 0;

  for (int b = 0; b < blocks; b++)
  {
    int kind;
    size_t commands, drain;
    if (!(std::cin >> kind >> commands >> drain))
      return 0;
    switch (kind)
    {
    case 1:
      run_block<int, std::less<int>>(commands, drain);
      break;
    case 2:
      run_block<int, std::greater<int>>(commands, drain);
      break;
    case 3:
      run_block<long long, std::less<long long>>(commands, drain);
      break;
    case 4:
      run_block<Item, ItemOrder>(commands, drain);
      break;
    default:
      std::cerr << "unknown block kind " << kind << '\n';
      return 0;
    }
  }
  return 0;
}
